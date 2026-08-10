import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * ⭐ LA LANDING, PROBADA SOBRE EL BUILD.
 *
 * Este archivo construye la landing de verdad —`vite build` con su config, a
 * un temporal— y afirma sobre los bytes emitidos. La razón sigue siendo la de
 * siempre: *"una lista manual es la que nace vieja"*. Un test que enumere qué
 * NO se importa queda desactualizado el día que alguien agrega un import; uno
 * que mira el ARTEFACTO no puede, porque el artefacto es lo que se sirve.
 *
 * ## 🔴 LA INVARIANTE DE JAVASCRIPT SE MOVIÓ · 2026-08-09
 *
 * Hasta hoy decía **«el artefacto no tiene una sola línea de JavaScript»**, y
 * era la forma más fuerte de cumplir las prohibiciones del CARRIL 1A: sin
 * grafo de módulos no hay dónde colar `AuthProvider`, la capa de API ni
 * Stripe.
 *
 * **El boceto de Diseño trae un `<script>` inline de ~25 líneas** —nav que se
 * achica, barra de progreso, desplegable de «Iniciar sesión»—. El
 * Bibliotecario-Auditor lo aceptó con condiciones, y el razonamiento es el que
 * importa: **un script inline SIN una sola importación no crea grafo de
 * módulos y no puede arrastrar nada de eso. El PROPÓSITO de la invariante se
 * conserva; su LETRA no.**
 *
 * 🔴 **La guarda no se borró: se movió a lo que ahora protege.** Una guarda que
 * desaparece en silencio es indistinguible de una que nadie cumplió. Lo que se
 * exige hoy:
 *
 *   · CERO archivos `.js` emitidos — no hay entry de módulo;
 *   · el script inline sin `import`, `require`, `fetch` ni red;
 *   · ningún `<script src>` ni `type="module"`;
 *   · EXACTAMENTE uno, para que un segundo no entre callado;
 *   · **y el acceso vivo funciona SIN JavaScript** — verificado abajo por
 *     estructura, y con el navegador y JS deshabilitado antes de publicar.
 *
 * La última es la que importa de verdad: si el único camino al link vivo fuera
 * el desplegable, un script roto dejaría la landing sin salida.
 */

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..');

/**
 * Lo único que la landing tiene derecho a apuntar hacia afuera.
 *
 * 🔴 ACTUALIZADO el 2026-08-09: son los DEFINITIVOS de `D-WEB-1-BIS`.
 *
 * Durante unas horas apuntaron a un build de GitHub Pages, porque estos dos
 * dominios no tenían DNS y publicar un enlace hacia un dominio inexistente
 * entrega un clic que no hace nada. **Ahora existen y responden 200**,
 * verificado con `curl` y certificado válido antes de tocar el HTML.
 */
const DESTINOS_AUTORIZADOS = [
  'https://app.paymemx.com',
  'https://panel.paymemx.com',
] as const;

/**
 * 🔴 Hosts de terceros que alguna vez estuvieron en el camino del dominio.
 * Prohibidos como enlace. **Renombrado y re-fundado el 2026-08-10.**
 *
 * ⚠️ Este docblock decía, en presente y sin fecha: *«el apex ENTRÓ porque hoy
 * redirige a una página de parking (`paymemx-com.l.ink`) — o sea que todavía
 * no es de PayMe»*, y se ponía su propia condición de salida: *«Sale de acá el
 * día que `paymemx.com` sirva esta misma landing»*.
 *
 * **Ese día llegó.** Medido el 2026-08-10: `paymemx.com` y `www.paymemx.com`
 * responden 200 sin redirect y sirven ESTE artefacto — el CSS del ápice
 * resultó byte-idéntico al de `dist-landing/` (sha256 `1d224ad7…`).
 *
 * 🔴 Y sin embargo la lista NO se retira, por dos razones que conviene separar:
 *
 *   1. El host de parking sigue siendo un tercero. Que ya no esté en el camino
 *      no lo vuelve un destino legítimo.
 *   2. **No está subsumida por el barrido de allowlist.** Ese barrido sólo ve
 *      URLs CON esquema (`/\bhttps?:\/\//`); un `paymemx-com.l.ink` suelto en
 *      el texto no lo activa. Retirarla «porque ya está cubierta» habría sido
 *      aflojar una guarda con un argumento que suena bien y es falso.
 *
 * Lo que sí cambió es el NOMBRE y el motivo, porque el viejo describía un
 * hecho que dejó de ocurrir. El nombre además nunca fue exacto: `l.ink` tiene
 * DNS de sobra; lo que no tenía era relación con PayMe.
 */
const DOMINIOS_SIN_DNS = ['paymemx-com.l.ink'] as const;

interface Artefacto {
  readonly archivos: readonly string[];
  readonly html: string;
  /** El HTML SIN el bloque `<script>`, para parsear atributos de verdad. */
  readonly htmlSinScript: string;
  /** El contenido de los `<script>` inline, por separado. */
  readonly scripts: readonly string[];
  /** Todo el TEXTO emitido, para los barridos de red. Sin binarios ni inertes. */
  readonly todo: string;
  readonly porArchivo: Readonly<Record<string, string>>;
  readonly binarios: Readonly<Record<string, string>>;
  readonly inertes: readonly string[];
}

/**
 * Binarios que el artefacto tiene derecho a emitir. Se verifican por HASH: un
 * `.ttf`, un `.png` o un `.jpg` leídos como utf8 son ruido —pueden inventar un
 * `//algo.com` con bytes al azar— y no pueden contener una referencia que el
 * navegador siga. **Buscarles URLs adentro es el instrumento equivocado.**
 */
const BINARIO_AUTORIZADO = /\.(?:ttf|png|jpe?g)$/i;

/**
 * 🔴 La licencia OFL es INERTE y por eso no entra al barrido.
 *
 * Contiene `scripts.sil.org` y `github.com` en su aviso de copyright: texto que
 * la licencia OBLIGA a incluir. Marcarlo sería pedir algo imposible, y una
 * guarda imposible se afloja el día que estorba. Se verifica con el otro
 * instrumento: identidad byte a byte contra la copia del repo.
 *
 * 🔴 `CREDITOS.txt` se suma el 2026-08-09 por el mismo motivo: la atribución de
 * la foto tiene que VIAJAR con el artefacto, no quedarse en el repositorio. Un
 * asset publicado sin su procedencia al lado es un asset que nadie puede
 * auditar después. Misma disciplina que la OFL, y misma clase.
 */
const INERTE_AUTORIZADO = /^(?:OFL-[A-Za-z]+|CREDITOS)\.txt$/;

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

function cssDelBuild(): string {
  const css = build.archivos
    .filter((a) => a.endsWith('.css'))
    .map((a) => build.porArchivo[a] ?? '')
    .join('\n');
  expect(css.length, 'no se encontró CSS emitido: el test no probaría nada').toBeGreaterThan(100);
  return css;
}

let build: Artefacto;
let temporal: string | null = null;

afterAll(() => {
  if (temporal) rmSync(temporal, { recursive: true, force: true });
  temporal = null;
});

beforeAll(() => {
  const salida = mkdtempSync(join(tmpdir(), 'payme-landing-'));
  temporal = salida;
  execFileSync(
    'npx',
    ['vite', 'build', '--config', 'vite.landing.config.ts', '--outDir', salida, '--logLevel', 'error'],
    { cwd: RAIZ, stdio: 'pipe' },
  );

  const archivos: string[] = [];
  (function recorrer(dir: string) {
    for (const nombre of readdirSync(dir)) {
      const abs = join(dir, nombre);
      if (statSync(abs).isDirectory()) recorrer(abs);
      else archivos.push(abs);
    }
  })(salida);

  const binarios: Record<string, string> = {};
  const inertes: string[] = [];
  const texto: string[] = [];
  for (const a of archivos) {
    const nombre = basename(a);
    if (BINARIO_AUTORIZADO.test(nombre)) binarios[relative(salida, a)] = sha256(readFileSync(a));
    else if (INERTE_AUTORIZADO.test(nombre)) inertes.push(relative(salida, a));
    else texto.push(a);
  }

  const html = texto.filter((a) => a.endsWith('.html')).map((a) => readFileSync(a, 'utf8')).join('\n');
  const todo = texto.map((a) => `${relative(salida, a)}\n${readFileSync(a, 'utf8')}`).join('\n');
  const porArchivo: Record<string, string> = {};
  for (const a of texto) porArchivo[relative(salida, a)] = readFileSync(a, 'utf8');
  for (const rel of inertes) porArchivo[rel] = readFileSync(join(salida, rel), 'utf8');

  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]!);
  build = {
    archivos: archivos.map((a) => relative(salida, a)),
    html,
    htmlSinScript: html.replace(/<script\b[\s\S]*?<\/script>/gi, ''),
    scripts,
    todo,
    porArchivo,
    binarios,
    inertes,
  };
}, 60_000);

/** Cada tag del HTML con su nombre y su texto crudo de atributos. */
function tags(html: string): Array<{ nombre: string; crudo: string }> {
  return [...html.matchAll(/<([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g)]
    .map((m) => ({ nombre: m[1]!.toLowerCase(), crudo: m[2]! }));
}

/**
 * Los atributos de un tag, en las TRES formas que acepta HTML.
 *
 * 🔴 Se corre SIEMPRE sobre `htmlSinScript`. Medido: con el script adentro,
 * este parser leía `bar.style.transform = …`, `isOpen`, `loginMenu` y `pct`
 * **como si fueran atributos HTML** — cualquier asignación de JavaScript tiene
 * la forma `nombre = valor`. La allowlist de atributos habría fallado por
 * variables, o peor, alguien la habría "arreglado" agregándolas.
 */
function atributos(crudo: string): Array<{ nombre: string; valor: string }> {
  const re = /([a-zA-Z_:][a-zA-Z0-9_:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  return [...crudo.matchAll(re)].map((m) => ({
    nombre: m[1]!.toLowerCase(),
    valor: m[2] ?? m[3] ?? m[4] ?? '',
  }));
}

/**
 * ¿El valor apunta al PROPIO origen? Sólo lo relativo y los anclas internas.
 * Ni `//host` protocol-relative, ni ningún esquema —`https:`, `data:`—, ni los
 * subdominios de PayMe: son destinos de navegación, no proveedores de recursos.
 */
function esRelativo(valor: string): boolean {
  const v = valor.trim();
  if (!v) return true;
  if (v.startsWith('//')) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(v)) return false;
  return true;
}

/**
 * 🔴 ¿Esta URL apunta a un ORIGEN autorizado? Por origen parseado, NUNCA por
 * prefijo de cadena. 2026-08-10.
 *
 * Lo que había acá era `u.startsWith(d)`, y lo acredité rompiéndolo: metí
 * `https://app.paymemx.com.evil.example/x` como TEXTO en el artefacto y **los
 * 45 tests pasaron en verde**. `app.paymemx.com` es prefijo de
 * `app.paymemx.com.evil.example`, y también de `app.paymemx.company`.
 *
 * 🔴 Es la MISMA CLASE que el `grep -F "  $rel"` del verificador del espejo
 * —comparar por subcadena lo que es pertenencia a un conjunto— que ya había
 * corregido en otro archivo. Estaba viva acá desde entonces: **nombrar la
 * regla no exime de haberla roto en otro lado.**
 *
 * Y la ocasión que la vuelve urgente: con el ápice vivo, el próximo movimiento
 * natural es agregar `https://paymemx.com` a la lista. Como prefijo, ese solo
 * agregado autorizaría `paymemx.company` y `paymemx.com.evil.example` de una.
 *
 * Falla cerrado: lo que no parsea como URL, no está autorizado.
 */
function origenAutorizado(u: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(u);
  } catch {
    return false;
  }
  return (DESTINOS_AUTORIZADOS as readonly string[]).includes(parsed.origin);
}

/** Atributos que hacen que el NAVEGADOR cargue algo por su cuenta. */
const ATRIBUTOS_DE_RECURSO = [
  'src', 'srcset', 'poster', 'data', 'action', 'formaction', 'manifest', 'background', 'ping',
];

describe('el artefacto de la landing existe y es lo que dice ser', () => {
  it('el build produjo algo (si no, todo lo de abajo pasaría en vacío)', () => {
    expect(build.archivos.length).toBeGreaterThan(3);
    expect(build.archivos).toContain('index.html');
    expect(build.html).toContain('PayMe');
  });

  it('🔴 el README de decisiones NO se publica, y los CRÉDITOS SÍ', () => {
    // El `.md` contiene rutas internas y explica la arquitectura: una página
    // pública no le cuenta eso a quien mire el fuente. El `.txt` es lo
    // contrario — tiene que salir, porque la atribución de la foto viaja con
    // el artefacto igual que la OFL de las tipografías.
    expect(build.archivos.filter((a) => /readme|\.md$/i.test(a))).toEqual([]);
    expect(build.archivos, 'la atribución de la foto no viaja').toContain('img/CREDITOS.txt');
  });
});

/**
 * 🔴 PROPIEDAD 1 · LA INVARIANTE DE JAVASCRIPT, MOVIDA Y NO BORRADA.
 * El porqué completo está en el docblock de arriba.
 */
describe('PROPIEDAD 1 · el JavaScript no puede arrastrar el shell', () => {
  it('🔴 CERO archivos `.js` emitidos: no hay entry de módulo', () => {
    const js = build.archivos.filter((a) => /\.(js|mjs|cjs|jsx|ts|tsx)$/.test(a));
    expect(js, `el build emitió JavaScript: ${js.join(', ')}`).toEqual([]);
  });

  it('🔴 EXACTAMENTE un `<script>`, y es inline', () => {
    // Uno solo, para que un segundo no entre callado. Y sin `src`: un script
    // externo es exactamente el origen de terceros que la landing no admite.
    expect(build.scripts, 'apareció un script de más, o desapareció el del boceto').toHaveLength(1);
    const etiquetas = tags(build.html).filter((t) => t.nombre === 'script');
    for (const t of etiquetas) {
      const attrs = atributos(t.crudo).map((a) => a.nombre);
      expect(attrs, 'un <script src>: eso es un origen externo').not.toContain('src');
      expect(attrs, 'un <script type=module>: eso crea grafo de módulos').not.toContain('type');
    }
  });

  it('🔴 MUTANTE · el script no importa, no pide red, no evalúa', () => {
    const s = build.scripts.join('\n');
    for (const prohibido of [
      'import', 'require(', 'fetch(', 'XMLHttpRequest', 'WebSocket',
      'eval(', 'new Function', 'localStorage', 'sessionStorage', 'document.cookie',
    ]) {
      expect(s, `el script hace \`${prohibido}\``).not.toContain(prohibido);
    }
  });

  it('⭐ CONDICIÓN 3 · el acceso vivo funciona SIN JavaScript', () => {
    // Si el único camino al link fuera el desplegable, un script roto dejaría
    // la landing sin salida. El CTA del hero es un `<a href>` puro: navega sin
    // que corra una línea. Verificado también en el navegador con JS
    // deshabilitado antes de publicar.
    const anclas = tags(build.htmlSinScript).filter((t) => t.nombre === 'a');
    const vivos = anclas
      .map((t) => atributos(t.crudo).find((a) => a.nombre === 'href')?.valor ?? '')
      .filter((h) => h === DESTINOS_AUTORIZADOS[0]);
    expect(vivos.length, 'no hay ningún <a href> al destino vivo').toBeGreaterThan(0);

    // Y el del hero específicamente: no puede quedar sólo el del desplegable.
    const hero = build.htmlSinScript.match(/<section class="hero"[\s\S]*?<\/section>/)?.[0] ?? '';
    expect(hero, 'el hero perdió su enlace vivo').toContain(`href="${DESTINOS_AUTORIZADOS[0]}"`);
  });
});

describe('PROPIEDAD 2 · destinos honestos', () => {
  it('🔴 todo `<a href>` externo es un destino autorizado', () => {
    const externos = tags(build.htmlSinScript)
      .filter((t) => t.nombre === 'a')
      .map((t) => atributos(t.crudo).find((a) => a.nombre === 'href')?.valor ?? '')
      .filter((h) => !h.startsWith('#'));
    expect(externos.length, 'no quedó ningún acceso navegable').toBeGreaterThan(0);
    for (const h of externos) {
      expect(DESTINOS_AUTORIZADOS as readonly string[], `destino no autorizado: ${h}`).toContain(h);
    }
  });

  it('🔴 MUTANTE · ni terceros ajenos ni el propio origen hard-codeado', () => {
    const ofensores = DOMINIOS_SIN_DNS.filter((d) => build.todo.includes(d));
    expect(ofensores, `destinos ajenos en el artefacto: ${ofensores.join(' · ')}`).toEqual([]);
    // 🔴 El apex a secas sigue prohibido, pero POR OTRO MOTIVO desde el
    // 2026-08-10. Antes era «es un parking ajeno»; hoy el ápice es nuestro y
    // sirve esta misma página. El objeto nuevo es PORTABILIDAD: la landing se
    // sirve desde tres orígenes —ápice, `www.` y el prefijo de Pages— y un
    // href absoluto a sí misma saca al visitante de la copia que está mirando.
    // También rompería el seam de `D-WEB-2`: el día que `payme-web` tome la
    // raíz, ese link apuntaría a otra página.
    // Se busca como href EXACTO porque `paymemx.com` como substring matchea
    // `app.paymemx.com`, que sí es válido.
    const hrefs = tags(build.htmlSinScript)
      .flatMap((t) => atributos(t.crudo).filter((a) => a.nombre === 'href').map((a) => a.valor));
    const apex = hrefs.filter((h) => /^https?:\/\/(www\.)?paymemx\.com\/?$/.test(h));
    expect(apex, 'la landing hard-codea su propio origen: deja de ser portable').toEqual([]);
  });

  /**
   * 🔴 EL INVERSO DEL TEST QUE HABÍA ACÁ · 2026-08-09.
   *
   * Hasta hoy exigía que los dos accesos al panel estuvieran APAGADOS
   * —`<span>` sin `href`, con pastilla «Muy pronto»—, porque
   * `panel.paymemx.com` no existía. **Existe.** El tratamiento se retiró y el
   * test se da vuelta: ahora exige que los CUATRO accesos sean enlaces vivos.
   *
   * No se borró: se invirtió, y queda escrito por qué. Un test que desaparece
   * en silencio no deja rastro de que la condición existió.
   */
  // 🔴 RENOMBRADO el 2026-08-10. Se llamaba «los CUATRO accesos son enlaces
  // VIVOS», y no mide eso: cuenta `href`. Si `panel.paymemx.com` se cayera
  // mañana este test sigue verde **y su nombre sigue diciendo «vivos»** en la
  // salida de la corrida. La palabra era ambigua desde que se escribió: el
  // 2026-08-09 «vivo» quería decir «es un `<a href>` y no un `<span>` apagado».
  //
  // El arreglo NO es un test de red —sería un gate que se pone rojo cuando se
  // cae el wifi, instrumento que este repo ya rechazó bien para las fuentes—:
  // es que el nombre diga lo que mide. Un verde que promete de más apaga la
  // sospecha del que lo lee. Que los destinos respondan 200 se verificó a mano
  // el 2026-08-09 y quedó fechado arriba, que es todo lo que se puede afirmar.
  it('🔴 los CUATRO accesos son ENLACES y no `<span>` apagados · nada apagado', () => {
    expect(build.html, 'quedó un resto del tratamiento apagado').not.toContain('pronto');
    expect(build.html, 'quedó la pastilla «Muy pronto»').not.toContain('Muy pronto');

    const porDestino = new Map<string, number>();
    for (const t of tags(build.htmlSinScript).filter((t) => t.nombre === 'a')) {
      const h = atributos(t.crudo).find((a) => a.nombre === 'href')?.valor ?? '';
      if (h.startsWith('http')) porDestino.set(h, (porDestino.get(h) ?? 0) + 1);
    }
    // Dos por destino: el CTA del hero y la fila del desplegable.
    expect(Object.fromEntries([...porDestino].sort())).toEqual({
      'https://app.paymemx.com': 2,
      'https://panel.paymemx.com': 2,
    });
  });
});

describe('PROPIEDAD 3 · cero recursos cross-origin o de terceros', () => {
  it('🔴 MUTANTE · ningún atributo de recurso apunta fuera del origen', () => {
    const ajenos: string[] = [];
    for (const t of tags(build.htmlSinScript)) {
      for (const a of atributos(t.crudo)) {
        const esRecurso = ATRIBUTOS_DE_RECURSO.includes(a.nombre)
          || (a.nombre === 'href' && t.nombre !== 'a');
        if (esRecurso && !esRelativo(a.valor)) ajenos.push(`<${t.nombre} ${a.nombre}="${a.valor}">`);
      }
    }
    expect(ajenos, `recursos que no son del propio origen: ${ajenos.join(' · ')}`).toEqual([]);
  });

  function urlsDelCss(css: string): string[] {
    return [...css.matchAll(/url\(\s*(['"]?)([^'")]*)\1\s*\)/g)].map((m) => m[2]!.trim());
  }

  it('🔴 MUTANTE · todo `url(...)` del CSS es RELATIVO al propio artefacto', () => {
    const ajenos = urlsDelCss(cssDelBuild()).filter((u) => !esRelativo(u));
    expect(ajenos, `recursos del CSS fuera del origen: ${ajenos.join(' · ')}`).toEqual([]);
  });

  it('🔴 CASO LEGÍTIMO · las tipografías propias SÍ pasan la guarda', () => {
    // Cinco mutantes en rojo son compatibles con una guarda que rechaza TODO.
    const propias = urlsDelCss(cssDelBuild()).filter((u) => u.endsWith('.ttf'));
    expect(propias, 'el CSS no referencia ninguna tipografía propia').toHaveLength(2);
    for (const u of propias) expect(esRelativo(u), `${u} no se aceptó como propia`).toBe(true);
  });

  it('🔴 MUTANTE · ningún `data:` — el boceto los traía y se reemplazaron', () => {
    expect(cssDelBuild().toLowerCase(), 'hay un data: URI en el CSS').not.toContain('data:');
    expect(build.html.toLowerCase()).not.toContain('data:');
  });

  it('🔴 ningún `@import`, ni siquiera relativo', () => {
    expect(cssDelBuild()).not.toMatch(/@import/i);
  });

  it('🔴 MUTANTE · ni protocol-relative ni ningún host en el TEXTO emitido', () => {
    const conEsquema = [...build.todo.matchAll(/\bhttps?:\/\/[^\s"'<>)]+/g)].map((m) => m[0]);
    const ajenos = conEsquema.filter((u) => !origenAutorizado(u));
    expect(ajenos, `hosts externos: ${ajenos.join(', ')}`).toEqual([]);
    const protocolRelative = [...build.todo.matchAll(/(^|[^:a-zA-Z0-9])\/\/[a-zA-Z0-9-]+\.[a-zA-Z]{2,}/g)];
    expect(protocolRelative.map((m) => m[0].trim()), 'URLs protocol-relative').toEqual([]);
  });

  /**
   * 🔴 SONDA del instrumento de arriba · 2026-08-10.
   *
   * El barrido sólo vale lo que valga `origenAutorizado`. Se prueba el
   * PREDICADO directamente y no inyectando en el build, por la misma razón que
   * la sonda del parser de atributos: un caso inyectado puede quedar atajado
   * por OTRA guarda más estricta y dar la falsa impresión de que ésta funciona.
   *
   * Me pasó justo acá: mi primer mutante metió el host malicioso como
   * `<a href>`, lo atajó el test de destinos EXACTOS de PROPIEDAD 2, y el
   * agujero de PROPIEDAD 3 quedó sin tocar. Recién como texto suelto salió a
   * la luz.
   */
  /**
   * 🔴 LA GUARDA QUE EL CONFIG DECÍA QUE EXISTÍA · 2026-08-10.
   *
   * `vite.landing.config.ts` afirma, textual: *«Se verifica en el `dist`, no en
   * la teoría: `landing.test.ts` exige que las rutas emitidas empiecen con
   * `./`»*. **No lo exigía.** Lo acredité cambiando `base: './'` por `'/'`:
   * el build emitió `/assets/index-*.css` y de 45 tests cayó UNO — y no éste,
   * sino «las tres imágenes se USAN», por un efecto lateral de su regex.
   *
   * O sea que la propiedad se sostenía de rebote, y el mensaje que iba a leer
   * quien la rompiera hablaba de peso muerto. **Es la misma clase que el README
   * jurando una comparación de tokens que nadie escribió: un documento que
   * describe una guarda inexistente es peor que no tener la guarda, porque
   * apaga la sospecha.**
   *
   * Y ahora importa más que ayer: con el ápice sirviendo la raíz, cambiar
   * `base` a `'/'` parece una limpieza inofensiva y rompe en silencio las otras
   * dos copias —la preview bajo prefijo y el `dev` local—.
   */
  it('🔴 toda ruta de recurso emitida empieza con `./` · las tres copias', () => {
    const rutas: string[] = [];
    for (const t of tags(build.htmlSinScript)) {
      for (const a of atributos(t.crudo)) {
        const esRecurso = ATRIBUTOS_DE_RECURSO.includes(a.nombre)
          || (a.nombre === 'href' && t.nombre !== 'a');
        if (esRecurso && a.valor.trim()) rutas.push(a.valor.trim());
      }
    }
    const css = cssDelBuild();
    rutas.push(...[...css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map((m) => m[1]!.trim()));

    expect(rutas.length, 'no se encontró ninguna ruta de recurso: el barrido mide en vacío')
      .toBeGreaterThan(3);
    const absolutas = rutas.filter((r) => !r.startsWith('./'));
    expect(absolutas, `rutas que no empiezan con './': ${absolutas.join(' · ')}`).toEqual([]);
  });

  it('🔴 SONDA · el sufijo goloso NO pasa, y los destinos reales SÍ', () => {
    const impostores = [
      'https://app.paymemx.com.evil.example/x',   // el sufijo: prefijo compartido
      'https://app.paymemx.company/x',            // el TLD vecino, sin punto de por medio
      'https://paymemx.com.attacker.test/',       // el que habilitaría sumar el ápice
      'http://app.paymemx.com',                   // mismo host, esquema distinto: otro origen
      'https://evil.example/?u=https://app.paymemx.com', // el autorizado, pero como parámetro
      'no-es-una-url',                            // no parsea → fail-closed
    ];
    for (const u of impostores) {
      expect(origenAutorizado(u), `pasó un impostor: ${u}`).toBe(false);
    }

    // CASO LEGÍTIMO: si esto se pusiera en rojo, la guarda sería inútil por el
    // otro lado — rechazaría los destinos que la landing necesita.
    for (const d of DESTINOS_AUTORIZADOS) {
      expect(origenAutorizado(d), `rechazó un destino real: ${d}`).toBe(true);
      expect(origenAutorizado(`${d}/ruta?q=1#a`), `rechazó una ruta de ${d}`).toBe(true);
    }
  });

  it('no hay preconnect, dns-prefetch ni preload a ningún lado', () => {
    expect(build.html).not.toMatch(/rel=["'](?:preconnect|dns-prefetch|preload|modulepreload)/i);
  });
});

describe('PROPIEDAD 4 · fail-closed: sólo lo que la landing necesita', () => {
  /**
   * Las evasiones se PROHÍBEN, no se parsean. Escribir un parser HTML correcto
   * sería código nuevo, sin dependencia que lo respalde, custodiando una página
   * estática — y un parser propio con un bug es indistinguible de no tener
   * guarda. La landing no necesita ninguna de estas formas.
   */
  const ATRIBUTOS_PERMITIDOS = [
    // documento
    'lang', 'charset', 'name', 'content', 'rel', 'href', 'class', 'id',
    // accesibilidad y semántica
    'role', 'alt', 'aria-label', 'aria-hidden', 'aria-expanded', 'aria-haspopup', 'aria-disabled',
    // imágenes
    'src', 'width', 'height', 'loading',
    // SVG del boceto (íconos y el conector de los pasos)
    'viewbox', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin',
    'stroke-dasharray', 'opacity', 'd', 'cx', 'cy', 'r', 'x', 'y', 'rx',
  ];

  it('🔴 MUTANTE · ningún atributo fuera de la allowlist (mata srcset, style y on*)', () => {
    const ajenos: string[] = [];
    for (const t of tags(build.htmlSinScript)) {
      for (const a of atributos(t.crudo)) {
        if (!ATRIBUTOS_PERMITIDOS.includes(a.nombre)) ajenos.push(`<${t.nombre} ${a.nombre}>`);
      }
    }
    expect(ajenos, `atributos no autorizados: ${ajenos.join(' · ')}`).toEqual([]);
  });

  it('🔴 SONDA · el parser NO lee variables del script como atributos', () => {
    // El script queda afuera del HTML que se parsea.
    expect(build.htmlSinScript, 'el script sigue adentro del HTML barrido').not.toContain('scrollY');
    expect(build.htmlSinScript).not.toContain('addEventListener');

    /**
     * 🔴 Y LA DEBILIDAD DEL PARSER, PROBADA DIRECTO — no a través del build.
     *
     * Primero escribí esta sonda buscando `isOpen` en el HTML construido, y
     * falló: **Vite MINIFICA el script inline y le renombra las variables.** El
     * defecto no se reproduce ahí, así que la sonda medía algo que no puede
     * pasar en el artefacto — verde por la razón equivocada, al revés.
     *
     * La debilidad es del PARSER, no del build: cualquier asignación con la
     * forma `nombre = valor` la lee como atributo. Se prueba sobre el parser.
     */
    const comoSiFueraJS = atributos(' var isOpen = true; bar.style.transform = x; ');
    expect(comoSiFueraJS.map((a) => a.nombre), 'el parser dejó de tener la debilidad que esto vigila')
      .toContain('isopen');
  });

  it('🔴 CASO LEGÍTIMO · los atributos que la página SÍ usa se aceptan', () => {
    const usados = new Set(
      tags(build.htmlSinScript).flatMap((t) => atributos(t.crudo).map((a) => a.nombre)),
    );
    expect(usados.size, 'no se leyó ningún atributo: el parser dejó de ver').toBeGreaterThan(10);
    for (const u of usados) expect(ATRIBUTOS_PERMITIDOS, `${u} debería estar permitido`).toContain(u);
  });

  it('🔴 MUTANTE · ninguna entity en el HTML', () => {
    const entities = [...build.htmlSinScript.matchAll(/&(#[0-9]+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]{1,31});/g)]
      .map((m) => m[0]);
    expect(entities, `entities en el HTML: ${entities.join(' · ')}`).toEqual([]);
  });

  it('🔴 MUTANTE · ningún `>` dentro de un valor citado', () => {
    const citados = [...build.htmlSinScript.matchAll(/=\s*("([^"]*)"|'([^']*)')/g)]
      .map((m) => m[2] ?? m[3] ?? '');
    const conMayor = citados.filter((v) => v.includes('>'));
    expect(conMayor, `valores con '>' adentro: ${conMayor.join(' · ')}`).toEqual([]);
  });

  it('🔴 MUTANTE · ningún escape CSS', () => {
    const css = cssDelBuild();
    const escapes = [...css.matchAll(/\\[0-9a-fA-F]{1,6}\s?/g)].map((m) => m[0]);
    expect(escapes, `escapes CSS: ${escapes.join(' · ')}`).toEqual([]);
  });

  it('🔴 ningún handler inline, `javascript:`, meta refresh, iframe ni form', () => {
    const conHandler = tags(build.htmlSinScript)
      .flatMap((t) => atributos(t.crudo).map((a) => ({ t, a })))
      .filter(({ a }) => /^on[a-z]+$/.test(a.nombre));
    expect(conHandler.map(({ t, a }) => `<${t.nombre} ${a.nombre}>`)).toEqual([]);
    expect(build.html.toLowerCase()).not.toContain('javascript:');
    expect(build.html).not.toMatch(/<meta[^>]+http-equiv\s*=\s*["']?\s*refresh/i);
    const prohibidos = tags(build.htmlSinScript)
      .map((t) => t.nombre)
      .filter((n) => ['iframe', 'object', 'embed', 'form', 'base'].includes(n));
    expect(prohibidos).toEqual([]);
  });

  it('🔴 CERO COMENTARIOS HTML en el artefacto', () => {
    const comentarios = [...build.html.matchAll(/<!--[\s\S]*?-->/g)].map((m) => m[0]);
    expect(comentarios, `comentarios en el HTML público: ${comentarios.join(' · ')}`).toEqual([]);
  });
});

/**
 * 🔴 REGISTRO DE EXCEPCIONES AA · el «cero fallas» dejó de ser cierto.
 *
 * El barrido de contraste del 2026-08-09 dio **cero fallas en 45 nodos**. Ese
 * número **ya no vale**, y no se deja escrito en ningún lado como si valiera:
 * Mati pidió el botón «Iniciar sesión» con letra blanca, y blanco sobre
 * naranja no llega a AA.
 *
 * **No es un descuido: es la excepción que él ratificó el 2026-08-08**, con los
 * cuatro usos del naranja a la vista y el contraste medido al lado de cada uno.
 *
 * ⚠️ Sobre QUÉ naranja lo decidió DISEÑO, que es el dueño del color —«sólido,
 * no abro una excepción nueva»— y de paso retiró su propio degradado por haber
 * quedado desactualizado. Los números que tuvo a la vista:
 *
 *     blanco sobre #FFA36B (degradado del boceto)   1.96:1   ← excepción NUEVA
 *     blanco sobre #FF9152 (degradado del boceto)   2.23:1   ← excepción NUEVA
 *     blanco sobre #FF6B35 (marca, ratificado)      2.84:1   ← el elegido
 *
 * **Cumplir el pedido sobre el degradado habría abierto una excepción nueva y
 * PEOR que la existente.** Sobre `--brand` queda exactamente dentro de la que
 * ya estaba aceptada — que es lo que la regla *«una excepción a un color no se
 * extiende a otro color»* pide: usar el color DE la excepción.
 *
 * 🔴 Va en un test y no en un comentario **porque un comentario no se pone
 * rojo**. Y corta para los dos lados: si alguien oscurece `--brand` hasta que
 * el par PASE, deja de ser excepción y tiene que salir del registro.
 */
describe('PROPIEDAD 5 bis · las excepciones AA están registradas, no escondidas', () => {
  const hex = (h: string): [number, number, number] =>
    [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
  const lum = (c: readonly number[]) =>
    0.2126 * canal(c[0]!) + 0.7152 * canal(c[1]!) + 0.0722 * canal(c[2]!);
  function canal(v: number) {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  }
  const ratio = (a: string, b: string) => {
    const [x, y] = [lum(hex(a)), lum(hex(b))].sort((m, n) => n - m);
    return (x! + 0.05) / (y! + 0.05);
  };

  const EXCEPCIONES_AA = [
    {
      donde: '.login-trigger',
      fg: '#FFFFFF',
      decideFg: 'Mati',
      bg: '#FF6B35',
      decideBg: 'Diseño',
      ratio: 2.84,
      minimo: 4.5,
      fecha: '2026-08-09',
      ratifica: 'Mati · 2026-08-08',
      porque:
        'Mati pidió letra blanca, con captura; Diseño eligió el naranja SÓLIDO de marca ' +
        '—«no abro una excepción nueva»— y retiró su propio degradado por quedar desactualizado',
    },
  ] as const;

  it('🔴 el registro no está vacío, y cada entrada dice quién y cuándo', () => {
    expect(EXCEPCIONES_AA.length, 'el registro quedó vacío: nada que verificar').toBe(1);
    for (const e of EXCEPCIONES_AA) {
      expect(e.fecha).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.ratifica).toMatch(/\d{4}-\d{2}-\d{2}$/);
      // 🔴 Dos autores DISTINTOS, y por eso dos campos y no uno: el texto lo
      // decidió Mati y el fondo lo decidió Diseño. Un solo `decide` obligaba a
      // atribuirle a uno lo que eligió el otro — que es exactamente el error
      // que hubo que corregir para llegar hasta acá.
      expect(e.decideFg.length, 'sin autor del color de texto').toBeGreaterThan(0);
      expect(e.decideBg.length, 'sin autor del color de fondo').toBeGreaterThan(0);
      expect(e.porque.length, 'sin motivo no se puede auditar la decisión').toBeGreaterThan(30);
    }
  });

  /**
   * 🔴 EL COLOR SE DERIVA DEL CSS EMITIDO, no del hex escrito en el registro.
   *
   * La primera versión de este test calculaba el ratio entre las dos cadenas
   * de `EXCEPCIONES_AA`. **Un mutante que oscurecía `--brand` en el CSS lo
   * dejaba VERDE**: el registro seguía afirmando sobre `#FF6B35` aunque la
   * página ya usara otro color.
   *
   * Es la misma clase que el README que juraba «cero JavaScript»: **un
   * documento —o un registro— que describe algo que el artefacto ya no
   * tiene.** Se arregla igual: derivando del artefacto en vez de repetirlo.
   */
  const tokenDelCss = (nombre: string): string => {
    const css = cssDelBuild();
    const m = css.match(new RegExp(`--${nombre}:\\s*(#[0-9a-fA-F]{6})`));
    expect(m, `no se encontró el token --${nombre} en el CSS emitido`).not.toBeNull();
    return m![1]!.toUpperCase();
  };

  it('🔴 el registro describe el color que la página USA de verdad', () => {
    for (const e of EXCEPCIONES_AA) {
      expect(tokenDelCss('brand'), `el registro dice ${e.bg} y el CSS usa otro color`).toBe(e.bg);
      expect(tokenDelCss('action-fg'), `el registro dice ${e.fg} y el CSS usa otro`).toBe(e.fg);
    }
  });

  it('🔴 cada excepción sigue MEDIDA y sigue por debajo de su mínimo', () => {
    for (const e of EXCEPCIONES_AA) {
      // Los colores salen del CSS emitido, no del registro: si el token
      // cambia, cambia la medición.
      const medido = ratio(tokenDelCss('action-fg'), tokenDelCss('brand'));
      expect(medido, `${e.donde}`).toBeCloseTo(e.ratio, 1);
      expect(medido, `${e.donde} ya PASA ${e.minimo}: sacala del registro`).toBeLessThan(e.minimo);
    }
  });

  it('🔴 MUTANTE · el botón usa el naranja RATIFICADO, no el degradado del boceto', () => {
    // El degradado daba 1.96 y 2.23: peor que la excepción existente. Si
    // alguien lo repone, esto cae.
    const css = cssDelBuild();
    const regla = css.match(/\.login-trigger\{[^}]*\}/)?.[0] ?? '';
    expect(regla.length, 'no se encontró la regla de `.login-trigger`').toBeGreaterThan(40);
    expect(regla, 'volvió el degradado claro: eso abre una excepción nueva y peor')
      .not.toMatch(/linear-gradient/);
    expect(regla, 'el fondo dejó de ser el naranja de marca').toMatch(/background:var\(--brand\)|#ff6b35/i);
  });

  it('🔴 y las alternativas peores están medidas, no supuestas', () => {
    expect(ratio('#FFFFFF', '#FFA36B')).toBeCloseTo(1.96, 1);
    expect(ratio('#FFFFFF', '#FF9152')).toBeCloseTo(2.23, 1);
    // Y el control positivo: navy sobre el mismo naranja SÍ pasaría — la
    // excepción existe porque Mati eligió blanco, no porque no hubiera opción.
    expect(ratio('#0F1F3D', '#FF6B35')).toBeGreaterThan(4.5);
  });
});

describe('PROPIEDAD 5 · las tipografías y sus licencias', () => {
  const copias = [
    { landing: 'landing/fonts/PlusJakartaSans-variable.ttf', webapp: 'src/assets/fonts/PlusJakartaSans-variable.ttf' },
    { landing: 'landing/fonts/DMSans-variable.ttf', webapp: 'src/assets/fonts/DMSans-variable.ttf' },
  ];

  it('🔴 las copias de la landing son byte-idénticas a las de la webapp', () => {
    // Duplicadas a propósito —`D-WEB-1-BIS`: la landing es otro ORIGEN— y por
    // eso necesitan comparador: dos copias sin gate es como nace la deriva.
    for (const c of copias) {
      const a = sha256(readFileSync(join(RAIZ, c.landing)));
      const b = sha256(readFileSync(join(RAIZ, c.webapp)));
      expect(a, `${basename(c.landing)} derivó de la de la webapp`).toBe(b);
    }
  });

  it('🔴 cada tipografía emitida viaja con su licencia COMPLETA', () => {
    // La lista se DERIVA de lo que el artefacto emite: agregar una familia sin
    // su licencia se pone rojo solo, sin que nadie mantenga una lista.
    const familias = Object.keys(build.binarios)
      .filter((a) => a.endsWith('.ttf'))
      .map((a) => basename(a).replace(/-variable-[A-Za-z0-9_-]+\.ttf$/, ''));
    expect(familias.length, 'el artefacto no emitió ninguna tipografía').toBe(2);

    for (const familia of familias) {
      const ruta = `fonts/OFL-${familia}.txt`;
      expect(build.archivos, `falta la licencia de ${familia}`).toContain(ruta);
      const texto = build.porArchivo[ruta] ?? '';
      expect(texto).toMatch(/^Copyright \d{4} The .+ Project Authors/);
      expect(texto).toContain('SIL OPEN FONT LICENSE Version 1.1');
      for (const clausula of ['1)', '2)', '3)', '4)', '5)']) {
        expect(texto, `${ruta} sin la cláusula ${clausula}`).toContain(clausula);
      }
      expect(texto).toContain('DISCLAIMER');
    }
  });

  it('🔴 `font-display: swap` en cada cara, y el fallback intacto', () => {
    const css = cssDelBuild();
    const caras = [...css.matchAll(/@font-face\s*\{[^}]*\}/g)].map((m) => m[0]);
    expect(caras.length, 'no hay @font-face: el test no probaría nada').toBe(2);
    for (const cara of caras) expect(cara, `un @font-face sin swap: ${cara}`).toMatch(/font-display\s*:\s*swap/);
    // El fallback es lo que se ve durante el `swap` y lo único que queda si el
    // binario falla. El boceto lo trae y no se pierde en el port.
    expect(css, 'se perdió el fallback de sistema').toMatch(/system-ui/);
  });

  it('🔴 el INERTE no se coló al barrido de hosts', () => {
    expect(build.todo, 'la licencia entró al texto barrido').not.toContain('scripts.sil.org');
    expect([...build.inertes].sort()).toEqual([
      'fonts/OFL-DMSans.txt',
      'fonts/OFL-PlusJakartaSans.txt',
      'img/CREDITOS.txt',
    ]);
  });
});

describe('PROPIEDAD 6 · las imágenes', () => {
  it('🔴 la atribución de la foto viaja y nombra autor, fuente y licencia', () => {
    // La Unsplash License no EXIGE atribución. Se deja igual: el costo es un
    // archivo de texto y el beneficio es poder responder dentro de un año de
    // dónde salió la foto sin buscar en un chat.
    const cred = build.porArchivo['img/CREDITOS.txt'] ?? '';
    expect(cred.length, 'el archivo de créditos está vacío o no viaja').toBeGreaterThan(200);
    for (const dato of ['Dan Gold', 'Unsplash', 'mesa-comida.jpg']) {
      expect(cred, `la atribución no dice \`${dato}\``).toContain(dato);
    }
    // Y declara que la imagen es derivada: se redimensionó y recomprimió.
    expect(cred, 'no declara los cambios sobre el original').toMatch(/1400x1050|redimensionada/);
  });

  it('🔴 los binarios emitidos son EXACTAMENTE los esperados', () => {
    // `.map(basename)` NO: `map` le pasa el índice como segundo argumento y
    // `basename(x, 0)` explota con «suffix must be a string». Lo aprendí acá.
    const emitidos = Object.keys(build.binarios)
      .map((a) => basename(a).replace(/-[A-Za-z0-9_-]{8}\./, '.'));
    expect(emitidos.sort()).toEqual([
      'DMSans-variable.ttf',
      'PlusJakartaSans-variable.ttf',
      'app-dividir-cuenta.png',
      'mesa-comida.jpg',
      'panel-propinas.png',
    ]);
  });

  it('🔴 las tres imágenes se USAN: nada de peso muerto', () => {
    // 785 KB que nadie referencia se descargan igual y no se ven.
    const referenciadas = [...build.html.matchAll(/src="\.\/assets\/([^"]+)"/g)].map((m) => m[1]!);
    const emitidas = Object.keys(build.binarios)
      .map((a) => basename(a))
      .filter((n) => /\.(png|jpe?g)$/i.test(n));
    for (const e of emitidas) {
      expect(referenciadas, `${e} está emitida pero nadie la referencia`).toContain(e);
    }
  });

  it('🔴 cada imagen tiene `alt` de verdad', () => {
    const imgs = tags(build.htmlSinScript).filter((t) => t.nombre === 'img');
    expect(imgs.length, 'no se emitió ninguna imagen').toBe(3);
    for (const i of imgs) {
      const alt = atributos(i.crudo).find((a) => a.nombre === 'alt')?.valor ?? '';
      expect(alt.length, `un <img> sin alt útil: ${i.crudo.slice(0, 60)}`).toBeGreaterThan(20);
    }
  });

  it('🔴 la captura del panel dice que sus datos son de ejemplo', () => {
    // Muestra $2.560 de propinas y dos personas con su rendimiento. Sin esta
    // línea se lee como el desempeño real de un restaurante real. Es el seed.
    expect(build.html, 'la captura del panel no avisa que es una demo')
      .toMatch(/panel-propinas[\s\S]{0,400}Datos de ejemplo/);
  });

  it('🔴 y la de la app NO lleva caption — lleva su leyenda dentro del producto', () => {
    // Decisión declarada, no omisión: quien toque «Comensal» ve la leyenda del
    // modo demo en dos segundos.
    //
    // 🔴 CORREGIDO el 2026-08-10. Acá decía «El panel no tiene esa salida: su
    // link no existe. Si algún día se publica, esto se revisa.» Se publicó: la
    // landing enlaza `panel.paymemx.com` DOS veces —lo afirma el test de los
    // cuatro accesos, unas líneas más arriba—. El comentario quedó atrás
    // cuando ese test se invirtió el 2026-08-09.
    //
    // La revisión que él mismo pedía queda ABIERTA y es de Diseño, no mía: si
    // ahora se puede entrar al panel, ¿el caption «Datos de ejemplo» sigue
    // haciendo falta? La aserción de abajo no se toca hasta que contesten.
    const captions = [...build.html.matchAll(/class="audience-caption"[^>]*>([^<]*)</g)].map((m) => m[1]!.trim());
    expect(captions).toEqual(['Datos de ejemplo — panel en modo demo']);
  });
});

/**
 * 📱 PROPIEDAD 7 · EL LAYOUT MÓVIL DE §6.
 *
 * El boceto es la versión de computadora y su CSS lo decía: `min-width: 1040px`
 * en el `body`, una sola media query. **Medido en un iPhone 13 antes de
 * arreglarlo: 1040 px de layout sobre 390 pt de pantalla, factor 0.38×, el
 * cuerpo de 18 px viéndose a 6.8 pt.** Ilegible sin zoom — y el link se
 * comparte por WhatsApp, donde casi todo se abre en un teléfono.
 *
 * §6 de la spec de Diseño lo especifica, y aclara que **esto SÍ cambia respecto
 * del boceto**. Breakpoint ÚNICO en 640 px.
 *
 * Se verifica sobre el CSS emitido; el comportamiento real se midió en tres
 * dispositivos emulados antes de publicar: escala 1.00× y cuerpo a 18 pt.
 */
describe('PROPIEDAD 7 · el layout móvil de §6', () => {
  const bloque640 = (): string => {
    const css = cssDelBuild();
    const i = css.indexOf('@media (max-width:640px)') >= 0
      ? css.indexOf('@media (max-width:640px)')
      : css.indexOf('@media (max-width: 640px)');
    expect(i, 'no existe el breakpoint de 640 px que §6 manda').toBeGreaterThan(-1);
    return css.slice(i);
  };

  it('🔴 el `body` NO tiene `min-width`: era lo que forzaba el viewport de escritorio', () => {
    const css = cssDelBuild();
    const body = css.match(/(?:^|\})body\{([^}]*)\}/)?.[1] ?? '';
    expect(body.length, 'no se encontró la regla de `body`').toBeGreaterThan(10);
    expect(body, 'volvió el `min-width` del boceto: la landing se rompe en teléfono')
      .not.toContain('min-width');
  });

  it('🔴 UN solo breakpoint, como dice §6', () => {
    // Cada breakpoint que se agregue después es una decisión de Diseño, no una
    // comodidad de implementación. `prefers-reduced-motion` no cuenta: no es
    // un breakpoint de ancho.
    const anchos = [...cssDelBuild().matchAll(/@media[^{]*\(max-width:\s*(\d+)px\)/g)]
      .map((m) => m[1]!);
    expect(anchos, `breakpoints de ancho: ${anchos.join(', ')}`).toEqual(['640']);
  });

  it('🔴 los seis cambios de §6 están en el breakpoint', () => {
    const b = bloque640();
    const exigidos: Array<[string, RegExp]> = [
      ['el nav esconde las anclas', /\.nav-anchors\{[^}]*display:none/],
      ['los CTA del hero se apilan', /\.cta-row\{[^}]*flex-direction:column/],
      ['los pasos dejan de ser absolutos', /\.step\{[^}]*position:static/],
      ['el conector circular se oculta', /\.steps-connector\{[^}]*display:none/],
      ['la audiencia va a una columna', /\.audience\{[^}]*grid-template-columns:1fr/],
      ['los perks van a una columna', /\.perks\{[^}]*grid-template-columns:1fr/],
    ];
    const faltan = exigidos.filter(([, re]) => !re.test(b)).map(([q]) => q);
    expect(faltan, `§6 incompleto: ${faltan.join(' · ')}`).toEqual([]);
  });

  it('🔴 y el escritorio NO se tocó: las reglas base siguen ahí', () => {
    // La contracara. Un breakpoint que además rompe el escritorio pasaría los
    // tests de arriba igual.
    const css = cssDelBuild();
    const base = css.slice(0, css.indexOf('@media'));
    expect(base, 'el nav perdió sus anclas en escritorio').toMatch(/\.nav-anchors\{[^}]*display:flex/);
    expect(base, 'los pasos perdieron su posición circular').toMatch(/\.step\{[^}]*position:absolute/);
    expect(base, 'la audiencia perdió sus dos columnas').toMatch(/\.audience\{[^}]*grid-template-columns:1\.1fr 1fr/);
  });
});

describe('PROPIEDAD 8 · el contenido es el del boceto', () => {
  /**
   * No se congela cada string —la página es larga y sería mantenimiento puro—
   * pero sí la ESTRUCTURA de encabezados, que es lo que cambia cuando alguien
   * "mejora" la página. Si Diseño manda copy nuevo, esto se actualiza con él.
   */
  it('⭐ los encabezados son exactamente los que Diseño validó', () => {
    const enc = [...build.html.matchAll(/<(h[123])[^>]*>([\s\S]*?)<\/\1>/g)]
      .map((m) => `${m[1]} ${m[2]!.replace(/<[^>]+>/g, '').trim()}`);
    expect(enc).toEqual([
      'h1 Cada quien paga lo suyo, desde su teléfono',
      'h2 Cuatro pasos, una cuenta',
      'h3 Abre la mesa',
      'h3 Comparte el link',
      'h3 Cada quien elige',
      'h3 Pagan y listo',
      'h2 Tu equipo deja de pasar la terminal',
      'h2 Paga lo tuyo sin sacar cuentas',
    ]);
  });

  it('las tres anclas internas tienen su sección', () => {
    const anclas = [...build.html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]!);
    expect(new Set(anclas).size).toBeGreaterThan(0);
    for (const a of new Set(anclas)) {
      expect(build.html, `el ancla #${a} no lleva a ningún lado`).toContain(`id="${a}"`);
    }
  });
});

/**
 * 🔴 PROPIEDAD 9 SE MUDÓ · 2026-08-10 → `scripts/tokensRatificados.test.ts`.
 *
 * Existió unas horas acá y se retira por dos motivos, los dos de Diseño:
 *
 * 1. **Comparaba los dos artefactos ENTRE SÍ**, y eso sólo dice que difieren:
 *    no dice cuál tiene razón. El desempate lo ganaba el que alguien tocó
 *    último —antigüedad en vez de ratificación—. Ahora los dos se comparan
 *    contra un ESPEJO de `diseno/SISTEMA_DISENO.md`.
 * 2. **Gobernaba a la app desde el archivo de la LANDING.** Un test que decide
 *    sobre `src/styles/global.css` no se busca acá, y parte de por qué el
 *    README pudo jurar durante días una guarda inexistente es que su lugar
 *    natural estaba vacío.
 *
 * Las dos divergencias que encontró quedaron RESUELTAS por Diseño, no
 * registradas: `--brand-fg` gana `#FFFFFF` (la landing estaba vieja) y
 * `--teal-l` gana `#E4FBFC` (la app tenía deriva). `--sh-2`/`--sh-3` eran
 * falsa alarma: `0.1` y `0.10` escritos distinto.
 *
 * No se borró en silencio: queda esta nota, que es lo que faltó las otras
 * veces.
 */
