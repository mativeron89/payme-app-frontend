import type { MotivoDeAjustesOmitidos, MyShare, ParteDelDetalle, ShareTotals, TipSetting } from '../api/miParte';
import { porcentajeVisible } from './propinaDeLaMesaView';

/**
 * D344 · «Mi parte» con platos, ajustes y propina en la mesa sin garantía
 * (P2–P4). Lógica pura de lo que se muestra; los montos son los que publica el
 * dueño en `share_version=1` (`contract/mesa-mi-parte-v1.json`, `cliente`). La
 * única cuenta propia es la vista previa antes de «Listo», que el contrato
 * define y que puede diferir en un centavo de lo que guarda el servidor.
 */

/**
 * ¿Aplica «Mi parte» con ajustes y propina? Sólo con `share_totals` publicado
 * y bien formado en una mesa sin garantía. En cualquier otro caso rige lo de
 * hoy: la mesa con garantía, el dueño anterior y el cálculo que no se pudo
 * hacer (las dos claves en null).
 */
export function totalesDeLaMesa(
  parte: ParteDelDetalle,
  guaranteeMode: boolean | undefined,
): ShareTotals | null {
  return guaranteeMode === false && parte.shareTotals ? parte.shareTotals : null;
}

/** La parte propia publicada, sólo junto con los totales de la mesa. */
export function miParteDelDueno(parte: ParteDelDetalle, guaranteeMode: boolean | undefined): MyShare | null {
  return totalesDeLaMesa(parte, guaranteeMode) && parte.myShare ? parte.myShare : null;
}

/**
 * La vista previa antes de «Listo», SÓLO por consumo (pendiente MENOR 5): lo
 * elegido × (platos + ajustes + propina) / platos, con los totales de la mesa.
 * Redondeo al centavo más cercano, la mitad hacia arriba (todo es no negativo),
 * con BigInt para que el producto no pierda precisión. En partes iguales no
 * hay fórmula: se muestra la parte del servidor o nada.
 */
export function vistaPreviaPorConsumo(elegidoCents: number, totales: ShareTotals): number | null {
  if (!Number.isSafeInteger(elegidoCents) || elegidoCents < 0) return null;
  if (totales.items_cents <= 0) return null;
  const numerador = BigInt(elegidoCents)
    * BigInt(totales.items_cents + totales.adjustments_cents + totales.tip_cents);
  const divisor = BigInt(totales.items_cents);
  if (numerador < 0n) return null;
  const redondeado = (numerador * 2n + divisor) / (divisor * 2n);
  const n = Number(redondeado);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * El rótulo del renglón de ajustes (contrato, `cliente[0]`): «Descuento» si la
 * mesa sólo tiene descuento; «Descuento y cargos del ticket» si trae servicio o
 * IVA aparte. Sin ningún ajuste del ticket, un centavo suelto por las
 * fracciones (pendiente MENOR 2) se rotula «Redondeo» y no se oculta, para que
 * la suma cierre a la vista. Sin ajustes y sin centavo, no hay renglón.
 */
export type RenglonDeAjustes = 'descuento' | 'descuento_y_cargos' | 'redondeo';
export function renglonDeAjustes(totales: ShareTotals, mia: MyShare): RenglonDeAjustes | null {
  if (totales.service_cents > 0 || totales.tax_added_cents > 0) return 'descuento_y_cargos';
  if (totales.discounts_cents > 0) return 'descuento';
  return mia.adjustments_cents !== 0 ? 'redondeo' : null;
}

export function rotuloDeAjustes(renglon: RenglonDeAjustes, t: (s: string, ...args: unknown[]) => string): string {
  return renglon === 'descuento' ? t('Descuento')
    : renglon === 'descuento_y_cargos' ? t('Descuento y cargos del ticket')
      : t('Redondeo');
}

/**
 * El rótulo de la propina en el desglose: con un %, «Propina (10 % de la
 * mesa)»; con «Otro», «Propina de la mesa»; sin fijar, «Propina» sin ningún %
 * (la propina es 0 y no se muestra un % que nadie eligió).
 */
export function rotuloDePropina(setting: TipSetting | null, t: (s: string, ...args: unknown[]) => string): string {
  if (setting === null) return t('Propina');
  if ('tip_bps' in setting) return t('Propina ({0} % de la mesa)', porcentajeVisible(setting.tip_bps));
  return t('Propina de la mesa');
}

/**
 * Los avisos de `adjustments_omitted_reason`, con los literales de la
 * concreción 7 (mayúscula inicial y punto final, V). Los ve todo participante:
 * cambian la parte de cada uno.
 */
export function avisoDeAjustesOmitidos(
  totales: ShareTotals,
  t: (s: string, ...args: unknown[]) => string,
): string | null {
  if (!totales.adjustments_omitted) return null;
  return textoDelMotivo(totales.adjustments_omitted_reason, t);
}

function textoDelMotivo(motivo: MotivoDeAjustesOmitidos | null, t: (s: string, ...args: unknown[]) => string): string | null {
  if (motivo === 'mesa_corregida') {
    return t('Como la mesa se corrigió, los ajustes del ticket no se aplicaron y la propina va sobre los platos.');
  }
  if (motivo === 'neto_no_positivo') {
    return t('El descuento del ticket cubre toda la cuenta: no se aplicó y la propina por % queda en 0.');
  }
  return null;
}

/**
 * ¿Se muestra el desglose propio? Por consumo, cuando la persona ya eligió algo
 * (con ceros no hay nada que desglosar; la fila de abajo guía). En partes
 * iguales, siempre que el dueño publique la parte: `null` es «sin parte» (más
 * personas que partes, o una invitación pendiente) y ahí no se inventa nada.
 */
export function muestraElDesglose(mia: MyShare | null, esConsumo: boolean): mia is MyShare {
  if (!mia) return false;
  return esConsumo ? mia.items_cents > 0 : true;
}
