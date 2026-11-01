import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { colorDeFicha } from '../screens/quienEligioView';
import { FichasDeIniciales } from './FichasDeIniciales';

/** D622 · D628 · AF-4 · las fichas de iniciales: decorativas (el texto de al lado dice quién), color por orden de llegada. */
const t = (s: string, ...a: unknown[]): string => s.replace(/\{(\d+)\}/g, (_, i) => String(a[Number(i)]));
const f = (ordinal: number, initials: string, mine = false) => ({ ordinal, initials, mine });

describe('FichasDeIniciales', () => {
  it('🔴 oculta al lector de pantalla: el significado lo lleva el texto', () => {
    const html = renderToStaticMarkup(<FichasDeIniciales visibles={[f(1, 'AM')]} resto={0} t={t} />);
    expect(html).toMatch(/^<span class="qc-fichas" aria-hidden="true">/);
  });

  it('🔴 cada ficha con sus iniciales y el color de su orden de llegada', () => {
    const html = renderToStaticMarkup(<FichasDeIniciales visibles={[f(1, 'AM'), f(2, 'LP')]} resto={0} t={t} />);
    expect(html).toContain(`style="background:${colorDeFicha(1)}">AM</span>`);
    expect(html).toContain(`style="background:${colorDeFicha(2)}">LP</span>`);
    expect(html).not.toContain('+');
  });

  it('🔴 quien mira es «Tú» con borde, nunca sus iniciales', () => {
    const html = renderToStaticMarkup(<FichasDeIniciales visibles={[f(0, 'MV', true), f(1, 'AM')]} resto={0} t={t} />);
    expect(html).toContain('<span class="qc-ficha qc-ficha--tu">Tú</span>');
    expect(html).not.toContain('MV');
  });

  it('«+N» con el resto y un «?» punteado por cada esperado que falta', () => {
    const html = renderToStaticMarkup(<FichasDeIniciales visibles={[f(0, 'MV', true)]} faltan={2} resto={4} t={t} />);
    expect(html.match(/qc-ficha--falta/g)).toHaveLength(2);
    expect(html).toContain('<span class="qc-ficha qc-ficha--mas">+4</span>');
  });

  it('sin nada que dibujar, nada', () => {
    expect(renderToStaticMarkup(<FichasDeIniciales visibles={[]} resto={0} t={t} />)).toBe('');
  });
});
