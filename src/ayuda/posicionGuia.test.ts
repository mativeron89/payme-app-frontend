import { describe, expect, it } from 'vitest';
import { posicionGuia } from './posicionGuia';

describe('D327 · burbuja dentro del espacio útil, fuera del control', () => {
  it('queda encima de la cámara que sobresale de la barra', () => {
    expect(posicionGuia({ left: 165, right: 225, top: 730, bottom: 810 }, { left: 12, right: 378, top: 120, bottom: 718 }, 328, 200))
      .toEqual({ left: 31, top: 518, lado: 'arriba' });
  });
  it('encaja sobre el reparto medido en 390×844 sin invadir cabecera ni opciones', () => {
    const p = posicionGuia({ left: 16, right: 374, top: 363.1875, bottom: 557.75 }, { left: 12, right: 378, top: 162, bottom: 742 }, 328, 184);
    expect(p).toEqual({ left: 31, top: 167.1875, lado: 'arriba' });
  });
  it('elige debajo de un control de la cabecera sin taparlo', () => {
    expect(posicionGuia({ left: 200, right: 320, top: 80, bottom: 130 }, { left: 12, right: 378, top: 138, bottom: 700 }, 328, 200))
      .toEqual({ left: 50, top: 142, lado: 'abajo' });
  });
  it('en horizontal usa el costado cuando no cabe arriba o abajo', () => {
    expect(posicionGuia({ left: 600, right: 800, top: 170, bottom: 230 }, { left: 12, right: 832, top: 120, bottom: 300 }, 420, 150))
      .toEqual({ left: 168, top: 125, lado: 'izquierda' });
  });
  it('devuelve pausa honesta si no existe espacio; nunca solapa por fuerza', () => {
    expect(posicionGuia({ left: 10, right: 360, top: 120, bottom: 400 }, { left: 12, right: 378, top: 120, bottom: 430 }, 328, 200)).toBeNull();
    expect(posicionGuia({ left: 10, right: 40, top: 120, bottom: 150 }, { left: 12, right: 190, top: 120, bottom: 430 }, 328, 200)).toBeNull();
  });
  it('mantiene separación e inclusión en múltiples tamaños y posiciones del viewport', () => {
    for (const width of [375, 390, 430, 844]) for (const top of [0, 150, 300, 650]) {
      const r = { left: width / 2 - 35, right: width / 2 + 35, top, bottom: top + 70 };
      const espacio = { left: 12, right: width - 12, top: 120, bottom: 700 };
      const p = posicionGuia(r, espacio, 320, 200);
      if (p) {
        expect(p.left).toBeGreaterThanOrEqual(espacio.left); expect(p.left + 320).toBeLessThanOrEqual(espacio.right);
        expect(p.top).toBeGreaterThanOrEqual(espacio.top); expect(p.top + 200).toBeLessThanOrEqual(espacio.bottom);
        expect(p.left + 320 <= r.left - 12 || p.left >= r.right + 12 || p.top + 200 <= r.top - 12 || p.top >= r.bottom + 12).toBe(true);
      }
    }
  });
});
