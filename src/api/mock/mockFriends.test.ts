import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * G-25 · el mock replica recibos opacos por intento. Ni el POST ni la lista
 * saliente cambian de cardinalidad según exista el destino. Las solicitudes
 * reales quedan como detalle interno para aceptar/bloquear, nunca como DTO de
 * salida.
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

const solicitudesSalientes = (
  state: { friendRequests: Array<{ id: string; direction: string }> },
) => state.friendRequests.filter((request) => request.direction === 'outgoing');

describe('mockAddFriend · ceguera y recibo owner-first', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    setupStorage();
  });

  it('destino inexistente: crea recibo opaco pero ninguna identidad/solicitud real', async () => {
    const { mock, state } = await cargar();

    const response = await mock.mockAddFriend({ email: 'nadie-con-este-correo@mail.com' });

    expect(response).toEqual({ requested: true, request_id: state.friendRequestReceipts[0]!.id });
    expect(response.request_id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(state.friendRequestReceipts).toHaveLength(1);
    expect(solicitudesSalientes(state)).toHaveLength(0);
  });

  it('destino existente: mismo recibo opaco y ninguna persona saliente persistida', async () => {
    const { mock, state } = await cargar();

    const response = await mock.mockAddFriend({ email: 'nico@mail.com' });

    expect(response).toEqual({ requested: true, request_id: state.friendRequestReceipts[0]!.id });
    expect(JSON.stringify(response)).not.toContain('Nicolás');
    expect(solicitudesSalientes(state)).toHaveLength(0);
    expect(state.friendRequestReceipts[0]).toEqual({
      id: response.request_id,
      requested_at: expect.any(String),
    });
  });

  it('POST y GET conservan la misma forma no-oracular exista o no', async () => {
    const { mock } = await cargar();

    const existente = await mock.mockAddFriend({ email: 'nico@mail.com' });
    const inexistente = await mock.mockAddFriend({ email: 'fantasma@mail.com' });
    const outgoing = await mock.mockFriendRequests('outgoing');

    expect(Object.keys(existente).sort()).toEqual(['request_id', 'requested']);
    expect(Object.keys(inexistente).sort()).toEqual(['request_id', 'requested']);
    expect(outgoing.requests).toHaveLength(2);
    for (const receipt of outgoing.requests) {
      expect(Object.keys(receipt).sort()).toEqual(['id', 'requested_at']);
    }
    expect(JSON.stringify(outgoing)).not.toContain('Nicolás');
    expect(JSON.stringify(outgoing)).not.toContain('nico@mail.com');
  });

  it('ya amigo, bloqueado y destino inexistente también producen un recibo', async () => {
    const { mock, state } = await cargar();
    const nico = state.directory.find((person) => person.email === 'nico@mail.com')!;
    state.blockedUserIds.push(nico.id);

    await mock.mockAddFriend({ email: 'sofi@mail.com' });
    await mock.mockAddFriend({ email: 'nico@mail.com' });
    await mock.mockAddFriend({ email: 'fantasma@mail.com' });

    expect(state.friendRequestReceipts).toHaveLength(3);
    expect(solicitudesSalientes(state)).toHaveLength(0);
  });

  it('solicitud recíproca se acepta pero el intento conserva su recibo opaco', async () => {
    const { mock, state } = await cargar();
    expect(state.friendRequests.filter((request) => request.direction === 'incoming')).toHaveLength(1);

    await mock.mockAddFriend({ email: 'vale@mail.com' });

    expect(state.friendRequests).toHaveLength(0);
    expect(state.friendRequestReceipts).toHaveLength(1);
    expect(state.friends.some((friend) => friend.full_name === 'Valentina Ríos')).toBe(true);
  });

  it('dos intentos a la misma persona crean dos recibos sin identidad lateral', async () => {
    const { mock, state } = await cargar();

    await mock.mockAddFriend({ payme_id: 'payme_mx_nico' });
    await mock.mockAddFriend({ payme_id: 'payme_mx_nico' });

    expect(state.friendRequestReceipts).toHaveLength(2);
    expect(solicitudesSalientes(state)).toHaveLength(0);
  });

  it('reload conserva recibos opacos sin recuperar identidad del destino', async () => {
    const first = await cargar();
    await first.mock.mockAddFriend({ email: 'nico@mail.com' });
    await first.mock.mockAddFriend({ email: 'fantasma@mail.com' });

    vi.resetModules();
    const reloaded = await cargar();
    const outgoing = await reloaded.mock.mockFriendRequests('outgoing');

    expect(outgoing.requests).toHaveLength(2);
    expect(outgoing.requests.every((receipt) =>
      Object.keys(receipt).sort().join(',') === 'id,requested_at')).toBe(true);
    expect(JSON.stringify(outgoing)).not.toContain('Nicolás');
    expect(JSON.stringify(outgoing)).not.toContain('fantasma');
  });

  it('migra storage legacy outgoing a recibo y descarta la persona saliente', async () => {
    const first = await cargar();
    const legacyId = 'f0000000-0000-4000-8000-000000009999';
    const legacyState = structuredClone(first.state) as Omit<
      typeof first.state,
      'friendRequestReceipts'
    > & {
      friendRequestReceipts?: typeof first.state.friendRequestReceipts;
    };
    legacyState.friendRequests.push({
      id: legacyId,
      direction: 'outgoing',
      person: legacyState.directory.find((person) => person.email === 'nico@mail.com')!,
      requested_at: '2026-08-25T12:00:00.000Z',
    });
    delete legacyState.friendRequestReceipts;
    localStorage.setItem('payme_mock_state_v1', JSON.stringify(legacyState));

    vi.resetModules();
    const reloaded = await cargar();
    const outgoing = await reloaded.mock.mockFriendRequests('outgoing');

    expect(outgoing.requests).toEqual([{
      id: legacyId,
      requested_at: '2026-08-25T12:00:00.000Z',
    }]);
    expect(reloaded.state.friendRequests.some((request) => request.direction === 'outgoing'))
      .toBe(false);
    expect(JSON.stringify(outgoing)).not.toContain('Nicolás');
  });
});

describe('mockCancelFriendRequest · usa receipt id, no person/request id', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    setupStorage();
  });

  it('cancela exactamente un recibo y conserva los demás', async () => {
    const { mock, state } = await cargar();
    const first = await mock.mockAddFriend({ email: 'nico@mail.com' });
    const second = await mock.mockAddFriend({ email: 'nico@mail.com' });

    await expect(mock.mockCancelFriendRequest(first.request_id!)).resolves.toEqual({ cancelled: true });
    expect(state.friendRequestReceipts.map((receipt) => receipt.id)).toEqual([second.request_id]);
    expect(solicitudesSalientes(state)).toHaveLength(0);

    await expect(mock.mockCancelFriendRequest(second.request_id!)).resolves.toEqual({ cancelled: true });
    expect(state.friendRequestReceipts).toHaveLength(0);
    expect(solicitudesSalientes(state)).toHaveLength(0);
  });

  it('rechaza id de persona: no lo mezcla con receipt id', async () => {
    const { mock, state } = await cargar();
    await mock.mockAddFriend({ email: 'nico@mail.com' });
    const personId = state.directory.find((person) => person.email === 'nico@mail.com')!.id;

    await expect(mock.mockCancelFriendRequest(personId)).rejects.toMatchObject({ status: 404 });
    expect(state.friendRequestReceipts).toHaveLength(1);
  });
});

describe('incoming permanece identificable y accionable', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    setupStorage();
  });

  it('GET incoming conserva persona y aceptar la convierte en amiga', async () => {
    const { mock, state } = await cargar();
    const incoming = await mock.mockFriendRequests('incoming');
    expect(incoming.requests[0]!.user.full_name).toBe('Valentina Ríos');

    await mock.mockAcceptFriendRequest(incoming.requests[0]!.id);
    expect(state.friends.some((friend) => friend.full_name === 'Valentina Ríos')).toBe(true);
  });
});
