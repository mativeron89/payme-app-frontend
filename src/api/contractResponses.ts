import type {
  AcceptInvitationLinkResponse,
  AttachPaymentMethodResponse,
  AttachedPaymentMethod,
  CreateInvitationResponse,
  CreateSetupIntentResponse,
  MesaCreationLookup,
  MesaCreationOutcome,
  MesaStatus,
} from './types';
import { MESA_CREATION_OUTCOME_BY_STATUS } from './types';

/** Un 2xx malformado no acredita éxito: el caller debe conservar su intento. */
export class ContractResponseError extends Error {
  constructor(endpoint: string) {
    super(`contract_response_invalid:${endpoint}`);
    this.name = 'ContractResponseError';
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function optionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean';
}

/**
 * ORDEN 1A.2 · EL ORIGEN DEL LINK, FAIL-CLOSED.
 *
 * El link de invitación es el que la persona pega en WhatsApp, y este decoder
 * lo validaba con `url.pathname.endsWith('/mesa/<code>')`: un match de SUFIJO
 * que **no miraba el host**. Cualquier URL terminada así se acreditaba como
 * "el link de MI mesa" — incluida `https://cualquier-cosa.example/redir/mesa/
 * PA-2847?t=TOKEN`, que además lleva el token adentro. Un decoder que existe
 * para que un 2xx malformado no pase como éxito no puede ser indiferente al
 * dominio al que manda a la gente.
 *
 * **Origen confiable, sin inventar dominios:** el propio origen donde corre
 * la app. Es lo único explícitamente acreditable hoy — el dominio definitivo
 * todavía no se compró, y hardcodear uno inexistente sería fingir una defensa.
 * `VITE_LINK_ORIGINS` (lista separada por comas) permite declarar orígenes
 * adicionales el día que el backend sirva links de un host distinto al que
 * sirve la app; **ausente no es permisivo**: sin orígenes acreditables, nada
 * pasa.
 *
 * Compatibilidad preservada a propósito: un link RELATIVO es del propio
 * origen por definición y sigue valiendo; el mock arma sus links con
 * `location.origin`, así que cae del lado bueno sin excepciones especiales.
 */
function origenesConfiables(): string[] {
  const salida: string[] = [];
  const declarados = import.meta.env?.VITE_LINK_ORIGINS;
  if (typeof declarados === 'string') {
    for (const o of declarados.split(',')) {
      const limpio = o.trim();
      if (limpio) salida.push(limpio);
    }
  }
  if (typeof window !== 'undefined' && window.location?.origin) salida.push(window.location.origin);
  return salida;
}

/**
 * `https` siempre; `http` **sólo** si el origen confiable es local — el
 * servidor de desarrollo y el mock corren en `http://localhost`. Un origen
 * declarado por env con http y host público se rechaza: protocolo inseguro
 * es falla cerrada, no una excepción configurable.
 */
function protocoloAceptable(url: URL): boolean {
  if (url.protocol === 'https:') return true;
  if (url.protocol !== 'http:') return false;
  return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
}

function invitationLinkMatches(
  value: unknown,
  expectedCode: string,
  origenes: readonly string[],
): boolean {
  if (!nonEmpty(value) || !nonEmpty(expectedCode)) return false;
  try {
    // Un link relativo no tiene host: es del propio origen. Se resuelve
    // contra el primero de los confiables para poder parsearlo igual.
    const esRelativo = !/^[a-z][a-z0-9+.-]*:/i.test(value) && !value.startsWith('//');
    const base = origenes[0];
    if (!esRelativo && origenes.length === 0) return false;
    if (esRelativo && !base) return false;
    const url = new URL(value, base);
    if (!origenes.includes(url.origin)) return false;
    if (!protocoloAceptable(url)) return false;
    const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
    const [hashPath, hashQuery = ''] = hash.split('?', 2);
    const expectedPath = `/mesa/${encodeURIComponent(expectedCode)}`;
    const targetMatches = url.pathname.endsWith(expectedPath) || hashPath.endsWith(expectedPath);
    const token = url.searchParams.get('t') ?? new URLSearchParams(hashQuery).get('t');
    return targetMatches && nonEmpty(token);
  } catch {
    return false;
  }
}

/**
 * CIERRE DEL PAGO SIN CUENTA · el 200 de `accept-link`.
 *
 * Se decodifica aunque el shape sea de dos campos, y por una razón concreta:
 * de este 200 depende que el front navegue a la mesa dando por hecho que la
 * persona quedó INSCRIPTA. Si el cuerpo no es el del contrato, tratarlo como
 * éxito la manda a una mesa donde el siguiente request le va a dar 403 sin
 * explicación. Un 2xx malformado no es éxito.
 *
 * `joined` tiene que ser exactamente `true`: un `"true"`, un `1` o un `false`
 * son todos verdaderos-por-descuido en JS si uno se conforma con leer la clave.
 */
export function acceptInvitationLinkResponse(value: unknown): AcceptInvitationLinkResponse {
  const body = record(value);
  if (!body || body.joined !== true || !nonEmpty(body.mesa_code)) {
    throw new ContractResponseError('invitations/accept-link');
  }
  return value as AcceptInvitationLinkResponse;
}

/**
 * El 200 de `POST /invitations/:id/accept` — la puerta IN-APP.
 *
 * Existía la asimetría, no la defensa: `accept-link` (la puerta hermana, acá
 * arriba) exige `joined === true` desde el cierre del pago sin cuenta, y este
 * accept estaba tipado `{accepted:boolean}` con el campo **sin leer jamás**.
 * Cualquier 2xx alcanzaba: un `{}`, un `{accepted:false}`, un `{accepted:"si"}`
 * o el cuerpo de otra versión del backend mostraban "Te sumaste a la mesa ✓" y
 * navegaban a una mesa donde el siguiente request iba a dar 403 sin explicar
 * nada — exactamente el daño que el decoder del link describe en su docblock.
 *
 * No se inventa una defensa: **se iguala la que una de las dos puertas ya
 * sabía hacer**. Y `=== true` estricto por lo mismo que allá: `"true"` y `1`
 * son verdaderos-por-descuido si uno se conforma con leer la clave.
 */
export function acceptInvitationResponse(value: unknown): { accepted: true } {
  const body = record(value);
  if (!body || body.accepted !== true) {
    throw new ContractResponseError('invitations/accept');
  }
  return value as { accepted: true };
}

// ─── ORDEN 2A · la reconciliación de una creación ─────────────────────────

/** Los del contrato, más `unknown` (v2.48.0). Nada fuera de acá se interpreta. */
const OUTCOMES: readonly MesaCreationOutcome[] = [
  'not_found', 'requires_action', 'open', 'partially_paid',
  'terminal', 'replayable', 'payload_hash_conflict', 'unknown',
];

/** Los que llegan SIN datos de mesa, por diseño del emisor. */
const SIN_MESA: readonly MesaCreationOutcome[] = ['not_found', 'payload_hash_conflict'];

/**
 * Los DOS que habilitan repetir el POST, y por razones distintas: `not_found`
 * —la creación nunca ocurrió, reintentar CREA— y `requires_action` —la mesa
 * existe con el 3DS sin completar, reintentar RECONDUCE el hold—. Lo declara
 * el emisor en su propio test; acá se exige, no se deduce.
 */
const CON_REINTENTO: readonly MesaCreationOutcome[] = ['not_found', 'requires_action'];

/**
 * `total_cents` viaja como **STRING** — deliberado del dueño: sale del mismo
 * helper que el 201 de `POST /mesas` y es un bigint del driver; normalizarlo
 * sólo acá daría dos formas del mismo campo. Se acepta también el entero, que
 * es la forma a la que el dueño podría migrarlo algún día: aceptar las dos no
 * inventa contrato —ninguna decisión de este flujo depende del total— y evita
 * que una normalización futura vuelva a trabar al organizador.
 */
function centavosDelContrato(value: unknown): number | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : null;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * `GET /mesas/creations/:idempotency_key`, decodificado FAIL-CLOSED.
 *
 * ## Qué se decide con esto, y por eso la dureza
 *
 * De esta respuesta depende **si se libera el journal monetario de una
 * apertura con garantía**. Liberar de más es una segunda retención por el
 * total de la mesa. Así que un 2xx que no traiga el shape completo **no es un
 * resultado**: es un error, y el caller conserva el freeze.
 *
 * - `outcome` tiene que ser uno de los declarados. Un valor nuevo del backend
 *   no se adivina por parecido: **no saber no es saber que no**. (Y `unknown`
 *   sí es uno de ellos desde v2.48.0: es el emisor diciendo que un estado de
 *   su FSM no está clasificado, en vez de inventarle una etiqueta.)
 * - `found` y `retry_with_same_idempotency_key` tienen que ser **booleanos de
 *   verdad**. `"false"` es verdadero en JS, que es la trampa que
 *   `walletRail.ts` y `invitacionAdmision.ts` ya bloquean con `typeof`.
 * - Con `found: true` **exigimos `mesa.code` y `mesa.status`**: sin código no
 *   hay a dónde navegar ni qué acreditar, y ese código es toda la prueba.
 * - `payload_hash_conflict` es la excepción declarada por el dueño: llega
 *   **sin datos de mesa a propósito** (reusar la clave con otro payload es un
 *   error del cliente, no un estado de la creación).
 *
 * ## 🔴 Las COHERENCIAS, que son lo nuevo de la ORDEN 2-A
 *
 * Un cuerpo puede tener todos sus campos bien tipados y aun así **decir dos
 * cosas incompatibles**. Un emisor desincronizado —o cualquier cosa que
 * conteste por él— produce justo eso, y de esta respuesta depende si se libera
 * una garantía. Se exige que concuerden entre sí:
 *
 * 1. `found: false` ⟺ `outcome: 'not_found'`.
 * 2. `retry_with_same_idempotency_key` ⟺ outcome ∈ {`not_found`,
 *    `requires_action`}. Lo declara el emisor; un `true` sobre `open` es
 *    "reintentá el POST sobre una mesa ya abierta", que es la duplicación.
 * 3. **`mesa.status` tiene que mapear al `outcome` que la respuesta afirma**,
 *    según la matriz del emisor replicada en `MESA_CREATION_OUTCOME_BY_STATUS`.
 *    Decir `open` sobre una mesa `pending_auth` no acredita nada.
 *    ⚠️ **Donde la réplica no conoce el estado, manda el emisor**: es la
 *    autoridad sobre su propia máquina, y rechazar un estado futuro por no
 *    estar en nuestra tabla trabaría a la persona por una desactualización
 *    nuestra. Que la tabla no envejezca lo sostiene `mesaStatus.mirror.test.ts`.
 * 4. `payload_hash_matches: false` en un 200 es imposible: el emisor
 *    cortocircuita a 409 antes de mirar el estado.
 */
export function mesaCreationResponse(value: unknown): MesaCreationLookup {
  const body = record(value);
  const endpoint = 'mesas/creations';
  if (!body) throw new ContractResponseError(endpoint);

  const outcome = body.outcome;
  if (typeof outcome !== 'string' || !OUTCOMES.includes(outcome as MesaCreationOutcome)) {
    throw new ContractResponseError(endpoint);
  }
  if (typeof body.found !== 'boolean') throw new ContractResponseError(endpoint);
  if (typeof body.retry_with_same_idempotency_key !== 'boolean') {
    throw new ContractResponseError(endpoint);
  }
  // Coherencia 1 · `not_found` con `found: true` —o al revés— es un cuerpo
  // contradictorio, y un cuerpo contradictorio no acredita nada.
  const declarado = outcome as MesaCreationOutcome;
  if ((declarado === 'not_found') === body.found) throw new ContractResponseError(endpoint);
  // Coherencia 2 · sólo dos outcomes habilitan repetir el POST.
  if (body.retry_with_same_idempotency_key !== CON_REINTENTO.includes(declarado)) {
    throw new ContractResponseError(endpoint);
  }

  const base = {
    found: body.found,
    outcome: declarado,
    retryWithSameKey: body.retry_with_same_idempotency_key,
  };
  if (SIN_MESA.includes(declarado)) {
    return { ...base, mesa: null, guarantee: null };
  }

  const mesa = record(body.mesa);
  const estado = mesa?.status;
  const totalCents = centavosDelContrato(mesa?.total_cents);
  if (!mesa || !nonEmpty(mesa.code) || typeof estado !== 'string' || totalCents === null) {
    throw new ContractResponseError(endpoint);
  }
  // Coherencia 3 · el estado tiene que mapear al outcome afirmado. Si la
  // réplica no conoce el estado, no se contradice al emisor: es su FSM.
  const esperado = MESA_CREATION_OUTCOME_BY_STATUS[estado as MesaStatus] as MesaCreationOutcome | undefined;
  if (esperado !== undefined && esperado !== declarado) throw new ContractResponseError(endpoint);
  if (esperado === undefined && declarado !== 'unknown' && declarado !== 'replayable') {
    // Un estado que no conocemos sólo puede venir con la etiqueta que el
    // emisor reserva para lo no clasificado, o con la del grupo al que suma
    // estados nuevos. Cualquier otra combinación es desincronización.
    throw new ContractResponseError(endpoint);
  }
  // Coherencia 4 · un 200 no puede decir que el hash no coincide.
  if (body.payload_hash_matches !== undefined) {
    if (body.payload_hash_matches !== true) throw new ContractResponseError(endpoint);
  }

  // `guarantee` sí se lee blando: es informativo para el copy y no gobierna
  // ninguna transición del journal. Endurecerlo trabaría al organizador por
  // un campo que no decide nada.
  const guarantee = record(body.guarantee);
  return {
    ...base,
    mesa: { code: mesa.code, status: estado as MesaStatus, totalCents },
    guarantee: guarantee
      ? {
          method: typeof guarantee.method === 'string' ? guarantee.method : null,
          authorized: guarantee.authorized === true,
        }
      : null,
  };
}

export function setupIntentResponse(value: unknown): CreateSetupIntentResponse {
  const body = record(value);
  if (!body || !nonEmpty(body.setup_intent_id) || !nonEmpty(body.client_secret)) {
    throw new ContractResponseError('payment-methods/setup-intent');
  }
  return value as CreateSetupIntentResponse;
}

function attachedPaymentMethod(
  value: unknown,
  expectedStripePaymentMethodId: string,
): value is AttachedPaymentMethod {
  const method = record(value);
  if (!method) return false;
  if (
    !nonEmpty(method.id) ||
    method.stripe_payment_method_id !== expectedStripePaymentMethodId ||
    !nonEmpty(method.brand) ||
    (method.bank_name !== null && typeof method.bank_name !== 'string') ||
    !['credit', 'debit'].includes(String(method.type)) ||
    typeof method.last_four !== 'string' || !/^\d{4}$/.test(method.last_four) ||
    !Number.isSafeInteger(method.exp_month) || Number(method.exp_month) < 1 || Number(method.exp_month) > 12 ||
    !Number.isSafeInteger(method.exp_year) || Number(method.exp_year) < 1 ||
    typeof method.is_default !== 'boolean' ||
    !nonEmpty(method.display)
  ) return false;
  return true;
}

export function attachPaymentMethodResponse(
  value: unknown,
  expectedStripePaymentMethodId: string,
): AttachPaymentMethodResponse {
  const body = record(value);
  if (
    !body ||
    !nonEmpty(expectedStripePaymentMethodId) ||
    !attachedPaymentMethod(body.payment_method, expectedStripePaymentMethodId) ||
    !optionalBoolean(body.idempotent)
  ) throw new ContractResponseError('payment-methods');
  return value as AttachPaymentMethodResponse;
}

export function invitationResponse(
  value: unknown,
  expectedType: 'link' | 'in_app',
  expectedCode: string,
  /** Sólo para tests: en la app sale del runtime (`origenesConfiables`). */
  origenes: readonly string[] = origenesConfiables(),
): CreateInvitationResponse {
  const body = record(value);
  const invitation = record(body?.invitation);
  if (
    !body ||
    !invitation ||
    !nonEmpty(invitation.id) ||
    invitation.invitation_type !== expectedType ||
    !['pending', 'expired'].includes(String(invitation.status)) ||
    !nonEmpty(invitation.expires_at) ||
    !nonEmpty(invitation.created_at) ||
    !optionalBoolean(body.idempotent) ||
    (body.link !== undefined && !nonEmpty(body.link)) ||
    (expectedType === 'link' && !invitationLinkMatches(body.link, expectedCode, origenes))
  ) throw new ContractResponseError('mesas/invitations');
  return value as CreateInvitationResponse;
}
