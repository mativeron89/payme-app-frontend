import { afterEach, expect, it, vi } from 'vitest';
import { cajaDelConsumo, negociarRecorte, recorteVigente, separarRecorte } from './recortePorConsumo';

import { agruparPropios } from '../screens/agruparIguales';
import { decodeMisMesas } from './misMesas';

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
  expect(agruparPropios(propios!)).toHaveLength(3);
  expect(decodeMisMesas(pagina(301)).mesas[0]?.items).toBeNull();
  expect(separarRecorte({ ...linea, otra: true, ticket_crop: null }).fila).toEqual({ ...linea, otra: true });
});
