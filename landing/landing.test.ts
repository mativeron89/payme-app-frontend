import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

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
}

let build: Artefacto;

beforeAll(() => {
  // A un temporal y no a `dist-landing/`: así el test no depende de que
  // alguien haya corrido el build antes, ni deja el árbol sucio, ni mide un
  // artefacto viejo que quedó de otra corrida.
  const salida = mkdtempSync(join(tmpdir(), 'payme-landing-'));
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
  build = { archivos: archivos.map((a) => relative(salida, a)), html, todo };
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

describe('las prohibiciones de §2 del spec, sobre los bytes emitidos', () => {
  it('🔴 ni AuthProvider, ni capa de API, ni Stripe, ni el dashboard', () => {
    for (const prohibido of [
      'AuthProvider',
      'useAuth',
      'stripe',
      'Stripe',
      'payme-dashboard',
      'contract-mirror',
    ]) {
      expect(build.todo, `el artefacto contiene "${prohibido}"`).not.toContain(prohibido);
    }
  });

  it('🔴 cero fetch, cero storage, cero cookies', () => {
    for (const prohibido of ['fetch(', 'localStorage', 'sessionStorage', 'document.cookie', 'XMLHttpRequest']) {
      expect(build.todo, `el artefacto contiene "${prohibido}"`).not.toContain(prohibido);
    }
  });

  it('⭐ CERO HOSTS EXTERNOS · sin excepciones ni lista de perdón', () => {
    // La guarda que protege la decisión de no cargar fuentes de terceros: sin
    // esto, alguien copia el <head> de la webapp y la revierte sin enterarse.
    // Se barre el artefacto ENTERO —incluidos los comentarios— porque una
    // excepción "es sólo un comentario" es por donde vuelve.
    const hosts = [...build.todo.matchAll(/https?:\/\/[^\s"'<>)]+/g)].map((m) => m[0]);
    const ajenos = hosts.filter((u) => !DESTINOS_AUTORIZADOS.some((d) => u === d || u.startsWith(`${d}/`)));
    expect(ajenos, `hosts externos en el artefacto: ${ajenos.join(', ')}`).toEqual([]);
  });

  it('no hay preconnect, dns-prefetch ni preload a ningún lado', () => {
    expect(build.html).not.toMatch(/rel=["'](?:preconnect|dns-prefetch|preload|modulepreload)/i);
  });
});

describe('el contenido es el literal autorizado, y nada más', () => {
  it('🔴 los dos href son EXACTAMENTE los dos subdominios', () => {
    const hrefs = [...build.html.matchAll(/<a\b[^>]*href="([^"]*)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual([...DESTINOS_AUTORIZADOS]);
  });

  it('🔴 URLs ABSOLUTAS, que es lo que hace el seam de `payme-web`', () => {
    // Con rutas relativas la landing no se podría retirar de la raíz sin mover
    // `app.` ni `panel.`: el seam sería una intención escrita, no un hecho.
    for (const href of DESTINOS_AUTORIZADOS) expect(build.html).toContain(`href="${href}"`);
  });

  it('los accesos son ENLACES REALES, no divs con onClick', () => {
    expect(build.html).not.toMatch(/onclick/i);
    expect((build.html.match(/<a\b/g) ?? []).length).toBe(2);
  });

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
