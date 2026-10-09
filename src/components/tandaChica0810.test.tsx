import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AppHeader, AppHeaderBack } from './AppHeader';
import { textoDeLaBurbuja } from './burbuja';
import { textoDeLaBurbuja as desdeLaBarra } from './AppBottomBar';
import { traducir } from '../i18n/idioma';

/**
 * AF-TANDA-CHICA-0810 · D240 · las guardas baratas de la tanda: la campana con
 * número (punto 5) renderizada de verdad en las DOS cabeceras, y las reglas de
 * CSS de los puntos 3, 5, 12 y 14 leídas por su valor EFECTIVO (en CSS gana la
 * última declaración: se juntan todos los bloques del selector, en orden).
 */

const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');
const mas = readFileSync(new URL('../screens/MasScreen.tsx', import.meta.url), 'utf8');

/** Las declaraciones efectivas de un selector exacto (bloques de primer nivel). */
function regla(selector: string): Record<string, string> {
  const escapado = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const bloques = [...css.matchAll(new RegExp(`(?:^|\\n)${escapado}\\s*\\{([^}]*)\\}`, 'g'))];
  const out: Record<string, string> = {};
  for (const b of bloques) {
    for (const decl of (b[1] ?? '').split(';')) {
      const [prop, ...valor] = decl.replace(/\/\*[\s\S]*?\*\//g, '').split(':');
      if (prop?.trim() && valor.length) out[prop.trim()] = valor.join(':').trim();
    }
  }
  return out;
}

describe('D240 punto 5 · la campana con el número', () => {
  const variantes = {
    AppHeader: (unread: number) => renderToStaticMarkup(<AppHeader userName="Mati" unread={unread} />),
    AppHeaderBack: (unread: number) => renderToStaticMarkup(<AppHeaderBack userName="Mati" unread={unread} onBack={() => undefined} />),
  };

  for (const [nombre, render] of Object.entries(variantes)) {
    it(`${nombre}: sin avisos no hay burbuja y el botón se llama «Avisos»`, () => {
      const html = render(0);
      expect(html).not.toContain('hdr-badge');
      expect(html).toContain('aria-label="Avisos"');
    });

    it(`${nombre}: hasta 9 el número; desde 10 «9+», con el número exacto en el nombre`, () => {
      for (const [n, texto] of [[1, '1'], [9, '9'], [10, '9+'], [23, '9+']] as const) {
        const html = render(n);
        expect(html, String(n)).toContain(`aria-label="Avisos, ${n} sin leer"`);
        expect(html, String(n)).toContain(`<span class="hdr-badge" aria-hidden="true">${texto}</span>`);
      }
    });
  }

  it('la regla de la burbuja es UNA, la de Amigos (D230), y la barra la sigue exportando', () => {
    expect(desdeLaBarra).toBe(textoDeLaBurbuja);
    expect([1, 9, 10, 99].map(textoDeLaBurbuja)).toEqual(['1', '9', '9+', '9+']);
  });

  it('EN: «Notifications, 3 unread»', () => {
    expect(traducir('Avisos, {0} sin leer', 'en', 3)).toBe('Notifications, 3 unread');
  });

  it('la burbuja de la campana ES la de Amigos: mismas medidas, rojo y número blanco, derivado y no copiado', () => {
    const campana = regla('.hdr-badge');
    const amigos = regla('.appbar-burbuja');
    for (const prop of ['top', 'left', 'min-width', 'height', 'padding', 'border-radius', 'background', 'color',
      'font-family', 'font-size', 'font-weight', 'line-height', 'text-align', 'white-space']) {
      expect(campana[prop], prop).toBe(amigos[prop]);
    }
    expect(campana.background).toBe('var(--danger)');
    expect(campana['font-size']).not.toBe('0');
    // El aro es del color de la banda navy (en la barra es el de la barra).
    expect(campana['box-shadow']).toBe('0 0 0 2px var(--action)');
    expect(regla('.hdr-bell-icono').position).toBe('relative');
  });
});

describe('D240 punto 12 · «Cerrar sesión» en rojo clarito', () => {
  it('el tinte de error del sistema, con tokens, después de `.btn`', () => {
    const r = regla('.btn-cerrar-sesion');
    expect(r.background).toBe('var(--danger-tint)');
    expect(r.color).toBe('var(--danger)');
    expect(r.border).toMatch(/^1\.5px solid .*var\(--danger\)/);
    expect(css.indexOf('\n.btn-cerrar-sesion {')).toBeGreaterThan(css.indexOf('\n.btn {'));
  });

  it('el botón de Configuración usa esa clase y no la gris', () => {
    expect(mas).toMatch(/className="btn btn-cerrar-sesion"[\s\S]{0,120}t\('Cerrar sesión'\)/);
  });
});

describe('D240 punto 13 · las flechas de Configuración', () => {
  it('ninguna fila de Configuración usa ya el carácter «→»', () => {
    expect(mas).not.toMatch(/>→</);
  });
});

describe('D240 punto 14 · la burbuja del detalle de Mesas', () => {
  it('12 px de la línea divisoria, igual que los costados y el pie', () => {
    expect(regla('.hist-detail').margin).toBe('var(--sp-3)');
  });
});

describe('D240 punto 3 · el listado al elegir', () => {
  it('la letra y el tamaño del sistema: el plato en DM Sans 16, el precio en 16', () => {
    expect(regla('.qc-nombre')['font-family']).toBe('var(--font-body)');
    expect(regla('.qc-nombre')['font-size']).toBe('var(--fs-body)');
    expect(regla('.qc-precio')['font-size']).toBe('var(--fs-body)');
    expect(regla('.qc-parte')['font-size']).toBe('var(--fs-body)');
    expect(regla('.qc-nombre--mio')['font-weight']).toBe('600');
  });

  it('el nombre en hasta dos líneas y todos los renglones del mismo alto: 56 y 50 + 3 + 3', () => {
    expect(regla('.qc-nombre')['-webkit-line-clamp']).toBe('2');
    expect(regla('.qc-fila')['min-height']).toBe('56px');
    expect(regla('.qc-mia')['min-height']).toBe('50px');
    expect(regla('.qc-mia').margin).toBe('3px 4px');
    // Con segunda línea propia, el nombre va en una sola.
    expect(regla('.qc-cuerpo .qc-nombre')['white-space']).toBe('nowrap');
  });
});
