import { createElement, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from '../../src/api';
import {
  loadSession,
  replaceCurrentSession,
  saveSession,
  subscribeSession,
  type StoredSession,
} from '../../src/api/storage';
import { ShortfallDisclosure } from '../../src/components/ShortfallDisclosure';

const PRINCIPAL = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORIGIN: StoredSession = {
  access_token: 'a1',
  refresh_token: 'r1',
  family_id: 'family-shortfall-refresh',
  principal_id: PRINCIPAL,
};

type HarnessWindow = Window & {
  __shortfallRefreshRequests?: () => number;
  __shortfallRefreshUnmount?: () => void;
};

function CurrentSessionDisclosure() {
  const [session, setSession] = useState<StoredSession>(() => loadSession() ?? ORIGIN);
  useEffect(() => subscribeSession(() => {
    const current = loadSession();
    if (current) setSession(current);
  }), []);
  return createElement(ShortfallDisclosure, {
    session,
    disclosure: { mesaCode: 'PA-12345', shortfallCents: 21000 },
  });
}

/** Harness de navegador: no entra al bundle ni habilita la capability real. */
export function mountShortfallRefreshHarness(): void {
  saveSession(ORIGIN);
  const host = document.createElement('div');
  host.id = 'shortfall-refresh-harness';
  document.body.replaceChildren(host);

  let requests = 0;
  const original = api.getShortfallDetail;
  api.getShortfallDetail = async (_mesaCode, _expectedShortfallCents, expectedSession) => {
    requests += 1;
    const rotated = { ...expectedSession, access_token: 'a2', refresh_token: 'r2' };
    if (!replaceCurrentSession(expectedSession, rotated)) throw new Error('refresh_fixture_cas_failed');
    // Da tiempo a que la suscripción propague los tokens nuevos al componente.
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return {
      version: 1,
      detail_available: true,
      closed_at: '2026-08-25T01:02:03.004Z',
      shortfall_cents: 21000,
      unassigned_cents: 8000,
      rows: [{ display_name: 'Luis Cárdenas', due_cents: 13000 }],
    };
  };

  const root = createRoot(host);
  root.render(createElement(CurrentSessionDisclosure));
  const target = window as HarnessWindow;
  target.__shortfallRefreshRequests = () => requests;
  target.__shortfallRefreshUnmount = () => {
    root.unmount();
    api.getShortfallDetail = original;
    delete target.__shortfallRefreshRequests;
    delete target.__shortfallRefreshUnmount;
  };
}
