import {
  httpLogin,
  httpLogout,
  httpRegister,
  httpRequest,
  setOnSessionExpired,
} from './http';
import {
  mockBalance,
  mockLogin,
  mockLogout,
  mockOpenMesasResponse,
  mockRegister,
} from './mock/mockApi';
import { clearSession, loadSession, type StoredSession } from './storage';
import type { BalanceResponse, OpenMesasResponse, RegisterRequest } from './types';

/**
 * Fachada única de datos (mismo patrón que el dashboard frontend): las
 * pantallas importan SOLO de acá. VITE_MOCK=1 elige el adaptador mock con
 * los mismos shapes; pasar a backend real no toca ninguna vista.
 */

export const IS_MOCK: boolean = import.meta.env.VITE_MOCK === '1';

export interface Api {
  login(email: string, password: string): Promise<StoredSession>;
  register(data: RegisterRequest): Promise<StoredSession>;
  logout(): Promise<void>;
  restoreSession(): StoredSession | null;
  onSessionExpired(cb: (() => void) | null): void;
  /** T1 — GET /api/account/balance. */
  getBalance(): Promise<BalanceResponse>;
  /** T1 — GET /api/mesas/open. */
  getOpenMesas(): Promise<OpenMesasResponse>;
}

const realApi: Api = {
  login: (email, password) => httpLogin(email, password),
  register: (data) => httpRegister(data),
  logout: () => httpLogout(),
  restoreSession: () => loadSession(),
  onSessionExpired: (cb) => setOnSessionExpired(cb),
  getBalance: () => httpRequest<BalanceResponse>('GET', '/account/balance'),
  getOpenMesas: () => httpRequest<OpenMesasResponse>('GET', '/mesas/open'),
};

const mockApi: Api = {
  login: (email, password) => mockLogin(email, password),
  register: (data) => mockRegister(data),
  async logout() {
    await mockLogout();
    clearSession();
  },
  restoreSession: () => loadSession(),
  onSessionExpired: () => undefined,
  getBalance: () => mockBalance(),
  getOpenMesas: () => mockOpenMesasResponse(),
};

export const api: Api = IS_MOCK ? mockApi : realApi;
