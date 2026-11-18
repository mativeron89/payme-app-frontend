export interface Caja { left: number; top: number; right: number; bottom: number }
export interface Posicion {
  left: number;
  top: number;
  lado: 'arriba' | 'abajo';
  /** El alto que tiene la burbuja; si no entra entera, se desplaza adentro. */
  maxAlto: number;
  /** Dónde cae el centro del control, medido desde el borde izquierdo de la burbuja (la punta y la flecha). */
  centro: number;
  /** En Inicio, el contenido se desplaza dentro del hueco libre. */
  compacta?: boolean;
}

/** Lo que el control ocupa con su anillo: 4 de aire + 2 + 2 (ficha, «Anillo»). */
export const MARGEN_DEL_ANILLO = 8;
/** Flecha de 28, a 4 del anillo y 4 de la burbuja. */
export const SEPARACION_CON_FLECHA = MARGEN_DEL_ANILLO + 4 + 28 + 4;
/** La punta sobresale 10, a 4 del anillo. */
export const SEPARACION_CON_PUNTA = MARGEN_DEL_ANILLO + 4 + 10;
/** La punta queda a 24 o más de una esquina de la burbuja. */
const ESQUINA = 24;
/** Menos que esto no es una burbuja: se espera (por ejemplo, a que el teclado se vaya). */
const ALTO_MINIMO = 80;

const limitar = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/**
 * D363 · ficha, «Colocación»: arriba del control si entra entera; si no, abajo;
 * nunca al costado ni encima. `preferido` es el lado del diseño de cada paso (2d
 * y 4a van abajo). Si no entra entera de ningún lado, va del lado con más lugar
 * y se desplaza adentro; con menos de 80 no hay burbuja. Coordenadas de la
 * ventana: no toca el control ni el layout de la pantalla.
 */
export function posicionGuia(
  objetivo: Caja, espacio: Caja, ancho: number, alto: number,
  preferido: 'arriba' | 'abajo', separacion: number,
  superficies: readonly Caja[] = [],
): Posicion | null {
  if (ancho > espacio.right - espacio.left) return null;
  const left = limitar((objetivo.left + objetivo.right - ancho) / 2, espacio.left, espacio.right - ancho);
  const centro = limitar((objetivo.left + objetivo.right) / 2 - left, ESQUINA, ancho - ESQUINA);
  const arriba = objetivo.top - separacion - espacio.top;
  const abajo = espacio.bottom - (objetivo.bottom + separacion);
  const en = (lado: 'arriba' | 'abajo', maxAlto: number): Posicion => ({
    left,
    top: lado === 'arriba' ? objetivo.top - separacion - Math.min(alto, maxAlto) : objetivo.bottom + separacion,
    lado,
    maxAlto,
    centro,
  });
  const otro: Posicion['lado'] = preferido === 'arriba' ? 'abajo' : 'arriba';
  const lugar = { arriba, abajo };
  // En Inicio, conservamos libres las tarjetas aunque la burbuja tenga que
  // alejarse del control. La flecha sigue señalando el control original.
  const aire = 12;
  const ocupadas = superficies
    .filter((caja) => caja.right > left && caja.left < left + ancho
      && caja.bottom > espacio.top && caja.top < espacio.bottom)
    .sort((a, b) => a.top - b.top);
  if (ocupadas.length) {
    const huecos: Array<{ top: number; bottom: number }> = [];
    let top = espacio.top;
    for (const caja of ocupadas) {
      const bottom = caja.top - aire;
      if (bottom > top) huecos.push({ top, bottom });
      top = Math.max(top, caja.bottom + aire);
    }
    if (top < espacio.bottom) huecos.push({ top, bottom: espacio.bottom });
    let compacta: Posicion | null = null;
    for (const lado of [preferido, otro] as const) {
      const desdeElControl = lado === 'arriba' ? [...huecos].reverse() : huecos;
      for (const hueco of desdeElControl) {
        const inicio = lado === 'arriba' ? hueco.top : Math.max(hueco.top, objetivo.bottom + separacion);
        const fin = lado === 'arriba' ? Math.min(hueco.bottom, objetivo.top - separacion) : hueco.bottom;
        const maxAlto = fin - inicio;
        if (maxAlto >= alto) {
          return { left, top: lado === 'arriba' ? fin - alto : inicio, lado, maxAlto, centro };
        }
        if (maxAlto >= ALTO_MINIMO && (!compacta || maxAlto > compacta.maxAlto)) {
          compacta = { left, top: inicio, lado, maxAlto, centro, compacta: true };
        }
      }
    }
    return compacta;
  }
  if (lugar[preferido] >= alto) return en(preferido, lugar[preferido]);
  // Si no entra del lado del diseño, va del lado con más lugar: si el otro entra entero, es ése.
  const mejor = lugar[preferido] >= lugar[otro] ? preferido : otro;
  return lugar[mejor] >= ALTO_MINIMO ? en(mejor, lugar[mejor]) : null;
}
