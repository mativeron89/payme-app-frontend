import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Api } from './index';

let api: Api;
const fetchFalso = vi.fn<typeof fetch>();
const config = (walletRail: boolean) => ({ features: { wallet_rail: walletRail } });
const respuesta = (body: ReturnType<typeof config>) => new Response(JSON.stringify(body), {
  headers: { 'content-type': 'application/json' },
});

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('VITE_MOCK', '0');
  fetchFalso.mockReset();
  vi.stubGlobal('fetch', fetchFalso);
  api = (await import('./index')).api;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it('AF-P2 · comparte tres lecturas en vuelo y vuelve a pedir después del éxito', async () => {
  let responder!: () => void;
  const primera = new Promise<void>((resolve) => { responder = resolve; });
  fetchFalso.mockImplementation(async () => { await primera; return respuesta(config(false)); });
  const lecturas = [api.getConfig(), api.getConfig(), api.getConfig()];
  responder();
  expect(await Promise.all(lecturas)).toEqual(Array.from({ length: 3 }, () => config(false)));
  expect(fetchFalso).toHaveBeenCalledTimes(1);
  expect(String(fetchFalso.mock.calls[0]?.[0])).toMatch(/\/api\/config$/);
  fetchFalso.mockResolvedValueOnce(respuesta(config(true)));
  await expect(api.getConfig()).resolves.toEqual(config(true));
  expect(fetchFalso).toHaveBeenCalledTimes(2);
});

it('AF-P2 · comparte el fallo y permite una petición nueva', async () => {
  const { HttpNetworkError } = await import('./http');
  const fallo = new TypeError('sin conexión');
  let rechazar!: (error: Error) => void;
  const primera = new Promise<Response>((_resolve, reject) => { rechazar = reject; });
  fetchFalso.mockReturnValue(primera);
  const resultado = Promise.allSettled([api.getConfig(), api.getConfig(), api.getConfig()]);
  rechazar(fallo);
  const rechazos = await resultado;
  expect(rechazos.map((lectura) => lectura.status)).toEqual(['rejected', 'rejected', 'rejected']);
  const [primero] = rechazos;
  if (primero.status !== 'rejected') throw new Error('Se esperaba un rechazo de red');
  expect(primero.reason).toBeInstanceOf(HttpNetworkError);
  expect(primero.reason.cause).toBe(fallo);
  for (const lectura of rechazos.slice(1)) {
    if (lectura.status !== 'rejected') throw new Error('Se esperaba el rechazo compartido');
    expect(lectura.reason).toBe(primero.reason);
  }
  expect(fetchFalso).toHaveBeenCalledTimes(1);
  fetchFalso.mockResolvedValueOnce(respuesta(config(true)));
  await expect(api.getConfig()).resolves.toEqual(config(true));
  expect(fetchFalso).toHaveBeenCalledTimes(2);
});
