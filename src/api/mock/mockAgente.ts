import type { AppNotification } from '../types';
import type { Ubicacion } from '../agente';
import { MockApiError, mockStats } from './mockApi';
import { permisoOtorgadoEnMock } from './mockSugerencias';
import { persist as persistirStore, state as store } from './store';

/**
 * D554 · el mock del agente gastronómico (E1), con las formas exactas del dueño 2.208.0
 * (`contract/agente-e1-v1.schema.json`). Datos INVENTADOS: ningún local, plato ni importe es real.
 *
 * Por defecto el mock es el dueño servido de hoy: las dos banderas apagadas. `estado` contesta `false/false` y todo lo
 * demás 404 `not_found`, sin leer nada. Las costuras (sólo para la e2e, la demo y las capturas del catálogo, D542):
 * - `payme.app.mock.agente.v1` = `encendido` (las dos banderas), `recomendaciones` o `calificaciones` (sólo esa), o
 *   `ausente`: un dueño anterior a 2.208.0, sin `/api/agente` (todo 404, también `estado`). Así una prueba puede pedir
 *   «ninguna capacidad anunciada», que con el dueño de hoy ya no es el caso: `estado` anuncia `recomendaciones` apagada;
 * - el permiso `recomendaciones` vive en el mock de los permisos (`mockSugerencias.ts`): nace en `never`, o otorgado con
 *   `payme.app.mock.consentimientos_otorgados.v1` = `recomendaciones`;
 * - `payme.app.mock.agente_cerca.v1` = `vacio` (no hay nada cerca), `lejos` (sólo a 3 km) o `demasiadas` (el 429
 *   `too_many_requests` del límite por cuenta de 2.208.1).
 *
 * Como el dueño: la ubicación no se guarda; el mock sólo mira que llegue con 3 decimales o menos.
 */

function costura(clave: string): string | null {
  try { return localStorage.getItem(`payme.app.mock.${clave}.v1`); } catch { return null; }
}

function recomendacionesEncendidas(): boolean {
  const c = costura('agente');
  return c === 'encendido' || c === 'recomendaciones';
}
function calificacionesEncendidas(): boolean {
  const c = costura('agente');
  return c === 'encendido' || c === 'calificaciones';
}
/** Para el mock de los permisos: con la bandera del dueño apagada, `recomendaciones` no se otorga. */
export { recomendacionesEncendidas };

const noEncontrado = () => new MockApiError(404, 'not_found');

function conPermiso(): void {
  if (!recomendacionesEncendidas()) throw noEncontrado();
  if (!permisoOtorgadoEnMock('recomendaciones')) throw new MockApiError(403, 'permission_required', { purpose: 'recomendaciones' });
}

export async function mockEstado(): Promise<unknown> {
  if (costura('agente') === 'ausente') throw noEncontrado();
  return { recomendaciones: { enabled: recomendacionesEncendidas() }, calificaciones: { enabled: calificacionesEncendidas() } };
}

// ─── Presupuesto ──────────────────────────────────────────────────────────────

/** El promedio inventado de los últimos 3 meses del mock. */
const PROMEDIO_CENTS = 420_000;
let editado: number | null = null;

/** Lo del mes, con la MISMA cuenta que `consumption_month` del mock (como el dueño): la burbuja y el presupuesto coinciden. */
async function presupuesto(): Promise<unknown> {
  const consumo = (await mockStats()).consumption_month as { total_cents?: unknown; basis?: unknown } | undefined;
  const gastado = typeof consumo?.total_cents === 'number' ? consumo.total_cents : 0;
  return {
    monto_cents: editado ?? PROMEDIO_CENTS,
    origen: editado !== null ? 'editado' : 'automatico',
    promedio_cents: PROMEDIO_CENTS,
    gastado_cents: gastado,
    basis: consumo?.basis === 'payments' ? 'payments' : 'consumption',
  };
}

export async function mockPresupuesto(): Promise<unknown> {
  if (!recomendacionesEncendidas()) throw noEncontrado();
  return presupuesto();
}

export async function mockPutPresupuesto(monto: number): Promise<unknown> {
  if (!recomendacionesEncendidas()) throw noEncontrado();
  if (!Number.isInteger(monto) || monto < 100 || monto > 100_000_000) throw new MockApiError(400, 'validation_error');
  editado = monto;
  return presupuesto();
}

export async function mockDeletePresupuesto(): Promise<unknown> {
  if (!recomendacionesEncendidas()) throw noEncontrado();
  editado = null;
  return presupuesto();
}

// ─── «Para vos» y «cerca» ─────────────────────────────────────────────────────

const PLATOS = [{ nombre: 'Tacos al pastor', visitas: 6 }, { nombre: 'Arrachera', visitas: 4 }] as const;

export async function mockParaVos(): Promise<unknown> {
  conPermiso();
  return { franja_habitual: 'cena', es_tu_hora: true, platos: PLATOS.map((p) => ({ ...p })), presupuesto: await presupuesto() };
}

/**
 * Los textos de la atribución del dueño (`contract/cocinas-v1.json`), sin sus enlaces y sin nombres de dominio: el
 * bundle no nombra hosts que nadie autorizó (`releaseGates.test.ts`). Con el dueño de verdad, cada texto llega con su
 * enlace.
 */
const ATRIBUCION = {
  textos: [
    'Cocinas: datos © colaboradores de OpenStreetMap (ODbL)',
    'Fuente: INEGI, DENUE 05/2026',
    'Overture Maps Foundation',
    'Incluye datos de Foursquare OS Places © 2025 Foursquare Labs, Inc. (Apache-2.0)',
  ],
  urls: [] as string[],
};

const tresDecimales = (n: number) => Math.round(n * 1000) / 1000 === n;

export async function mockCerca(u: Ubicacion): Promise<unknown> {
  conPermiso();
  if (!tresDecimales(u.lat) || !tresDecimales(u.lon)) throw new MockApiError(400, 'validation_error');
  const modo = costura('agente_cerca');
  if (modo === 'demasiadas') throw new MockApiError(429, 'too_many_requests');
  if (modo === 'vacio') {
    return { radio_m: 3000, platos: PLATOS.map((p) => ({ ...p, lugares: [] })), atribucion: ATRIBUCION };
  }
  const lejos = modo === 'lejos';
  const m = (d: number) => (lejos ? d + 1500 : d);
  return {
    radio_m: lejos ? 3000 : 1000,
    platos: [
      {
        ...PLATOS[0],
        lugares: [
          { ref: 'mock:1', nombre: 'Taquería La Esquina', cocina: 'mexican', distancia_m: m(250), nivel: 'confirmado',
            estrellas: { promedio: 4.6, cuentas: 7 } },
          { ref: 'mock:2', nombre: 'El Trompo de Oro', cocina: 'mexican', distancia_m: m(600), nivel: 'confirmado', estrellas: null },
          { ref: 'mock:3', nombre: 'Tacos Don Memo', cocina: 'mexican', distancia_m: m(850), nivel: 'probable', estrellas: null },
        ],
      },
      {
        ...PLATOS[1],
        lugares: [
          { ref: 'mock:4', nombre: 'Parrilla Norteña', cocina: 'argentinian', distancia_m: m(400), nivel: 'confirmado',
            estrellas: { promedio: 4.2, cuentas: 3 } },
          { ref: 'mock:5', nombre: 'Asadero del Centro', cocina: null, distancia_m: m(950), nivel: 'probable', estrellas: null },
        ],
      },
    ],
    atribucion: ATRIBUCION,
  };
}

// ─── Calificación ─────────────────────────────────────────────────────────────

const calificaciones = new Map<string, { estrellas: number; creada_en: string; actualizada_en: string }>();

export async function mockCalificacion(code: string): Promise<unknown> {
  if (!calificacionesEncendidas()) throw noEncontrado();
  if (!store.mesas.some((m) => m.code === code)) throw new MockApiError(404, 'mesa_not_found');
  return { calificacion: calificaciones.get(code) ?? null };
}

export async function mockPutCalificacion(code: string, estrellas: number): Promise<unknown> {
  if (!calificacionesEncendidas()) throw noEncontrado();
  if (!store.mesas.some((m) => m.code === code)) throw new MockApiError(404, 'mesa_not_found');
  if (!Number.isInteger(estrellas) || estrellas < 1 || estrellas > 5) throw new MockApiError(400, 'validation_error');
  const ahora = new Date().toISOString();
  const previa = calificaciones.get(code);
  const nueva = { estrellas, creada_en: previa?.creada_en ?? ahora, actualizada_en: ahora };
  calificaciones.set(code, nueva);
  return { calificacion: nueva };
}

// ─── El aviso «Es tu hora» ────────────────────────────────────────────────────

/**
 * Con la costura y el permiso, una vez por página: el aviso del dueño (`agente_tu_hora`, sin ubicación). Como el
 * dueño, el título es «Es tu hora» y el cuerpo, su frase fija.
 */
let avisoSembrado = false;
export function sembrarAvisoDelAgenteMock(): void {
  if (avisoSembrado || !recomendacionesEncendidas() || !permisoOtorgadoEnMock('recomendaciones')) return;
  avisoSembrado = true;
  if (store.notifications.some((n) => n.type === 'agente_tu_hora')) return;
  const n: AppNotification = {
    id: `agente-tu-hora-${Date.now()}`,
    type: 'agente_tu_hora',
    title: 'Es tu hora',
    // El cuerpo del dueño, con su voseo; la campana dibuja el texto propio del front (`AvisosScreen`).
    body: 'Es tu hora: lugares cerca para lo de siempre.',
    payload: { franja: 'cena' },
    related_entity_type: null,
    related_entity_id: null,
    read_at: null,
    created_at: new Date().toISOString(),
  };
  store.notifications.unshift(n);
  persistirStore();
}

/** Sólo para tests. */
export function reiniciarMockAgente(): void {
  editado = null;
  calificaciones.clear();
  avisoSembrado = false;
}
