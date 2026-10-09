import type { EstadoViaje } from '../../api/viajes';
import { abrirCamaraNativa } from '../../camara/camaraNativa';
import type { AppBottomBarProps } from '../../components/AppBottomBar';
import { navigate } from '../../router';
import type { T } from './viajesView';

/**
 * D250 · Mati: «en viaje que te habia puesto dos burbujas, una de scan y otra
 * manual, reemplaza la del scan con justamente el circulo este, que cuando
 * escaneas desde un viaje que ese escan se contabilice al viaje».
 *
 * Desde un viaje ABIERTO (el viaje, Balance, un ticket o gasto y sus presentes),
 * el círculo de la cámara de la barra abre el escaneo de ese viaje: el mismo
 * flujo que abría «Escanear ticket» (`/scan/<id>`, `trip_version=1`). Se ve
 * «Nueva» como siempre y el lector de pantalla oye «Escanear ticket para
 * {viaje}». En esperando pagos, cerrado o sin viaje todavía: el círculo de
 * siempre (`undefined`).
 */
export function circuloDelViaje(
  viaje: { readonly id: string; readonly nombre: string; readonly estado: EstadoViaje } | null,
  t: T,
): AppBottomBarProps['center'] {
  if (!viaje || viaje.estado !== 'abierto') return undefined;
  const id = viaje.id;
  return {
    label: t('Nueva'),
    icon: 'camera',
    ariaLabel: t('Escanear ticket para {0}', viaje.nombre),
    onClick: () => {
      // D212 · la cámara nativa se abre EN ESTE TOQUE (iOS sólo la abre dentro del gesto).
      abrirCamaraNativa();
      navigate('scan', id);
    },
  };
}

/**
 * D250 · el título del escaneo de un viaje, «Ticket para {viaje}», sin esperar
 * la red: el nombre que mostró la pantalla del viaje queda recordado por id.
 * Después de una recarga no hay nada recordado y el escaneo lo pide.
 */
let recordado: { readonly id: string; readonly nombre: string } | null = null;

export function recordarNombreDeViaje(id: string, nombre: string): void {
  recordado = { id, nombre };
}

export function nombreDeViajeRecordado(id: string | null): string | null {
  return id !== null && recordado?.id === id ? recordado.nombre : null;
}
