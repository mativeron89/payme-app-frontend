import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpError } from './http';
import { esInvitacionNoAceptada } from './invitacionNoAceptada';
import { MockApiError } from './mock/mockApi';

/**
 * D268 · S-05 · App Backend 2.178.0: quien entra a una mesa SÓLO con la
 * invitación pendiente la ve, pero tomar, soltar, guardar la selección o pagar
 * responde `403 {"error":"invitation_not_accepted"}`
 * (`contract-mirror/contract/mesa-acceso-v1.json#/invitacion_pendiente`).
 */
const contrato = JSON.parse(
  readFileSync(new URL('../../contract-mirror/contract/mesa-acceso-v1.json', import.meta.url), 'utf8'),
) as { invitacion_pendiente: { status: number; cuerpo: { error: string }; rutas: string[] } };

describe('🔴 D268 · S-05 · el 403 de la invitación pendiente', () => {
  it('el contrato del dueño: 403, ese cuerpo, en esas cuatro rutas', () => {
    const p = contrato.invitacion_pendiente;
    expect(p.status).toBe(403);
    expect(p.cuerpo).toEqual({ error: 'invitation_not_accepted' });
    expect(p.rutas).toEqual([
      'POST /api/mesas/:code/items/lock',
      'POST /api/mesas/:code/items/release',
      'POST /api/mesas/:code/pay',
      'PUT /api/mesas/:code/informative-selection',
    ]);
  });

  it('sólo ese 403: ni otro 403 de la misma puerta, ni el mismo código con otro status', () => {
    expect(esInvitacionNoAceptada(new HttpError(403, { error: 'invitation_not_accepted' }))).toBe(true);
    expect(esInvitacionNoAceptada(new MockApiError(403, 'invitation_not_accepted'))).toBe(true);
    for (const otro of [
      new HttpError(403, { error: 'user_suspended' }),
      new HttpError(403, { error: 'not_mesa_organizer' }),
      new HttpError(403, null),
      new HttpError(404, { error: 'mesa_not_found' }),
      new HttpError(409, { error: 'invitation_not_accepted' }),
      new MockApiError(401, 'invitation_not_accepted'),
      new Error('invitation_not_accepted'),
      'invitation_not_accepted',
      null,
    ]) {
      expect(esInvitacionNoAceptada(otro), String(otro)).toBe(false);
    }
  });
});

describe('🔴 D268 · S-05 · el mock, como el dueño: la costura de la invitación pendiente', () => {
  function storage(extra: Record<string, string> = {}) {
    const values = new Map<string, string>([['payme.app.mock.latencia.v1', '0'], ...Object.entries(extra)]);
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => values.get(k) ?? null,
      setItem: (k: string, v: string) => { values.set(k, v); },
      removeItem: (k: string) => { values.delete(k); },
    });
  }
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  async function rechazo(p: Promise<unknown>) {
    try { await p; } catch (e) { return { status: (e as MockApiError).status, error: (e as Error).message }; }
    throw new Error('se esperaba un rechazo');
  }

  const yo = { userId: 'u-yo', guestToken: null } as never;
  const pago = { idempotency_key: '0b0e7c1e-3f1d-4a61-9d1a-6f2b8b1c2d3e', tip_bps: 0 } as never;

  it('con la costura en ESA mesa: las cuatro rutas responden el 403, antes de mirar el pedido', async () => {
    storage({ 'payme.app.mock.invitacion_pendiente.v1': 'mesa-x' });
    const m = await import('./mock/mockApi');
    const esperado = { status: 403, error: 'invitation_not_accepted' };
    expect(await rechazo(m.mockLockItems('MESA-X', [], yo))).toEqual(esperado);
    expect(await rechazo(m.mockReleaseItems('MESA-X', [], yo))).toEqual(esperado);
    expect(await rechazo(m.mockReplaceInformativeSelection('MESA-X', {} as never))).toEqual(esperado);
    expect(await rechazo(m.mockPayMesa('MESA-X', pago, yo))).toEqual(esperado);
  });

  it('en otra mesa, o sin la costura, no: sigue el camino de siempre', async () => {
    storage({ 'payme.app.mock.invitacion_pendiente.v1': 'OTRA' });
    const m = await import('./mock/mockApi');
    expect(await rechazo(m.mockLockItems('MESA-X', [], yo))).toEqual({ status: 404, error: 'mesa_not_found' });
    expect(await rechazo(m.mockReleaseItems('MESA-X', [], yo))).toEqual({ status: 404, error: 'mesa_not_found' });
    expect(await rechazo(m.mockReplaceInformativeSelection('MESA-X', {} as never))).toEqual({ status: 404, error: 'mesa_not_found' });
    vi.resetModules();
    storage();
    const m2 = await import('./mock/mockApi');
    expect((await rechazo(m2.mockPayMesa('MESA-X', pago, yo))).error).not.toBe('invitation_not_accepted');
  });
});

describe('🔴 D268 · S-05 · la mesa lo dice en las cuatro acciones, y el pago con su texto', () => {
  const mesa = readFileSync(new URL('../screens/MesaScreen.tsx', import.meta.url), 'utf8');
  const vista = readFileSync(new URL('../screens/MesaDetailView.tsx', import.meta.url), 'utf8');

  it('soltar, tomar, guardar la selección y pagar reconocen el 403 y marcan la invitación pendiente', () => {
    const usos = mesa.match(/if \(esInvitacionNoAceptada\(err\)\) \{\s*setInvitacionPendiente\(true\);/g) ?? [];
    expect(usos).toHaveLength(3);
    expect(mesa).toMatch(
      /\} else if \(esInvitacionNoAceptada\(err\)\) \{[^}]*setError\(t\('Primero acepta la invitación a esta mesa\.'\)\);\s*setInvitacionPendiente\(true\);/,
    );
    // La vista lo recibe, con el camino a Avisos, donde se acepta.
    expect(mesa).toContain('invitacionPendiente={invitacionPendiente}');
    expect(mesa).toContain("onVerAvisos={() => navigate('avisos')}");
  });

  it('el aviso: un alert con el texto y el botón «Ver avisos»', () => {
    const i = vista.indexOf('{invitacionPendiente && (');
    expect(i).toBeGreaterThan(-1);
    const bloque = vista.slice(i, vista.indexOf(')}\n', vista.indexOf("t('Ver avisos')", i)));
    expect(bloque).toContain('role="alert"');
    expect(bloque).toContain("t('Primero acepta la invitación a esta mesa.')");
    expect(bloque).toContain('onClick={onVerAvisos}');
  });
});
