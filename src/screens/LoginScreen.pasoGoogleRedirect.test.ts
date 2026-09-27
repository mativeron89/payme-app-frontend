import { describe, expect, it } from 'vitest';
import { pasoGoogleEnRedirect } from './LoginScreen';

/**
 * AF-HIGIENE-ALTA · punto 4 · el paso «Crea tu cuenta con Google» (tras
 * «Entrar» sin cuenta) va en redirect sólo con TODAS sus condiciones. Un caso
 * por término: un mutante sobre uno dejaría a los otros sin vigilar. La
 * transición de pantalla la recorre `e2e/google-alta-tras-error.spec.ts`.
 */

const TODO = {
  pasoGoogle: true,
  tieneCredencial: false,
  perfilGoogle: false,
  altaRedirect: true,
  continueSupported: true,
  oneTapSignup: true,
  avisoListo: true,
  versionContinue: '2.5.6',
} as const;

describe('AF-HIGIENE-ALTA · cuándo el paso de Google tras el error va en redirect', () => {
  it('control positivo: todo encendido y el aviso con una versión que `continue` acepta ⇒ redirect', () => {
    expect(pasoGoogleEnRedirect(TODO)).toBe(true);
  });

  it('mientras el aviso carga ⇒ redirect (sin botón todavía): nunca el `register` en popup', () => {
    expect(pasoGoogleEnRedirect({ ...TODO, avisoListo: false, versionContinue: null })).toBe(true);
  });

  it('🔴 aviso cargado con una versión que `continue` NO acepta ⇒ el paso de siempre, no un callejón', () => {
    expect(pasoGoogleEnRedirect({ ...TODO, versionContinue: null })).toBe(false);
  });

  it.each([
    ['no es ese paso', { pasoGoogle: false }],
    ['ya hay un id_token retenido («Crear mi cuenta»)', { tieneCredencial: true }],
    ['hay un 422 de `continue` en curso (pide el nombre)', { perfilGoogle: true }],
    ['el alta en la misma pestaña está apagada (apagado = igual que antes)', { altaRedirect: false }],
    ['el dueño no publica «Continuar con Google»', { continueSupported: false }],
    ['el dueño no publica el alta en un toque', { oneTapSignup: false }],
  ] as const)('🔴 %s ⇒ no', (_l, cambio) => {
    expect(pasoGoogleEnRedirect({ ...TODO, ...cambio })).toBe(false);
  });
});
