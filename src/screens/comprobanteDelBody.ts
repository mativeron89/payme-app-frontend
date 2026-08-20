/**
 * Los metadatos del comprobante salen del **BODY EXACTO QUE VIAJÓ**, nunca del
 * estado visual.
 *
 * 🔴 Existe por el P2-② de la reauditoría del 2026-08-20, y es **mi propia
 * lección a medio aplicar**: ya sabía que `tip` y `staffId` se resetean al
 * cerrar el intento, y por eso los capturaba **al pagar** en vez de al pintar.
 * Lo que no vi es que en un **replay tras remount** el estado visual es
 * **nuevo** —la selección arranca vacía— mientras el cuerpo que se reenvía es
 * el ORIGINAL (`frozen.payload`). Capturar «al pagar» seguía siendo capturar
 * del lugar equivocado: el importe salía bien —lo devuelve el server— pero el
 * porcentaje y el mesero se perdían, y **vista, compartir y descargar quedaban
 * uniformemente incorrectos**. Uniformes y mal es peor que divergentes: no hay
 * dos superficies que se contradigan para delatarlo.
 *
 * La regla, entonces: **el comprobante se deriva del cuerpo, y el cuerpo es la
 * única fuente que sobrevive a un remount.**
 */
import type { MesaDetail, PayMesaRequest } from '../api/types';

export interface MetadatosPropina {
  /** Porcentaje elegido, o `null` si fue monto libre. */
  readonly pct: number | null;
  /** Nombre del destinatario, o `null` si no se eligió o ya no está en la mesa. */
  readonly nombre: string | null;
}

/**
 * `tip_bps` son centésimas de punto porcentual: 1000 = 10 %. Se divide por 100
 * y **no se redondea a mano** — el contrato admite 0–10000 y un `250` es
 * 2,5 %, que es un porcentaje legítimo aunque no sea preset.
 *
 * `tip_cents` (monto propio) **no tiene porcentaje**, y devolver 0 ahí sería
 * inventar uno: va `null`, que es lo que `rotuloPropina` sabe omitir.
 */
export function metadatosDelBody(
  body: Pick<PayMesaRequest, 'tip_bps' | 'tip_to_staff_id'>,
  staff: MesaDetail['active_staff'] | undefined,
): MetadatosPropina {
  return {
    pct: typeof body.tip_bps === 'number' ? body.tip_bps / 100 : null,
    // Si el mesero ya no figura entre los activos, NO se inventa un nombre:
    // el comprobante dice el porcentaje y calla el destinatario.
    nombre: staff?.find((s) => s.id === body.tip_to_staff_id)?.display_name ?? null,
  };
}
