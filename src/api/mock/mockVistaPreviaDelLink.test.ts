import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * AF-5 · D629 · D676 · el mock de `POST /api/invitations/link-preview`, con la forma del contrato del dueño
 * (`contract/invitacion-preview-v1.json`): sin sesión, las dos claves para un link vigente de una mesa viva, y el
 * MISMO 403 para todo lo demás (también la mesa que ya no está viva: acá no hay 410).
 */
const storage = new Map<string, string>();
const mk = () => ({
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => { storage.set(k, v); },
  removeItem: (k: string) => { storage.delete(k); },
  clear: () => storage.clear(),
  key: (i: number) => [...storage.keys()][i] ?? null,
  get length() { return storage.size; },
}) as unknown as Storage;

vi.stubGlobal('localStorage', mk());
vi.stubGlobal('window', { location: { origin: 'https://payme.test', pathname: '/' } });

const { mockVistaPreviaDelLink, mockCreateInvitation, mockGetConfig, MockApiError } = await import('./mockApi');
const { state } = await import('./store');
const { saveSession, clearSession } = await import('../storage');
const { CLAVE_VISTA_PREVIA_MOCK } = await import('../vistaPreviaDelLink');

async function fallo(p: Promise<unknown>): Promise<{ status: number; error: string }> {
  try { await p; throw new Error('no falló'); }
  catch (e) {
    if (!(e instanceof MockApiError)) throw e;
    return { status: e.status, error: e.message };
  }
}

/** Un link emitido por el organizador (con sesión), que después se abre sin sesión. */
async function linkDeMesa(i: number, idem: string): Promise<{ code: string; token: string }> {
  saveSession({ access_token: 'a', refresh_token: 'r', family_id: `fam-${idem}`, principal_id: 'p1' });
  const code = state.mesas[i]!.code;
  const inv = await mockCreateInvitation(code, idem);
  clearSession();
  return { code, token: new URL(inv.link!).hash.split('t=')[1]! };
}

beforeEach(() => {
  storage.delete(CLAVE_VISTA_PREVIA_MOCK);
});

describe('la capacidad del mock', () => {
  it('sin el seam no se publica (el dueño de antes); con él, `{supported: true}`', async () => {
    expect((await mockGetConfig()).features).not.toHaveProperty('link_preview');
    storage.set(CLAVE_VISTA_PREVIA_MOCK, 'encendido');
    expect((await mockGetConfig()).features).toHaveProperty('link_preview', { supported: true });
  });
});

describe('la vista previa del mock', () => {
  it('sin sesión, un link vigente de una mesa viva: el nombre de pila de quien invita y el restaurante, nada más', async () => {
    storage.set(CLAVE_VISTA_PREVIA_MOCK, 'encendido');
    const { code, token } = await linkDeMesa(0, 'idem-vista-0001');
    const r = await mockVistaPreviaDelLink(token);
    expect(Object.keys(r).sort()).toEqual(['inviter_first_name', 'restaurant_name']);
    expect(r).toEqual({ inviter_first_name: state.user.first_name, restaurant_name: state.mesas.find((m) => m.code === code)!.restaurant.name });
  });

  it('D676 · con `sin_nombre`, el nombre en null y el restaurante igual', async () => {
    storage.set(CLAVE_VISTA_PREVIA_MOCK, 'sin_nombre');
    const { token } = await linkDeMesa(1, 'idem-vista-0002');
    const r = await mockVistaPreviaDelLink(token);
    expect(r.inviter_first_name).toBeNull();
    expect(typeof r.restaurant_name).toBe('string');
  });

  it('🔴 token que nadie emitió, de una mesa que no existe y de una mesa que ya no está viva: el MISMO 403', async () => {
    storage.set(CLAVE_VISTA_PREVIA_MOCK, 'encendido');
    const inexistente = await fallo(mockVistaPreviaDelLink('tok-que-nadie-emitio'));
    state.linkTokens['tok-de-mesa-fantasma'] = 'PA-NO-EXISTE';
    const fantasma = await fallo(mockVistaPreviaDelLink('tok-de-mesa-fantasma'));
    const { code, token } = await linkDeMesa(2, 'idem-vista-0003');
    state.mesas.find((m) => m.code === code)!.status = 'settled';
    const muerta = await fallo(mockVistaPreviaDelLink(token));
    expect(inexistente).toEqual({ status: 403, error: 'invitation_link_not_valid' });
    expect(fantasma).toEqual(inexistente);
    expect(muerta).toEqual(inexistente);
  });

  it('sin forma de token: el 400 de accept-link', async () => {
    storage.set(CLAVE_VISTA_PREVIA_MOCK, 'encendido');
    expect(await fallo(mockVistaPreviaDelLink('corto'))).toEqual({ status: 400, error: 'invitation_token_required' });
  });

  it('sin el seam, el dueño de antes: 401 (requireAuth cubre /api/invitations)', async () => {
    const { token } = await linkDeMesa(0, 'idem-vista-0004');
    expect(await fallo(mockVistaPreviaDelLink(token))).toEqual({ status: 401, error: 'auth_required' });
  });

  it('no inscribe ni canjea: la mesa no aparece entre las propias', async () => {
    storage.set(CLAVE_VISTA_PREVIA_MOCK, 'encendido');
    const { code, token } = await linkDeMesa(0, 'idem-vista-0005');
    const antes = [...state.joinedMesaCodes];
    await mockVistaPreviaDelLink(token);
    expect(state.joinedMesaCodes).toEqual(antes);
    expect(state.joinedMesaCodes.includes(code)).toBe(antes.includes(code));
  });
});
