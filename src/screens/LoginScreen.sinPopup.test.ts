import { describe, expect, it } from 'vitest';
import { abreGoogleEnPopup, type GoogleActionAuthority } from './LoginScreen';

/**
 * AF-ALTA-POPUP-D106 · con `google_redirect_signup` encendido la pantalla no
 * dibuja ningún botón para el que esto dé `true`. Un caso por propósito y por
 * modo: un mutante sobre uno dejaría a los otros sin vigilar. El recorrido por
 * pantalla lo hace `e2e/google-sin-popup-d106.spec.ts`.
 */

const base = { clientId: 'google-web-client-id', locale: 'es' } as const;
const continuar = (redirectAlta: boolean): GoogleActionAuthority => ({
  ...base,
  purpose: 'continue',
  noticeVersion: '2.5.6',
  invitationToken: null,
  nombre: null,
  redirectAlta,
});

describe('AF-ALTA-POPUP-D106 · qué botón abre Google en una ventana aparte', () => {
  it.each<[string, GoogleActionAuthority, boolean]>([
    ['«Entrar» en la misma pestaña', { ...base, purpose: 'login', redirect: true }, false],
    ['«Entrar» en popup', { ...base, purpose: 'login', redirect: false }, true],
    ['alta en un toque en la misma pestaña', continuar(true), false],
    ['alta en un toque en popup', continuar(false), true],
    ['la «captura» del alta (siempre popup)', { ...base, purpose: 'captura' }, true],
    ['el alta con los datos del formulario (siempre popup)', {
      ...base,
      purpose: 'register',
      alta: { tipo: 'publica', email: 'ana@example.com' },
      firstName: 'Ana',
      lastName: 'Demo',
    }, true],
  ])('%s', (_nombre, autoridad, esperado) => {
    expect(abreGoogleEnPopup(autoridad)).toBe(esperado);
  });
});
