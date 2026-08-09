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
/**
 * Dónde vive cada archivo de la tabla. Los binarios están junto al código que
 * los referencia; **las licencias viven en `public/` porque tienen que VIAJAR
 * con el artefacto** — la cláusula 2 de la OFL pide el aviso y la licencia en
 * cada copia distribuida, y `public/` es lo único que Vite emite sin que nadie
 * lo referencie. Que estén emitidas lo verifica `scripts/artefactos.test.ts`
 * sobre el build; acá sólo se verifica su contenido.
 */
const ubicacionDe = (destino: string): string =>
  destino.startsWith('OFL-') ? 'public/fonts' : 'src/assets/fonts';

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
      const ruta = join(RAIZ, ubicacionDe(destino), destino);
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
      const texto = readFileSync(join(RAIZ, 'public/fonts', archivo), 'utf8');
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

  /**
   * 🔴 RESERVED FONT NAMES · sobre TODO el texto, no sobre la primera línea.
   *
   * La versión anterior de este test leía **la línea 1** y nada más. Era la
   * misma falla que este repo viene cazando toda la semana: la conclusión
   * —"ninguna familia declara RFN"— más ancha que el instrumento —"la primera
   * línea no lo dice"—.
   *
   * Y no era teórica: la OFL define el RFN como *"any names specified as such
   * **after the copyright statement(s)**"*, en plural. **Una licencia puede
   * tener varios avisos de copyright, en cualquier parte del archivo**, y el
   * RFN puede colgar de cualquiera de ellos.
   *
   * ## Por qué no alcanza con buscar la frase suelta
   *
   * El texto de CUALQUIER OFL contiene "Reserved Font Name" al menos dos
   * veces: en las definiciones y en la cláusula 3. Un `includes()` daría
   * siempre positivo. Lo que se busca es la frase **colgando de un aviso de
   * copyright**, que es donde la licencia dice que se declara.
   */
  const avisosDeCopyright = (texto: string): string[] =>
    texto.split(/\r?\n/).filter((l) => /^\s*Copyright\b/i.test(l));

  const declaraRFN = (texto: string): boolean =>
    avisosDeCopyright(texto).some((l) => /reserved font name/i.test(l));

  it('🔴 ninguna familia declara Reserved Font Name — leyendo el texto ENTERO', () => {
    for (const archivo of ['OFL-PlusJakartaSans.txt', 'OFL-DMSans.txt']) {
      const texto = readFileSync(join(RAIZ, 'public/fonts', archivo), 'utf8');
      // Sonda: si el detector de avisos dejara de encontrar ninguno, la
      // afirmación de abajo pasaría en vacío para siempre.
      expect(avisosDeCopyright(texto).length, `${archivo}: no se encontró ningún aviso de copyright`)
        .toBeGreaterThan(0);
      expect(declaraRFN(texto), `${archivo} ahora declara un Reserved Font Name`).toBe(false);
    }
  });

  it('🔴 CASO POSITIVO · el detector SÍ detecta un RFN declarado', () => {
    // Sin esto, un detector que devolviera `false` siempre pasaría el test de
    // arriba y nadie se enteraría nunca de un RFN nuevo. Se prueba con las dos
    // formas: en el primer aviso y en uno MÁS ABAJO, que es el caso que la
    // versión anterior —que leía sólo la línea 1— dejaba pasar.
    const base = readFileSync(join(RAIZ, 'public/fonts/OFL-DMSans.txt'), 'utf8');

    const arriba = base.replace(
      /^Copyright (\d{4}) (.+)$/m,
      'Copyright $1 $2 with Reserved Font Name "DM Sans"',
    );
    expect(declaraRFN(arriba), 'no detectó un RFN en el primer aviso').toBe(true);

    const lineas = base.split(/\r?\n/);
    lineas.splice(40, 0, 'Copyright 2019 Otro Autor with Reserved Font Name "Otra"');
    const abajo = lineas.join('\n');
    expect(declaraRFN(abajo), 'no detectó un RFN en un aviso posterior').toBe(true);
    // Y la prueba de que el caso de abajo es REALMENTE el que fallaba antes:
    expect(/reserved font name/i.test(abajo.split(/\r?\n/)[0]!)).toBe(false);
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
