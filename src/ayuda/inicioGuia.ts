import { useEffect, useSyncExternalStore } from 'react';
import { useCapacidadViajes, type EstadoCapacidadViajes } from '../api/viajes';
import {
  hoyLocal,
  suscribirViajesAbiertos,
  viajesAbiertosRecordados,
  viajesDeHoy,
  type ViajeConFechas,
} from '../api/viajesDeHoy';
import { precargarViajesAbiertos } from '../screens/viajes/useViajesDeHoy';

/**
 * D364 · D365 · cuándo se ofrece la guía. Ya no arranca sola (D364 deja sin
 * efecto D328): sólo la tarjeta Tutorial de Inicio y Más → Ayuda la abren.
 *
 * En todo lo de acá, `null` es «todavía no se sabe», y entonces la respuesta
 * es la del lado seguro: la tarjeta no se muestra (y no aparece para irse
 * después) y la fila de Ayuda espera.
 */

/**
 * D365 · ¿hoy cae dentro de las fechas de un viaje abierto? Con Viajes apagado,
 * no; mientras la capacidad o la lista no llegan, `null`.
 */
export function enFechasDeViaje(
  capacidad: EstadoCapacidadViajes,
  abiertos: readonly ViajeConFechas[] | null,
  hoy: string,
): boolean | null {
  if (capacidad === 'pendiente') return null;
  if (capacidad === 'apagada') return false;
  if (abiertos === null) return null;
  return viajesDeHoy(abiertos, hoy).length > 0;
}

/**
 * Lo mismo que lee la cámara de Escanear (D276), pero con su «todavía no se
 * sabe»: `useViajesDeHoy` devuelve `[]` mientras la lista no llega, y eso acá
 * sería un «no» inventado.
 */
export function useEnFechasDeViaje(): boolean | null {
  const capacidad = useCapacidadViajes();
  const abiertos = useSyncExternalStore(suscribirViajesAbiertos, viajesAbiertosRecordados, () => null);
  useEffect(() => {
    if (capacidad === 'encendida' && abiertos === null) precargarViajesAbiertos();
  }, [capacidad, abiertos]);
  return enFechasDeViaje(capacidad, abiertos, hoyLocal());
}

export interface EntradaDeLaTarjeta {
  /** D328 · quien marcó «No volver a mostrar» no ve la tarjeta (D364, Q8). */
  readonly noVolverAMostrar: boolean | null;
  /** Q1 · la ✕ roja o el final de la guía la ocultaron. */
  readonly tarjetaOculta: boolean | null;
  /** D365 · dentro de las fechas de un viaje, no hay tarjeta. */
  readonly enFechasDeViaje: boolean | null;
  /** Con una apertura de mesa sin confirmar, el ejemplo no arranca (respuestas de V). */
  readonly aperturaPendiente: boolean | null;
  /** 4a · la mesa de ejemplo ocupa su lugar en Inicio. */
  readonly mesaDeEjemploEnInicio: boolean;
}

/** D364 · D365 · ¿se muestra la tarjeta Tutorial en Inicio? Sólo con todo sabido y en «no». */
export function tarjetaVisible(e: EntradaDeLaTarjeta): boolean {
  return e.noVolverAMostrar === false
    && e.tarjetaOculta === false
    && e.enFechasDeViaje === false
    && e.aperturaPendiente === false
    && !e.mesaDeEjemploEnInicio;
}

export type EstadoDeLaAyuda = 'disponible' | 'en-viaje' | 'apertura-pendiente' | 'sin-saber';

/**
 * Más → Ayuda → «Cómo usar PayMe». Q9 · dentro de las fechas de un viaje se ve
 * deshabilitada (Escanear llevaría al ticket del viaje). Con una apertura sin
 * confirmar se ve, pero el ejemplo no arranca: avisa. Q8 · el «No volver a
 * mostrar» no la apaga: es lo que le queda a quien lo marcó.
 */
export function estadoDeLaAyuda(e: {
  readonly enFechasDeViaje: boolean | null;
  readonly aperturaPendiente: boolean | null;
}): EstadoDeLaAyuda {
  if (e.enFechasDeViaje === true) return 'en-viaje';
  if (e.enFechasDeViaje === null || e.aperturaPendiente === null) return 'sin-saber';
  return e.aperturaPendiente ? 'apertura-pendiente' : 'disponible';
}
