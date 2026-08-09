import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * ⭐ CARRIL 1A · EL AISLAMIENTO DE LA LANDING, PROBADO SOBRE EL BUILD.
 *
 * ## Por qué sobre el build y no sobre los imports
 *
 * La orden lo pide así y tiene razón: *"sobre el bundle o el grafo real, no
 * sobre una lista de imports escrita a mano — una lista manual es la que nace
 * vieja"*. Un test que enumere qué NO se importa queda desactualizado el día
 * que alguien agrega un import; uno que mire el ARTEFACTO no puede quedar
 * viejo, porque el artefacto es lo que se sirve.
 *
 * Por eso este archivo **construye la landing de verdad** —`vite build` con su
 * propia config, a un temporal— y afirma sobre los bytes emitidos.
 *
 * ## La forma más fuerte de cumplir las prohibiciones: cero JS
 *
 * La landing son dos enlaces. No tiene una sola línea de JavaScript, así que
 * **no existe grafo de módulos donde `AuthProvider`, la capa de API o Stripe
 * puedan entrar**. La prohibición no se vigila: se vuelve imposible sin
 * cambiar la naturaleza del artefacto — y ese cambio es justo lo que el
 * primer test de abajo detecta.
 *
 * ## El mutante que las guardas tienen que matar
 *
 * *"Si alguien importa `AuthProvider` en la landing, ¿qué test se pone rojo?"*
 * Para importarlo hace falta un `<script type="module">`; sin él no hay dónde
 * escribir el import. Ese script lo mata **«el artefacto no tiene una sola
 * línea de JavaScript»**. Y el otro mutante que pidió la orden —pegar el
 * `<link>` de fuentes de la webapp— lo mata **«cero hosts externos»**.
 * Los dos se corrieron y se mostraron en rojo; está en el mensaje del commit.
 */

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..');

/**
 * Lo único que la landing tiene derecho a apuntar hacia afuera.
 *
 * 🔴 CAMBIÓ el 2026-08-09, y el motivo es el hallazgo más caro de la orden:
 * hasta hoy eran `https://app.paymemx.com` y `https://panel.paymemx.com`.
 * **Esos dominios NO EXISTEN** —no hay DNS ni hosting, la compuerta está
 * cerrada— así que publicar la landing con ellos habría entregado dos botones
 * que no llevan a ningún lado. Peor que no tener landing.
 *
 * El archivo no estaba mal escrito: **estaba escrito para el futuro
 * ratificado**. `D-WEB-1-BIS` manda esos tres orígenes y algún día van a ser
 * correctos. El defecto no era el destino, era la FECHA.
 *
 * 🔴 SEAM: cuando exista el DNS, esto vuelve a `app.` y `panel.` y la preview
 * se retira. Que el próximo que lo lea no crea que esto era la arquitectura.
 */
const DESTINOS_AUTORIZADOS = [
  'https://mativeron89.github.io/payme-app-frontend/',
] as const;

/**
 * 🔴 Dominios RATIFICADOS pero que TODAVÍA NO EXISTEN. Prohibidos como destino
 * hasta que la compuerta de DNS se abra.
 *
 * Ésta es la guarda que faltaba: la anterior verificaba que los destinos
 * fueran los autorizados, y ellos ERAN los autorizados — por el gobierno, no
 * por la realidad. **Estar ratificado y estar vivo son dos cosas distintas, y
 * un enlace sólo sirve si la segunda es cierta.**
 */
const DOMINIOS_SIN_DNS = ['app.paymemx.com', 'panel.paymemx.com'] as const;

interface Artefacto {
  readonly archivos: readonly string[];
  readonly html: string;
  /**
   * Todo el TEXTO emitido, concatenado, para los barridos de red.
   *
   * 🔴 FASE 4 · dice TEXTO y no "todo" a propósito. Desde que la landing sirve
   * su propia tipografía hay un binario de 176 KB en el artefacto, y leerlo
   * como utf8 para buscarle URLs adentro es un instrumento equivocado dos
   * veces: no encuentra las que SÍ tiene —la tabla `name` guarda el aviso de
   * copyright en UTF-16, o sea con un NUL entre letra y letra, que ningún
   * regex de `https?://` va a matchear— y en cambio puede inventar un
   * `//algo.com` con bytes que cayeron así por azar.
   *
   * Y sobre todo: **una URL adentro de un TTF no es una referencia.** El
   * navegador no la pide. Es el aviso de la OFL, que además NO SE PUEDE sacar
   * sin violar la licencia. Una guarda que la marcara estaría pidiendo algo
   * imposible, y se terminaría aflojando.
   *
   * Los binarios se verifican con el instrumento que corresponde: por hash,
   * abajo, contra una lista explícita.
   */
  readonly todo: string;
  /** Contenido por ruta relativa, para poder mirar el CSS por separado. */
  readonly porArchivo: Readonly<Record<string, string>>;
  /** Ruta relativa → SHA-256, sólo de los binarios emitidos. */
  readonly binarios: Readonly<Record<string, string>>;
  /** Rutas INERTES: se verifican por identidad, no se barren. */
  readonly inertes: readonly string[];
}

/**
 * El ÚNICO binario que este artefacto tiene derecho a emitir: la tipografía
 * propia, con el hash que Vite le agrega al nombre.
 *
 * Cualquier archivo que NO matchee esto se lee como texto y entra al barrido
 * de red — así, un binario nuevo dispara las dos guardas a la vez: falla la
 * lista de abajo (no está autorizado) y además lo barre el escáner de hosts.
 */
const BINARIO_AUTORIZADO = /^PlusJakartaSans-variable-[A-Za-z0-9_-]+\.ttf$/;

/**
 * 🔴 La licencia OFL es un archivo INERTE, y por eso no entra al barrido.
 *
 * Contiene `http://scripts.sil.org/OFL` y `github.com` en su aviso de
 * copyright: **texto que la licencia OBLIGA a incluir y que no se puede
 * sacar**. Un `.txt` servido como archivo estático no lo parsea nadie — no
 * hace una request ni ejecuta nada. Barrerlo buscando hosts marcaría algo
 * imposible de arreglar, y una guarda imposible se afloja el día que estorba.
 *
 * No se le hace una excepción: **se verifica con el otro instrumento**, por
 * identidad byte a byte contra la copia del repo (PROPIEDAD 5).
 */
const INERTE_AUTORIZADO = /^OFL-[A-Za-z]+\.txt$/;

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

/**
 * El CSS emitido, concatenado. Vive a nivel de módulo porque lo usan dos
 * propiedades distintas —la de recursos y la de tipografía— y tener dos
 * lectores del mismo artefacto es como se termina midiendo cosas distintas
 * sin darse cuenta.
 */
function cssDelBuild(): string {
  const css = build.archivos
    .filter((a) => a.endsWith('.css'))
    .map((a) => build.porArchivo[a] ?? '')
    .join('\n');
  expect(css.length, 'no se encontró CSS emitido: el test no probaría nada').toBeGreaterThan(100);
  return css;
}

let build: Artefacto;
/**
 * A5 · el temporal que crea ESTE test, para poder borrarlo después. Dos
 * corridas de Codex dejaron dos `payme-landing-*` colgados en `/tmp`: crear y
 * no limpiar es basura que se acumula en la máquina de otro.
 *
 * 🔴 Se guarda LA RUTA QUE CREAMOS, no un glob de `payme-landing-*`: barrer
 * por patrón borraría el temporal de una corrida ajena que esté en curso.
 */
let temporal: string | null = null;

afterAll(() => {
  // `finally` de facto: corre aunque el `beforeAll` o los tests hayan fallado.
  if (temporal) rmSync(temporal, { recursive: true, force: true });
  temporal = null;
});

beforeAll(() => {
  // A un temporal y no a `dist-landing/`: así el test no depende de que
  // alguien haya corrido el build antes, ni deja el árbol sucio, ni mide un
  // artefacto viejo que quedó de otra corrida.
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
  build = { archivos: archivos.map((a) => relative(salida, a)), html, todo, porArchivo, binarios, inertes };
}, 60_000);

describe('el artefacto de la landing existe y es lo que dice ser', () => {
  it('el build produjo algo (si no, todo lo de abajo pasaría en vacío)', () => {
    expect(build.archivos.length).toBeGreaterThan(0);
    expect(build.archivos).toContain('index.html');
    expect(build.html).toContain('PayMe');
  });

  it('🔴 el README de decisiones NO se publica', () => {
    // Contiene a propósito las cadenas que las guardas prohíben —las nombra
    // para explicarlas— así que si algún día terminara emitido, los tests de
    // abajo se pondrían rojos por el motivo equivocado. Esto lo dice directo,
    // y además protege lo que importa: una página pública no le cuenta su
    // arquitectura interna a quien mire el fuente.
    expect(build.archivos.filter((a) => /readme/i.test(a))).toEqual([]);
  });

  it('🔴 MUTANTE · el artefacto NO tiene una sola línea de JavaScript', () => {
    // Ésta es la guarda que mata el import de `AuthProvider`: para importar
    // algo hace falta un módulo, y para cargar un módulo hace falta un script.
    const js = build.archivos.filter((a) => /\.(js|mjs|cjs|jsx|ts|tsx)$/.test(a));
    expect(js, `el build emitió JavaScript: ${js.join(', ')}`).toEqual([]);
    expect(build.html).not.toMatch(/<script/i);
  });
});

/**
 * 🔴 A3 · TRES PROPIEDADES DISTINTAS, SEPARADAS — antes estaban mezcladas en
 * una sola y por eso probaban menos de lo que declaraban. Codex encontró
 * cuatro agujeros y los cuatro venían de la misma confusión.
 *
 * El peor: `DESTINOS_AUTORIZADOS` se usaba como **permiso global de URL**, así
 * que una hoja de estilos servida desde `https://app.paymemx.com/x.css`
 * pasaba. Y no debería: esos dos orígenes están autorizados como **DESTINOS DE
 * NAVEGACIÓN** —adonde mandamos a la persona cuando toca— **no como orígenes
 * de recursos** que el navegador carga solo, antes de que nadie toque nada.
 * Son dos permisos con nombres parecidos y consecuencias muy distintas.
 *
 * Los otros tres: el regex de hosts sólo veía `http(s)://` y no
 * `//host` protocol-relative; los handlers inline sólo buscaban `onclick` y no
 * `onload`/`onerror`/ningún `on*=`; y "cero JavaScript" no rechazaba
 * `javascript:`, que ejecuta sin ser un `<script>`.
 */

/**
 * ¿El valor apunta al PROPIO origen? Sólo lo relativo. Ni `//host`
 * protocol-relative, ni ningún esquema —`https:`, `http:`, `data:`—, ni
 * siquiera los subdominios de PayMe: son destinos de navegación, no
 * proveedores de recursos.
 */
function esRelativo(valor: string): boolean {
  const v = valor.trim();
  if (!v) return true;
  if (v.startsWith('//')) return false;                   // protocol-relative
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(v)) return false;  // cualquier esquema
  return true;
}

/** Atributos que hacen que el NAVEGADOR cargue algo por su cuenta. */
const ATRIBUTOS_DE_RECURSO = [
  'src', 'srcset', 'poster', 'data', 'action', 'formaction', 'manifest', 'background', 'ping',
];

/** Cada tag del HTML con su nombre y su texto crudo de atributos. */
function tags(html: string): Array<{ nombre: string; crudo: string }> {
  return [...html.matchAll(/<([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g)]
    .map((m) => ({ nombre: m[1]!.toLowerCase(), crudo: m[2]! }));
}

/**
 * Los atributos de un tag, **en las TRES formas que acepta HTML**.
 *
 * 🔴 FASE 2 · A — antes esto sólo reconocía `attr="valor"`, y las otras dos
 * pasaban por abajo de todas las guardas. Los dos casos sin comillas son los
 * peores porque **son HTML perfectamente válido** y el navegador los ejecuta
 * igual:
 *
 *     <link rel=stylesheet href=https://app.paymemx.com/x.css>
 *     <body onload=alert(1)>
 *
 * Un parser que cubre un solo formato no es una guarda parcial: es una guarda
 * que se puede esquivar sin esfuerzo y sin mala fe — basta con no poner
 * comillas.
 *
 * El orden de las alternativas importa: primero las comilladas (que pueden
 * contener espacios), y el caso sin comillas al final, terminado por espacio o
 * fin de tag.
 */
function atributos(crudo: string): Array<{ nombre: string; valor: string }> {
  const re = /([a-zA-Z_:][a-zA-Z0-9_:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  return [...crudo.matchAll(re)].map((m) => ({
    nombre: m[1]!.toLowerCase(),
    // Exactamente una de las tres alternativas matcheó.
    valor: m[2] ?? m[3] ?? m[4] ?? '',
  }));
}

describe('PROPIEDAD 1 · exactamente dos anchors de navegación', () => {
  it('🔴 los `<a>` son exactamente los destinos autorizados, y en orden', () => {
    const anchors = tags(build.html).filter((t) => t.nombre === 'a');
    expect(anchors).toHaveLength(DESTINOS_AUTORIZADOS.length);
    const hrefs = anchors.map((t) => atributos(t.crudo).find((a) => a.nombre === 'href')?.valor);
    expect(hrefs).toEqual([...DESTINOS_AUTORIZADOS]);
  });

  it('🔴 MUTANTE · ningún enlace apunta a un dominio que TODAVÍA NO EXISTE', () => {
    // La guarda que faltaba. Publicar un botón hacia un dominio sin DNS es
    // peor que no publicarlo: la persona toca y no pasa nada.
    const ofensores: string[] = [];
    for (const d of DOMINIOS_SIN_DNS) {
      if (build.todo.includes(d)) ofensores.push(d);
    }
    expect(ofensores, `destinos sin DNS en el artefacto: ${ofensores.join(' · ')}`).toEqual([]);
  });

  it('🔴 el acceso al panel existe pero NO es un enlace, y lo dice', () => {
    // Honesto, no roto: sin `href`, con su leyenda, y visualmente distinto.
    // Si alguien lo convierte en `<a>` apuntando a cualquier lado, cae acá.
    expect(build.html, 'falta el acceso al panel').toContain('landing-acceso-pronto');
    expect(build.html, 'el acceso al panel no avisa que todavía no está')
      .toMatch(/Restaurante[\s\S]{0,60}Muy pronto/);
    const anchors = tags(build.html).filter((t) => t.nombre === 'a');
    expect(anchors.some((a) => /Restaurante/.test(a.crudo)), 'el panel volvió a ser un enlace')
      .toBe(false);
  });

  it('🔴 CASO LEGÍTIMO · el acceso del comensal SÍ es un enlace vivo', () => {
    // La contracara: prohibir los dos habría dejado la página sin ninguna
    // salida, que es el otro modo de arruinarla.
    const anchors = tags(build.html).filter((t) => t.nombre === 'a');
    expect(anchors.length, 'no quedó ningún acceso navegable').toBeGreaterThan(0);
    const href = atributos(anchors[0]!.crudo).find((a) => a.nombre === 'href')?.valor ?? '';
    expect(href).toBe(DESTINOS_AUTORIZADOS[0]);
    expect(href, 'el destino del comensal no es absoluto').toMatch(/^https:\/\//);
  });

  it('🔴 las tres formas de atributo se parsean, no sólo la comillada', () => {
    // Sonda del propio parser: si dejara de ver alguna forma, las guardas de
    // abajo pasarían en vacío sin que nadie se entere.
    const muestra = atributos(` a="uno" b='dos' c=tres d = cuatro `);
    expect(muestra).toEqual([
      { nombre: 'a', valor: 'uno' },
      { nombre: 'b', valor: 'dos' },
      { nombre: 'c', valor: 'tres' },
      { nombre: 'd', valor: 'cuatro' },
    ]);
  });

  it('🔴 los recursos del HTML salen RELATIVOS (`base: \'./\'`)', () => {
    // Sin esto la landing carga bajo un prefijo y NO aparece ni un estilo:
    // `/assets/…` apunta a la raíz del dominio, no a la del artefacto. Falla
    // en silencio, que es lo peor que puede hacer.
    const recursos = [...build.html.matchAll(/(?:href|src)="([^"]*)"/g)].map((m) => m[1]!)
      .filter((v) => v.includes('assets/') || v.endsWith('.css') || v.endsWith('.js'));
    expect(recursos.length, 'no se encontró ningún recurso en el HTML').toBeGreaterThan(0);
    for (const r of recursos) expect(r, `${r} no es relativo`).toMatch(/^\.\//);
  });

  it('🔴 URLs ABSOLUTAS: es lo que hace el seam de `payme-web`', () => {
    // Con rutas relativas la landing no se podría retirar de la raíz sin mover
    // `app.` ni `panel.`: el seam sería una intención escrita, no un hecho.
    for (const href of DESTINOS_AUTORIZADOS) expect(build.html).toContain(`href="${href}"`);
  });
});

describe('PROPIEDAD 2 · cero recursos cross-origin o de terceros', () => {
  /**
   * 🔴 Acá NO se consulta `DESTINOS_AUTORIZADOS`, y es el punto entero de la
   * separación: un recurso sólo puede ser RELATIVO al propio origen. Ni
   * `https://`, ni `//host`, ni `http://`, ni siquiera los dos subdominios de
   * PayMe — que son destinos de navegación, no proveedores de assets.
   */
  it('🔴 MUTANTE · ningún atributo de recurso apunta fuera del origen', () => {
    const ajenos: string[] = [];
    for (const t of tags(build.html)) {
      for (const a of atributos(t.crudo)) {
        const esRecurso = ATRIBUTOS_DE_RECURSO.includes(a.nombre)
          // `href` es recurso en TODO menos en un anchor: `<link>`, `<base>`…
          || (a.nombre === 'href' && t.nombre !== 'a');
        if (esRecurso && !esRelativo(a.valor)) ajenos.push(`<${t.nombre} ${a.nombre}="${a.valor}">`);
      }
    }
    expect(ajenos, `recursos que no son del propio origen: ${ajenos.join(' · ')}`).toEqual([]);
  });

  /**
   * 🔴 FASE 3 · la guarda del CSS deja de prohibir `url(...)` A SECAS.
   *
   * Prohibirlo entero era correcto mientras la landing no tenía ningún
   * recurso propio. Al auto-hospedar las tipografías **va a haber `url(...)`
   * legítimos** —los `.woff2` que emite este mismo artefacto— y una guarda
   * que los rechace obligaría a aflojarla justo cuando más hace falta.
   *
   * Lo que se prohíbe no es la FORMA sino el ORIGEN: un recurso del CSS sólo
   * puede ser **relativo al propio artefacto**. Y `DESTINOS_AUTORIZADOS` NO se
   * consulta acá — la separación de 1B se mantiene: los dos subdominios son
   * destinos de navegación, nunca proveedores de recursos.
   */
  function urlsDelCss(css: string): string[] {
    return [...css.matchAll(/url\(\s*(['"]?)([^'")]*)\1\s*\)/g)].map((m) => m[2]!.trim());
  }

  it('🔴 MUTANTE · todo `url(...)` del CSS es RELATIVO al propio artefacto', () => {
    const ajenos = urlsDelCss(cssDelBuild()).filter((u) => !esRelativo(u));
    expect(ajenos, `recursos del CSS fuera del origen: ${ajenos.join(' · ')}`).toEqual([]);
  });

  it('🔴 CASO LEGÍTIMO · la tipografía propia SÍ pasa la guarda', () => {
    // La contracara del mutante, y la que no se puede deducir de él: cinco
    // mutantes en rojo son compatibles con una guarda que rechaza TODO. Esta
    // afirma que el `url(...)` que el artefacto emite de verdad —el `.ttf`
    // propio— está y es aceptado. Si mañana alguien endurece `esRelativo`
    // hasta prohibir la forma, se entera acá y no en producción.
    const propias = urlsDelCss(cssDelBuild()).filter((u) => u.endsWith('.ttf'));
    expect(propias, 'el CSS no referencia ninguna tipografía propia').not.toEqual([]);
    for (const u of propias) expect(esRelativo(u), `${u} no se aceptó como propia`).toBe(true);
  });

  it('🔴 MUTANTE · ningún `data:` — no está autorizado, ni siquiera para fuentes', () => {
    // Se nombra aparte de `esRelativo` para que el mensaje de falla diga QUÉ
    // pasó: un `data:` embebido es una decisión de arquitectura, no un detalle
    // de empaquetado, y nadie la ratificó.
    expect(cssDelBuild().toLowerCase(), 'hay un data: URI en el CSS').not.toContain('data:');
    expect(build.html.toLowerCase()).not.toContain('data:');
  });

  it('🔴 ningún `@import`, ni siquiera relativo', () => {
    // Más estricto que lo que pide la orden —que sólo prohíbe el externo— y a
    // propósito: la landing tiene UNA hoja por construcción, así que cualquier
    // `@import` es una segunda hoja que nadie decidió agregar.
    expect(cssDelBuild()).not.toMatch(/@import/i);
  });

  it('🔴 MUTANTE · ni protocol-relative ni ningún host en el artefacto entero', () => {
    // Barrido de red, además del estructural: incluye comentarios, porque una
    // excepción "es sólo un comentario" es por donde vuelve la cosa real.
    const conEsquema = [...build.todo.matchAll(/\bhttps?:\/\/[^\s"'<>)]+/g)].map((m) => m[0]);
    const ajenos = conEsquema.filter(
      (u) => !DESTINOS_AUTORIZADOS.some((d) => u === d || u.startsWith(`${d}/`)),
    );
    expect(ajenos, `hosts externos: ${ajenos.join(', ')}`).toEqual([]);
    // Protocol-relative: `//host` que no sea parte de un `esquema://`.
    const protocolRelative = [...build.todo.matchAll(/(^|[^:a-zA-Z0-9])\/\/[a-zA-Z0-9-]+\.[a-zA-Z]{2,}/g)];
    expect(protocolRelative.map((m) => m[0].trim()), 'URLs protocol-relative').toEqual([]);
  });

  it('no hay preconnect, dns-prefetch ni preload a ningún lado', () => {
    expect(build.html).not.toMatch(/rel=["'](?:preconnect|dns-prefetch|preload|modulepreload)/i);
  });
});

describe('PROPIEDAD 3 · cero ejecución, en cualquiera de sus formas', () => {
  it('🔴 MUTANTE · ningún handler inline: `on*=`, no sólo `onclick`', () => {
    const conHandler = tags(build.html)
      .flatMap((t) => atributos(t.crudo).map((a) => ({ t, a })))
      .filter(({ a }) => /^on[a-z]+$/.test(a.nombre));
    expect(conHandler.map(({ t, a }) => `<${t.nombre} ${a.nombre}>`)).toEqual([]);
  });

  it('🔴 MUTANTE · ningún `javascript:` en ningún atributo', () => {
    // Ejecuta sin ser un `<script>`: "cero JavaScript" no lo cubría.
    expect(build.todo.toLowerCase()).not.toContain('javascript:');
  });

  it('🔴 MUTANTE · ningún `meta refresh`', () => {
    // Es navegación automática: manda a la persona a otro lado sin que toque.
    expect(build.html).not.toMatch(/<meta[^>]+http-equiv\s*=\s*["']?\s*refresh/i);
  });

  it('🔴 ni iframe, ni object, ni embed, ni formulario', () => {
    const prohibidos = tags(build.html)
      .map((t) => t.nombre)
      .filter((n) => ['script', 'iframe', 'object', 'embed', 'form', 'base'].includes(n));
    expect(prohibidos).toEqual([]);
  });

  it('el artefacto no contiene AuthProvider, la capa de API, Stripe ni el dashboard', () => {
    for (const prohibido of ['AuthProvider', 'useAuth', 'stripe', 'Stripe', 'payme-dashboard', 'contract-mirror']) {
      expect(build.todo, `el artefacto contiene "${prohibido}"`).not.toContain(prohibido);
    }
  });

  it('cero fetch, cero storage, cero cookies', () => {
    for (const prohibido of ['fetch(', 'localStorage', 'sessionStorage', 'document.cookie', 'XMLHttpRequest']) {
      expect(build.todo, `el artefacto contiene "${prohibido}"`).not.toContain(prohibido);
    }
  });

  it('🔴 A4 · CERO COMENTARIOS HTML en el artefacto', () => {
    // Los comentarios viajan al navegador. La primera versión de esta página
    // explicaba sus prohibiciones nombrándolas, y además le contaba su
    // arquitectura a cualquiera que mirara el fuente. El porqué vive en
    // `landing/README.md`, que no se emite.
    const comentarios = [...build.html.matchAll(/<!--[\s\S]*?-->/g)].map((m) => m[0]);
    expect(comentarios, `comentarios en el HTML público: ${comentarios.join(' · ')}`).toEqual([]);
  });
});

/**
 * 🔴 PROPIEDAD 4 · LA TIPOGRAFÍA ES PROPIA, Y ES LA MISMA.
 *
 * `D-FUENTES-1`, superficie 2. Acá se verifican tres cosas que la PROPIEDAD 2
 * no puede: que el binario emitido sea EXACTAMENTE el del repo, que la copia
 * de la landing no haya derivado de la de la webapp, y que el CSS realmente lo
 * use — un artefacto que arrastra 176 KB que nadie referencia es peor que uno
 * sin tipografía propia.
 *
 * La duplicación con `src/assets/fonts/` es deliberada (`D-WEB-1-BIS`: otro
 * ORIGEN), y por eso necesita gate: dos copias sin comparador es como nace la
 * deriva. Mismo patrón que los tokens de color de acá abajo y que el
 * `contract-mirror`.
 */
describe('PROPIEDAD 4 · la tipografía es propia, y es la misma de siempre', () => {
  const rutaLanding = join(RAIZ, 'landing', 'fonts', 'PlusJakartaSans-variable.ttf');
  const rutaWebapp = join(RAIZ, 'src', 'assets', 'fonts', 'PlusJakartaSans-variable.ttf');

  /**
   * El hash del upstream, escrito a mano. Comparar las dos copias entre sí no
   * alcanza: si alguien reemplaza LAS DOS por otro archivo, seguirían
   * coincidiendo. Este número las ancla al binario que se descargó y que el
   * README publica.
   */
  const SHA_UPSTREAM = '89b3fb38aa0d275d7a731d0d817a4f1622b316b4d7fbdedcf02ee9099ff68bc8';

  it('🔴 el artefacto emite UN solo binario, y es la tipografía', () => {
    const emitidos = Object.keys(build.binarios);
    // Si el detector dejara de matchear, `binarios` quedaría vacío y las
    // afirmaciones de abajo pasarían en vacío. Por eso se exige el 1 primero.
    expect(emitidos, `binarios emitidos: ${emitidos.join(' · ') || 'ninguno'}`).toHaveLength(1);
  });

  it('🔴 el binario emitido es byte-idéntico al del repo, y al upstream', () => {
    const [emitido] = Object.values(build.binarios);
    expect(emitido).toBe(SHA_UPSTREAM);
    expect(sha256(readFileSync(rutaLanding)), 'la copia de la landing').toBe(SHA_UPSTREAM);
  });

  it('🔴 MUTANTE · las dos copias del repo no derivaron', () => {
    // La de la landing y la de la webapp son el MISMO archivo duplicado a
    // propósito. Si alguien actualiza una sola, esto se pone rojo con los dos
    // hashes en el mensaje.
    const landing = sha256(readFileSync(rutaLanding));
    const webapp = sha256(readFileSync(rutaWebapp));
    expect(landing, `landing ${landing} ≠ webapp ${webapp}`).toBe(webapp);
  });

  it('🔴 el CSS REFERENCIA el binario emitido — no es peso muerto', () => {
    const referencias = [...cssDelBuild().matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)]
      .map((m) => basename(m[1]!.trim()));
    const emitido = basename(Object.keys(build.binarios)[0] ?? '');
    expect(referencias, `el CSS pide ${referencias.join(', ')} y el build emitió ${emitido}`)
      .toContain(emitido);
  });

  it('🔴 `font-display: swap` — nadie se queda mirando texto invisible', () => {
    const css = cssDelBuild();
    const caras = [...css.matchAll(/@font-face\s*\{[^}]*\}/g)].map((m) => m[0]);
    expect(caras.length, 'no hay ningún @font-face: el test no probaría nada').toBeGreaterThan(0);
    for (const cara of caras) {
      expect(cara, `un @font-face sin swap: ${cara}`).toMatch(/font-display\s*:\s*swap/);
    }
  });

  it('🔴 la cadena conserva su fallback de sistema', () => {
    // Es lo que se ve durante el `swap` y lo único que queda si el binario
    // falla. Un `--font-display: 'Plus Jakarta Sans'` a secas dejaría la
    // página sin plan B.
    expect(cssDelBuild()).toMatch(/--font-display:[^;]*sans-serif/);
  });
});

/**
 * 🔴 PROPIEDAD 5 · LA LICENCIA VIAJA CON EL ARTEFACTO.
 *
 * La landing distribuye Plus Jakarta Sans, así que la cláusula 2 de la OFL le
 * exige llevar el aviso **y la licencia**. Hasta hoy emitía el `.ttf` y ningún
 * `OFL`: el texto estaba en el repo, que no es donde la licencia lo pide.
 *
 * Y la lista de licencias requeridas **se deriva de lo que el artefacto
 * emite**, no está escrita a mano: si algún día la landing suma una familia,
 * su licencia se vuelve obligatoria sola.
 */
/**
 * 🔴 PROPIEDAD 6 · LAS EVASIONES SE PROHÍBEN, NO SE PARSEAN.
 *
 * Codex enumeró seis formas de esquivar el parser de atributos: un `>` dentro
 * de un valor citado, entities en las URLs, `srcset` con varias entradas,
 * `style="…url(…)"` inline y escapes CSS.
 *
 * **Escribir un parser HTML correcto para cubrirlas es la respuesta
 * equivocada**, y no por pereza: sería código nuevo, sin dependencia que lo
 * respalde, custodiando una página de DIECINUEVE LÍNEAS. Un parser propio con
 * un bug es indistinguible de no tener guarda — y ya pasó acá, cuando el
 * parser veía una sola de las tres formas de comilla.
 *
 * La landing no necesita NINGUNA de esas formas. Así que se rechazan por
 * no-necesarias, que es una regla que no se puede evadir porque no depende de
 * interpretar bien lo que se escribió.
 *
 * ## La allowlist de atributos es la que mata cinco de un tiro
 *
 * `srcset`, `style`, cualquier `on*`, `formaction`, `data`, `ping`: no están
 * en la lista, así que son rojo sin necesidad de nombrarlos. Y lo que aparezca
 * mañana con un nombre que nadie anticipó, también.
 */
describe('PROPIEDAD 6 · fail-closed: sólo lo que la landing necesita', () => {
  /** Todo lo que las 19 líneas usan de verdad. Nada más entra. */
  const ATRIBUTOS_PERMITIDOS = [
    'lang', 'charset', 'name', 'content', 'rel', 'href', 'class', 'aria-label',
  ];

  it('🔴 MUTANTE · ningún atributo fuera de la allowlist (mata srcset, style y on*)', () => {
    const ajenos: string[] = [];
    for (const t of tags(build.html)) {
      for (const a of atributos(t.crudo)) {
        if (!ATRIBUTOS_PERMITIDOS.includes(a.nombre)) ajenos.push(`<${t.nombre} ${a.nombre}>`);
      }
    }
    expect(ajenos, `atributos no autorizados: ${ajenos.join(' · ')}`).toEqual([]);
  });

  it('🔴 CASO LEGÍTIMO · los ocho atributos que la página SÍ usa se aceptan', () => {
    // Sin esto, una allowlist vacía dejaría el mutante en rojo igual y nadie
    // notaría que rompió la página entera.
    const usados = new Set(tags(build.html).flatMap((t) => atributos(t.crudo).map((a) => a.nombre)));
    expect(usados.size, 'no se leyó ningún atributo: el parser dejó de ver').toBeGreaterThan(4);
    for (const u of usados) expect(ATRIBUTOS_PERMITIDOS, `${u} debería estar permitido`).toContain(u);
  });

  it('🔴 MUTANTE · ninguna entity en el HTML', () => {
    // `&#x68;ttps://…` esquiva cualquier comparación de cadena. La landing no
    // tiene un solo carácter que necesite escaparse, así que se prohíben todas
    // —numéricas y con nombre— en vez de intentar decodificarlas bien.
    const entities = [...build.html.matchAll(/&(#[0-9]+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]{1,31});/g)]
      .map((m) => m[0]);
    expect(entities, `entities en el HTML: ${entities.join(' · ')}`).toEqual([]);
  });

  it('🔴 MUTANTE · ningún `>` dentro de un valor citado', () => {
    // Trunca el regex de tags y todo lo que venga después del tag queda sin
    // mirar. No se resuelve parseando mejor: se prohíbe, porque ningún valor
    // de esta página lo necesita.
    const citados = [...build.html.matchAll(/=\s*("([^"]*)"|'([^']*)')/g)]
      .map((m) => m[2] ?? m[3] ?? '');
    const conMayor = citados.filter((v) => v.includes('>'));
    expect(conMayor, `valores con '>' adentro: ${conMayor.join(' · ')}`).toEqual([]);
  });

  it('🔴 MUTANTE · ningún escape CSS ni entity en la hoja', () => {
    // `\75 rl(...)` es `url(...)` para el navegador y no matchea ningún regex
    // de `url(`. La hoja de la landing no tiene ningún carácter que escapar.
    const css = cssDelBuild();
    const escapes = [...css.matchAll(/\\[0-9a-fA-F]{1,6}\s?/g)].map((m) => m[0]);
    expect(escapes, `escapes CSS: ${escapes.join(' · ')}`).toEqual([]);
    expect(css, 'hay una barra invertida en el CSS').not.toContain('\\');
  });

  it('🔴 CASO LEGÍTIMO · el CSS real pasa las cuatro prohibiciones', () => {
    // La contracara: las reglas de arriba no pueden ser tan anchas que la hoja
    // que de verdad se emite no las cumpla.
    const css = cssDelBuild();
    expect(css, 'la hoja emitida perdió su tipografía propia').toContain('@font-face');
    expect(css).toContain('.ttf');
  });
});

describe('PROPIEDAD 5 · la licencia viaja con la tipografía', () => {
  it('🔴 cada tipografía emitida tiene su licencia COMPLETA en el artefacto', () => {
    const familias = Object.keys(build.binarios).map((a) =>
      basename(a).replace(/-variable-[A-Za-z0-9_-]+\.ttf$/, ''),
    );
    expect(familias.length, 'el artefacto no emitió ninguna tipografía').toBeGreaterThan(0);

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

  it('🔴 la licencia emitida es byte-idéntica a la del repo', () => {
    expect(build.inertes.length, 'no se clasificó ningún archivo inerte').toBe(1);
    for (const ruta of build.inertes) {
      const emitido = sha256(Buffer.from(build.porArchivo[ruta] ?? '', 'utf8'));
      const enRepo = sha256(readFileSync(join(RAIZ, 'landing/public', ruta)));
      expect(emitido, `${ruta} difiere del repo`).toBe(enRepo);
    }
  });

  it('🔴 y el INERTE no se coló al barrido de hosts por accidente', () => {
    // Sonda de la clasificación: si `INERTE_AUTORIZADO` dejara de matchear, el
    // `.txt` volvería a `todo` y la PROPIEDAD 2 se pondría roja por un archivo
    // que la licencia obliga a incluir. Esto lo dice antes y con nombre.
    expect(build.todo, 'la licencia entró al texto barrido').not.toContain('scripts.sil.org');
    expect(build.inertes).toEqual(['fonts/OFL-PlusJakartaSans.txt']);
  });
});

describe('el contenido es el literal autorizado, y nada más', () => {
  it('⭐ el copy es sólo PayMe / Comensal / Restaurante — sin tagline', () => {
    // El copy está ABIERTO y es decisión de Mati. Este test es lo que impide
    // que alguien "mejore" la página con una línea de presentación: cualquier
    // texto visible que no sea uno de los tres rompe acá.
    const cuerpo = build.html
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<head[\s\S]*?<\/head>/i, '')
      .replace(/<[^>]+>/g, '\n');
    const textos = cuerpo.split('\n').map((t) => t.trim()).filter(Boolean);
    // 🔴 «Muy pronto» se suma el 2026-08-09 y NO es copy nuevo por gusto: es
    // lo que hace que el acceso sin destino se lea como deliberado y no como
    // roto. Sale el día que el panel tenga adónde ir.
    expect(textos).toEqual(['PayMe', 'Comensal', 'Restaurante', 'Muy pronto']);
  });

  it('no promete nada de lo que §3 prohíbe prometer', () => {
    for (const prohibido of ['Apple Pay', 'Google Pay', 'sin cuenta', 'instalá', 'Instalá', 'gratis']) {
      expect(build.html, `la landing dice "${prohibido}"`).not.toContain(prohibido);
    }
  });
});

describe('calidad exigible de §4', () => {
  it('`lang="es-MX"`, no `es` a secas', () => {
    expect(build.html).toMatch(/<html[^>]*\blang="es-MX"/);
  });

  it('el mínimo táctil de 44px está declarado y llega al enlace', () => {
    const css = build.todo;
    expect(css).toContain('--tap-min: 44px');
    expect(css).toMatch(/min-height:\s*var\(--tap-min\)/);
  });

  it('foco visible propio, y motion que se apaga si la persona lo pidió', () => {
    expect(build.todo).toContain(':focus-visible');
    expect(build.todo).toContain('prefers-reduced-motion');
  });

  it('los DOS accesos van navy: ninguno se declara principal', () => {
    // Pintar uno de --brand sería declararlo la acción principal, y cuál es la
    // principal es una decisión de producto que no está tomada (§5).
    expect(build.todo).not.toContain('#ff6b35');
    expect(build.todo).not.toContain('--brand');
  });
});

describe('los tokens son los del sistema, no unos parecidos', () => {
  /**
   * La landing no importa `global.css` —113 KB de shell autenticado para usar
   * doce tokens— así que los COPIA. Copiar sin gate es deriva garantizada, y
   * por eso el gate: se parsean los dos archivos y se exige que coincidan.
   * Mismo patrón que el `contract-mirror`: replicar y poner una guarda encima.
   */
  const sistema = readFileSync(join(RAIZ, 'src', 'styles', 'global.css'), 'utf8');
  const landing = readFileSync(join(AQUI, 'landing.css'), 'utf8');

  function token(css: string, nombre: string): string | null {
    const m = css.match(new RegExp(`^\\s*--${nombre}:\\s*([^;]+);`, 'm'));
    return m ? m[1]!.trim() : null;
  }

  /** Los que la landing declara, leídos de su propio `:root`. */
  const declarados = [...landing.matchAll(/^\s*--([a-z0-9-]+):/gm)].map((m) => m[1]!);

  it('la landing declara tokens (si no, el bucle de abajo no probaría nada)', () => {
    expect(declarados.length).toBeGreaterThan(8);
  });

  it('🔴 cada token de la landing tiene el MISMO valor que en el sistema', () => {
    for (const nombre of declarados) {
      const delSistema = token(sistema, nombre);
      expect(delSistema, `--${nombre} no existe en global.css: o se inventó, o el sistema lo renombró`).not.toBeNull();
      expect(token(landing, nombre), `--${nombre} derivó respecto del sistema`).toBe(delSistema);
    }
  });
});
