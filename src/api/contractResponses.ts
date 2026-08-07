import type {
  AcceptInvitationLinkResponse,
  AttachPaymentMethodResponse,
  AttachedPaymentMethod,
  CreateInvitationResponse,
  CreateSetupIntentResponse,
} from './types';

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
