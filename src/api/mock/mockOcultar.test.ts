import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * AF-BORRAR-MESAS · el mock replica la matriz de App Backend v2.169.0
 * (`contract-mirror/contract/ocultamientos-v1.json`): M = mesa oculta sin
 * historial, MH = con su historial, P = pago suelto.
 *   /mesas/mine:            M sale · MH sale · P queda
 *   /account/history:       M queda · MH sale · P sale
 *   /account/movements/:id: M queda · MH 404 · P 404
 */

function storage() {
  const values = new Map<string, string>([['payme.app.mock.money_rail.v1', 'disabled']]);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  });
  return values;
}

/**
 * Una mesa propia y terminada de «Tus mesas» (del seed), con un pago propio en
 * el historial: el seed no tiene ninguna con las dos cosas, así que el pago se
 * siembra copiando un detalle existente.
 */
async function subject() {
  const mock = await import('./mockApi');
  const { state } = await import('./store');
  const terminadas = ['fully_paid', 'expired', 'completed', 'settled', 'cancelled'];
  const viva = state.mesas.find((m) => m.openedByUser && terminadas.includes(m.status))!;
  const code = viva.code;
  const modelo = state.history.find((h) => state.movementDetails[h.id])!;
  const pagoId = 'a0000000-0000-4000-8000-000000000334';
  state.history.push({ ...modelo, id: pagoId, mesa_code: code, mesa_status: viva.status });
  state.movementDetails[pagoId] = structuredClone(state.movementDetails[modelo.id]!);
  return { mock, state, code, pagoId };
}

const codigos = (r: unknown) => (r as { mesas: Array<{ code: string }> }).mesas.map((m) => m.code);
const enHistorial = async (mock: typeof import('./mockApi'), id: string) =>
  (await mock.mockHistory({ limit: 100 })).history.some((h) => h.id === id);

describe('mock · ocultar (v2.169.0)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    storage();
  });

  it('M: la mesa sale de «Tus mesas» y su pago queda en el historial', async () => {
    const { mock, code, pagoId } = await subject();
    const r = await mock.mockOcultarMesa(code, { include_history: false });
    expect(r).toEqual({ mesa_code: code, hidden: true, include_history: false });
    expect(codigos(await mock.mockMisMesas())).not.toContain(code);
    expect(await enHistorial(mock, pagoId)).toBe(true);
    await expect(mock.mockMovement(pagoId)).resolves.toBeTruthy();
  });

  it('MH: la mesa y su pago salen; el detalle del pago da 404', async () => {
    const { mock, code, pagoId } = await subject();
    await mock.mockOcultarMesa(code, { include_history: true });
    expect(codigos(await mock.mockMisMesas())).not.toContain(code);
    expect(await enHistorial(mock, pagoId)).toBe(false);
    await expect(mock.mockMovement(pagoId)).rejects.toMatchObject({ status: 404, message: 'movement_not_found' });
  });

  it('el alcance sólo se amplía: MH y después M sigue siendo MH', async () => {
    const { mock, code } = await subject();
    await mock.mockOcultarMesa(code, { include_history: true });
    expect(await mock.mockOcultarMesa(code, { include_history: false }))
      .toEqual({ mesa_code: code, hidden: true, include_history: true });
  });

  it('P: el pago sale del historial y la mesa queda en «Tus mesas»', async () => {
    const { mock, code, pagoId } = await subject();
    expect(await mock.mockOcultarPago(pagoId)).toEqual({ id: pagoId, hidden: true });
    expect(await enHistorial(mock, pagoId)).toBe(false);
    expect(codigos(await mock.mockMisMesas())).toContain(code);
  });

  it('deshacer: todo vuelve, y es idempotente', async () => {
    const { mock, code, pagoId } = await subject();
    await mock.mockOcultarMesa(code, { include_history: true });
    await mock.mockOcultarPago(pagoId);
    expect(await mock.mockMostrarMesa(code)).toEqual({ mesa_code: code, hidden: false, include_history: false });
    expect(await mock.mockMostrarMesa(code)).toEqual({ mesa_code: code, hidden: false, include_history: false });
    expect(await mock.mockMostrarPago(pagoId)).toEqual({ id: pagoId, hidden: false });
    expect(codigos(await mock.mockMisMesas())).toContain(code);
    expect(await enHistorial(mock, pagoId)).toBe(true);
  });

  it('404 sin huella (el mismo para un código que no existe), 409 si la mesa está en curso', async () => {
    const { mock, state, code, pagoId } = await subject();
    await expect(mock.mockOcultarMesa('PA-0000', { include_history: false })).rejects.toMatchObject({ status: 404, message: 'mesa_not_found' });
    await expect(mock.mockOcultarPago('no-existe')).rejects.toMatchObject({ status: 404, message: 'movement_not_found' });
    const viva = state.mesas.find((m) => m.code === code);
    if (viva) {
      // En curso de verdad: con el vencimiento pasado, el mock la da por vencida.
      viva.status = 'open';
      viva.expires_at = new Date(Date.now() + 60 * 60_000).toISOString();
      await expect(mock.mockOcultarMesa(code, { include_history: false }))
        .rejects.toMatchObject({ status: 409, message: 'mesa_not_finished', extra: { mesa_status: 'open' } });
      await expect(mock.mockOcultarPago(pagoId))
        .rejects.toMatchObject({ status: 409, message: 'movement_not_hideable' });
    }
  });

  it('la capacidad: encendida por defecto; el seam la apaga o la saca', async () => {
    const values = storage();
    vi.resetModules();
    let mock = await import('./mockApi');
    expect((await mock.mockGetConfig()).features.hide_from_app).toEqual({
      supported: true,
      enabled: true,
      hideable_mesa_statuses: ['fully_paid', 'expired', 'settling', 'settled', 'dispersing', 'completed', 'auth_failed', 'cancelled', 'dispersed'],
    });
    values.set('payme.app.mock.ocultar.v1', 'apagado');
    expect((await mock.mockGetConfig()).features.hide_from_app).toMatchObject({ enabled: false });
    values.set('payme.app.mock.ocultar.v1', 'ausente');
    vi.resetModules();
    mock = await import('./mockApi');
    expect('hide_from_app' in (await mock.mockGetConfig()).features).toBe(false);
  });
});
