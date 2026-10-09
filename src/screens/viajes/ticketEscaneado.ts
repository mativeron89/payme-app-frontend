import type { OcrResponse } from '../../api/types';

/**
 * AF-VIAJES · lo que la cámara leyó para un ticket del viaje, en MEMORIA y
 * nada más: el recibo, los renglones, el comercio y la fecha pasan de la cámara
 * (`CreateMesaFlow` con `viajeId`) a «Ticket nuevo» (1h) sin storage. Una
 * recarga lo pierde a propósito: hay que volver a escanear.
 */
let escaneado: { readonly viajeId: string; readonly ocr: OcrResponse } | null = null;

export function guardarTicketEscaneado(viajeId: string, ocr: OcrResponse): void {
  escaneado = { viajeId, ocr };
}

/** Lo escaneado para ESTE viaje, o `null`. No lo borra: la pantalla puede volver a montarse. */
export function ticketEscaneadoDe(viajeId: string): OcrResponse | null {
  return escaneado && escaneado.viajeId === viajeId ? escaneado.ocr : null;
}

export function olvidarTicketEscaneado(): void {
  escaneado = null;
}
