import { describe, expect, it } from 'vitest';
import {
  aGris,
  analizarMuestra,
  detectarBorde,
  estimarInclinacion,
  evaluarFoto,
  nitidez,
  realzarPapel,
  UMBRALES_DE_AVISO,
  type Gris,
} from './mejoraDeFoto';

/**
 * D509 · n322 · la foto mejor antes de enviarla, con fotos SINTÉTICAS: un
 * ticket de papel claro con renglones de «texto» oscuro sobre un fondo, que se
 * puede girar, oscurecer, quemar o borronear. Nada sale a la red.
 */

interface Ticket {
  ancho?: number;
  alto?: number;
  /** El papel, en proporciones de la imagen. */
  papel?: { x0: number; y0: number; x1: number; y1: number };
  /** Grados de giro del papel (positivo: los renglones bajan a la derecha). */
  giro?: number;
  fondo?: number;
  claro?: number;
  tinta?: number;
  /** Fracción de píxeles del papel que salen como tinta suelta (manchas, puntos), con semilla fija. */
  ruido?: number;
  semilla?: number;
}

/** Un generador congruencial con semilla: el mismo «ruido» en cada corrida. */
function aleatorio(semilla: number): () => number {
  let s = semilla >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Un ticket sintético en gris. Los renglones son trazos cortados, como palabras. */
function ticket({
  ancho = 300, alto = 400, papel = { x0: 0.25, y0: 0.1, x1: 0.75, y1: 0.9 }, giro = 0, fondo = 40, claro = 235, tinta = 30,
  ruido = 0, semilla = 1,
}: Ticket = {}): Gris {
  const datos = new Float32Array(ancho * alto);
  const azar = aleatorio(semilla);
  const cx = ((papel.x0 + papel.x1) / 2) * ancho;
  const cy = ((papel.y0 + papel.y1) / 2) * alto;
  const rad = (giro * Math.PI) / 180;
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      // Las coordenadas del papel SIN girar (se gira el papel, no la cámara).
      const dx = x - cx;
      const dy = y - cy;
      const px = dx * Math.cos(rad) + dy * Math.sin(rad) + cx;
      const py = -dx * Math.sin(rad) + dy * Math.cos(rad) + cy;
      const dentro = px >= papel.x0 * ancho && px < papel.x1 * ancho && py >= papel.y0 * alto && py < papel.y1 * alto;
      let v = fondo;
      if (dentro) {
        v = claro;
        const fila = py - papel.y0 * alto;
        const col = px - papel.x0 * ancho;
        // Un renglón cada 12 px, de 3 px de alto, con palabras de 14 px y espacios de 5.
        const enRenglon = fila % 12 >= 4 && fila % 12 < 7 && fila > 8 && fila < (papel.y1 - papel.y0) * alto - 8;
        const enPalabra = col % 19 < 14 && col > 6 && col < (papel.x1 - papel.x0) * ancho - 6;
        if (enRenglon && enPalabra) v = tinta;
        if (ruido > 0 && azar() < ruido) v = tinta;
      }
      datos[y * ancho + x] = v;
    }
  }
  return { ancho, alto, datos };
}

/** Un desenfoque de caja de radio `r`, para simular la foto movida. */
function borronear(g: Gris, r: number): Gris {
  const out = new Float32Array(g.datos.length);
  for (let y = 0; y < g.alto; y++) {
    for (let x = 0; x < g.ancho; x++) {
      let s = 0; let n = 0;
      for (let yy = Math.max(0, y - r); yy <= Math.min(g.alto - 1, y + r); yy++) {
        for (let xx = Math.max(0, x - r); xx <= Math.min(g.ancho - 1, x + r); xx++) {
          s += g.datos[yy * g.ancho + xx]!; n++;
        }
      }
      out[y * g.ancho + x] = s / n;
    }
  }
  return { ...g, datos: out };
}

function aRgba(g: Gris): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(g.datos.length * 4);
  for (let i = 0; i < g.datos.length; i++) {
    rgba[i * 4] = g.datos[i]!; rgba[i * 4 + 1] = g.datos[i]!; rgba[i * 4 + 2] = g.datos[i]!; rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

describe('D509 · 1 · el borde del ticket', () => {
  it('🔴 encuentra el papel sobre un fondo oscuro, con un margen chico, sin cortarlo', () => {
    const m = detectarBorde(ticket());
    expect(m).not.toBeNull();
    // El papel va de 0.25 a 0.75 y de 0.1 a 0.9: el marco lo contiene entero, con poco margen.
    expect(m!.x0).toBeLessThanOrEqual(0.25); expect(m!.x0).toBeGreaterThan(0.2);
    expect(m!.x1).toBeGreaterThanOrEqual(0.75); expect(m!.x1).toBeLessThan(0.8);
    expect(m!.y0).toBeLessThanOrEqual(0.1); expect(m!.y0).toBeGreaterThan(0.05);
    expect(m!.y1).toBeGreaterThanOrEqual(0.9); expect(m!.y1).toBeLessThan(0.95);
  });

  it('🔴 no adivina: sin un papel claro y separado del fondo, `null` (el marco arranca entero)', () => {
    // El papel ocupa casi toda la foto: no hay nada que recortar.
    expect(detectarBorde(ticket({ papel: { x0: 0.02, y0: 0.02, x1: 0.98, y1: 0.98 } }))).toBeNull();
    // Poco contraste entre papel y fondo (una mesa clara).
    expect(detectarBorde(ticket({ fondo: 190, claro: 235 }))).toBeNull();
    // Todo del mismo gris.
    expect(detectarBorde({ ancho: 100, alto: 100, datos: new Float32Array(10000).fill(120) })).toBeNull();
    // Un papel diminuto: no es el ticket.
    expect(detectarBorde(ticket({ papel: { x0: 0.45, y0: 0.45, x1: 0.55, y1: 0.55 } }))).toBeNull();
  });
});

describe('D509 · 1c · una zona clara lisa no es un ticket', () => {
  it('🔴 media foto blanca sin nada impreso, sobre azul: no hay marco', () => {
    const W = 120; const H = 160;
    const rgba = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      const blanco = Math.floor(i / W) < H / 2;
      rgba[i * 4] = blanco ? 255 : 10; rgba[i * 4 + 1] = blanco ? 255 : 10; rgba[i * 4 + 2] = 255; rgba[i * 4 + 3] = 255;
    }
    expect(detectarBorde(aGris(rgba, W, H), rgba)).toBeNull();
  });
});

describe('D509 · 1b · las puntas oscuras del ticket no se cortan', () => {
  it('🔴 un ticket con franjas de color arriba y abajo (oscuras en gris): la caja las incluye', () => {
    const W = 384; const H = 512; const sx = W / 1200; const sy = H / 1600;
    const rgba = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const X = x / sx; const Y = y / sy;
        let c = [0x8b, 0x5a, 0x2b];
        if (X >= 390 && X < 810 && Y >= 100 && Y < 1500) {
          c = [0xf4, 0xf4, 0xf4];
          if (Y < 100 + 112) c = [0, 0, 255];
          else if (Y >= 1500 - 112) c = [0, 0xc0, 0];
          else if (Y % 44 < 8 && X >= 430 && X < 700) c = [0x22, 0x22, 0x22]; // lo impreso
        }
        const i = (y * W + x) * 4; rgba[i] = c[0]!; rgba[i + 1] = c[1]!; rgba[i + 2] = c[2]!; rgba[i + 3] = 255;
      }
    }
    const m = detectarBorde(aGris(rgba, W, H), rgba)!;
    expect(m.y0).toBeLessThanOrEqual(100 / 1600);
    expect(m.y1).toBeGreaterThanOrEqual(1500 / 1600);
    expect(m.x0).toBeLessThanOrEqual(390 / 1200);
    expect(m.x1).toBeGreaterThanOrEqual(810 / 1200);
    // Y no se va mucho más allá del margen.
    expect(m.y0).toBeGreaterThan(100 / 1600 - 0.03);
    expect(m.x0).toBeGreaterThan(390 / 1200 - 0.03);
  });
});

describe('D509 · 2 · el enderezado', () => {
  it.each([3, -4, 6, -6.5])('🔴 mide un giro de %d° (±0.5°)', (grados) => {
    const g = ticket({ giro: grados });
    expect(Math.abs(estimarInclinacion(g) - grados)).toBeLessThanOrEqual(0.5);
  });

  it('un ticket derecho (o casi) no se gira: menos de 1° es 0', () => {
    expect(estimarInclinacion(ticket())).toBe(0);
    expect(estimarInclinacion(ticket({ giro: 0.4 }))).toBe(0);
  });

  /**
   * O1 (auditoría PR105) · la guarda del 15 %: con el texto casi recto, un ángulo de 1° puede dar un perfil apenas
   * mejor que dejarla como está, y eso no alcanza para girar. Sin la guarda, estos casos se giraban 1° (medido con
   * la guarda quitada); con ella, 0. Las semillas fijan el ruido: cada corrida es la misma foto.
   */
  it.each([
    { nombre: '0,5° sin ruido', giro: 0.5, ruido: 0, semilla: 1 },
    { nombre: '0,8° con manchas', giro: 0.8, ruido: 0.005, semilla: 13 },
    { nombre: '0,7° con manchas', giro: 0.7, ruido: 0.002, semilla: 13 },
  ])('🔴 O1 · texto casi recto ($nombre): una mejora marginal no gira, 0', ({ nombre: _nombre, ...caso }) => {
    expect(estimarInclinacion(ticket(caso))).toBe(0);
  });

  it('sin texto no hay renglones: 0', () => {
    expect(estimarInclinacion(ticket({ tinta: 235 }))).toBe(0);
  });

  it('el análisis devuelve el giro CONTRARIO, para enderezarla al codificar', () => {
    const g = ticket({ giro: 5 });
    const a = analizarMuestra(aRgba(g), g.ancho, g.alto);
    expect(a.giro).toBeLessThan(-4);
    expect(a.giro).toBeGreaterThan(-6);
  });
});

describe('D509 · 3 · el contraste para papel térmico', () => {
  it('🔴 gris y niveles estirados: el papel desteñido gana rango', () => {
    // Papel gris claro (180) con tinta gris (120): poco rango.
    const g = ticket({ fondo: 150, claro: 180, tinta: 120 });
    const rgba = aRgba(g);
    // Un tinte de color en un píxel, para ver que queda gris.
    rgba[0] = 200; rgba[1] = 100; rgba[2] = 50;
    realzarPapel(rgba);
    let min = 255; let max = 0;
    for (let i = 0; i < rgba.length; i += 4) {
      expect(rgba[i]).toBe(rgba[i + 1]);
      expect(rgba[i]).toBe(rgba[i + 2]);
      min = Math.min(min, rgba[i]!); max = Math.max(max, rgba[i]!);
    }
    expect(max - min).toBeGreaterThan(200);
  });

  it('🔴 el análisis pide el realce sólo con el papel desteñido; con buen contraste, la foto va como está', () => {
    const desteñido = ticket({ fondo: 150, claro: 185, tinta: 130 });
    expect(analizarMuestra(aRgba(desteñido), desteñido.ancho, desteñido.alto).realzar).toBe(true);
    const nitido = ticket();
    expect(analizarMuestra(aRgba(nitido), nitido.ancho, nitido.alto).realzar).toBe(false);
    // Algo de color oscuro (rojo y azul) tiene poco rango de brillo pero no es papel: no se pasa a gris.
    const color = new Uint8ClampedArray(100 * 100 * 4);
    for (let i = 0; i < 10000; i++) {
      const rojo = (i % 100) < 50;
      color[i * 4] = rojo ? 255 : 0; color[i * 4 + 1] = 0; color[i * 4 + 2] = rojo ? 0 : 255; color[i * 4 + 3] = 255;
    }
    expect(analizarMuestra(color, 100, 100).realzar).toBe(false);
  });

  it('con buen rango sólo pasa a gris (no binariza ni satura de más)', () => {
    const rgba = new Uint8ClampedArray([0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255]);
    realzarPapel(rgba);
    expect([...rgba]).toEqual([0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255]);
  });
});

describe('D509 · 4 · el aviso de foco y luz (nunca bloquea)', () => {
  it('🔴 un ticket nítido y con luz: ningún aviso', () => {
    expect(evaluarFoto(ticket())).toEqual({ oscura: false, quemada: false, movida: false });
  });

  it('🔴 movida: la nitidez cae por debajo del umbral', () => {
    const nitida = ticket();
    const movida = borronear(nitida, 3);
    expect(nitidez(nitida)).toBeGreaterThan(nitidez(movida) * 10);
    expect(evaluarFoto(movida).movida).toBe(true);
    // Un desenfoque leve (radio 1) no avisa: el umbral es conservador.
    expect(evaluarFoto(borronear(nitida, 1)).movida).toBe(false);
    expect(UMBRALES_DE_AVISO.movida).toBeGreaterThan(0);
  });

  it('🔴 oscura: poca luz (y entonces no se avisa «movida» además)', () => {
    const a = evaluarFoto(borronear(ticket({ fondo: 10, claro: 50, tinta: 5 }), 3));
    expect(a.oscura).toBe(true);
    expect(a.movida).toBe(false);
  });

  it('🔴 quemada: casi todo blanco puro', () => {
    expect(evaluarFoto(ticket({ fondo: 255, claro: 255, tinta: 200 })).quemada).toBe(true);
  });

  it('la luminancia sale del RGBA', () => {
    const g = aGris([255, 0, 0, 255, 0, 255, 0, 255], 2, 1);
    expect(Math.round(g.datos[0]!)).toBe(76);
    expect(Math.round(g.datos[1]!)).toBe(150);
  });

  it('una muestra inválida no rompe nada: sin análisis', () => {
    expect(analizarMuestra([], 0, 0).marco).toBeNull();
    expect(analizarMuestra(new Uint8ClampedArray(10), 10, 10).giro).toBe(0);
  });
});
