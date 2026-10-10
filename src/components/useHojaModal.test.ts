import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * D256 · `useHojaModal` deja `.app` inerte mientras haya una hoja abierta, y
 * sólo mientras haya alguna. Antes cada hoja guardaba lo que veía al abrir y lo
 * restauraba al cerrarse: con dos hojas cerradas fuera de orden, la última en
 * cerrarse devolvía el `true` que había visto (la otra ya estaba abierta) y
 * `.app` quedaba inerte para siempre, sin toques ni scroll.
 *
 * Se prueba el HOOK REAL con un ciclo de efectos mínimo (montar y desmontar a
 * mano), como `conteoDeViajes.test.ts`: el orden de cierre es lo que importa, y
 * en el navegador no se elige.
 */

interface Efecto { limpiar?: () => void }
class Montaje {
  private slots: unknown[] = [];
  private efectos: Efecto[] = [];
  private i = 0;
  private e = 0;
  constructor(private readonly hook: () => void) {}
  montar(): void {
    this.i = 0; this.e = 0;
    actual = this;
    const pendientes: Array<() => void> = [];
    pendiente = pendientes;
    this.hook();
    actual = null;
    pendiente = null;
    for (const p of pendientes) p();
  }
  desmontar(): void { for (const ef of this.efectos) ef.limpiar?.(); this.efectos = []; }
  slot(): number { return this.i++; }
  ref(inicial: unknown): unknown {
    const k = this.slot();
    if (!(k in this.slots)) this.slots[k] = { current: inicial };
    return this.slots[k];
  }
  efecto(fn: () => void | (() => void)): void {
    const k = this.e++;
    pendiente!.push(() => {
      const l = fn();
      this.efectos[k] = { limpiar: typeof l === 'function' ? l : undefined };
    });
  }
}
let actual: Montaje | null = null;
let pendiente: Array<() => void> | null = null;

vi.mock('react', async (original) => {
  const real = await original<typeof import('react')>();
  return {
    ...real,
    useRef: (inicial: unknown) => actual!.ref(inicial),
    useEffect: (fn: () => void | (() => void)) => actual!.efecto(fn),
  };
});

/** Un `.app` y un `document` mínimos: lo único que el hook toca. */
function conLaApp() {
  const app = { inert: false };
  const doc = {
    querySelector: (sel: string) => (sel === '.app' ? app : null),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    activeElement: null,
  };
  vi.stubGlobal('document', doc);
  return app;
}

async function unaHoja() {
  const { useHojaModal } = await import('./useHojaModal');
  const hoja = { current: null };
  const inicial = { current: null };
  return new Montaje(() => useHojaModal(hoja, inicial, () => undefined));
}

describe('🔴 D256 · `.app` inerte sólo mientras haya una hoja abierta', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('una hoja: inerte al abrir y libre al cerrar', async () => {
    const app = conLaApp();
    const a = await unaHoja();
    a.montar();
    expect(app.inert).toBe(true);
    a.desmontar();
    expect(app.inert).toBe(false);
  });

  it('control · dos hojas cerradas en orden (la última abierta primero): libre al final', async () => {
    const app = conLaApp();
    const a = await unaHoja();
    const b = await unaHoja();
    a.montar(); b.montar();
    b.desmontar();
    expect(app.inert).toBe(true);
    a.desmontar();
    expect(app.inert).toBe(false);
  });

  it('🔴 dos hojas cerradas FUERA de orden: con una abierta sigue inerte, y al final queda libre', async () => {
    const app = conLaApp();
    const a = await unaHoja();
    const b = await unaHoja();
    a.montar(); b.montar();
    a.desmontar();
    // B sigue abierta: el fondo no se toca.
    expect(app.inert).toBe(true);
    b.desmontar();
    // Ninguna abierta: la app vuelve a recibir toques y scroll.
    expect(app.inert).toBe(false);
  });

  it('🔴 si `.app` cambió mientras la hoja estaba abierta, al cerrar queda libre la de ahora', async () => {
    const vieja = conLaApp();
    const a = await unaHoja();
    a.montar();
    expect(vieja.inert).toBe(true);
    // La app se volvió a montar con la hoja abierta: el `.app` nuevo nace inerte (como lo pondría
    // la próxima hoja) y al cerrar no debe quedar así.
    const nueva = conLaApp();
    nueva.inert = true;
    a.desmontar();
    expect(nueva.inert).toBe(false);
  });
});
