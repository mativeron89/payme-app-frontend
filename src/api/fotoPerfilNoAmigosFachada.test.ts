import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Api } from './index';
import type { StoredSession } from './storage';
import { FOTO_NOTICE } from './fotoPerfilNoAmigos';

const session: StoredSession = { access_token: 'tok', refresh_token: 'r', family_id: 'test-family', principal_id: 'test-person' };
const never = { purpose_key: 'foto_perfil_no_amigos', granted: false, state: 'never', since: null, notice_version: null, notice_hash: null };
const grant = { ...never, granted: true, state: 'granted', since: '2026-10-23T00:00:00.000Z', notice_version: FOTO_NOTICE.version, notice_hash: FOTO_NOTICE.hash };
const aviso = { kind: 'aviso_privacidad' as const, ...FOTO_NOTICE, effective_from: '2026-10-23T00:00:00.000Z',
  body: readFileSync(new URL('../../test-fixtures/legal-d457/aviso_privacidad.txt', import.meta.url), 'utf8').trim() };
const reply = (data: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store', vary: 'Authorization', ...headers },
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
  (await import('./storage')).saveSession(session);
  api = (await import('./index')).api;
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('D457 · rutas reales por el transporte autenticado existente', () => {
  it('grant sólo tras capability fresca, con el par exacto, sin datos extra', async () => {
    fetchMock.mockResolvedValueOnce(reply({ features: { foto_perfil_no_amigos: { supported: true, enabled: true } } }))
      .mockResolvedValueOnce(reply({ consent: grant }, 201, { etag: '"no-es-un-gate-del-contrato"' }));
    expect((await api.grantFotoPerfilNoAmigos(aviso, session)).granted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, options] = fetchMock.mock.calls[1]!;
    expect(String(url)).toMatch(/\/api\/account\/consents\/foto_perfil_no_amigos\/grant$/);
    expect(options?.method).toBe('POST');
    expect(options?.cache).toBe('no-store');
    expect(new Headers(options?.headers).get('authorization')).toBe('Bearer tok');
    expect(JSON.parse(options?.body as string)).toEqual({ notice_version: FOTO_NOTICE.version, notice_hash: FOTO_NOTICE.hash, channel: 'app' });
  });
  it('backend viejo o config fallida: cero POST', async () => {
    fetchMock.mockResolvedValueOnce(reply({ features: {} }));
    await expect(api.grantFotoPerfilNoAmigos(aviso, session)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('GET');
  });
  it('revoca sin consultar config/Aviso ni mandar un par inventado', async () => {
    fetchMock.mockResolvedValueOnce(reply({ consent: { ...grant, granted: false, state: 'revoked', notice_version: '3.0.0' } }));
    const estado = await api.revokeFotoPerfilNoAmigos(session);
    expect(estado.granted).toBe(false);
    expect(estado.notice_version).toBe('3.0.0');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(/\/foto_perfil_no_amigos\/revoke$/);
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toEqual({});
  });
  it('username_required conserva su hook y no reintenta ni abre el permiso', async () => {
    const required = vi.fn();
    api.onUsernameRequired(required);
    fetchMock.mockResolvedValueOnce(reply({ error: 'username_required' }, 428));
    await expect(api.getFotoPerfilNoAmigos(session)).rejects.toMatchObject({ status: 428 });
    expect(required).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('una sesión ajena no consulta ni muta', async () => {
    await expect(api.revokeFotoPerfilNoAmigos({ ...session, principal_id: 'otra' })).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('estado privado requiere no-store/Vary; un 404 no se convierte en never', async () => {
    fetchMock.mockResolvedValueOnce(reply({ consent: never }, 200, { vary: '' }));
    await expect(api.getFotoPerfilNoAmigos(session)).rejects.toThrow('private_json_vary_invalid');
    fetchMock.mockResolvedValueOnce(reply({ error: 'unknown_purpose' }, 404));
    await expect(api.getFotoPerfilNoAmigos(session)).rejects.toMatchObject({ status: 404 });
  });
  it('la excepción de ETag de D457 no cambia el default de otras mutaciones privadas', async () => {
    const { httpPrivateJsonMutationRequest } = await import('./http');
    fetchMock.mockResolvedValueOnce(reply({}, 200, { etag: '"e"' }));
    await expect(httpPrivateJsonMutationRequest('/notifications/preferences', {}, session)).rejects.toThrow('private_json_etag_forbidden');
  });
});
