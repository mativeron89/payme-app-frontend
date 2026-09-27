import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * AF-USERNAME-D104 · el mock responde las cuatro listas con las claves EXACTAS
 * del dueño (`contract-mirror/routes/{friends,groups,mesas}.js`, v2.139.0):
 *
 * - AB nuevo (default): cada persona suma `username` (el @, o `null`);
 * - AB anterior (`payme.app.mock.listas_sin_arroba.v1 = 'true'`) o el @
 *   apagado (`payme.app.mock.username.v1 = 'false'`): las claves de siempre.
 *
 * Y nunca el correo: tampoco en los integrantes de un grupo, que el dueño
 * dejó de mandar en `c66443b` y el mock siguió mandando hasta 0.198.1.
 */

let almacen: Map<string, string>;

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  almacen = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => almacen.get(k) ?? null,
    setItem: (k: string, v: string) => { almacen.set(k, v); },
    removeItem: (k: string) => { almacen.delete(k); },
    key: (i: number) => [...almacen.keys()][i] ?? null,
    get length() { return almacen.size; },
    clear: () => almacen.clear(),
  });
  vi.stubGlobal('setTimeout', ((callback: () => void) => { queueMicrotask(callback); return 0; }) as unknown as typeof setTimeout);
});

async function listas() {
  const mock = await import('./mockApi');
  const { state } = await import('./store');
  const amigos = (await mock.mockFriends()).friends as unknown as Array<Record<string, unknown>>;
  const entrantes = (await mock.mockFriendRequests('incoming')).requests.map(
    (r) => r.user as unknown as Record<string, unknown>,
  );
  const grupo = (await mock.mockGroupDetail(state.groups[0]!.id)).members as unknown as Array<Record<string, unknown>>;
  const participantes = (await mock.mockMesaParticipants('PA-2847', 'user')).participants;
  return { amigos, entrantes, grupo, participantes };
}

const claves = (filas: Array<Record<string, unknown>>) => filas.map((f) => Object.keys(f).sort().join(','));

describe('AF-USERNAME-D104 · mock de las listas con el @', () => {
  it('AB nuevo: cada persona trae `username`, con `null` para quien no eligió uno', async () => {
    const { amigos, entrantes, grupo, participantes } = await listas();
    for (const k of claves(amigos)) expect(k).toBe('added_at,first_name,full_name,id,last_name,payme_id,username');
    for (const k of claves(entrantes)) expect(k).toBe('first_name,full_name,id,last_name,payme_id,username');
    for (const k of claves(grupo)) expect(k).toBe('first_name,id,last_name,payme_id,username');
    for (const k of claves(participantes)) {
      expect(k).toBe('first_name,has_avatar,last_name,participant_id,payme_id,username');
    }
    const porNombre = Object.fromEntries(amigos.map((a) => [a.full_name, a.username]));
    expect(porNombre['Sofía Fernández']).toBe('sofi.fernandez');
    expect(porNombre['Leo Paz']).toBeNull();
    expect(participantes.map((p) => p.username)).toEqual(['luis.cardenas', null]);
  });

  it.each([
    ['AB anterior', 'payme.app.mock.listas_sin_arroba.v1', 'true'],
    ['@ apagado', 'payme.app.mock.username.v1', 'false'],
  ])('%s: las claves de siempre, sin `username`', async (_l, clave, valor) => {
    almacen.set(clave, valor);
    const { amigos, entrantes, grupo, participantes } = await listas();
    for (const k of claves(amigos)) expect(k).toBe('added_at,first_name,full_name,id,last_name,payme_id');
    for (const k of claves(entrantes)) expect(k).toBe('first_name,full_name,id,last_name,payme_id');
    for (const k of claves(grupo)) expect(k).toBe('first_name,id,last_name,payme_id');
    for (const k of claves(participantes)) expect(k).toBe('first_name,has_avatar,last_name,participant_id,payme_id');
  });

  it('🔴 ninguna lista trae el correo', async () => {
    const { amigos, entrantes, grupo, participantes } = await listas();
    expect(JSON.stringify([amigos, entrantes, grupo, participantes])).not.toContain('@mail.com');
  });
});
