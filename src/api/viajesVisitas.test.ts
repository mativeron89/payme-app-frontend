import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeVisitasDeViajes } from './viajesVisitas';

/**
 * 🔴 D293 · `GET /api/viajes/visitas` (App Backend 2.184.0): claves exactas, como el resto de Viajes. Una página que no es
 * la del dueño no se muestra a medias: Mesas la trata como una fuente que falló, con su aviso.
 */

const visita = (n: number, extra: Record<string, unknown> = {}) => ({
  ticket_id: `d2000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  viaje: { id: 'd1000000-0000-4000-8000-000000000001', nombre: 'Cancún 2026', color: 'violeta', has_photo: false },
  lugar: `Lugar ${n}`,
  tipo_lugar: 'restaurante',
  instante: new Date(Date.UTC(2026, 9, 10) - n * 3_600_000).toISOString(),
  te_toca_cents: 1000 + n,
  ...extra,
});

const pagina = (visitas: unknown[], page: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  contract: 'payme.app.viajes/v1',
  visitas,
  page: { limit: 20, next_cursor: null, ...page },
  ...extra,
});

describe('🔴 D293 · la página de visitas: las claves del contrato', () => {
  it('cada visita con su viaje, tal como llega; el cursor del dueño, opaco', () => {
    const p = decodeVisitasDeViajes(pagina([visita(1), visita(2, { lugar: null, tipo_lugar: 'bar' })], { next_cursor: 'abc_DEF-1' }));
    expect(p.nextCursor).toBe('abc_DEF-1');
    expect(p.visitas).toEqual([
      {
        ticket_id: 'd2000000-0000-4000-8000-000000000001',
        viaje: { id: 'd1000000-0000-4000-8000-000000000001', nombre: 'Cancún 2026', color: 'violeta', has_photo: false },
        lugar: 'Lugar 1', tipo_lugar: 'restaurante', instante: visita(1).instante, te_toca_cents: 1001,
      },
      {
        ticket_id: 'd2000000-0000-4000-8000-000000000002',
        viaje: { id: 'd1000000-0000-4000-8000-000000000001', nombre: 'Cancún 2026', color: 'violeta', has_photo: false },
        lugar: null, tipo_lugar: 'bar', instante: visita(2).instante, te_toca_cents: 1002,
      },
    ]);
  });

  it('sin visitas y sin más: la página vacía; color null (el de la app) y con foto', () => {
    expect(decodeVisitasDeViajes(pagina([]))).toEqual({ visitas: [], nextCursor: null });
    const v = decodeVisitasDeViajes(pagina([visita(1, { viaje: { id: 'v', nombre: 'Holbox', color: null, has_photo: true } })])).visitas[0]!;
    expect(v.viaje).toEqual({ id: 'v', nombre: 'Holbox', color: null, has_photo: true });
  });

  it('los tipos de la ruta son restaurante, bar y café; súper u otro no son visitas', () => {
    for (const tipo of ['restaurante', 'bar', 'cafe']) {
      expect(decodeVisitasDeViajes(pagina([visita(1, { tipo_lugar: tipo })])).visitas[0]!.tipo_lugar).toBe(tipo);
    }
    for (const tipo of ['super', 'otro', 'Restaurante', '', null]) {
      expect(() => decodeVisitasDeViajes(pagina([visita(1, { tipo_lugar: tipo })])), String(tipo)).toThrow(/viajes_response_invalid/);
    }
  });

  it('falla cerrado: otro contrato, una clave de más o de menos en el sobre, en `page`, en la visita o en el viaje', () => {
    const malas: unknown[] = [
      null, [], 'x',
      pagina([], {}, { contract: 'payme.app.viajes/v2' }),
      pagina([], {}, { extra: 1 }),
      { contract: 'payme.app.viajes/v1', visitas: [] },
      pagina([], { otra: 1 }),
      { contract: 'payme.app.viajes/v1', visitas: [], page: { limit: 20 } },
      pagina([{ ...visita(1), extra: 1 }]),
      pagina([(({ te_toca_cents: _, ...r }) => r)(visita(1))]),
      pagina([visita(1, { viaje: { id: 'v', nombre: 'Holbox', color: null } })]),
      pagina([visita(1, { viaje: { id: 'v', nombre: 'Holbox', color: null, has_photo: false, estado: 'abierto' } })]),
    ];
    for (const m of malas) expect(() => decodeVisitasDeViajes(m), JSON.stringify(m)).toThrow(/viajes_response_invalid/);
  });

  it('cada valor, de su tipo: montos enteros no negativos, un instante legible, un color de la paleta', () => {
    const malas: Array<Record<string, unknown>> = [
      { ticket_id: '' }, { ticket_id: 7 }, { lugar: '' }, { lugar: 3 }, { instante: 'ayer' }, { instante: null },
      { te_toca_cents: -1 }, { te_toca_cents: 1.5 }, { te_toca_cents: '100' }, { te_toca_cents: null },
      { viaje: { id: '', nombre: 'x', color: null, has_photo: false } },
      { viaje: { id: 'v', nombre: '', color: null, has_photo: false } },
      { viaje: { id: 'v', nombre: 'x', color: 'dorado', has_photo: false } },
      { viaje: { id: 'v', nombre: 'x', color: null, has_photo: 'no' } },
    ];
    for (const extra of malas) {
      expect(() => decodeVisitasDeViajes(pagina([visita(1, extra)])), JSON.stringify(extra)).toThrow(/viajes_response_invalid/);
    }
  });

  it('`page`: limit de 1 a 50, el cursor una cadena o null, y nunca más visitas que el límite', () => {
    for (const page of [{ limit: 0 }, { limit: 51 }, { limit: 2.5 }, { limit: '20' }, { next_cursor: '' }, { next_cursor: 5 }]) {
      expect(() => decodeVisitasDeViajes(pagina([], page)), JSON.stringify(page)).toThrow(/viajes_response_invalid/);
    }
    expect(decodeVisitasDeViajes(pagina([visita(1)], { limit: 1 })).visitas).toHaveLength(1);
    expect(decodeVisitasDeViajes(pagina([visita(1)], { limit: 50 })).visitas).toHaveLength(1);
    expect(() => decodeVisitasDeViajes(pagina([visita(1), visita(2)], { limit: 1 }))).toThrow(/viajes_response_invalid/);
  });

  it('🔴 la mezcla de Mesas necesita el orden del contrato: un ticket repetido o fuera de orden rompe la página', () => {
    // Iguales: un empate de instante es válido (el dueño desempata por `ticket_id`).
    expect(decodeVisitasDeViajes(pagina([visita(1), visita(2, { instante: visita(1).instante })])).visitas).toHaveLength(2);
    expect(() => decodeVisitasDeViajes(pagina([visita(2), visita(1)]))).toThrow(/viajes_response_invalid/);
    expect(() => decodeVisitasDeViajes(pagina([visita(1), visita(1)]))).toThrow(/viajes_response_invalid/);
  });
});

describe('D293 · la fachada', () => {
  const fuente = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  /** El cuerpo de `getVisitasDeViajes` en la fachada que empieza con `inicio`: hasta su `},`, sin el método siguiente. */
  const metodoEn = (inicio: string) => {
    const desde = fuente.slice(fuente.indexOf(inicio));
    const m = desde.slice(desde.indexOf('  getVisitasDeViajes: async (params) => {'));
    return m.slice(0, m.indexOf('\n  },') + 5);
  };

  it('la real pide la ruta del dueño con el cursor escapado, sólo con la capacidad de Viajes', () => {
    const metodo = metodoEn('const realApi: Api = {');
    expect(metodo.split('\n')[1]!.trim()).toBe('assertViajesHabilitado();');
    expect(metodo).not.toContain('crearNotaDeViaje');
    expect(metodo).toContain("if (params?.cursor) qs.set('cursor', params.cursor);");
    // D481 · 8 · la foto de cada visita se negocia sólo con su capacidad, y el decodificador sabe si se pidió.
    // D484 · la v2 (con `pages`) sólo con las varias fotos encendidas: el valor lo elige `negociacionDeFoto`.
    expect(metodo).toContain('const foto = negociacionDeFoto();');
    expect(metodo).toContain('if (foto) qs.set(PARAMETRO_FOTO_DEL_TICKET, valorDeLaNegociacion(foto));');
    expect(metodo).toContain("return decodeVisitasDeViajes(await httpRequest<unknown>('GET', `/viajes/visitas${s ? `?${s}` : ''}`), foto);");
  });

  it('la del mock pasa por el mismo decodificador', () => {
    const metodo = metodoEn('const mockApi: Api = {');
    expect(metodo.split('\n')[1]!.trim()).toBe('assertViajesHabilitado();');
    expect(metodo).toContain('const raw = await mockViajes.mockVisitasDeViajes(');
    expect(metodo).toContain('return decodeVisitasDeViajes(foto ? await conFotoEnLasVisitasMock(raw, foto === 2) : raw, foto);');
  });
});
