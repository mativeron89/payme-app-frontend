import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from 'vitest';
import { cajaDelConsumo, negociarRecorte, origenDelRecorteEnMesa, recorteVigente, renglonesDelRecorte, separarRecorte } from './recortePorConsumo';

import { agruparPropios } from '../screens/agruparIguales';
import { decodeMisMesas } from './misMesas';
import { decodeResumenDeViaje } from './viajes';

const caja = { page: 3, x: 0.7, y: 0.1, w: 0.3, h: 0.2 };
afterEach(() => vi.unstubAllEnvs());

it('conserva la URL histórica y omite la caja con la bandera apagada', () => {
  vi.stubEnv('VITE_TICKET_CROP_ENABLED', '');
  expect(negociarRecorte('/mesas/PA-1234?a=1')).toBe('/mesas/PA-1234?a=1');
  expect(cajaDelConsumo(caja)).toBeNull();
});

it('negocia la versión única y acepta las coordenadas del dueño', () => {
  vi.stubEnv('VITE_TICKET_CROP_ENABLED', '1');
  expect(negociarRecorte('/viajes/1/resumen')).toBe('/viajes/1/resumen?ticket_crop_version=1');
  expect(negociarRecorte('/mesas/PA-1234?a=1')).toBe('/mesas/PA-1234?a=1&ticket_crop_version=1');
  expect(cajaDelConsumo(caja)).toEqual(caja);
  for (const invalida of [null, {}, { ...caja, page: 4 }, { ...caja, page: 0.1 }, { ...caja, w: 0 },
    { ...caja, x: -0.1 }, { ...caja, h: NaN }, { ...caja, w: 0.3001 }, { ...caja, y: 0.10001 }]) {
    expect(cajaDelConsumo(invalida)).toBeNull();
  }
});

it('al cumplirse los 90 días retira el control y con fecha inválida falla cerrado', () => {
  const inicio = '2026-01-01T00:00:00Z';
  const limite = Date.parse(inicio) + 90 * 86400000;
  expect(recorteVigente(inicio, limite - 1)).toBe(true);
  expect(recorteVigente(inicio, limite)).toBe(false);
  expect(recorteVigente('sin fecha', limite)).toBe(false);
});

it('detalle de mesas negocia sólo la extensión y conserva el total y las cajas de líneas repetidas', () => {
  vi.stubEnv('VITE_TICKET_CROP_ENABLED', '1');
  const linea = { item_id: 'uno', quantity: 1, name: 'Agua', fraction_bps: 10000, amount_cents: 100 };
  const otraCaja = { ...caja, page: 0 };
  const items = [{ ...linea, ticket_crop: caja }, { ...linea, item_id: 'dos', ticket_crop: otraCaja },
    { ...linea, item_id: 'tres' }];
  const pagina = (total: number) => ({ mesas: [{ id: 'mesa', code: 'PA-12345', restaurant: { name: 'Café' },
    status: 'expired', division_mode: 'consumo', mine: { items_count: 3, amount_cents: total, items } }],
    page: { next_cursor: null } });
  const propios = decodeMisMesas(pagina(300)).mesas[0]?.items;
  expect(propios?.map(i => i.ticket_crop)).toEqual([caja, otraCaja, undefined]);
  const grupos = agruparPropios(propios!);
  expect(grupos).toHaveLength(1);
  expect(grupos[0]).toMatchObject({ cantidad: 3, montoCents: 300, renglones: propios });
  expect(decodeMisMesas(pagina(301)).mesas[0]?.items).toBeNull();
  expect(separarRecorte({ ...linea, otra: true, ticket_crop: null }).fila).toEqual({ ...linea, otra: true });
});

it('negocia, decodifica y vence los recortes según el contrato espejado', () => {
  const ruta = new URL('../../contract-mirror/contract/ticket-image-v1.json', import.meta.url);
  const { recortes } = JSON.parse(readFileSync(ruta, 'utf8'));
  vi.stubEnv('VITE_TICKET_CROP_ENABLED', '1');
  expect(negociarRecorte('/visita')).toBe('/visita?' + recortes.negociacion.split(' ')[0]);

  const forma = recortes.forma.ticket_crop;
  const paginas = /^(\d+)\.\.(\d+),/.exec(forma.page);
  const precision = /pasos de (0\.\d+)/.exec(recortes.coordenadas);
  expect(paginas).toBeTruthy();
  expect(precision).toBeTruthy();
  const primera = Number(paginas![1]);
  const ultima = Number(paginas![2]);
  const paso = Number(precision![1]);
  const valida = { page: primera, x: paso, y: 0, w: paso, h: 1 };
  expect(Object.keys(valida).sort()).toEqual(Object.keys(forma).sort());
  expect(cajaDelConsumo(valida)).toEqual(valida);
  expect(cajaDelConsumo({ ...valida, page: ultima })).toEqual({ ...valida, page: ultima });
  for (const fuera of [{ page: primera - 1 }, { page: ultima + 1 }, { x: paso / 2 }]) {
    expect(cajaDelConsumo({ ...valida, ...fuera })).toBeNull();
  }
  const dias = /de más de (\d+) días/.exec(recortes.nulo);
  expect(dias).toBeTruthy();
  const inicio = '2026-01-01T00:00:00Z';
  const limite = Date.parse(inicio) + Number(dias![1]) * 86_400_000;
  expect(recorteVigente(inicio, limite - 1)).toBe(true);
  expect(recorteVigente(inicio, limite)).toBe(false);
});

it('el resumen de Viajes conserva la caja del renglón fraccionado', () => {
  vi.stubEnv('VITE_TICKET_CROP_ENABLED', '1');
  const item = { name: 'Agua', fraction_bps: 5000, amount_cents: 50, ticket_crop: caja };
  const lugar = { ticket_id: 'ticket', lugar: 'Café', tipo_lugar: 'restaurante', fecha_ticket: null,
    forma: 'consumo', pagaste_tu: true, mi_monto_cents: 50, asignado_al_cierre_cents: 50, items: [item] };
  const resumen = { viaje_id: 'viaje', nombre: 'Viaje', personas: 1, fecha_desde: null, fecha_hasta: null,
    consumiste_cents: 50, pagaste_en_tickets_cents: 50, te_transfirieron_cents: 0, transferiste_cents: 0,
    por_tipo_de_lugar: [], lugares: [lugar] };
  expect(decodeResumenDeViaje({ contract: 'payme.app.viajes/v1', resumen }, 'viaje').lugares[0]?.items).toEqual([item]);
});

it('ordena por página y posición, mantiene el hueco y muestra una vez el renglón desglosado', () => {
  vi.stubEnv('VITE_TICKET_CROP_ENABLED', '1');
  const arriba = { ...caja, page: 0, y: 0 };
  const abajo = { ...arriba, y: 0.6 };
  expect(renglonesDelRecorte([caja, null, abajo, arriba, { ...arriba }])).toEqual([arriba, null, abajo, caja]);
});

it('una caja válida está disponible sólo con un origen de mesa de la cuenta', () => {
  vi.stubEnv('VITE_TICKET_CROP_ENABLED', '1');
  expect(cajaDelConsumo(caja)).toEqual(caja);
  expect(origenDelRecorteEnMesa('PA-12345', false, false)).toEqual({ tipo: 'mesa', code: 'PA-12345' });
  expect(origenDelRecorteEnMesa('PA-12345', true, false)).toBeNull();
  expect(origenDelRecorteEnMesa('PA-1224', false, true)).toBeNull();
});
