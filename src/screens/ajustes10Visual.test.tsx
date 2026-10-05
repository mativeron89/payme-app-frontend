import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const mesa = readFileSync(new URL('./MesaDetailView.tsx', import.meta.url), 'utf8');
const header = readFileSync(new URL('../components/AppHeader.tsx', import.meta.url), 'utf8');
const home = readFileSync(new URL('./HomeScreen.tsx', import.meta.url), 'utf8');
const mesas = readFileSync(new URL('./MesasScreen.tsx', import.meta.url), 'utf8');
const restaurantes = readFileSync(new URL('./TusRestaurantesScreen.tsx', import.meta.url), 'utf8');
const social = readFileSync(new URL('./SocialScreen.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');

describe('AF-AJUSTES10 · guardas visuales focales', () => {
  it('retira los tres textos redundantes sin tocar el feedback operativo', () => {
    expect(mesa).not.toContain('Los pagos llegan pronto; tu selección queda registrada.');
    expect(mesa).not.toContain("t('Elige lo que consumiste')");
    expect(mesa).toContain("t('Elige lo que consumiste para continuar')");
    expect(home).not.toContain('Asociar la cuenta de otra persona toca cómo se autoriza un pago');
    expect(restaurantes).not.toContain("t('Lo que elegiste en tus mesas.')");
  });

  // AF-QUE-CONSUMISTE · decisión 90 · regla 7 del diseño: la liberación sigue en
  // el renglón del plato y con nombre accesible, pero es el círculo marcado (o
  // «Soltar» en el selector), sin la X roja. El blanco de 44 px lo da el
  // pseudoelemento del círculo (definición 4: sin agrandar lo visible).
  it('la liberación queda en el renglón, sin X roja, con nombre accesible y blanco de 44px', () => {
    expect(mesa).toContain('className="qc-circulo qc-circulo--marcado"');
    expect(mesa).toContain("t('Soltar {0}', i.name)");
    expect(mesa).not.toContain("'x-circle'");
    expect(css).toMatch(/button\.qc-circulo::after\s*\{[\s\S]*width:\s*var\(--tap-min\)/);
  });

  it('alinea identidad, mantiene el historial sin rótulo y une tabs/panel', () => {
    expect(header).toContain('className="hdr-user-group"');
    expect(css).toMatch(/\.hdr-user-group\s*\{[\s\S]*align-items:\s*center/);
    expect(mesas).not.toContain('<h2 className="sectlabel">{t(\'Tus mesas\')}</h2>');
    expect(css).toContain('.stat-tabs-panel');
    expect(css).toContain('border-bottom-color: var(--surface)');
  });

  /**
   * D177 · el marco decorativo de 4:3 se fue con la pantalla intermedia. El de
   * la cámara es el del ticket (3:4, vertical) y sigue sin una altura fija: se
   * achica con el espacio que dejan la cabecera, los avisos y los controles.
   */
  it('el marco de la cámara usa proporción y altura máxima, no una altura fija', () => {
    const regla = css.match(/\.camara-marco\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(regla).toContain('aspect-ratio: 3 / 4');
    expect(regla).toContain('max-height: 100%');
    expect(regla).not.toMatch(/(?:^|\s)height:\s*\d/);
    expect(css).not.toMatch(/\n\.scan-frame\s*\{/);
  });

  it('Social refresca en foco/visibilidad y no promete pendiente en el recibo opaco', () => {
    expect(social).toContain("window.addEventListener('focus', refresh)");
    expect(social).toContain("document.addEventListener('visibilitychange', refresh)");
    expect(social).toContain("t('Envío registrado')");
    expect(social).not.toContain("t('· pendiente')");
  });
});
