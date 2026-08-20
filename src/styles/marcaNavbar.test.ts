import { describe, expect, it } from 'vitest';

/**
 * La marca de la navbar sigue la REGLA DE COMPOSICIÓN DEL LOCKUP
 * (diseno `283d88d` · SISTEMA_DISENO §1), elegida por Mati el 2026-08-19
 * viendo D contra C3 — y SUPERSEDE a C3, que era un `translateY(-3.7px)`
 * medido a mano ese mismo día.
 *
 * Esta guarda existe porque la vuelta atrás es plausible de buena fe: C3
 * también la eligió Mati, también el 19/08, y su nota de medición era
 * convincente. Quien encuentre el historial puede creer que la regla nueva
 * fue un error de merge y «restaurarla». La respuesta es: mismo decisor,
 * más información (la proporción 1.2× que C3 no tenía).
 */
const CRUDOS = import.meta.glob(['/src/styles/global.css', '/src/components/AppHeader.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const CSS = CRUDOS['/src/styles/global.css'];
const HEADER = CRUDOS['/src/components/AppHeader.tsx'];

function regla(selector: string): string {
  const m = CSS.match(new RegExp(`\\n${selector.replace(/[.\\]/g, '\\$&')}\\s*{([^}]*)}`));
  if (!m) throw new Error(`global.css perdió la regla ${selector}`);
  return m[1];
}

describe('marca de la navbar · regla de composición 283d88d', () => {
  it('🔴 la proporción 1.2× está DERIVADA, no copiada: símbolo en em, cuerpo en un solo lugar', () => {
    expect(regla('.hdr-symbol')).toMatch(/width:\s*1\.2em/);
    expect(regla('.hdr-symbol')).toMatch(/height:\s*1\.2em/);
    expect(regla('.hdr-mark')).toMatch(/font-size:\s*25px/);
    expect(regla('.hdr-logo')).toMatch(/font-size:\s*1em/);
  });

  it('el centrado es el de la regla: center + line-height 1 + margin-top 1px', () => {
    expect(regla('.hdr-mark')).toMatch(/align-items:\s*center/);
    expect(regla('.hdr-logo')).toMatch(/line-height:\s*1\b/);
    expect(regla('.hdr-symbol')).toMatch(/margin-top:\s*1px/);
  });

  it('🔴 el translateY de C3 no vuelve, y el SVG no lleva su propio tamaño', () => {
    // La DECLARACIÓN, no la palabra: el comentario que cuenta la historia de
    // C3 la nombra a propósito, y ya cazó a esta guarda en su primera corrida
    // (tercera vez hoy que una guarda propia caza su propio comentario:
    // Poppins en el splash, y ahora esto — se veta lo que EJECUTA, no lo que
    // se cuenta).
    expect(CSS).not.toMatch(/transform:\s*translateY\(-3\.7px\)/);
    // Un width/height en el SVG sería una segunda copia del tamaño, la que
    // se desincroniza en silencio de la derivación en em.
    const svg = HEADER.match(/<svg className="hdr-symbol"[^>]*>/);
    expect(svg, 'AppHeader perdió el símbolo de la marca').not.toBeNull();
    expect(svg![0]).not.toMatch(/\swidth=/);
    expect(svg![0]).not.toMatch(/\sheight=/);
  });

  it('la variante compacta achica el CUERPO, no el wordmark suelto', () => {
    expect(CSS).toMatch(/\.hdr-compact \.hdr-mark\s*{[^}]*font-size:\s*22px/);
    expect(CSS).not.toMatch(/\.hdr-compact \.hdr-logo\s*{/);
  });
});
