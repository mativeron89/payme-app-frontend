import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AvisoGoogleOtraCuenta, mostrarAvisoGoogleOtraCuenta } from './AvisoGoogleOtraCuenta';

const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const UA_MAC_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const UA_CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const TEXTO = 'Si entraste con Google y quieres usar otra cuenta, cierra sesión de Google en Safari y vuelve a intentar.';

afterEach(() => { vi.unstubAllGlobals(); });

/** RM-182 · 5b · decisión 11 de Mati: el texto literal, sólo en WebKit. */
describe('RM-182 · 5b · aviso para usar otra cuenta de Google', () => {
  it('🔴 en Safari de iPhone y de Mac se dibuja con el texto EXACTO de la decisión 11', () => {
    for (const ua of [UA_IPHONE, UA_MAC_SAFARI]) {
      vi.stubGlobal('navigator', { userAgent: ua, maxTouchPoints: 0 });
      const html = renderToStaticMarkup(<AvisoGoogleOtraCuenta />);
      expect(html).toContain(TEXTO.replace(/'/g, '&#x27;'));
      expect(html).toContain('data-aviso="google-otra-cuenta"');
    }
  });

  it('🔴 en Chrome (Blink) no se dibuja: el problema es de WebKit', () => {
    vi.stubGlobal('navigator', { userAgent: UA_CHROME, maxTouchPoints: 0 });
    expect(renderToStaticMarkup(<AvisoGoogleOtraCuenta />)).toBe('');
    expect(mostrarAvisoGoogleOtraCuenta(UA_CHROME)).toBe(false);
    expect(mostrarAvisoGoogleOtraCuenta('')).toBe(false);
  });

  it('está montado bajo el botón de Google, y el diagnóstico 5a cableado a su ciclo de vida', () => {
    const fuente = readFileSync(new URL('./LoginScreen.tsx', import.meta.url), 'utf8');
    const ranura = fuente.slice(fuente.indexOf('const ranuraGoogle = ('), fuente.indexOf('return (\n    <div className="ingreso">'));
    expect(ranura).toContain('<AvisoGoogleOtraCuenta />');
    expect(ranura.indexOf('<AvisoGoogleOtraCuenta />')).toBeGreaterThan(ranura.indexOf('ref={setGoogleContainer}'));
    // 5a: se arma con el botón, avisa la credencial y se suelta con él.
    expect(fuente).toMatch(/onCredential: \(credential\) => \{\n\s+vigia\?\.credencialRecibida\(\);/);
    expect(fuente).toContain('vigia = vigilarPopupGoogle(container);');
    expect(fuente).toMatch(/return \(\) => \{\n\s+active = false;\n\s+vigia\?\.dispose\(\);/);
  });
});
