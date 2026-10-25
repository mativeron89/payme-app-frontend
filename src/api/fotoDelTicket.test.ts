import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  aplicarConfigFotoDelTicket,
  capacidadFotoDelTicket,
  capacidadFotoDelTicketMock,
  CLAVE_FOTO_DEL_TICKET_MOCK,
  CLAVES_CAPACIDAD_FOTO_DEL_TICKET,
  CONTRATO_FOTO_DEL_TICKET,
  decodeCapacidadFotoDelTicket,
  decodeFotoDelEscaneo,
  decodeFotoDelTicket,
  fotoDelTicketHabilitada,
  MOTIVOS_SIN_FOTO,
  PARAMETRO_FOTO_DEL_TICKET,
  reiniciarFotoDelTicketParaTests,
  tieneFoto,
  VALOR_FOTO_DEL_TICKET,
} from './fotoDelTicket';

/**
 * D464 · D466 · la puerta de la foto del ticket en el front, contra el contrato
 * espejado del dueño (`contract-mirror/contract/ticket-image-v1.json`).
 */
const CONTRATO = JSON.parse(readFileSync(
  new URL('../../contract-mirror/contract/ticket-image-v1.json', import.meta.url), 'utf8',
)) as {
  id: string;
  capacidad: { path: string; claves: string[]; valor_apagado: Record<string, unknown>; modos: Record<string, string> };
  captura: { respuesta_extra: { no_guardada: { reason: string[] } } };
  listados: { valor: Record<string, string> };
};

const ENCENDIDA = {
  ...CONTRATO.capacidad.valor_apagado,
  enabled: true, mode: 'full_retained', stores_thumb: true, stores_full: true, full_retention_days: 90,
};
const config = (ticketImage: unknown) => ({ features: { ticket_image: ticketImage } });

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

afterEach(() => {
  reiniciarFotoDelTicketParaTests();
});

describe('D464 · el contrato espejado y la forma que lee el front', () => {
  it('el id, la ruta de la capacidad, sus claves y la negociación son los del dueño', () => {
    expect(CONTRATO.id).toBe(CONTRATO_FOTO_DEL_TICKET);
    expect(CONTRATO.capacidad.path).toBe('features.ticket_image');
    expect([...CLAVES_CAPACIDAD_FOTO_DEL_TICKET].sort()).toEqual([...CONTRATO.capacidad.claves].sort());
    expect(CONTRATO.capacidad.valor_apagado.negotiation_param).toBe(PARAMETRO_FOTO_DEL_TICKET);
    expect(CONTRATO.capacidad.valor_apagado.negotiation_value).toBe(VALOR_FOTO_DEL_TICKET);
    expect(Object.keys(CONTRATO.capacidad.modos).sort()).toEqual(['full', 'full_retained', 'off', 'thumb']);
    expect(Object.keys(CONTRATO.listados.valor).sort()).toEqual(['full', 'thumb']);
    expect([...MOTIVOS_SIN_FOTO].sort()).toEqual([...CONTRATO.captura.respuesta_extra.no_guardada.reason].sort());
  });
});

describe('D464 · la capacidad: apagada salvo la forma exacta encendida', () => {
  it('🔴 sin el bloque (el backend de hoy), apagada', () => {
    expect(decodeCapacidadFotoDelTicket({ features: {} })).toBeNull();
    expect(decodeCapacidadFotoDelTicket({})).toBeNull();
    expect(decodeCapacidadFotoDelTicket(null)).toBeNull();
  });

  it('🔴 con el valor apagado del dueño (su constante en false), apagada', () => {
    expect(decodeCapacidadFotoDelTicket(config(CONTRATO.capacidad.valor_apagado))).toBeNull();
  });

  it('encendida con 90 días + miniatura (D465)', () => {
    expect(decodeCapacidadFotoDelTicket(config(ENCENDIDA)))
      .toEqual({ modo: 'full_retained', guardaCompleta: true, diasDeLaCompleta: 90 });
    expect(decodeCapacidadFotoDelTicket(config({ ...ENCENDIDA, mode: 'thumb', stores_full: false, full_retention_days: null })))
      .toEqual({ modo: 'thumb', guardaCompleta: false, diasDeLaCompleta: null });
    expect(decodeCapacidadFotoDelTicket(config({ ...ENCENDIDA, mode: 'full', full_retention_days: null })))
      .toEqual({ modo: 'full', guardaCompleta: true, diasDeLaCompleta: null });
  });

  it('cualquier otra forma la apaga: una clave de más o de menos, otra negociación, un modo incoherente', () => {
    const sinUna: Record<string, unknown> = { ...ENCENDIDA };
    delete sinUna.full_max_side_px;
    for (const raro of [
      { ...ENCENDIDA, extra: true },
      sinUna,
      { ...ENCENDIDA, supported: false },
      { ...ENCENDIDA, enabled: 'true' },
      { ...ENCENDIDA, negotiation_value: '2' },
      { ...ENCENDIDA, negotiation_param: 'image_version' },
      { ...ENCENDIDA, mode: 'off' },
      { ...ENCENDIDA, mode: 'sólo_en_el_telefono' },
      { ...ENCENDIDA, stores_thumb: false },
      { ...ENCENDIDA, full_retention_days: null },
      { ...ENCENDIDA, full_retention_days: 0 },
      { ...ENCENDIDA, full_retention_days: 90.5 },
      { ...ENCENDIDA, mode: 'thumb', stores_full: true, full_retention_days: null },
      { ...ENCENDIDA, mode: 'full', full_retention_days: 90 },
      [ENCENDIDA],
    ]) {
      expect(decodeCapacidadFotoDelTicket(config(raro)), JSON.stringify(raro)).toBeNull();
    }
  });

  it('el estado de la app: pendiente y apagada no negocian; encendida sí, y se apaga de nuevo', () => {
    expect(fotoDelTicketHabilitada()).toBe(false);
    expect(aplicarConfigFotoDelTicket({ features: {} })).toBe(false);
    expect(fotoDelTicketHabilitada()).toBe(false);
    expect(aplicarConfigFotoDelTicket(config(ENCENDIDA))).toBe(true);
    expect(fotoDelTicketHabilitada()).toBe(true);
    expect(capacidadFotoDelTicket()).toEqual({ modo: 'full_retained', guardaCompleta: true, diasDeLaCompleta: 90 });
    expect(aplicarConfigFotoDelTicket(config(CONTRATO.capacidad.valor_apagado))).toBe(false);
    expect(fotoDelTicketHabilitada()).toBe(false);
    expect(capacidadFotoDelTicket()).toBeNull();
  });
});

describe('D466 · `ticket_image` de cada mesa o ticket', () => {
  it('`{ thumb, full }`, dos booleanos y nada más; si no, «sin foto»', () => {
    expect(decodeFotoDelTicket({ thumb: true, full: true })).toEqual({ thumb: true, full: true });
    expect(decodeFotoDelTicket({ thumb: true, full: false })).toEqual({ thumb: true, full: false });
    expect(decodeFotoDelTicket({ thumb: false, full: false })).toEqual({ thumb: false, full: false });
    for (const raro of [undefined, null, {}, { thumb: true }, { thumb: 1, full: 0 }, { thumb: true, full: true, url: 'x' }, [true, true]]) {
      expect(decodeFotoDelTicket(raro), JSON.stringify(raro)).toBeNull();
    }
  });

  it('se muestra con miniatura; sin miniatura no hay foto en la fila', () => {
    expect(tieneFoto({ thumb: true, full: false })).toBe(true);
    expect(tieneFoto({ thumb: false, full: false })).toBe(false);
    expect(tieneFoto({ thumb: false, full: true })).toBe(false);
    expect(tieneFoto(null)).toBe(false);
    expect(tieneFoto(undefined)).toBe(false);
  });

  it('la del escaneo: guardada o no guardada con su motivo, claves exactas por rama', () => {
    expect(decodeFotoDelEscaneo({ stored: true, thumb: true, full: true })).toEqual({ stored: true, thumb: true, full: true });
    expect(decodeFotoDelEscaneo({ stored: true, thumb: true, full: false })).toEqual({ stored: true, thumb: true, full: false });
    for (const reason of MOTIVOS_SIN_FOTO) {
      expect(decodeFotoDelEscaneo({ stored: false, reason })).toEqual({ stored: false, reason });
    }
    for (const raro of [
      { stored: true, thumb: false, full: false },
      { stored: true, thumb: true },
      { stored: false, reason: 'otro' },
      { stored: false, reason: 'busy', thumb: false },
      { stored: 'true' },
      null,
    ]) {
      expect(decodeFotoDelEscaneo(raro), JSON.stringify(raro)).toBeNull();
    }
  });
});

describe('D466 · el bloque de la config del mock, como el dueño', () => {
  it('sin seam no existe; `apagado` es el `valor_apagado` del contrato; `encendido`, 90 días', () => {
    const storage = new MemoryStorage();
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
    expect(capacidadFotoDelTicketMock()).toBeUndefined();
    storage.setItem(CLAVE_FOTO_DEL_TICKET_MOCK, 'apagado');
    expect(capacidadFotoDelTicketMock()).toEqual(CONTRATO.capacidad.valor_apagado);
    storage.setItem(CLAVE_FOTO_DEL_TICKET_MOCK, 'encendido');
    expect(decodeCapacidadFotoDelTicket(config(capacidadFotoDelTicketMock())))
      .toEqual({ modo: 'full_retained', guardaCompleta: true, diasDeLaCompleta: 90 });
    storage.setItem(CLAVE_FOTO_DEL_TICKET_MOCK, 'si');
    expect(capacidadFotoDelTicketMock()).toBeUndefined();
  });
});
