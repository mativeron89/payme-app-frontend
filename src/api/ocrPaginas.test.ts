import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  aplicarConfigOcrPaginas,
  capacidadOcrPaginas,
  capacidadOcrPaginasMock,
  CLAVE_OCR_PAGINAS_MOCK,
  CLAVES_CAPACIDAD_OCR_PAGINAS,
  CONTRATO_OCR_PAGINAS,
  decodeCapacidadOcrPaginas,
  PARAMETRO_OCR_PAGINAS,
  rechazoLocalDePartes,
  reiniciarOcrPaginasParaTests,
  techoPorParte,
  VALOR_OCR_PAGINAS,
} from './ocrPaginas';
import {
  aplicarConfigFotoDelTicket,
  decodeFotoDelEscaneo,
  decodeFotoDelTicket,
  negociacionDeFoto,
  partesDeLaFoto,
  reiniciarFotoDelTicketParaTests,
  valorDeLaNegociacion,
  versionDeLaNegociacion,
} from './fotoDelTicket';
import { ocrResponse } from './contractResponses';

/**
 * D484 · D486 · varias fotos de un ticket largo, contra los contratos espejados
 * del dueño 2.196.0 (`contract-mirror/contract/ocr-pages-v1.json` y la sección
 * `paginas` de `ticket-image-v1.json`).
 */
const CONTRATO = JSON.parse(readFileSync(
  new URL('../../contract-mirror/contract/ocr-pages-v1.json', import.meta.url), 'utf8',
)) as {
  id: string;
  capacidad: { path: string; claves: string[]; valor: Record<string, unknown> };
  respuesta: { clave: string; avisos: string[] };
};
const FOTO = JSON.parse(readFileSync(
  new URL('../../contract-mirror/contract/ticket-image-v1.json', import.meta.url), 'utf8',
)) as { capacidad: { valor_apagado: Record<string, unknown> }; paginas: { lectura: string } };

const config = (ocrPages: unknown, ticketImage?: unknown) => ({
  features: { ocr_pages: ocrPages, ...(ticketImage === undefined ? {} : { ticket_image: ticketImage }) },
});
const FOTO_ENCENDIDA = {
  ...FOTO.capacidad.valor_apagado,
  enabled: true, mode: 'full_retained', stores_thumb: true, stores_full: true, full_retention_days: 90,
};

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
  clear() { this.values.clear(); }
}

afterEach(() => {
  reiniciarOcrPaginasParaTests();
  reiniciarFotoDelTicketParaTests();
});

describe('D484 · la capacidad `features.ocr_pages`', () => {
  it('el espejo es el del dueño: id, ruta, claves y negociación', () => {
    expect(CONTRATO.id).toBe(CONTRATO_OCR_PAGINAS);
    expect(CONTRATO.capacidad.path).toBe('features.ocr_pages');
    expect([...CONTRATO.capacidad.claves].sort()).toEqual([...CLAVES_CAPACIDAD_OCR_PAGINAS].sort());
    expect(CONTRATO.capacidad.valor.negotiation_param).toBe(PARAMETRO_OCR_PAGINAS);
    expect(CONTRATO.capacidad.valor.negotiation_value).toBe(VALOR_OCR_PAGINAS);
  });

  it('el valor publicado por el dueño la enciende, con sus topes leídos de ahí (O1)', () => {
    const capacidad = decodeCapacidadOcrPaginas(config(CONTRATO.capacidad.valor));
    expect(capacidad).toEqual({
      maxPartes: CONTRATO.capacidad.valor.max_pages,
      maxBytesTotales: CONTRATO.capacidad.valor.max_total_bytes,
    });
  });

  it('cualquier otra forma la apaga: ausente, claves de más o de menos, apagada, otra negociación, topes raros', () => {
    const v = CONTRATO.capacidad.valor;
    const sin = (clave: string) => Object.fromEntries(Object.entries(v).filter(([k]) => k !== clave));
    for (const raro of [
      undefined, null, [], 'sí', true,
      { ...v, extra: 1 }, sin('max_total_bytes'),
      { ...v, enabled: false }, { ...v, supported: false }, { ...v, enabled: 'true' },
      { ...v, negotiation_value: 1 }, { ...v, negotiation_value: '2' }, { ...v, negotiation_param: 'page_version' },
      { ...v, max_pages: 1 }, { ...v, max_pages: 5 }, { ...v, max_pages: 3.5 }, { ...v, max_pages: '4' },
      { ...v, max_total_bytes: 0 }, { ...v, max_total_bytes: -1 }, { ...v, max_total_bytes: 1.5 },
    ]) {
      expect(decodeCapacidadOcrPaginas(config(raro)), JSON.stringify(raro)).toBeNull();
    }
    expect(decodeCapacidadOcrPaginas(null)).toBeNull();
    expect(decodeCapacidadOcrPaginas({ features: null })).toBeNull();
  });

  it('el estado sigue a la config: sin config, apagada; con ella, encendida; si se va, apagada', () => {
    expect(capacidadOcrPaginas()).toBeNull();
    expect(aplicarConfigOcrPaginas(config(CONTRATO.capacidad.valor))).toBe(true);
    expect(capacidadOcrPaginas()?.maxPartes).toBe(4);
    expect(aplicarConfigOcrPaginas({ features: {} })).toBe(false);
    expect(capacidadOcrPaginas()).toBeNull();
  });

  it('el mock publica el valor exacto del dueño sólo con el seam', () => {
    const storage = new MemoryStorage();
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
    expect(capacidadOcrPaginasMock()).toBeUndefined();
    storage.setItem(CLAVE_OCR_PAGINAS_MOCK, 'apagado');
    expect(capacidadOcrPaginasMock()).toBeUndefined();
    storage.setItem(CLAVE_OCR_PAGINAS_MOCK, 'encendido');
    expect(capacidadOcrPaginasMock()).toEqual(CONTRATO.capacidad.valor);
  });
});

describe('D484 · los topes antes de subir', () => {
  const capacidad = { maxPartes: 4, maxBytesTotales: 1000 };
  it('más fotos que `max_pages`, o la suma por encima de `max_total_bytes`, no se suben', () => {
    expect(rechazoLocalDePartes([100, 100], capacidad)).toBeNull();
    expect(rechazoLocalDePartes([250, 250, 250, 250], capacidad)).toBeNull();
    expect(rechazoLocalDePartes([250, 250, 250, 251], capacidad)).toBe('partes_pesadas');
    expect(rechazoLocalDePartes([1, 1, 1, 1, 1], capacidad)).toBe('muchas_partes');
  });

  it('el techo de cada parte deja entrar todas en el tope del dueño, y nunca pasa el de una foto suelta', () => {
    expect(techoPorParte(capacidad, 8 * 1024 * 1024)).toBe(250);
    const dueno = { maxPartes: 4, maxBytesTotales: 25165824 };
    const techo = techoPorParte(dueno, 8 * 1024 * 1024);
    expect(techo * dueno.maxPartes).toBeLessThanOrEqual(dueno.maxBytesTotales);
    expect(techoPorParte({ maxPartes: 2, maxBytesTotales: 64 * 1024 * 1024 }, 8 * 1024 * 1024)).toBe(8 * 1024 * 1024);
  });
});

describe('D484 · la foto del ticket con `ticket_image_version=2`', () => {
  it('se negocia la v2 sólo con la foto Y las varias fotos encendidas; ocr_pages sola no enciende la foto (O3)', () => {
    expect(negociacionDeFoto()).toBe(false);
    aplicarConfigOcrPaginas(config(CONTRATO.capacidad.valor));
    expect(negociacionDeFoto()).toBe(false);
    aplicarConfigFotoDelTicket(config(CONTRATO.capacidad.valor, FOTO_ENCENDIDA));
    expect(negociacionDeFoto()).toBe(2);
    expect(valorDeLaNegociacion(2)).toBe('2');
    aplicarConfigOcrPaginas({ features: {} });
    expect(negociacionDeFoto()).toBe(true);
    expect(valorDeLaNegociacion(true)).toBe('1');
    expect(versionDeLaNegociacion(false)).toBeNull();
    expect(versionDeLaNegociacion(true)).toBe(1);
    expect(versionDeLaNegociacion(2)).toBe(2);
  });

  it('los listados v2: claves exactas `{ thumb, full, pages }`, 0 si y sólo si no hay foto, hasta 4', () => {
    expect(decodeFotoDelTicket({ thumb: true, full: true, pages: 3 }, 2)).toEqual({ thumb: true, full: true, pages: 3 });
    expect(decodeFotoDelTicket({ thumb: false, full: false, pages: 0 }, 2)).toEqual({ thumb: false, full: false, pages: 0 });
    for (const raro of [
      { thumb: true, full: true }, { thumb: true, full: true, pages: 3, extra: 1 }, { thumb: true, full: true, pages: 0 },
      { thumb: false, full: false, pages: 1 }, { thumb: true, full: true, pages: 5 }, { thumb: true, full: true, pages: 1.5 },
      { thumb: true, full: true, pages: '2' },
    ]) {
      expect(decodeFotoDelTicket(raro, 2), JSON.stringify(raro)).toBeNull();
    }
    // La v1 queda como estaba: `pages` es una clave de más.
    expect(decodeFotoDelTicket({ thumb: true, full: true })).toEqual({ thumb: true, full: true });
    expect(decodeFotoDelTicket({ thumb: true, full: true, pages: 3 })).toBeNull();
  });

  it('cuántas partes tiene un ticket: `pages` si vino con 2 o más; si no, una', () => {
    expect(partesDeLaFoto({ thumb: true, full: true, pages: 3 })).toBe(3);
    expect(partesDeLaFoto({ thumb: true, full: true, pages: 1 })).toBe(1);
    expect(partesDeLaFoto({ thumb: true, full: true })).toBe(1);
    expect(partesDeLaFoto(null)).toBe(1);
  });

  it('la captura v2 suma `pages` en la guardada; la v1 sigue cerrada', () => {
    expect(decodeFotoDelEscaneo({ stored: true, thumb: true, full: true, pages: 2 }, 2))
      .toEqual({ stored: true, thumb: true, full: true, pages: 2 });
    expect(decodeFotoDelEscaneo({ stored: true, thumb: true, full: true }, 2)).toBeNull();
    expect(decodeFotoDelEscaneo({ stored: true, thumb: true, full: true, pages: 0 }, 2)).toBeNull();
    expect(decodeFotoDelEscaneo({ stored: false, reason: 'busy' }, 2)).toEqual({ stored: false, reason: 'busy' });
    expect(decodeFotoDelEscaneo({ stored: true, thumb: true, full: true, pages: 2 })).toBeNull();
    expect(decodeFotoDelEscaneo({ stored: true, thumb: true, full: false })).toEqual({ stored: true, thumb: true, full: false });
  });

  it('el contrato del dueño acepta `?page=` de 0 a 3, la misma cota que el front', () => {
    expect(FOTO.paginas.lectura).toContain('`0`..`3`');
  });
});

describe('D484 · la respuesta del OCR con `pages_version=1`', () => {
  const base = {
    contract_version: 2,
    items: [{ name: 'Taco', category: 'mexican', price_cents: 1000, quantity: 1, original_name: 'Taco' }],
    total_cents: 1000,
    warnings: [] as string[],
    mock: false,
  };

  it('el espejo nombra la clave y los dos avisos', () => {
    expect(CONTRATO.respuesta.clave).toBe('pages');
    expect(CONTRATO.respuesta.avisos).toEqual(['pages_overlap_uncertain', 'pages_reordered']);
  });

  it('negociado: `pages` obligatorio, con `count` igual a las fotos mandadas, y los avisos admitidos', () => {
    const r = ocrResponse({
      ...base,
      warnings: ['pages_overlap_uncertain'],
      pages: { count: 3, overlap_removed: 2, reordered: false },
    }, { nombres: true, paginas: 3 });
    expect(r.pages).toEqual({ count: 3, overlap_removed: 2, reordered: false });
    expect(r.warnings).toEqual(['pages_overlap_uncertain']);
    expect(ocrResponse({ ...base, warnings: ['pages_reordered'], pages: { count: 2, overlap_removed: 0, reordered: true } },
      { nombres: true, paginas: 2 }).pages?.reordered).toBe(true);
  });

  it('negociado y con otra forma: se rechaza la lectura', () => {
    for (const pages of [
      undefined, null, { count: 2, overlap_removed: 0 }, { count: 2, overlap_removed: 0, reordered: false, extra: 1 },
      { count: 3, overlap_removed: 0, reordered: false }, { count: 2, overlap_removed: -1, reordered: false },
      { count: 2, overlap_removed: 0, reordered: 'no' },
    ]) {
      expect(() => ocrResponse({ ...base, ...(pages === undefined ? {} : { pages }) }, { nombres: true, paginas: 2 }),
        JSON.stringify(pages)).toThrow();
    }
    // El aviso de orden invertido con `reordered: false` no es coherente.
    expect(() => ocrResponse({ ...base, warnings: ['pages_reordered'], pages: { count: 2, overlap_removed: 0, reordered: false } },
      { nombres: true, paginas: 2 })).toThrow();
  });

  it('sin negociar, `pages` y sus avisos siguen rompiendo como cualquier clave de más (la lectura de siempre)', () => {
    expect(() => ocrResponse({ ...base, pages: { count: 2, overlap_removed: 0, reordered: false } }, { nombres: true }))
      .toThrow();
    expect(() => ocrResponse({ ...base, warnings: ['pages_overlap_uncertain'] }, { nombres: true })).toThrow();
    expect(ocrResponse(base, { nombres: true }).pages).toBeUndefined();
  });

  it('la foto guardada v2 de la captura entra sólo con la v2 negociada', () => {
    const conFoto = { ...base, pages: { count: 2, overlap_removed: 0, reordered: false }, ticket_image: { stored: true, thumb: true, full: true, pages: 2 } };
    expect(ocrResponse(conFoto, { nombres: true, paginas: 2, fotoDelTicket: 2 }).ticket_image)
      .toEqual({ stored: true, thumb: true, full: true, pages: 2 });
    expect(() => ocrResponse(conFoto, { nombres: true, paginas: 2, fotoDelTicket: true })).toThrow();
  });
});
