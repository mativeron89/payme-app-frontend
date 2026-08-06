import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PendingInvitation } from '../types';

/**
 * INVITACIONES IN-APP: EL MOCK TIENE QUE MENTIR IGUAL QUE EL EMISOR — O SEA,
 * NO MENTIR.
 *
 * Auditoría 2026-08-06, medido en vivo: la tarjeta "Sumarme" de Avisos se
 * servía PARA SIEMPRE y el accept era incondicional — "Te sumaste a la mesa ✓"
 * sobre una invitación muerta, y aterrizaje en "Mesa liquidada". El emisor
 * hace las dos cosas bien: el GET filtra `expires_at > NOW()`
 * (`contract-mirror/routes/invitations.js:31-34`) y el accept contesta **410
 * invitation_expired** (`:69-74`). Éxito seguido de nada es la peor mentira
 * de un mock: no rompe ningún test y rompe la demo.
 */

function setupStorage() {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
    clear: () => m.clear(),
  });
}

async function cargar() {
  const mock = await import('./mockApi');
  const { state } = await import('./store');
  return { mock, state };
}

function invitacion(id: string, expiraEnMs: number): PendingInvitation {
  return {
    id,
    mesa_id: `mesa-${id}`,
    invitation_type: 'in_app',
    status: 'pending',
    expires_at: new Date(Date.now() + expiraEnMs).toISOString(),
    created_at: new Date(Date.now() - 60_000).toISOString(),
    mesa_code: 'PA-7777',
    restaurant_name: 'Prueba',
    inviter_first_name: 'Sofía',
    inviter_last_name: 'Fernández',
    inviter_payme_id: 'payme_mx_sofi',
  };
}

describe('invitaciones in-app · vencidas (espejo del emisor)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    setupStorage();
  });

  it('el GET no sirve una invitación vencida — la tarjeta "Sumarme" no existe', async () => {
    const { mock, state } = await cargar();
    state.pendingInvitations = [invitacion('viva', 60_000), invitacion('muerta', -60_000)];
    const r = await mock.mockPendingInvitations();
    expect(r.invitations.map((i) => i.id)).toEqual(['viva']);
  });

  it('aceptar una vencida contesta 410 invitation_expired, nunca "Te sumaste ✓"', async () => {
    const { mock, state } = await cargar();
    state.pendingInvitations = [invitacion('muerta', -60_000)];
    try {
      await mock.mockAcceptInvitation('muerta');
      expect.unreachable('el accept de una vencida no puede resolver');
    } catch (e) {
      if (!(e instanceof mock.MockApiError)) throw e;
      expect(e.status).toBe(410);
      expect(e.message).toBe('invitation_expired');
    }
    // Y como el emisor: la marca consumida — no queda pendiente para reintentar.
    expect(state.pendingInvitations).toEqual([]);
  });

  it('aceptar una viva ESCRIBE la participación: la mesa aparece en /mesas/open', async () => {
    // El no-op que esto mata: aceptar sólo borraba la pendiente, sin tocar
    // joinedMesaCodes — la mesa aceptada no aparecía en el Inicio de quien
    // aceptó. Es el síntoma de G-28, reproducido por el mock en otro riel.
    const { mock, state } = await cargar();
    const viva = state.mesas.find((m) => m.status === 'open' && !m.openedByUser)!;
    state.pendingInvitations = [{ ...invitacion('viva', 60_000), mesa_code: viva.code }];

    const antes = await mock.mockOpenMesas();
    expect(antes.mesas.map((m) => m.code)).not.toContain(viva.code);

    await mock.mockAcceptInvitation('viva');
    const despues = await mock.mockOpenMesas();
    expect(despues.mesas.map((m) => m.code)).toContain(viva.code);
  });

  it('la invitación del SEED no promete más vida que su mesa', async () => {
    const { state } = await cargar();
    const inv = state.pendingInvitations[0]!;
    const mesa = state.mesas.find((m) => m.code === inv.mesa_code)!;
    expect(inv.expires_at <= mesa.expires_at).toBe(true);
  });
});
