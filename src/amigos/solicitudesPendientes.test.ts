/**
 * D230 · el número de la burbuja de «Amigos»: de quién es, cuándo se consulta y
 * qué pasa si la consulta falla o llega tarde.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoredSession } from '../api/storage';

const sesion = { actual: null as StoredSession | null };
const pedidos: Array<{ resolver: (n: number) => void; fallar: () => void }> = [];

vi.mock('../api/storage', () => ({
  loadSession: () => sesion.actual,
  subscribeSession: () => () => undefined,
}));

vi.mock('../api', () => ({
  api: {
    getIncomingFriendRequests: () =>
      new Promise((resolve, reject) => {
        pedidos.push({
          resolver: (n) => resolve({ direction: 'incoming', requests: Array.from({ length: n }, (_, i) => ({ id: `r${i}` })) }),
          fallar: () => reject(new Error('500')),
        });
      }),
  },
}));

const {
  consultarSolicitudesPendientes,
  publicarSolicitudesPendientes,
  reiniciarParaTests,
  solicitudesPendientes,
} = await import('./solicitudesPendientes');
const { textoDeLaBurbuja } = await import('../components/AppBottomBar');

function cuenta(familia: string, principal = 'p'): StoredSession {
  return { access_token: 'a', refresh_token: 'r', family_id: familia, principal_id: principal };
}

async function vuelta(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
}

let visibilidad: DocumentVisibilityState = 'visible';

beforeEach(() => {
  reiniciarParaTests();
  pedidos.length = 0;
  sesion.actual = cuenta('A');
  visibilidad = 'visible';
  // Las unitarias corren sin DOM: sólo hace falta saber si la app está a la vista.
  vi.stubGlobal('document', { get visibilityState() { return visibilidad; } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('D230 · la burbuja de «Amigos»', () => {
  it('«9+» desde 10; hasta 9, el número', () => {
    expect(textoDeLaBurbuja(1)).toBe('1');
    expect(textoDeLaBurbuja(9)).toBe('9');
    expect(textoDeLaBurbuja(10)).toBe('9+');
    expect(textoDeLaBurbuja(23)).toBe('9+');
  });

  it('sin consulta todavía no hay número', () => {
    expect(solicitudesPendientes()).toBeNull();
  });

  it('la consulta deja el número de la cuenta actual', async () => {
    consultarSolicitudesPendientes();
    pedidos[0]!.resolver(3);
    await vuelta();
    expect(solicitudesPendientes()).toBe(3);
  });

  it('🔴 el número de una cuenta nunca se ve en otra', async () => {
    consultarSolicitudesPendientes();
    pedidos[0]!.resolver(3);
    await vuelta();
    sesion.actual = cuenta('B');
    expect(solicitudesPendientes()).toBeNull();
    sesion.actual = cuenta('A', 'otro');
    expect(solicitudesPendientes()).toBeNull();
    sesion.actual = null;
    expect(solicitudesPendientes()).toBeNull();
  });

  it('🔴 una respuesta que llega con otra cuenta ya adentro se descarta', async () => {
    consultarSolicitudesPendientes();
    sesion.actual = cuenta('B');
    pedidos[0]!.resolver(4);
    await vuelta();
    expect(solicitudesPendientes()).toBeNull();
    sesion.actual = cuenta('A');
    expect(solicitudesPendientes()).toBeNull();
  });

  it('🔴 si la consulta falla, se va el número (no queda el anterior)', async () => {
    consultarSolicitudesPendientes();
    pedidos[0]!.resolver(2);
    await vuelta();
    consultarSolicitudesPendientes();
    pedidos[1]!.fallar();
    await vuelta();
    expect(solicitudesPendientes()).toBeNull();
  });

  it('una respuesta vieja no pisa a una más nueva', async () => {
    consultarSolicitudesPendientes();
    consultarSolicitudesPendientes();
    pedidos[1]!.resolver(5);
    await vuelta();
    pedidos[0]!.resolver(1);
    await vuelta();
    expect(solicitudesPendientes()).toBe(5);
  });

  it('lo que publica la pantalla de Amigos deja vieja a la consulta en vuelo', async () => {
    consultarSolicitudesPendientes();
    publicarSolicitudesPendientes(cuenta('A'), 0);
    pedidos[0]!.resolver(7);
    await vuelta();
    expect(solicitudesPendientes()).toBe(0);
  });

  it('la pantalla de Amigos no publica para una cuenta que ya no está', () => {
    publicarSolicitudesPendientes(cuenta('B'), 2);
    expect(solicitudesPendientes()).toBeNull();
  });

  it('🔴 en segundo plano no consulta', () => {
    visibilidad = 'hidden';
    consultarSolicitudesPendientes();
    expect(pedidos).toHaveLength(0);
  });

  it('sin sesión no consulta', () => {
    sesion.actual = null;
    consultarSolicitudesPendientes();
    expect(pedidos).toHaveLength(0);
  });
});
