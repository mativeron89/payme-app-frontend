import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { IdiomaProvider } from '../i18n/idioma';
import { cartelVisible, VistaCartelVersionNueva } from './CartelVersionNueva';

/**
 * AF-CARTEL-VERSION-NUEVA · decisión 125 de Mati. Lo que se decide (cuándo se
 * ve) es puro y se prueba acá; las revisiones, el «nunca recarga sola» y que no
 * tape nada, en `e2e/cartel-version-nueva.spec.ts`.
 */
describe('AF-CARTEL-VERSION-NUEVA · cartelVisible', () => {
  it('con una versión más nueva: se ve', () => {
    expect(cartelVisible({ n: 1, nueva: '0.208.0' }, null)).toBe(true);
  });

  it('sin versión más nueva (misma, rara o sin respuesta): no se ve', () => {
    expect(cartelVisible({ n: 0, nueva: null }, null)).toBe(false);
    expect(cartelVisible({ n: 3, nueva: null }, null)).toBe(false);
  });

  it('cerrado con la × en esta revisión: no se ve; en la próxima, si sigue, vuelve', () => {
    expect(cartelVisible({ n: 2, nueva: '0.208.0' }, 2)).toBe(false);
    expect(cartelVisible({ n: 3, nueva: '0.208.0' }, 2)).toBe(true);
  });
});

describe('AF-CARTEL-VERSION-NUEVA · la vista', () => {
  const html = renderToStaticMarkup(
    <IdiomaProvider>
      <VistaCartelVersionNueva onActualizar={() => undefined} onCerrar={() => undefined} />
    </IdiomaProvider>,
  );

  it('dice que hay una versión nueva, con «Actualizar» y una × con nombre', () => {
    expect(html).toContain('class="cartel-version"');
    expect(html).toContain('role="status"');
    expect(html).toContain('Hay una versión nueva');
    expect(html).toMatch(/<button type="button" class="cartel-version-actualizar">Actualizar<\/button>/);
    expect(html).toMatch(/<button type="button" class="cartel-version-cerrar" aria-label="Cerrar">/);
  });
});
