import { createSession, invalidateSession, isCurrentSession, loadSession, persistSessionTombstone, replaceCurrentSession, saveSession, SessionStorageInvalidationError, type StoredSession } from './storage';
import type { ApiError, LoginResponse, RegisterRequest, RegisterResponse, TokenPair } from './types';
import { MAX_AVATAR_OUTPUT_BYTES, validatePrivateAvatarBlob, type PrivateAvatarBlob } from './profileIdentity';

/**
 * Cliente HTTP real contra el app backend (contract-mirror/).
 * - Auth: `Authorization: Bearer <access_token>`.
 * - Refresh ROTATIVO (README_v2.5.2 §rotation): cada POST /auth/refresh
 *   devuelve un refresh_token NUEVO que reemplaza al anterior SIEMPRE.
 *   Reusar el viejo revoca la sesión (refresh_reuse_detected).
 * - Ante 401 en una request: un único intento de refresh + retry; si falla,
 *   se limpia la sesión y se avisa vía onSessionExpired.
 */

const BASE_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const SESSION_LOCK = 'payme-session-state';

let onSessionExpiredCb: (() => void) | null = null;
const refreshInFlight = new Map<string, Promise<StoredSession | null>>();

export function setOnSessionExpired(cb: (() => void) | null): void {
  onSessionExpiredCb = cb;
}

export class HttpError extends Error {
  readonly status: number;
  readonly body: ApiError | null;

  constructor(status: number, body: ApiError | null) {
    super(body?.error ?? `http_${status}`);
    this.status = status;
    this.body = body;
  }
}

async function withSessionLock<T>(action: () => Promise<T> | T): Promise<T | null> {
  const locks = globalThis.navigator?.locks;
  if (!locks) return null;
  return locks.request(SESSION_LOCK, { mode: 'exclusive' }, action);
}

/**
 * Marca la familia antes de esperar el lock y después ejecuta el CAS físico.
 * Si el primer journal falla, `invalidateSession` conserva el marcador volátil,
 * intenta la limpieza física y recién entonces propaga el fallo de storage.
 */
async function invalidateSessionSerialized(session: StoredSession): Promise<boolean> {
  try {
    persistSessionTombstone(session);
  } catch {
    // No se abandona la limpieza física por un fallo del journal.
  }
  const locked = await withSessionLock(() => invalidateSession(session));
  return locked ?? invalidateSession(session);
}

async function parseBody(res: Response): Promise<ApiError | null> {
  try {
    return (await res.json()) as ApiError;
  } catch {
    return null;
  }
}

/**
 * B-06: sin timeout, "se perdió la respuesta" es un fetch colgado minutos —
 * el usuario mira una pantalla muerta y termina recargando o reintentando a
 * ciegas. 30s es holgado para un pago con Stripe de por medio; lo que se gana
 * es convertir el cuelgue en un error manejable (y la clave de idempotencia
 * se conserva, así que el reintento cae en el replay del backend).
 */
const REQUEST_TIMEOUT_MS = 30_000;
export const OCR_TIMEOUT_MS = 60_000;

/** Bytes observados por el navegador durante el multipart exclusivo del OCR. */
export interface UploadProgress {
  loadedBytes: number;
  /** `null` significa que el navegador no pudo computar el largo total. */
  totalBytes: number | null;
}

export type UploadProgressListener = (progress: UploadProgress) => void;

type SuccessReader<T> = (response: Response) => Promise<T>;

async function rawRequestAs<T>(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
  timeoutMs = REQUEST_TIMEOUT_MS,
  readSuccess: SuccessReader<T> = async (response) => (await response.json()) as T,
  extraHeaders: Readonly<Record<string, string>> = {},
  cache?: RequestCache,
): Promise<T> {
  const headers: Record<string, string> = { ...extraHeaders };
  if (body !== undefined && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE_URL}/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
      signal: ctrl.signal,
      ...(cache && { cache }),
    });
    // El body puede colgar después de recibir headers: conservar el timer
    // hasta json() evita dejar un journal monetario en sending eterno.
    if (!res.ok) throw new HttpError(res.status, await parseBody(res));
    return await readSuccess(res);
  } finally {
    clearTimeout(timer);
  }
}

async function rawRequest<T>(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<T> {
  return rawRequestAs<T>(method, path, body, token, timeoutMs);
}

/**
 * Transporte multipart exclusivo de `POST /api/ocr`.
 *
 * No amplía ni reemplaza `rawRequestAs`: creación de mesa, pagos, refunds y
 * toda otra mutación conservan `fetch`. XHR existe acá únicamente porque el
 * navegador no publica progreso de subida mediante fetch.
 */
function rawOcrUploadRequest<T>(
  body: FormData,
  token: string,
  onProgress?: UploadProgressListener,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE_URL}/api/ocr`);
    xhr.responseType = 'json';
    xhr.timeout = OCR_TIMEOUT_MS;
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    // Cada retry por refresh empieza sin total conocido. Así un 401 después de
    // haber subido parte del body no deja pintado el porcentaje del intento viejo.
    onProgress?.({ loadedBytes: 0, totalBytes: null });
    xhr.upload.onprogress = (event) => {
      const loaded = Number.isFinite(event.loaded) && event.loaded >= 0 ? event.loaded : 0;
      const total = event.lengthComputable && Number.isFinite(event.total) && event.total > 0
        ? event.total
        : null;
      onProgress?.({
        loadedBytes: total === null ? loaded : Math.min(loaded, total),
        totalBytes: total,
      });
    };

    xhr.onload = () => {
      const ok = xhr.status >= 200 && xhr.status < 300;
      if (!ok) {
        // Igual que `parseBody(fetch)`: JSON válido se conserva para que
        // HttpError/extractApiError vean el código; JSON inválido queda null.
        const bodyError = xhr.response === null ? null : xhr.response as ApiError;
        reject(new HttpError(xhr.status, bodyError));
        return;
      }
      resolve(xhr.response as T);
    };
    xhr.onerror = () => reject(new TypeError('network_error'));
    const abort = () => reject(new DOMException('aborted', 'AbortError'));
    xhr.onabort = abort;
    // Conserva la misma clase observable que el AbortController del riel fetch.
    xhr.ontimeout = abort;
    xhr.send(body);
  });
}

/** Refresh con rotación: guarda el par nuevo de tokens antes de devolver. */
async function tryRefresh(session: StoredSession): Promise<StoredSession | null> {
  if (!isCurrentSession(session)) {
    const current = loadSession();
    // R1 pudo rotar antes de que R2 procese su 401: reutilizar SOLO la misma
    // familia/principal evita un refresh viejo y permite un único retry.
    return current && current.family_id === session.family_id && current.principal_id === session.principal_id
      ? current
      : null;
  }
  const existing = refreshInFlight.get(session.family_id);
  if (existing) return existing;
  const run = async () => {
    if (!isCurrentSession(session)) return null;
    return withSessionLock(async () => {
      const current = loadSession();
      if (!current || current.family_id !== session.family_id || current.principal_id !== session.principal_id) return null;
      if (current.refresh_token !== session.refresh_token) return current;
      try {
        // El refresh devuelve SOLO tokens (sin `user` — decisión G-02 v2.20).
        const r = await rawRequest<TokenPair>('POST', '/auth/refresh', {
          refresh_token: session.refresh_token,
        });
        const updated: StoredSession = {
          access_token: r.access_token,
          refresh_token: r.refresh_token,
          user: session.user,
          family_id: session.family_id,
          principal_id: session.principal_id,
        };
        return replaceCurrentSession(session, updated) ? updated : null;
      } catch {
        return null;
      }
    });
  };
  const pending = run().finally(() => refreshInFlight.delete(session.family_id));
  refreshInFlight.set(session.family_id, pending);
  return pending;
}

/** Request PÚBLICA (sin sesión): hoy solo restaurantes (G-01, v2.21). */
export async function httpPublicRequest<T>(method: string, path: string): Promise<T> {
  return rawRequest<T>(method, path);
}

async function authenticatedRequest<T>(
  expectedSession: StoredSession | undefined,
  run: (session: StoredSession) => Promise<T>,
): Promise<T> {
  const session = expectedSession ?? loadSession();
  if (!session || !isCurrentSession(session)) throw new HttpError(401, { error: 'auth_required' });
  try {
    return await run(session);
  } catch (err) {
    if (err instanceof HttpError && err.status === 401) {
      const refreshed = await tryRefresh(session);
      if (refreshed && refreshed.family_id === session.family_id && refreshed.principal_id === session.principal_id && isCurrentSession(refreshed)) {
        return run(refreshed);
      }
      // El tombstone se escribe antes de esperar el lock. Así un refresh de
      // otra pestaña que ya está en red no puede restaurar esta familia.
      let invalidatedCurrent = false;
      try {
        invalidatedCurrent = await invalidateSessionSerialized(session);
      } catch {
        // persistSessionTombstone conserva un marcador fail-closed en memoria.
      }
      if (invalidatedCurrent) onSessionExpiredCb?.();
    }
    throw err;
  }
}

/** Request autenticada con retry-tras-refresh (una sola vez). */
export async function httpRequest<T>(
  method: string,
  path: string,
  body?: unknown,
  expectedSession?: StoredSession,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<T> {
  return authenticatedRequest(expectedSession, (session) => (
    rawRequest<T>(method, path, body, session.access_token, timeoutMs)
  ));
}

/**
 * Upload autenticado del ticket, con el mismo refresh rotativo y la misma
 * invalidación de sesión que `httpRequest`, pero sin tocar su transporte.
 */
export async function httpOcrUploadRequest<T>(
  body: FormData,
  onProgress?: UploadProgressListener,
): Promise<T> {
  return authenticatedRequest(undefined, (session) => (
    rawOcrUploadRequest<T>(body, session.access_token, onProgress)
  ));
}

/** JSON autenticado con headers contractuales extra (p. ej. If-Match). */
export async function httpRequestWithHeaders<T>(
  method: string,
  path: string,
  body: unknown,
  headers: Readonly<Record<string, string>>,
  expectedSession: StoredSession,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<T> {
  return authenticatedRequest(expectedSession, (session) => rawRequestAs<T>(
    method, path, body, session.access_token, timeoutMs,
    async (response) => (await response.json()) as T,
    headers,
  ));
}

/** DELETE privado cuyo contrato exitoso es exactamente 204 sin body. */
export async function httpNoContentRequest(
  method: 'DELETE',
  path: string,
  headers: Readonly<Record<string, string>>,
  expectedSession: StoredSession,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<void> {
  return authenticatedRequest(expectedSession, (session) => rawRequestAs<void>(
    method, path, undefined, session.access_token, timeoutMs,
    async (response) => {
      if (response.status !== 204) throw new Error('no_content_response_malformed');
    },
    headers,
  ));
}

/**
 * Bytes privados del avatar. El bearer viaja por el mismo transporte que el
 * JSON, con refresh único; `cache:no-store` se exige en request y response.
 */
export async function httpPrivateAvatarRequest(
  path: string,
  expectedSession: StoredSession,
  timeoutMs = 15_000,
): Promise<PrivateAvatarBlob> {
  return authenticatedRequest(expectedSession, (session) => rawRequestAs<PrivateAvatarBlob>(
    'GET', path, undefined, session.access_token, timeoutMs,
    async (response) => {
      const cacheControl = response.headers.get('cache-control')?.toLowerCase() ?? '';
      if (!cacheControl.split(',').map((part) => part.trim()).includes('private')
          || !cacheControl.split(',').map((part) => part.trim()).includes('no-store')) {
        throw new Error('avatar_response_cache_policy_invalid');
      }
      const contentLength = response.headers.get('content-length');
      if (contentLength === null || !/^\d+$/.test(contentLength)
          || Number(contentLength) < 1 || Number(contentLength) > MAX_AVATAR_OUTPUT_BYTES) {
        throw new Error('avatar_response_size_invalid');
      }
      const blob = response.headers.get('content-type')?.toLowerCase() === 'image/jpeg'
        ? await response.blob()
        : (() => { throw new Error('avatar_response_media_type_invalid'); })();
      if (blob.size !== Number(contentLength)) throw new Error('avatar_response_size_invalid');
      return validatePrivateAvatarBlob(blob);
    },
    { Accept: 'image/jpeg' },
    'no-store',
  ));
}

/** JSON privado: no se admite que navegador/CDN lo cachee como respuesta común. */
export async function httpPrivateJsonRequest<T>(
  path: string,
  expectedSession?: StoredSession,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<T> {
  return authenticatedRequest(expectedSession, (session) => rawRequestAs<T>(
    'GET', path, undefined, session.access_token, timeoutMs,
    async (response) => {
      const cacheControl = response.headers.get('cache-control')?.toLowerCase() ?? '';
      const tokens = cacheControl.split(',').map((part) => part.trim());
      if (!tokens.includes('private') || !tokens.includes('no-store')) {
        throw new Error('private_json_cache_policy_invalid');
      }
      if (response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
        throw new Error('private_json_media_type_invalid');
      }
      return (await response.json()) as T;
    },
    { Accept: 'application/json' },
    'no-store',
  ));
}

/**
 * Request de INVITADO (sin login): el guest token va en el header
 * X-Guest-Token (middleware/auth.js → guestOrAuth acepta ?t= o ese header).
 */
export async function httpGuestRequest<T>(
  method: string,
  path: string,
  guestToken: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = { 'X-Guest-Token': guestToken };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  // B-06: el invitado también paga por acá. Sin timeout, un pago colgado deja
  // la pantalla muerta y empuja al reintento a ciegas — el mismo agujero.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}/api${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    if (!res.ok) throw new HttpError(res.status, await parseBody(res));
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function httpLogin(email: string, password: string): Promise<StoredSession> {
  const r = await rawRequest<LoginResponse>('POST', '/auth/login', { email, password });
  const session = createSession({
    access_token: r.access_token,
    refresh_token: r.refresh_token,
    user: r.user,
  });
  // La UI y httpRequest leen la misma fuente. No se publica una sesión que
  // localStorage no pudo confirmar con round-trip.
  const saved = await withSessionLock(() => saveSession(session));
  // En un navegador sin Web Locks no existe refresh concurrente (tryRefresh
  // falla cerrado) y logout deja el tombstone sin borrar a ciegas. Persistir
  // el login explícito sigue siendo seguro y evita bloquear navegadores viejos.
  if (saved === null) saveSession(session);
  return session;
}

export async function httpRegister(data: RegisterRequest): Promise<StoredSession> {
  const r = await rawRequest<RegisterResponse>('POST', '/auth/register', data);
  const session = createSession({
    access_token: r.access_token,
    refresh_token: r.refresh_token,
    user: r.user,
  });
  const saved = await withSessionLock(() => saveSession(session));
  if (saved === null) saveSession(session);
  return session;
}

export async function httpLogout(): Promise<void> {
  const session = loadSession();
  // Cerrar la UI no espera la red: un logout colgado no puede dejar a la
  // persona firmando operaciones 30s más. El bearer capturado se revoca en
  // background y nunca se lee una sesión nueva para esa llamada.
  if (!session) return;
  // El resultado se captura desde el inicio para que un rechazo temprano no
  // quede sin handler. Normalmente la limpieza local permite continuar sin
  // esperar la red; si storage falla por completo, esta revocación pasa a ser
  // la única invalidación durable disponible y deja de ser fire-and-forget.
  const remoteRevoked = rawRequest<{ revoked?: unknown }>('POST', '/auth/logout', undefined, session.access_token, 3_000).then(
    (result) => result?.revoked === true,
    () => false,
  );
  // Invalidación durable inmediata; la limpieza física se serializa con el
  // mismo lock que refresh/login. Si apareció otra familia, no se borra.
  try {
    await invalidateSessionSerialized(session);
  } catch (storageError) {
    // Si el bearer físico ya desapareció, se conserva el contrato previo: el
    // fallo del journal se informa de inmediato y la red sigue en background.
    if (storageError instanceof SessionStorageInvalidationError && storageError.physicalSessionRemoved) {
      throw storageError;
    }
    if (await remoteRevoked) return;
    throw storageError;
  }
}
