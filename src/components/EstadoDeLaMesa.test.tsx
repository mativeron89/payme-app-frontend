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
