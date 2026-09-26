import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GOOGLE_REDIRECT_LOGIN_URI,
  canjearVueltaGoogleRedirectUnaVez,
  capturarVueltaGoogleRedirect,
  leerVueltaGoogleRedirect,
  olvidarVueltaGoogleRedirect,
  resetGoogleRedirectForTests,
  vueltaGoogleRedirectSnapshot,
} from './googleRedirect';
import { readSocialAuthCapability } from './socialAuth';
import { fragmentoConSecreto } from '../router';
import { navegadorFalso } from '../navegadorFalso.testutil';

/**
 * AF-GOOGLE-REDIRECT · decisiones 92 y 94 · la vuelta del ingreso con Google en
 * la misma pestaña (`docs/GOOGLE_REDIRECT_D92_WIRE.md` en el dueño `a8987b0`).
 */

const CODIGO = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCd';

beforeEach(() => resetGoogleRedirectForTests());
afterEach(() => {
  resetGoogleRedirectForTests();
  vi.unstubAllGlobals();
});

describe('leerVueltaGoogleRedirect · el fragmento del 303 del dueño', () => {
  it('el código con la forma del dueño (CODE_RE) es una vuelta para canjear', () => {
    expect(leerVueltaGoogleRedirect(`#google_redirect=${CODIGO}`)).toEqual({ tipo: 'codigo', codigo: CODIGO });
  });

  it('cada error del dueño se reconoce, y ninguno más', () => {
    for (const error of ['csrf_failed', 'social_auth_failed', 'temporarily_unavailable'] as const) {
      expect(leerVueltaGoogleRedirect(`#google_redirect_error=${error}`)).toEqual({ tipo: 'error', error });
    }
    expect(leerVueltaGoogleRedirect('#google_redirect_error=otro')).toEqual({ tipo: 'invalida' });
  });

  it('forma de vuelta con un valor que no es del dueño ⇒ inválida (se limpia y no se canjea)', () => {
    for (const hash of ['#google_redirect=corto', '#google_redirect=con espacio aaaaaaaaaaaaaaaaaaaa',
      `#google_redirect=${CODIGO}&google_redirect_error=csrf_failed`, `#google_redirect=${CODIGO}&x=1`,
      '#google_redirect=']) {
      expect(leerVueltaGoogleRedirect(hash), hash).toEqual({ tipo: 'invalida' });
    }
  });

  it('cualquier otro fragmento no es asunto de este módulo', () => {
    for (const hash of ['', '#', '#/mesas', '#/recovery?token=x', '#/mesa/PA-1?t=tok', '#x=google_redirect=1']) {
      expect(leerVueltaGoogleRedirect(hash), hash).toEqual({ tipo: 'nada' });
    }
  });
});

describe('capturarVueltaGoogleRedirect · replaceState ANTES del canje, y el código sólo en memoria', () => {
  it('saca el fragmento de la URL sin entrada en el historial, y conserva path y query', () => {
    const nav = navegadorFalso(`/#google_redirect=${CODIGO}`);
    capturarVueltaGoogleRedirect();
    expect(nav.url()).toBe('/');
    expect(nav.replaceState).toHaveBeenCalledTimes(1);
    expect(nav.pushState).not.toHaveBeenCalled();
    expect(nav.hashWrites).toEqual([]);
    expect(vueltaGoogleRedirectSnapshot()).toEqual({ estado: 'codigo' });
  });

  it('el snapshot nunca lleva el código', () => {
    navegadorFalso(`/#google_redirect=${CODIGO}`);
    capturarVueltaGoogleRedirect();
    expect(JSON.stringify(vueltaGoogleRedirectSnapshot())).not.toContain(CODIGO);
  });

  it('un error también sale de la URL y queda en el snapshot', () => {
    const nav = navegadorFalso('/#google_redirect_error=csrf_failed');
    capturarVueltaGoogleRedirect();
    expect(nav.url()).toBe('/');
    expect(vueltaGoogleRedirectSnapshot()).toEqual({ estado: 'error', error: 'csrf_failed' });
  });

  it('una vuelta inválida sale de la URL y no deja nada para canjear', async () => {
    const nav = navegadorFalso('/#google_redirect=corto');
    capturarVueltaGoogleRedirect();
    expect(nav.url()).toBe('/');
    expect(vueltaGoogleRedirectSnapshot()).toEqual({ estado: 'invalida' });
    const canjear = vi.fn(async () => undefined);
    await expect(canjearVueltaGoogleRedirectUnaVez(canjear)).rejects.toThrow('google_redirect_sin_codigo');
    expect(canjear).not.toHaveBeenCalled();
  });

  it('sin vuelta no toca la URL', () => {
    const nav = navegadorFalso('/mesas?r=x#algo');
    capturarVueltaGoogleRedirect();
    expect(nav.replaceState).not.toHaveBeenCalled();
    expect(vueltaGoogleRedirectSnapshot()).toEqual({ estado: 'ausente' });
  });

  it('🔴 si el historial no deja sacarla, falla cerrado: no hay código para canjear', async () => {
    navegadorFalso(`/#google_redirect=${CODIGO}`, { historialBloqueado: true });
    expect(() => capturarVueltaGoogleRedirect()).toThrow('google_redirect_cleanup_failed');
    const canjear = vi.fn(async () => undefined);
    await expect(canjearVueltaGoogleRedirectUnaVez(canjear)).rejects.toThrow();
    expect(canjear).not.toHaveBeenCalled();
  });

  it('🔴 el canje ocurre con la URL ya limpia', async () => {
    const nav = navegadorFalso(`/#google_redirect=${CODIGO}`);
    capturarVueltaGoogleRedirect();
    let urlAlCanjear = '';
    await canjearVueltaGoogleRedirectUnaVez(async () => { urlAlCanjear = nav.url(); });
    expect(urlAlCanjear).toBe('/');
  });
});

describe('canjearVueltaGoogleRedirectUnaVez · una sola vez', () => {
  it('dos llamados (StrictMode) comparten la promesa y canjean UNA vez', async () => {
    navegadorFalso(`/#google_redirect=${CODIGO}`);
    capturarVueltaGoogleRedirect();
    const canjear = vi.fn(async (_codigo: string) => undefined);
    const a = canjearVueltaGoogleRedirectUnaVez(canjear);
    const b = canjearVueltaGoogleRedirectUnaVez(canjear);
    expect(b).toBe(a);
    await a;
    expect(canjear).toHaveBeenCalledTimes(1);
    expect(canjear).toHaveBeenCalledWith(CODIGO);
  });

  it('olvidar la vuelta deja el snapshot ausente', () => {
    navegadorFalso('/#google_redirect_error=temporarily_unavailable');
    capturarVueltaGoogleRedirect();
    olvidarVueltaGoogleRedirect();
    expect(vueltaGoogleRedirectSnapshot()).toEqual({ estado: 'ausente' });
  });
});

describe('el código nunca termina en path ni query', () => {
  it('el router lo cuenta como secreto: no lo convierte en ruta aunque la captura fallara', () => {
    expect(fragmentoConSecreto(`#google_redirect=${CODIGO}`)).toBe(true);
    expect(fragmentoConSecreto('#google_redirect_error=csrf_failed')).toBe(true);
  });

  it('🔴 main.tsx captura la vuelta antes que las demás capturas y antes de montar React', () => {
    const main = readFileSync(new URL('../main.tsx', import.meta.url), 'utf8');
    const captura = main.indexOf('capturarVueltaGoogleRedirect();');
    expect(captura).toBeGreaterThan(-1);
    expect(captura).toBeLessThan(main.indexOf('bootstrapRecoveryTokenCapture();'));
    expect(captura).toBeLessThan(main.indexOf("document.getElementById('root')"));
    expect(captura).toBeLessThan(main.indexOf('createRoot(el).render('));
  });

  it('el módulo no escribe storage ni loguea', () => {
    const fuente = readFileSync(new URL('./googleRedirect.ts', import.meta.url), 'utf8');
    expect(fuente).not.toMatch(/localStorage|sessionStorage|indexedDB|console\./);
  });
});

describe('features.google_redirect · capability del dueño', () => {
  const baseConfig = () => ({
    features: {
      social_auth: {
        google_sign_in: { enabled: true, registration: true, login: true, linking: true, web_client_id: 'cid-123' },
        facebook_sign_in: { enabled: false, registration: false, login: false, app_id: null, redirect_uri: null },
        recovery_email: { enabled: true, completion_route: '#/recovery' },
        password_login: { enabled: true },
      },
    } as Record<string, unknown>,
  });

  it('forma exacta del dueño: enabled vivo', () => {
    const config = baseConfig();
    config.features.google_redirect = { supported: true, enabled: true };
    expect(readSocialAuthCapability(config).googleRedirect).toEqual({ enabled: true });
    config.features.google_redirect = { supported: true, enabled: false };
    expect(readSocialAuthCapability(config).googleRedirect).toEqual({ enabled: false });
  });

  it('🔴 ausente, con una clave de más o mal tipada ⇒ popup, y el login con Google NO se apaga', () => {
    for (const raro of [undefined, null, {}, { enabled: true }, { supported: true },
      { supported: true, enabled: 'true' }, { supported: false, enabled: true },
      { supported: true, enabled: true, extra: 1 }]) {
      const config = baseConfig();
      if (raro !== undefined) config.features.google_redirect = raro;
      const estado = readSocialAuthCapability(config);
      expect(estado.googleRedirect, JSON.stringify(raro)).toEqual({ enabled: false });
      expect(estado.status).toBe('authoritative');
      expect(estado.google.login).toBe(true);
    }
  });

  it('sin login con Google del dueño, el redirect no existe aunque se publique', () => {
    const config = baseConfig();
    (config.features.social_auth as { google_sign_in: Record<string, unknown> }).google_sign_in = {
      enabled: false, registration: false, login: false, linking: false, web_client_id: null,
    };
    config.features.google_redirect = { supported: true, enabled: true };
    expect(readSocialAuthCapability(config).googleRedirect).toEqual({ enabled: false });
  });

  it('el login_uri es el registrado en Google Cloud, idéntico al contrato espejado', () => {
    const contrato = JSON.parse(readFileSync(
      new URL('../../contract-mirror/contract/social-auth-v1.json', import.meta.url), 'utf8',
    )) as { google_redirect_flow: { login_uri: string } };
    expect(GOOGLE_REDIRECT_LOGIN_URI).toBe('https://app.paymemx.com/auth/google/redirect');
    expect(GOOGLE_REDIRECT_LOGIN_URI).toBe(contrato.google_redirect_flow.login_uri);
  });
});
