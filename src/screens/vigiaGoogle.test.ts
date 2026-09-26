import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EN } from '../i18n/en';

/**
 * RM-182 · decisión 97 de Mati (AF-NOMBRE-COMPACTO): el aviso 5b bajo el botón
 * de Google («Si entraste con Google y quieres usar otra cuenta…») se retiró.
 * Con Google en la misma pestaña, cambiar de cuenta funciona.
 *
 * Reemplaza a `AvisoGoogleOtraCuenta.test.tsx`: fija que el aviso NO está, y
 * conserva la guarda del vigía 5a, que sigue sólo como log.
 */
const TEXTO = 'Si entraste con Google y quieres usar otra cuenta, cierra sesión de Google en Safari y vuelve a intentar.';
const login = readFileSync(new URL('./LoginScreen.tsx', import.meta.url), 'utf8');

describe('RM-182 · 5b · el aviso de Google «otra cuenta» no está (decisión 97)', () => {
  it('ni el componente, ni su uso, ni su texto, ni su traducción', () => {
    expect(existsSync(new URL('./AvisoGoogleOtraCuenta.tsx', import.meta.url))).toBe(false);
    expect(login).not.toContain('AvisoGoogleOtraCuenta');
    expect(login).not.toContain('google-otra-cuenta');
    expect(login).not.toContain(TEXTO);
    expect(Object.keys(EN)).not.toContain(TEXTO);
  });
});

describe('RM-182 · 5a · el vigía del popup sigue, sólo como log', () => {
  it('se arma con el botón en popup, avisa la credencial y se suelta con él', () => {
    expect(login).toMatch(/onCredential: \(credential\) => \{\n\s+vigia\?\.credencialRecibida\(\);/);
    expect(login).toContain('vigia = vigilarPopupGoogle(container);');
    expect(login).toMatch(/return \(\) => \{\n\s+active = false;\n\s+vigia\?\.dispose\(\);/);
  });

  it('no dibuja nada en pantalla: sólo `console.info`', () => {
    const vigia = readFileSync(new URL('../api/googlePopupDiagnostico.ts', import.meta.url), 'utf8');
    expect(vigia).not.toMatch(/createElement|innerHTML|textContent\s*=|\.append\(/);
    expect(vigia).toContain('console.info');
  });
});
