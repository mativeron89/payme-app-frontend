import { clearCurrentSession, createSession, isCurrentSession, loadSession, replaceCurrentSession, saveSession, type StoredSession } from './storage';
import type { ApiError, LoginResponse, RegisterRequest, RegisterResponse, TokenPair } from './types';

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

async function rawRequest<T>(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<T> {
  const headers: Record<string, string> = {};
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
    });
    // El body puede colgar después de recibir headers: conservar el timer
    // hasta json() evita dejar un journal monetario en sending eterno.
    if (!res.ok) throw new HttpError(res.status, await parseBody(res));
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
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
    const lock = globalThis.navigator?.locks;
    if (!lock) return null;
    return lock.request(`payme-refresh-${session.family_id}`, { mode: 'exclusive' }, async () => {
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

/** Request autenticada con retry-tras-refresh (una sola vez). */
export async function httpRequest<T>(
  method: string,
  path: string,
  body?: unknown,
  expectedSession?: StoredSession,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<T> {
  const session = expectedSession ?? loadSession();
  if (!session || !isCurrentSession(session)) throw new HttpError(401, { error: 'auth_required' });
  try {
    return await rawRequest<T>(method, path, body, session.access_token, timeoutMs);
  } catch (err) {
    if (err instanceof HttpError && err.status === 401) {
      const refreshed = await tryRefresh(session);
      if (refreshed && refreshed.family_id === session.family_id && refreshed.principal_id === session.principal_id && isCurrentSession(refreshed)) {
        return rawRequest<T>(method, path, body, refreshed.access_token, timeoutMs);
      }
      if (clearCurrentSession(session)) onSessionExpiredCb?.();
    }
    throw err;
  }
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
  saveSession(session);
  return session;
}

export async function httpRegister(data: RegisterRequest): Promise<StoredSession> {
  const r = await rawRequest<RegisterResponse>('POST', '/auth/register', data);
  const session = createSession({
    access_token: r.access_token,
    refresh_token: r.refresh_token,
    user: r.user,
  });
  saveSession(session);
  return session;
}

export async function httpLogout(): Promise<void> {
  const session = loadSession();
  // Cerrar la UI no espera la red: un logout colgado no puede dejar a la
  // persona firmando operaciones 30s más. El bearer capturado se revoca en
  // background y nunca se lee una sesión nueva para esa llamada.
  if (!session || !clearCurrentSession(session)) return;
  void rawRequest('POST', '/auth/logout', undefined, session.access_token, 3_000).catch(() => undefined);
}
