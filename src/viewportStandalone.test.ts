import { describe, expect, it } from 'vitest';
import { altoCorregido, type MedidaViewport } from './viewportStandalone';

/**
 * E173-2 · la decisión de cuándo corregir el alto de `.app` en la app de inicio
 * de iOS. Los números son de iPhone en puntos CSS: 393×852 (15 Pro, inset
 * superior 59) y 430×932 (Pro Max, el caso de 59 px que documenta el defecto).
 */
const IPHONE_ACHICADO: MedidaViewport = {
  standalone: true,
  innerHeight: 852 - 59,
  screenWidth: 393,
  screenHeight: 852,
  vertical: true,
  insetSuperior: 59,
};

describe('E173-2 · altoCorregido', () => {
  it('🔴 app de inicio, viewport achicado en el inset superior: impone el alto de la pantalla', () => {
    expect(altoCorregido(IPHONE_ACHICADO)).toBe(852);
    expect(altoCorregido({ ...IPHONE_ACHICADO, screenWidth: 430, screenHeight: 932, innerHeight: 873 })).toBe(932);
  });

  it('tolera el redondeo de WebKit (±4 px) entre el faltante y el inset', () => {
    expect(altoCorregido({ ...IPHONE_ACHICADO, innerHeight: 852 - 57 })).toBe(852);
    expect(altoCorregido({ ...IPHONE_ACHICADO, innerHeight: 852 - 63 })).toBe(852);
    expect(altoCorregido({ ...IPHONE_ACHICADO, innerHeight: 852 - 64 })).toBeNull();
  });

  it('viewport sano: no corrige', () => {
    expect(altoCorregido({ ...IPHONE_ACHICADO, innerHeight: 852 })).toBeNull();
    expect(altoCorregido({ ...IPHONE_ACHICADO, innerHeight: 850 })).toBeNull();
  });

  it('🔴 Safari (no standalone): no corrige aunque el faltante coincida', () => {
    expect(altoCorregido({ ...IPHONE_ACHICADO, standalone: false })).toBeNull();
  });

  it('sin inset superior (horizontal, o un teléfono sin muesca): no corrige', () => {
    expect(altoCorregido({ ...IPHONE_ACHICADO, insetSuperior: 0 })).toBeNull();
    expect(altoCorregido({ ...IPHONE_ACHICADO, insetSuperior: Number.NaN })).toBeNull();
  });

  it('una ventana de iPad más chica a propósito: el faltante no es el inset, no corrige', () => {
    expect(altoCorregido({
      standalone: true, innerHeight: 700, screenWidth: 1024, screenHeight: 1366, vertical: true, insetSuperior: 24,
    })).toBeNull();
  });

  it('en horizontal toma el lado corto de la pantalla', () => {
    expect(altoCorregido({
      standalone: true, innerHeight: 393 - 20, screenWidth: 393, screenHeight: 852, vertical: false, insetSuperior: 20,
    })).toBe(393);
  });

  it('medidas sin sentido no corrigen', () => {
    expect(altoCorregido({ ...IPHONE_ACHICADO, screenWidth: 0, screenHeight: 0 })).toBeNull();
    expect(altoCorregido({ ...IPHONE_ACHICADO, innerHeight: 0 })).toBeNull();
  });
});
