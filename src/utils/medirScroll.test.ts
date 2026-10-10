import { describe, expect, it } from 'vitest';
import { describir, medirScroll } from './medirScroll';

/**
 * D256 · lo que el panel de diagnóstico lee para un arrastre que no mueve nada.
 * La medición con el navegador de verdad está en `e2e/d256-scroll.spec.ts`; acá,
 * con una ventana falsa, qué se informa y que nunca salga texto.
 */

interface Falso {
  tagName: string;
  className: string;
  parentElement: Falso | null;
  inert?: boolean;
  clientHeight?: number;
  scrollHeight?: number;
  scrollTop?: number;
  css: Partial<CSSStyleDeclaration>;
  style: { overflow: string };
  textContent?: string;
}

function el(tagName: string, className: string, parentElement: Falso | null, css: Partial<CSSStyleDeclaration> = {}, extra: Partial<Falso> = {}): Falso {
  return { tagName: tagName.toUpperCase(), className, parentElement, css, style: { overflow: '' }, ...extra };
}

function ventana(pila: Falso[], { html, body, inertes = 0 }: { html: Falso; body: Falso; inertes?: number }) {
  const estilo = (e: Falso) => ({ overflowY: 'visible', pointerEvents: 'auto', touchAction: 'auto', ...e.css });
  return {
    innerWidth: 375,
    innerHeight: 667,
    getComputedStyle: (e: Falso) => estilo(e),
    document: {
      elementsFromPoint: () => pila,
      body,
      documentElement: html,
      querySelectorAll: () => ({ length: inertes }),
    },
  } as unknown as Window;
}

function arbol() {
  const html = el('html', 'app-de-inicio-ios', null, { overflowY: 'hidden' });
  const body = el('body', '', html);
  const app = el('div', 'app', body, { overflowY: 'hidden' });
  const screen = el('div', 'screen vj-con-pie', app);
  const scroll = el('div', 'scroll vj-scroll', screen, { overflowY: 'auto' }, { clientHeight: 451, scrollHeight: 1879, scrollTop: 0 });
  const fila = el('button', 'qc-circulo', scroll, {}, { textContent: 'Tacos al pastor' });
  return { html, body, app, screen, scroll, fila };
}

const fila = (filas: ReadonlyArray<readonly [string, string]>, clave: string) => filas.find(([k]) => k.includes(clave))?.[1];

describe('D256 · el panel lee lo que frena un arrastre', () => {
  it('lo sano: el centro cae en la lista, el contenedor desborda y no hay frenos', () => {
    const a = arbol();
    const filas = medirScroll(ventana([a.fila, a.scroll, a.screen], { html: a.html, body: a.body }), 0);
    expect(fila(filas, 'elementsFromPoint')).toBe('188,334 → button.qc-circulo › div.scroll.vj-scroll › div.screen.vj-con-pie');
    expect(fila(filas, 'contenedor que scrollea')).toBe('div.scroll.vj-scroll');
    expect(fila(filas, 'overflow-y · clientHeight')).toBe('auto · 451 · 1879 · 0');
    expect(fila(filas, 'inert · pointer-events · touch-action')).toBe('none');
    expect(fila(filas, '[inert] · hojas abiertas')).toBe('0 · 0');
  });

  it('🔴 `.app` inerte, un ancestro sin pointer-events y otro con touch-action: los tres se informan', () => {
    const a = arbol();
    a.app.inert = true;
    a.screen.css = { pointerEvents: 'none' };
    a.scroll.css = { overflowY: 'auto', touchAction: 'none' };
    const filas = medirScroll(ventana([a.fila], { html: a.html, body: a.body, inertes: 1 }), 0);
    expect(fila(filas, 'inert · pointer-events · touch-action')).toBe(
      'div.scroll.vj-scroll touch-action:none | div.screen.vj-con-pie pointer-events:none | div.app inert');
    expect(fila(filas, '[inert] · hojas abiertas')).toBe('1 · 0');
  });

  it('🔴 un velo encima: aparece primero en la pila y no hay contenedor que scrollee', () => {
    const a = arbol();
    const velo = el('div', 'sheet-overlay', a.body);
    const filas = medirScroll(ventana([velo, a.fila, a.scroll], { html: a.html, body: a.body }), 1);
    expect(fila(filas, 'elementsFromPoint')).toMatch(/→ div\.sheet-overlay › /);
    expect(fila(filas, 'contenedor que scrollea')).toBe('—');
    expect(fila(filas, '[inert] · hojas abiertas')).toBe('0 · 1');
  });

  it('🔴 el overflow de body y html, en línea y calculado (una hoja que no lo devolvió)', () => {
    const a = arbol();
    a.body.style.overflow = 'hidden';
    a.body.css = { overflowY: 'hidden' };
    const filas = medirScroll(ventana([a.fila, a.scroll], { html: a.html, body: a.body }), 0);
    expect(fila(filas, 'body overflow')).toBe('hidden · hidden');
    expect(fila(filas, 'html overflow')).toBe('none · hidden');
  });

  it('nunca texto: sólo la etiqueta y hasta dos clases, recortadas', () => {
    const a = arbol();
    const filas = medirScroll(ventana([a.fila, a.scroll], { html: a.html, body: a.body }), 0);
    expect(filas.map(([, v]) => v).join('\n')).not.toContain('Tacos');
    expect(describir(el('div', `uno dos tres ${'x'.repeat(80)}`, null) as unknown as Element)).toBe('div.uno.dos');
    expect(describir(el('div', 'a'.repeat(80), null) as unknown as Element)).toHaveLength(48);
    expect(describir(null)).toBe('—');
  });
});
