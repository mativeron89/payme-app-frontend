/**
 * Claves de idempotencia ESTABLES por intento de operación (B-06).
 *
 * El bug: generábamos una clave nueva DENTRO de cada llamada, así que la
 * idempotencia del backend —que está bien hecha— nunca se ejercía. Si se
 * perdía la respuesta de un pago YA cobrado, el reintento se llevaba el
 * casillero de otro comensal (o cobraba otra fracción del mismo plato).
 *
 * Reglas (acordadas con el backend, contrato v2.25.0):
 *  - El scope se DERIVA DEL CONTENIDO del pago (ítems, propina, método), como
 *    en Transfer/Topup. Payload distinto = scope distinto = clave distinta,
 *    sin rotar nada. Payload idéntico = misma clave, aunque el usuario haya
 *    recargado o salido de la mesa y vuelto → el reintento cae en el replay.
 *  - NO se rota "por efecto" (un `useEffect` con deps corre también en el
 *    MONTAJE y borraba la clave justo cuando el usuario vuelve a mirar la
 *    mesa, que es lo que el propio mensaje de error le pide hacer).
 *  - Se ROTA cuando el intento murió de verdad (402, 502, 3DS rechazado,
 *    `idempotency_key_terminal`) — ahí el backend ya liberó el casillero — y
 *    tras el ÉXITO, porque el pago siguiente es otra intención.
 *  - JAMÁS se rota ante `refunded`: ese pago SÍ se cobró, y rotar ahí
 *    re-cobraría un reembolso (aviso del backend).
 *  - JAMÁS se rota ante `idempotency_conflict`: significa que hay un intento
 *    VIVO con otro payload. Rotar ahí es exactamente el doble cobro.
 *
 * Vive en `sessionStorage` y no en memoria: con un `useRef`, recargar la
 * página entre el fallo y el reintento hace volver el bug entero.
 *
 * El `pm_` viaja JUNTO a la clave porque Stripe.js devuelve uno distinto por
 * invocación y el backend lo incluye en el hash del payload: sin cachearlo,
 * reusar la clave daría `409 idempotency_conflict` en bucle.
 */

const PREFIX = 'payme_idem_';
const memoryAttempts = new Map<string, StoredAttempt>();

interface StoredAttempt {
  key: string;
  /** `pm_…` de una tarjeta tipeada, para no re-tokenizar en el reintento. */
  pm?: string;
}

function newKey(): string {
  return crypto.randomUUID();
}

function read(scope: string): StoredAttempt | null {
  try {
    const raw = sessionStorage.getItem(PREFIX + scope);
    if (!raw) return memoryAttempts.get(scope) ?? null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && typeof (parsed as StoredAttempt).key === 'string') {
      const attempt = parsed as StoredAttempt;
      memoryAttempts.set(scope, attempt);
      return attempt;
    }
  } catch {
    // En modo privado o con storage bloqueado, conservamos la identidad mientras
    // esta pestaña siga viva. Tras una recarga no queda prueba durable del intento:
    // ese caso requiere recuperación contractual, no una clave nueva inventada.
    return memoryAttempts.get(scope) ?? null;
  }
  return memoryAttempts.get(scope) ?? null;
}

function write(scope: string, value: StoredAttempt): void {
  memoryAttempts.set(scope, value);
  try {
    sessionStorage.setItem(PREFIX + scope, JSON.stringify(value));
  } catch {
    // El fallback en memoria conserva clave y pm_ durante esta pestaña.
  }
}

/** Clave del intento en curso; la crea si no había. */
export function idempotencyKeyFor(scope: string): string {
  const found = read(scope);
  if (found) return found.key;
  const key = newKey();
  write(scope, { key });
  return key;
}

/** Cierra el intento: el próximo pago arranca con clave nueva. */
export function rotateIdempotencyKey(scope: string): void {
  memoryAttempts.delete(scope);
  try {
    sessionStorage.removeItem(PREFIX + scope);
  } catch {
    // idem
  }
}

/** Guarda el `pm_` tokenizado junto a la clave del intento en curso. */
export function rememberPaymentMethod(scope: string, pm: string): void {
  const found = read(scope);
  write(scope, { key: found?.key ?? newKey(), pm });
}

/** `pm_` ya tokenizado para este intento, si lo hay. */
export function recallPaymentMethod(scope: string): string | undefined {
  return read(scope)?.pm;
}

/**
 * Estados en los que el intento está MUERTO y hay que arrancar de cero.
 * `refunded` NO está: ese pago se cobró (ver cabecera).
 */
export const TERMINAL_ATTEMPT_STATUSES = ['failed', 'cancelled', 'cancelling'] as const;

/**
 * Errores del backend que significan "este intento no va a prosperar nunca":
 * ahí el casillero/ítem ya quedó liberado y corresponde clave nueva.
 *
 * `idempotency_conflict` NO está: ese error dice que la clave está viva con
 * OTRO payload. Rotarla ahí es abrir un segundo cobro sobre un pago que quizá
 * ya salió — el bug que esto viene a cerrar. Se resuelve congelando el intento
 * (ver `markUnconfirmed`), no rotando.
 */
export const ROTATING_ERROR_CODES = [
  'idempotency_key_terminal',
  'insufficient_funds',
  'payment_provider_error',
  'no_slots_available',
  'mesa_not_payable',
  'fraction_not_available',
  'item_already_paid',
  'item_already_locked',
  'wallet_requires_auth',
  'validation_error',
] as const;

/**
 * ¿Este error mata el intento (rotar) o es ambiguo (conservar la clave)?
 *
 * La regla real es el STATUS: un 4xx es una decisión del backend —ya liberó el
 * casillero o la fracción— y reintentar de cero es lo correcto; un 5xx, un
 * timeout o la red caída no dicen nada sobre si el cobro salió, así que la
 * clave se conserva. Excepciones: 409 `idempotency_conflict` (hay un intento
 * vivo: rotar sería el doble cobro) y 429 (pedir de nuevo, no empezar otro).
 *
 * La lista de códigos queda como respaldo para cuando no hay status (mock
 * viejo, error sin envolver).
 */
export function shouldRotateOnError(code: string, status?: number | null): boolean {
  if (code === 'idempotency_conflict') return false;
  if ((ROTATING_ERROR_CODES as readonly string[]).includes(code)) return true;
  if (typeof status === 'number') {
    if (status === 409 || status === 429) return false;
    return status >= 400 && status < 500;
  }
  return false;
}

/**
 * Intento SIN CONFIRMAR (error ambiguo: red caída, timeout, respuesta
 * perdida). Puede haberse cobrado o no; el único que sabe es el backend.
 *
 * Mientras exista, la pantalla CONGELA el pago: no deja cambiar propina,
 * método ni consumos, y el único botón es reintentar ESE mismo pago. Sin el
 * congelamiento, cambiar cualquier cosa genera una clave nueva y el reintento
 * cobra de nuevo — el mismo doble cobro de B-06 por otra puerta.
 *
 * `area` es estable (la mesa, el restaurante); el valor guardado es el scope
 * EXACTO del intento, que es lo que congela el payload. Va a sessionStorage
 * para sobrevivir a una recarga.
 */
const PENDING_PREFIX = 'payme_pending_';
const memoryPending = new Map<string, UnconfirmedAttempt>();

/**
 * `evidence` es cuánta prueba de pago propio había en la mesa AL CONGELAR
 * (casilleros `claimed_by_me`). Sirve para descongelar solo, y hace falta que
 * sea un contador y no un booleano: quien ya había pagado una parte antes
 * arrancaría con la prueba en verdadero y se descongelaría sin haber cobrado
 * nada nuevo — justo el segundo cobro que esto evita.
 */
export interface UnconfirmedAttempt {
  scope: string;
  evidence: number;
  /**
   * El CUERPO exacto que se mandó. Se guarda porque congelar solo la clave no
   * alcanza: tras una recarga el estado de la pantalla arranca vacío, y
   * reconstruir el pedido mandaría otro payload con la misma clave → 409 en
   * bucle. El reintento reenvía esto, tal cual.
   */
  payload?: unknown;
}

export function markUnconfirmed(area: string, scope: string, evidence = 0, payload?: unknown): void {
  const attempt: UnconfirmedAttempt = { scope, evidence, ...(payload !== undefined && { payload }) };
  memoryPending.set(area, attempt);
  try {
    sessionStorage.setItem(PENDING_PREFIX + area, JSON.stringify(attempt));
  } catch {
    // El estado React y este fallback mantienen el intento congelado en memoria.
  }
}

export function readUnconfirmed(area: string): UnconfirmedAttempt | null {
  try {
    const raw = sessionStorage.getItem(PENDING_PREFIX + area);
    if (!raw) return memoryPending.get(area) ?? null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && typeof (parsed as UnconfirmedAttempt).scope === 'string') {
      const a = parsed as UnconfirmedAttempt;
      const attempt = {
        scope: a.scope,
        evidence: typeof a.evidence === 'number' ? a.evidence : 0,
        ...(a.payload !== undefined && { payload: a.payload }),
      };
      memoryPending.set(area, attempt);
      return attempt;
    }
  } catch {
    return memoryPending.get(area) ?? null;
  }
  return memoryPending.get(area) ?? null;
}

export function clearUnconfirmed(area: string): void {
  memoryPending.delete(area);
  try {
    sessionStorage.removeItem(PENDING_PREFIX + area);
  } catch {
    // idem
  }
}
