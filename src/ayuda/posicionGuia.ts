export interface Caja { left: number; top: number; right: number; bottom: number }
export interface Posicion { left: number; top: number; lado: 'arriba' | 'abajo' | 'izquierda' | 'derecha' }
const limitar = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
/** Coordenadas físicas de viewport; nunca modifica el objetivo ni el layout de negocio. */
export function posicionGuia(objetivo: Caja, espacio: Caja, ancho: number, alto: number, separacion = 12): Posicion | null {
  if (ancho > espacio.right - espacio.left || alto > espacio.bottom - espacio.top) return null;
  const x = limitar((objetivo.left + objetivo.right - ancho) / 2, espacio.left, espacio.right - ancho);
  const y = limitar((objetivo.top + objetivo.bottom - alto) / 2, espacio.top, espacio.bottom - alto);
  const opciones: Posicion[] = [
    { left: x, top: Math.min(objetivo.top - alto - separacion, espacio.bottom - alto), lado: 'arriba' },
    { left: x, top: Math.max(objetivo.bottom + separacion, espacio.top), lado: 'abajo' },
    { left: Math.min(objetivo.left - ancho - separacion, espacio.right - ancho), top: y, lado: 'izquierda' },
    { left: Math.max(objetivo.right + separacion, espacio.left), top: y, lado: 'derecha' },
  ];
  return opciones.find((p) => p.left >= espacio.left && p.top >= espacio.top && p.left + ancho <= espacio.right && p.top + alto <= espacio.bottom) ?? null;
}
