export type RestaurantLabelValidation =
  | { readonly ok: true; readonly normalized: string | null }
  | { readonly ok: false; readonly reason: 'raw_too_long' | 'control_character' | 'normalized_too_long' };

/** Contrato `mesa-presentation-v1`: UTF-16, NFC, trim y espacios colapsados. */
export function validateRestaurantLabel(raw: string): RestaurantLabelValidation {
  if (raw.length > 400) return { ok: false, reason: 'raw_too_long' };
  if (/[\u0000-\u001f\u007f]/u.test(raw)) return { ok: false, reason: 'control_character' };
  const normalized = raw.normalize('NFC').trim().replace(/\s+/gu, ' ');
  if (!normalized) return { ok: true, normalized: null };
  if (normalized.length > 200) return { ok: false, reason: 'normalized_too_long' };
  return { ok: true, normalized };
}

/**
 * D375 · el tope de personas de una mesa: 50 desde App Backend 2.187.0 (antes,
 * 20). Es el `MAX_PERSONAS` del dueño (`services/mesaPresentation.js`) y el
 * 1..50 de `create.expected_participants` y `read.original_participants` del
 * contrato espejado. Lo usan el contador de «¿Cómo dividen?», el decodificador
 * de `POST /mesas` y el mock.
 */
export const MAX_PERSONAS = 50;

/**
 * D375 · la porción NO sube: un plato se parte en a lo sumo 20
 * (`lock.fraction_denominator` 1..20, `<= min(original_participants, 20)`).
 * Es el `MAX_PARTICIPANTES` del dueño; `topePorcion(n)` es su `topePorcion`.
 */
export const TOPE_PORCION = 20;

/** Hasta qué k se puede partir un plato en una mesa de N personas: min(N, 20). */
export function topePorcion(original: number): number {
  return Math.min(original, TOPE_PORCION);
}

/** Nunca deriva N de `expected_participants`, miembros actuales o cantidades. */
export function originalParticipants(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= MAX_PERSONAS
    ? value
    : null;
}

/** Sólo el fallback privado sin QR ni identidad OCR puede recibir etiqueta. */
export function canLabelPrivateUnknownRestaurant(input: {
  readonly hasRestaurantFromQr: boolean;
  readonly restaurantName: string | null | undefined;
  readonly ocrName: string | null | undefined;
  readonly ocrRfc: string | null | undefined;
}): boolean {
  return !input.hasRestaurantFromQr
    && input.restaurantName === 'Restaurante sin identificar'
    && !input.ocrName?.trim()
    && !input.ocrRfc?.trim();
}

export function denominatorBps(denominator: number): number {
  if (!Number.isSafeInteger(denominator) || denominator < 1 || denominator > TOPE_PORCION) {
    throw new Error('fraction_denominator_invalid');
  }
  return Math.floor(10000 / denominator);
}

export function initialDenominator(original: number, remainingBps: number): number | null {
  if (originalParticipants(original) === null || !Number.isSafeInteger(remainingBps) || remainingBps < 0 || remainingBps > 10000) {
    return null;
  }
  // D375 · hasta min(N, 20): con N > 20, el 21 no es una porción (denominatorBps lanzaría).
  for (let denominator = 1; denominator <= topePorcion(original); denominator += 1) {
    if (denominatorBps(denominator) <= remainingBps) return denominator;
  }
  return null;
}

/**
 * Inverso de `denominatorBps` para 1..min(N, 20): el k cuyo `floor(10000/k)` es
 * `bps`, o `null` (una fracción legacy como 6667 no tiene k).
 */
export function denominatorFromBps(bps: number, original: number | null): number | null {
  if (original === null || originalParticipants(original) === null) return null;
  for (let denominator = 1; denominator <= topePorcion(original); denominator += 1) {
    if (denominatorBps(denominator) === bps) return denominator;
  }
  return null;
}

export const DEFAULT_DENOMINATORS = [1, 2, 3, 4] as const;

export function availableDefaultDenominators(original: number, remainingBps: number): number[] {
  if (originalParticipants(original) === null) return [];
  return DEFAULT_DENOMINATORS.filter(
    (denominator) => denominator <= original && denominatorBps(denominator) <= remainingBps,
  );
}
