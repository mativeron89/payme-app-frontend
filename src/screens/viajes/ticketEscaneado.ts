import { MemoriaDeCuenta } from '../../api/memoriaDeCuenta';
import type { OcrResponse } from '../../api/types';

/**
 * AF-VIAJES · lo que la cámara leyó para un ticket del viaje, en MEMORIA y
 * nada más: el recibo, los renglones, el comercio y la fecha pasan de la cámara
 * (`CreateMesaFlow` con `viajeId`) a «Ticket nuevo» (1h) sin storage. Una
 * recarga lo pierde a propósito: hay que volver a escanear.
 * C-07 · es de la cuenta que escaneó (`MemoriaDeCuenta`): con otra cuenta, o
 * después de cerrar sesión, no hay nada.
 */
const escaneado = new MemoriaDeCuenta<{ readonly viajeId: string; readonly ocr: OcrResponse }>();

export function guardarTicketEscaneado(viajeId: string, ocr: OcrResponse): void {
  escaneado.guardar({ viajeId, ocr });
}

/** Lo escaneado para ESTE viaje, o `null`. No lo borra: la pantalla puede volver a montarse. */
export function ticketEscaneadoDe(viajeId: string): OcrResponse | null {
  const e = escaneado.leer();
  return e && e.viajeId === viajeId ? e.ocr : null;
}

export function olvidarTicketEscaneado(): void {
  escaneado.olvidar();
}
