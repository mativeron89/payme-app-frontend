import { describe, expect, it } from 'vitest';
import {
  MINIMO_DE_ESTE_BUILD_MS,
  SPLASH_MINIMO_MS,
  SPLASH_RENDICION_MS,
  demoraDeRetiro,
  desdeElPrimerCuadro,
} from './splash';

const CRUDOS = import.meta.glob(['/index.html', '/src/main.tsx', '/src/styles/global.css'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const INDEX = CRUDOS['/index.html'];
const MAIN = CRUDOS['/src/main.tsx'];
const GLOBAL = CRUDOS['/src/styles/global.css']!;

/** Las fuentes que podrían nombrar la marca de la e2e: el código, las pruebas, los scripts y la configuración. */
const FUENTES = import.meta.glob(
  ['/src/**/*.{ts,tsx}', '/e2e/**/*.{ts,mjs}', '/scripts/**/*.{ts,mjs,sh}', '/*.{ts,json,html}', '/.github/**/*.yml'],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

describe('🔴 D292 · la pantalla de carga siempre, al menos 2 segundos (Mati, 2026-10-12, adenda 2)', () => {
  /** La decisión entera está en esta función: lo que falta para completar el mínimo desde el primer cuadro pintado. */
  it('la app monta antes del mínimo: espera lo que falta', () => {
    expect(SPLASH_MINIMO_MS).toBe(2_000);
    expect(demoraDeRetiro(0)).toBe(2_000);
    expect(demoraDeRetiro(120)).toBe(1_880);
    expect(demoraDeRetiro(1_000)).toBe(1_000);
    expect(demoraDeRetiro(1_999)).toBe(1);
  });

  it('la app tarda más: ya cumplió el mínimo, se funde enseguida (nunca una demora negativa)', () => {
    expect(demoraDeRetiro(SPLASH_MINIMO_MS)).toBe(0);
    expect(demoraDeRetiro(5_000)).toBe(0);
    expect(demoraDeRetiro(60_000)).toBe(0);
  });

  it('con otro mínimo (el del servidor de la e2e: 0), se funde enseguida', () => {
    expect(demoraDeRetiro(0, 0)).toBe(0);
    expect(demoraDeRetiro(300, 0)).toBe(0);
  });

  /**
   * 🔴 D300 · los 2 s se cuentan desde el primer cuadro pintado, no desde que empezó la navegación. Con una página que
   * tardó 3 s en llegar y una app que monta enseguida, contarlos desde la navegación retiraba la pantalla al montar.
   */
  describe('🔴 D300 · desde el primer cuadro pintado', () => {
    const fcp = (t: number) => ({ name: 'first-contentful-paint', startTime: t });

    it('cuenta desde `first-contentful-paint`', () => {
      expect(desdeElPrimerCuadro([fcp(3_100)], 3_300)).toBe(3_100);
      // La navegación tardó 3 s y la app montó 200 ms después del primer cuadro: faltan 1,8 s, no 0.
      expect(demoraDeRetiro(3_300 - desdeElPrimerCuadro([fcp(3_100)], 3_300))).toBe(1_800);
      // Con la página rápida, lo mismo que antes: el primer cuadro casi al empezar.
      expect(demoraDeRetiro(400 - desdeElPrimerCuadro([fcp(60)], 400))).toBe(1_660);
    });

    it('ignora otras entradas: `first-paint` no es el cuadro del ícono', () => {
      expect(desdeElPrimerCuadro([{ name: 'first-paint', startTime: 50 }, fcp(90)], 400)).toBe(90);
      expect(desdeElPrimerCuadro([{ name: 'first-paint', startTime: 50 }], 400)).toBe(400);
    });

    it('🔴 sin la entrada (aún no se pintó, o el navegador no la tiene): desde ahora, el mínimo entero', () => {
      expect(desdeElPrimerCuadro([], 3_300)).toBe(3_300);
      expect(demoraDeRetiro(3_300 - desdeElPrimerCuadro([], 3_300))).toBe(SPLASH_MINIMO_MS);
    });

    it('nunca desde después de ahora: la demora no pasa del mínimo', () => {
      expect(desdeElPrimerCuadro([fcp(5_000)], 3_300)).toBe(3_300);
      expect(demoraDeRetiro(3_300 - desdeElPrimerCuadro([fcp(5_000)], 3_300))).toBe(SPLASH_MINIMO_MS);
    });

    it('la app tardó más que el mínimo desde el primer cuadro: se funde enseguida', () => {
      expect(demoraDeRetiro(6_000 - desdeElPrimerCuadro([fcp(3_100)], 6_000))).toBe(0);
    });
  });

  it('🔴 en este build (sin la marca), el mínimo son los 2 s', () => {
    expect(MINIMO_DE_ESTE_BUILD_MS).toBe(2_000);
  });

  /**
   * 🔴 La marca de la e2e no es un atajo de producción: sólo vale con `DEV` (en un `vite build` es `false` constante), y
   * sólo la nombran `splash.ts` (que la lee) y `playwright.config.ts` (que la pone en el servidor de desarrollo de la e2e).
   * Si alguien la nombra en otro lado —Vercel, el CI, un script— esto se pone rojo.
   */
  it('🔴 la marca de la e2e sólo vale en desarrollo, y sólo la nombran splash.ts y playwright.config.ts (y la e2e que afirma que no está en el build)', () => {
    const quienes = Object.entries(FUENTES)
      .filter(([ruta, codigo]) => !ruta.endsWith('/splash.test.ts') && codigo.includes('VITE_E2E_CARGA_SIN_MINIMO'))
      .map(([ruta]) => ruta)
      .sort();
    expect(quienes).toEqual(['/e2e/splash.spec.ts', '/playwright.config.ts', '/src/splash.ts']);
    // La e2e de la pantalla de carga la nombra sólo para afirmar que NO llegó al build.
    const spec = FUENTES['/e2e/splash.spec.ts']!.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '');
    expect(spec.split('\n').filter((l) => l.includes('VITE_E2E_CARGA_SIN_MINIMO')).map((l) => l.trim()))
      .toEqual(["expect(codigo).not.toContain('VITE_E2E_CARGA_SIN_MINIMO');"]);
    const fuente = FUENTES['/src/splash.ts']!.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(fuente).toContain("import.meta.env.DEV && import.meta.env.VITE_E2E_CARGA_SIN_MINIMO === '1' ? 0 : SPLASH_MINIMO_MS");
    expect(fuente.match(/VITE_E2E_CARGA_SIN_MINIMO/g)).toHaveLength(1);
    // En la configuración, sólo en el servidor de desarrollo (5176): ni en los builds de la CSP ni en otro lado.
    // Sólo el código de la configuración: los comentarios que la explican no la ponen.
    const config = FUENTES['/playwright.config.ts']!.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '');
    const lineas = config.split('\n').filter((l) => l.includes('VITE_E2E_CARGA_SIN_MINIMO'));
    expect(lineas).toHaveLength(1);
    expect(lineas[0]).toMatch(/VITE_E2E_CARGA_SIN_MINIMO=1 npx --no-install vite --port 5176 --strictPort --mode mock/);
    expect(lineas[0]).not.toMatch(/vite build/);
  });

  /**
   * 🔴 Se ve desde el primer cuadro: el `#splash` no nace transparente ni espera para aparecer. Antes nacía en opacidad 0
   * y aparecía con `splash-aparecer … 300ms`: un primer cuadro sin la pantalla.
   */
  it('🔴 el #splash se ve desde el primer cuadro: sin opacidad 0 ni animación de entrada', () => {
    const regla = INDEX.match(/\n\s*#splash\s*{([^}]*)}/)?.[1] ?? '';
    expect(regla).toContain('background: #101e3b;');
    expect(regla).not.toMatch(/opacity/);
    expect(regla.replace(/\s+/g, ' ')).toContain('animation: splash-rendirse 400ms ease 12s forwards;');
    expect(INDEX).not.toMatch(/splash-aparecer/);
  });

  /** 🔴 EL DRIFT ENTRE LAS DOS COPIAS: la rendición del CSS y la de `splash.ts` son EL MISMO número. */
  it('🔴 la rendición del CSS es la de splash.ts', () => {
    const rendicion = INDEX.match(/splash-rendirse\s+\d+ms\s+ease\s+(\d+)s\s+forwards/);
    expect(rendicion).not.toBeNull();
    expect(Number(rendicion![1]) * 1000).toBe(SPLASH_RENDICION_MS);
    // El mínimo termina mucho antes que la rendición: la pantalla no se rinde mientras lo cumple.
    expect(SPLASH_MINIMO_MS).toBeLessThan(SPLASH_RENDICION_MS);
  });

  /**
   * «Reducir movimiento» se contiene desde `global.css` (enlazada después del `<style>`): sin animación de entrada que
   * apagar, queda la rendición a los MISMOS 12 s, sin su fundido.
   */
  it('🔴 «reducir movimiento» (global.css): sólo la rendición, a los mismos 12 s, sin su fundido', () => {
    const regla = GLOBAL.match(/@media \(prefers-reduced-motion: reduce\)\s*{\s*#splash\s*{\s*animation:\s*([^;]+);\s*}\s*}/);
    expect(regla, 'global.css perdió la regla de «reducir movimiento» del splash').not.toBeNull();
    expect(regla![1]).toBe(`splash-rendirse 1ms linear ${SPLASH_RENDICION_MS / 1000}s forwards`);
    expect(GLOBAL).not.toMatch(/splash-aparecer/);
  });

  it('el splash de index.html existe, es decorativo y navy', () => {
    expect(INDEX).toContain('id="splash"');
    expect(INDEX).toContain('aria-hidden="true"');
    expect(INDEX).toMatch(/#splash\s*{[^}]*background:\s*#101e3b/i);
    // A4/D-FUENTES-1: ninguna tipografía (el lockup del handoff viejo TIPEABA Poppins).
    expect(INDEX).not.toMatch(/font-family[^;>]*Poppins/i);
  });

  /**
   * 🔴 D286 (revisión 6) · `PANTALLA-pantalla-de-carga.md` (d03f38b4…), que manda: cuatro triángulos con su recorte y su
   * degradado «pulido», la franja de la barra de estado con `env(safe-area-inset-top)`, y el ícono navy del paquete, tal
   * cual, sin `xmlns` ni metadatos. Sin texto.
   */
  describe('🔴 D286 · los triángulos metálicos y el ícono navy', () => {
    const splash = INDEX.slice(INDEX.indexOf('<div id="splash"'), INDEX.indexOf('<script type="module"'));
    const regla = (selector: string) => INDEX.match(new RegExp(`${selector.replace('.', '\\.')}\\s*{([^}]*)}`))?.[1] ?? '';

    it('cuatro triángulos, con los degradados superior e inferior intercambiados por D330', () => {
      const triangulos = [
        ['t-arriba', 'polygon(0 0, 100% 0, 50% 50%)', 'linear-gradient(80deg, #101e3b 0%, #3d4a63 30%, #101e3b 50%, #2c3954 72%, #101e3b 100%)'],
        ['t-izq', 'polygon(0 0, 50% 50%, 0 100%)', 'linear-gradient(170deg, #a1dbe4 0%, #1493b1 30%, #82d0dc 52%, #0fb5c9 66%, #1b6b8f 100%)'],
        ['t-der', 'polygon(100% 0, 100% 100%, 50% 50%)', 'linear-gradient(190deg, #016274 0%, #66a2a5 30%, #04596e 55%, #428e92 72%, #0d415d 100%)'],
        ['t-abajo', 'polygon(0 100%, 50% 50%, 100% 100%)', 'linear-gradient(100deg, #abc7ce 0%, #ffffff 24%, #cfe8eb 42%, #f4fdfe 60%, #97b4be 100%)'],
      ] as const;
      for (const [clase, recorte, degrade] of triangulos) {
        expect(splash, clase).toContain(`<div class="t ${clase}"></div>`);
        const r = regla(`#splash .${clase}`);
        expect(r, clase).toContain(`clip-path: ${recorte};`);
        expect(r, clase).toContain(`background: ${degrade};`);
      }
      expect(splash.match(/class="t t-/g)).toHaveLength(4);
      expect(regla('#splash .t')).toMatch(/position: absolute;\s*inset: 0;/);
    });

    it('la franja y la zona arrancan debajo de la barra de estado', () => {
      expect(splash).toContain('<div class="carga__franja"></div>');
      expect(regla('#splash .carga__franja')).toContain('height: env(safe-area-inset-top);');
      expect(regla('#splash .carga__zona')).toContain('top: env(safe-area-inset-top);');
      expect(INDEX).toContain('viewport-fit=cover');
      expect(INDEX).toContain('<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />');
    });

    it('el ícono es el SVG de la sección 4, sin xmlns y sin metadatos, de 128 px y centrado', () => {
      expect(splash).toContain('<svg class="carga__icono" viewBox="0 0 128 128" role="img" aria-label="PayMe"><rect width="128" height="128" rx="36" fill="#101E3B"/><g transform="scale(1.6842)"><path fill="#0FB5C9" d="M18.5 21L27.5 21L36.5 38L27.5 55L18.5 55L27.5 38Z"/><path fill="#FFFFFF" d="M39.5 21L48.5 21L57.5 38L48.5 55L39.5 55L48.5 38Z"/></g></svg>');
      // Se barre el marcado, no los comentarios (uno explica por qué no lleva `xmlns`).
      const marcado = splash.replace(/<!--[\s\S]*?-->/g, '');
      expect(marcado).not.toContain('xmlns');
      expect(marcado).not.toMatch(/<metadata|<title|<desc|sodipodi|inkscape/i);
      expect(regla('#splash .carga__icono')).toMatch(/left: 50%;\s*top: 50%;\s*width: 128px;\s*height: 128px;\s*transform: translate\(-50%, -50%\);/);
    });

    it('sin texto: ni <text>, ni palabras', () => {
      expect(splash).not.toMatch(/<text|<tspan/);
      expect(splash.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, '').trim()).toBe('');
    });

    /**
     * 🔴 D300 · el ícono aparece entero de una vez: opacidad 1 y escala 1 desde el primer cuadro, con o sin «reducir
     * movimiento». Salió la entrada de 240 ms (nacía en opacidad 0 y escala 0,92). Se barre el `<style>` entero, sin
     * comentarios: ninguna animación, `@keyframes` ni `@media` de movimiento, salvo la rendición de 12 s.
     */
    it('🔴 D300 · el ícono, entero desde el primer cuadro: sin animación, con o sin «reducir movimiento»', () => {
      const estilo = (INDEX.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(estilo.length).toBeGreaterThan(500);
      expect(regla('#splash .carga__icono')).not.toMatch(/animation|opacity|scale/);
      expect(estilo).not.toMatch(/carga-entra|prefers-reduced-motion/);
      expect([...estilo.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1])).toEqual(['splash-rendirse']);
      expect([...estilo.matchAll(/animation:\s*([^;]+);/g)].map((m) => m[1]!.trim())).toEqual(['splash-rendirse 400ms ease 12s forwards']);
      expect(estilo).not.toMatch(/@media/);
    });
  });

  /**
   * La rendición a los 12s es CSS puro a propósito: si el grafo de módulos
   * muere (ERR_NETWORK_CHANGED, 2026-08-10), no hay JS que retire nada, y un
   * splash eterno es una app muerta con cara de viva. Se afirma que la
   * animación exista Y que sea la de retirarse, no un nombre suelto.
   */
  it('🔴 la rendición sin JS sigue puesta', () => {
    expect(INDEX).toMatch(/splash-rendirse\s+\d+ms\s+ease\s+12s\s+forwards/);
    expect(INDEX).toMatch(/@keyframes splash-rendirse\s*{[^}]*to\s*{[^}]*opacity:\s*0/);
  });

  /**
   * Igual que el test del IdiomaProvider en traduccion.test.ts: olvidarse la
   * llamada NO rompe nada visible en local (la rendición de 12s lo tapa), así
   * que se afirma que la línea exista. Y con el rAF, que es parte del
   * criterio: retirar antes del primer paint destapa un frame de blanco.
   */
  it('🔴 main.tsx retira el splash, y lo hace después del primer paint', () => {
    expect(MAIN).toContain('requestAnimationFrame(() => retirarSplash())');
  });
});
