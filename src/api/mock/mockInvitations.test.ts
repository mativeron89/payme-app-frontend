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
    // v2.45.0 · foto del seed; el GET los re-computa en vivo.
    mesa_joinable: true,
    mesa_status: 'open',
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

  it('mesa muerta → 410 mesa_not_joinable con su estado, y la invitación QUEDA pendiente', async () => {
    // v2.45.0: la invitación viva no alcanza — la MESA tiene que estar viva.
    // Y a diferencia del vencimiento, acá la pendiente NO se consume: la mesa
    // no revive, la invitación vence sola (semántica del emisor, textual).
    const { mock, state } = await cargar();
    const muerta = state.mesas.find((m) => m.status === 'completed')!;
    state.pendingInvitations = [{ ...invitacion('a-mesa-muerta', 60_000), mesa_code: muerta.code }];
    try {
      await mock.mockAcceptInvitation('a-mesa-muerta');
      expect.unreachable('aceptar hacia una mesa muerta no puede resolver');
    } catch (e) {
      if (!(e instanceof mock.MockApiError)) throw e;
      expect(e.status).toBe(410);
      expect(e.message).toBe('mesa_not_joinable');
      expect(e.extra.mesa_status).toBe('completed');
    }
    expect(state.pendingInvitations).toHaveLength(1);
    expect(state.joinedMesaCodes).not.toContain(muerta.code);
  });

  it('🔴 PUERTA B en POSITIVO: fully_paid está VIVA y el accept ADMITE', async () => {
    // Decisión B ratificada: pagada entera pero aún no cerrada admite gente.
    // Es la mesa que un espejo apurado apaga por parecerse a "ya no hay nada
    // que hacer acá" — por eso se afirma que ENTRA, no sólo que otras no.
    const { mock, state } = await cargar();
    const mesa = state.mesas.find((m) => m.status === 'open' && !m.openedByUser)!;
    mesa.status = 'fully_paid';
    state.pendingInvitations = [{ ...invitacion('a-fully-paid', 60_000), mesa_code: mesa.code }];
    const r = await mock.mockAcceptInvitation('a-fully-paid');
    expect(r.accepted).toBe(true);
    expect(state.joinedMesaCodes).toContain(mesa.code);
  });

  it('accept-link: mismo gate — 410 con mesa muerta, y fully_paid canjea', async () => {
    // Decisión C: una sola regla, dos puertas. El 403 opaco sigue PRIMERO
    // (token basura no revela nada); el 410 sólo llega con token válido.
    const { mock, state } = await cargar();
    // El canje exige sesión (401 sin ella) — el gate corre DESPUÉS de auth.
    await mock.mockLogin('prueba@demo.mx', 'x');
    const mesa = state.mesas.find((m) => m.status === 'open' && !m.openedByUser)!;
    state.linkTokens['token-de-prueba-valido'] = mesa.code;

    mesa.status = 'settled';
    try {
      await mock.mockAcceptInvitationLink('token-de-prueba-valido');
      expect.unreachable('canjear hacia una mesa muerta no puede resolver');
    } catch (e) {
      if (!(e instanceof mock.MockApiError)) throw e;
      expect(e.status).toBe(410);
      expect(e.message).toBe('mesa_not_joinable');
      expect(e.extra.mesa_status).toBe('settled');
    }

    mesa.status = 'fully_paid';
    const r = await mock.mockAcceptInvitationLink('token-de-prueba-valido');
    expect(r.joined).toBe(true);
  });

  it('el GET MARCA, no filtra: la invitación de mesa muerta viene con mesa_joinable false', async () => {
    const { mock, state } = await cargar();
    const muerta = state.mesas.find((m) => m.status === 'completed')!;
    const viva = state.mesas.find((m) => m.status === 'open' && !m.openedByUser)!;
    state.pendingInvitations = [
      { ...invitacion('hacia-muerta', 60_000), mesa_code: muerta.code },
      { ...invitacion('hacia-viva', 60_000), mesa_code: viva.code },
    ];
    const r = await mock.mockPendingInvitations();
    const porId = new Map(r.invitations.map((i) => [i.id, i]));
    // Las DOS vienen: desaparecer la muerta parecería un bug.
    expect(r.invitations).toHaveLength(2);
    expect(porId.get('hacia-muerta')).toMatchObject({ mesa_joinable: false, mesa_status: 'completed' });
    expect(porId.get('hacia-viva')).toMatchObject({ mesa_joinable: true, mesa_status: 'open' });
  });

  it('la invitación del SEED no promete más vida que su mesa', async () => {
    const { state } = await cargar();
    const inv = state.pendingInvitations[0]!;
    const mesa = state.mesas.find((m) => m.code === inv.mesa_code)!;
    expect(inv.expires_at <= mesa.expires_at).toBe(true);
  });
});
