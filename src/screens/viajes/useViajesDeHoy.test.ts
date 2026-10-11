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

beforeEach(() => {
  getViajes.mockReset();
  recordados.valor = null;
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
