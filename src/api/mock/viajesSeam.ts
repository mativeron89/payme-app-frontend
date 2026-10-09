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
