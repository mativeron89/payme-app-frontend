import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AVISO_ES_TU_HORA, MAX_LUGARES_CERCA, PERMISO_RECOMENDACIONES, RUTA_CERCA, RUTA_ESTADO_AGENTE, RUTA_PARA_VOS,
  RUTA_PRESUPUESTO, decodeCalificacion, decodeCerca, decodeEstadoDelAgente, decodeParaVos, decodePresupuesto,
  montoDePresupuestoValido, redondearUbicacion, rutaDeCalificacion,
} from './agente';

/**
 * D554 · los decodificadores del agente, contra el contrato ESPEJADO del dueño (`contract-mirror/contract/
 * agente-e1-v1.schema.json`, App Backend 2.208.1, inventario `a33a2e7`), no contra una lectura a mano. Si el dueño
 * cambia una forma, el espejo cambia y esto se pone rojo antes de que la pantalla lea un dato que no entiende.
 */

interface Def {
  readonly type?: string | readonly string[];
  readonly required?: readonly string[];
  readonly properties?: Readonly<Record<string, Def>>;
  readonly additionalProperties?: boolean;
  readonly enum?: readonly unknown[];
  readonly minimum?: number;
  readonly maximum?: number;
  readonly multipleOf?: number;
  readonly maxItems?: number;
  readonly items?: Def;
  readonly oneOf?: readonly Def[];
  readonly $ref?: string;
}
const CONTRATO = JSON.parse(readFileSync(new URL('../../contract-mirror/contract/agente-e1-v1.schema.json', import.meta.url), 'utf8')) as {
  readonly $id: string;
  readonly endpoints: Readonly<Record<string, { readonly body?: Def }>>;
  readonly errors: Readonly<Record<string, unknown>>;
  readonly notification: { readonly type: string; readonly title: string };
  readonly $defs: Readonly<Record<string, Def>>;
};
const D = CONTRATO.$defs;

/** Una muestra válida de cada `$def`, armada a mano y comprobada contra el schema por `cumple` (abajo). */
const PRESUPUESTO = { monto_cents: 420000, origen: 'automatico', promedio_cents: 420000, gastado_cents: 186750, basis: 'consumption' };
const LUGAR = { ref: 'osm:n1', nombre: 'Taquería', cocina: 'mexican', distancia_m: 250, nivel: 'confirmado', estrellas: { promedio: 4.6, cuentas: 7 } };
const MUESTRAS: Readonly<Record<string, Record<string, unknown>>> = {
  estado: { recomendaciones: { enabled: true }, calificaciones: { enabled: false } },
  presupuesto: PRESUPUESTO,
  paraVos: { franja_habitual: 'cena', es_tu_hora: true, platos: [{ nombre: 'Tacos', visitas: 3 }], presupuesto: PRESUPUESTO },
  cerca: { radio_m: 1000, platos: [{ nombre: 'Tacos', visitas: 3, lugares: [LUGAR] }], atribucion: { textos: ['OSM'], urls: [] } },
  calificacionRespuesta: { calificacion: { estrellas: 4, creada_en: '2026-10-29T01:00:00.000Z', actualizada_en: '2026-10-29T01:00:00.000Z' } },
};
const DECODERS: Readonly<Record<string, (v: unknown) => unknown>> = {
  estado: decodeEstadoDelAgente,
  presupuesto: decodePresupuesto,
  paraVos: decodeParaVos,
  cerca: decodeCerca,
  calificacionRespuesta: decodeCalificacion,
};

/** Un validador mínimo de las palabras que usa ESTE schema: alcanza para comprobar que las muestras son del dueño. */
function cumple(valor: unknown, def: Def): boolean {
  if (def.$ref) return cumple(valor, D[def.$ref.replace('#/$defs/', '')]!);
  if (def.oneOf) return def.oneOf.filter((d) => cumple(valor, d)).length === 1;
  if (def.enum && !def.enum.includes(valor)) return false;
  const tipos = def.type === undefined ? null : ([] as string[]).concat(def.type as string | string[]);
  const tipoDe = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? 'array'
    : typeof v === 'number' ? (Number.isInteger(v) ? 'integer' : 'number') : typeof v);
  if (tipos && !tipos.some((t) => t === tipoDe(valor) || (t === 'number' && tipoDe(valor) === 'integer'))) return false;
  if (typeof valor === 'number') {
    if (def.minimum !== undefined && valor < def.minimum) return false;
    if (def.maximum !== undefined && valor > def.maximum) return false;
    if (def.multipleOf !== undefined && valor % def.multipleOf !== 0) return false;
  }
  if (Array.isArray(valor)) {
    if (def.maxItems !== undefined && valor.length > def.maxItems) return false;
    if (def.items && !valor.every((v) => cumple(v, def.items!))) return false;
  }
  if (valor && typeof valor === 'object' && !Array.isArray(valor) && def.properties) {
    const o = valor as Record<string, unknown>;
    if ((def.required ?? []).some((k) => !(k in o))) return false;
    if (def.additionalProperties === false && Object.keys(o).some((k) => !(k in def.properties!))) return false;
    if (Object.entries(def.properties).some(([k, d]) => k in o && !cumple(o[k], d))) return false;
  }
  return true;
}

describe('D554 · el espejo es el contrato del agente del dueño', () => {
  it('es `payme.app.agente-e1/v1`', () => {
    expect(CONTRATO.$id).toBe('payme.app.agente-e1/v1');
  });

  it('las rutas de la fachada son exactamente las del dueño (con el prefijo /api)', () => {
    const rutas = Object.keys(CONTRATO.endpoints).map((e) => e.replace(/^\w+ \/api/, '')).sort();
    expect([...new Set(rutas)]).toEqual([
      RUTA_CERCA, RUTA_ESTADO_AGENTE, rutaDeCalificacion('CODIGO').replace('CODIGO', '{code}'), RUTA_PARA_VOS, RUTA_PRESUPUESTO,
    ].sort());
    expect(Object.keys(CONTRATO.endpoints).sort()).toEqual([
      'DELETE /api/agente/presupuesto', 'GET /api/agente/estado', 'GET /api/agente/mesas/{code}/calificacion',
      'GET /api/agente/para-vos', 'GET /api/agente/presupuesto', 'POST /api/agente/cerca',
      'PUT /api/agente/mesas/{code}/calificacion', 'PUT /api/agente/presupuesto',
    ]);
  });

  it('el aviso de la campana y el permiso son los del dueño', () => {
    expect(CONTRATO.notification.type).toBe(AVISO_ES_TU_HORA);
    expect(CONTRATO.notification.title).toBe('Es tu hora');
    expect(JSON.stringify(CONTRATO.errors['403'])).toContain(`"purpose":"${PERMISO_RECOMENDACIONES}"`);
  });

  for (const [def, muestra] of Object.entries(MUESTRAS)) {
    describe(`$defs.${def}`, () => {
      it('la muestra cumple el schema espejado y el decodificador la acepta', () => {
        expect(cumple(muestra, D[def]!)).toBe(true);
        expect(() => DECODERS[def]!(muestra)).not.toThrow();
      });

      it('🔴 sin una clave requerida, o con una de más (additionalProperties: false), el decodificador rechaza', () => {
        expect(D[def]!.additionalProperties).toBe(false);
        for (const clave of D[def]!.required!) {
          const sin = { ...muestra };
          delete sin[clave];
          expect(cumple(sin, D[def]!), clave).toBe(false);
          expect(() => DECODERS[def]!(sin), clave).toThrow();
        }
        const conDeMas = { ...muestra, extra: 1 };
        expect(cumple(conDeMas, D[def]!)).toBe(false);
        expect(() => DECODERS[def]!(conDeMas)).toThrow();
      });
    });
  }

  it('los enums del dueño son los que acepta el front', () => {
    expect(D.franja!.enum).toEqual(['madrugada', 'desayuno', 'comida', 'cena']);
    for (const franja of D.franja!.enum!) {
      expect(() => decodeParaVos({ ...MUESTRAS.paraVos, franja_habitual: franja })).not.toThrow();
    }
    expect(D.lugar!.properties!.nivel!.enum).toEqual(['confirmado', 'probable']);
    expect(D.cerca!.properties!.radio_m!.enum).toEqual([1000, 3000]);
    expect(D.presupuesto!.properties!.basis!.enum).toEqual(['consumption', 'payments']);
    expect(D.presupuesto!.properties!.origen!.enum).toEqual(['editado', 'automatico', null]);
  });

  it('los límites numéricos del dueño son los del front', () => {
    const lugar = D.lugar!.properties!;
    expect(lugar.distancia_m).toMatchObject({ minimum: 50, multipleOf: 50 });
    expect(D.cerca!.properties!.platos!.maxItems).toBe(3);
    expect(D.cerca!.properties!.platos!.items!.properties!.lugares!.maxItems).toBe(5);
    expect(D.paraVos!.properties!.platos!.maxItems).toBe(3);
    expect(D.plato!.properties!.visitas!.minimum).toBe(3);
    expect(D.calificacion!.properties!.estrellas).toMatchObject({ minimum: 1, maximum: 5 });
    expect(MAX_LUGARES_CERCA).toBe(10);
    const monto = CONTRATO.endpoints['PUT /api/agente/presupuesto']!.body!.properties!.monto_cents!;
    expect(monto).toMatchObject({ minimum: 100, maximum: 100000000 });
    expect(montoDePresupuestoValido(monto.minimum!)).toBe(true);
    expect(montoDePresupuestoValido(monto.maximum!)).toBe(true);
    expect(montoDePresupuestoValido(monto.minimum! - 1)).toBe(false);
    expect(montoDePresupuestoValido(monto.maximum! + 1)).toBe(false);
  });

  it('🔴 la ubicación que manda el front cumple el cuerpo del dueño, y el lugar no trae dirección ni coordenadas', () => {
    const u = redondearUbicacion(19.4326081, -99.1332081)!;
    expect(cumple(u, D.ubicacion!)).toBe(true);
    expect(Object.keys(D.lugar!.properties!).sort()).toEqual(['cocina', 'distancia_m', 'estrellas', 'nivel', 'nombre', 'ref']);
  });
});
