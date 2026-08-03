import { loadSession, type StoredSession } from './storage';

const STORAGE_KEY = import.meta.env.VITE_MOCK === '1'
  ? 'payme_card_setup_attempt_v1__mock'
  : 'payme_card_setup_attempt_v1';
const VERSION = 1;

export interface CardSetupAttemptState {
  setupKey: string;
  setAsDefault: boolean;
  stage: 'setup' | 'attach';
  paymentMethodId?: string;
}

export type CardSetupActor = Pick<StoredSession, 'principal_id' | 'family_id'>;

interface StoredCardSetupAttempt {
  v: number;
  principal_id: string;
  setup_key: string;
  set_as_default: boolean;
  stage: 'setup' | 'attach';
  payment_method_id?: string;
  at: number;
}

export class CardSetupAttemptError extends Error {
  constructor(code: string) {
    super(code);
    this.name = 'CardSetupAttemptError';
  }
}

function currentPrincipal(): string {
  const principal = loadSession()?.principal_id;
  if (!principal) throw new CardSetupAttemptError('card_setup_actor_unavailable');
  return principal;
}

function assertCurrentActor(expected: CardSetupActor): string {
  const current = loadSession();
  if (
    !current ||
    current.principal_id !== expected.principal_id ||
    current.family_id !== expected.family_id
  ) throw new CardSetupAttemptError('card_setup_actor_changed');
  return current.principal_id;
}

function validStored(value: unknown): value is StoredCardSetupAttempt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  const allowed = new Set([
    'v', 'principal_id', 'setup_key', 'set_as_default', 'stage',
    'payment_method_id', 'at',
  ]);
  if (Object.keys(entry).some((key) => !allowed.has(key))) return false;
  const paymentMethodId = entry.payment_method_id;
  return entry.v === VERSION &&
    typeof entry.principal_id === 'string' && entry.principal_id.length > 0 &&
    typeof entry.setup_key === 'string' && entry.setup_key.length >= 8 && entry.setup_key.length <= 100 &&
    typeof entry.set_as_default === 'boolean' &&
    (entry.stage === 'setup' || entry.stage === 'attach') &&
    Number.isSafeInteger(entry.at) && Number(entry.at) >= 0 &&
    (entry.stage === 'setup'
      ? paymentMethodId === undefined
      : typeof paymentMethodId === 'string' && paymentMethodId.startsWith('pm_'));
}

function readStored(): StoredCardSetupAttempt | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!validStored(value)) throw new Error('invalid');
    return value;
  } catch {
    throw new CardSetupAttemptError('card_setup_attempt_ambiguous');
  }
}

/**
 * Reanuda únicamente para el mismo principal. El family puede rotar por
 * refresh/relogin: SetupIntent y PM pertenecen a la cuenta, no al bearer.
 */
export function readCardSetupAttempt(): CardSetupAttemptState | null {
  const principal = currentPrincipal();
  const stored = readStored();
  if (!stored || stored.principal_id !== principal) return null;
  return {
    setupKey: stored.setup_key,
    setAsDefault: stored.set_as_default,
    stage: stored.stage,
    ...(stored.payment_method_id && { paymentMethodId: stored.payment_method_id }),
  };
}

/** Persiste solo referencias no secretas; client_secret nunca entra acá. */
export function writeCardSetupAttempt(
  attempt: CardSetupAttemptState,
  expectedActor: CardSetupActor,
): void {
  const principal = assertCurrentActor(expectedActor);
  const previous = readStored();
  // CAS de generación: una alta nueva nace únicamente sobre vacío y el
  // avance setup→attach exige que la misma key siga siendo la autoridad.
  // Una promesa K1 tardía nunca puede resucitarse sobre K2 ni tras un clear.
  const transitionMatches = attempt.stage === 'setup'
    ? previous === null
    : !!previous &&
      previous.principal_id === principal &&
      previous.setup_key === attempt.setupKey;
  if (!transitionMatches) throw new CardSetupAttemptError('card_setup_generation_stale');
  const stored: StoredCardSetupAttempt = {
    v: VERSION,
    principal_id: principal,
    setup_key: attempt.setupKey,
    set_as_default: attempt.setAsDefault,
    stage: attempt.stage,
    ...(attempt.paymentMethodId && { payment_method_id: attempt.paymentMethodId }),
    at: Date.now(),
  };
  if (!validStored(stored)) throw new CardSetupAttemptError('card_setup_attempt_ambiguous');
  const raw = JSON.stringify(stored);
  try {
    sessionStorage.setItem(STORAGE_KEY, raw);
    if (sessionStorage.getItem(STORAGE_KEY) !== raw) throw new Error('roundtrip');
  } catch {
    throw new CardSetupAttemptError('card_setup_storage_unavailable');
  }
}

/** CAS: una respuesta tardía no borra un intento más nuevo. */
export function clearCardSetupAttempt(
  expectedSetupKey: string,
  expectedActor: CardSetupActor,
): void {
  const principal = assertCurrentActor(expectedActor);
  const stored = readStored();
  if (!stored || stored.principal_id !== principal || stored.setup_key !== expectedSetupKey) return;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
    if (sessionStorage.getItem(STORAGE_KEY) !== null) throw new Error('roundtrip');
  } catch {
    throw new CardSetupAttemptError('card_setup_storage_unavailable');
  }
}
