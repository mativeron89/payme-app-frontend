import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEADLINE_MS,
  LIMITE_BYTES,
  leerAvisoPrivacidad,
  leerEstadoEliminacion,
  PATH_AVISO,
  PREFIJO_STATUS,
} from './publicLegal';

/**
 * El cliente público · APP-FE-META-PUBLIC-COMPLIANCE-01.
 *
 * Se prueba CONTRA EL MÓDULO REAL, con `globalThis.fetch` stubbeado: lo que se
 * afirma es la request que sale y el veredicto que vuelve, no una reescritura
 * propia del cliente.
 *
 * 🔴 **El sentinela es lo más importante de este archivo.** `SENTINELA` es un
 * `confirmation_code` con forma legítima y contenido reconocible. Todo camino
 * de falla se corre con él puesto y se exige que **no aparezca en el valor
 * devuelto ni en ningún error**: es la propiedad que la orden nombra —el código
 * jamás fuera del pathname— verificada donde se puede producir la fuga.
 */

const SENTINELA = 'SENTINELAxyz012345_-abcd';
/** El aviso completo, tal como lo emite `GET /api/legal/aviso_privacidad`. */
const AVISO = {
  legal_text: {
    kind: 'aviso_privacidad',
    version: '1.4.0',
    hash: 'a'.repeat(64),
    effective_from: '2026-08-01T00:00:00Z',
    body: 'Cuerpo del aviso vigente.',
  },
};

interface Llamada {
  readonly url: string;
  readonly init: RequestInit;
}

let llamadas: Llamada[] = [];

/** Una respuesta real de undici: ejercita el lector de stream de `leerAcotado`. */
function respuesta(
  cuerpo: string,
  { status = 200, tipo = 'application/json' }: { status?: number; tipo?: string | null } = {},
): Response {
  return new Response(cuerpo, {
    status,
    headers: tipo === null ? {} : { 'content-type': tipo },
  });
}

function stubFetch(fn: (url: string, init: RequestInit) => Promise<Response>): void {
  vi.stubGlobal('fetch', (entrada: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(entrada);
    llamadas.push({ url, init });
    return fn(url, init);
  });
}

/** Atajo: siempre la misma respuesta. */
const stubFijo = (res: () => Response): void => stubFetch(() => Promise.resolve(res()));

beforeEach(() => { llamadas = []; });
afterEach(() => { vi.unstubAllGlobals(); });

describe('la request que sale · exacta, sin credenciales y una sola', () => {
  it('✅ el aviso pega al path owner literal, con las opciones de la orden', async () => {
    stubFijo(() => respuesta(JSON.stringify(AVISO)));
    const r = await leerAvisoPrivacidad();

    expect(r).toEqual({ estado: 'ok', aviso: AVISO.legal_text });
    expect(llamadas, 'un intento y nada más').toHaveLength(1);

    const { url, init } = llamadas[0]!;
    expect(url.endsWith(PATH_AVISO), `la URL no termina en el path owner: ${url}`).toBe(true);
    expect(init.method).toBe('GET');
    expect(init.credentials, 'viajarían cookies a una ruta pública').toBe('omit');
    expect(init.cache, 'sin no-store, un aviso vencido queda cacheado').toBe('no-store');
    expect(init.redirect, 'seguir un 30x es aceptar un destino no escrito').toBe('error');
    expect(init.referrerPolicy).toBe('no-referrer');
    expect(init.signal, 'sin señal no hay deadline').toBeDefined();
  });

  it('✅ el status pega al prefijo owner + el código, y a nada más', async () => {
    stubFijo(() => respuesta(JSON.stringify({ status: 'pending' })));
    await leerEstadoEliminacion(SENTINELA);

    expect(llamadas).toHaveLength(1);
    expect(llamadas[0]!.url.endsWith(`${PREFIJO_STATUS}${SENTINELA}`)).toBe(true);
  });

  /**
   * 🔴 MUTANTE · HOST/PATH CONTROLABLE. Si el código pudiera mover el destino,
   * un enlace de Meta manipulado apuntaría este cliente a cualquier host. El
   * código entra codificado y como ÚLTIMO segmento; el prefijo es literal.
   */
  it('🔴 ningún código puede mover host ni path · queda dentro del prefijo', async () => {
    stubFijo(() => respuesta(JSON.stringify({ status: 'pending' })));
    // Formas que un atacante intentaría; todas son inválidas y ni salen a la red.
    for (const malicioso of [
      '../../../../evil',
      'https://evil.example/x',
      '..%2f..%2fevil',
      'abcDEF012345_-ghIJ/../evil',
    ]) {
      const r = await leerEstadoEliminacion(malicioso);
      expect(r, `un código inválido consultó algo: ${malicioso}`)
        .toEqual({ estado: 'no-encontrada' });
    }
    expect(llamadas, 'un código inválido NO puede producir request').toHaveLength(0);
  });

  it('🔴 código inválido ⇒ cero fetch, también en el borde de longitud', async () => {
    stubFijo(() => respuesta(JSON.stringify({ status: 'completed' })));
    expect(await leerEstadoEliminacion('a'.repeat(19))).toEqual({ estado: 'no-encontrada' });
    expect(await leerEstadoEliminacion('a'.repeat(201))).toEqual({ estado: 'no-encontrada' });
    expect(await leerEstadoEliminacion('a'.repeat(21))).toEqual({ estado: 'no-encontrada' });
    expect(llamadas).toHaveLength(0);
  });

  /**
   * 🔴 MUTANTE · REINTENTO AUTOMÁTICO. Un retry escondido convierte «un intento»
   * en dos y, sobre un endpoint de eliminación, multiplica ruido en el owner.
   * Se cuenta la población de llamadas en el peor caso: falla dura.
   */
  it('🔴 ante una falla NO reintenta · exactamente una llamada', async () => {
    stubFetch(() => Promise.reject(new Error('red caída')));
    expect(await leerAvisoPrivacidad()).toEqual({ estado: 'no-verificable' });
    expect(llamadas, 'reintentó solo').toHaveLength(1);

    llamadas = [];
    expect(await leerEstadoEliminacion(SENTINELA)).toEqual({ estado: 'no-verificable' });
    expect(llamadas, 'reintentó solo').toHaveLength(1);
  });
});

describe('fail-closed · deadline, MIME, tamaño, JSON y shape', () => {
  it('🔴 DEADLINE · un servidor que no contesta termina en no verificable', async () => {
    stubFetch((_url, init) => new Promise((_ok, fallar) => {
      init.signal?.addEventListener('abort', () => fallar(new Error('abortado')));
    }));
    expect(await leerAvisoPrivacidad({ deadlineMs: 5 })).toEqual({ estado: 'no-verificable' });
    expect(await leerEstadoEliminacion(SENTINELA, { deadlineMs: 5 }))
      .toEqual({ estado: 'no-verificable' });
  });

  it('🔴 el deadline de producción existe y es finito · nadie lo dejó en 0 ni en Infinity', () => {
    expect(Number.isFinite(DEADLINE_MS)).toBe(true);
    expect(DEADLINE_MS).toBeGreaterThan(0);
  });

  /**
   * 🔴 LOS NEAR-MISS SON EL PUNTO. `text/html` lo rechaza cualquier
   * implementación; lo que distingue una comparación exacta de un
   * `startsWith` son `application/jsonp` y `application/json-evil`, que
   * **empiezan igual** y no son JSON. La primera versión de este cliente usaba
   * el prefijo y los aceptaba.
   */
  it.each([
    ['application/jsonp', 'NEAR-MISS · comparte el prefijo y no es JSON'],
    ['application/json-evil', 'NEAR-MISS · idem, con sufijo'],
    ['application/jsonrequest', 'NEAR-MISS · un media type real distinto'],
    ['text/html', 'un HTML de portal cautivo o de proxy'],
    ['text/plain', 'texto suelto'],
    ['application/xml', 'otro formato estructurado'],
    ['', 'cabecera vacía'],
    [null, 'sin content-type'],
  ])('🔴 MIME `%s` ⇒ no verificable · %s', async (tipo, _porque) => {
    stubFijo(() => respuesta(JSON.stringify(AVISO), { tipo }));
    expect(await leerAvisoPrivacidad()).toEqual({ estado: 'no-verificable' });
  });

  it.each([
    'application/json',
    'application/json; charset=utf-8',
    'application/json;charset=UTF-8',
    'APPLICATION/JSON',
    '  application/json  ; charset=utf-8',
  ])('✅ `%s` SÍ entra · el cierre no rechaza lo legítimo', async (tipo) => {
    stubFijo(() => respuesta(JSON.stringify(AVISO), { tipo }));
    expect(await leerAvisoPrivacidad()).toEqual({ estado: 'ok', aviso: AVISO.legal_text });
  });

  it('🔴 TAMAÑO · un cuerpo que se pasa del límite se corta y no se parsea', async () => {
    const gigante = JSON.stringify({ legal_text: { relleno: 'x'.repeat(LIMITE_BYTES + 1_000) } });
    expect(gigante.length, 'la muestra no supera el límite: mediría en vacío')
      .toBeGreaterThan(LIMITE_BYTES);
    stubFijo(() => respuesta(gigante));
    expect(await leerAvisoPrivacidad()).toEqual({ estado: 'no-verificable' });
  });

  it('✅ y uno normal NO se corta · el límite no es un rechazo de todo', async () => {
    stubFijo(() => respuesta(JSON.stringify(AVISO)));
    expect((await leerAvisoPrivacidad()).estado).toBe('ok');
  });

  /**
   * El camino sin `body` legible existe en runtimes donde `Response.body` es
   * `null`. Se ejercita con un doble mínimo para que no quede como rama muerta.
   */
  it('🔴 sin stream legible se acota igual sobre el texto', async () => {
    const falso = (texto: string): Response => ({
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      body: null,
      text: () => Promise.resolve(texto),
    } as unknown as Response);

    stubFijo(() => falso(JSON.stringify(AVISO)));
    expect((await leerAvisoPrivacidad()).estado).toBe('ok');

    stubFijo(() => falso('x'.repeat(LIMITE_BYTES + 10)));
    expect(await leerAvisoPrivacidad()).toEqual({ estado: 'no-verificable' });
  });

  it('🔴 JSON roto ⇒ no verificable', async () => {
    stubFijo(() => respuesta('{"legal_text":'));
    expect(await leerAvisoPrivacidad()).toEqual({ estado: 'no-verificable' });
  });

  it.each([
    [{}, 'objeto vacío'],
    [{ legal_text: {} }, 'sin campos'],
    [{ legal_text: { ...AVISO.legal_text, kind: 'aviso_campanas' } }, 'otro kind'],
    [{ legal_text: { ...AVISO.legal_text, hash: 'corto' } }, 'hash no sha256'],
    [{ legal_text: { ...AVISO.legal_text, body: '   ' } }, 'cuerpo en blanco'],
    [{ legal_text: AVISO.legal_text, extra: 1 }, 'una clave de más'],
  ])('🔴 SHAPE del aviso · %#: %s ⇒ no verificable', async (cuerpo, _porque) => {
    stubFijo(() => respuesta(JSON.stringify(cuerpo)));
    expect(await leerAvisoPrivacidad()).toEqual({ estado: 'no-verificable' });
  });
});

describe('estado de eliminación · una unión cerrada, nunca «éxito» por un 200', () => {
  it('✅ los dos estados del contrato', async () => {
    stubFijo(() => respuesta(JSON.stringify({ status: 'pending' })));
    expect(await leerEstadoEliminacion(SENTINELA)).toEqual({ estado: 'pendiente' });

    stubFijo(() => respuesta(JSON.stringify({ status: 'completed' })));
    expect(await leerEstadoEliminacion(SENTINELA)).toEqual({ estado: 'completada' });
  });

  it('🔴 404 es NO ENCONTRADA, y se distingue de no verificable', async () => {
    stubFijo(() => respuesta(JSON.stringify({ error: 'not_found' }), { status: 404 }));
    expect(await leerEstadoEliminacion(SENTINELA)).toEqual({ estado: 'no-encontrada' });
  });

  it.each([500, 502, 503, 429, 401, 403, 418])(
    '🔴 HTTP %i ⇒ no verificable · nunca «completada»',
    async (status) => {
      stubFijo(() => respuesta(JSON.stringify({ status: 'completed' }), { status }));
      expect(await leerEstadoEliminacion(SENTINELA)).toEqual({ estado: 'no-verificable' });
    },
  );

  /**
   * 🔴 MUTANTE · 200 CON SHAPE INVÁLIDO TRATADO COMO ÉXITO. Es el peor error
   * posible de esta pantalla: decirle a alguien que sus datos se borraron
   * cuando el backend no lo dijo.
   */
  it.each([
    [{}, 'sin `status`'],
    [{ status: 'deleted' }, 'un valor fuera de la unión'],
    [{ status: 'completed', extra: true }, 'una clave de más'],
    [{ status: true }, '`status` booleano'],
    [{ status: ['completed'] }, '`status` array'],
    [['completed'], 'un array en vez de objeto'],
    [null, '`null`'],
    ['completed', 'un string suelto'],
  ])('🔴 200 con %# (%s) ⇒ no verificable', async (cuerpo, _porque) => {
    stubFijo(() => respuesta(JSON.stringify(cuerpo)));
    expect(await leerEstadoEliminacion(SENTINELA)).toEqual({ estado: 'no-verificable' });
  });
});

describe('🔴 el código no sale del pathname · ni en valores ni en errores', () => {
  /** Todo camino que pueda producir un veredicto, con el sentinela puesto. */
  const escenarios: ReadonlyArray<readonly [string, () => void]> = [
    ['200 pendiente', () => stubFijo(() => respuesta(JSON.stringify({ status: 'pending' })))],
    ['404', () => stubFijo(() => respuesta('{}', { status: 404 }))],
    ['500', () => stubFijo(() => respuesta('{}', { status: 500 }))],
    ['MIME inválido', () => stubFijo(() => respuesta('{}', { tipo: 'text/html' }))],
    ['JSON roto', () => stubFijo(() => respuesta('{'))],
    ['shape inválido', () => stubFijo(() => respuesta(JSON.stringify({ status: 'x' })))],
    ['red caída', () => stubFetch(() => Promise.reject(new Error(`falló ${SENTINELA}`)))],
  ];

  it.each(escenarios)('%s · el veredicto no contiene el código', async (_nombre, montar) => {
    montar();
    const r = await leerEstadoEliminacion(SENTINELA);
    expect(JSON.stringify(r), 'el código viajó dentro del veredicto')
      .not.toContain('SENTINELA');
  });

  it('🔴 y NINGÚN camino lanza: un throw pondría el código en un stack', async () => {
    for (const [nombre, montar] of escenarios) {
      montar();
      await expect(
        leerEstadoEliminacion(SENTINELA),
        `${nombre} lanzó en vez de devolver un veredicto`,
      ).resolves.toBeDefined();
    }
  });

  /**
   * 🔴 CONTROL POSITIVO DEL SENTINELA. Si el string no fuera detectable, todos
   * los `not.toContain` de arriba pasarían con cualquier implementación.
   */
  it('🔴 el sentinela ES detectable · el instrumento no miente', async () => {
    stubFijo(() => respuesta(JSON.stringify({ status: 'pending' })));
    await leerEstadoEliminacion(SENTINELA);
    expect(llamadas[0]!.url, 'el sentinela no llegó ni a la URL: no se probó nada')
      .toContain('SENTINELA');
  });
});

describe('🔴 el módulo no arrastra sesión · por lo que importa', () => {
  const FUENTE = readFileSync(new URL('./publicLegal.ts', import.meta.url), 'utf8');

  it('no importa `http`, `storage` ni el adapter mock', () => {
    const imports = [...FUENTE.matchAll(/^import[\s\S]*?from '([^']+)';$/gm)].map((m) => m[1]!);
    expect(imports.length, 'no se parsearon imports: mediría en vacío').toBeGreaterThan(0);
    expect(
      imports,
      'un import de sesión acá reabre localStorage en una ruta pública',
    ).toEqual(['./contractResponses', '../public/publicRoute', './types']);
  });

  it('la base sale de `VITE_API_URL` y no hay otro host escrito', () => {
    expect(FUENTE).toContain('import.meta.env.VITE_API_URL');
    const hosts = FUENTE.match(/https?:\/\/[^'"`\s)]+/g) ?? [];
    // El único literal admitido es el fallback de desarrollo, el mismo que usa
    // `http.ts`. Cualquier otro host escrito a mano acá es un hallazgo.
    expect(hosts).toEqual(['http://localhost:3000']);
  });
});
