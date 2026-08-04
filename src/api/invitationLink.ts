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

/**
 * Guarda la credencial **y comprueba el round-trip**, devolviendo si quedó
 * realmente custodiada.
 *
 * El booleano no es cosmético: es lo que decide si se puede retirar el token de
 * la URL. `setItem` puede no tirar y aun así no persistir —cuota, modo privado,
 * un WebView con storage particionado—, y en ese caso la URL es la ÚNICA
 * custodia que queda. Retirarla ahí sería pérdida silenciosa del token: la
 * persona se registra y queda afuera de la mesa a la que la invitaron.
 *
 * Por eso se lee de vuelta y se compara, en vez de confiar en que no hubo
 * excepción. Escribir y ver la escritura son cosas distintas.
 */
export function rememberInvitationLink(code: string, token: string): boolean {
  if (!code || !token) return false;
  try {
    store()?.setItem(KEY, JSON.stringify({ code, token, savedAt: Date.now() }));
  } catch {
    return false;
  }
  const leido = readPendingInvitationLink();
  return leido?.code === code && leido.token === token;
}

/**
 * Retira **sólo** el token del hash actual, sin agregar historial.
 *
 * ## Por qué `replaceState` y no `navigate`
 *
 * `navigate` asigna `window.location.hash`, y eso **crea una entrada nueva**
 * dejando viva la anterior con el `?t=`. El botón Atrás la recupera, `useRoute`
 * la parsea y la app vuelve a custodiar un token que ya se había soltado.
 * **Back no debe revivir el token.** `replaceState` reemplaza la entrada actual,
 * así que ninguna entrada del historial lo conserva.
 *
 * ## Qué se preserva
 *
 * Sólo se borra `t`. El resto de los parámetros son legítimos y tienen dueño
 * —`r` es el uuid del restaurante del QR (G-01)— y llevárselos puestos rompería
 * otro flujo para arreglar éste.
 *
 * Devuelve `true` si el token estaba y se retiró.
 */
export function stripTokenFromUrl(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const hash = window.location.hash;
    const i = hash.indexOf('?');
    if (i < 0) return false;
    const params = new URLSearchParams(hash.slice(i + 1));
    if (!params.has('t')) return false;
    params.delete('t');
    const resto = params.toString();
    const limpio = `${hash.slice(0, i)}${resto ? `?${resto}` : ''}`;
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${window.location.search}${limpio}`,
    );
    return true;
  } catch {
    // Un navegador que no deja tocar el historial no puede romper el canje.
    return false;
  }
}

/** Borra la fila y devuelve `null`. Una credencial que no valida se ELIMINA. */
function descartar(): null {
  clearPendingInvitationLink();
  return null;
}

export function readPendingInvitationLink(): PendingInvitationLink | null {
  let raw: string | null = null;
  try {
    raw = store()?.getItem(KEY) ?? null;
  } catch {
    return null;
  }
  if (!raw) return null;
  // ⚠️ TODA salida sin dato BORRA la fila. Antes, un shape inválido devolvía
  // `null` y **la fila quedaba**: una credencial que la app ya no puede usar
  // sobreviviendo en el storage del dispositivo, sin TTL que la alcance si el
  // `savedAt` es el campo roto. Devolver null no es descartar; descartar es
  // borrar.
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return descartar();
    const { code, token, savedAt } = parsed as Record<string, unknown>;
    if (typeof code !== 'string' || !code) return descartar();
    if (typeof token !== 'string' || !token) return descartar();
    if (typeof savedAt !== 'number' || !Number.isFinite(savedAt)) return descartar();
    if (Date.now() - savedAt > TTL_MS) return descartar();
    return { code, token, savedAt };
  } catch {
    return descartar();
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
