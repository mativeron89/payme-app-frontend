/**
 * D-FF-1 · custodia de la autoridad para CREAR una cuenta en la cohorte.
 *
 * No es el token `?t=` de una mesa. Aquél autoriza a canjear una invitación
 * multiuso DESPUÉS del alta; éste es one-use, está ligado a un email y sólo
 * autoriza el alta. Comparten pestaña, nunca clave, query ni ciclo de vida.
 */

export const SIGNUP_INVITATION_QUERY_PARAM = 'signup_invitation';
export const SIGNUP_INVITATION_STORAGE_KEY = import.meta.env.VITE_MOCK === '1'
  ? 'payme.app.mock.ff_signup_invitation.v1'
  : 'payme.app.real.ff_signup_invitation.v1';

const STORAGE_VERSION = 1;

export type SignupInvitationLocation =
  | { status: 'absent' }
  | { status: 'invalid' }
  | { status: 'valid'; token: string };

export type SignupInvitationCapture =
  | { status: 'absent' | 'invalid' }
  | { status: 'available'; token: string; custodied: boolean };

let activeSnapshot: SignupInvitationCapture = { status: 'absent' };
const snapshotListeners = new Set<() => void>();

function validToken(value: unknown): value is string {
  // Mismos límites que la autoridad owner. La vigencia y el email los decide
  // exclusivamente el backend; el front no intenta interpretar el raw.
  return typeof value === 'string' && value.length >= 20 && value.length <= 200;
}

function hashParams(hash: string): URLSearchParams {
  const index = hash.indexOf('?');
  return new URLSearchParams(index >= 0 ? hash.slice(index + 1) : '');
}

/**
 * Una sola fuente inequívoca. Si la URL trae dos valores —aunque coincidan—
 * no elegimos por orden: un proxy o redirect no debe cambiar qué autoridad se
 * manda al owner. Y una URL inválida NO cae al respaldo viejo de otra visita.
 */
export function signupInvitationFromLocation(search: string, hash: string): SignupInvitationLocation {
  // La autoridad canónica vive EXCLUSIVAMENTE en el fragmento: el navegador no
  // lo manda al hosting ni como Referer HTTP. Aceptarla en `location.search`
  // haría que el primer request la deje en logs antes de que JS pueda limpiar.
  if (new URLSearchParams(search).has(SIGNUP_INVITATION_QUERY_PARAM)) {
    return { status: 'invalid' };
  }
  const values = hashParams(hash).getAll(SIGNUP_INVITATION_QUERY_PARAM);
  if (values.length === 0) return { status: 'absent' };
  if (values.length !== 1 || !validToken(values[0])) return { status: 'invalid' };
  return { status: 'valid', token: values[0] };
}

function storage(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

function removeStored(): void {
  try {
    storage()?.removeItem(SIGNUP_INVITATION_STORAGE_KEY);
  } catch {
    // Si sessionStorage está bloqueado, la URL sigue siendo la fuente primaria.
  }
}

/** Un shape inválido se elimina físicamente; devolver null no es descartarlo. */
export function readPendingSignupInvitation(): string | null {
  let raw: string | null = null;
  try {
    raw = storage()?.getItem(SIGNUP_INVITATION_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('shape');
    const record = value as Record<string, unknown>;
    if (Object.keys(record).length !== 2
        || record.v !== STORAGE_VERSION
        || !validToken(record.token)) throw new Error('shape');
    return record.token;
  } catch {
    removeStored();
    return null;
  }
}

function remember(token: string): boolean {
  if (!validToken(token)) return false;
  const raw = JSON.stringify({ v: STORAGE_VERSION, token });
  try {
    storage()?.setItem(SIGNUP_INVITATION_STORAGE_KEY, raw);
  } catch {
    // Si había una autoridad A, no puede quedar como fallback de la B que la
    // persona acaba de abrir. B sigue en URL; A se descarta best-effort.
    removeStored();
    return false;
  }
  const confirmed = readPendingSignupInvitation() === token;
  if (!confirmed) removeStored();
  return confirmed;
}

function cleanHash(hash: string): string {
  const index = hash.indexOf('?');
  if (index < 0) return hash;
  const params = new URLSearchParams(hash.slice(index + 1));
  params.delete(SIGNUP_INVITATION_QUERY_PARAM);
  const rest = params.toString();
  return `${hash.slice(0, index)}${rest ? `?${rest}` : ''}`;
}

/** Retira sólo signup_invitation y conserva `t`, `r` y cualquier otro dueño. */
function stripFromUrl(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const search = new URLSearchParams(window.location.search);
    const direct = search.has(SIGNUP_INVITATION_QUERY_PARAM);
    const hashHas = hashParams(window.location.hash).has(SIGNUP_INVITATION_QUERY_PARAM);
    if (!direct && !hashHas) return false;
    search.delete(SIGNUP_INVITATION_QUERY_PARAM);
    const nextSearch = search.toString();
    const nextHash = cleanHash(window.location.hash);
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${nextHash}`,
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Captura URL→sessionStorage y sólo limpia la URL si verificó round-trip.
 * La función devuelve el raw para que el formulario pueda continuar incluso
 * en Safari privado/WebViews sin storage; nunca lo muestra ni lo registra.
 */
export function captureSignupInvitation(): SignupInvitationCapture {
  if (typeof window === 'undefined') {
    const stored = readPendingSignupInvitation();
    return stored
      ? { status: 'available', token: stored, custodied: true }
      : { status: 'absent' };
  }
  const fromUrl = signupInvitationFromLocation(window.location.search, window.location.hash);
  if (fromUrl.status === 'invalid') {
    // No permitir que un token válido viejo reaparezca después de una URL
    // explícitamente inválida. También se retira el raw directo por higiene,
    // aunque ya haya alcanzado al hosting y por eso nunca se lo acepta.
    removeStored();
    stripFromUrl();
    return fromUrl;
  }
  if (fromUrl.status === 'absent') {
    const stored = readPendingSignupInvitation();
    return stored
      ? { status: 'available', token: stored, custodied: true }
      : fromUrl;
  }
  const custodied = remember(fromUrl.token);
  if (custodied) stripFromUrl();
  return { status: 'available', token: fromUrl.token, custodied };
}

/** Lectura sin mutación para decidir si la superficie de registro existe. */
export function currentSignupInvitation(): string | null {
  if (typeof window !== 'undefined') {
    const fromUrl = signupInvitationFromLocation(window.location.search, window.location.hash);
    if (fromUrl.status === 'valid') return fromUrl.token;
    if (fromUrl.status === 'invalid') return null;
  }
  return readPendingSignupInvitation();
}

function publishSnapshot(next: SignupInvitationCapture): void {
  activeSnapshot = next;
  snapshotListeners.forEach((listener) => listener());
}

/** Snapshot para `useSyncExternalStore`; nunca se usa el raw como key/DOM. */
export function signupInvitationSnapshot(): SignupInvitationCapture {
  return activeSnapshot;
}

export function subscribeSignupInvitation(listener: () => void): () => void {
  snapshotListeners.add(listener);
  return () => snapshotListeners.delete(listener);
}

/**
 * Se llama ANTES de montar React. Así también una sesión ya autenticada limpia
 * el raw antes del primer frame; luego el listener se registra antes que el
 * router y captura cada navegación de la misma pestaña.
 */
export function bootstrapSignupInvitationCustody(): () => void {
  publishSnapshot(captureSignupInvitation());
  if (typeof window === 'undefined') return () => undefined;
  const onHashChange = () => publishSnapshot(captureSignupInvitation());
  window.addEventListener('hashchange', onHashChange);
  return () => window.removeEventListener('hashchange', onHashChange);
}

/** Sólo después de un alta 201: suelta storage y cualquier copia en URL. */
export function clearSignupInvitation(): void {
  removeStored();
  stripFromUrl();
  publishSnapshot({ status: 'absent' });
}
