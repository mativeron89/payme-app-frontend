/**
 * AF-VIAJES · los seams del modo de ejemplo para Viajes, sin dependencias: los
 * leen el mock de siempre (`mockApi.ts`, para la config y el escaneo) y el de
 * Viajes (`viajes.ts`), sin un ciclo entre los dos.
 *
 * Como el dueño (App Backend 2.171.0, V1), Viajes nace APAGADO: con la clave
 * ausente o cualquier otro valor, `features.viajes.enabled` es `false`, las
 * rutas contestan el 404 de siempre y el escaneo ignora el viaje. Así las specs
 * que nombran «Asociadas» siguen viendo la app de hoy.
 */

/** `encendido` exacto: Viajes encendido. */
export const CLAVE_VIAJES_MOCK = 'payme.app.mock.viajes.v1';
/** El estado del «dueño» de Viajes en el mock (los viajes, sus tickets y transferencias). */
export const CLAVE_ESTADO_VIAJES_MOCK = 'payme.app.mock.viajes.estado.v1';
/** `YYYY-MM-DD` o `YYYY-MM-DDTHH:MM`: la fecha impresa que «lee» el escaneo de un viaje (el mock del dueño no trae). */
export const CLAVE_FECHA_TICKET_MOCK = 'payme.app.mock.viajes.fecha.v1';
/** Una huella fija para el recibo del escaneo de un viaje: dos escaneos «del mismo ticket» (1k). */
export const CLAVE_HUELLA_TICKET_MOCK = 'payme.app.mock.viajes.huella.v1';
/** `429` exacto: crear e invitar contestan `viajes_rate_limited`. */
export const CLAVE_LIMITE_VIAJES_MOCK = 'payme.app.mock.viajes.limite.v1';
/**
 * D244 · el gasto a mano, una sola vez (el seam se consume):
 * - `alguien_salio`: el último elegido que no soy yo «sale del viaje» justo
 *   antes, y el dueño contesta su 422 `viaje_ticket_persona_unknown`;
 * - `respuesta_perdida`: el dueño lo guarda y la respuesta no llega (500).
 */
export const CLAVE_GASTO_MOCK = 'payme.app.mock.viajes.gasto.v1';

function leer(clave: string): string | null {
  try { return localStorage.getItem(clave); } catch { return null; }
}

export function viajesMockEncendido(): boolean {
  return leer(CLAVE_VIAJES_MOCK) === 'encendido';
}

const FECHA = /^(\d{4}-\d{2}-\d{2})(?:T([01]\d|2[0-3]):([0-5]\d))?$/;

/** La fecha impresa del seam, con la forma del dueño, o `undefined` sin seam o con otro valor. */
export function fechaDelTicketMock(): { date: string; time: string | null } | undefined {
  const m = FECHA.exec(leer(CLAVE_FECHA_TICKET_MOCK) ?? '');
  if (!m) return undefined;
  return { date: m[1]!, time: m[2] ? `${m[2]}:${m[3]}` : null };
}

export function huellaDelTicketMock(): string | null {
  const h = leer(CLAVE_HUELLA_TICKET_MOCK);
  return h && /^[A-Za-z0-9_-]{1,64}$/.test(h) ? h : null;
}

export function limiteDeViajesMock(): boolean {
  return leer(CLAVE_LIMITE_VIAJES_MOCK) === '429';
}

/** Lee y consume el seam del gasto a mano: `true` una sola vez si vale `valor`. */
export function seamDeGastoMock(valor: 'alguien_salio' | 'respuesta_perdida'): boolean {
  if (leer(CLAVE_GASTO_MOCK) !== valor) return false;
  try { localStorage.removeItem(CLAVE_GASTO_MOCK); } catch { /* sin almacenamiento: igual una vez por pedido */ }
  return true;
}

/**
 * D256 · eliminar un ticket o un gasto, una sola vez (el seam se consume):
 * - `ya_no_estaba`: otro lo eliminó justo antes; se elimina y el dueño contesta 404 `viaje_ticket_not_found`;
 * - `cerrado`: el viaje ya no está abierto; 409 `viaje_not_open`;
 * - `prohibido`: el dueño contesta 403 `viaje_ticket_delete_forbidden`;
 * - `sin_viaje`: ya no es miembro; el 404 del viaje (n325).
 */
export const CLAVE_ELIMINAR_MOCK = 'payme.app.mock.viajes.eliminar.v1';
/** D256 · `encendido` exacto: al sembrar los avisos de los viajes se suma uno de `viaje_ticket_removed`. */
export const CLAVE_AVISO_ELIMINADO_MOCK = 'payme.app.mock.viajes.aviso_eliminado.v1';

/** Lee y consume el seam de eliminar: `true` una sola vez si vale `valor`. */
export function seamDeEliminarMock(valor: 'ya_no_estaba' | 'cerrado' | 'prohibido' | 'sin_viaje'): boolean {
  if (leer(CLAVE_ELIMINAR_MOCK) !== valor) return false;
  try { localStorage.removeItem(CLAVE_ELIMINAR_MOCK); } catch { /* sin almacenamiento: igual una vez por pedido */ }
  return true;
}

/**
 * D276-4 · elegir en un ticket, una sola vez (el seam se consume): `me_desmarcaron` — quien cargó me desmarcó de
 * «¿Quiénes estuvieron?» justo antes (todavía no había elegido nada: a quien eligió no se lo desmarca), y el dueño
 * contesta 409 `viaje_ticket_not_present`.
 */
export const CLAVE_SELECCION_MOCK = 'payme.app.mock.viajes.seleccion.v1';

/** Lee y consume el seam de elegir: `true` una sola vez si vale `valor`. */
export function seamDeSeleccionMock(valor: 'me_desmarcaron'): boolean {
  if (leer(CLAVE_SELECCION_MOCK) !== valor) return false;
  try { localStorage.removeItem(CLAVE_SELECCION_MOCK); } catch { /* sin almacenamiento: igual una vez por pedido */ }
  return true;
}

export function avisoEliminadoMock(): boolean {
  return leer(CLAVE_AVISO_ELIMINADO_MOCK) === 'encendido';
}

/**
 * D278-3 · corregir un ticket o un gasto, una sola vez (el seam se consume):
 * - `ya_no_estaba`: otro lo eliminó justo antes; se elimina y el dueño contesta 404 `viaje_ticket_not_found`;
 * - `cerrado`: el viaje ya no está abierto; 409 `viaje_not_open`;
 * - `prohibido`: el dueño contesta 403 `viaje_ticket_edit_forbidden`;
 * - `tope_del_viaje`: el viaje pasaría su tope; 409 `viaje_total_limit`;
 * - `cambio_el_total`: el total del dueño no es el de la pantalla; 422 `viaje_ticket_payers_total_mismatch`.
 */
export const CLAVE_CORREGIR_MOCK = 'payme.app.mock.viajes.corregir.v1';

/** Lee y consume el seam de corregir: `true` una sola vez si vale `valor`. */
export function seamDeCorregirMock(valor: 'ya_no_estaba' | 'cerrado' | 'prohibido' | 'tope_del_viaje' | 'cambio_el_total'): boolean {
  if (leer(CLAVE_CORREGIR_MOCK) !== valor) return false;
  try { localStorage.removeItem(CLAVE_CORREGIR_MOCK); } catch { /* sin almacenamiento: igual una vez por pedido */ }
  return true;
}

/**
 * D290 · una escritura del pizarrón de notas, una sola vez (el seam se consume):
 * - `respuesta_perdida`: crear se guarda y la respuesta no llega (500); el reintento con la misma clave la devuelve;
 * - `otra_pestana`: otra pestaña editó esa nota justo antes; el dueño contesta 409 `viaje_nota_version_conflict` con mi
 *   apartado;
 * - `ya_no_estaba`: otra pestaña la borró justo antes; 404 `viaje_nota_not_found`;
 * - `se_cerro`: quien lo creó cerró el viaje justo antes; 409 `viaje_not_open`;
 * - `suspendida`: 403 `user_suspended`;
 * - `no_es_tuya`: 403 `viaje_nota_not_yours`;
 * - `invalido`: 400 `validation_error` con `texto_control`.
 */
export const CLAVE_NOTAS_MOCK = 'payme.app.mock.viajes.notas.v1';

export type SeamDeNotas = 'respuesta_perdida' | 'otra_pestana' | 'ya_no_estaba' | 'se_cerro' | 'suspendida' | 'no_es_tuya' | 'invalido';

/** Lee y consume el seam de las notas: `true` una sola vez si vale `valor`. */
export function seamDeNotasMock(valor: SeamDeNotas): boolean {
  if (leer(CLAVE_NOTAS_MOCK) !== valor) return false;
  try { localStorage.removeItem(CLAVE_NOTAS_MOCK); } catch { /* sin almacenamiento: igual una vez por pedido */ }
  return true;
}

/**
 * D293 · `GET /api/viajes/visitas` (mis restaurantes de viaje en Mesas). No se consume: vale mientras esté puesto.
 * - `error`: el dueño contesta 500.
 * - `muchas`: además de la semilla, 25 visitas sintéticas de Cancún 2026, una cada hora desde hace media hora: caen entre
 *   las 23 mesas de `payme.app.mock.mis_mesas.v1 = muchas` (una cada hora desde hace una), así las dos listas paginan
 *   mezcladas. Sólo para la paginación: sus tickets no existen en el viaje.
 */
export const CLAVE_VISITAS_MOCK = 'payme.app.mock.viajes.visitas.v1';

export function seamDeVisitasMock(): 'error' | 'muchas' | null {
  const v = leer(CLAVE_VISITAS_MOCK);
  return v === 'error' || v === 'muchas' ? v : null;
}
