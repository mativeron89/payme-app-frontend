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
    // El fondo ratificado, y el lockup adentro (los dos chevrones + wordmark).
    expect(INDEX).toMatch(/#splash\s*{[^}]*background:\s*#101e3b/i);
    expect(INDEX).toContain('<tspan fill="#0FB5C9">Me</tspan>');
    // A4/D-FUENTES-1: el lockup del handoff viejo TIPEABA Poppins; éste no.
    // Se veta la font-family, no la palabra: un comentario que la nombra
    // (como el que explica el swap del asset) no es una fuente en uso — y la
    // primera corrida de este test lo probó, cazando su propio comentario.
    expect(INDEX).not.toMatch(/font-family[^;>]*Poppins/i);
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
