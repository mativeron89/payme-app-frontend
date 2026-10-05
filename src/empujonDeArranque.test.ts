/**
 * D179 · el empujón de scroll de la app de inicio de iOS, con un `window` de
 * prueba: cuadros, esperas y posiciones bajo control.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QUIETO_MS, SEGUNDO_INTENTO_MS, esAppDeInicioIOS, iniciarEmpujon } from './empujonDeArranque';

interface Scroller {
  scrollHeight: number;
  clientHeight: number;
  scrollTop: number;
}

function entorno(op: { standalone?: unknown; readyState?: DocumentReadyState; scroller?: Scroller | null } = {}) {
  const estilo = new Map<string, [string, string]>();
  const doc = Object.assign(new EventTarget(), {
    readyState: op.readyState ?? 'complete',
    visibilityState: 'visible' as DocumentVisibilityState,
    documentElement: {
      style: {
        getPropertyValue: (k: string) => estilo.get(k)?.[0] ?? '',
        getPropertyPriority: (k: string) => estilo.get(k)?.[1] ?? '',
        setProperty: (k: string, v: string, p = '') => {
          estilo.set(k, [v, p]);
        },
        removeProperty: (k: string) => {
          estilo.delete(k);
        },
      },
    },
    querySelector: (sel: string) => (sel === '.app .scroll' ? scroller : null),
  });
  const scroller: Scroller | null = op.scroller === undefined ? { scrollHeight: 900, clientHeight: 700, scrollTop: 0 } : op.scroller;
  const cuadros = new Map<number, FrameRequestCallback>();
  let proximo = 1;
  let reloj = 1000;
  const posiciones: number[] = [];
  const win = Object.assign(new EventTarget(), {
    document: doc,
    navigator: { standalone: 'standalone' in op ? op.standalone : true },
    scrollY: 0,
    performance: { now: () => reloj },
    scrollTo(_x: number, y: number) {
      win.scrollY = y;
      posiciones.push(y);
    },
    requestAnimationFrame(fn: FrameRequestCallback) {
      const id = proximo++;
      cuadros.set(id, fn);
      return id;
    },
    cancelAnimationFrame(id: number) {
      cuadros.delete(id);
    },
  });
  /** Corre los cuadros pendientes, de a uno por vez (lo que se pide adentro va al siguiente). */
  const cuadro = (n = 1) => {
    for (let i = 0; i < n; i++) {
      const fns = [...cuadros.values()];
      cuadros.clear();
      for (const fn of fns) fn(0);
    }
  };
  return {
    win: win as unknown as Window,
    doc,
    scroller,
    posiciones,
    minHeight: () => estilo.get('min-height') ?? null,
    estilo,
    cuadro,
    pendientes: () => cuadros.size,
    avanzar: (ms: number) => {
      reloj += ms;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('D179 · sólo en la app de inicio de iOS', () => {
  it('`navigator.standalone === true` y nada más', () => {
    expect(esAppDeInicioIOS({ standalone: true } as unknown as Navigator)).toBe(true);
    expect(esAppDeInicioIOS({ standalone: false } as unknown as Navigator)).toBe(false);
    expect(esAppDeInicioIOS({ standalone: 'true' } as unknown as Navigator)).toBe(false);
    expect(esAppDeInicioIOS({} as Navigator)).toBe(false);
  });

  it.each([
    ['Safari del iPhone', false],
    ['la computadora (sin la propiedad)', undefined],
    ['un valor que no es `true`', 1],
  ])('en %s no engancha nada ni mueve nada', (_nombre, standalone) => {
    const e = entorno({ standalone });
    const escuchar = vi.spyOn(e.win, 'addEventListener');
    const soltar = iniciarEmpujon(e.win);
    e.win.dispatchEvent(new Event('load'));
    e.win.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    e.cuadro(4);
    vi.advanceTimersByTime(SEGUNDO_INTENTO_MS * 2);
    e.cuadro(4);
    expect(escuchar).not.toHaveBeenCalled();
    expect(e.posiciones).toEqual([]);
    expect(e.scroller?.scrollTop).toBe(0);
    expect(e.minHeight()).toBeNull();
    expect(() => soltar()).not.toThrow();
  });
});

describe('D179 · el empujón', () => {
  it('al arrancar: 1 px el documento (alargado 1 px) y el `.scroll`, y dos cuadros después todo vuelve', () => {
    const e = entorno();
    iniciarEmpujon(e.win);
    expect(e.posiciones).toEqual([]);
    e.cuadro(2);
    expect(e.minHeight()).toEqual(['calc(100% + 1px)', '']);
    expect(e.posiciones).toEqual([1]);
    expect(e.scroller?.scrollTop).toBe(1);
    e.cuadro(2);
    expect(e.posiciones).toEqual([1, 0]);
    expect(e.scroller?.scrollTop).toBe(0);
    expect(e.minHeight()).toBeNull();
  });

  it('nunca mueve más de 1 px', () => {
    const e = entorno();
    iniciarEmpujon(e.win);
    e.cuadro(4);
    vi.advanceTimersByTime(SEGUNDO_INTENTO_MS);
    e.cuadro(4);
    expect(Math.max(...e.posiciones)).toBe(1);
  });

  it('si la página no terminó de cargar, espera el `load`', () => {
    const e = entorno({ readyState: 'loading' });
    iniciarEmpujon(e.win);
    e.cuadro(4);
    vi.advanceTimersByTime(SEGUNDO_INTENTO_MS);
    expect(e.posiciones).toEqual([]);
    e.win.dispatchEvent(new Event('load'));
    e.cuadro(4);
    expect(e.posiciones).toEqual([1, 0]);
  });

  it('el arranque tiene un segundo intento, por si WebKit acomoda el viewport más tarde', () => {
    const e = entorno();
    iniciarEmpujon(e.win);
    e.cuadro(4);
    expect(e.posiciones).toEqual([1, 0]);
    vi.advanceTimersByTime(SEGUNDO_INTENTO_MS - 1);
    expect(e.posiciones).toEqual([1, 0]);
    vi.advanceTimersByTime(1);
    e.cuadro(2);
    expect(e.posiciones).toEqual([1, 0, 1, 0]);
  });

  it('al restaurar la página guardada (`pageshow` persistido) sí; en la primera carga, no', () => {
    const e = entorno();
    iniciarEmpujon(e.win);
    e.cuadro(4);
    vi.advanceTimersByTime(SEGUNDO_INTENTO_MS);
    e.cuadro(4);
    e.posiciones.length = 0;
    e.win.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: false }));
    e.cuadro(4);
    expect(e.posiciones).toEqual([]);
    e.win.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    e.cuadro(4);
    expect(e.posiciones).toEqual([1, 0]);
  });

  it('al volver de segundo plano sí; al irse, no', () => {
    const e = entorno();
    iniciarEmpujon(e.win);
    e.cuadro(4);
    vi.advanceTimersByTime(SEGUNDO_INTENTO_MS);
    e.cuadro(4);
    e.posiciones.length = 0;
    e.doc.visibilityState = 'hidden';
    e.doc.dispatchEvent(new Event('visibilitychange'));
    e.cuadro(4);
    expect(e.posiciones).toEqual([]);
    e.doc.visibilityState = 'visible';
    e.doc.dispatchEvent(new Event('visibilitychange'));
    e.cuadro(4);
    expect(e.posiciones).toEqual([1, 0]);
  });

  it('con un dedo apoyado no empuja; al soltarlo, el siguiente sí', () => {
    const e = entorno();
    iniciarEmpujon(e.win);
    e.win.dispatchEvent(new Event('touchstart'));
    e.cuadro(4);
    vi.advanceTimersByTime(SEGUNDO_INTENTO_MS);
    e.cuadro(4);
    expect(e.posiciones).toEqual([]);
    e.win.dispatchEvent(new Event('touchend'));
    e.doc.dispatchEvent(new Event('visibilitychange'));
    e.cuadro(4);
    expect(e.posiciones).toEqual([1, 0]);
  });

  it('`touchcancel` también suelta el dedo', () => {
    const e = entorno();
    iniciarEmpujon(e.win);
    e.win.dispatchEvent(new Event('touchstart'));
    e.win.dispatchEvent(new Event('touchcancel'));
    e.cuadro(4);
    expect(e.posiciones).toEqual([1, 0]);
  });

  it('mientras la persona scrollea no empuja (cortaría el impulso); quieto un rato, sí', () => {
    const e = entorno();
    iniciarEmpujon(e.win);
    e.win.dispatchEvent(new Event('scroll'));
    e.avanzar(QUIETO_MS - 1);
    e.cuadro(4);
    expect(e.posiciones).toEqual([]);
    e.avanzar(1);
    vi.advanceTimersByTime(SEGUNDO_INTENTO_MS);
    e.cuadro(4);
    expect(e.posiciones).toEqual([1, 0]);
  });

  it('los scrolls del propio empujón no cuentan como de la persona', () => {
    const e = entorno();
    iniciarEmpujon(e.win);
    e.cuadro(2);
    e.win.dispatchEvent(new Event('scroll'));
    e.cuadro(2);
    e.win.dispatchEvent(new Event('scroll'));
    e.cuadro(1);
    e.posiciones.length = 0;
    e.doc.dispatchEvent(new Event('visibilitychange'));
    e.cuadro(4);
    expect(e.posiciones).toEqual([1, 0]);
  });

  it('un pedido mientras otro está en curso no se suma', () => {
    const e = entorno();
    iniciarEmpujon(e.win);
    e.cuadro(2);
    expect(e.posiciones).toEqual([1]);
    // El segundo intento del arranque cae con el primero a medias: se descarta.
    vi.advanceTimersByTime(SEGUNDO_INTENTO_MS);
    expect(e.posiciones).toEqual([1]);
    e.cuadro(4);
    expect(e.posiciones).toEqual([1, 0]);
  });

  it('devuelve todo a donde estaba: el scroll previo, un `.scroll` al fondo y el `min-height` que ya tuviera', () => {
    const e = entorno({ scroller: { scrollHeight: 900, clientHeight: 700, scrollTop: 200 } });
    e.estilo.set('min-height', ['50px', 'important']);
    (e.win as unknown as { scrollY: number }).scrollY = 10;
    iniciarEmpujon(e.win);
    e.cuadro(2);
    expect(e.posiciones).toEqual([11]);
    expect(e.scroller?.scrollTop).toBe(199);
    e.cuadro(2);
    expect(e.posiciones).toEqual([11, 10]);
    expect(e.scroller?.scrollTop).toBe(200);
    expect(e.minHeight()).toEqual(['50px', 'important']);
  });

  it('un `.scroll` sin para dónde moverse, o que no existe, no se toca; el documento sí', () => {
    const corto = entorno({ scroller: { scrollHeight: 700, clientHeight: 700, scrollTop: 0 } });
    iniciarEmpujon(corto.win);
    corto.cuadro(2);
    expect(corto.posiciones).toEqual([1]);
    expect(corto.scroller?.scrollTop).toBe(0);
    const sin = entorno({ scroller: null });
    iniciarEmpujon(sin.win);
    sin.cuadro(4);
    expect(sin.posiciones).toEqual([1, 0]);
  });
});

describe('D179 · soltar', () => {
  it('a mitad de un empujón lo deshace en el acto y no deja cuadros ni esperas', () => {
    const e = entorno();
    const soltar = iniciarEmpujon(e.win);
    e.cuadro(2);
    expect(e.posiciones).toEqual([1]);
    soltar();
    expect(e.posiciones).toEqual([1, 0]);
    expect(e.scroller?.scrollTop).toBe(0);
    expect(e.minHeight()).toBeNull();
    expect(e.pendientes()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('después de soltar, nada lo vuelve a disparar', () => {
    const e = entorno({ readyState: 'loading' });
    const quitar = vi.spyOn(e.win, 'removeEventListener');
    const soltar = iniciarEmpujon(e.win);
    soltar();
    expect(quitar).toHaveBeenCalledWith('load', expect.any(Function));
    e.win.dispatchEvent(new Event('load'));
    e.win.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    e.doc.dispatchEvent(new Event('visibilitychange'));
    e.cuadro(4);
    vi.advanceTimersByTime(SEGUNDO_INTENTO_MS);
    e.cuadro(4);
    expect(e.posiciones).toEqual([]);
  });
});
