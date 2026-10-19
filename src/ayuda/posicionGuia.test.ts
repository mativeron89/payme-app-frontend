import { describe, expect, it } from 'vitest';
import { posicionGuia, SEPARACION_CON_FLECHA, SEPARACION_CON_PUNTA } from './posicionGuia';

const ESPACIO = { left: 16, right: 374, top: 120, bottom: 760 };
const ANCHO = 358;

describe('D363 · la burbuja va arriba o abajo del control, nunca al costado ni encima', () => {
  it('las separaciones de la ficha: anillo de 8 (4 + 2 + 2); flecha de 28 a 4 de cada lado; punta que sobresale 10, a 4', () => {
    expect(SEPARACION_CON_FLECHA).toBe(44);
    expect(SEPARACION_CON_PUNTA).toBe(22);
  });

  it('arriba de Escanear, que sobresale de la barra: la flecha cae en el centro del círculo', () => {
    const escanear = { left: 167, right: 223, top: 754, bottom: 810 };
    const p = posicionGuia(escanear, { ...ESPACIO, bottom: 830 }, ANCHO, 150, 'arriba', SEPARACION_CON_FLECHA);
    expect(p).toEqual({ left: 16, top: 754 - SEPARACION_CON_FLECHA - 150, lado: 'arriba', maxAlto: 754 - SEPARACION_CON_FLECHA - 120, centro: 179 });
  });

  it('2d y 4a van abajo cuando entran', () => {
    const tarjeta = { left: 16, right: 374, top: 206, bottom: 318 };
    const p = posicionGuia(tarjeta, ESPACIO, ANCHO, 140, 'abajo', SEPARACION_CON_PUNTA);
    expect(p).toMatchObject({ lado: 'abajo', top: 318 + SEPARACION_CON_PUNTA });
  });

  it('si no entra del lado del diseño, va del otro', () => {
    const arribaDeTodo = { left: 16, right: 374, top: 130, bottom: 200 };
    expect(posicionGuia(arribaDeTodo, ESPACIO, ANCHO, 140, 'arriba', SEPARACION_CON_PUNTA)).toMatchObject({ lado: 'abajo' });
    const abajoDeTodo = { left: 16, right: 374, top: 700, bottom: 740 };
    expect(posicionGuia(abajoDeTodo, ESPACIO, ANCHO, 140, 'abajo', SEPARACION_CON_PUNTA)).toMatchObject({ lado: 'arriba' });
  });

  it('si no entra entera de ningún lado, va del lado con más lugar y se desplaza adentro; nunca tapa el control', () => {
    const alto = { left: 16, right: 374, top: 300, bottom: 620 };
    const p = posicionGuia(alto, ESPACIO, ANCHO, 400, 'abajo', SEPARACION_CON_PUNTA)!;
    expect(p.lado).toBe('arriba');
    expect(p.maxAlto).toBe(300 - SEPARACION_CON_PUNTA - 120);
    expect(p.top + p.maxAlto).toBeLessThanOrEqual(alto.top - SEPARACION_CON_PUNTA);
    expect(p.top).toBeGreaterThanOrEqual(ESPACIO.top);
  });

  it('con menos de 80 de lugar no hay burbuja: se espera', () => {
    expect(posicionGuia({ left: 16, right: 374, top: 150, bottom: 720 }, ESPACIO, ANCHO, 200, 'arriba', SEPARACION_CON_PUNTA)).toBeNull();
    expect(posicionGuia({ left: 16, right: 374, top: 300, bottom: 400 }, { ...ESPACIO, right: 200 }, ANCHO, 100, 'arriba', 10)).toBeNull();
  });

  it('la punta y la flecha quedan a 24 o más de una esquina, aunque el control esté en el borde', () => {
    const izquierda = posicionGuia({ left: 0, right: 20, top: 600, bottom: 640 }, ESPACIO, ANCHO, 100, 'arriba', 10)!;
    const derecha = posicionGuia({ left: 370, right: 390, top: 600, bottom: 640 }, ESPACIO, ANCHO, 100, 'arriba', 10)!;
    expect(izquierda.centro).toBe(24);
    expect(derecha.centro).toBe(ANCHO - 24);
  });

  it('en 375 y 390 de ancho y en cualquier altura, queda dentro del espacio y fuera del control', () => {
    for (const ancho of [375, 390]) for (const top of [140, 300, 500, 700]) {
      const espacio = { left: 16, right: ancho - 16, top: 120, bottom: 760 };
      const r = { left: ancho / 2 - 28, right: ancho / 2 + 28, top, bottom: top + 56 };
      const p = posicionGuia(r, espacio, ancho - 32, 160, 'arriba', SEPARACION_CON_FLECHA);
      if (!p) continue;
      const alto = Math.min(160, p.maxAlto);
      expect(p.left).toBeGreaterThanOrEqual(espacio.left);
      expect(p.left + ancho - 32).toBeLessThanOrEqual(espacio.right);
      expect(p.top).toBeGreaterThanOrEqual(espacio.top);
      expect(p.top + alto).toBeLessThanOrEqual(espacio.bottom);
      expect(p.top + alto <= r.top - SEPARACION_CON_FLECHA || p.top >= r.bottom + SEPARACION_CON_FLECHA).toBe(true);
    }
  });
});
