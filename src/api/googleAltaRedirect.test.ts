import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLAVE_CONTEXTO_ALTA,
  borrarContextoAlta,
  canjearAltaGoogle,
  capturarVueltaAltaGoogle,
  codigoSigueVivo,
  decodeContextoAlta,
  esEstadoDeAlta,
  estadoDeAlta,
  guardarContextoAlta,
  hayCodigoAlta,
  leerContextoAlta,
  leerVueltaAltaGoogle,
  olvidarCodigoAlta,
  resetGoogleAltaRedirectForTests,
  vueltaAltaSnapshot,
} from './googleAltaRedirect';
import { readSocialAuthCapability } from './socialAuth';
import { fragmentoConSecreto } from '../router';
import { navegadorFalso } from '../navegadorFalso.testutil';

/**
 * AF-GOOGLE-ALTA-REDIRECT · decisión 102 · «Crea tu cuenta» con Google en la
 * misma pestaña (`docs/GOOGLE_ALTA_REDIRECT_D102_WIRE.md` en el dueño `e81b7c2`).
 */

const CODIGO = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCd';
const ACEPTACION = {
  aviso_version: '2.5.5', aviso_hash: 'a'.repeat(64),
  terminos_version: '1.0.0', terminos_hash: 'd'.repeat(64), adult_declaration: true as const,
};

beforeEach(() => resetGoogleAltaRedirectForTests());
afterEach(() => {
  resetGoogleAltaRedirectForTests();
  vi.unstubAllGlobals();
});

describe('el state del botón de alta (wire §2)', () => {
  it('es «alta:» seguido de 1 a 100 de [A-Za-z0-9_-]; un UUID sirve', () => {
    const estado = estadoDeAlta();
    expect(estado).toMatch(/^alta:[0-9a-f-]{36}$/);
    expect(esEstadoDeAlta(estado)).toBe(true);
    expect(esEstadoDeAlta(`alta:${'x'.repeat(100)}`)).toBe(true);
  });

  it('cualquier otra cosa no es de alta (el dueño la toma como «Entrar»)', () => {
    for (const malo of ['', 'alta:', `alta:${'x'.repeat(101)}`, 'alta:con espacio', 'ALTA:abc', 'abc', 'alta:a.b']) {
      expect(esEstadoDeAlta(malo), malo).toBe(false);
    }
    expect(() => estadoDeAlta('con espacio')).toThrow('google_alta_state_invalido');
  });
});

describe('leerVueltaAltaGoogle · #google_signup=<código> (wire §4)', () => {
  it('el código con la forma del dueño es una vuelta para canjear', () => {
    expect(leerVueltaAltaGoogle(`#google_signup=${CODIGO}`)).toEqual({ tipo: 'codigo', codigo: CODIGO });
  });

  it('corto, con otra clave o con espacios es inválida', () => {
    for (const hash of ['#google_signup=corto', `#google_signup=${CODIGO}&x=1`,
      '#google_signup=con espacio aaaaaaaaaaaaaaaaaaaaaa', `#google_signup=${'a'.repeat(201)}`]) {
      expect(leerVueltaAltaGoogle(hash), hash).toEqual({ tipo: 'invalida' });
    }
  });

  it('lo demás no es de ella (la fase 1 y sus errores los lee `googleRedirect.ts`)', () => {
    for (const hash of ['', '#', '#/mesas', `#google_redirect=${CODIGO}`, '#google_redirect_error=csrf_failed']) {
      expect(leerVueltaAltaGoogle(hash), hash).toEqual({ tipo: 'nada' });
    }
  });
});

describe('capturarVueltaAltaGoogle · replaceState ANTES del canje y el código sólo en memoria', () => {
  it('saca el fragmento sin entrada en el historial, conserva path y query, y el snapshot no lleva el código', () => {
    const nav = navegadorFalso(`/?r=1#google_signup=${CODIGO}`);
    capturarVueltaAltaGoogle();
    expect(nav.url()).toBe('/?r=1');
    expect(nav.replaceState).toHaveBeenCalledTimes(1);
    expect(nav.pushState).not.toHaveBeenCalled();
    expect(vueltaAltaSnapshot()).toEqual({ estado: 'codigo' });
    expect(JSON.stringify(vueltaAltaSnapshot())).not.toContain(CODIGO);
    expect(hayCodigoAlta()).toBe(true);
  });

  it('una vuelta inválida sale de la URL y no deja código', () => {
    const nav = navegadorFalso('/#google_signup=corto');
    capturarVueltaAltaGoogle();
    expect(nav.url()).toBe('/');
    expect(vueltaAltaSnapshot()).toEqual({ estado: 'invalida' });
    expect(hayCodigoAlta()).toBe(false);
  });

  it('🔴 si el historial no deja sacarla, falla cerrado: no hay código para canjear', async () => {
    navegadorFalso(`/#google_signup=${CODIGO}`, { historialBloqueado: true });
    expect(() => capturarVueltaAltaGoogle()).toThrow('google_signup_cleanup_failed');
    const canjear = vi.fn(async () => undefined);
    await expect(canjearAltaGoogle(canjear)).rejects.toThrow('google_signup_sin_codigo');
    expect(canjear).not.toHaveBeenCalled();
  });

  it('sin vuelta no toca la URL', () => {
    const nav = navegadorFalso('/mesas?r=x#algo');
    capturarVueltaAltaGoogle();
    expect(nav.replaceState).not.toHaveBeenCalled();
    expect(vueltaAltaSnapshot()).toEqual({ estado: 'ausente' });
  });
});

describe('canjearAltaGoogle · el mismo código mientras siga vivo', () => {
  it('canjea con la URL ya limpia y con el código capturado', async () => {
    const nav = navegadorFalso(`/#google_signup=${CODIGO}`);
    capturarVueltaAltaGoogle();
    let urlAlCanjear = '';
    const canjear = vi.fn(async (codigo: string) => { urlAlCanjear = nav.url(); return codigo; });
    await canjearAltaGoogle(canjear);
    expect(urlAlCanjear).toBe('/');
    expect(canjear).toHaveBeenCalledWith(CODIGO);
  });

  it('dos llamados a la vez (StrictMode) comparten la promesa', async () => {
    navegadorFalso(`/#google_signup=${CODIGO}`);
    capturarVueltaAltaGoogle();
    const canjear = vi.fn(async () => 'ok');
    const a = canjearAltaGoogle(canjear);
    const b = canjearAltaGoogle(canjear);
    expect(b).toBe(a);
    await a;
    expect(canjear).toHaveBeenCalledTimes(1);
  });

  it('🔴 un error NO suelta el código: el reintento (422, 429…) usa el mismo', async () => {
    navegadorFalso(`/#google_signup=${CODIGO}`);
    capturarVueltaAltaGoogle();
    await expect(canjearAltaGoogle(async () => { throw new Error('profile_required'); })).rejects.toThrow();
    expect(hayCodigoAlta()).toBe(true);
    const segundo = vi.fn(async (codigo: string) => codigo);
    await expect(canjearAltaGoogle(segundo)).resolves.toBe(CODIGO);
  });

  it('olvidar lo suelta de la memoria y el snapshot queda ausente', async () => {
    navegadorFalso(`/#google_signup=${CODIGO}`);
    capturarVueltaAltaGoogle();
    olvidarCodigoAlta();
    expect(hayCodigoAlta()).toBe(false);
    expect(vueltaAltaSnapshot()).toEqual({ estado: 'ausente' });
    await expect(canjearAltaGoogle(async () => 'x')).rejects.toThrow('google_signup_sin_codigo');
  });
});

describe('codigoSigueVivo · la tabla del wire §5', () => {
  it.each([
    [422, 'profile_required', true],
    [429, 'too_many_signup_attempts', true],
    [429, 'too_many_auth_attempts', true],
    [503, 'registration_unavailable', true],
    [503, 'legal_text_unavailable', true],
    [503, 'rate_limit_unavailable', true],
    [409, 'legal_version_mismatch', true],
    [409, 'link_required', false],
    [401, 'social_auth_failed', false],
    [403, 'registration_not_available', false],
    [404, 'not_found', false],
    [400, 'validation_error', false],
    [null, 'unknown', false],
  ])('%s %s → vivo: %s', (status, code, vivo) => {
    expect(codigoSigueVivo(status, code)).toBe(vivo);
  });
});

describe('el contexto del alta en sessionStorage (wire §3)', () => {
  class MemoryStorage {
    values = new Map<string, string>();
    getItem(k: string) { return this.values.get(k) ?? null; }
    setItem(k: string, v: string) { this.values.set(k, v); }
    removeItem(k: string) { this.values.delete(k); }
  }

  it('guarda, lee y borra lo que viaja al canje; nunca un código', () => {
    const almacen = new MemoryStorage();
    vi.stubGlobal('window', { sessionStorage: almacen });
    const ctx = { accepted_notice_version: '2.5.5', legal_acceptance: ACEPTACION, invitation_token: 'i'.repeat(24) };
    guardarContextoAlta(ctx);
    expect(leerContextoAlta()).toEqual(ctx);
    expect(almacen.getItem(CLAVE_CONTEXTO_ALTA)).not.toMatch(/code|google_signup/);
    borrarContextoAlta();
    expect(leerContextoAlta()).toBeNull();
  });

  it('sin sessionStorage (bloqueado) no rompe: no hay contexto y al volver se piden las casillas', () => {
    vi.stubGlobal('window', { get sessionStorage() { throw new Error('SecurityError'); } });
    expect(() => guardarContextoAlta({ accepted_notice_version: '2.5.5' })).not.toThrow();
    expect(leerContextoAlta()).toBeNull();
  });

  it('decodifica fail-closed: cualquier forma rara es «no hay contexto»', () => {
    expect(decodeContextoAlta({ accepted_notice_version: '2.5.5' })).toEqual({ accepted_notice_version: '2.5.5' });
    expect(decodeContextoAlta({ accepted_notice_version: '2.5.5', first_name: 'Ana', last_name: 'Paz' }))
      .toEqual({ accepted_notice_version: '2.5.5', first_name: 'Ana', last_name: 'Paz' });
    for (const malo of [
      null, [], 'x', {},
      { accepted_notice_version: 'dos' },
      { accepted_notice_version: '2.5.5', code: CODIGO },
      { accepted_notice_version: '2.5.5', id_token: 'x' },
      { accepted_notice_version: '2.5.5', first_name: 'Ana' },
      { accepted_notice_version: '2.5.5', invitation_token: '' },
      { accepted_notice_version: '2.5.5', legal_acceptance: { ...ACEPTACION, adult_declaration: false } },
      { accepted_notice_version: '2.5.5', legal_acceptance: { ...ACEPTACION, extra: 1 } },
    ]) {
      expect(decodeContextoAlta(malo), JSON.stringify(malo)).toBeNull();
    }
  });
});

describe('features.google_redirect_signup · capability del dueño (wire §1)', () => {
  const baseConfig = () => ({
    features: {
      social_auth: {
        google_sign_in: { enabled: true, registration: true, login: true, linking: true, web_client_id: 'cid-123' },
        facebook_sign_in: { enabled: false, registration: false, login: false, app_id: null, redirect_uri: null },
        recovery_email: { enabled: true, completion_route: '#/recovery' },
        password_login: { enabled: true },
      },
      google_redirect: { supported: true, enabled: true },
    } as Record<string, unknown>,
  });

  it('forma exacta del dueño: enabled vivo', () => {
    const config = baseConfig();
    config.features.google_redirect_signup = { supported: true, enabled: true };
    expect(readSocialAuthCapability(config).googleRedirectSignup).toEqual({ enabled: true });
    config.features.google_redirect_signup = { supported: true, enabled: false };
    expect(readSocialAuthCapability(config).googleRedirectSignup).toEqual({ enabled: false });
  });

  it('🔴 ausente, con una clave de más o mal tipada ⇒ el popup de hoy', () => {
    for (const raro of [undefined, null, {}, { enabled: true }, { supported: false, enabled: true },
      { supported: true, enabled: 'true' }, { supported: true, enabled: true, extra: 1 }]) {
      const config = baseConfig();
      if (raro !== undefined) config.features.google_redirect_signup = raro;
      expect(readSocialAuthCapability(config).googleRedirectSignup, JSON.stringify(raro)).toEqual({ enabled: false });
    }
  });

  it('cuelga de la fase 1: sin «Entrar» en redirect, el alta en redirect no existe aunque se publique', () => {
    const config = baseConfig();
    config.features.google_redirect = { supported: true, enabled: false };
    config.features.google_redirect_signup = { supported: true, enabled: true };
    expect(readSocialAuthCapability(config).googleRedirectSignup).toEqual({ enabled: false });
  });
});

describe('el código nunca termina en storage, logs, path ni query', () => {
  it('el router lo cuenta como secreto: no lo convierte en ruta aunque la captura fallara', () => {
    expect(fragmentoConSecreto(`#google_signup=${CODIGO}`)).toBe(true);
  });

  it('main.tsx captura la vuelta del alta antes de montar React', () => {
    const main = readFileSync(new URL('../main.tsx', import.meta.url), 'utf8');
    const captura = main.indexOf('capturarVueltaAltaGoogle();');
    expect(captura).toBeGreaterThan(-1);
    expect(captura).toBeLessThan(main.indexOf("document.getElementById('root')"));
  });

  it('el módulo no loguea, y el storage que toca es sólo sessionStorage, para el contexto', () => {
    const fuente = readFileSync(new URL('./googleAltaRedirect.ts', import.meta.url), 'utf8');
    expect(fuente).not.toMatch(/console\.|localStorage|indexedDB/);
    // El único setItem es el del contexto, con su clave.
    expect(fuente.match(/setItem\(/g)).toHaveLength(1);
    expect(fuente).toContain('setItem(CLAVE_CONTEXTO_ALTA, JSON.stringify(ctx))');
  });
});
