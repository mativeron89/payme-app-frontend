import { useEffect, useSyncExternalStore } from 'react';
import { api } from '../../api';
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
 */
let enVuelo: Promise<unknown> | null = null;

/** Pide la lista de abiertos, una a la vez. Un error no hace nada: la cámara sigue con lo de siempre. */
export function precargarViajesAbiertos(): void {
  if (enVuelo || viajesAbiertosRecordados() !== null) return;
  enVuelo = api.getViajes('abiertos').catch(() => undefined).finally(() => { enVuelo = null; });
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
