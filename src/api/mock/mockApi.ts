import { centsToDisplay } from '../../utils/money';
import { saveSession, type StoredSession } from '../storage';
import type { BalanceResponse, OpenMesasResponse } from '../types';
import { MOCK_BALANCE_CENTS, MOCK_USER, mockOpenMesas } from './seedData';

/**
 * Adaptador mock (VITE_MOCK=1): replica los shapes reales del contrato con
 * una latencia chica para que la UI se sienta como con red. El mock conoce
 * al usuario en login (hace de "DB"), cosa que el backend real NO devuelve
 * en login (G-02) — el shape de sesión es el mismo, solo cambia si `user`
 * viene poblado.
 */

const LATENCY_MS = 350;

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), LATENCY_MS));
}

export async function mockLogin(email: string, _password: string): Promise<StoredSession> {
  const session: StoredSession = {
    access_token: 'mock-access-token',
    refresh_token: 'mock-refresh-token',
    user: { ...MOCK_USER, email: email || MOCK_USER.email },
  };
  saveSession(session);
  return delay(session);
}

export async function mockRegister(data: {
  email: string;
  first_name: string;
  last_name: string;
}): Promise<StoredSession> {
  const session: StoredSession = {
    access_token: 'mock-access-token',
    refresh_token: 'mock-refresh-token',
    user: {
      ...MOCK_USER,
      email: data.email,
      first_name: data.first_name,
      last_name: data.last_name,
    },
  };
  saveSession(session);
  return delay(session);
}

export async function mockLogout(): Promise<void> {
  return delay(undefined);
}

export async function mockBalance(): Promise<BalanceResponse> {
  return delay({
    balance_cents: MOCK_BALANCE_CENTS,
    balance_display: centsToDisplay(MOCK_BALANCE_CENTS),
    clabe: null,
    currency: 'mxn',
  });
}

export async function mockOpenMesasResponse(): Promise<OpenMesasResponse> {
  return delay({ mesas: mockOpenMesas(new Date()) });
}
