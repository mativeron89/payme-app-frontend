import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * C-06 (auditoría Codex completa, MEDIA) · un pedido tardío no pisa a uno
 * posterior. D266 · la pestaña pide sólo los cerrados: la protección sigue para
 * el reintento y para salir y volver a la pestaña. Se prueba el HOOK REAL
 * (`useCerradosDeViajes`) con un
 * ciclo de React mínimo: `useState`, `useRef`, `useCallback` y `useEffect` con
 * sus dependencias y limpiezas, como lo hizo la auditoría. No reemplaza una
 * medición en el navegador; sí fija el orden de llegada, que el navegador no
 * deja elegir.
 */

// ─── Un React mínimo: un componente, renders a mano ───────────────────────
interface Efecto { deps: readonly unknown[] | undefined; limpiar?: () => void }
class Montaje<R> {
  slots: unknown[] = [];
  efectos: Efecto[] = [];
  private i = 0;
  private e = 0;
  private pendientes: Array<() => void> = [];
  resultado!: R;
  constructor(private readonly hook: () => R) {}
  render(): R {
    this.i = 0; this.e = 0; this.pendientes = [];
    actual = this;
    this.resultado = this.hook();
    actual = null;
    for (const p of this.pendientes) p();
    return this.resultado;
  }
  desmontar(): void { for (const ef of this.efectos) ef.limpiar?.(); }
  slot(): number { return this.i++; }
  efecto(fn: () => void | (() => void), deps?: readonly unknown[]): void {
    const k = this.e++;
    const antes = this.efectos[k];
    if (antes && deps && antes.deps && deps.length === antes.deps.length && deps.every((d, j) => Object.is(d, antes.deps![j]))) return;
    this.pendientes.push(() => {
      antes?.limpiar?.();
      const l = fn();
      this.efectos[k] = { deps, limpiar: typeof l === 'function' ? l : undefined };
    });
  }
}
let actual: Montaje<unknown> | null = null;

vi.mock('react', async (original) => {
  const real = await original<typeof import('react')>();
  return {
    ...real,
    useState: (inicial: unknown) => {
      const m = actual!; const k = m.slot();
      if (!(k in m.slots)) m.slots[k] = typeof inicial === 'function' ? (inicial as () => unknown)() : inicial;
      return [m.slots[k], (v: unknown) => { m.slots[k] = typeof v === 'function' ? (v as (x: unknown) => unknown)(m.slots[k]) : v; }];
    },
    useRef: (inicial: unknown) => {
      const m = actual!; const k = m.slot();
      if (!(k in m.slots)) m.slots[k] = { current: inicial };
      return m.slots[k];
    },
    // Como React: la misma función mientras las dependencias no cambien.
    useCallback: (fn: unknown, deps: readonly unknown[]) => {
      const m = actual!; const k = m.slot();
      const antes = m.slots[k] as { fn: unknown; deps: readonly unknown[] } | undefined;
      if (antes && antes.deps.length === deps.length && deps.every((d, j) => Object.is(d, antes.deps[j]))) return antes.fn;
      m.slots[k] = { fn, deps };
      return fn;
    },
    useEffect: (fn: () => void | (() => void), deps?: readonly unknown[]) => actual!.efecto(fn, deps),
  };
});

// ─── La fachada: cada pedido queda pendiente hasta que la prueba lo resuelve ──
interface Pedido { lista: 'abiertos' | 'cerrados'; resolver: (v: unknown) => void; rechazar: (e: unknown) => void }
const pedidos: Pedido[] = [];
vi.mock('../../api', () => ({
  api: {
    getViajes: (lista: 'abiertos' | 'cerrados') => new Promise((resolver, rechazar) => { pedidos.push({ lista, resolver, rechazar }); }),
  },
}));

const lista = (nombre: string) => ({
  counts: { abiertos: 1, cerrados: 1 },
  viajes: [{ id: nombre, nombre, fecha_desde: null, fecha_hasta: null, estado: 'cerrado', personas: 2,
    mi_balance_cents: null, transferencias_pendientes: null, consumiste_cents: 1000, terminado_en: null }],
});
const tanda = () => new Promise((r) => setTimeout(r, 0));

let activa = true;
async function montar() {
  const { useCerradosDeViajes } = await import('./PestanaViajes');
  const m = new Montaje(() => useCerradosDeViajes(activa));
  m.render();
  return m;
}

/** El primero falla, «Reintentar» (queda en vuelo), se sale de la pestaña y se vuelve (otro pedido). */
async function hastaVolverALaPestana() {
  const m = await montar();
  expect(pedidos.map((p) => p.lista)).toEqual(['cerrados']);
  pedidos[0]!.rechazar(new Error('red'));
  await tanda();
  m.render();
  expect(m.resultado.conteo).toEqual({ estado: 'error' });
  m.resultado.reintentar();
  m.render();
  activa = false; m.render();
  activa = true; m.render();
  expect(pedidos.map((p) => p.lista)).toEqual(['cerrados', 'cerrados', 'cerrados']);
  return m;
}

const nombres = (m: Montaje<{ conteo: { estado: string; viajes?: ReadonlyArray<{ nombre: string }> } }>) =>
  m.resultado.conteo.estado === 'listo' ? m.resultado.conteo.viajes!.map((v) => v.nombre) : m.resultado.conteo.estado;

describe('🔴 C-06 · D266 · un pedido tardío de los cerrados no pisa al de ahora', () => {
  beforeEach(() => { pedidos.length = 0; activa = true; vi.resetModules(); });

  it('responde el de ahora y DESPUÉS llega el reintento viejo: queda el de ahora', async () => {
    const m = await hastaVolverALaPestana();
    pedidos[2]!.resolver(lista('Oaxaca'));
    await tanda(); m.render();
    expect(nombres(m)).toEqual(['Oaxaca']);
    pedidos[1]!.resolver(lista('Viejo'));
    await tanda(); m.render();
    expect(nombres(m)).toEqual(['Oaxaca']);
  });

  it('llega ANTES el reintento viejo y después el de ahora: tampoco se ve el viejo', async () => {
    const m = await hastaVolverALaPestana();
    pedidos[1]!.resolver(lista('Viejo'));
    await tanda(); m.render();
    expect(nombres(m)).not.toEqual(['Viejo']);
    pedidos[2]!.resolver(lista('Oaxaca'));
    await tanda(); m.render();
    expect(nombres(m)).toEqual(['Oaxaca']);
  });

  it('el reintento que falla tarde tampoco pone «error» sobre la lista', async () => {
    const m = await hastaVolverALaPestana();
    pedidos[2]!.resolver(lista('Oaxaca'));
    await tanda(); m.render();
    pedidos[1]!.rechazar(new Error('red'));
    await tanda(); m.render();
    expect(nombres(m)).toEqual(['Oaxaca']);
  });

  it('desmontado, nada de lo que estaba en vuelo publica', async () => {
    const m = await montar();
    m.desmontar();
    pedidos[0]!.resolver(lista('Oaxaca'));
    await tanda(); m.render();
    expect(m.resultado.conteo).toEqual({ estado: 'cargando' });
  });

  it('control · sin salir de la pestaña, el reintento sí publica', async () => {
    const m = await montar();
    pedidos[0]!.rechazar(new Error('red'));
    await tanda(); m.render();
    m.resultado.reintentar(); m.render();
    pedidos[1]!.resolver(lista('Oaxaca'));
    await tanda(); m.render();
    expect(nombres(m)).toEqual(['Oaxaca']);
  });

  it('«Cerrados» muestra y oculta la lista; al salir de la pestaña, vuelve a ocultarse', async () => {
    const m = await montar();
    expect(m.resultado.abierta).toBe(false);
    m.resultado.alternar(); m.render();
    expect(m.resultado.abierta).toBe(true);
    m.resultado.alternar(); m.render();
    expect(m.resultado.abierta).toBe(false);
    m.resultado.alternar(); m.render();
    activa = false; m.render(); m.render();
    expect(m.resultado.abierta).toBe(false);
  });

  it('🔴 sólo pide los cerrados: los abiertos están en la pantalla principal (D265)', async () => {
    await hastaVolverALaPestana();
    expect(pedidos.every((p) => p.lista === 'cerrados')).toBe(true);
  });
});
