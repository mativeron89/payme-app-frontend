/** Contrato autoritativo de `POST /api/ocr`. No llama al proveedor. */
'use strict';

function normalizeName(value) {
  if (typeof value !== 'string') return null;
  const name = value.normalize('NFC').trim().replace(/\s+/gu, ' ');
  return name && name.length <= 200 && ![...name].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) ? name : null;
}
function normalizeRfc(value) {
  if (typeof value !== 'string') return null;
  const rfc = value.normalize('NFC').toUpperCase().replace(/[\s-]/gu, '');
  return /^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$/u.test(rfc) ? rfc : null;
}

/**
 * v2.156.0 · AB-D209 · subtotal e IVA del ticket (decisión 209). Existen SÓLO si cuadran exacto al
 * centavo con el total impreso: subtotal + IVA = total. UNA definición para el OCR, el recibo firmado
 * y la mesa (`services/origenItems.js`). Devuelve el objeto normalizado o `null`.
 */
function totalesDelTicket(valor, totalImpresoCents) {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return null;
  const claves = Object.keys(valor);
  if (claves.length !== 2 || !claves.includes('subtotal_cents') || !claves.includes('tax_cents')) return null;
  const { subtotal_cents: subtotal, tax_cents: iva } = valor;
  if (!Number.isSafeInteger(subtotal) || subtotal <= 0 || !Number.isSafeInteger(iva) || iva < 0) return null;
  if (!Number.isSafeInteger(totalImpresoCents) || subtotal + iva !== totalImpresoCents) return null;
  return { subtotal_cents: subtotal, tax_cents: iva };
}

/**
 * v2.164.0 · AB-NOCHE F · D218: los ajustes del ticket, negociados con `adjustments_version=1`. En v1 sólo el
 * descuento impreso, con su importe en centavos positivos (el signo lo da `kind`) y sin el texto de la
 * etiqueta. Devuelve la lista normalizada o `null`.
 */
const OCR_ADJUSTMENT_KINDS = Object.freeze(['discount']);
const OCR_ADJUSTMENTS_MAX = 10;
function ajustesDelTicket(valor) {
  if (!Array.isArray(valor) || valor.length === 0 || valor.length > OCR_ADJUSTMENTS_MAX) return null;
  const out = [];
  for (const a of valor) {
    if (!a || typeof a !== 'object' || Array.isArray(a)) return null;
    const claves = Object.keys(a);
    if (claves.length !== 2 || !claves.includes('kind') || !claves.includes('amount_cents')) return null;
    if (!OCR_ADJUSTMENT_KINDS.includes(a.kind) || !Number.isSafeInteger(a.amount_cents) || a.amount_cents <= 0) return null;
    out.push({ kind: a.kind, amount_cents: a.amount_cents });
  }
  return out;
}
const sumaDeAjustes = (ajustes) => ajustes.reduce((s, a) => s + a.amount_cents, 0);

/**
 * v2.164.0 · D218: `ticket_totals` de un ticket con descuento, sólo para quien negocia ajustes. El IVA puede
 * faltar (el ticket imprime SUBTOTAL y no IVA), y la identidad incluye el descuento: S + V − D = T (el
 * descuento después del subtotal) o S + V = T (antes, S ya descontado). Devuelve el objeto o `null`.
 */
function totalesConAjustes(valor, totalImpresoCents, descuentoCents) {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return null;
  const claves = Object.keys(valor);
  if (!claves.includes('subtotal_cents') || claves.some((c) => !['subtotal_cents', 'tax_cents'].includes(c))) return null;
  const { subtotal_cents: subtotal, tax_cents: iva } = valor;
  if (!Number.isSafeInteger(subtotal) || subtotal <= 0) return null;
  if (iva !== undefined && (!Number.isSafeInteger(iva) || iva < 0)) return null;
  if (!Number.isSafeInteger(totalImpresoCents) || !Number.isSafeInteger(descuentoCents) || descuentoCents <= 0) return null;
  const conIva = subtotal + (iva ?? 0);
  if (conIva !== totalImpresoCents && conIva - descuentoCents !== totalImpresoCents) return null;
  return iva === undefined ? { subtotal_cents: subtotal } : { subtotal_cents: subtotal, tax_cents: iva };
}

const OCR_WARNING_CODES = Object.freeze([
  'no_items_found',
  'low_confidence_items',
  'total_mismatch',
  // Degradación deliberada: HTTP 200 con edición manual disponible.
  'provider_error',
]);

/**
 * v2.161.0 · AB-NOCHE D: la extensión negociada (`warnings_version=2`). La lista base de arriba NO cambia:
 * el decoder del AF servido rechaza un código que no conoce, y la base está en su espejo.
 *   · `no_prices_found`: la foto tiene renglones de texto y ningún precio (una comanda). Siempre junto a
 *     `no_items_found` y con cero ítems.
 */
const OCR_WARNING_CODES_V2 = Object.freeze([...OCR_WARNING_CODES, 'no_prices_found']);

const OCR_ERROR_STATUS = Object.freeze({
  invalid_ocr_contract_version: 400,
  no_image: 400,
  invalid_image_type: 400,
  invalid_multipart: 400,
  image_too_large: 413,
  // v2.133.0 · n81 · foto de menos de 10 KB: 422, la imagen es válida pero no se puede leer.
  ticket_image_too_small: 422,
  unsupported_image_type_for_provider: 415,
  // C6 · cuota diaria del OCR real agotada. 429 y no 503: el servicio está
  // sano, lo que se acabó es el techo del día. El body no lleva contador,
  // restante, fecha ni identificador — sólo el código, como todos los demás.
  ocr_daily_quota_exhausted: 429,
  ocr_monthly_budget_exhausted: 429,
  ocr_budget_unavailable: 503,
});

const OCR_ITEM_FIELDS = Object.freeze([
  'name', 'category', 'price_cents', 'quantity', 'confidence', 'low_confidence',
]);
const OCR_CATEGORIES = Object.freeze(['italian', 'japanese', 'mexican', 'cafe', 'other']);

function enteroSeguroNoNegativo(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function assertItem(item) {
  const keys = item && typeof item === 'object' ? Object.keys(item) : [];
  if (keys.some((key) => !OCR_ITEM_FIELDS.includes(key))) {
    throw new Error('ocr_response_item_extra_field');
  }
  if (!item || typeof item !== 'object'
      || typeof item.name !== 'string' || !item.name || item.name.length > 200
      || item.name !== item.name.trim()
      || !OCR_CATEGORIES.includes(item.category)
      || !enteroSeguroNoNegativo(item.price_cents) || item.price_cents === 0
      || !Number.isSafeInteger(item.quantity) || item.quantity < 1) {
    throw new Error('ocr_response_item_invalid');
  }
  if (item.confidence !== undefined
      && (!Number.isInteger(item.confidence) || item.confidence < 0 || item.confidence > 100)) {
    throw new Error('ocr_response_confidence_invalid');
  }
  if (item.low_confidence !== undefined && item.low_confidence !== true) {
    throw new Error('ocr_response_low_confidence_invalid');
  }
  if (item.low_confidence === true && item.confidence === undefined) {
    throw new Error('ocr_response_low_confidence_without_confidence');
  }
}

/**
 * Conserva el shape existente y falla si un proveedor intenta publicar otra
 * cosa. `confidence`/`low_confidence` son opcionales porque el mock histórico
 * no los inventa; Textract sí los entrega por ítem.
 */
function respuestaOcr(payload, { mock, contractVersion = 1, totalsVersion, warningsVersion, adjustmentsVersion }) {
  if (!payload || !Array.isArray(payload.items)) throw new Error('ocr_response_items_invalid');
  payload.items.forEach(assertItem);
  if (!enteroSeguroNoNegativo(payload.total_cents)) {
    throw new Error('ocr_response_total_invalid');
  }
  if (payload.total_detected_cents !== undefined
      && !enteroSeguroNoNegativo(payload.total_detected_cents)) {
    throw new Error('ocr_response_detected_total_invalid');
  }
  if (!Array.isArray(payload.warnings)
      || payload.warnings.some((warning) => !OCR_WARNING_CODES_V2.includes(warning))
      || new Set(payload.warnings).size !== payload.warnings.length
      || (payload.warnings.includes('no_prices_found')
        && (!payload.warnings.includes('no_items_found') || payload.items.length > 0))) {
    throw new Error('ocr_response_warnings_invalid');
  }
  // Sin la negociación exacta (v2 + warnings_version=2) la lista sale con los códigos de siempre.
  const warnings = contractVersion === 2 && warningsVersion === 2
    ? payload.warnings : payload.warnings.filter((w) => OCR_WARNING_CODES.includes(w));
  let merchant;
  if (contractVersion === 2 && payload.merchant !== undefined) {
    const input = payload.merchant;
    if (!input || Array.isArray(input) || typeof input !== 'object'
        || !Object.keys(input).length || Object.keys(input).some((k) => !['name','rfc'].includes(k))
        || (input.name !== undefined && normalizeName(input.name) !== input.name)
        || (input.rfc !== undefined && normalizeRfc(input.rfc) !== input.rfc)) {
      throw new Error('ocr_response_merchant_invalid');
    }
    merchant = { ...input };
  }
  // v2.156.0 · AB-D209 · `ticket_totals` sólo para quien lo negocia (`totals_version=1`): el decoder
  // v2 del AF servido es cerrado y una clave que no conoce rompe la lectura del ticket.
  let ticketTotals;
  if (contractVersion === 2 && totalsVersion === 1 && payload.ticket_totals !== undefined) {
    ticketTotals = totalesDelTicket(payload.ticket_totals, payload.total_detected_cents);
    if (!ticketTotals) {
      // v2.164.0 · D218: con descuento, el par de siempre puede no cuadrar o faltar el IVA. Vale sólo con sus
      // ajustes, y sale sólo a quien negocia `adjustments_version=1`; a quien no, se omite como antes.
      const ajustes = payload.ticket_adjustments === undefined ? null : ajustesDelTicket(payload.ticket_adjustments);
      const conAjustes = ajustes && totalesConAjustes(payload.ticket_totals, payload.total_detected_cents, sumaDeAjustes(ajustes));
      if (!conAjustes) throw new Error('ocr_response_ticket_totals_invalid');
      ticketTotals = adjustmentsVersion === 1 ? conAjustes : undefined;
    }
  }
  // v2.164.0 · D218: el descuento aparte, sólo para quien negocia `adjustments_version=1`. Invariante: la suma
  // de los ítems menos los descuentos (más el IVA agregado, si lo hay) es el total impreso.
  let ticketAdjustments;
  if (contractVersion === 2 && adjustmentsVersion === 1 && payload.ticket_adjustments !== undefined) {
    ticketAdjustments = ajustesDelTicket(payload.ticket_adjustments);
    const iva = payload.ticket_totals?.tax_cents;
    const cierra = ticketAdjustments && Number.isSafeInteger(payload.total_detected_cents)
      && [0, ...(Number.isSafeInteger(iva) ? [iva] : [])]
        .some((x) => payload.total_cents - sumaDeAjustes(ticketAdjustments) + x === payload.total_detected_cents);
    if (!cierra) throw new Error('ocr_response_ticket_adjustments_invalid');
  }
  return {
    ...(contractVersion === 2 ? { contract_version: 2, ...(merchant && { merchant }) } : {}),
    items: payload.items,
    total_cents: payload.total_cents,
    ...(payload.total_detected_cents !== undefined
      ? { total_detected_cents: payload.total_detected_cents }
      : {}),
    ...(ticketTotals ? { ticket_totals: ticketTotals } : {}),
    ...(ticketAdjustments ? { ticket_adjustments: ticketAdjustments } : {}),
    warnings,
    mock: !!mock,
  };
}

function respuestaProveedorNoDisponible(contractVersion = 1) {
  return respuestaOcr({
    items: [], total_cents: 0, warnings: ['provider_error'],
  }, { mock: false, contractVersion });
}

function errorOcr(code, extra = {}) {
  const status = OCR_ERROR_STATUS[code];
  if (!status) throw new Error('ocr_error_code_unknown');
  if (code === 'ocr_monthly_budget_exhausted' || code === 'ocr_budget_unavailable') {
    return { status, body: { error: code } };
  }
  return { status, body: { error: code, ...extra } };
}

module.exports = {
  normalizeName,
  normalizeRfc,
  totalesDelTicket,
  totalesConAjustes,
  ajustesDelTicket,
  OCR_ADJUSTMENT_KINDS,
  OCR_WARNING_CODES,
  OCR_WARNING_CODES_V2,
  OCR_ERROR_STATUS,
  OCR_ITEM_FIELDS,
  OCR_CATEGORIES,
  respuestaOcr,
  respuestaProveedorNoDisponible,
  errorOcr,
};
