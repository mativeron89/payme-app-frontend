import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLAVES_INICIO_GOOGLE,
  base64url,
  borrarInicioGoogle,
  challengeDe,
  iniciarIngresoGoogle,
  leerInicioGoogle,
  nuevoVerifier,
  tomarInicioGoogle,
  verifierDe,
} from './googleRedirectInicio';
import { readSocialAuthCapability } from './socialAuth';

/** D268 · S-02 · el ingreso con Google por redirect, atado al navegador que lo empezó (App Backend 2.178.0). */
class Memoria {
  values = new Map<string, string>();
  getItem(k: string) { return this.values.get(k) ?? null; }
  setItem(k: string, v: string) { this.values.set(k, v); }
  removeItem(k: string) { this.values.delete(k); }
}
let sesion: Memoria;
beforeEach(() => {
  sesion = new Memoria();
  vi.stubGlobal('window', { sessionStorage: sesion });
});
afterEach(() => vi.unstubAllGlobals());

describe('🔴 el par PKCE, como el dueño', () => {
  it('el vector de RFC 7636: challenge = base64url(SHA-256(verifier)), sin relleno', async () => {
    expect(await challengeDe('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('el verifier: 32 bytes aleatorios en base64url, 43 caracteres del alfabeto del dueño, distinto cada vez', () => {
    const a = nuevoVerifier();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(nuevoVerifier()).not.toBe(a);
    expect(base64url(new Uint8Array([251, 255]))).toBe('-_8');
  });
});

describe('🔴 al dibujar el botón', () => {
  it('con el binding: «Entrar» manda `entrar:<challenge>` y guarda el verifier de ESE challenge', async () => {
    const state = await iniciarIngresoGoogle('entrar', true);
    expect(state).toMatch(/^entrar:[A-Za-z0-9_-]{43}$/);
    const inicio = leerInicioGoogle('entrar');
    expect(inicio).toMatchObject({ binding: true });
    expect(`entrar:${await challengeDe((inicio as { verifier: string }).verifier)}`).toBe(state);
    // El verifier no viaja en el state.
    expect(state).not.toContain((inicio as { verifier: string }).verifier);
  });

  it('con el binding: «Crea tu cuenta» manda `crear:<challenge>`, con su propia clave', async () => {
    const state = await iniciarIngresoGoogle('crear', true);
    expect(state).toMatch(/^crear:[A-Za-z0-9_-]{43}$/);
    expect(leerInicioGoogle('crear')).toMatchObject({ binding: true });
    expect(leerInicioGoogle('entrar')).toBeNull();
  });

  it('sin el binding (dueño anterior): «Entrar» sin state y «Crea tu cuenta» con `alta:<id>`, con el registro «sin binding»', async () => {
    expect(await iniciarIngresoGoogle('entrar', false)).toBeUndefined();
    expect(leerInicioGoogle('entrar')).toEqual({ binding: false });
    expect(await iniciarIngresoGoogle('crear', false)).toMatch(/^alta:[0-9a-f-]{36}$/);
    expect(leerInicioGoogle('crear')).toEqual({ binding: false });
  });

  it('🔴 con el binding y sin sessionStorage: falla, no se degrada a un código suelto', async () => {
    vi.stubGlobal('window', { get sessionStorage(): Storage { throw new Error('bloqueado'); } });
    await expect(iniciarIngresoGoogle('entrar', true)).rejects.toThrow('google_redirect_sin_storage');
  });

  it('cada botón nuevo reemplaza el par anterior', async () => {
    const primero = await iniciarIngresoGoogle('entrar', true);
    const segundo = await iniciarIngresoGoogle('entrar', true);
    expect(segundo).not.toBe(primero);
    expect(`entrar:${await challengeDe((leerInicioGoogle('entrar') as { verifier: string }).verifier)}`).toBe(segundo);
  });
});

describe('🔴 al volver', () => {
  it('«tomar» lee y borra: el canje de «Entrar» es de un solo uso', async () => {
    await iniciarIngresoGoogle('entrar', true);
    expect(tomarInicioGoogle('entrar')).toMatchObject({ binding: true });
    expect(tomarInicioGoogle('entrar')).toBeNull();
  });

  it('fail-closed: una forma rara es «no se empezó acá»', () => {
    for (const raro of ['{', '[]', 'null', '{"binding":true}', '{"binding":true,"verifier":"corto"}',
      '{"binding":false,"verifier":"x"}', '{"binding":"false"}', `{"binding":true,"verifier":"${'a'.repeat(129)}"}`,
      // Una clave de más tampoco: el registro tiene exactamente las suyas.
      `{"binding":true,"verifier":"${'a'.repeat(43)}","challenge":"x"}`, '{"binding":false,"verifier":null}']) {
      sesion.setItem(CLAVES_INICIO_GOOGLE.entrar, raro);
      expect(leerInicioGoogle('entrar'), raro).toBeNull();
    }
    sesion.setItem(CLAVES_INICIO_GOOGLE.entrar, `{"binding":true,"verifier":"${'a'.repeat(43)}"}`);
    expect(leerInicioGoogle('entrar')).toEqual({ binding: true, verifier: 'a'.repeat(43) });
    borrarInicioGoogle('entrar');
    expect(leerInicioGoogle('entrar')).toBeNull();
  });

  it('al canje viaja el verifier sólo si el ingreso lo tiene', () => {
    expect(verifierDe({ binding: true, verifier: 'v'.repeat(43) })).toEqual({ verifier: 'v'.repeat(43) });
    expect(verifierDe({ binding: false })).toEqual({});
  });

  it('🔴 el módulo guarda sólo en sessionStorage, nunca el código, y no loguea', () => {
    const fuente = readFileSync(new URL('./googleRedirectInicio.ts', import.meta.url), 'utf8');
    expect(fuente).not.toMatch(/localStorage|indexedDB|console\./);
    expect(fuente).not.toMatch(/setItem\([^)]*codigo/i);
  });
});

describe('🔴 D268 · features.google_redirect_binding, claves exactas', () => {
  const config = (binding?: unknown) => ({
    features: {
      social_auth: {
        google_sign_in: { enabled: true, registration: true, login: true, linking: true, web_client_id: 'cid-123' },
        facebook_sign_in: { enabled: false, registration: false, login: false, app_id: null, redirect_uri: null },
        recovery_email: { enabled: true, completion_route: '#/recovery' },
        password_login: { enabled: true },
      },
      ...(binding === undefined ? {} : { google_redirect_binding: binding }),
    },
  });

  it('`{ supported: true }` ⇒ con binding; ausente o con otra forma ⇒ sin binding', () => {
    expect(readSocialAuthCapability(config({ supported: true })).googleRedirectBinding).toBe(true);
    for (const malo of [undefined, null, {}, { supported: 'true' }, { supported: false }, { supported: true, enabled: true }, [true]]) {
      const estado = readSocialAuthCapability(config(malo));
      expect(estado.googleRedirectBinding, JSON.stringify(malo)).toBe(false);
      // Sin binding no se apaga nada más: el login con Google sigue.
      expect(estado.status).toBe('authoritative');
      expect(estado.google.login).toBe(true);
    }
  });
});

describe('🔴 D268 · AuthContext: la vuelta de otro navegador, o con la sesión abierta, no se canjea', () => {
  const auth = readFileSync(new URL('../auth/AuthContext.tsx', import.meta.url), 'utf8');

  it('la sesión arranca descartando las vueltas (las dos) si ya hay sesión, antes del primer cuadro', () => {
    expect(auth).toContain('useState<StoredSession | null>(sesionInicialSinVueltaAjena)');
    const f = auth.slice(auth.indexOf('function sesionInicialSinVueltaAjena'), auth.indexOf('function vueltaGoogleInicial'));
    expect(f).toMatch(/if \(sesion && vueltaGoogleRedirectSnapshot\(\)\.estado === 'codigo'\) \{\s*descartarVueltaGoogleRedirect\(\);\s*borrarInicioGoogle\('entrar'\);/);
    expect(f).toMatch(/if \(sesion && vueltaAltaSnapshot\(\)\.estado === 'codigo'\) \{\s*olvidarCodigoAlta\(\);\s*borrarInicioGoogle\('crear'\);/);
  });

  it('el canje toma el registro de inicio ANTES de canjear; sin él, descarta y no canjea', () => {
    const toma = auth.indexOf("tomarInicioGoogle('entrar')");
    const sin = auth.indexOf('if (!inicio) {', toma);
    const canje = auth.indexOf('canjearVueltaGoogleRedirectUnaVez(', toma);
    expect(toma).toBeGreaterThan(-1);
    expect(sin).toBeGreaterThan(toma);
    expect(canje).toBeGreaterThan(sin);
    expect(auth.slice(sin, canje)).toContain('descartarVueltaGoogleRedirect();');
    expect(auth.slice(sin, canje)).toContain('return;');
    expect(auth.slice(canje, canje + 200)).toContain('inicio.binding ? inicio.verifier : undefined');
  });
});
