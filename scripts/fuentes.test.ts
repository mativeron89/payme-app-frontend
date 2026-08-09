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

  it('🔴 las copias de la landing son byte-idénticas a las de la webapp', () => {
    // Duplicadas a propósito —`D-WEB-1-BIS`: la landing es otro ORIGEN— y por
    // eso necesitan comparador: dos copias sin gate es como nace la deriva.
    // DM Sans se sumó el 2026-08-09 con el boceto: mismo binario, cero
    // descargas nuevas.
    for (const f of ['PlusJakartaSans-variable.ttf', 'DMSans-variable.ttf']) {
      const webapp = sha256(join(RAIZ, 'src/assets/fonts', f));
      const landing = sha256(join(RAIZ, 'landing/fonts', f));
      expect(landing, `${f}: webapp ${webapp.slice(0, 12)}… ≠ landing ${landing.slice(0, 12)}…`)
        .toBe(webapp);
    }
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

/**
 * 🔴 PROCEDENCIA INMUTABLE · lo que el README dice, leído DEL BINARIO.
 *
 * El SHA-256 ya estaba verificado, y con eso alcanza para saber que el archivo
 * no cambió. **No alcanza para saber que el README lo describe bien.** Un hash
 * correcto convive perfectamente con una tabla que dice "wght 200…800" cuando
 * el eje real es otro, o con una versión mal transcrita — y esos son los datos
 * que alguien va a usar para decidir si le sirve la fuente.
 *
 * Acá se parsea el TTF y se compara contra el documento: familia, versión,
 * ejes y tamaño. La documentación deja de describir y pasa a ser verificada.
 */
describe('el README describe el binario que hay, no el que había', () => {
  const u16 = (b: Buffer, o: number) => b.readUInt16BE(o);
  const u32 = (b: Buffer, o: number) => b.readUInt32BE(o);

  /** Tabla de tablas del sfnt: tag → offset. */
  function tablas(b: Buffer): Record<string, number> {
    const n = u16(b, 4);
    const t: Record<string, number> = {};
    for (let i = 0; i < n; i++) {
      const o = 12 + 16 * i;
      t[b.subarray(o, o + 4).toString('latin1')] = u32(b, o + 8);
    }
    return t;
  }

  /** Un registro de la tabla `name` por su id (UTF-16BE en plataforma 3). */
  function nombre(b: Buffer, id: number): string | null {
    const off = tablas(b).name;
    if (off === undefined) return null;
    const cuenta = u16(b, off + 2);
    const almacen = off + u16(b, off + 4);
    for (let i = 0; i < cuenta; i++) {
      const r = off + 6 + 12 * i;
      if (u16(b, r + 6) !== id) continue;
      const len = u16(b, r + 8);
      const so = u16(b, r + 10);
      const crudo = Buffer.from(b.subarray(almacen + so, almacen + so + len));
      // Plataforma 3 (Windows) guarda UTF-16 BIG endian y Node sólo decodifica
      // little endian, así que hay que dar vuelta los pares de bytes.
      // Plataforma 1 (Macintosh) es de un byte y se lee directo.
      if (u16(b, r) !== 3) return crudo.toString('latin1');
      return crudo.length % 2 === 0 ? crudo.swap16().toString('utf16le') : crudo.toString('latin1');
    }
    return null;
  }

  /** Los ejes de una fuente variable, leídos de `fvar`. */
  function ejes(b: Buffer): Array<{ tag: string; min: number; max: number }> {
    const off = tablas(b).fvar;
    if (off === undefined) return [];
    const ao = off + u16(b, off + 4);
    const cuenta = u16(b, off + 8);
    const tam = u16(b, off + 10);
    const out: Array<{ tag: string; min: number; max: number }> = [];
    for (let i = 0; i < cuenta; i++) {
      const o = ao + tam * i;
      out.push({
        tag: b.subarray(o, o + 4).toString('latin1'),
        min: b.readInt32BE(o + 4) / 65536,
        max: b.readInt32BE(o + 12) / 65536,
      });
    }
    return out;
  }

  const ESPERADO = [
    {
      archivo: 'PlusJakartaSans-variable.ttf',
      familia: 'Plus Jakarta Sans',
      version: '2.071',
      bytes: 176288,
      ejes: [{ tag: 'wght', min: 200, max: 800 }],
    },
    {
      archivo: 'DMSans-variable.ttf',
      familia: 'DM Sans 9pt',
      version: '4.004',
      bytes: 240164,
      ejes: [{ tag: 'opsz', min: 9, max: 40 }, { tag: 'wght', min: 100, max: 1000 }],
    },
  ] as const;

  it('🔴 el parser lee de verdad (si no, todo lo de abajo pasaría en vacío)', () => {
    const b = readFileSync(join(RAIZ, 'src/assets/fonts/PlusJakartaSans-variable.ttf'));
    expect(Object.keys(tablas(b)).length, 'no se leyó la tabla de tablas').toBeGreaterThan(10);
    expect(tablas(b).fvar, 'no se encontró `fvar`: ¿dejó de ser variable?').toBeDefined();
  });

  for (const e of ESPERADO) {
    it(`🔴 ${e.archivo}: familia, versión, ejes y tamaño salen del binario`, () => {
      const ruta = join(RAIZ, 'src/assets/fonts', e.archivo);
      const b = readFileSync(ruta);

      expect(b.length, 'el tamaño cambió').toBe(e.bytes);
      expect(nombre(b, 1), 'la familia declarada adentro cambió').toBe(e.familia);
      // nameID 5 es "Version 2.071;gftools[…]": alcanza con que contenga el número.
      expect(nombre(b, 5) ?? '', `la versión no es ${e.version}`).toContain(e.version);

      const reales = ejes(b).map((x) => ({ tag: x.tag, min: x.min, max: x.max }));
      expect(reales, 'los ejes reales no son los documentados').toEqual(
        e.ejes.map((x) => ({ tag: x.tag, min: x.min, max: x.max })),
      );
    });
  }

  it('🔴 y el README publica exactamente esos ejes', () => {
    // El documento y el binario tienen que decir lo mismo. Si alguien
    // actualiza la fuente y no el README, o al revés, se pone rojo.
    const md = readFileSync(join(RAIZ, 'src/assets/fonts/README.md'), 'utf8');
    expect(md).toContain('`wght 200 … 800`');
    expect(md).toContain('`opsz 9 … 40`');
    expect(md).toContain('`wght 100 … 1000`');
    expect(md).toContain('`2.071`');
    expect(md).toContain('`4.004`');
    for (const e of ESPERADO) expect(md, `el README no publica ${e.bytes}`).toContain(
      e.bytes.toLocaleString('de-DE'),
    );
  });
});

describe('los `@font-face` apuntan a archivos que existen', () => {
  /**
   * El modo de falla que esto ataca: un `url(...)` con un typo no rompe nada
   * visible. El navegador cae al fallback y la pantalla se ve casi igual.
   */
  const HOJAS = [
    { css: 'src/styles/global.css', esperadas: 2 },
    // 🔴 La landing pasó de 1 a 2 el 2026-08-09: el boceto de Diseño usa DM
    // Sans para TODO el cuerpo —párrafos, nav, perks, pasos— y hasta entonces
    // la landing sólo servía Plus Jakarta Sans. No hubo descarga nueva: es el
    // mismo binario que ya usaba la webapp, con su OFL adentro del artefacto.
    { css: 'landing/landing.css', esperadas: 2 },
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
