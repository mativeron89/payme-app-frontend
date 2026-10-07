/**
 * D222 · el marco para recortar la foto del ticket a mano.
 *
 * Mati eligió «Siempre, con el marco abierto (Recomendada)»: «Después de sacar o
 * elegir la foto, aparece con un marco que se mueve desde las esquinas. Si no lo
 * movés, va la foto entera.»
 *
 * - **El marco vive en proporciones de la foto** (0 a 1), no en píxeles de
 *   pantalla: si la pantalla cambia de tamaño (zoom, rotación, la barra de
 *   Safari), el marco queda en el mismo lugar de la foto.
 * - **Se mueve desde las cuatro esquinas y los cuatro bordes.** La esquina
 *   mueve dos lados; el borde, uno. Arrastrar adentro no mueve el marco entero.
 * - **Nunca sale de la foto ni baja del mínimo**, que llega en proporciones
 *   (88 px de pantalla divididos por lo que mide la foto en pantalla). Si la
 *   pantalla cambia, `asegurarMinimo` lo vuelve a llevar al mínimo.
 * - **Sin tocar, o vuelto a los bordes, es la foto entera**: `recortePixeles`
 *   devuelve `null` y se manda exactamente lo de antes de D222.
 *
 * Puro: sin DOM. La pantalla (`RecorteDelTicket`) traduce el dedo a proporciones.
 */
import type { Recorte } from './fotoDelTicket';

export interface Marco {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export const MARCO_ENTERO: Marco = { x0: 0, y0: 0, x1: 1, y1: 1 };

/**
 * El lado mínimo del marco en pantalla. AF-UNIRSE-CODIGO §0 (F2 de la auditoría
 * de Codex): 88 y no 64. En un lado entran tres zonas de 44 px —dos esquinas,
 * que adentro ocupan 22 cada una, y el borde— y el borde queda de `lado − 44`:
 * con 64 medía 20×44. Con 88, las ocho zonas miden 44×44 sin pisarse.
 */
export const MINIMO_PX = 88;

/** Lo que mueve una flecha del teclado: un 2% de la foto. */
export const PASO_TECLADO = 0.02;

export type Asa =
  | 'arriba-izquierda'
  | 'arriba-derecha'
  | 'abajo-izquierda'
  | 'abajo-derecha'
  | 'arriba'
  | 'abajo'
  | 'izquierda'
  | 'derecha';

export const ESQUINAS = ['arriba-izquierda', 'arriba-derecha', 'abajo-izquierda', 'abajo-derecha'] as const;
export const BORDES = ['arriba', 'abajo', 'izquierda', 'derecha'] as const;

/** Qué lados mueve cada asa. */
function lados(asa: Asa): { x: 'x0' | 'x1' | null; y: 'y0' | 'y1' | null } {
  return {
    x: asa.endsWith('izquierda') ? 'x0' : asa.endsWith('derecha') ? 'x1' : null,
    y: asa.startsWith('arriba') ? 'y0' : asa.startsWith('abajo') ? 'y1' : null,
  };
}

/** El mínimo en proporciones de un lado de la foto que mide `px` en pantalla. */
export function minimoProporcional(px: number, minimo = MINIMO_PX): number {
  if (!(px > 0) || !Number.isFinite(px)) return 1;
  return Math.min(1, minimo / px);
}

function entre(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/**
 * El marco con `asa` corrida `dx`, `dy` (en proporciones de la foto) desde
 * `marco`. El lado que se mueve se frena en el borde de la foto y en el mínimo
 * contra el lado opuesto, que no se mueve. `minX`/`minY`: el mínimo en
 * proporciones de cada lado (`minimoProporcional`).
 */
export function moverAsa(marco: Marco, asa: Asa, dx: number, dy: number, minX: number, minY: number): Marco {
  const { x, y } = lados(asa);
  const m = { ...marco };
  const mx = entre(minX, 0, 1);
  const my = entre(minY, 0, 1);
  const ddx = Number.isFinite(dx) ? dx : 0;
  const ddy = Number.isFinite(dy) ? dy : 0;
  if (x === 'x0') m.x0 = entre(marco.x0 + ddx, 0, Math.max(0, marco.x1 - mx));
  if (x === 'x1') m.x1 = entre(marco.x1 + ddx, Math.min(1, marco.x0 + mx), 1);
  if (y === 'y0') m.y0 = entre(marco.y0 + ddy, 0, Math.max(0, marco.y1 - my));
  if (y === 'y1') m.y1 = entre(marco.y1 + ddy, Math.min(1, marco.y0 + my), 1);
  return m;
}

/**
 * AF-UNIRSE-CODIGO §0 (F1 de la auditoría de Codex): el marco con cada lado al
 * menos en el mínimo. El mínimo se aplicaba sólo al mover un asa: si la pantalla
 * se achicaba (al rotar el teléfono), un marco que estaba en el mínimo quedaba
 * más chico y no se reparaba. Agranda SÓLO el lado que no llega, desde su
 * centro, y lo corre para que no salga de la foto. Un marco que cumple vuelve
 * igual (el mismo objeto), así quien lo llama sabe que no cambió nada.
 */
export function asegurarMinimo(marco: Marco, minX: number, minY: number): Marco {
  const ajustar = (a: number, b: number, min: number): [number, number] => {
    const m = entre(Number.isFinite(min) ? min : 1, 0, 1);
    if (b - a >= m) return [a, b];
    const centro = (a + b) / 2;
    const desde = entre(centro - m / 2, 0, 1 - m);
    return [desde, desde + m];
  };
  const [x0, x1] = ajustar(marco.x0, marco.x1, minX);
  const [y0, y1] = ajustar(marco.y0, marco.y1, minY);
  if (x0 === marco.x0 && x1 === marco.x1 && y0 === marco.y0 && y1 === marco.y1) return marco;
  return { x0, y0, x1, y1 };
}

/**
 * Una flecha del teclado sobre el asa con foco: corre `PASO_TECLADO` en esa
 * dirección. `null` si la tecla no es una flecha o no mueve ese asa (una flecha
 * horizontal sobre el borde de arriba).
 */
export function moverConTecla(
  marco: Marco,
  asa: Asa,
  tecla: string,
  minX: number,
  minY: number,
): Marco | null {
  const { x, y } = lados(asa);
  const direccion: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  };
  const d = direccion[tecla];
  if (!d) return null;
  if ((d[0] !== 0 && !x) || (d[1] !== 0 && !y)) return null;
  return moverAsa(marco, asa, d[0] * PASO_TECLADO, d[1] * PASO_TECLADO, minX, minY);
}

/**
 * El marco en píxeles de la foto (`ancho×alto`, ya orientada), redondeado y
 * dentro de la foto. `null` si es la foto entera: sin tocar el marco, o
 * vuelto a los bordes, se manda exactamente lo de siempre.
 */
export function recortePixeles(marco: Marco, ancho: number, alto: number): Recorte | null {
  if (!(ancho > 0) || !(alto > 0) || !Number.isFinite(ancho) || !Number.isFinite(alto)) return null;
  const px = (v: number, lado: number) => entre(Math.round((Number.isFinite(v) ? v : 0) * lado), 0, lado);
  const x0 = px(Math.min(marco.x0, marco.x1), ancho);
  const x1 = px(Math.max(marco.x0, marco.x1), ancho);
  const y0 = px(Math.min(marco.y0, marco.y1), alto);
  const y1 = px(Math.max(marco.y0, marco.y1), alto);
  const recorte = {
    x: Math.min(x0, ancho - 1),
    y: Math.min(y0, alto - 1),
    ancho: 0,
    alto: 0,
  };
  recorte.ancho = Math.max(1, x1 - recorte.x);
  recorte.alto = Math.max(1, y1 - recorte.y);
  if (recorte.x === 0 && recorte.y === 0 && recorte.ancho === ancho && recorte.alto === alto) return null;
  return recorte;
}
