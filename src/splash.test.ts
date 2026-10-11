import { describe, expect, it } from 'vitest';
import {
  SPLASH_APARICION_MS,
  SPLASH_MINIMO_VISIBLE_MS,
  demoraDeRetiro,
} from './splash';

const CRUDOS = import.meta.glob(['/index.html', '/src/main.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const INDEX = CRUDOS['/index.html'];
const MAIN = CRUDOS['/src/main.tsx'];

describe('splash de carga · «B sólo cuando tarda» (Mati, 2026-08-19)', () => {
  /**
   * La decisión entera está en esta función: antes del retardo de aparición
   * el splash no existió para nadie; después, cumple su mínimo visible.
   */
  it('carga rápida → null: el splash se retira sin haberse visto', () => {
    expect(demoraDeRetiro(0)).toBeNull();
    expect(demoraDeRetiro(120)).toBeNull();
    expect(demoraDeRetiro(SPLASH_APARICION_MS)).toBeNull();
  });

  it('🔴 el anti-flash: si asomó, completa el mínimo visible', () => {
    // Montó a los 310ms: asomó hace 10, le faltan 490 del mínimo de 500.
    expect(demoraDeRetiro(310)).toBe(490);
    // El caso que produciría el parpadeo de 1ms si esto fuera un booleano.
    expect(demoraDeRetiro(SPLASH_APARICION_MS + 1)).toBe(SPLASH_MINIMO_VISIBLE_MS - 1);
  });

  it('carga lenta → 0: ya cumplió el mínimo, se funde sin esperar más', () => {
    expect(demoraDeRetiro(SPLASH_APARICION_MS + SPLASH_MINIMO_VISIBLE_MS)).toBe(0);
    expect(demoraDeRetiro(5_000)).toBe(0);
    // Y nunca negativo: un setTimeout con demora negativa es un bug callado.
    expect(demoraDeRetiro(60_000)).toBe(0);
  });

  /**
   * 🔴 EL DRIFT ENTRE LAS DOS COPIAS. El retardo de aparición vive dos veces:
   * en el CSS inline de `index.html` (tiene que pintar antes de que exista
   * ningún módulo) y en `SPLASH_APARICION_MS` (gobierna el retiro). Si alguien
   * ajusta el CSS a 150ms sin tocar la constante, `demoraDeRetiro` cree que un
   * splash visible nunca asomó y lo arranca a mitad del fundido — exactamente
   * el flash que la orden prohíbe. Este test hace que esa edición sea roja.
   */
  it('🔴 el retardo del CSS y el de splash.ts son EL MISMO número', () => {
    const anim = INDEX.match(/animation:\s*\n?\s*splash-aparecer\s+\d+ms\s+ease\s+(\d+)ms/);
    expect(anim, 'index.html perdió la animación splash-aparecer con su retardo').not.toBeNull();
    expect(Number(anim![1])).toBe(SPLASH_APARICION_MS);
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

    it('cuatro triángulos, cada uno con el recorte y el degradado de la especificación', () => {
      const triangulos = [
        ['t-arriba', 'polygon(0 0, 100% 0, 50% 50%)', 'linear-gradient(100deg, #abc7ce 0%, #ffffff 24%, #cfe8eb 42%, #f4fdfe 60%, #97b4be 100%)'],
        ['t-izq', 'polygon(0 0, 50% 50%, 0 100%)', 'linear-gradient(170deg, #a1dbe4 0%, #1493b1 30%, #82d0dc 52%, #0fb5c9 66%, #1b6b8f 100%)'],
        ['t-der', 'polygon(100% 0, 100% 100%, 50% 50%)', 'linear-gradient(190deg, #016274 0%, #66a2a5 30%, #04596e 55%, #428e92 72%, #0d415d 100%)'],
        ['t-abajo', 'polygon(0 100%, 50% 50%, 100% 100%)', 'linear-gradient(80deg, #101e3b 0%, #3d4a63 30%, #101e3b 50%, #2c3954 72%, #101e3b 100%)'],
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

    it('🔴 el ícono entra en 240 ms cuando aparece la pantalla (no antes) y, con «reducir movimiento», sin animación', () => {
      const conMovimiento = INDEX.match(/@media \(prefers-reduced-motion: no-preference\)\s*{\s*#splash \.carga__icono\s*{\s*animation: carga-entra (\d+)ms cubic-bezier\(0\.2, 0\.8, 0\.2, 1\) (\d+)ms both;/);
      expect(conMovimiento, 'falta la entrada del ícono dentro de prefers-reduced-motion: no-preference').not.toBeNull();
      expect(Number(conMovimiento![1])).toBe(240);
      expect(Number(conMovimiento![2])).toBe(SPLASH_APARICION_MS);
      // Fuera del @media, el ícono no tiene animación: con «reducir movimiento» aparece quieto.
      expect(regla('#splash .carga__icono')).not.toContain('animation');
      expect(INDEX).toMatch(/@keyframes carga-entra\s*{\s*from\s*{\s*opacity: 0;\s*transform: translate\(-50%, -50%\) scale\(0\.92\);\s*}\s*}/);
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
