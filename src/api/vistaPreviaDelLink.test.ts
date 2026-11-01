import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpError } from './http';

/**
 * AF-5 · D622 (mejora 5) · D629 · D676 · la vista previa del link de la mesa, del lado del front.
 *
 * Lo que se fija acá: la capacidad (`features.link_preview`), el decodificador estricto de las dos claves, que sin la
 * capacidad no se pide nada, que todo lo que no es un 200 bien formado (403, 400, 503, 429, red, más de 1,5 s, una
 * forma rara) da «sin vista previa», y que la respuesta vive en la memoria de la pestaña, una vez por token. Contra el
 * contrato del dueño espejado byte a byte (`contract-mirror/contract/invitacion-preview-v1.json`).
 */
const CONTRATO = JSON.parse(readFileSync(new URL('../../contract-mirror/contract/invitacion-preview-v1.json', import.meta.url), 'utf8')) as {
  ruta: string;
  respuesta_200: { claves: string[]; ejemplo: unknown; ejemplo_sin_nombre: unknown };
  capacidad: { ruta: string; path: string; valor: unknown };
};

const T_DEL_LINK = 'v2.tok-de-prueba-largo';
const conf = (link_preview: unknown) => ({ features: { link_preview } });

function almacen() {
  const valores = new Map<string, string>();
  return {
    valores,
    getItem: (k: string) => valores.get(k) ?? null,
    setItem: (k: string, v: string) => { valores.set(k, v); },
    removeItem: (k: string) => { valores.delete(k); },
  };
}

let local = almacen();
let sesion = almacen();

async function modulo() {
  return import('./vistaPreviaDelLink');
}

beforeEach(() => {
  vi.resetModules();
  local = almacen();
  sesion = almacen();
  vi.stubGlobal('localStorage', local);
  vi.stubGlobal('sessionStorage', sesion);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('el contrato del dueño, espejado', () => {
  it('la ruta, las dos claves y la capacidad son las que el front usa', async () => {
    const m = await modulo();
    expect(CONTRATO.ruta).toBe(`POST /api${m.RUTA_VISTA_PREVIA}`);
    expect(CONTRATO.respuesta_200.claves).toEqual(['inviter_first_name', 'restaurant_name']);
    expect(CONTRATO.capacidad).toEqual({ ruta: 'GET /api/config', path: 'features.link_preview', valor: { supported: true } });
  });

  it('los dos ejemplos del contrato se leen: con nombre y con el nombre en null (D676)', async () => {
    const m = await modulo();
    expect(m.decodeVistaPreviaDelLink(CONTRATO.respuesta_200.ejemplo)).toEqual({ invitador: 'Ana', restaurante: 'Tacos El Güero' });
    expect(m.decodeVistaPreviaDelLink(CONTRATO.respuesta_200.ejemplo_sin_nombre)).toEqual({ invitador: null, restaurante: 'Tacos El Güero' });
  });
});

describe('el decodificador es estricto: exactamente dos claves y sus tipos', () => {
  it('lo bueno', async () => {
    const m = await modulo();
    expect(m.decodeVistaPreviaDelLink({ inviter_first_name: 'Juan Pablo', restaurant_name: 'Hanzo Sushi' }))
      .toEqual({ invitador: 'Juan Pablo', restaurante: 'Hanzo Sushi' });
  });

  it('🔴 cualquier otra cosa se ignora (sin vista previa), nunca lanza', async () => {
    const m = await modulo();
    const raros: unknown[] = [
      undefined, null, 'Ana', 1, true, [], ['Ana', 'Tacos'],
      {},
      { inviter_first_name: 'Ana' },
      { restaurant_name: 'Tacos El Güero' },
      // una clave de más: un apellido, un total, una foto, un id
      { inviter_first_name: 'Ana', restaurant_name: 'Tacos', inviter_last_name: 'López' },
      { inviter_first_name: 'Ana', restaurant_name: 'Tacos', total_cents: 84000 },
      { inviter_first_name: 'Ana', restaurant_name: 'Tacos', foto: 'x' },
      // tipos que no son los del contrato
      { inviter_first_name: 1, restaurant_name: 'Tacos' },
      { inviter_first_name: 'Ana', restaurant_name: null },
      { inviter_first_name: 'Ana', restaurant_name: 3 },
      { inviter_first_name: undefined, restaurant_name: 'Tacos' },
      { inviter_first_name: { nombre: 'Ana' }, restaurant_name: 'Tacos' },
      // vacíos: el dueño no los manda (D676 usa null, no '')
      { inviter_first_name: '', restaurant_name: 'Tacos' },
      { inviter_first_name: '   ', restaurant_name: 'Tacos' },
      { inviter_first_name: 'Ana', restaurant_name: '' },
      { inviter_first_name: null, restaurant_name: '  ' },
      // el cuerpo del 403
      { error: 'invitation_link_not_valid' },
    ];
    for (const raro of raros) expect(m.decodeVistaPreviaDelLink(raro), JSON.stringify(raro) ?? String(raro)).toBeNull();
  });

  it('un objeto que no es plano (con prototipo propio o un getter heredado) tampoco', async () => {
    const m = await modulo();
    class Respuesta { inviter_first_name = 'Ana'; restaurant_name = 'Tacos'; }
    expect(m.decodeVistaPreviaDelLink(new Respuesta())).toBeNull();
    const heredado = Object.create({ inviter_first_name: 'Ana' }) as Record<string, unknown>;
    heredado.restaurant_name = 'Tacos';
    expect(m.decodeVistaPreviaDelLink(heredado)).toBeNull();
  });
});

describe('la capacidad `features.link_preview`', () => {
  it('encendida sólo con {supported: true}, la clave exacta', async () => {
    const m = await modulo();
    expect(m.decodeCapacidadVistaPrevia(conf({ supported: true }))).toBe(true);
    for (const raro of [undefined, null, true, {}, { supported: false }, { supported: 'true' }, { enabled: true },
      { supported: true, enabled: true }, { supported: true, extra: 1 }, [true]]) {
      expect(m.decodeCapacidadVistaPrevia(conf(raro)), JSON.stringify(raro)).toBe(false);
    }
    expect(m.decodeCapacidadVistaPrevia({})).toBe(false);
    expect(m.decodeCapacidadVistaPrevia(null)).toBe(false);
    expect(m.decodeCapacidadVistaPrevia({ features: [] })).toBe(false);
  });

  it('nace pendiente; la config la enciende o la apaga', async () => {
    const m = await modulo();
    expect(m.capacidadVistaPrevia()).toBe('pendiente');
    expect(m.aplicarConfigVistaPreviaDelLink(conf({ supported: true }))).toBe(true);
    expect(m.capacidadVistaPrevia()).toBe('encendida');
    expect(m.aplicarConfigVistaPreviaDelLink({ features: {} })).toBe(false);
    expect(m.capacidadVistaPrevia()).toBe('apagada');
  });
});

describe('pedir la vista previa', () => {
  const BUENA = { inviter_first_name: 'Ana', restaurant_name: 'Tacos El Güero' };

  it('🔴 sin la capacidad no se llama: ni pendiente ni apagada', async () => {
    const m = await modulo();
    const pedir = vi.fn(async () => BUENA);
    expect(await m.vistaPreviaDelLink(T_DEL_LINK, pedir)).toBeNull();
    m.aplicarConfigVistaPreviaDelLink({ features: {} });
    expect(await m.vistaPreviaDelLink(T_DEL_LINK, pedir)).toBeNull();
    expect(pedir).not.toHaveBeenCalled();
  });

  it('con la capacidad, pide con el token y lee las dos claves', async () => {
    const m = await modulo();
    m.aplicarConfigVistaPreviaDelLink(conf({ supported: true }));
    const pedir = vi.fn(async () => BUENA);
    expect(await m.vistaPreviaDelLink(T_DEL_LINK, pedir)).toEqual({ invitador: 'Ana', restaurante: 'Tacos El Güero' });
    expect(pedir).toHaveBeenCalledTimes(1);
    expect(pedir).toHaveBeenCalledWith(T_DEL_LINK);
  });

  it('D676 · el nombre en null llega como invitador null, con el restaurante', async () => {
    const m = await modulo();
    m.aplicarConfigVistaPreviaDelLink(conf({ supported: true }));
    expect(await m.vistaPreviaDelLink(T_DEL_LINK, async () => ({ inviter_first_name: null, restaurant_name: 'Tacos El Güero' })))
      .toEqual({ invitador: null, restaurante: 'Tacos El Güero' });
  });

  /**
   * 🔴 Los cuatro motivos del dueño (inválido, vencido, cancelado, supersedido) llegan como el MISMO 403; con el 400,
   * el 503, el 429, la red caída y una forma rara, todos dan lo mismo: sin vista previa, que es la pantalla de hoy.
   */
  it('🔴 todo lo que no es un 200 bien formado da «sin vista previa», y nunca rechaza', async () => {
    const m = await modulo();
    m.aplicarConfigVistaPreviaDelLink(conf({ supported: true }));
    const fallos: Array<[string, () => Promise<unknown>]> = [
      ['403 inválido', async () => { throw new HttpError(403, { error: 'invitation_link_not_valid' }); }],
      ['403 vencido', async () => { throw new HttpError(403, { error: 'invitation_link_not_valid' }); }],
      ['403 cancelado', async () => { throw new HttpError(403, { error: 'invitation_link_not_valid' }); }],
      ['403 supersedido', async () => { throw new HttpError(403, { error: 'invitation_link_not_valid' }); }],
      ['400', async () => { throw new HttpError(400, { error: 'invitation_token_required' }); }],
      ['503', async () => { throw new HttpError(503, { error: 'invitation_link_unavailable' }); }],
      ['429', async () => { throw new HttpError(429, { error: 'too_many_link_preview_requests' }); }],
      ['401 (un dueño anterior)', async () => { throw new HttpError(401, { error: 'auth_required' }); }],
      ['red', async () => { throw new TypeError('Failed to fetch'); }],
      ['abortada', async () => { throw new DOMException('aborted', 'AbortError'); }],
      ['forma rara', async () => ({ ...BUENA, inviter_last_name: 'López' })],
    ];
    for (const [nombre, pedir] of fallos) {
      vi.resetModules();
      const n = await modulo();
      n.aplicarConfigVistaPreviaDelLink(conf({ supported: true }));
      await expect(n.vistaPreviaDelLink(T_DEL_LINK, pedir), nombre).resolves.toBeNull();
    }
  });

  it('🔴 si tarda más de 1,5 s, queda sin vista previa aunque la respuesta llegue después', async () => {
    vi.useFakeTimers();
    const m = await modulo();
    m.aplicarConfigVistaPreviaDelLink(conf({ supported: true }));
    expect(m.PLAZO_VISTA_PREVIA_MS).toBe(1500);
    let soltar: (v: unknown) => void = () => undefined;
    const resultado = m.vistaPreviaDelLink(T_DEL_LINK, () => new Promise((r) => { soltar = r; }));
    await vi.advanceTimersByTimeAsync(1500);
    soltar(BUENA);
    expect(await resultado).toBeNull();
    // Y queda así para esa pestaña: no se vuelve a pedir ni cambia tarde.
    expect(m.vistaPreviaRecordada(T_DEL_LINK)).toBeNull();
  });

  it('justo antes del plazo, sí', async () => {
    vi.useFakeTimers();
    const m = await modulo();
    m.aplicarConfigVistaPreviaDelLink(conf({ supported: true }));
    const resultado = m.vistaPreviaDelLink(T_DEL_LINK, () => new Promise((r) => { setTimeout(() => r(BUENA), 1400); }));
    await vi.advanceTimersByTimeAsync(1400);
    expect(await resultado).toEqual({ invitador: 'Ana', restaurante: 'Tacos El Güero' });
  });

  it('una vez por token en la pestaña: volver a montar la pantalla no vuelve a pedir, ni tras un fallo', async () => {
    const m = await modulo();
    m.aplicarConfigVistaPreviaDelLink(conf({ supported: true }));
    const pedir = vi.fn(async () => BUENA);
    await m.vistaPreviaDelLink(T_DEL_LINK, pedir);
    await m.vistaPreviaDelLink(T_DEL_LINK, pedir);
    expect(pedir).toHaveBeenCalledTimes(1);
    expect(m.vistaPreviaRecordada(T_DEL_LINK)).toEqual({ invitador: 'Ana', restaurante: 'Tacos El Güero' });
    const falla = vi.fn(async () => { throw new HttpError(503, { error: 'invitation_link_unavailable' }); });
    await m.vistaPreviaDelLink('v2.otro-token-largo', falla);
    await m.vistaPreviaDelLink('v2.otro-token-largo', falla);
    expect(falla).toHaveBeenCalledTimes(1);
  });

  it('lo recordado es de ESE token: otro token no hereda el nombre', async () => {
    const m = await modulo();
    m.aplicarConfigVistaPreviaDelLink(conf({ supported: true }));
    await m.vistaPreviaDelLink(T_DEL_LINK, async () => BUENA);
    expect(m.vistaPreviaRecordada('v2.otro-token-largo')).toBeNull();
  });

  it('🔴 la respuesta vive en memoria: no se escribe en localStorage ni en sessionStorage', async () => {
    const m = await modulo();
    m.aplicarConfigVistaPreviaDelLink(conf({ supported: true }));
    await m.vistaPreviaDelLink(T_DEL_LINK, async () => BUENA);
    expect([...local.valores.keys()]).toEqual([]);
    expect([...sesion.valores.keys()]).toEqual([]);
  });
});

describe('el seam del mock', () => {
  it('sin el seam no hay capacidad (el dueño de antes); con `encendido` o `sin_nombre`, la forma exacta', async () => {
    const m = await modulo();
    expect(m.capacidadVistaPreviaMock()).toBeUndefined();
    local.setItem(m.CLAVE_VISTA_PREVIA_MOCK, 'si');
    expect(m.capacidadVistaPreviaMock()).toBeUndefined();
    local.setItem(m.CLAVE_VISTA_PREVIA_MOCK, 'encendido');
    expect(m.capacidadVistaPreviaMock()).toEqual({ supported: true });
    expect(m.vistaPreviaMockSinNombre()).toBe(false);
    local.setItem(m.CLAVE_VISTA_PREVIA_MOCK, 'sin_nombre');
    expect(m.capacidadVistaPreviaMock()).toEqual({ supported: true });
    expect(m.vistaPreviaMockSinNombre()).toBe(true);
  });
});
