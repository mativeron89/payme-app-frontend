import { useEffect, useSyncExternalStore } from 'react';
import { api } from '../../api';
import { ultimoVisto, type TurnoDeUltimoVisto } from '../../api/ultimoVisto';
import { useViajesHabilitado } from '../../api/viajes';
import {
  hoyLocal,
  suscribirViajesAbiertos,
  viajesAbiertosRecordados,
  viajesDeHoy,
  type ViajeConFechas,
} from '../../api/viajesDeHoy';

/**
 * D276-1 · los viajes abiertos que cubren hoy, para la cámara de Nueva.
 *
 * Si todavía no se sabe (la primera carga), los pide una vez: la cámara decide ANTES del toque, y sin dato va lo de
 * siempre. La precarga también corre apenas hay sesión (`App`), así el caso de la primera carga es lo que tarda esa
 * lista (condición del OK del Bibliotecario).
 *
 * 🔴 W-02 (auditoría de Codex): la petición en vuelo es de UNA cuenta. Antes era una sola promesa sin dueño: si la de A
 * seguía pendiente cuando entraba B, la precarga de B no pedía nada y, al terminar la de A, nadie pedía la de B. La
 * cámara de B quedaba con lo de siempre aunque B tuviera un viaje de hoy. Ahora la petición lleva el `turno()` de quien
 * la pidió (la cuenta y la generación, T-01):
 * - con otro turno, se pide igual;
 * - el final de una petición vieja sólo limpia si sigue siendo la que está en vuelo.
 * Lo que llega de A nunca se guarda bajo B: lo frena `recordarViajesAbiertos` con el turno de la fachada.
 */
let enVuelo: { readonly turno: TurnoDeUltimoVisto } | null = null;

const mismoTurno = (a: TurnoDeUltimoVisto, b: TurnoDeUltimoVisto) => a.dueno === b.dueno && a.generacion === b.generacion;

/** Pide la lista de abiertos, una a la vez por cuenta. Un error no hace nada: la cámara sigue con lo de siempre. */
export function precargarViajesAbiertos(): void {
  if (viajesAbiertosRecordados() !== null) return;
  const turno = ultimoVisto.turno();
  if (enVuelo !== null && mismoTurno(enVuelo.turno, turno)) return;
  const propio = { turno };
  enVuelo = propio;
  void api.getViajes('abiertos').catch(() => undefined).finally(() => {
    if (enVuelo === propio) enVuelo = null;
  });
}

/**
 * `precargar: false` sólo lee (la hoja de `App`, que está siempre montada: si pidiera, taparía a la precarga de la
 * sesión y nadie sabría cuál de las dos funciona). La barra sí pide, como respaldo, si al montarse no hay dato.
 */
export function useViajesDeHoy({ precargar = true }: { readonly precargar?: boolean } = {}): readonly ViajeConFechas[] {
  const habilitado = useViajesHabilitado();
  const lista = useSyncExternalStore(suscribirViajesAbiertos, viajesAbiertosRecordados, () => null);
  useEffect(() => {
    if (precargar && habilitado && lista === null) precargarViajesAbiertos();
  }, [precargar, habilitado, lista]);
  if (!habilitado || !lista) return [];
  return viajesDeHoy(lista, hoyLocal());
}
