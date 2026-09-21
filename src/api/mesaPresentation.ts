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

/** Nunca deriva N de `expected_participants`, miembros actuales o cantidades. */
export function originalParticipants(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 20
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
  if (!Number.isSafeInteger(denominator) || denominator < 1 || denominator > 20) {
    throw new Error('fraction_denominator_invalid');
  }
  return Math.floor(10000 / denominator);
}

export function initialDenominator(original: number, remainingBps: number): number | null {
  if (originalParticipants(original) === null || !Number.isSafeInteger(remainingBps) || remainingBps < 0 || remainingBps > 10000) {
    return null;
  }
  for (let denominator = 1; denominator <= original; denominator += 1) {
    if (denominatorBps(denominator) <= remainingBps) return denominator;
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
