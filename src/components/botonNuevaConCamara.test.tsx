import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AppBottomBar } from './AppBottomBar';
import { Icon } from './Icon';

/**
 * D249 · Mati: «el boton de nueva, que te manda a el scan de la cámara cambiá el
 * símbolo de + por una cámara». El círculo naranja de la barra lleva la cámara
 * de línea del set propio; el rótulo, lo que hace y el nombre accesible quedan.
 */
describe('D249 · «Nueva» con una cámara', () => {
  const html = renderToStaticMarkup(<AppBottomBar active="home" />);
  const fab = /<span class="appbar-fab" aria-hidden="true">([\s\S]*?)<\/span>/.exec(html)?.[1] ?? '';

  it('🔴 el ícono del círculo es la cámara de línea, no el «+»', () => {
    expect(fab).toBe(renderToStaticMarkup(<Icon name="camera" size={22} />));
    expect(fab).not.toBe(renderToStaticMarkup(<Icon name="plus" size={22} />));
  });

  it('el rótulo y el nombre accesible siguen siendo «Nueva»', () => {
    expect(html).toMatch(/<button type="button" class="appbar-center" aria-label="Nueva">/);
    expect(html).toContain('<span class="appbar-label">Nueva</span>');
  });

  it('D250 · un círculo puede decir otra cosa al lector de pantalla, con el rótulo de siempre', () => {
    const propio = renderToStaticMarkup(<AppBottomBar center={{
      label: 'Nueva', icon: 'camera', ariaLabel: 'Escanear ticket para Cancún 2026', onClick: () => undefined,
    }} />);
    expect(propio).toMatch(/<button type="button" class="appbar-center" aria-label="Escanear ticket para Cancún 2026">/);
    expect(propio).toContain('<span class="appbar-label">Nueva</span>');
  });

  it('una pantalla que trae su propio círculo conserva su ícono', () => {
    const propio = renderToStaticMarkup(
      <AppBottomBar center={{ label: 'Continuar', icon: 'arrow-right', onClick: () => undefined, disabled: false, busy: false }} />,
    );
    expect(/<span class="appbar-fab" aria-hidden="true">([\s\S]*?)<\/span>/.exec(propio)?.[1])
      .toBe(renderToStaticMarkup(<Icon name="arrow-right" size={22} />));
  });
});
