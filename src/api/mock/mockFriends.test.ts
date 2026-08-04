import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * EL MOCK OCULTÓ EL DEFECTO.
 *
 * `mockAddFriend` inventaba una persona ("Handle Demo") y empujaba la solicitud
 * saliente para CUALQUIER texto que se tipeara. Entonces en la demo "Enviadas"
 * aparecía siempre, y el comportamiento real —el backend sólo inserta la fila
 * si el destino existe y está activo— era invisible. Con él quedaba invisible
 * el oráculo de existencia que ese comportamiento produce.
 *
 * La verificación manual del commit `1913b1d` decía "verificado en navegador
 * (mock)". No podía ver esto: **un mock que diverge del contrato hacia el lado
 * permisivo convierte mirar la pantalla en teatro.**
 *
 * Estos tests fijan la fidelidad, no la comodidad.
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

const salientes = (state: { friendRequests: Array<{ direction: string }> }) =>
  state.friendRequests.filter((r) => r.direction === 'outgoing');

describe('mockAddFriend · replica la ceguera del contrato, no la conveniencia', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    setupStorage();
  });

  it('a alguien que NO existe: 202 y NINGUNA fila (era una persona inventada)', async () => {
    const { mock, state } = await cargar();

    const r = await mock.mockAddFriend({ email: 'nadie-con-este-correo@mail.com' });

    expect(r).toEqual({ requested: true });
    // Antes acá aparecía "Nadie-con-este-correo Demo". La fila fantasma es lo
    // que hacía que el oráculo no se pudiera ver en la demo.
    expect(salientes(state)).toHaveLength(0);
  });

  it('a alguien que SÍ existe: crea la solicitud con la persona REAL del directorio', async () => {
    const { mock, state } = await cargar();

    const r = await mock.mockAddFriend({ email: 'nico@mail.com' });

    expect(r).toEqual({ requested: true });
    expect(salientes(state)).toHaveLength(1);
    expect(salientes(state)[0]).toMatchObject({ person: { full_name: 'Nicolás Salas' } });
  });

  it('la respuesta es IDÉNTICA exista o no: es todo lo que el emisor puede ver', async () => {
    const { mock } = await cargar();

    expect(await mock.mockAddFriend({ email: 'nico@mail.com' }))
      .toEqual(await mock.mockAddFriend({ email: 'fantasma@mail.com' }));
  });

  it('a quien YA es amigo: 202 y ninguna solicitud nueva', async () => {
    const { mock, state } = await cargar();

    await mock.mockAddFriend({ email: 'sofi@mail.com' });

    expect(salientes(state)).toHaveLength(0);
    expect(state.friends.filter((f) => f.email === 'sofi@mail.com')).toHaveLength(1);
  });

  it('a quien YA me pidió: equivale a aceptar, y no deja pendientes cruzadas', async () => {
    const { mock, state } = await cargar();
    expect(state.friendRequests.filter((r) => r.direction === 'incoming')).toHaveLength(1);

    // Valentina ya me mandó una solicitud; pedirle yo la resuelve.
    await mock.mockAddFriend({ email: 'vale@mail.com' });

    expect(state.friendRequests).toHaveLength(0);
    expect(state.friends.some((f) => f.full_name === 'Valentina Ríos')).toBe(true);
  });

  it('a quien bloqueé: 202 y ninguna fila', async () => {
    const { mock, state } = await cargar();
    const nico = state.directory.find((p) => p.email === 'nico@mail.com')!;
    state.blockedUserIds.push(nico.id);

    const r = await mock.mockAddFriend({ email: 'nico@mail.com' });

    expect(r).toEqual({ requested: true });
    expect(salientes(state)).toHaveLength(0);
  });

  it('dos veces a la misma persona no duplica la solicitud', async () => {
    const { mock, state } = await cargar();

    await mock.mockAddFriend({ payme_id: 'payme_mx_nico' });
    await mock.mockAddFriend({ payme_id: 'payme_mx_nico' });

    expect(salientes(state)).toHaveLength(1);
  });
});
