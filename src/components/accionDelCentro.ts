import type { AppBottomBarProps } from './AppBottomBar';
import type { ViajeConFechas } from '../api/viajesDeHoy';
import { centroPorFechas } from '../screens/viajes/circuloDelViaje';
import type { T } from '../screens/viajes/viajesView';

type Accion = NonNullable<AppBottomBarProps['center']>;

/** Centro propio > viajes de hoy (uno: su cámara; varios: elegir) > cámara de siempre. */
export function elegirAccionDelCentro(
  deHoy: readonly ViajeConFechas[], center: Accion | undefined, t: T, camara: Accion,
): Accion {
  const accion = center ?? centroPorFechas(deHoy, center, t) ?? camara;
  return accion.busy && !accion.disabled ? { ...accion, disabled: true } : accion;
}
