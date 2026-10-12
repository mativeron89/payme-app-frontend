/**
 * D276-1 · la precarga de los viajes abiertos (condición del OK del Bibliotecario: «precargá la lista de viajes apenas
 * la sesión está lista, no sólo al abrir Inicio»). Una pedida a la vez; con dato ya recordado, ninguna; un error no
 * rompe nada (la cámara sigue con lo de siempre).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getViajes = vi.fn();
vi.mock('../../api', () => ({ api: { getViajes: (...a: unknown[]) => getViajes(...a) } }));
const recordados = vi.hoisted(() => ({ valor: null as unknown[] | null }));
vi.mock('../../api/viajesDeHoy', async (orig) => ({
  ...(await orig<typeof import('../../api/viajesDeHoy')>()),
  viajesAbiertosRecordados: () => recordados.valor,
}));

const { precargarViajesAbiertos } = await import('./useViajesDeHoy');
const { ultimoVisto } = await import('../../api/ultimoVisto');

/** W-02 · la cuenta y la generación de ahora: lo que la app sacaría con `ultimoVisto.turno()`. */
const cuenta = { dueno: null as string | null, generacion: 0 };
const turno = vi.spyOn(ultimoVisto, 'turno').mockImplementation(() => ({ dueno: cuenta.dueno, generacion: cuenta.generacion }));

/** Entrar con otra cuenta: cambia el dueño y sube la generación (como `vaciar` al cambiar la sesión). */
function entrar(dueno: string): void {
  cuenta.dueno = dueno;
  cuenta.generacion += 1;
}

/** Cada pedido queda pendiente, con quién lo pidió y cómo soltarlo. */
function pedidosRetenidos() {
  const pedidos: Array<{ quien: string | null; soltar: () => void }> = [];
  getViajes.mockImplementation(() => new Promise((r) => {
    pedidos.push({ quien: cuenta.dueno, soltar: () => r({ viajes: [] }) });
  }));
  return pedidos;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  getViajes.mockReset();
  recordados.valor = null;
  cuenta.dueno = null;
  cuenta.generacion = 0;
});

describe('🔴 D276-1 · precargar los viajes abiertos', () => {
  it('pide la lista de ABIERTOS una sola vez mientras está en vuelo', async () => {
    let soltar: (v: unknown) => void = () => undefined;
    getViajes.mockReturnValue(new Promise((r) => { soltar = r; }));
    precargarViajesAbiertos();
    precargarViajesAbiertos();
    expect(getViajes).toHaveBeenCalledTimes(1);
    expect(getViajes).toHaveBeenCalledWith('abiertos');
    soltar({ viajes: [] });
    await vi.waitFor(() => {
      // Terminada, una nueva precarga vuelve a pedir (si sigue sin dato).
      precargarViajesAbiertos();
      expect(getViajes).toHaveBeenCalledTimes(2);
    });
  });

  it('con la lista ya recordada, no pide nada', () => {
    recordados.valor = [];
    precargarViajesAbiertos();
    expect(getViajes).not.toHaveBeenCalled();
  });

  it('un error no rompe nada y no deja la precarga trabada', async () => {
    getViajes.mockReturnValueOnce(Promise.reject(new Error('red caída')));
    expect(() => precargarViajesAbiertos()).not.toThrow();
    await vi.waitFor(() => {
      getViajes.mockReturnValue(new Promise(() => undefined));
      precargarViajesAbiertos();
      expect(getViajes).toHaveBeenCalledTimes(2);
    });
  });
});

/**
 * 🔴 W-02 (auditoría de Codex) · la precarga en vuelo es de UNA cuenta. Antes, con la de A pendiente, la de B no pedía
 * nada y, al terminar la de A, nadie la pedía: la cámara de B quedaba con lo de siempre.
 */
describe('🔴 W-02 · la precarga no queda trabada al cambiar de cuenta', () => {
  it('A→B: con la de A pendiente, B pide la suya; el final tardío de A no suelta la de B', async () => {
    const pedidos = pedidosRetenidos();
    entrar('A');
    precargarViajesAbiertos();
    entrar('B');
    precargarViajesAbiertos();
    expect(pedidos.map((p) => p.quien)).toEqual(['A', 'B']);
    // Termina la de A: la de B sigue en vuelo, y otra precarga de B no pide de nuevo.
    pedidos[0]!.soltar();
    await tick();
    precargarViajesAbiertos();
    expect(pedidos.map((p) => p.quien)).toEqual(['A', 'B']);
    // Termina la de B: sin dato todavía, una nueva precarga vuelve a pedir.
    pedidos[1]!.soltar();
    await tick();
    precargarViajesAbiertos();
    expect(pedidos.map((p) => p.quien)).toEqual(['A', 'B', 'B']);
    expect(turno).toHaveBeenCalled();
  });

  it('A→B→A con respuestas fuera de orden: cada entrada pide la suya, y sólo la última sigue en vuelo', async () => {
    const pedidos = pedidosRetenidos();
    entrar('A');
    precargarViajesAbiertos();
    entrar('B');
    precargarViajesAbiertos();
    entrar('A');
    precargarViajesAbiertos();
    // La vuelta a A es otra generación: no se cuelga del pedido viejo de A.
    expect(pedidos.map((p) => p.quien)).toEqual(['A', 'B', 'A']);
    // Llegan al revés: primero la de B y después la primera de A. La de ahora (la segunda de A) sigue en vuelo.
    pedidos[1]!.soltar();
    pedidos[0]!.soltar();
    await tick();
    precargarViajesAbiertos();
    expect(pedidos).toHaveLength(3);
    pedidos[2]!.soltar();
    await tick();
    precargarViajesAbiertos();
    expect(pedidos.map((p) => p.quien)).toEqual(['A', 'B', 'A', 'A']);
  });

  it('si cambió la cuenta y la generación todavía no (la sesión cambió sin aviso, por ejemplo desde otra pestaña), B igual pide la suya', () => {
    const pedidos = pedidosRetenidos();
    entrar('A');
    precargarViajesAbiertos();
    // `loadSession()` ya da B, pero el `vaciar` que sube la generación todavía no corrió.
    cuenta.dueno = 'B';
    precargarViajesAbiertos();
    expect(pedidos.map((p) => p.quien)).toEqual(['A', 'B']);
  });

  it('con la misma cuenta y la misma generación, sigue siendo una a la vez', () => {
    const pedidos = pedidosRetenidos();
    entrar('A');
    precargarViajesAbiertos();
    precargarViajesAbiertos();
    precargarViajesAbiertos();
    expect(pedidos).toHaveLength(1);
  });
});
