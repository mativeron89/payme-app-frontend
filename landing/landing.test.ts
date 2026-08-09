import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
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

/** Lo único que la landing tiene derecho a apuntar hacia afuera. */
const DESTINOS_AUTORIZADOS = [
  'https://app.paymemx.com',
  'https://panel.paymemx.com',
] as const;

interface Artefacto {
  readonly archivos: readonly string[];
  readonly html: string;
  readonly todo: string;
  /** Contenido por ruta relativa, para poder mirar el CSS por separado. */
  readonly porArchivo: Readonly<Record<string, string>>;
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

  const html = archivos.filter((a) => a.endsWith('.html')).map((a) => readFileSync(a, 'utf8')).join('\n');
  const todo = archivos.map((a) => `${relative(salida, a)}\n${readFileSync(a, 'utf8')}`).join('\n');
  const porArchivo: Record<string, string> = {};
  for (const a of archivos) porArchivo[relative(salida, a)] = readFileSync(a, 'utf8');
  build = { archivos: archivos.map((a) => relative(salida, a)), html, todo, porArchivo };
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
  it('🔴 dos `<a>`, con los href exactos y en orden', () => {
    const anchors = tags(build.html).filter((t) => t.nombre === 'a');
    expect(anchors).toHaveLength(2);
    const hrefs = anchors.map((t) => atributos(t.crudo).find((a) => a.nombre === 'href')?.valor);
    expect(hrefs).toEqual([...DESTINOS_AUTORIZADOS]);
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

  function cssEmitido(): string {
    const css = build.archivos
      .filter((a) => a.endsWith('.css'))
      .map((a) => build.porArchivo[a] ?? '')
      .join('\n');
    expect(css.length, 'no se encontró CSS emitido: el test no probaría nada').toBeGreaterThan(100);
    return css;
  }

  it('🔴 MUTANTE · todo `url(...)` del CSS es RELATIVO al propio artefacto', () => {
    const ajenos = urlsDelCss(cssEmitido()).filter((u) => !esRelativo(u));
    expect(ajenos, `recursos del CSS fuera del origen: ${ajenos.join(' · ')}`).toEqual([]);
  });

  it('🔴 MUTANTE · ningún `data:` — no está autorizado, ni siquiera para fuentes', () => {
    // Se nombra aparte de `esRelativo` para que el mensaje de falla diga QUÉ
    // pasó: un `data:` embebido es una decisión de arquitectura, no un detalle
    // de empaquetado, y nadie la ratificó.
    expect(cssEmitido().toLowerCase(), 'hay un data: URI en el CSS').not.toContain('data:');
    expect(build.html.toLowerCase()).not.toContain('data:');
  });

  it('🔴 ningún `@import`, ni siquiera relativo', () => {
    // Más estricto que lo que pide la orden —que sólo prohíbe el externo— y a
    // propósito: la landing tiene UNA hoja por construcción, así que cualquier
    // `@import` es una segunda hoja que nadie decidió agregar.
    expect(cssEmitido()).not.toMatch(/@import/i);
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
    expect(textos).toEqual(['PayMe', 'Comensal', 'Restaurante']);
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
