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

const OCR_WARNING_CODES = Object.freeze([
  'no_items_found',
  'low_confidence_items',
  'total_mismatch',
  // Degradación deliberada: HTTP 200 con edición manual disponible.
  'provider_error',
]);

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
function respuestaOcr(payload, { mock, contractVersion = 1 }) {
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
      || payload.warnings.some((warning) => !OCR_WARNING_CODES.includes(warning))
      || new Set(payload.warnings).size !== payload.warnings.length) {
    throw new Error('ocr_response_warnings_invalid');
  }
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
  return {
    ...(contractVersion === 2 ? { contract_version: 2, ...(merchant && { merchant }) } : {}),
    items: payload.items,
    total_cents: payload.total_cents,
    ...(payload.total_detected_cents !== undefined
      ? { total_detected_cents: payload.total_detected_cents }
      : {}),
    warnings: payload.warnings,
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
  OCR_WARNING_CODES,
  OCR_ERROR_STATUS,
  OCR_ITEM_FIELDS,
  OCR_CATEGORIES,
  respuestaOcr,
  respuestaProveedorNoDisponible,
  errorOcr,
};
