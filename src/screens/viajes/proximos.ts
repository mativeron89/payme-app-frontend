import { useEffect, useState } from 'react';
import type { EstadoViaje } from '../../api/viajes';

/**
 * 🔴 D302 · los viajes que todavía no empezaron.
 *
 * - En Inicio, la burbuja de un viaje aparece desde el día de su «desde» en hora de México. Un viaje futuro no se ve en
 *   Inicio, ni sus restaurantes pendientes, ni su «+ Gasto», y el aviso de mesas se calcula sin él.
 * - En la pestaña Viajes, «Próximos» los lista, del más cercano al más lejano.
 * - Un viaje futuro sigue siendo un viaje abierto: sólo cambia dónde se ve.
 *
 * Adenda del Bibliotecario (2026-10-13T00:35:00Z):
 * - un viaje abierto sin `fecha_desde` no tiene día de inicio, así que queda en Inicio, como hoy, y no va a «Próximos»;
 * - uno esperando pagos queda en Inicio aunque su `fecha_desde` sea futura (D275).
 */

/** México es UTC−6 fijo, como el contrato (`viajes-v1.json`, `cierre_automatico.momento`): sin horario de verano. */
const MEXICO_MS = 6 * 60 * 60 * 1000;
const DIA_MS = 24 * 60 * 60 * 1000;

/** El día de hoy en México, `YYYY-MM-DD` (el formato de `fecha_desde`). */
export function hoyEnMexico(ahoraMs: number = Date.now()): string {
  return new Date(ahoraMs - MEXICO_MS).toISOString().slice(0, 10);
}

/** Cuánto falta para la próxima medianoche de México. Nunca 0: a la medianoche en punto, falta un día entero. */
export function msHastaLaMedianocheDeMexico(ahoraMs: number): number {
  const delDia = (((ahoraMs - MEXICO_MS) % DIA_MS) + DIA_MS) % DIA_MS;
  return DIA_MS - delDia;
}

type ConFechaDeInicio = { readonly estado: EstadoViaje; readonly fecha_desde: string | null };

/** Un viaje abierto cuyo «desde» es posterior a hoy en México. */
export function esProximo(v: ConFechaDeInicio, hoy: string): boolean {
  return v.estado === 'abierto' && v.fecha_desde !== null && v.fecha_desde > hoy;
}

/** Los viajes de Inicio: todos menos los próximos, en el orden de la lista. */
export function viajesDeInicio<V extends ConFechaDeInicio>(viajes: readonly V[], hoy: string): readonly V[] {
  return viajes.filter((v) => !esProximo(v, hoy));
}

/** Los próximos, del más cercano al más lejano; con el mismo «desde», en el orden de la lista. */
export function viajesProximos<V extends ConFechaDeInicio>(viajes: readonly V[], hoy: string): readonly V[] {
  return viajes.filter((v) => esProximo(v, hoy)).sort((a, b) => (a.fecha_desde! < b.fecha_desde! ? -1 : a.fecha_desde! > b.fecha_desde! ? 1 : 0));
}

/** El reloj y el temporizador, inyectables: la unidad no tiene navegador (jsdom está prohibido por ratificación). */
export interface Reloj {
  ahora(): number;
  esperar(hacer: () => void, ms: number): number;
  cancelar(id: number): void;
}

const RELOJ_DEL_NAVEGADOR: Reloj = {
  ahora: () => Date.now(),
  esperar: (hacer, ms) => window.setTimeout(hacer, ms),
  cancelar: (id) => window.clearTimeout(id),
};

/**
 * Avisa el día de México a cada medianoche de México, una tras otra, hasta que se cancela. Devuelve la cancelación. Si
 * el temporizador llega tarde (el teléfono dormía), avisa el día de ese momento y se vuelve a armar desde ahí.
 */
export function alCambiarElDiaEnMexico(avisar: (hoy: string) => void, reloj: Reloj = RELOJ_DEL_NAVEGADOR): () => void {
  let temporizador = 0;
  const armar = () => {
    temporizador = reloj.esperar(() => {
      avisar(hoyEnMexico(reloj.ahora()));
      armar();
    }, msHastaLaMedianocheDeMexico(reloj.ahora()));
  };
  armar();
  return () => reloj.cancelar(temporizador);
}

/**
 * El día de hoy en México, que cambia solo a la medianoche de México: con la app abierta, un viaje que empieza hoy
 * pasa a Inicio sin recargar.
 */
export function useHoyEnMexico(): string {
  const [hoy, setHoy] = useState(() => hoyEnMexico());
  useEffect(() => {
    // Lo que pasó entre el primer render y el efecto (un cruce de medianoche justo ahí).
    setHoy(hoyEnMexico());
    return alCambiarElDiaEnMexico(setHoy);
  }, []);
  return hoy;
}
