import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BarraDeLink } from './BarraDeLink';

/** 🔴 D372 · la barra reducida de D y E: un solo control, el círculo, sin texto visible. */
describe('🔴 D372 · la barra reducida', () => {
  it('un solo botón, el círculo de siempre (.link-round), con el nombre accesible que recibe, dentro de .link-barra', () => {
    const html = renderToStaticMarkup(<BarraDeLink etiqueta="Ver mis ítems" alTocar={() => undefined} />);
    expect(html).toMatch(/^<div class="link-barra"><button type="button" class="link-round" aria-label="Ver mis ítems">/);
    expect(html.match(/<button\b/g)).toHaveLength(1);
  });

  it('sin texto visible; control positivo: la flecha está (un svg)', () => {
    const html = renderToStaticMarkup(<BarraDeLink etiqueta="Ir a PayMe" alTocar={() => undefined} />);
    expect(html.replace(/<[^>]*>/g, '')).toBe('');
    expect(html).toContain('<svg');
  });
});
