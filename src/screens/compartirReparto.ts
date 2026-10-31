import type { MyShare, ShareTotals, TipSetting } from '../api/miParte';
import type { MesaStatus } from '../api/types';
import { formatMXN } from '../utils/format';
import { writeClipboardText } from '../utils/clipboard';
import { renglonDeAjustes, rotuloDeAjustes, rotuloDePropina, signoDeAjustes } from './miParteView';

/**
 * D584 · D588–D591 · «Compartir» el reparto, entrega 1: el texto.
 *
 * Lo que se comparte es **lo que la persona ya ve** al pie de «Tu parte» (D588,
 * camino A de la propuesta): su parte, con los mismos renglones, rótulos y
 * montos del desglose, y el total del encabezado, rotulado «Total del ticket»
 * (D605: es el ticket antes de la propina, y las partes con propina suman más). Nunca la parte de
 * nadie más (R5), ni nombres, código, link de la mesa, RFC, dirección o foto.
 *
 * El texto se arma en el teléfono con lo que ya llegó del dueño y lo manda la
 * persona: no hay pedido nuevo al backend, link público ni analítica (D584).
 *
 * 🔴 Los renglones salen de LAS MISMAS funciones que dibujan el desglose
 * (`renglonDeAjustes`, `rotuloDeAjustes`, `rotuloDePropina`, `montoDeAjustes`,
 * `formatMXN`): si el papel dijera otro monto que la pantalla sería un error de
 * plata visible (el «bloqueante 2» del comprobante, 20/08).
 *
 * Sin fecha: el detalle de la mesa no publica cuándo se abrió ni cuándo cerró
 * (sólo `expires_at`), y la fecha del día mentiría en una mesa vieja.
 */

type Traducir = (s: string, ...args: unknown[]) => string;

/** AF-1 · el mismo signo explícito en pantalla y en el texto compartido. */
export function montoDeAjustes(mia: MyShare): string {
  return `${signoDeAjustes(mia.adjustments_cents)}${formatMXN(Math.abs(mia.adjustments_cents))}`;
}

export interface DatosDelReparto {
  readonly restaurante: string;
  readonly status: MesaStatus;
  readonly divisionMode: 'consumo' | 'igual';
  readonly expectedParticipants: number;
  /** El total del encabezado (`mesa.total_cents`), rotulado «Total del ticket» (D605). */
  readonly totalDeLaMesaCents: number;
  readonly totales: ShareTotals;
  readonly mia: MyShare;
  readonly tipSetting: TipSetting | null;
}

/** Abierta es la mesa que todavía recibe selecciones: el mismo criterio que el código para unirse. */
function sigueAbierta(status: MesaStatus): boolean {
  return status === 'open' || status === 'partially_paid';
}

function modalidad(datos: DatosDelReparto, t: Traducir): string {
  if (datos.divisionMode === 'consumo') return t('por consumo');
  return datos.expectedParticipants > 1
    ? t('partes iguales, entre {0}', datos.expectedParticipants)
    : t('toda la cuenta');
}

/**
 * El texto que se comparte. En partes iguales va «entre N» y «Mi parte», nunca
 * «$X cada uno»: los centavos que sobran los paga la primera persona (D587).
 */
export function textoDelReparto(datos: DatosDelReparto, t: Traducir): string {
  const { mia } = datos;
  const renglon = renglonDeAjustes(datos.totales, mia);
  const estado = sigueAbierta(datos.status)
    ? t('Así va la mesa ({0})', modalidad(datos, t))
    : t('Así quedó la mesa ({0})', modalidad(datos, t));
  return [
    datos.restaurante.trim(),
    estado,
    t('Mi parte: {0}', formatMXN(mia.total_cents)),
    `  ${t('Mis platos')}: ${formatMXN(mia.items_cents)}`,
    ...(renglon ? [`  ${rotuloDeAjustes(renglon, t)}: ${montoDeAjustes(mia)}`] : []),
    `  ${rotuloDePropina(datos.tipSetting, t)}: ${formatMXN(mia.tip_cents)}`,
    t('Total del ticket: {0}', formatMXN(datos.totalDeLaMesaCents)),
    t('Dividido con PayMe · paymemx.com'),
  ].filter((linea) => linea.length > 0).join('\n');
}

/** Cómo terminó: la hoja nativa, la copia, o nada que avisar. */
export type ResultadoDeCompartir = 'compartido' | 'cancelado' | 'copiado' | 'sin_portapapeles';

function esCancelacion(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError';
}

/**
 * La hoja nativa con el texto (`navigator.share({ text })`). Si no existe o
 * falla, se copia al portapapeles. Si la persona cancela la hoja (AbortError),
 * no se copia ni se avisa: canceló ella.
 */
export async function compartirTexto(text: string): Promise<ResultadoDeCompartir> {
  const nav = globalThis.navigator as (Navigator & { share?: Navigator['share'] }) | undefined;
  if (nav && typeof nav.share === 'function') {
    try {
      await nav.share({ text });
      return 'compartido';
    } catch (e) {
      if (esCancelacion(e)) return 'cancelado';
    }
  }
  return (await writeClipboardText(text)) ? 'copiado' : 'sin_portapapeles';
}
