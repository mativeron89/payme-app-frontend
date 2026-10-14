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
 * - y es la pantalla de carga: la franja navy de su barra de estado, los triángulos debajo y el ícono en el centro.
 *
 * Que cada imagen coincida píxel por píxel con la pantalla de carga servida (el build con la CSP real) lo mide
 * `e2e/splash.spec.ts`.
 */
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = join(RAIZ, 'public/arranque');
const INDEX = readFileSync(join(RAIZ, 'index.html'), 'utf8');

/** El navy de la pantalla de carga (`#101e3b`). */
const NAVY = [0x10, 0x1e, 0x3b] as const;

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
   * 🔴 Cada imagen es la pantalla de carga de ESE tamaño (D286): la franja navy mide exactamente la barra de estado (y
   * debajo empieza el triángulo de arriba, oscuro por D330), y el ícono está en el centro de la zona: entre las flechas, navy; la
   * flecha izquierda, cian; la derecha, blanca. Se mide en los píxeles, no en el nombre del archivo.
   */
  for (const d of DISPOSITIVOS) {
    it(`${archivoDe(d)} (${d.ancho}×${d.alto}@${d.dpr}, barra ${d.barra}) es la pantalla de carga`, () => {
      const centroY = d.barra + (d.alto - d.barra) / 2;
      const filas = Math.ceil((centroY + 2) * d.dpr) + 1;
      const png = leerPng(readFileSync(join(DIR, archivoDe(d))), filas);
      const pixel = (x: number, y: number) => {
        const i = (Math.round(y * d.dpr) * png.ancho + Math.round(x * d.dpr)) * 3;
        return [png.pixeles[i]!, png.pixeles[i + 1]!, png.pixeles[i + 2]!];
      };
      // La franja: cada píxel de sus filas, navy.
      const franja = d.barra * d.dpr;
      for (let y = 0; y < franja; y += 1) {
        for (let x = 0; x < png.ancho; x += 1) {
          const i = (y * png.ancho + x) * 3;
          if (png.pixeles[i] !== NAVY[0] || png.pixeles[i + 1] !== NAVY[1] || png.pixeles[i + 2] !== NAVY[2]) {
            throw new Error(`${archivoDe(d)}: la franja no es navy en (${x}, ${y})`);
          }
        }
      }
      // Justo debajo, el triángulo de arriba: el degradado navy de D330.
      const debajo = pixel(d.ancho / 2, d.barra + 1 / d.dpr);
      expect(Math.max(...debajo), `${archivoDe(d)}: debajo de la franja no empieza el triángulo oscuro`).toBeLessThan(110);
      // El ícono, centrado en la zona: entre las flechas, navy; la izquierda (x 46–61 del ícono), cian; la derecha, blanca.
      expect(pixel(d.ancho / 2, centroY), `${archivoDe(d)}: el centro del ícono`).toEqual([...NAVY]);
      expect(pixel(d.ancho / 2 - 10, centroY), `${archivoDe(d)}: la flecha cian`).toEqual([0x0f, 0xb5, 0xc9]);
      expect(pixel(d.ancho / 2 + 24, centroY), `${archivoDe(d)}: la flecha blanca`).toEqual([0xff, 0xff, 0xff]);
    });
  }
});
