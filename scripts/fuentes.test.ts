import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 🔴 `D-FUENTES-1` · QUE LA PROCEDENCIA NO SE PUDRA.
 *
 * `src/assets/fonts/README.md` publica el SHA-256 de cada binario descargado.
 * Ese dato es el único que ata los archivos del repo a un commit concreto de
 * `github.com/google/fonts` — y **es exactamente la clase de dato que ningún
 * gate mira**: nadie lo re-verifica al leerlo, así que si alguien reemplaza un
 * `.ttf` la tabla sigue ahí, con la misma cara de verdad, mintiendo.
 *
 * Este archivo la vuelve verificable. La tabla del README deja de ser
 * documentación y pasa a ser una afirmación que se puede poner en rojo.
 *
 * ## Y por qué también se mira el CSS
 *
 * Un `url(...)` mal escrito en un `@font-face` **no rompe nada visible**: el
 * navegador no encuentra el archivo, cae al fallback de sistema y la pantalla
 * se ve casi igual. Es el modo de falla más caro de este cambio, porque nadie
 * lo nota. Acá se resuelve cada ruta contra el disco.
 */

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..');

const sha256 = (ruta: string): string =>
  createHash('sha256').update(readFileSync(ruta)).digest('hex');

/**
 * Las filas de la tabla `| origen | destino | sha |` del README, parseadas.
 *
 * Se lee el README en vez de repetir los hashes acá: si estuvieran duplicados,
 * el test verificaría su propia copia y el documento podría envejecer solo.
 */
function filasDelReadme(): Array<{ destino: string; sha: string }> {
  const md = readFileSync(join(RAIZ, 'src/assets/fonts/README.md'), 'utf8');
  return [...md.matchAll(/^\|\s*`[^`]+`\s*\|\s*`([^`]+)`\s*\|\s*`([0-9a-f]{64})`\s*\|$/gm)].map(
    (m) => ({ destino: m[1]!, sha: m[2]! }),
  );
}

describe('la procedencia de las tipografías es verificable, no declarativa', () => {
  it('🔴 el README publica una tabla de hashes y se puede leer', () => {
    // Sonda del parser. Si el formato de la tabla cambiara, `filas` quedaría
    // vacío y TODAS las afirmaciones de abajo pasarían en vacío — que es la
    // forma más común de que una guarda quede verde sin verificar nada.
    const filas = filasDelReadme();
    expect(filas.length, 'no se parseó ninguna fila de la tabla del README').toBe(4);
    expect(filas.map((f) => f.destino).sort()).toEqual([
      'DMSans-variable.ttf',
      'OFL-DMSans.txt',
      'OFL-PlusJakartaSans.txt',
      'PlusJakartaSans-variable.ttf',
    ]);
  });

  it('🔴 cada archivo del repo tiene el SHA-256 que el README dice', () => {
    const desvios: string[] = [];
    for (const { destino, sha } of filasDelReadme()) {
      const ruta = join(RAIZ, 'src/assets/fonts', destino);
      if (!existsSync(ruta)) {
        desvios.push(`${destino}: NO EXISTE`);
        continue;
      }
      const real = sha256(ruta);
      if (real !== sha) desvios.push(`${destino}: README dice ${sha.slice(0, 12)}…, el archivo es ${real.slice(0, 12)}…`);
    }
    expect(desvios, `procedencia rota: ${desvios.join(' · ')}`).toEqual([]);
  });

  it('🔴 las dos copias de Plus Jakarta Sans son byte-idénticas', () => {
    // Duplicadas a propósito —`D-WEB-1-BIS`: la landing es otro ORIGEN— y por
    // eso necesitan comparador: dos copias sin gate es como nace la deriva.
    const webapp = sha256(join(RAIZ, 'src/assets/fonts/PlusJakartaSans-variable.ttf'));
    const landing = sha256(join(RAIZ, 'landing/fonts/PlusJakartaSans-variable.ttf'));
    expect(landing, `webapp ${webapp.slice(0, 12)}… ≠ landing ${landing.slice(0, 12)}…`).toBe(webapp);
  });

  it('🔴 las dos licencias OFL están completas y con su aviso de copyright', () => {
    for (const archivo of ['OFL-PlusJakartaSans.txt', 'OFL-DMSans.txt']) {
      const texto = readFileSync(join(RAIZ, 'src/assets/fonts', archivo), 'utf8');
      expect(texto, `${archivo} sin aviso de copyright`).toMatch(/^Copyright \d{4} The .+ Project Authors/);
      // Las cinco condiciones y el disclaimer: que sea el texto ENTERO, no un
      // resumen. Recortar una licencia es incumplirla.
      expect(texto, `${archivo} no parece la OFL completa`).toContain('SIL OPEN FONT LICENSE Version 1.1');
      for (const clausula of ['1)', '2)', '3)', '4)', '5)']) {
        expect(texto, `${archivo} sin la cláusula ${clausula}`).toContain(clausula);
      }
      expect(texto).toContain('TERMINATION');
      expect(texto).toContain('DISCLAIMER');
    }
  });

  it('🔴 ninguna familia declara Reserved Font Name (y si un día lo hace, se entera acá)', () => {
    // La OFL define el RFN como "any names specified as such AFTER the
    // copyright statement(s)". Sin RFN, la cláusula 3 no tiene objeto; con
    // RFN, convertir el formato dejaría de poder conservar el nombre. El día
    // que se actualice una fuente y el upstream agregue uno, esto lo grita.
    for (const archivo of ['OFL-PlusJakartaSans.txt', 'OFL-DMSans.txt']) {
      const primera = readFileSync(join(RAIZ, 'src/assets/fonts', archivo), 'utf8')
        .split(/\r?\n/)[0]!;
      expect(primera.toLowerCase(), `${archivo} ahora declara un Reserved Font Name: ${primera}`)
        .not.toContain('reserved font name');
    }
  });
});

describe('los `@font-face` apuntan a archivos que existen', () => {
  /**
   * El modo de falla que esto ataca: un `url(...)` con un typo no rompe nada
   * visible. El navegador cae al fallback y la pantalla se ve casi igual.
   */
  const HOJAS = [
    { css: 'src/styles/global.css', esperadas: 2 },
    { css: 'landing/landing.css', esperadas: 1 },
  ] as const;

  for (const { css, esperadas } of HOJAS) {
    it(`🔴 ${css}: cada ruta resuelve contra el disco`, () => {
      const ruta = join(RAIZ, css);
      const texto = readFileSync(ruta, 'utf8');
      const caras = [...texto.matchAll(/@font-face\s*\{[^}]*\}/g)].map((m) => m[0]);
      expect(caras.length, `${css} no declara los @font-face esperados`).toBe(esperadas);

      const rotas: string[] = [];
      for (const cara of caras) {
        const url = cara.match(/url\(\s*['"]?([^'")]+)['"]?\s*\)/)?.[1];
        if (!url) {
          rotas.push(`un @font-face sin url(): ${cara.slice(0, 60)}…`);
          continue;
        }
        const destino = resolve(dirname(ruta), url);
        if (!existsSync(destino)) rotas.push(`${url} → no existe`);
      }
      expect(rotas, `rutas rotas en ${css}: ${rotas.join(' · ')}`).toEqual([]);
    });
  }

  it('🔴 `.gitattributes` protege los bytes de los binarios', () => {
    // Un TTF con conversión de fin de línea es un TTF corrupto, y las OFL
    // vienen con CRLF del upstream. Sin esto, un clon en una máquina con
    // `core.autocrlf` rompería los hashes de arriba — y el síntoma aparecería
    // muy lejos de la causa.
    const attrs = readFileSync(join(RAIZ, '.gitattributes'), 'utf8');
    expect(attrs, 'los .ttf no están marcados como binarios').toMatch(/^\*\.ttf\s+binary$/m);
    expect(attrs, 'las OFL no están protegidas de la conversión de fin de línea')
      .toMatch(/OFL-\*\.txt\s+-text/);
  });
});
