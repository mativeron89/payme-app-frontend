import { useEffect, useSyncExternalStore } from 'react';
import { api } from '../api';
import type { EstadoDelAvisoDeFotos } from './avisoDeFotos';
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
  const sabido = enFechasDeViaje(capacidad, abiertos, hoyLocal());
  useEffect(() => {
    if (sabido !== null) return undefined;
    return escucharElRegreso(window, document, () => reintentarSaberSiHayViaje(capacidad));
  }, [sabido, capacidad]);
  return sabido;
}

/**
 * Revisión de V sobre ff5dec7, punto 3 · lo que no se supo (la config que no llegó, la lista de viajes que falló) se
 * vuelve a pedir: si no, la tarjeta Tutorial y la fila de Ayuda, las dos entradas de D364, quedaban muertas. Con la
 * capacidad sin saber, la config (que la trae); con Viajes encendido, la lista de abiertos (`precargarViajesAbiertos`
 * deja pedirla de nuevo después de un error).
 */
export function reintentarSaberSiHayViaje(capacidad: EstadoCapacidadViajes): void {
  if (capacidad === 'pendiente') {
    // Una config a la vez: dos regresos seguidos (el foco y la pestaña visible llegan juntos) piden una sola.
    if (configEnVuelo) return;
    configEnVuelo = api.getConfig().then(() => undefined, () => undefined).finally(() => { configEnVuelo = null; });
  } else if (capacidad === 'encendida') precargarViajesAbiertos();
}
let configEnVuelo: Promise<void> | null = null;

/**
 * Llama a `alVolver` cada vez que la ventana recupera el foco o la pestaña vuelve a verse. Al montar no pide nada
 * nuevo: el arranque ya pide la config y la lista. Devuelve cómo dejar de escuchar.
 */
export function escucharElRegreso(
  ventana: EventTarget,
  documento: EventTarget & { readonly visibilityState?: string },
  alVolver: () => void,
): () => void {
  const alEnfocar = () => alVolver();
  const alCambiar = () => { if (documento.visibilityState !== 'hidden') alVolver(); };
  ventana.addEventListener('focus', alEnfocar);
  documento.addEventListener('visibilitychange', alCambiar);
  return () => {
    ventana.removeEventListener('focus', alEnfocar);
    documento.removeEventListener('visibilitychange', alCambiar);
  };
}

/**
 * Lo mismo, sólo leyendo: no pide la lista ni escucha el regreso. Lo usa el provider de la guía (siempre montado) para
 * cerrarla si hoy pasa a caer en un viaje; los pedidos quedan a cargo de quien muestra las entradas.
 */
export function useEnFechasDeViajeSinPedir(): boolean | null {
  const capacidad = useCapacidadViajes();
  const abiertos = useSyncExternalStore(suscribirViajesAbiertos, viajesAbiertosRecordados, () => null);
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
  /** Enmienda 10 · el aviso «Tu foto entre amigos» de Inicio: la tarjeta espera a que esté resuelto. */
  readonly avisoDeFotos: EstadoDelAvisoDeFotos;
}

/** D364 · D365 · ¿se muestra la tarjeta Tutorial en Inicio? Sólo con todo sabido y en «no». */
export function tarjetaVisible(e: EntradaDeLaTarjeta): boolean {
  return e.noVolverAMostrar === false
    && e.tarjetaOculta === false
    && e.enFechasDeViaje === false
    && e.aperturaPendiente === false
    && e.avisoDeFotos === 'resuelto'
    && !e.mesaDeEjemploEnInicio;
}

/**
 * 'sin-saber-viaje' · no se sabe si hoy cae en un viaje (la capacidad o la lista no llegaron): la fila espera con su
 * línea. 'sin-saber' · sólo falta la lectura local de la apertura, que es un instante: espera sin línea.
 */
export type EstadoDeLaAyuda = 'disponible' | 'en-viaje' | 'apertura-pendiente' | 'aviso-de-fotos' | 'sin-saber-viaje' | 'sin-saber';

/**
 * Más → Ayuda → «Cómo usar PayMe». Q9 · dentro de las fechas de un viaje se ve
 * deshabilitada (Escanear llevaría al ticket del viaje). Con una apertura sin
 * confirmar se ve, pero el ejemplo no arranca: avisa. Q8 · el «No volver a
 * mostrar» no la apaga: es lo que le queda a quien lo marcó.
 */
export function estadoDeLaAyuda(e: {
  readonly enFechasDeViaje: boolean | null;
  readonly aperturaPendiente: boolean | null;
  /** Enmienda 10 · con el aviso «Tu foto entre amigos» pendiente, la fila espera con su línea; sin saber, no se traba. */
  readonly avisoDeFotos: EstadoDelAvisoDeFotos;
}): EstadoDeLaAyuda {
  if (e.enFechasDeViaje === true) return 'en-viaje';
  if (e.enFechasDeViaje === null) return 'sin-saber-viaje';
  if (e.avisoDeFotos === 'pendiente') return 'aviso-de-fotos';
  if (e.aperturaPendiente === null) return 'sin-saber';
  return e.aperturaPendiente ? 'apertura-pendiente' : 'disponible';
}
