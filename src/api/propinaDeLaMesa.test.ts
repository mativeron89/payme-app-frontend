import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpError } from './http';
import type { TipSetting } from './miParte';
import {
  estadoDePropina,
  guardandoPropina,
  guardarPropinaDeLaMesa,
  olvidarPropinasParaPruebas,
  suscribirPropina,
  type ClaveDePropina,
  type EnviarPropina,
  type EstadoDePropina,
} from './propinaDeLaMesa';

/**
 * D344 · el PUT de la propina en vuelo, fuera de las pantallas.
 *
 * Especificación (orden D344 y respuestas de V):
 *   · reintento sólo ante fallas transitorias (red, timeout, 5xx y 429): hasta
 *     3 intentos, 8000 ms por intento, esperas de 1000 ms y 2000 ms;
 *   · 400, 403, 404 y 409 son respuestas fijas: un intento, fase «rechazada»;
 *   · gana la última elección: nunca dos pedidos a la vez, las intermedias se
 *     descartan y nunca se publica «guardada» con un valor que ya no se quiere;
 *   · si cambia la cuenta, no se manda nada más a nombre de la anterior;
 *   · el estado vive por cuenta + código;
 *   · `guardarPropinaDeLaMesa` no lanza nunca.
 *
 * Los valores esperados están escritos a mano desde la especificación; ninguno
 * se obtiene llamando al código bajo prueba. Las promesas de `enviar` y de
 * `esperar` se controlan con diferidos: no hay timers reales.
 *
 * Condiciones y su caso (un mutante por término):
 *   · `deps.cuentaActual && deps.cuentaActual() !== clave.cuenta`: sin
 *     `cuentaActual` (sale el pedido), con la misma cuenta (sale) y con otra
 *     cuenta o `null` (no sale).
 *   · `intento < INTENTOS_DE_PROPINA && espera !== undefined`: con las
 *     constantes exportadas (3 intentos y dos esperas) los dos términos son
 *     redundantes entre sí; quitar uno solo no cambia el comportamiento
 *     (mutante equivalente). Lo que sí se fija es la lista exacta [1000, 2000]
 *     y que después del tercer intento no hay espera.
 *   · las tres salidas tempranas por `entrada.siguiente` (tras el éxito, tras
 *     la falla y tras la espera) tienen cada una su caso.
 */

const CLAVE: ClaveDePropina = { cuenta: 'a', code: 'PA-1' };
const DIEZ: TipSetting = { tip_bps: 1_000 };
const QUINCE: TipSetting = { tip_bps: 1_500 };
const VEINTE: TipSetting = { tip_bps: 2_000 };
const CIEN_PESOS: TipSetting = { tip_cents: 10_000 };

interface Diferido<T> {
  readonly promesa: Promise<T>;
  readonly resolver: (valor: T) => void;
  readonly rechazar: (motivo: unknown) => void;
}

function diferido<T>(): Diferido<T> {
  let resolver!: (valor: T) => void;
  let rechazar!: (motivo: unknown) => void;
  const promesa = new Promise<T>((res, rej) => { resolver = res; rechazar = rej; });
  return { promesa, resolver, rechazar };
}

interface Llamada {
  readonly code: string;
  readonly setting: TipSetting | null;
  readonly timeoutMs: number;
  readonly resolver: (valor: TipSetting | null) => void;
  readonly rechazar: (motivo: unknown) => void;
}

/**
 * Un `enviar` cuyo resultado decide la prueba, llamada por llamada. Cuenta
 * cuántos pedidos están sin resolver a la vez (`maxEnVuelo`).
 */
function enviarControlado() {
  const llamadas: Llamada[] = [];
  let enVuelo = 0;
  let maxEnVuelo = 0;
  const enviar: EnviarPropina = (code, setting, timeoutMs) => {
    const d = diferido<TipSetting | null>();
    enVuelo += 1;
    maxEnVuelo = Math.max(maxEnVuelo, enVuelo);
    let abierta = true;
    const cerrar = () => { if (abierta) { abierta = false; enVuelo -= 1; } };
    llamadas.push({
      code,
      setting,
      timeoutMs,
      resolver: (v) => { cerrar(); d.resolver(v); },
      rechazar: (e) => { cerrar(); d.rechazar(e); },
    });
    return d.promesa;
  };
  return {
    enviar,
    llamadas,
    get maxEnVuelo() { return maxEnVuelo; },
  };
}

/** Espía de `esperar` que no duerme: resuelve enseguida y anota los ms. */
function esperarSinDormir() {
  return vi.fn((_ms: number) => Promise.resolve());
}

/** Deja correr las microtareas pendientes (sin timers reales). */
async function vaciar(): Promise<void> {
  for (let i = 0; i < 60; i += 1) await Promise.resolve();
}

const desuscribir: Array<() => void> = [];

/** Graba cada estado publicado de la clave, en orden. */
function grabar(clave: ClaveDePropina = CLAVE): EstadoDePropina[] {
  const vistos: EstadoDePropina[] = [];
  desuscribir.push(suscribirPropina(() => { vistos.push(estadoDePropina(clave)); }));
  return vistos;
}

beforeEach(() => {
  olvidarPropinasParaPruebas();
});

afterEach(() => {
  while (desuscribir.length > 0) desuscribir.pop()!();
});

describe('estado inicial y lectura', () => {
  it('estadoDePropina(null) es «quieta» y guardandoPropina(null) es false', () => {
    expect(estadoDePropina(null)).toEqual({ fase: 'quieta' });
    expect(guardandoPropina(null)).toBe(false);
  });

  it('una clave que nunca guardó nada está «quieta»', () => {
    expect(estadoDePropina({ cuenta: 'z', code: 'PA-9' })).toEqual({ fase: 'quieta' });
    expect(guardandoPropina({ cuenta: 'z', code: 'PA-9' })).toBe(false);
  });
});

describe('éxito', () => {
  it('mientras sale: «guardando» con lo deseado y guardandoPropina true', () => {
    const e = enviarControlado();
    void guardarPropinaDeLaMesa(CLAVE, DIEZ, { enviar: e.enviar, esperar: esperarSinDormir() });
    expect(estadoDePropina(CLAVE)).toMatchObject({ fase: 'guardando', deseado: { tip_bps: 1_000 } });
    expect(guardandoPropina(CLAVE)).toBe(true);
  });

  it('manda el código de la mesa, lo deseado y 8000 ms de timeout', () => {
    const e = enviarControlado();
    void guardarPropinaDeLaMesa(CLAVE, DIEZ, { enviar: e.enviar, esperar: esperarSinDormir() });
    expect(e.llamadas.map((l) => [l.code, l.setting, l.timeoutMs])).toEqual([
      ['PA-1', { tip_bps: 1_000 }, 8_000],
    ]);
  });

  it('al resolver: «guardada» con el setting que devolvió enviar, no con lo deseado', async () => {
    const e = enviarControlado();
    const esperar = esperarSinDormir();
    const p = guardarPropinaDeLaMesa(CLAVE, DIEZ, { enviar: e.enviar, esperar });
    // El dueño contesta otro valor (lo que quedó guardado): manda la respuesta.
    e.llamadas[0]!.resolver(QUINCE);
    await expect(p).resolves.toEqual({ fase: 'guardada', setting: { tip_bps: 1_500 } });
    expect(estadoDePropina(CLAVE)).toEqual({ fase: 'guardada', setting: { tip_bps: 1_500 } });
    expect(guardandoPropina(CLAVE)).toBe(false);
    expect(e.llamadas).toHaveLength(1);
    expect(esperar).not.toHaveBeenCalled();
  });

  it('«sin propina» (null) también se guarda y queda «guardada» con null', async () => {
    const e = enviarControlado();
    const p = guardarPropinaDeLaMesa(CLAVE, null, { enviar: e.enviar, esperar: esperarSinDormir() });
    expect(estadoDePropina(CLAVE)).toMatchObject({ fase: 'guardando', deseado: null });
    expect(e.llamadas.map((l) => l.setting)).toEqual([null]);
    e.llamadas[0]!.resolver(null);
    await expect(p).resolves.toEqual({ fase: 'guardada', setting: null });
  });

  it('una elección nueva después de terminar la anterior manda otro pedido', async () => {
    const e = enviarControlado();
    const deps = { enviar: e.enviar, esperar: esperarSinDormir() };
    const p1 = guardarPropinaDeLaMesa(CLAVE, DIEZ, deps);
    e.llamadas[0]!.resolver(DIEZ);
    await p1;
    const p2 = guardarPropinaDeLaMesa(CLAVE, VEINTE, deps);
    // 2 llamadas: la de DIEZ (ya resuelta) y la de VEINTE.
    expect(e.llamadas.map((l) => l.setting)).toEqual([{ tip_bps: 1_000 }, { tip_bps: 2_000 }]);
    e.llamadas[1]!.resolver(VEINTE);
    await expect(p2).resolves.toEqual({ fase: 'guardada', setting: { tip_bps: 2_000 } });
  });
});

describe('fallas transitorias: hasta 3 intentos con esperas de 1000 y 2000 ms', () => {
  const transitorios: ReadonlyArray<readonly [string, () => unknown]> = [
    ['red (TypeError de fetch)', () => new TypeError('Failed to fetch')],
    ['timeout (AbortError)', () => new DOMException('The operation was aborted.', 'AbortError')],
    ['500', () => new HttpError(500, null)],
    ['503', () => new HttpError(503, { error: 'service_unavailable' })],
    ['429', () => new HttpError(429, { error: 'rate_limited' })],
    ['408 (timeout del servidor)', () => new HttpError(408, null)],
  ];

  for (const [nombre, error] of transitorios) {
    it(`${nombre} tres veces seguidas: «agotada» con lo deseado, 3 llamadas y esperas [1000, 2000]`, async () => {
      const enviar = vi.fn<EnviarPropina>(() => Promise.reject(error()));
      const esperar = esperarSinDormir();
      const p = guardarPropinaDeLaMesa(CLAVE, DIEZ, { enviar, esperar });
      await expect(p).resolves.toEqual({ fase: 'agotada', deseado: { tip_bps: 1_000 } });
      expect(estadoDePropina(CLAVE)).toEqual({ fase: 'agotada', deseado: { tip_bps: 1_000 } });
      expect(guardandoPropina(CLAVE)).toBe(false);
      // 3 intentos, cada uno con el mismo código, lo mismo deseado y 8000 ms.
      expect(enviar.mock.calls).toEqual([
        ['PA-1', { tip_bps: 1_000 }, 8_000],
        ['PA-1', { tip_bps: 1_000 }, 8_000],
        ['PA-1', { tip_bps: 1_000 }, 8_000],
      ]);
      // Una espera entre el 1.º y el 2.º, otra entre el 2.º y el 3.º; ninguna después del 3.º.
      expect(esperar.mock.calls.map((c) => c[0])).toEqual([1_000, 2_000]);
    });
  }

  it('un transitorio y después éxito: 2 llamadas, una espera de 1000 ms y «guardada»', async () => {
    const e = enviarControlado();
    const esperar = esperarSinDormir();
    const p = guardarPropinaDeLaMesa(CLAVE, DIEZ, { enviar: e.enviar, esperar });
    e.llamadas[0]!.rechazar(new HttpError(502, null));
    await vaciar();
    expect(e.llamadas).toHaveLength(2);
    // Mientras espera y reintenta, sigue «guardando» con lo deseado.
    expect(estadoDePropina(CLAVE)).toMatchObject({ fase: 'guardando', deseado: { tip_bps: 1_000 } });
    expect(guardandoPropina(CLAVE)).toBe(true);
    e.llamadas[1]!.resolver(DIEZ);
    await expect(p).resolves.toEqual({ fase: 'guardada', setting: { tip_bps: 1_000 } });
    expect(esperar.mock.calls.map((c) => c[0])).toEqual([1_000]);
    expect(e.llamadas.map((l) => l.timeoutMs)).toEqual([8_000, 8_000]);
  });

  it('dos transitorios y después éxito: 3 llamadas, esperas [1000, 2000] y «guardada»', async () => {
    const e = enviarControlado();
    const esperar = esperarSinDormir();
    const p = guardarPropinaDeLaMesa(CLAVE, DIEZ, { enviar: e.enviar, esperar });
    e.llamadas[0]!.rechazar(new TypeError('Failed to fetch'));
    await vaciar();
    e.llamadas[1]!.rechazar(new HttpError(429, null));
    await vaciar();
    e.llamadas[2]!.resolver(DIEZ);
    await expect(p).resolves.toEqual({ fase: 'guardada', setting: { tip_bps: 1_000 } });
    expect(e.llamadas).toHaveLength(3);
    expect(esperar.mock.calls.map((c) => c[0])).toEqual([1_000, 2_000]);
  });
});

describe('respuestas fijas: un solo intento y «rechazada»', () => {
  const fijos: ReadonlyArray<readonly [number, string]> = [
    [400, 'validation_error'],
    [403, 'not_mesa_organizer'],
    [404, 'mesa_not_found'],
    [409, 'mesa_not_active'],
  ];

  for (const [status, codigo] of fijos) {
    it(`${status} ${codigo}: un intento, sin esperas, «rechazada» con status y código del cuerpo`, async () => {
      const enviar = vi.fn<EnviarPropina>(() => Promise.reject(new HttpError(status, { error: codigo })));
      const esperar = esperarSinDormir();
      const p = guardarPropinaDeLaMesa(CLAVE, DIEZ, { enviar, esperar });
      const esperado = { fase: 'rechazada', deseado: { tip_bps: 1_000 }, status, codigo };
      await expect(p).resolves.toEqual(esperado);
      expect(estadoDePropina(CLAVE)).toEqual(esperado);
      expect(guardandoPropina(CLAVE)).toBe(false);
      expect(enviar).toHaveBeenCalledTimes(1);
      expect(esperar).not.toHaveBeenCalled();
    });
  }

  it('un 404 sin cuerpo: «rechazada» con status 404 y código null', async () => {
    const enviar = vi.fn<EnviarPropina>(() => Promise.reject(new HttpError(404, null)));
    const p = guardarPropinaDeLaMesa(CLAVE, CIEN_PESOS, { enviar, esperar: esperarSinDormir() });
    await expect(p).resolves.toEqual({
      fase: 'rechazada',
      deseado: { tip_cents: 10_000 },
      status: 404,
      codigo: null,
    });
    expect(enviar).toHaveBeenCalledTimes(1);
  });

  it('un 409 después de un transitorio corta ahí: 2 llamadas y una sola espera', async () => {
    const e = enviarControlado();
    const esperar = esperarSinDormir();
    const p = guardarPropinaDeLaMesa(CLAVE, DIEZ, { enviar: e.enviar, esperar });
    e.llamadas[0]!.rechazar(new HttpError(503, null));
    await vaciar();
    e.llamadas[1]!.rechazar(new HttpError(409, { error: 'mesa_not_active' }));
    await expect(p).resolves.toEqual({
      fase: 'rechazada',
      deseado: { tip_bps: 1_000 },
      status: 409,
      codigo: 'mesa_not_active',
    });
    expect(e.llamadas).toHaveLength(2);
    expect(esperar.mock.calls.map((c) => c[0])).toEqual([1_000]);
  });
});

describe('gana la última elección', () => {
  it('una segunda elección con la primera en vuelo: nunca dos pedidos a la vez y gana la segunda', async () => {
    const e = enviarControlado();
    const deps = { enviar: e.enviar, esperar: esperarSinDormir() };
    const vistos = grabar();
    const p1 = guardarPropinaDeLaMesa(CLAVE, DIEZ, deps);
    const p2 = guardarPropinaDeLaMesa(CLAVE, VEINTE, deps);
    // La segunda todavía no sale: la primera sigue sin resolver.
    expect(e.llamadas.map((l) => l.setting)).toEqual([{ tip_bps: 1_000 }]);
    // Lo que se ve es lo último que eligió la persona.
    expect(estadoDePropina(CLAVE)).toMatchObject({ fase: 'guardando', deseado: { tip_bps: 2_000 } });

    e.llamadas[0]!.resolver(DIEZ);
    await vaciar();
    // Ahora sí sale la segunda, después de la primera.
    expect(e.llamadas.map((l) => l.setting)).toEqual([{ tip_bps: 1_000 }, { tip_bps: 2_000 }]);
    expect(estadoDePropina(CLAVE)).toMatchObject({ fase: 'guardando', deseado: { tip_bps: 2_000 } });

    e.llamadas[1]!.resolver(VEINTE);
    const final = { fase: 'guardada', setting: { tip_bps: 2_000 } };
    await expect(p1).resolves.toEqual(final);
    await expect(p2).resolves.toEqual(final);
    expect(estadoDePropina(CLAVE)).toEqual(final);
    expect(e.maxEnVuelo).toBe(1);
    // Nunca se publicó «guardada» con el valor de la primera.
    expect(vistos.filter((s) => s.fase === 'guardada')).toEqual([final]);
  });

  it('tres elecciones rápidas: sale la primera y la última; la del medio se descarta', async () => {
    const e = enviarControlado();
    const deps = { enviar: e.enviar, esperar: esperarSinDormir() };
    const vistos = grabar();
    const p = guardarPropinaDeLaMesa(CLAVE, DIEZ, deps);
    void guardarPropinaDeLaMesa(CLAVE, QUINCE, deps);
    void guardarPropinaDeLaMesa(CLAVE, VEINTE, deps);
    e.llamadas[0]!.resolver(DIEZ);
    await vaciar();
    expect(e.llamadas.map((l) => l.setting)).toEqual([{ tip_bps: 1_000 }, { tip_bps: 2_000 }]);
    e.llamadas[1]!.resolver(VEINTE);
    await expect(p).resolves.toEqual({ fase: 'guardada', setting: { tip_bps: 2_000 } });
    await vaciar();
    // Ningún pedido con 1500: el del medio no salió nunca.
    expect(e.llamadas).toHaveLength(2);
    expect(e.maxEnVuelo).toBe(1);
    expect(vistos.filter((s) => s.fase === 'guardada')).toEqual([{ fase: 'guardada', setting: { tip_bps: 2_000 } }]);
  });

  it('la primera falla transitoria con una segunda en cola: no se reintenta la primera, sale la segunda', async () => {
    const e = enviarControlado();
    const deps = { enviar: e.enviar, esperar: esperarSinDormir() };
    const vistos = grabar();
    const p = guardarPropinaDeLaMesa(CLAVE, DIEZ, deps);
    void guardarPropinaDeLaMesa(CLAVE, VEINTE, deps);
    e.llamadas[0]!.rechazar(new HttpError(503, null));
    await vaciar();
    expect(e.llamadas.map((l) => l.setting)).toEqual([{ tip_bps: 1_000 }, { tip_bps: 2_000 }]);
    e.llamadas[1]!.resolver(VEINTE);
    await expect(p).resolves.toEqual({ fase: 'guardada', setting: { tip_bps: 2_000 } });
    expect(e.llamadas).toHaveLength(2);
    expect(e.maxEnVuelo).toBe(1);
    expect(vistos.some((s) => s.fase === 'agotada')).toBe(false);
    // Tampoco se espera para abandonar la primera: la segunda sale enseguida.
    expect(deps.esperar).not.toHaveBeenCalled();
  });

  it('la primera recibe un 409 con una segunda en cola: no se publica «rechazada» de la primera y gana la segunda', async () => {
    const e = enviarControlado();
    const deps = { enviar: e.enviar, esperar: esperarSinDormir() };
    const vistos = grabar();
    const p = guardarPropinaDeLaMesa(CLAVE, DIEZ, deps);
    void guardarPropinaDeLaMesa(CLAVE, VEINTE, deps);
    e.llamadas[0]!.rechazar(new HttpError(409, { error: 'mesa_not_active' }));
    await vaciar();
    expect(e.llamadas.map((l) => l.setting)).toEqual([{ tip_bps: 1_000 }, { tip_bps: 2_000 }]);
    e.llamadas[1]!.resolver(VEINTE);
    await expect(p).resolves.toEqual({ fase: 'guardada', setting: { tip_bps: 2_000 } });
    expect(vistos.some((s) => s.fase === 'rechazada')).toBe(false);
  });

  it('una segunda elección durante la espera del reintento: no se reintenta la primera, sale la segunda', async () => {
    const e = enviarControlado();
    const espera = diferido<void>();
    const esperar = vi.fn((_ms: number) => espera.promesa);
    const deps = { enviar: e.enviar, esperar };
    const p = guardarPropinaDeLaMesa(CLAVE, DIEZ, deps);
    e.llamadas[0]!.rechazar(new TypeError('Failed to fetch'));
    await vaciar();
    expect(esperar.mock.calls.map((c) => c[0])).toEqual([1_000]);
    void guardarPropinaDeLaMesa(CLAVE, VEINTE, deps);
    // Durante la espera no sale nada nuevo.
    expect(e.llamadas).toHaveLength(1);
    espera.resolver();
    await vaciar();
    expect(e.llamadas.map((l) => l.setting)).toEqual([{ tip_bps: 1_000 }, { tip_bps: 2_000 }]);
    e.llamadas[1]!.resolver(VEINTE);
    await expect(p).resolves.toEqual({ fase: 'guardada', setting: { tip_bps: 2_000 } });
    expect(e.maxEnVuelo).toBe(1);
  });

  it('una elección que llega justo al terminar la anterior también sale (barrido de microtareas)', async () => {
    // Para cada desfase de 0 a 40 microtareas después de resolver la primera,
    // la segunda tiene que salir y quedar «guardada». Ninguna elección se pierde.
    const perdidas: string[] = [];
    for (let desfase = 0; desfase <= 40; desfase += 1) {
      olvidarPropinasParaPruebas();
      const e = enviarControlado();
      const deps = { enviar: e.enviar, esperar: esperarSinDormir() };
      void guardarPropinaDeLaMesa(CLAVE, DIEZ, deps);
      e.llamadas[0]!.resolver(DIEZ);
      for (let i = 0; i < desfase; i += 1) await Promise.resolve();
      const p2 = guardarPropinaDeLaMesa(CLAVE, VEINTE, deps);
      await vaciar();
      const segunda = e.llamadas[1];
      if (!segunda) {
        const resuelta = await p2;
        perdidas.push(
          `desfase ${desfase}: llamadas=${e.llamadas.length}, estado=${JSON.stringify(estadoDePropina(CLAVE))}, ` +
          `resuelve=${JSON.stringify(resuelta)}`,
        );
        continue;
      }
      segunda.resolver(VEINTE);
      const final = await p2;
      const esperado = { fase: 'guardada', setting: { tip_bps: 2_000 } };
      if (JSON.stringify(final) !== JSON.stringify(esperado)
        || JSON.stringify(estadoDePropina(CLAVE)) !== JSON.stringify(esperado)) {
        perdidas.push(`desfase ${desfase}: resuelve=${JSON.stringify(final)}`);
      }
      expect(e.maxEnVuelo).toBe(1);
    }
    expect(perdidas, `la segunda elección no salió: ${perdidas.join(' · ')}`).toEqual([]);
  });
});

describe('cambio de cuenta', () => {
  it('sin cuentaActual el pedido sale normalmente', async () => {
    const e = enviarControlado();
    const p = guardarPropinaDeLaMesa(CLAVE, DIEZ, { enviar: e.enviar, esperar: esperarSinDormir() });
    expect(e.llamadas).toHaveLength(1);
    e.llamadas[0]!.resolver(DIEZ);
    await expect(p).resolves.toEqual({ fase: 'guardada', setting: { tip_bps: 1_000 } });
  });

  it('con la misma cuenta en sesión el pedido sale normalmente', async () => {
    const e = enviarControlado();
    const p = guardarPropinaDeLaMesa(CLAVE, DIEZ, {
      enviar: e.enviar,
      esperar: esperarSinDormir(),
      cuentaActual: () => 'a',
    });
    expect(e.llamadas).toHaveLength(1);
    e.llamadas[0]!.resolver(DIEZ);
    await expect(p).resolves.toEqual({ fase: 'guardada', setting: { tip_bps: 1_000 } });
  });

  it('con otra cuenta en sesión antes del primer intento: no llama a enviar y queda «quieta»', async () => {
    const enviar = vi.fn<EnviarPropina>(() => Promise.resolve(DIEZ));
    const p = guardarPropinaDeLaMesa(CLAVE, DIEZ, { enviar, esperar: esperarSinDormir(), cuentaActual: () => 'b' });
    await expect(p).resolves.toEqual({ fase: 'quieta' });
    expect(enviar).not.toHaveBeenCalled();
    expect(estadoDePropina(CLAVE)).toEqual({ fase: 'quieta' });
    expect(guardandoPropina(CLAVE)).toBe(false);
  });

  it('sin sesión (cuentaActual null) antes del primer intento: no llama a enviar y queda «quieta»', async () => {
    const enviar = vi.fn<EnviarPropina>(() => Promise.resolve(DIEZ));
    const p = guardarPropinaDeLaMesa(CLAVE, DIEZ, { enviar, esperar: esperarSinDormir(), cuentaActual: () => null });
    await expect(p).resolves.toEqual({ fase: 'quieta' });
    expect(enviar).not.toHaveBeenCalled();
    expect(estadoDePropina(CLAVE)).toEqual({ fase: 'quieta' });
  });

  it('la cuenta cambia antes del reintento: un solo pedido y «quieta»', async () => {
    let cuenta: string | null = 'a';
    const e = enviarControlado();
    const esperar = esperarSinDormir();
    const p = guardarPropinaDeLaMesa(CLAVE, DIEZ, { enviar: e.enviar, esperar, cuentaActual: () => cuenta });
    cuenta = 'b';
    e.llamadas[0]!.rechazar(new HttpError(503, null));
    await expect(p).resolves.toEqual({ fase: 'quieta' });
    expect(e.llamadas).toHaveLength(1);
    expect(estadoDePropina(CLAVE)).toEqual({ fase: 'quieta' });
    expect(guardandoPropina(CLAVE)).toBe(false);
  });

  it('la cuenta cambia con una elección en cola: lo que esperaba turno se descarta y queda «quieta»', async () => {
    let cuenta: string | null = 'a';
    const e = enviarControlado();
    const deps = { enviar: e.enviar, esperar: esperarSinDormir(), cuentaActual: () => cuenta };
    const vistos = grabar();
    const p1 = guardarPropinaDeLaMesa(CLAVE, DIEZ, deps);
    const p2 = guardarPropinaDeLaMesa(CLAVE, VEINTE, deps);
    cuenta = 'b';
    e.llamadas[0]!.resolver(DIEZ);
    await expect(p1).resolves.toEqual({ fase: 'quieta' });
    await expect(p2).resolves.toEqual({ fase: 'quieta' });
    await vaciar();
    // Sólo salió la primera; la de 2000 no salió a nombre de nadie.
    expect(e.llamadas.map((l) => l.setting)).toEqual([{ tip_bps: 1_000 }]);
    expect(estadoDePropina(CLAVE)).toEqual({ fase: 'quieta' });
    expect(vistos.some((s) => s.fase === 'guardada')).toBe(false);
  });
});

describe('claves por cuenta + código', () => {
  it('las claves no se confunden al concatenar: {a, bPA-1} no ve el estado de {ab, PA-1}', async () => {
    const e = enviarControlado();
    const p = guardarPropinaDeLaMesa({ cuenta: 'ab', code: 'PA-1' }, DIEZ, { enviar: e.enviar, esperar: esperarSinDormir() });
    expect(estadoDePropina({ cuenta: 'ab', code: 'PA-1' })).toMatchObject({ fase: 'guardando' });
    expect(estadoDePropina({ cuenta: 'a', code: 'bPA-1' })).toEqual({ fase: 'quieta' });
    e.llamadas[0]!.resolver(DIEZ);
    await p;
    expect(estadoDePropina({ cuenta: 'a', code: 'bPA-1' })).toEqual({ fase: 'quieta' });
  });

  it('el estado de {a, PA-1} no se ve con {b, PA-1} ni con {a, PA-2}', async () => {
    const e = enviarControlado();
    const p = guardarPropinaDeLaMesa({ cuenta: 'a', code: 'PA-1' }, DIEZ, { enviar: e.enviar, esperar: esperarSinDormir() });
    expect(estadoDePropina({ cuenta: 'a', code: 'PA-1' })).toMatchObject({ fase: 'guardando' });
    expect(guardandoPropina({ cuenta: 'a', code: 'PA-1' })).toBe(true);
    expect(estadoDePropina({ cuenta: 'b', code: 'PA-1' })).toEqual({ fase: 'quieta' });
    expect(guardandoPropina({ cuenta: 'b', code: 'PA-1' })).toBe(false);
    expect(estadoDePropina({ cuenta: 'a', code: 'PA-2' })).toEqual({ fase: 'quieta' });
    expect(guardandoPropina({ cuenta: 'a', code: 'PA-2' })).toBe(false);
    e.llamadas[0]!.resolver(DIEZ);
    await p;
    expect(estadoDePropina({ cuenta: 'a', code: 'PA-1' })).toEqual({ fase: 'guardada', setting: { tip_bps: 1_000 } });
    expect(estadoDePropina({ cuenta: 'b', code: 'PA-1' })).toEqual({ fase: 'quieta' });
    expect(estadoDePropina({ cuenta: 'a', code: 'PA-2' })).toEqual({ fase: 'quieta' });
  });

  it('otra mesa no espera a la primera: cada clave tiene su propio pedido', async () => {
    const e = enviarControlado();
    const deps = { enviar: e.enviar, esperar: esperarSinDormir() };
    const p1 = guardarPropinaDeLaMesa({ cuenta: 'a', code: 'PA-1' }, DIEZ, deps);
    const p2 = guardarPropinaDeLaMesa({ cuenta: 'a', code: 'PA-2' }, VEINTE, deps);
    expect(e.llamadas.map((l) => [l.code, l.setting])).toEqual([
      ['PA-1', { tip_bps: 1_000 }],
      ['PA-2', { tip_bps: 2_000 }],
    ]);
    e.llamadas[1]!.resolver(VEINTE);
    await expect(p2).resolves.toEqual({ fase: 'guardada', setting: { tip_bps: 2_000 } });
    expect(estadoDePropina({ cuenta: 'a', code: 'PA-1' })).toMatchObject({ fase: 'guardando', deseado: { tip_bps: 1_000 } });
    e.llamadas[0]!.resolver(DIEZ);
    await expect(p1).resolves.toEqual({ fase: 'guardada', setting: { tip_bps: 1_000 } });
  });
});

describe('oyentes', () => {
  it('los oyentes reciben avisos mientras sale y al terminar; desuscribir deja de avisar', async () => {
    const e = enviarControlado();
    const oyente = vi.fn();
    const quitar = suscribirPropina(oyente);
    const p = guardarPropinaDeLaMesa(CLAVE, DIEZ, { enviar: e.enviar, esperar: esperarSinDormir() });
    const alSalir = oyente.mock.calls.length;
    expect(alSalir).toBeGreaterThan(0);
    e.llamadas[0]!.resolver(DIEZ);
    await p;
    expect(oyente.mock.calls.length).toBeGreaterThan(alSalir);

    quitar();
    const antes = oyente.mock.calls.length;
    const p2 = guardarPropinaDeLaMesa(CLAVE, VEINTE, { enviar: e.enviar, esperar: esperarSinDormir() });
    e.llamadas[1]!.resolver(VEINTE);
    await p2;
    expect(oyente.mock.calls.length).toBe(antes);
  });

  it('el último estado que ve un oyente es el final', async () => {
    const e = enviarControlado();
    const vistos = grabar();
    const p = guardarPropinaDeLaMesa(CLAVE, DIEZ, { enviar: e.enviar, esperar: esperarSinDormir() });
    expect(vistos.at(-1)).toMatchObject({ fase: 'guardando', deseado: { tip_bps: 1_000 } });
    e.llamadas[0]!.resolver(DIEZ);
    await p;
    expect(vistos.at(-1)).toEqual({ fase: 'guardada', setting: { tip_bps: 1_000 } });
  });
});

describe('no lanza nunca', () => {
  const raros: ReadonlyArray<readonly [string, () => Promise<TipSetting | null>]> = [
    ['un string', () => Promise.reject('raro')],
    ['undefined', () => Promise.reject(undefined)],
    ['null', () => Promise.reject(null)],
    ['un número', () => Promise.reject(42)],
    ['un objeto cualquiera', () => Promise.reject({ status: 409 })],
    ['un throw sincrónico', () => { throw new Error('sincrónico'); }],
  ];

  for (const [nombre, falla] of raros) {
    it(`si enviar lanza ${nombre}, resuelve con un estado final y no rechaza`, async () => {
      const enviar = vi.fn<EnviarPropina>(falla);
      const p = guardarPropinaDeLaMesa(CLAVE, DIEZ, { enviar, esperar: esperarSinDormir() });
      const final = await p;
      expect(['agotada', 'rechazada']).toContain(final.fase);
      expect(estadoDePropina(CLAVE)).toEqual(final);
      expect(guardandoPropina(CLAVE)).toBe(false);
      // Nunca más de los 3 intentos.
      expect(enviar.mock.calls.length).toBeGreaterThanOrEqual(1);
      expect(enviar.mock.calls.length).toBeLessThanOrEqual(3);
    });
  }
});

describe('las dependencias que fallan no dejan la mesa en «guardando»', () => {
  it('un oyente que lanza no corta el pedido ni el aviso a los demás', async () => {
    const otro = vi.fn();
    desuscribir.push(suscribirPropina(() => { throw new Error('oyente roto'); }));
    desuscribir.push(suscribirPropina(otro));
    const enviar = vi.fn<EnviarPropina>(() => Promise.resolve(DIEZ));
    await expect(guardarPropinaDeLaMesa(CLAVE, DIEZ, { enviar, esperar: esperarSinDormir() }))
      .resolves.toEqual({ fase: 'guardada', setting: { tip_bps: 1_000 } });
    expect(otro).toHaveBeenCalled();
  });

  it('una espera que rechaza no frena los reintentos: tres intentos y «agotada»', async () => {
    const enviar = vi.fn<EnviarPropina>(() => Promise.reject(new HttpError(503, null)));
    const esperar = vi.fn((_ms: number) => Promise.reject(new Error('sin reloj')));
    await expect(guardarPropinaDeLaMesa(CLAVE, DIEZ, { enviar, esperar }))
      .resolves.toEqual({ fase: 'agotada', deseado: { tip_bps: 1_000 } });
    expect(enviar).toHaveBeenCalledTimes(3);
  });

  it('si no se puede leer la cuenta de la sesión, no se manda nada a nombre de nadie', async () => {
    const enviar = vi.fn<EnviarPropina>(() => Promise.resolve(DIEZ));
    const cuentaActual = () => { throw new Error('sin sesión'); };
    await expect(guardarPropinaDeLaMesa(CLAVE, DIEZ, { enviar, esperar: esperarSinDormir(), cuentaActual }))
      .resolves.toEqual({ fase: 'quieta' });
    expect(enviar).not.toHaveBeenCalled();
    expect(estadoDePropina(CLAVE)).toEqual({ fase: 'quieta' });
  });
});
