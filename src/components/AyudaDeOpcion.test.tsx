import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AyudaDeOpcion } from './AyudaDeOpcion';

/**
 * D366 · el «?» de cada forma de dividir. Acá, el marcado (cerrado y abierto);
 * el comportamiento con el dedo y el teclado (una a la vez, la ✕, Escape y el
 * foco) lo mide `e2e/d360-cambios.spec.ts`.
 */
const nada = (): void => undefined;

function marcado(abierta: boolean): string {
  return renderToStaticMarkup(
    <AyudaDeOpcion
      id="ayuda-total"
      opcion="Pagar el total"
      texto="Sólo algunas personas pagan la cuenta. Todos pueden marcar lo que comieron."
      abierta={abierta}
      onAbrir={nada}
      onCerrar={nada}
    />,
  );
}

describe('D366 · AyudaDeOpcion', () => {
  it('🔴 cerrado: un botón con nombre y aria-expanded="false", sin burbuja ni aria-controls (apuntaría a un id que no existe)', () => {
    const html = marcado(false);
    expect(html).toMatch(/^<button type="button" class="ayuda-opcion-boton" aria-label="Cómo funciona: Pagar el total" aria-expanded="false">/);
    expect(html).not.toContain('aria-controls');
    expect(html).toContain('<span class="ayuda-opcion-signo" aria-hidden="true">?</span>');
    expect(html).not.toContain('ayuda-opcion-burbuja');
    expect(html).not.toContain('Todos pueden marcar');
  });

  it('🔴 abierto: el botón dice que está abierto y la burbuja lleva el id, la explicación y la ✕', () => {
    const html = marcado(true);
    expect(html).toContain('class="ayuda-opcion-boton on"');
    expect(html).toContain('aria-expanded="true"');
    // Abierto, el «?» apunta a la burbuja, que sí está.
    expect(html).toContain('aria-controls="ayuda-total"');
    expect(html).toMatch(/<div id="ayuda-total" class="ayuda-opcion-burbuja" role="note" tabindex="-1"><p>Sólo algunas personas pagan la cuenta\. Todos pueden marcar lo que comieron\.<\/p>/);
    expect(html).toContain('aria-label="Cerrar la explicación"');
  });

  it('el «?» y la burbuja son hermanos: ningún botón dentro de otro', () => {
    const html = marcado(true);
    // El primer </button> cierra el «?» antes de que empiece la burbuja.
    expect(html.indexOf('</button>')).toBeLessThan(html.indexOf('ayuda-opcion-burbuja'));
  });
});
