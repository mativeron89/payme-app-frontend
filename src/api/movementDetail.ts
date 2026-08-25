import type { MovementDetailItem, MovementDetailResponse } from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MESA_CODE = /^[A-Z]{2}-\d{3,5}$/;

function record(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null ? value as Record<string, unknown> : null;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
}

function cents(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function declaredFraction(value: unknown): value is 2500 | 3333 | 5000 | 6667 | 7500 | 10000 {
  return value === 2500 || value === 3333 || value === 5000
    || value === 6667 || value === 7500 || value === 10000;
}

function text(value: unknown, max = 300): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

function item(value: unknown): MovementDetailItem | null {
  const raw = record(value);
  if (!raw || !exactKeys(raw, [
    'name', 'price_cents', 'quantity', 'category', 'amount_cents', 'fraction_bps',
    'declared_fraction_bps',
  ]) || !text(raw.name) || !cents(raw.price_cents)
      || typeof raw.quantity !== 'number' || !Number.isSafeInteger(raw.quantity) || raw.quantity < 1
      || !text(raw.category, 100)) return null;
  const amount = raw.amount_cents;
  const fraction = raw.fraction_bps;
  const declared = raw.declared_fraction_bps;
  const declaredValue = declared === null
    ? null
    : declaredFraction(declared) ? declared : undefined;
  const bothNull = amount === null && fraction === null;
  const bothPresent = cents(amount)
    && typeof fraction === 'number' && Number.isSafeInteger(fraction) && fraction > 0 && fraction <= 10000;
  if (!bothNull && !bothPresent) return null;
  // El contrato separa el dinero real de consumo de la declaración de igualdad.
  // Si aparecen los dos a la vez, el 2xx no se interpreta por inferencia.
  if (declaredValue === undefined || (bothPresent && declaredValue !== null)) return null;
  return {
    name: raw.name,
    price_cents: raw.price_cents,
    quantity: raw.quantity,
    category: raw.category,
    amount_cents: bothNull ? null : amount,
    fraction_bps: bothNull ? null : fraction,
    declared_fraction_bps: declaredValue,
  };
}

/** Un 2xx malformado nunca se vuelve detalle visible de un pago. */
export function decodeMovementDetailResponse(value: unknown): MovementDetailResponse {
  const raw = record(value);
  const restaurant = record(raw?.restaurant);
  const mesa = record(raw?.mesa);
  if (!raw || !restaurant || !mesa || !exactKeys(raw, [
    'id', 'restaurant', 'mesa', 'date', 'payment_type', 'method', 'items',
    'items_amount_cents', 'tip_amount_cents', 'gross_amount_cents', 'fee_amount_cents', 'status',
  ]) || !exactKeys(restaurant, ['name', 'category']) || !exactKeys(mesa, ['code'])
      || typeof raw.id !== 'string' || !UUID.test(raw.id)
      || !text(restaurant.name) || !text(restaurant.category, 100)
      || typeof mesa.code !== 'string' || !MESA_CODE.test(mesa.code)
      || typeof raw.date !== 'string' || !Number.isFinite(Date.parse(raw.date))
      || !['card', 'apple_pay', 'google_pay', 'wallet'].includes(String(raw.payment_type))
      || !Array.isArray(raw.items)
      || !cents(raw.items_amount_cents) || !cents(raw.tip_amount_cents)
      || !cents(raw.gross_amount_cents) || !cents(raw.fee_amount_cents)
      || BigInt(raw.items_amount_cents) + BigInt(raw.tip_amount_cents)
        !== BigInt(raw.gross_amount_cents)
      || !text(raw.status, 80)) {
    throw new Error('movement_detail_response_malformed');
  }
  const items = raw.items.map(item);
  if (items.some((entry) => entry === null)) throw new Error('movement_detail_response_malformed');
  const decodedItems = items as MovementDetailItem[];
  const monetaryLines = decodedItems.filter((entry) => entry.amount_cents !== null);
  // Un intento representa consumo cobrado O declaraciones de igualdad. Mezclar
  // ambos modelos en un mismo 2xx volvería ambiguo qué subtotal se acredita.
  if (monetaryLines.length > 0 && monetaryLines.length !== decodedItems.length) {
    throw new Error('movement_detail_response_malformed');
  }
  if (monetaryLines.length > 0) {
    const itemSubtotal = monetaryLines.reduce(
      (sum, entry) => sum + BigInt(entry.amount_cents!),
      0n,
    );
    if (itemSubtotal !== BigInt(raw.items_amount_cents)) {
      throw new Error('movement_detail_response_malformed');
    }
  }
  let method: MovementDetailResponse['method'] = null;
  if (raw.method !== null) {
    const candidate = record(raw.method);
    if (!candidate || !exactKeys(candidate, ['brand', 'bank', 'last_four'])
        || !text(candidate.brand, 50)
        || !(candidate.bank === null || text(candidate.bank, 100))
        || typeof candidate.last_four !== 'string' || !/^\d{4}$/.test(candidate.last_four)) {
      throw new Error('movement_detail_response_malformed');
    }
    method = { brand: candidate.brand, bank: candidate.bank, last_four: candidate.last_four };
  }
  return {
    id: raw.id.toLowerCase(),
    restaurant: { name: restaurant.name, category: restaurant.category },
    mesa: { code: mesa.code },
    date: raw.date,
    payment_type: raw.payment_type as MovementDetailResponse['payment_type'],
    method,
    items: decodedItems,
    items_amount_cents: raw.items_amount_cents,
    tip_amount_cents: raw.tip_amount_cents,
    gross_amount_cents: raw.gross_amount_cents,
    fee_amount_cents: raw.fee_amount_cents,
    status: raw.status,
  };
}
