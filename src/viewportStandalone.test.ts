import { describe, expect, it } from 'vitest';
import { ajustarViewportStandalone, altoCorregido, VARIABLE_ALTO, type MedidaViewport } from './viewportStandalone';

/**
 * E173-2 · la decisión de cuándo corregir el alto de `.app` en la app de inicio
 * de iOS. Los números son de iPhone en puntos CSS: 393×852 (15 Pro, inset
 * superior 59) y 430×932 (Pro Max, el caso de 59 px que documenta el defecto).
 */
const IPHONE_ACHICADO: MedidaViewport = {
  standalone: true,
  innerHeight: 852 - 59,
  screenWidth: 393,
  screenHeight: 852,
  vertical: true,
  insetSuperior: 59,
};

describe('E173-2 · altoCorregido', () => {
  it('🔴 app de inicio, viewport achicado en el inset superior: impone el alto de la pantalla', () => {
    expect(altoCorregido(IPHONE_ACHICADO)).toBe(852);
    expect(altoCorregido({ ...IPHONE_ACHICADO, screenWidth: 430, screenHeight: 932, innerHeight: 873 })).toBe(932);
  });

  it('tolera el redondeo de WebKit (±4 px) entre el faltante y el inset', () => {
    expect(altoCorregido({ ...IPHONE_ACHICADO, innerHeight: 852 - 57 })).toBe(852);
    expect(altoCorregido({ ...IPHONE_ACHICADO, innerHeight: 852 - 63 })).toBe(852);
    expect(altoCorregido({ ...IPHONE_ACHICADO, innerHeight: 852 - 64 })).toBeNull();
  });

  it('viewport sano: no corrige', () => {
    expect(altoCorregido({ ...IPHONE_ACHICADO, innerHeight: 852 })).toBeNull();
    expect(altoCorregido({ ...IPHONE_ACHICADO, innerHeight: 850 })).toBeNull();
  });

  it('🔴 Safari (no standalone): no corrige aunque el faltante coincida', () => {
    expect(altoCorregido({ ...IPHONE_ACHICADO, standalone: false })).toBeNull();
  });

  it('sin inset superior (horizontal, o un teléfono sin muesca): no corrige', () => {
    expect(altoCorregido({ ...IPHONE_ACHICADO, insetSuperior: 0 })).toBeNull();
    expect(altoCorregido({ ...IPHONE_ACHICADO, insetSuperior: Number.NaN })).toBeNull();
  });

  it('una ventana de iPad más chica a propósito: el faltante no es el inset, no corrige', () => {
    expect(altoCorregido({
      standalone: true, innerHeight: 700, screenWidth: 1024, screenHeight: 1366, vertical: true, insetSuperior: 24,
    })).toBeNull();
  });

  it('en horizontal toma el lado corto de la pantalla', () => {
    expect(altoCorregido({
      standalone: true, innerHeight: 393 - 20, screenWidth: 393, screenHeight: 852, vertical: false, insetSuperior: 20,
    })).toBe(393);
  });

  it('medidas sin sentido no corrigen', () => {
    expect(altoCorregido({ ...IPHONE_ACHICADO, screenWidth: 0, screenHeight: 0 })).toBeNull();
    expect(altoCorregido({ ...IPHONE_ACHICADO, innerHeight: 0 })).toBeNull();
  });
});

/**
 * El cableado, con una ventana falsa que cuenta lo que se engancha. Pedido del
 * Bibliotecario: la corrección se apaga sola, no deja listeners al soltarla y
 * no toca Safari ni el escritorio.
 */
type Oyente = (...args: unknown[]) => void;

class Objetivo {
  readonly oyentes = new Map<string, Set<Oyente>>();
  addEventListener(tipo: string, f: Oyente) {
    if (!this.oyentes.has(tipo)) this.oyentes.set(tipo, new Set());
    this.oyentes.get(tipo)!.add(f);
  }
  removeEventListener(tipo: string, f: Oyente) {
    this.oyentes.get(tipo)?.delete(f);
  }
  disparar(tipo: string) {
    for (const f of [...(this.oyentes.get(tipo) ?? [])]) f();
  }
  total(): number {
    return [...this.oyentes.values()].reduce((n, set) => n + set.size, 0);
  }
}

function ventanaFalsa(opciones: { standalone?: boolean; innerHeight: number; inset: number }) {
  const win = new Objetivo() as Objetivo & Record<string, unknown>;
  const doc = new Objetivo() as Objetivo & Record<string, unknown>;
  const visual = new Objetivo();
  const estilo = new Map<string, string>();
  const enBody = new Set<object>();
  const creados: object[] = [];
  const frames = new Map<number, () => void>();
  let siguienteFrame = 1;
  doc.documentElement = {
    style: {
      setProperty: (k: string, v: string) => { estilo.set(k, v); },
      removeProperty: (k: string) => { estilo.delete(k); },
    },
  };
  doc.createElement = () => {
    const el = { className: '', setAttribute: () => undefined, remove: () => { enBody.delete(el); } };
    creados.push(el);
    return el;
  };
  doc.body = { appendChild: (el: object) => { enBody.add(el); } };
  doc.visibilityState = 'visible';
  win.navigator = opciones.standalone === undefined ? {} : { standalone: opciones.standalone };
  win.document = doc;
  win.innerHeight = opciones.innerHeight;
  win.screen = { width: 393, height: 852 };
  win.matchMedia = () => ({ matches: true });
  win.getComputedStyle = () => ({ paddingTop: `${opciones.inset}px` });
  win.requestAnimationFrame = (cb: () => void) => { const id = siguienteFrame++; frames.set(id, cb); return id; };
  win.cancelAnimationFrame = (id: number) => { frames.delete(id); };
  win.visualViewport = visual;
  const oyentes = () => win.total() + doc.total() + visual.total();
  return { win, doc, visual, estilo, enBody, creados, frames, oyentes };
}

const comoVentana = (w: unknown) => w as Window;

describe('E173-2 · ajustarViewportStandalone, el cableado', () => {
  it.each([
    ['Safari / escritorio (sin navigator.standalone)', undefined],
    ['navigator.standalone en false', false],
  ] as const)('🔴 %s: no engancha nada, ni sonda, ni variable', (_caso, standalone) => {
    const v = ventanaFalsa({ standalone, innerHeight: 852 - 59, inset: 59 });
    const soltar = ajustarViewportStandalone(comoVentana(v.win));
    expect(v.oyentes()).toBe(0);
    expect(v.creados).toHaveLength(0);
    expect(v.estilo.size).toBe(0);
    expect(v.frames.size).toBe(0);
    soltar();
    expect(v.oyentes()).toBe(0);
  });

  it('🔴 app de inicio achicada: corrige al arrancar, y se apaga sola cuando el viewport se recupera', () => {
    const v = ventanaFalsa({ standalone: true, innerHeight: 852 - 59, inset: 59 });
    ajustarViewportStandalone(comoVentana(v.win));
    expect(v.estilo.get(VARIABLE_ALTO)).toBe('852px');
    expect(v.enBody.size).toBe(1);

    v.win.innerHeight = 852;
    v.win.disparar('resize');
    expect(v.estilo.has(VARIABLE_ALTO)).toBe(false);

    // Si WebKit vuelve a achicar (p. ej. al volver de otra app), corrige de nuevo,
    // por cualquiera de los avisos que da.
    v.win.innerHeight = 852 - 59;
    v.visual.disparar('resize');
    expect(v.estilo.get(VARIABLE_ALTO)).toBe('852px');
    v.win.innerHeight = 852;
    v.win.disparar('pageshow');
    expect(v.estilo.has(VARIABLE_ALTO)).toBe(false);
    v.win.innerHeight = 852 - 59;
    v.win.disparar('orientationchange');
    expect(v.estilo.get(VARIABLE_ALTO)).toBe('852px');
  });

  it('volver a primer plano re-mide; en segundo plano no', () => {
    const v = ventanaFalsa({ standalone: true, innerHeight: 852, inset: 59 });
    ajustarViewportStandalone(comoVentana(v.win));
    expect(v.estilo.has(VARIABLE_ALTO)).toBe(false);
    v.win.innerHeight = 852 - 59;
    v.doc.visibilityState = 'hidden';
    v.doc.disparar('visibilitychange');
    expect(v.estilo.has(VARIABLE_ALTO)).toBe(false);
    v.doc.visibilityState = 'visible';
    v.doc.disparar('visibilitychange');
    expect(v.estilo.get(VARIABLE_ALTO)).toBe('852px');
  });

  it('🔴 al soltarla no deja nada: ni listeners, ni variable, ni sonda, ni frame pendiente', () => {
    const v = ventanaFalsa({ standalone: true, innerHeight: 852 - 59, inset: 59 });
    const soltar = ajustarViewportStandalone(comoVentana(v.win));
    expect(v.oyentes()).toBeGreaterThan(0);
    expect(v.frames.size).toBe(1);
    soltar();
    expect(v.oyentes()).toBe(0);
    expect(v.estilo.has(VARIABLE_ALTO)).toBe(false);
    expect(v.enBody.size).toBe(0);
    expect(v.frames.size).toBe(0);
    // Y un resize después de soltarla ya no corrige.
    v.win.disparar('resize');
    expect(v.estilo.has(VARIABLE_ALTO)).toBe(false);
  });
});
