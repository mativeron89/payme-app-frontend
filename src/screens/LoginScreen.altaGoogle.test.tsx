import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ofrecerAltaConGoogle, type AutoridadDeAlta } from './LoginScreen';

/**
 * AF-16 · tocar «Google» en el ingreso sirve también para registrarse.
 *
 * La transición de pantalla la recorre el e2e `google-ingreso-alta.spec.ts`.
 * Acá se fija la DECISIÓN, caso por caso, porque cada término cierra una puerta
 * distinta y un mutante sobre uno deja a los otros sin vigilar.
 */

const PUBLICA: AutoridadDeAlta = { tipo: 'publica' };
const INVITACION: AutoridadDeAlta = { tipo: 'invitacion', token: 'x'.repeat(24) };
const OPACO = { status: 401, code: 'social_auth_failed' } as const;

describe('AF-16 · cuándo el ingreso con Google continúa hacia el alta', () => {
  it('control positivo: 401 opaco + alta pública + registro con Google ⇒ se ofrece', () => {
    expect(ofrecerAltaConGoogle({ ...OPACO, autoridad: PUBLICA, googleRegistration: true })).toBe(true);
  });

  it('control positivo: con una invitación capturada también', () => {
    expect(ofrecerAltaConGoogle({ ...OPACO, autoridad: INVITACION, googleRegistration: true })).toBe(true);
  });

  it('🔴 el dueño no ofrece registro con Google ⇒ NO se ofrece el alta', () => {
    expect(ofrecerAltaConGoogle({ ...OPACO, autoridad: PUBLICA, googleRegistration: false })).toBe(false);
  });

  it('🔴 alta cerrada y sin invitación ⇒ NO se ofrece: sería prometer algo que el dueño rechaza', () => {
    expect(ofrecerAltaConGoogle({ ...OPACO, autoridad: null, googleRegistration: true })).toBe(false);
  });

  it('🔴 un 503 es «no pudimos verificar», no una cuenta sin resolver ⇒ NO se ofrece', () => {
    expect(ofrecerAltaConGoogle({
      status: 503, code: 'social_auth_failed', autoridad: PUBLICA, googleRegistration: true,
    })).toBe(false);
  });

  it('🔴 un 401 con otro código, o un error sin estado, ⇒ NO se ofrece', () => {
    expect(ofrecerAltaConGoogle({
      status: 401, code: 'unauthorized', autoridad: PUBLICA, googleRegistration: true,
    })).toBe(false);
    expect(ofrecerAltaConGoogle({
      status: null, code: 'unknown', autoridad: PUBLICA, googleRegistration: true,
    })).toBe(false);
  });
});

/** El código efectivo, sin comentarios: el que documenta no ejecuta. */
function codigoEfectivo(ruta: string): string {
  return readFileSync(new URL(ruta, import.meta.url), 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

describe('AF-16 · el id_token de Google no se persiste', () => {
  /**
   * El token de un ingreso fallido vive en la memoria del callback: de él sólo
   * salen sugerencias editables. Ni la pantalla ni el decodificador pueden
   * tocar un almacenamiento. El e2e lo mide además en el navegador, sobre los
   * valores reales de `localStorage` y `sessionStorage`.
   */
  const ALMACEN = /\b(?:localStorage|sessionStorage|indexedDB|document\.cookie)\b/;

  it('la sonda detecta un almacenamiento en código efectivo (si no, lo de abajo pasaría en vacío)', () => {
    expect(ALMACEN.test('sessionStorage.setItem("t", credential);')).toBe(true);
  });

  for (const ruta of ['./LoginScreen.tsx', '../api/googleClaims.ts']) {
    it(`🔴 ${ruta} no nombra ningún almacenamiento en su código`, () => {
      expect(ALMACEN.test(codigoEfectivo(ruta))).toBe(false);
    });
  }
});
