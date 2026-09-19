import { describe, expect, it } from 'vitest';
import {
  desenlaceContinue,
  mensajeContinue,
  versionAvisoParaContinue,
  type AutoridadDeAlta,
  type ClaveMensajeContinue,
} from './LoginScreen';

/**
 * AF-17 · qué hace la pantalla con cada respuesta de `google/continue`
 * (dueño v2.92.0). El recorrido lo prueba `e2e/google-continuar.spec.ts`; acá
 * se fija la decisión, rama por rama.
 */

const PUBLICA: AutoridadDeAlta = { tipo: 'publica' };
const INTENTO = `mock-link-intent-${'a'.repeat(24)}`;
const base = {
  extra: {},
  oneTapSignup: true,
  autoridad: PUBLICA,
  googleRegistration: true,
} as const;

describe('AF-17 · desenlace de «Continuar con Google»', () => {
  it('409 link_required con link_intent bien formado ⇒ paso de contraseña', () => {
    expect(desenlaceContinue({
      ...base, status: 409, code: 'link_required', extra: { link_intent: INTENTO },
    })).toEqual({ tipo: 'vincular', linkIntent: INTENTO });
  });

  it('🔴 409 con un link_intent fuera de contrato ⇒ cartel neutro, no un paso que no puede completarse', () => {
    for (const malo of [undefined, 42, 'corto', 'x'.repeat(201)]) {
      expect(desenlaceContinue({
        ...base, status: 409, code: 'link_required', extra: { link_intent: malo },
      })).toEqual({ tipo: 'mensaje', clave: 'neutro' });
    }
  });

  it('422 profile_required ⇒ el paso de nombre', () => {
    expect(desenlaceContinue({ ...base, status: 422, code: 'profile_required' }))
      .toEqual({ tipo: 'perfil' });
  });

  it('🔴 401 opaco con alta en un toque ⇒ cartel neutro: si hubiera alta, continue ya la habría creado', () => {
    expect(desenlaceContinue({ ...base, status: 401, code: 'social_auth_failed' }))
      .toEqual({ tipo: 'mensaje', clave: 'neutro' });
  });

  it('401 opaco SIN alta en un toque, con autoridad y registro Google ⇒ alta con formulario (0.167.0)', () => {
    expect(desenlaceContinue({
      ...base, oneTapSignup: false, status: 401, code: 'social_auth_failed',
    })).toEqual({ tipo: 'alta_formulario' });
    expect(desenlaceContinue({
      ...base, oneTapSignup: false, autoridad: null, status: 401, code: 'social_auth_failed',
    })).toEqual({ tipo: 'mensaje', clave: 'neutro' });
  });

  it('registration_not_available y los límites conservan su texto; lo demás es neutro', () => {
    expect(desenlaceContinue({ ...base, status: 403, code: 'registration_not_available' }))
      .toEqual({ tipo: 'mensaje', clave: 'registration_not_available' });
    expect(desenlaceContinue({ ...base, status: 429, code: 'too_many_signup_attempts' }))
      .toEqual({ tipo: 'mensaje', clave: 'too_many_signup_attempts' });
    for (const [status, code] of [[503, 'social_auth_failed'], [400, 'validation_error'], [null, 'unknown']] as const) {
      expect(desenlaceContinue({ ...base, status, code })).toEqual({ tipo: 'mensaje', clave: 'neutro' });
    }
  });
});

describe('AF-17 · 🔴 ningún cartel opaco afirma ni niega que exista una cuenta', () => {
  const identidad = (s: string) => s;
  const CLAVES: readonly ClaveMensajeContinue[] = [
    'neutro', 'registration_not_available', 'too_many_auth_attempts', 'too_many_signup_attempts',
  ];
  const REVELA = /no tienes (una )?cuenta|no existe|ya existe|ya tienes una cuenta|no est[aá] registrad|ya est[aá] registrad|cuenta con este correo/i;

  it('la sonda detecta un texto que revela (si no, lo de abajo pasaría en vacío)', () => {
    expect(REVELA.test('Ya tienes una cuenta con este correo.')).toBe(true);
    expect(REVELA.test('No tienes cuenta en PayMe.')).toBe(true);
  });

  for (const clave of CLAVES) {
    it(`«${clave}» no revela existencia`, () => {
      const texto = mensajeContinue(clave, identidad);
      expect(texto.length).toBeGreaterThan(0);
      expect(texto).not.toMatch(REVELA);
    });
  }
});

describe('AF-17 · 🔴 sin una versión de aviso que el dueño acepte, no hay un-toque', () => {
  it('control positivo: X.Y.Z viaja tal cual', () => {
    expect(versionAvisoParaContinue('2.4.1')).toBe('2.4.1');
    expect(versionAvisoParaContinue('0.0.0')).toBe('0.0.0');
  });

  it('AF-19 · el aviso 2.5.0 del dueño viaja como accepted_notice_version sin traducción', () => {
    // El un-toque NO fija versiones: manda la del aviso que cargó del dueño
    // (`legal.value.version`). Con el backend 2.95.0 esa versión es 2.5.0.
    expect(versionAvisoParaContinue('2.5.0')).toBe('2.5.0');
    // AF-24 · y el 2.5.1 del dueño v2.99.0.
    expect(versionAvisoParaContinue('2.5.1')).toBe('2.5.1');
    // AF-25 · y el 2.5.2 del dueño v2.101.0.
    expect(versionAvisoParaContinue('2.5.2')).toBe('2.5.2');
    // AF-32 · y el 2.5.3 del dueño v2.111.0.
    expect(versionAvisoParaContinue('2.5.3')).toBe('2.5.3');
    // n179 · y el texto exacto 2.5.4 para tickets sin QR.
    expect(versionAvisoParaContinue('2.5.4')).toBe('2.5.4');
  });

  it('sin aviso, o con una forma que el dueño rechaza ⇒ null (camino 0.167.0)', () => {
    for (const v of [null, '', '0.0.0-demo-local', '2.4', '2.4.1.0', 'v2.4.1', '12345.1.1']) {
      expect(versionAvisoParaContinue(v), String(v)).toBeNull();
    }
  });
});
