import { MemoriaDeCuenta } from '../../api/memoriaDeCuenta';
import type { EstadoViaje } from '../../api/viajes';
import type { ViajeConFechas } from '../../api/viajesDeHoy';
import { abrirCamaraNativa } from '../../camara/camaraNativa';
import type { AppBottomBarProps } from '../../components/AppBottomBar';
import { navigate } from '../../router';
import { abrirHojaParaQueViaje } from './hojaParaQueViajeEstado';
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
    label: t('Escanear'),
    icon: 'camera',
    ariaLabel: t('Escanear ticket para {0}', viaje.nombre),
    onClick: () => {
      // D212 · la cámara nativa se abre EN ESTE TOQUE (iOS sólo la abre dentro del gesto).
      // D536 · es el «Escanear» de la barra: también en un viaje, la cámara directo (sin el menú de D368).
      abrirCamaraNativa();
      navigate('scan', id);
    },
  };
}

/**
 * D276-1 · el círculo de la barra según las fechas: sin un centro propio de la pantalla (el de adentro de un viaje,
 * D250, o el CTA del pago), con UN viaje abierto que cubre hoy, el de ese viaje; con dos o más, «Nueva» abre la hoja
 * «¿Para qué viaje?» (la cámara se abre después, en el toque que elige). Si no, `undefined`: el de siempre.
 */
export function centroPorFechas(
  deHoy: readonly ViajeConFechas[],
  center: AppBottomBarProps['center'],
  t: T,
): AppBottomBarProps['center'] {
  if (center || deHoy.length === 0) return undefined;
  if (deHoy.length === 1) return circuloDelViaje(deHoy[0]!, t);
  return {
    label: t('Escanear'),
    icon: 'camera',
    ariaLabel: t('Escanear ticket para un viaje'),
    onClick: abrirHojaParaQueViaje,
  };
}

/**
 * D250 · el título del escaneo de un viaje, «Ticket para {viaje}», sin esperar
 * la red: el nombre que mostró la pantalla del viaje queda recordado por id.
 * Después de una recarga no hay nada recordado y el escaneo lo pide.
 * C-07 · es de la cuenta que lo vio (`MemoriaDeCuenta`): con otra cuenta, o
 * después de cerrar sesión, no hay nada recordado y el escaneo lo pide.
 */
const recordado = new MemoriaDeCuenta<{ readonly id: string; readonly nombre: string }>();

export function recordarNombreDeViaje(id: string, nombre: string): void {
  recordado.guardar({ id, nombre });
}

export function nombreDeViajeRecordado(id: string | null): string | null {
  const r = recordado.leer();
  return id !== null && r?.id === id ? r.nombre : null;
}
