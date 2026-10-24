import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TextoLegal } from './TextoLegal';

const escape = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#x27;');
const sinEnlaces = (s: string) => s.replace(/<a\b[^>]*>/g, '').replaceAll('</a>', '');

describe('D456 · cuerpos íntegros y enlaces cerrados', () => {
  it('conserva todo el texto de los tres cuerpos sellados y sus 11 enlaces', () => {
    let enlaces = 0;
    for (const kind of ['aviso_privacidad', 'aviso_privacidad_simplificado', 'terminos_uso']) {
      const texto = readFileSync(new URL(`../../test-fixtures/legal-d457/${kind}.txt`, import.meta.url), 'utf8').trim();
      const html = renderToStaticMarkup(<TextoLegal texto={texto} />);
      expect(sinEnlaces(html)).toBe(escape(texto));
      enlaces += [...html.matchAll(/<a\b/g)].length;
      for (const [, href] of html.matchAll(/href="([^"]+)"/g)) {
        expect(['https://app.paymemx.com/privacy', 'https://app.paymemx.com/terminos', 'mailto:soporte@paymemx.com']).toContain(href);
      }
    }
    expect(enlaces).toBe(11);
  });
  it('mantiene el punto fuera y no enlaza un prefijo de una URL ajena ni interpreta HTML', () => {
    const texto = 'https://app.paymemx.com/privacy.\nhttps://app.paymemx.com/privacy/ajeno soporte@paymemx.com.evil\n<img src=x onerror=alert(1)>';
    const html = renderToStaticMarkup(<TextoLegal texto={texto} />);
    expect(html).toContain('https://app.paymemx.com/privacy</a>.');
    expect([...html.matchAll(/<a\b/g)]).toHaveLength(1);
    expect(html).not.toContain('<img');
    expect(sinEnlaces(html)).toBe(escape(texto));
  });
});
