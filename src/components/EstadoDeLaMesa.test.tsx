import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EstadoDeLaMesa } from './EstadoDeLaMesa';

/** D622 · AF-2 · mejora 2 · la tarjeta: tres renglones, y SÓLO el titular se anuncia (`role="status"`). */
describe('EstadoDeLaMesa · la tarjeta', () => {
  it('🔴 el titular es la única región que se anuncia; platos y consejo, texto común', () => {
    const html = renderToStaticMarkup(<EstadoDeLaMesa estado={{
      titular: 'Falta elegir $585 de $840',
      platos: 'Quedan 3 platos sin dueño.',
      consejo: 'Antes de cerrar la mesa, revisa que todos hayan elegido lo suyo.',
    }} />);
    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(html).toMatch(/<p class="estado-mesa-titular" role="status">Falta elegir \$585 de \$840<\/p>/);
    expect(html).toContain('<p class="estado-mesa-platos">Quedan 3 platos sin dueño.</p>');
    expect(html).toContain('<p class="estado-mesa-consejo">Antes de cerrar la mesa, revisa que todos hayan elegido lo suyo.</p>');
    expect(html).not.toMatch(/<button|aria-expanded/);
  });

  it('sin línea de platos, no deja un renglón vacío', () => {
    const html = renderToStaticMarkup(<EstadoDeLaMesa estado={{
      titular: 'Todavía no eligió nadie', platos: null, consejo: 'Cuando se elija todo, la mesa se cierra sola.',
    }} />);
    expect(html).not.toContain('estado-mesa-platos');
  });
});

/** D622 · AF-2 · AF-4 · la tarjeta del estado de la mesa, con la tercera línea sólo si hay dato del dueño. */
const base = { titular: 'Falta elegir $585 de $840', platos: 'Quedan 3 platos sin dueño.', consejo: 'Cuando se elija todo, la mesa se cierra sola.' };
const f = (ordinal: number, initials: string, mine = false) => ({ ordinal, initials, mine });

describe('EstadoDeLaMesa · AF-4 · «Se sumaron N de M»', () => {
  it('🔴 con personas: «Se sumaron 3 de 4» entre los platos y el consejo, con las fichas decorativas', () => {
    const html = renderToStaticMarkup(<EstadoDeLaMesa estado={{
      ...base, personas: { texto: 'Se sumaron 3 de 4', fichas: [f(0, 'MV', true), f(1, 'AM'), f(2, 'LP')], faltan: 1, resto: 0 },
    }} />);
    const platos = html.indexOf('Quedan 3 platos sin dueño.');
    const personas = html.indexOf('Se sumaron 3 de 4');
    const consejo = html.indexOf('Cuando se elija todo');
    expect(platos).toBeGreaterThan(-1);
    expect(personas).toBeGreaterThan(platos);
    expect(consejo).toBeGreaterThan(personas);
    expect(html).toContain('<span class="qc-fichas" aria-hidden="true">');
    expect(html.match(/qc-ficha--falta/g)).toHaveLength(1);
    // Sólo el titular se anuncia.
    expect(html.match(/role="status"/g)).toHaveLength(1);
  });

  it('🔴 sin personas: la tarjeta de AF-2, sin fichas ni conteo', () => {
    const html = renderToStaticMarkup(<EstadoDeLaMesa estado={base} />);
    expect(html).not.toContain('qc-ficha');
    expect(html).not.toContain('Se sumaron');
    expect(html).not.toContain('estado-mesa-personas');
  });
});
