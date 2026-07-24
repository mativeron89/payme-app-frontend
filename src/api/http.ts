import { clearSession, loadSession, saveSession, type StoredSession } from './storage';
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

async function rawRequest<T>(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}/api${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new HttpError(res.status, await parseBody(res));
  return (await res.json()) as T;
}

/** Refresh con rotación: guarda el par nuevo de tokens antes de devolver. */
async function tryRefresh(session: StoredSession): Promise<StoredSession | null> {
  try {
    // El refresh devuelve SOLO tokens (sin `user` — decisión G-02 v2.20).
    const r = await rawRequest<TokenPair>('POST', '/auth/refresh', {
      refresh_token: session.refresh_token,
    });
    const updated: StoredSession = {
      access_token: r.access_token,
      refresh_token: r.refresh_token,
      user: session.user,
    };
    saveSession(updated);
    return updated;
  } catch {
    return null;
  }
}

/** Request PÚBLICA (sin sesión): hoy solo restaurantes (G-01, v2.21). */
export async function httpPublicRequest<T>(method: string, path: string): Promise<T> {
  return rawRequest<T>(method, path);
}

/** Request autenticada con retry-tras-refresh (una sola vez). */
export async function httpRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const session = loadSession();
  if (!session) throw new HttpError(401, { error: 'auth_required' });
  try {
    return await rawRequest<T>(method, path, body, session.access_token);
  } catch (err) {
    if (err instanceof HttpError && err.status === 401) {
      const refreshed = await tryRefresh(session);
      if (refreshed) return rawRequest<T>(method, path, body, refreshed.access_token);
      clearSession();
      onSessionExpiredCb?.();
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
  const res = await fetch(`${BASE_URL}/api${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new HttpError(res.status, await parseBody(res));
  return (await res.json()) as T;
}

export async function httpLogin(email: string, password: string): Promise<StoredSession> {
  const r = await rawRequest<LoginResponse>('POST', '/auth/login', { email, password });
  const session: StoredSession = {
    access_token: r.access_token,
    refresh_token: r.refresh_token,
    user: r.user,
  };
  saveSession(session);
  return session;
}

export async function httpRegister(data: RegisterRequest): Promise<StoredSession> {
  const r = await rawRequest<RegisterResponse>('POST', '/auth/register', data);
  const session: StoredSession = {
    access_token: r.access_token,
    refresh_token: r.refresh_token,
    user: r.user,
  };
  saveSession(session);
  return session;
}

export async function httpLogout(): Promise<void> {
  const session = loadSession();
  if (session) {
    try {
      await rawRequest('POST', '/auth/logout', undefined, session.access_token);
    } catch {
      // logout best-effort: la sesión local se limpia igual
    }
  }
  clearSession();
}
