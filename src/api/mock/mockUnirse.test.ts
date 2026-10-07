import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * D219 · el mock de «Unirme con código» sigue al dueño
 * (`contract-mirror/contract/mesa-join-requests-v1.json`): el mismo pedido
 * pendiente para el mismo código (A06), claves exactas, y del lado del titular
 * aceptar suma a la persona y rechazar no. Las e2e usan esta conducta.
 */

let values: Map<string, string>;

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.stubEnv('VITE_MOCK', '1');
  values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  });
  vi.stubGlobal('setTimeout', ((callback: () => void) => { queueMicrotask(callback); return 0; }) as unknown as typeof setTimeout);
});

const costura = (v: Record<string, unknown>) => values.set('payme.app.mock.unirse.v1', JSON.stringify(v));

async function error(p: Promise<unknown>): Promise<{ status: number; message: string }> {
  try {
    await p;
  } catch (e) {
    const err = e as { status: number; message: string };
    return { status: err.status, message: err.message };
  }
  throw new Error('se esperaba un rechazo');
}

describe('D219 · el mock, quien pide', () => {
  it('🔴 A06 · el mismo código otra vez: el MISMO pedido y el mismo vencimiento', async () => {
    const mock = await import('./mockApi');
    const a = await mock.mockRequestJoin('PA-12345');
    const b = await mock.mockRequestJoin(' pa-12345 ');
    expect(Object.keys(a).sort()).toEqual(['expires_at', 'id', 'status']);
    expect(b).toEqual(a);
    const c = await mock.mockRequestJoin('PA-54321');
    expect(c.id).not.toBe(a.id);
  });

  it('el estado evoluciona según la costura, y accepted trae mesa_code', async () => {
    costura({ estado: 'accepted', tras: 2, mesa: 'PA-4520' });
    const mock = await import('./mockApi');
    const { id } = await mock.mockRequestJoin('PA-12345') as { id: string };
    expect((await mock.mockGetJoinRequest(id)).status).toBe('pending');
    const s = await mock.mockGetJoinRequest(id);
    expect(s).toMatchObject({ id, status: 'accepted', mesa_code: 'PA-4520' });
  });

  it('cancelar un pendiente: {id, status: cancelled}; otra vez, 409', async () => {
    const mock = await import('./mockApi');
    const { id } = await mock.mockRequestJoin('PA-12345') as { id: string };
    expect(await mock.mockCancelJoinRequest(id)).toEqual({ id, status: 'cancelled' });
    expect(await error(mock.mockCancelJoinRequest(id))).toEqual({ status: 409, message: 'join_request_not_pending' });
    expect(await error(mock.mockGetJoinRequest('no-existe'))).toEqual({ status: 404, message: 'join_request_not_found' });
  });
});

describe('D219 · el mock, el titular', () => {
  it('aceptar suma a la persona a quiénes están; rechazar no', async () => {
    costura({ solicitudes: 2 });
    const mock = await import('./mockApi');
    const { join_requests: lista } = await mock.mockMesaJoinRequests('PA-2847') as { join_requests: Array<{ id: string }> };
    expect(lista).toHaveLength(2);
    const antes = (await mock.mockMesaParticipants('PA-2847', 'user')).participants.length;
    expect(await mock.mockDecideJoinRequest('PA-2847', lista[0]!.id, 'accept')).toEqual({ id: lista[0]!.id, status: 'accepted' });
    expect(await mock.mockDecideJoinRequest('PA-2847', lista[1]!.id, 'reject')).toEqual({ id: lista[1]!.id, status: 'rejected' });
    expect((await mock.mockMesaParticipants('PA-2847', 'user')).participants).toHaveLength(antes + 1);
    expect((await mock.mockMesaJoinRequests('PA-2847') as { join_requests: unknown[] }).join_requests).toEqual([]);
  });

  it('a quien no es titular, 403 not_mesa_organizer', async () => {
    costura({ solicitudes: 2 });
    const mock = await import('./mockApi');
    expect(await error(mock.mockMesaJoinRequests('PA-4520'))).toEqual({ status: 403, message: 'not_mesa_organizer' });
  });
});
