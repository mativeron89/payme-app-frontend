import { MemoriaDeCuenta } from './memoriaDeCuenta';
import { alOlvidarLoDeViajes, ultimoVisto, type TurnoDeUltimoVisto } from './ultimoVisto';
import type { EstadoViaje, ViajeEnLista } from './viajes';

/**
 * D276-1 · Mati: «siempre que estes dentro de las fechas del viaje y seleccionas la cámara para escanear ticket, por
 * default se tiene que ir a los gastos del viaje».
 *
 * Los viajes abiertos con sus fechas (de `GET /api/viajes?estado=abiertos`), en una memoria de la cuenta (C-07): la
 * cámara de Nueva decide ANTES del toque (iOS abre la cámara sólo dentro del gesto), así que el dato tiene que estar a
 * mano. Se llena cada vez que se pide esa lista (la fachada la anota) y se precarga apenas hay sesión
 * (`useViajesDeHoy`). Sin dato todavía, la cámara de siempre: el residual declarado de la primera carga.
 *
 * Sólo se guarda lo que decide: id, nombre, estado y fechas. Nunca montos.
 */
export interface ViajeConFechas {
  readonly id: string;
  readonly nombre: string;
  readonly estado: EstadoViaje;
  readonly fecha_desde: string | null;
  readonly fecha_hasta: string | null;
}

const memoria = new MemoriaDeCuenta<readonly ViajeConFechas[]>();
const oyentes = new Set<() => void>();
const avisar = () => { for (const o of [...oyentes]) o(); };

/**
 * La fachada lo llama con lo que llegó de la lista de abiertos y el turno sacado AL PEDIR (T-01): si cambió la cuenta o
 * la generación, no se guarda.
 */
export function recordarViajesAbiertos(turno: TurnoDeUltimoVisto, viajes: readonly ViajeEnLista[]): void {
  if (!ultimoVisto.esDeAhora(turno)) return;
  memoria.guardar(viajes.map((v) => ({
    id: v.id, nombre: v.nombre, estado: v.estado, fecha_desde: v.fecha_desde, fecha_hasta: v.fecha_hasta,
  })));
  avisar();
}

/** Lo recordado de la cuenta de ahora, o `null` si todavía no se sabe. */
export function viajesAbiertosRecordados(): readonly ViajeConFechas[] | null {
  return memoria.leer();
}

export function olvidarViajesAbiertosRecordados(): void {
  memoria.olvidar();
  avisar();
}

// Crear, aceptar, editar, salir o cerrar un viaje cambia lo que cubre hoy: se olvida con lo demás de Viajes.
alOlvidarLoDeViajes(olvidarViajesAbiertosRecordados);

export function suscribirViajesAbiertos(oyente: () => void): () => void {
  oyentes.add(oyente);
  return () => { oyentes.delete(oyente); };
}

/** La fecha local de hoy, `YYYY-MM-DD` (la del teléfono, como las fechas del viaje). */
export function hoyLocal(ahora: Date = new Date()): string {
  const dos = (n: number) => String(n).padStart(2, '0');
  return `${ahora.getFullYear()}-${dos(ahora.getMonth() + 1)}-${dos(ahora.getDate())}`;
}

/**
 * Los viajes ABIERTOS cuyas fechas cubren `hoy`, inclusive en los dos bordes. Un viaje sin las dos fechas no cuenta
 * (D276-1). Esperando pagos o cerrado, tampoco. En el orden de la lista.
 */
export function viajesDeHoy(viajes: readonly ViajeConFechas[], hoy: string): readonly ViajeConFechas[] {
  return viajes.filter((v) => v.estado === 'abierto' && v.fecha_desde !== null && v.fecha_hasta !== null
    && v.fecha_desde <= hoy && hoy <= v.fecha_hasta);
}
