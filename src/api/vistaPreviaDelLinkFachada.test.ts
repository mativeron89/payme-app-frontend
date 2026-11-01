import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Api } from './index';
import type { StoredSession } from './storage';

/**
 * AF-5 · la vista previa del link por el transporte real: `POST /api/invitations/link-preview`, el token SÓLO en el
 * cuerpo (nunca en la URL de la API), sin `Authorization` aunque haya sesión (la ruta es pública y no mira la sesión),
 * y cortada a 1,5 s. La capacidad llega con `GET /api/config`, sin request propia.
 */
const T_DEL_LINK = 'v2.00000000-0000-4000-8000-000000000001.mac';
const session: StoredSession = { access_token: 'tok', refresh_token: 'r', family_id: 'test-family', principal_id: 'test-person' };
const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});
let api: Api;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('VITE_MOCK', '0');
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } });
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal('fetch', fetchMock);
  api = (await import('./index')).api;
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('AF-5 · el pedido real', () => {
  it('🔴 POST a la ruta del contrato, el token en el cuerpo y no en la URL, sin Authorization aunque haya sesión', async () => {
    (await import('./storage')).saveSession(session);
    fetchMock.mockResolvedValueOnce(reply({ inviter_first_name: 'Ana', restaurant_name: 'Tacos El Güero' }));
    expect(await api.getVistaPreviaDelLink(T_DEL_LINK)).toEqual({ inviter_first_name: 'Ana', restaurant_name: 'Tacos El Güero' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/api\/invitations\/link-preview$/);
    expect(String(url)).not.toContain(T_DEL_LINK);
    expect(String(url)).not.toContain('?');
    expect(options?.method).toBe('POST');
    expect(JSON.parse(options?.body as string)).toEqual({ token: T_DEL_LINK });
    expect(new Headers(options?.headers).get('authorization')).toBeNull();
  });

  it('🔴 se corta a 1,5 s: la señal se aborta', async () => {
    vi.useFakeTimers();
    let senal: AbortSignal | undefined;
    fetchMock.mockImplementationOnce((_url, options) => new Promise((_res, rej) => {
      senal = options?.signal ?? undefined;
      senal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
    }));
    const pedido = api.getVistaPreviaDelLink(T_DEL_LINK);
    const resultado = pedido.then(() => 'resolvio', () => 'rechazo');
    await vi.advanceTimersByTimeAsync(1499);
    expect(senal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(senal?.aborted).toBe(true);
    expect(await resultado).toBe('rechazo');
  });

  it('el 403 llega como error HTTP (lo traduce a «sin vista previa» `vistaPreviaDelLink`)', async () => {
    fetchMock.mockResolvedValueOnce(reply({ error: 'invitation_link_not_valid' }, 403));
    await expect(api.getVistaPreviaDelLink(T_DEL_LINK)).rejects.toMatchObject({ status: 403 });
  });

  it('la capacidad se lee de la config, sin request propia', async () => {
    const { capacidadVistaPrevia } = await import('./vistaPreviaDelLink');
    expect(capacidadVistaPrevia()).toBe('pendiente');
    fetchMock.mockResolvedValueOnce(reply({ features: { link_preview: { supported: true } } }));
    await api.getConfig();
    expect(capacidadVistaPrevia()).toBe('encendida');
    fetchMock.mockResolvedValueOnce(reply({ features: {} }));
    await api.getConfig();
    expect(capacidadVistaPrevia()).toBe('apagada');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [url] of fetchMock.mock.calls) expect(String(url)).toMatch(/\/api\/config$/);
  });
});
