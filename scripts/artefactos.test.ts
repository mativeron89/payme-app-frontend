import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * 🔴 LO QUE SE DISTRIBUYE, INSPECCIONADO SOBRE EL BUILD.
 *
 * ## Por qué existe este archivo
 *
 * `scripts/fuentes.test.ts` verifica `src/` — que los binarios estén, que sus
 * hashes coincidan, que las licencias sean las completas. **Todo eso podía ser
 * cierto y el artefacto distribuido no llevar la licencia igual**, y es
 * exactamente lo que pasaba: `dist/` y `dist-landing/` contenían los `.ttf` y
 * ningún `OFL`.
 *
 * La cláusula 2 de la OFL pide el aviso **y esta licencia** en cada copia
 * distribuida. Un test sobre el fuente no puede acreditarlo. **Éste construye
 * y mira los bytes emitidos.**
 *
 * ### La defensa anterior era cierta y aun así insuficiente
 *
 * Se argumentó que el aviso viaja en la tabla `name` del binario (IDs 0/13/14)
 * y que con eso alcanzaba. El dato es verdadero —está—, pero el `nameID 13` es
 * **un puntero de una línea**, no la licencia. Queda anotado porque el modo de
 * falla fue no tener el número mal sino **dejar de hacer el trabajo con un
 * argumento correcto**.
 *
 * ## Alcance, dicho con precisión
 *
 * Cubre `dist/` (build real) y `dist-mock/`. **La landing tiene su propio
 * archivo** —`landing/landing.test.ts`— que además puede ser más estricto,
 * porque no emite una sola línea de JavaScript.
 */

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..');

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

/**
 * 🔴 ALLOWLIST DE EGRESS · reemplaza la lista negra de cuatro proveedores.
 *
 * Prohibir `googleapis`, `gstatic`, `typekit` y `bunny` dejaba pasar un quinto
 * CDN que nadie nombró — que es justamente el caso que importa, porque el que
 * se cuela es el que no está en la lista. **Se invierte: sólo pasa lo que está
 * acá, con su motivo, y cualquier otro host es rojo.**
 *
 * 🔴 Y cada entrada dice SI ES EGRESS O NO, que no es lo mismo. Un `xmlns` de
 * SVG es una URL que el navegador NUNCA pide: es un identificador de espacio
 * de nombres. Mezclarlo con `js.stripe.com` —que sí abre una conexión— haría
 * una lista donde no se puede saber qué se está permitiendo.
 */
const HOSTS_PERMITIDOS = [
  { host: 'js.stripe.com', egress: true, porque: 'SDK de Stripe · única dependencia externa ratificada' },
  { host: 'localhost', egress: false, porque: 'default de desarrollo; no es un destino de producción' },
  { host: 'wa.me', egress: false, porque: 'DESTINO DE NAVEGACIÓN al tocar compartir, no un recurso que se cargue solo' },
  { host: 'www.w3.org', egress: false, porque: 'namespace XML de los SVG (`xmlns`). El navegador no lo pide nunca' },
  { host: 'reactjs.org', egress: false, porque: 'texto de un mensaje de error de React' },
  { host: 'docs.stripe.com', egress: false, porque: 'texto de un mensaje de error del SDK' },
] as const;

/** Binarios que cada artefacto tiene derecho a emitir, y su hash upstream. */
const BINARIOS_AUTORIZADOS = [
  { patron: /^PlusJakartaSans-variable-[A-Za-z0-9_-]+\.ttf$/, sha: '89b3fb38aa0d275d7a731d0d817a4f1622b316b4d7fbdedcf02ee9099ff68bc8' },
  { patron: /^DMSans-variable-[A-Za-z0-9_-]+\.ttf$/, sha: '8cd08d97e89c24d0aa92edd2f0f4c8ee6195eee9b7c9f154865a58b02f0c1c0d' },
] as const;

/**
 * 🔴 CLASIFICACIÓN DE LO EMITIDO, fail-closed.
 *
 * Cada archivo del artefacto cae en UNA de tres clases, y lo que no cae en
 * ninguna es rojo:
 *
 *   BINARIO   `.ttf`  → se verifica por HASH. No se le buscan URLs adentro.
 *   INERTE    `.txt`  → texto que el navegador NUNCA parsea como markup, CSS
 *                       ni JS. Se sirve como archivo y nada más. Se verifica
 *                       por hash contra el repo.
 *   PARSEADO  el resto (html/css/js) → entra al barrido de egress.
 *
 * 🔴 Por qué INERTE existe como clase y no como excepción: la licencia OFL
 * contiene `http://scripts.sil.org/OFL` y `github.com` en su aviso de
 * copyright. **Es texto que la licencia obliga a incluir y que no se puede
 * sacar.** Una guarda que lo marcara pediría algo imposible, y una guarda
 * imposible se afloja el día que estorba. Ya pasó dos veces acá: con el TTF y
 * con `url(...)` en la landing.
 *
 * La diferencia con "hacer una excepción" es que **la clase se verifica igual,
 * con otro instrumento**: identidad byte a byte en vez de barrido de texto.
 *
 * 🔴 Dicho de una vez: **un `.txt` y un `.ttf` NO HACEN REQUESTS. Verificarlos
 * por identidad es el instrumento correcto; buscarles URLs adentro es el
 * equivocado.** La salida cómoda era una excepción —"la OFL no cuenta"—, que
 * habría funcionado hoy y se habría podido invocar mañana para cualquier
 * archivo incómodo. Una clase se puede auditar; una excepción se hereda.
 *
 * Y **lo que no cae en ninguna categoría es ROJO**: eso es lo que la vuelve una
 * regla y no una lista. Un archivo nuevo de tipo inesperado no pasa por
 * default — tiene que clasificarlo alguien, a mano, y eso es una decisión.
 */
const esBinario = (nombre: string) => nombre.endsWith('.ttf');
const esInerte = (nombre: string) => nombre.endsWith('.txt');

interface Artefacto {
  readonly nombre: string;
  readonly esperaStripe: boolean;
  readonly archivos: readonly string[];
  readonly texto: string;
  readonly porArchivo: Readonly<Record<string, string>>;
  readonly binarios: Readonly<Record<string, string>>;
  /** Rutas clasificadas como INERTE: se verifican por hash, no se barren. */
  readonly inertes: readonly string[];
}

const construidos: Artefacto[] = [];
const temporales: string[] = [];

afterAll(() => {
  // Cleanup ante éxito Y ante error: corre aunque `beforeAll` haya explotado.
  for (const t of temporales) rmSync(t, { recursive: true, force: true });
  temporales.length = 0;
});

beforeAll(() => {
  const variantes = [
    { nombre: 'webapp real', extra: [] as string[], esperaStripe: true },
    // 🔴 El mock NO carga Stripe, y no es un descuido del build: `stripe.ts`
    // corta en `if (IS_MOCK) return null` y el `import()` dinámico deja la
    // librería en un chunk que la demo nunca descarga. Se afirma en positivo
    // más abajo — que el artefacto de demo no pueda llegar a Stripe es una
    // propiedad que vale la pena fijar, no un detalle.
    { nombre: 'webapp mock', extra: ['--mode', 'mock'], esperaStripe: false },
  ];

  for (const v of variantes) {
    // `mkdtemp` y no una ruta fija: dos corridas en paralelo no se pisan.
    const salida = mkdtempSync(join(tmpdir(), 'payme-artefacto-'));
    temporales.push(salida);
    execFileSync('npx', ['vite', 'build', '--outDir', salida, '--emptyOutDir', '--logLevel', 'error', ...v.extra], {
      cwd: RAIZ,
      stdio: 'pipe',
      // 🔴 `NODE_ENV` EXPLÍCITO, y no es un detalle: vitest exporta
      // `NODE_ENV=test`, y un `vite build` que lo hereda produce el bundle de
      // DESARROLLO de React. Sin esta línea este archivo inspeccionaba 709 KB
      // con avisos y enlaces de debug adentro, y lo llamaba "el artefacto
      // distribuible". El de verdad son 363 KB. Medido:
      //
      //     NODE_ENV=production   js 362.737 B   github.com ×0
      //     NODE_ENV=test         js 709.149 B   github.com ×2
      //
      // Es la misma clase de defecto que este archivo persigue: el
      // instrumento midiendo algo distinto de lo que la conclusión declara.
      env: { ...process.env, NODE_ENV: 'production' },
    });

    const abs: string[] = [];
    (function recorrer(dir: string) {
      for (const nombre of readdirSync(dir)) {
        const p = join(dir, nombre);
        if (statSync(p).isDirectory()) recorrer(p);
        else abs.push(p);
      }
    })(salida);

    const binarios: Record<string, string> = {};
    const porArchivo: Record<string, string> = {};
    const inertes: string[] = [];
    const trozos: string[] = [];
    for (const p of abs) {
      const rel = relative(salida, p);
      if (esBinario(basename(p))) {
        binarios[rel] = sha256(readFileSync(p));
        continue;
      }
      const contenido = readFileSync(p, 'utf8');
      porArchivo[rel] = contenido;
      // INERTE: se guarda para verificar por hash, pero NO entra al barrido.
      if (esInerte(basename(p))) inertes.push(rel);
      else trozos.push(contenido);
    }
    construidos.push({
      nombre: v.nombre,
      esperaStripe: v.esperaStripe,
      archivos: abs.map((p) => relative(salida, p)),
      texto: trozos.join('\n'),
      porArchivo,
      binarios,
      inertes,
    });
  }
}, 180_000);

describe.each([0, 1])('artefacto distribuible #%i', (i) => {
  const art = () => {
    const a = construidos[i];
    expect(a, 'el artefacto no se construyó').toBeDefined();
    return a!;
  };

  it('el build produjo archivos (si no, todo lo de abajo pasaría en vacío)', () => {
    expect(art().archivos.length).toBeGreaterThan(3);
    expect(art().archivos).toContain('index.html');
  });

  /**
   * 🔴 LA PROPIEDAD FUERTE: la lista de licencias requeridas se DERIVA de las
   * tipografías que el artefacto emite, no está escrita a mano.
   *
   * Con una lista manual, agregar una tercera familia sin su licencia pasaría
   * en verde. Así, cada `.ttf` emitido EXIGE su `OFL`.
   */
  it('🔴 cada tipografía emitida viaja con su licencia completa', () => {
    const familias = art()
      .archivos.filter((a) => a.endsWith('.ttf'))
      .map((a) => basename(a).replace(/-variable-[A-Za-z0-9_-]+\.ttf$/, ''));
    expect(familias.length, 'el artefacto no emitió ninguna tipografía').toBeGreaterThan(0);

    for (const familia of familias) {
      const ruta = `fonts/OFL-${familia}.txt`;
      expect(art().archivos, `falta la licencia de ${familia}`).toContain(ruta);

      const texto = art().porArchivo[ruta] ?? '';
      expect(texto, `${ruta} sin aviso de copyright`).toMatch(/^Copyright \d{4} The .+ Project Authors/);
      expect(texto).toContain('SIL OPEN FONT LICENSE Version 1.1');
      // Las cinco condiciones: que sea el texto entero y no un resumen.
      for (const clausula of ['1)', '2)', '3)', '4)', '5)']) {
        expect(texto, `${ruta} sin la cláusula ${clausula}`).toContain(clausula);
      }
      expect(texto).toContain('TERMINATION');
      expect(texto).toContain('DISCLAIMER');
    }
  });

  it('🔴 la licencia emitida es byte-idéntica a la del repo', () => {
    for (const [ruta, contenido] of Object.entries(art().porArchivo)) {
      if (!basename(ruta).startsWith('OFL-')) continue;
      const enRepo = readFileSync(join(RAIZ, 'public', ruta));
      expect(sha256(Buffer.from(contenido, 'utf8')), `${ruta} difiere del repo`).toBe(sha256(enRepo));
    }
  });

  it('🔴 todo binario emitido está autorizado y no cambió un byte', () => {
    const emitidos = Object.entries(art().binarios);
    expect(emitidos.length, 'no se detectó ningún binario: el detector dejó de matchear').toBeGreaterThan(0);
    for (const [ruta, sha] of emitidos) {
      const esperado = BINARIOS_AUTORIZADOS.find((b) => b.patron.test(basename(ruta)));
      expect(esperado, `binario no autorizado en el artefacto: ${ruta}`).toBeDefined();
      expect(sha, `${ruta} no es el binario upstream`).toBe(esperado!.sha);
    }
  });

  /**
   * 🔴 REGLA GENERAL DE EGRESS, y su límite dicho de frente.
   *
   * LO QUE MIDE: cualquier host que aparezca en el texto emitido y no esté en
   * `HOSTS_PERMITIDOS` pone esto en rojo — incluido un CDN que nadie nombró
   * nunca, que es el caso que la lista negra anterior no podía cubrir.
   *
   * ⚠️ LO QUE **NO** PUEDE MEDIR: el bundle es JavaScript minificado, así que
   * esto no distingue una constante de un `script.src`. Un host nuevo se
   * detecta; **qué hace ese host hay que ir a leerlo.** Por eso cada entrada
   * de la allowlist declara si es egress real o no: la clasificación la hace
   * una persona, no el regex.
   *
   * Y una consecuencia que conviene tener escrita: una dependencia npm nueva
   * que llame a su casa **aparece acá** (bien), pero una que lo haga armando
   * la URL por concatenación **no**. Esto no es una guarda de cadena de
   * suministro.
   */
  it('🔴 MUTANTE · ningún host fuera de la allowlist explícita', () => {
    const encontrados = new Set(
      [...art().texto.matchAll(/https?:\/\/([a-zA-Z0-9._-]+)/g)].map((m) => m[1]!),
    );
    const permitidos = new Set<string>(HOSTS_PERMITIDOS.map((h) => h.host));
    const ajenos = [...encontrados].filter((h) => !permitidos.has(h));
    expect(ajenos, `hosts que nadie autorizó: ${ajenos.join(' · ')}`).toEqual([]);
  });

  it('🔴 CASO LEGÍTIMO · el único egress real es Stripe, y sólo donde corresponde', () => {
    // La contracara del mutante: rechazar todo también deja los mutantes en
    // rojo. Esto afirma que lo autorizado se acepta.
    const reales = HOSTS_PERMITIDOS.filter((h) => h.egress);
    expect(reales.map((h) => h.host)).toEqual(['js.stripe.com']);

    if (art().esperaStripe) {
      expect(art().texto, 'el SDK de Stripe no está en el build real').toContain('js.stripe.com');
    } else {
      // 🔴 Y acá la afirmación es la INVERSA, que vale más que la directa: el
      // artefacto de demo no puede llegar a Stripe ni queriendo. `stripe.ts`
      // corta en `if (IS_MOCK) return null` antes del `import()` dinámico, así
      // que la librería queda en un chunk que este build no emite.
      expect(art().texto, 'la demo NO debe poder alcanzar Stripe').not.toContain('js.stripe.com');
    }
  });

  /**
   * La clase INERTE se verifica igual que las otras, con otro instrumento: si
   * alguien edita la licencia emitida, esto se pone rojo aunque el barrido de
   * hosts no la mire.
   */
  /**
   * 🔴 LA SONDA DE ESTE ARCHIVO: que lo inspeccionado sea el artefacto REAL.
   *
   * Sin esto, todas las afirmaciones de arriba siguen siendo ciertas... sobre
   * un bundle que nadie despacha. Un test que mide el artefacto equivocado no
   * falla: aprueba, y por eso es peor que no tenerlo.
   */
  it('🔴 SONDA · el bundle inspeccionado es el de PRODUCCIÓN, no el de desarrollo', () => {
    expect(art().texto, 'hay código de desarrollo de React en el artefacto')
      .not.toContain('react-dom.development');
    expect(art().texto, 'hay avisos de desarrollo en el artefacto').not.toContain('Warning: ');
  });

  it('🔴 los archivos INERTES se verificaron por identidad, no por omisión', () => {
    expect(art().inertes.length, 'no se clasificó ningún archivo inerte').toBeGreaterThan(0);
    for (const ruta of art().inertes) {
      expect(basename(ruta), `INERTE inesperado: ${ruta}`).toMatch(/^OFL-[A-Za-z]+\.txt$/);
    }
  });

  it('🔴 fail-closed · toda extensión emitida está clasificada', () => {
    // Si mañana el build emite un `.wasm`, un `.map` o un `.json`, cae acá en
    // vez de colarse sin que nadie lo mire. La lista se amplía a mano, y esa
    // es la idea: agregar una clase nueva es una decisión, no un accidente.
    //
    // 🔴 `.svg` entra el 2026-08-19 con el favicon del símbolo nuevo (A2), y
    // entra como DECISIÓN: es la primera extensión que se suma desde que existe
    // esta guarda. Va del lado de TEXTO a propósito —`esBinario` sólo exime al
    // `.ttf`—, así que el barrido de URLs lo alcanza. **Eso no es un detalle:
    // un SVG puede traer `<image href>`, un `@font-face` o un `xlink:href` a
    // otro dominio, y sería un origen externo entrando por un archivo que
    // "es sólo un ícono".** El del handoff no tiene ninguno: son tres paths.
    const CONOCIDAS = ['.html', '.css', '.js', '.ttf', '.txt', '.svg'];
    const raras = art()
      .archivos.filter((a) => !CONOCIDAS.some((e) => a.endsWith(e)));
    expect(raras, `archivos de tipo no clasificado: ${raras.join(' · ')}`).toEqual([]);
  });

  it('🔴 cada entrada de la allowlist dice por qué está', () => {
    for (const h of HOSTS_PERMITIDOS) {
      expect(h.porque.length, `${h.host} sin motivo`).toBeGreaterThan(20);
      expect(typeof h.egress).toBe('boolean');
    }
  });
});
