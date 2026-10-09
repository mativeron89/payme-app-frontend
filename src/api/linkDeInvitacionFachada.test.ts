import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * AF-LINK-DE-INVITACION · D252 · la fachada real contra App Backend 2.173.0:
 * los dos endpoints del link y `referral_code` en las cuatro altas (correo y
 * las tres de Google), sólo con `features.invite_link` encendida. Los cuerpos
 * se espían en `fetch`; la respuesta no importa (un 503 que se ignora).
 */
class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}
const local = new MemoryStorage();
const sesion = new MemoryStorage();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: local });
Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: sesion });

const { saveSession } = await import('./storage');
const { api, IS_MOCK } = await import('./index');
const { aplicarConfigLinkDeInvitacion, guardarCodigoDeInvitacion, reiniciarLinkDeInvitacionParaTests } = await import('./linkDeInvitacion');

const CODIGO = 'Ab12Cd34Ef56Gh78';
const encendida = { features: { invite_link: { supported: true, enabled: true } } };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let pedidos: Array<{ method: string; path: string; body: unknown }> = [];

function espiar(responder: (path: string) => Response = () => json({ error: 'service_unavailable' }, 503)) {
  pedidos = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    pedidos.push({ method: init?.method ?? 'GET', path: url.pathname, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    return responder(url.pathname);
  }));
}

beforeEach(() => {
  expect(IS_MOCK).toBe(false);
  local.values.clear();
  sesion.values.clear();
  reiniciarLinkDeInvitacionParaTests();
});
afterEach(() => vi.unstubAllGlobals());

const altas = [
  ['register', '/api/auth/register', () => api.register({ email: 'a@b.mx', password: 'x', first_name: 'A', last_name: 'B' })],
  ['googleRegister', '/api/auth/google/register', () => api.googleRegister({ id_token: 'tok', first_name: 'A', last_name: 'B' } as never)],
  ['googleContinue', '/api/auth/google/continue', () => api.googleContinue({ id_token: 'tok', accepted_notice_version: '3.0.0' })],
  ['googleRedirectSignup', '/api/auth/google/redirect/signup', () => api.googleRedirectSignup({ code: 'c', accepted_notice_version: '3.0.0' })],
] as const;

describe('D252 · `referral_code` en las cuatro altas', () => {
  it.each(altas)('🔴 %s lo manda con la capacidad y el código guardado', async (_n, path, alta) => {
    aplicarConfigLinkDeInvitacion(encendida);
    guardarCodigoDeInvitacion(CODIGO);
    espiar();
    await alta().catch(() => undefined);
    const p = pedidos.find((x) => x.path === path);
    expect(p, path).toBeDefined();
    expect((p!.body as Record<string, unknown>).referral_code).toBe(CODIGO);
  });

  it.each(altas)('🔴 %s no lo manda sin la capacidad (los cuerpos de Google son estrictos)', async (_n, path, alta) => {
    aplicarConfigLinkDeInvitacion({ features: { invite_link: { supported: true, enabled: false } } });
    guardarCodigoDeInvitacion(CODIGO);
    espiar();
    await alta().catch(() => undefined);
    const p = pedidos.find((x) => x.path === path);
    expect(p, path).toBeDefined();
    expect(Object.keys(p!.body as object)).not.toContain('referral_code');
  });

  it.each(altas)('%s sin código guardado no inventa uno', async (_n, path, alta) => {
    aplicarConfigLinkDeInvitacion(encendida);
    espiar();
    await alta().catch(() => undefined);
    expect(Object.keys(pedidos.find((x) => x.path === path)!.body as object)).not.toContain('referral_code');
  });
});

describe('los dos endpoints del link', () => {
  const cuerpo = { code: CODIGO, link: `https://app.paymemx.com/#/invitacion/${CODIGO}`, created_at: '2026-10-09T22:00:00.000Z' };

  beforeEach(() => {
    saveSession({
      access_token: 'a', refresh_token: 'r', family_id: 'family-link', principal_id: 'user-link',
      user: { id: 'user-link', payme_id: 'payme_mx_link', email: 'link@example.com', first_name: 'Yo', last_name: 'Prueba' },
    });
  });

  it('GET /api/friends/invite-link y POST …/revoke, decodificados', async () => {
    aplicarConfigLinkDeInvitacion(encendida);
    espiar(() => json(cuerpo));
    expect(await api.getLinkDeInvitacion()).toEqual({ url: cuerpo.link, codigo: CODIGO, creadoEn: cuerpo.created_at });
    await api.cambiarLinkDeInvitacion();
    expect(pedidos.map((p) => `${p.method} ${p.path}`)).toEqual(['GET /api/friends/invite-link', 'POST /api/friends/invite-link/revoke']);
  });

  it('🔴 una respuesta de otra forma no se muestra', async () => {
    aplicarConfigLinkDeInvitacion(encendida);
    espiar(() => json({ ...cuerpo, referidos: 3 }));
    await expect(api.getLinkDeInvitacion()).rejects.toThrow();
  });

  it('con la capacidad apagada no se pide nada', async () => {
    aplicarConfigLinkDeInvitacion({});
    espiar(() => json(cuerpo));
    await expect(api.getLinkDeInvitacion()).rejects.toThrow('invite_link_not_available');
    await expect(api.cambiarLinkDeInvitacion()).rejects.toThrow('invite_link_not_available');
    expect(pedidos).toEqual([]);
  });
});
