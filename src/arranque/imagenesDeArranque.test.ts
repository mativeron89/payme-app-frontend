import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DISPOSITIVOS, archivoDe, hrefDe, leerPng, mediaDe } from '../../scripts/imagenes-de-arranque.mjs';

/**
 * 🔴 D300 · las imágenes de arranque del iPhone. Mati vio la app instalada abrir en negro antes de la pantalla de carga:
 * iOS muestra la imagen de arranque del tamaño del teléfono hasta que la página pinta, y no había ninguna.
 *
 * Lo que fija este archivo, desde la tabla del generador (`scripts/imagenes-de-arranque.mjs`), que es la única fuente:
 * - un `<link rel="apple-touch-startup-image">` por tamaño, con su `media` y su `href`, y ninguno más;
 * - `public/arranque/` tiene exactamente esas imágenes;
 * - cada una mide lo del iPhone en píxeles, es RGB opaca y pesa lo declarado;
 * - y es la pantalla de carga (D475) sin la palabra (D476, opción A): la franja navy lisa de su barra de estado y, debajo,
 *   las dos puntas teal en esquinas opuestas y el centro navy.
 *
 * Que cada imagen coincida píxel por píxel con la pantalla de carga servida (el build con la CSP real) lo mide
 * `e2e/splash.spec.ts`.
 */
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = join(RAIZ, 'public/arranque');
const INDEX = readFileSync(join(RAIZ, 'index.html'), 'utf8');

/** El navy de la pantalla de carga (`#101e3b`). */
const NAVY = [0x10, 0x1e, 0x3b] as const;
/** El teal donde nace el degradé de cada punta (`#0a7b80`). */
const TEAL = [0x0a, 0x7b, 0x80] as const;

/** El peso máximo de cada imagen y de todas juntas (medido: la mayor, 440×956@3, pesa 1.076.189 bytes). */
const PESO_MAXIMO = 1_200_000;
const PESO_TOTAL_MAXIMO = 10_500_000;

describe('🔴 D300 · las imágenes de arranque del iPhone', () => {
  it('la tabla: once tamaños en vertical, sin repetir tamaño ni archivo', () => {
    expect(DISPOSITIVOS).toHaveLength(11);
    const tamanos = DISPOSITIVOS.map((d) => `${d.ancho}x${d.alto}@${d.dpr}`);
    expect(new Set(tamanos).size).toBe(DISPOSITIVOS.length);
    expect(new Set(DISPOSITIVOS.map(archivoDe)).size).toBe(DISPOSITIVOS.length);
    for (const d of DISPOSITIVOS) {
      expect(d.alto, archivoDe(d)).toBeGreaterThan(d.ancho);
      expect([2, 3], archivoDe(d)).toContain(d.dpr);
      expect(d.barra, archivoDe(d)).toBeGreaterThanOrEqual(20);
      expect(d.barra, archivoDe(d)).toBeLessThan(80);
    }
    // El iPhone de hoy más común y el más grande, con el archivo y el media que iOS espera.
    const de390 = DISPOSITIVOS.find((d) => d.ancho === 390 && d.alto === 844)!;
    expect(archivoDe(de390)).toBe('arranque-1170x2532.png');
    expect(mediaDe(de390)).toBe('(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)');
    expect(hrefDe(de390)).toBe('/arranque/arranque-1170x2532.png');
  });

  it('🔴 index.html: un `<link rel="apple-touch-startup-image">` por tamaño, con su media y su href, y ninguno más', () => {
    const efectivo = INDEX.replace(/<!--[\s\S]*?-->/g, '');
    const links = [...efectivo.matchAll(/<link\b[^>]*rel="apple-touch-startup-image"[^>]*>/g)].map((m) => m[0]);
    expect(links).toEqual(DISPOSITIVOS.map((d) => `<link rel="apple-touch-startup-image" media="${mediaDe(d)}" href="${hrefDe(d)}" />`));
    // Ninguna otra forma de nombrarlas (otro orden de atributos, comillas simples).
    expect(efectivo.match(/apple-touch-startup-image/g)).toHaveLength(DISPOSITIVOS.length);
    // En el <head>, antes del <style> de la pantalla de carga.
    const head = efectivo.slice(0, efectivo.indexOf('</head>'));
    expect(head.match(/apple-touch-startup-image/g)).toHaveLength(DISPOSITIVOS.length);
  });

  it('🔴 censo de `public/arranque/`: exactamente las de la tabla', () => {
    expect(readdirSync(DIR).sort()).toEqual(DISPOSITIVOS.map(archivoDe).sort());
  });

  it('cada una mide lo del iPhone en píxeles, RGB opaca, y pesa lo declarado', () => {
    let total = 0;
    for (const d of DISPOSITIVOS) {
      const bytes = readFileSync(join(DIR, archivoDe(d)));
      const png = leerPng(bytes, 1);
      expect([png.ancho, png.alto], archivoDe(d)).toEqual([d.ancho * d.dpr, d.alto * d.dpr]);
      expect(png.canales, archivoDe(d)).toBe(3);
      const peso = statSync(join(DIR, archivoDe(d))).size;
      expect(peso, archivoDe(d)).toBeLessThanOrEqual(PESO_MAXIMO);
      total += peso;
    }
    expect(total).toBeLessThanOrEqual(PESO_TOTAL_MAXIMO);
  });

  /**
   * 🔴 Cada imagen es la pantalla de carga de ESE tamaño (D475), sin la palabra (D476, opción A: la palabra entra en la
   * página con su fundido). La barra de estado, una franja navy lisa (D476 enmienda D353: la punta ya no sube detrás); justo
   * debajo, en la esquina de arriba a la izquierda, la punta de arriba; en la esquina de abajo a la derecha, la de abajo;
   * las otras dos esquinas y el centro de la zona, navy. Se mide en los píxeles, no en el nombre del archivo.
   */
  for (const d of DISPOSITIVOS) {
    it(`${archivoDe(d)} (${d.ancho}×${d.alto}@${d.dpr}, barra ${d.barra}) es la pantalla de carga, sin la palabra`, () => {
      const png = leerPng(readFileSync(join(DIR, archivoDe(d))));
      const pixel = (x: number, y: number) => {
        const i = (Math.round(y * d.dpr) * png.ancho + Math.round(x * d.dpr)) * 3;
        return [png.pixeles[i]!, png.pixeles[i + 1]!, png.pixeles[i + 2]!];
      };
      const cerca = (p: number[], c: readonly number[], tol: number) => p.every((v, k) => Math.abs(v - c[k]!) <= tol);
      // La barra: cada píxel de sus filas, navy liso.
      const franja = d.barra * d.dpr;
      for (let y = 0; y < franja; y += 1) {
        for (let x = 0; x < png.ancho; x += 1) {
          const i = (y * png.ancho + x) * 3;
          if (png.pixeles[i] !== NAVY[0] || png.pixeles[i + 1] !== NAVY[1] || png.pixeles[i + 2] !== NAVY[2]) {
            throw new Error(`${archivoDe(d)}: la barra no es navy lisa en (${x}, ${y})`);
          }
        }
      }
      // La punta de arriba empieza debajo de la barra, en la esquina de la zona: teal (el degradé recién arranca).
      expect(cerca(pixel(2, d.barra + 2), TEAL, 12), `${archivoDe(d)}: no está la punta de arriba (${pixel(2, d.barra + 2)})`).toBe(true);
      // La de abajo, en la esquina opuesta.
      expect(cerca(pixel(d.ancho - 2, d.alto - 2), TEAL, 12), `${archivoDe(d)}: no está la punta de abajo (${pixel(d.ancho - 2, d.alto - 2)})`).toBe(true);
      // Las otras dos esquinas de la zona, navy: son dos puntas, no cuatro triángulos.
      expect(pixel(d.ancho - 2, d.barra + 2), `${archivoDe(d)}: la esquina de arriba a la derecha`).toEqual([...NAVY]);
      expect(pixel(2, d.alto - 2), `${archivoDe(d)}: la esquina de abajo a la izquierda`).toEqual([...NAVY]);
      // 🔴 D476 · sin la palabra: el centro de la zona y el lugar de «Pay» (blanco) y «Me» (cian), navy.
      const centroY = d.barra + (d.alto - d.barra) / 2;
      for (const dx of [-40, -20, 0, 20, 40]) {
        expect(pixel(d.ancho / 2 + dx, centroY), `${archivoDe(d)}: la palabra está en la imagen (x ${dx})`).toEqual([...NAVY]);
      }
    });
  }
});
