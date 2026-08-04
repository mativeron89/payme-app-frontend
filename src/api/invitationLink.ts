/**
 * CIERRE DEL PAGO SIN CUENTA · el token del link deja de ser AUTORIZACIÓN y
 * pasa a ser CREDENCIAL. Este módulo es lo único que lo custodia.
 *
 * ## Qué cambió del otro lado
 *
 * Hasta v2.31.0, `GET /mesas/:code`, `items/lock` y `pay` aceptaban
 * `guestOrAuth`: con el token en `?t=` se podía ver la mesa, tomar ítems y
 * **pagar sin cuenta**. Desde v2.32.0 las tres exigen sesión y contestan
 * **401**. El único camino para sumarse es
 * `POST /api/invitations/accept-link`, que canjea el token por una inscripción
 * atribuida a `user_id`.
 *
 * ## Por qué hace falta guardarlo, y no alcanza con la URL
 *
 * El circuito ratificado es: llega el link por WhatsApp → quien lo abre no tiene
 * cuenta → **no ve la mesa** → se registra → **el token sobrevive al alta** →
 * se canjea → recién ahí ve la mesa y paga.
 *
 * El paso del alta es el riesgo real: si el token se pierde, la persona se
 * registra y **queda afuera de la mesa a la que la invitaron**, que es peor que
 * el defecto que estamos cerrando. La URL sola no alcanza — cualquier
 * navegación, recarga o remonte que cambie el hash se lo lleva puesto.
 *
 * ## Por qué `sessionStorage` y no `localStorage`
 *
 * Es una **credencial**, así que su vida útil tiene que ser la del flujo, no la
 * del dispositivo. `sessionStorage` sobrevive a recargas y remontes de la
 * pestaña —que es todo lo que el circuito necesita— y muere al cerrarla. En
 * `localStorage` quedaría una credencial de acceso a una mesa ajena guardada
 * indefinidamente en un teléfono prestado.
 *
 * Y no perdemos nada: **la URL sigue siendo la fuente primaria**. Esto es un
 * respaldo para el tramo del alta. Si alguien reabre el link, el token vuelve a
 * entrar por `?t=`.
 *
 * ## Quién decide si el token sirve
 *
 * **El backend, siempre.** El TTL de acá es higiene local para no conservar una
 * credencial muerta, no una regla de contrato: un token dentro del TTL puede
 * estar perfectamente vencido y el 403 lo dirá.
 */

const KEY = 'payme_pending_invitation_link';

/**
 * 24 h. No se deriva de `invitation_expiry_seconds` de `/api/config` a
 * propósito: espejar ese número acá lo convertiría en una segunda fuente de
 * verdad sobre la vigencia, y la vigencia la decide el emisor. Es sólo un piso
 * para no guardar basura.
 */
const TTL_MS = 24 * 60 * 60 * 1000;

export interface PendingInvitationLink {
  /** Código de la mesa a la que pertenece el link (`#/mesa/:code`). */
  readonly code: string;
  /** El token crudo de `?t=`. Nunca se muestra ni se loguea. */
  readonly token: string;
  /** Epoch ms del guardado, para el TTL local. */
  readonly savedAt: number;
}

function store(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    // Safari en modo privado y algunos WebView tiran al TOCAR sessionStorage.
    // Sin respaldo el circuito sigue andando por la URL, que es la vía primaria.
    return null;
  }
}

export function rememberInvitationLink(code: string, token: string): void {
  if (!code || !token) return;
  try {
    store()?.setItem(KEY, JSON.stringify({ code, token, savedAt: Date.now() }));
  } catch {
    // Cuota llena o storage bloqueado: seguimos con la URL.
  }
}

export function readPendingInvitationLink(): PendingInvitationLink | null {
  let raw: string | null = null;
  try {
    raw = store()?.getItem(KEY) ?? null;
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { code, token, savedAt } = parsed as Record<string, unknown>;
    if (typeof code !== 'string' || !code) return null;
    if (typeof token !== 'string' || !token) return null;
    if (typeof savedAt !== 'number' || !Number.isFinite(savedAt)) return null;
    if (Date.now() - savedAt > TTL_MS) {
      clearPendingInvitationLink();
      return null;
    }
    return { code, token, savedAt };
  } catch {
    // Un valor corrupto no debe romper la app ni quedar dando vueltas.
    clearPendingInvitationLink();
    return null;
  }
}

export function clearPendingInvitationLink(): void {
  try {
    store()?.removeItem(KEY);
  } catch {
    // Nada que hacer; el TTL lo termina de limpiar.
  }
}

/**
 * Resuelve qué token corresponde canjear para una mesa, con la URL como fuente
 * primaria y el respaldo sólo para **esa misma mesa**.
 *
 * El chequeo de `code` importa: sin él, alguien que abre el link de la mesa A,
 * no se registra, y después navega a la mesa B, se inscribiría en A por un
 * respaldo que quedó colgado. El token nombra su mesa; el respaldo también.
 */
export function tokenForMesa(code: string, fromUrl: string | null): string | null {
  if (fromUrl) return fromUrl;
  const pending = readPendingInvitationLink();
  return pending && pending.code === code ? pending.token : null;
}
