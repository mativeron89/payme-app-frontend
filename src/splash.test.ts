import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  MINIMO_DE_ESTE_BUILD_MS,
  SPLASH_MINIMO_MS,
  SPLASH_RENDICION_MS,
  SPLASH_FUNDIDO_MS,
  demoraDeRetiro,
  desdeElPrimerCuadro,
  momentoEnQueSeVe,
} from './splash';

const CRUDOS = import.meta.glob(['/index.html', '/src/main.tsx', '/src/styles/global.css'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const INDEX = CRUDOS['/index.html'];
const MAIN = CRUDOS['/src/main.tsx'];
const GLOBAL = CRUDOS['/src/styles/global.css']!;

/** SHA-256 de los dos `d` de `payme-palabra-contornos.svg` (0cb870e7…), «Pay» y «Me», medidos sobre el archivo del paquete. */
const SHA_D_PAY = '061bf10a227083856a56fbe2b39066cc185ae9bcdef80d71762c8c602eaa5a35';
const SHA_D_ME = 'a39fab261f3df3acf428feab038429c9f2ad5b9d6ac55429bd5105ce76061be0';

/** Las fuentes que podrían nombrar la marca de la e2e: el código, las pruebas, los scripts y la configuración. */
const FUENTES = import.meta.glob(
  ['/src/**/*.{ts,tsx}', '/e2e/**/*.{ts,mjs}', '/scripts/**/*.{ts,mjs,sh}', '/*.{ts,json,html}', '/.github/**/*.yml'],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

describe('🔴 D292 · la pantalla de carga siempre, al menos 4 segundos (Mati, 2026-10-12; D498, 2026-10-26)', () => {
  /** La decisión entera está en esta función: lo que falta para completar el mínimo desde el primer cuadro pintado. */
  it('la app monta antes del mínimo: espera lo que falta', () => {
    // D498 · 4 s (Mati: «dejala dos segundos mas luego»; antes 2 s).
    expect(SPLASH_MINIMO_MS).toBe(4_000);
    expect(demoraDeRetiro(0)).toBe(4_000);
    expect(demoraDeRetiro(120)).toBe(3_880);
    expect(demoraDeRetiro(1_000)).toBe(3_000);
    expect(demoraDeRetiro(3_999)).toBe(1);
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
   * 🔴 D300 · los 4 s (D498) se cuentan desde el primer cuadro pintado, no desde que empezó la navegación. Con una página que
   * tardó 3 s en llegar y una app que monta enseguida, contarlos desde la navegación retiraba la pantalla al montar.
   */
  describe('🔴 D300 · desde el primer cuadro pintado', () => {
    const fcp = (t: number) => ({ name: 'first-contentful-paint', startTime: t });

    it('cuenta desde `first-contentful-paint`', () => {
      expect(desdeElPrimerCuadro([fcp(3_100)], 3_300)).toBe(3_100);
      // La navegación tardó 3 s y la app montó 200 ms después del primer cuadro: faltan 3,8 s, no 0.
      expect(demoraDeRetiro(3_300 - desdeElPrimerCuadro([fcp(3_100)], 3_300))).toBe(3_800);
      // Con la página rápida, lo mismo que antes: el primer cuadro casi al empezar.
      expect(demoraDeRetiro(400 - desdeElPrimerCuadro([fcp(60)], 400))).toBe(3_660);
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
      expect(demoraDeRetiro(8_000 - desdeElPrimerCuadro([fcp(3_100)], 8_000))).toBe(0);
    });
  });

  it('🔴 en este build (sin la marca), el mínimo son los 4 s (D498)', () => {
    expect(MINIMO_DE_ESTE_BUILD_MS).toBe(4_000);
  });

  /**
   * 🔴 D498 · la barra blanca de abajo: en la app de inicio de iOS asoman 59 pt de fondo de página debajo del
   * `#splash` (viewport corto, D179). Mientras el `#splash` exista, el fondo de la página es navy, y la regla depende
   * de que exista: cuando la app lo saca, vuelve el fondo de siempre.
   */
  it('🔴 D498 · mientras exista el #splash, el fondo de la página es su navy', () => {
    const estilo = (INDEX.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(estilo).toMatch(/html:has\(> body > #splash\)\s*{\s*background: #101e3b;\s*}/);
    // Y es el mismo navy del `#splash`.
    expect(INDEX.match(/\n\s*#splash\s*{([^}]*)}/)?.[1]).toContain('background: #101e3b;');
  });

  /**
   * 🔴 D498 · 2 · sobre 0.264.3 asomaba en esos 59 pt la barra de pestañas de la app (video de Mati): `.app` mide
   * `100lvh` en la app de inicio y el `#splash`, fijo con `inset: 0`, sólo el viewport corto. En la app instalada el
   * `#splash` mide `100lvh` desde arriba, `absolute` y no `fixed` (en 0.210.5 una capa fija estirada a 852 se pintó sólo
   * hasta 793 en el iPhone). Por `display-mode` antes del JS y por la misma clase que estira `.app` después. En Safari
   * sigue fijo con `inset: 0`.
   */
  it('🔴 D498 · 2 · en la app instalada el #splash cubre el alto grande, como `.app`', () => {
    const estilo = (INDEX.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, '');
    const alto = /^\s*position: absolute;\s*bottom: auto;\s*height: 100vh;\s*height: 100lvh;\s*$/;
    const enMedia = estilo.match(/@media \(display-mode: standalone\)\s*{\s*#splash\s*{([^}]*)}\s*}/)?.[1];
    expect(enMedia, 'falta el #splash de 100lvh dentro de @media (display-mode: standalone)').toMatch(alto);
    const conClase = estilo.match(/\n\s*html\.app-de-inicio-ios #splash\s*{([^}]*)}/)?.[1];
    expect(conClase, 'falta el #splash de 100lvh con la clase app-de-inicio-ios').toMatch(alto);
    // La clase es la misma que estira `.app` en global.css.
    expect(CRUDOS['/src/styles/global.css']).toMatch(/html\.app-de-inicio-ios \.app\s*{[^}]*height: 100lvh;/);
    // Fuera de la app instalada, el #splash sigue fijo al viewport.
    const base = INDEX.match(/\n\s*#splash\s*{([^}]*)}/)?.[1] ?? '';
    expect(base).toMatch(/position: fixed;\s*inset: 0;/);
    expect(base).not.toMatch(/lvh|vh/);
    // Ninguna regla deja el #splash fijo con un alto de pantalla: así lo recortó WebKit en 0.210.5.
    for (const m of estilo.matchAll(/([^{}]*#splash)\s*{([^}]*)}/g)) {
      if (/height: 100l?vh/.test(m[2]!)) expect(m[2], m[1]!.trim()).toContain('position: absolute;');
    }
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
   * 🔴 D475 · `PANTALLA-pantalla-de-carga.md` (4ef1274b…, «PayMe entre dos puntas», 7a), que manda: dos puntas con su
   * recorte y su degradé teal → cian, la franja de la barra de estado con `env(safe-area-inset-top)`, y la palabra «PayMe»
   * con los dos `<path>` de `payme-palabra-contornos.svg` (0cb870e7…), tal cual, sin `xmlns` ni metadatos. Sin texto.
   * Reemplaza los cuatro triángulos metálicos y el ícono navy de D286 (revisión 6).
   */
  describe('🔴 D475 · las dos puntas y la palabra «PayMe»', () => {
    const splash = INDEX.slice(INDEX.indexOf('<div id="splash"'), INDEX.indexOf('<script type="module"'));
    const regla = (selector: string) => INDEX.match(new RegExp(`${selector.replace(/\./g, '\\.')}\\s*{([^}]*)}`))?.[1] ?? '';
    const estilo = (INDEX.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, '');

    it('dos puntas en esquinas opuestas, cada una la zona entera recortada, con el degradado teal → cian', () => {
      const puntas = [
        ['arriba', 'polygon(0 0, 56% 0, 0 19.2%)', 'linear-gradient(135deg, #0a7b80 0%, #0fb5c9 17.1%)'],
        ['abajo', 'polygon(100% 100%, 44% 100%, 100% 80.8%)', 'linear-gradient(315deg, #0a7b80 0%, #0fb5c9 17.1%)'],
      ] as const;
      for (const [lado, recorte, degrade] of puntas) {
        expect(splash, lado).toContain(`<div class="carga__punta carga__punta--${lado}"></div>`);
        const r = regla(`#splash .carga__punta--${lado}`);
        expect(r, lado).toContain(`clip-path: ${recorte};`);
        expect(r, lado).toContain(`background: ${degrade};`);
        expect(r, lado).not.toMatch(/animation|top:/);
      }
      expect(splash.match(/class="carga__punta /g)).toHaveLength(2);
      expect(regla('#splash .carga__punta')).toMatch(/position: absolute;\s*inset: 0;/);
      // Lo de D286 ya no está: ni triángulos ni ícono.
      expect(INDEX).not.toMatch(/class="t |\.t-arriba|\.t-izq|\.t-der|\.t-abajo|carga__icono/);
    });

    it('🔴 D476 · la franja navy lisa y la zona debajo de la barra de estado; la punta de arriba ya no sube por encima de la barra', () => {
      expect(splash).toContain('<div class="carga__franja"></div>');
      expect(regla('#splash .carga__franja')).toContain('height: env(safe-area-inset-top);');
      expect(regla('#splash .carga__franja')).toContain('background: #101e3b;');
      expect(regla('#splash .carga__zona')).toContain('top: env(safe-area-inset-top);');
      // D353 enmendado: nada sube por detrás de la barra.
      expect(estilo).not.toContain('calc(-1 * env(safe-area-inset-top))');
      expect(INDEX).toContain('viewport-fit=cover');
      expect(INDEX).toContain('<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />');
    });

    it('la palabra: los dos `<path>` del paquete, sin xmlns y sin metadatos, de 126 × 40 y centrada', () => {
      const svg = splash.match(/<div class="carga__palabra">(<svg[\s\S]*?<\/svg>)<\/div>/)?.[1] ?? '';
      expect(svg).toMatch(/^<svg viewBox="0 0 240 76" role="img" aria-label="PayMe"><path fill="#FFFFFF" d="M[^"]+"\/><path fill="#0FB5C9" d="M[^"]+"\/><\/svg>$/);
      // Los `d`, tal cual los del archivo del paquete (medidos al implementar: SHA-256 de cada uno, sobre sus bytes).
      const d = [...svg.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]!);
      expect(d.map((x) => createHash('sha256').update(x, 'utf8').digest('hex'))).toEqual([SHA_D_PAY, SHA_D_ME]);
      // Se barre el marcado, no los comentarios (uno explica por qué no lleva `xmlns`).
      const marcado = splash.replace(/<!--[\s\S]*?-->/g, '');
      expect(marcado).not.toContain('xmlns');
      expect(marcado).not.toMatch(/<metadata|<title|<desc|c2pa|sodipodi|inkscape|width="240"|height="76"/i);
      expect(regla('#splash .carga__palabra')).toMatch(/left: 50%;\s*top: 50%;\s*width: 126px;\s*height: 40px;\s*transform: translate\(-50%, -50%\);/);
      expect(regla('#splash .carga__palabra svg')).toMatch(/display: block;\s*width: 126px;\s*height: 40px;\s*opacity: 1;/);
    });

    it('sin texto: ni <text>, ni palabras', () => {
      expect(splash).not.toMatch(/<text|<tspan/);
      expect(splash.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, '').trim()).toBe('');
    });

    /**
     * 🔴 D476 (opción A; enmienda D300 punto 3) · la palabra entra con el fundido del diseño, y sólo ella: UNA keyframe extra,
     * `carga-palabra`, dentro de `prefers-reduced-motion: no-preference` (con «reducir», entera desde el primer cuadro). Nace en
     * opacidad 0.001, no en 0: con 0 el navegador no anota `first-contentful-paint` en el primer cuadro y el conteo de D300 se
     * correría al montaje (R1). La rendición sigue siendo la única animación del `#splash`.
     */
    it('🔴 D476 · la palabra entra con su fundido, sólo sin «reducir movimiento», y nace en 0.001 (no en 0)', () => {
      expect(estilo.length).toBeGreaterThan(500);
      expect([...estilo.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1])).toEqual(['carga-palabra', 'splash-rendirse']);
      expect([...estilo.matchAll(/animation:\s*([^;]+);/g)].map((m) => m[1]!.trim())).toEqual([
        'splash-rendirse 400ms ease 12s forwards',
        'carga-palabra 1200ms cubic-bezier(.4, 0, .2, 1) 300ms both',
      ]);
      // Dos @media: el de «sin preferencia», con sólo la palabra, y el de la app instalada (D498 · 2), con sólo el
      // `#splash`. Ninguno anima otra cosa.
      const medias = [...estilo.matchAll(/@media\s*([^{]+){\s*([^{}]+){([^}]*)}\s*}/g)];
      expect(medias.map((m) => [m[1]!.trim(), m[2]!.trim()])).toEqual([
        ['(display-mode: standalone)', '#splash'],
        ['(prefers-reduced-motion: no-preference)', '#splash .carga__palabra svg'],
      ]);
      expect(estilo.match(/@media/g)).toHaveLength(2);
      expect(estilo).not.toMatch(/prefers-reduced-motion: reduce/);
      const entrada = estilo.match(/@keyframes carga-palabra\s*{\s*from\s*{([^}]*)}\s*to\s*{([^}]*)}\s*}/);
      expect(entrada).not.toBeNull();
      expect(entrada![1]!.trim()).toBe('opacity: 0.001; transform: translateY(16px);');
      expect(entrada![2]!.trim()).toBe('opacity: 1; transform: translateY(0);');
      // Ni el #splash, ni la palabra fuera del @media, ni las puntas se animan.
      expect(regla('#splash .carga__palabra')).not.toMatch(/animation|opacity/);
      expect(estilo).not.toMatch(/carga-entra|splash-aparecer/);
    });

    /**
     * 🔴 D491 · Mati: el logo «spawnea de una». Con 600 ms, una curva que frenaba enseguida y 80 ms de retardo, la entrada
     * corría junto con el fundido de iOS al abrir y lo visible duraba ~0,1 s (DIAGNOSTICO_CARGA_D491). Si la entrada vuelve a
     * ser corta, o arranca antes de que pase ese fundido, esto falla. Y tiene que terminar antes del mínimo de 2 s (D292),
     * para no demorar el arranque.
     */
    it('🔴 D491 · la entrada de la palabra dura al menos 1000 ms, espera al menos 250 ms y termina antes del mínimo', () => {
      const regla = [...estilo.matchAll(/animation:\s*carga-palabra\s+(\d+)ms\s+(cubic-bezier\([^)]*\)|[\w-]+)\s+(\d+)ms\s+both;/g)];
      expect(regla).toHaveLength(1);
      const duracion = Number(regla[0]![1]);
      const retardo = Number(regla[0]![3]);
      expect(duracion).toBeGreaterThanOrEqual(1000);
      expect(retardo).toBeGreaterThanOrEqual(250);
      expect(retardo + duracion).toBeLessThan(SPLASH_MINIMO_MS);
      // No una curva que la complete en el primer décimo de segundo: la de D476 (.2, .8, …) arrancaba casi vertical.
      expect(regla[0]![2]).toBe('cubic-bezier(.4, 0, .2, 1)');
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

/**
 * AF-7 · I1 · B1 (auditoría del PR #118): cuándo SE VE lo que la app montó debajo de la pantalla de carga. Es el ancla del
 * plazo de 1,5 s de la vista previa del link: contado desde el montaje, se vencía todavía debajo de la pantalla de carga.
 */
describe('AF-7 · B1 · cuándo se ve la app (momentoEnQueSeVe)', () => {
  const FCP = [{ name: 'first-contentful-paint', startTime: 30 }];
  const EPOCA = 1_793_520_000_000;

  it('🔴 con la pantalla de carga puesta: cuando termine su mínimo desde el primer cuadro, más el fundido', () => {
    // Montó a los 35 ms (performance.now): faltan 4000 − 5 = 3995 ms para fundir, más el fundido.
    expect(momentoEnQueSeVe({ ahoraEpocaMs: EPOCA, ahoraMs: 35, haySplash: true, entradas: FCP, minimoMs: SPLASH_MINIMO_MS }))
      .toBe(EPOCA + (SPLASH_MINIMO_MS - 5) + SPLASH_FUNDIDO_MS);
  });

  it('si la app tardó más que el mínimo, se ve con el fundido, enseguida', () => {
    expect(momentoEnQueSeVe({ ahoraEpocaMs: EPOCA, ahoraMs: 6_000, haySplash: true, entradas: FCP, minimoMs: SPLASH_MINIMO_MS }))
      .toBe(EPOCA + SPLASH_FUNDIDO_MS);
  });

  it('sin la pantalla de carga (ya salió, o la pantalla se monta después): ahora', () => {
    expect(momentoEnQueSeVe({ ahoraEpocaMs: EPOCA, ahoraMs: 35, haySplash: false, entradas: FCP, minimoMs: SPLASH_MINIMO_MS }))
      .toBe(EPOCA);
  });

  it('sin el primer cuadro anotado, el mínimo se cuenta desde ahora (como el retiro)', () => {
    expect(momentoEnQueSeVe({ ahoraEpocaMs: EPOCA, ahoraMs: 35, haySplash: true, entradas: [], minimoMs: SPLASH_MINIMO_MS }))
      .toBe(EPOCA + SPLASH_MINIMO_MS + SPLASH_FUNDIDO_MS);
  });

  it('con el mínimo de este build en 0 (la marca de la e2e), sólo el fundido', () => {
    expect(momentoEnQueSeVe({ ahoraEpocaMs: EPOCA, ahoraMs: 35, haySplash: true, entradas: FCP, minimoMs: 0 }))
      .toBe(EPOCA + SPLASH_FUNDIDO_MS);
  });
});
