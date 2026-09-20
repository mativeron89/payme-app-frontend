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

  it('la liberación queda en el ítem, con ícono, nombre accesible y blanco de 44px', () => {
    expect(mesa).toContain("className={`mi-item${soltable ? ' has-release' : ''}`}");
    expect(mesa).toContain("t('Soltar {0}', i.name)");
    expect(mesa).toContain("'x-circle'");
    expect(css).toMatch(/\.mi-soltar\s*\{[\s\S]*width:\s*var\(--tap-min\);[\s\S]*height:\s*var\(--tap-min\)/);
  });

  it('alinea identidad, mantiene el historial sin rótulo y une tabs/panel', () => {
    expect(header).toContain('className="hdr-identity"');
    expect(css).toMatch(/\.hdr-identity\s*\{[\s\S]*align-items:\s*center/);
    expect(mesas).not.toContain('<h2 className="sectlabel">{t(\'Tus mesas\')}</h2>');
    expect(css).toContain('.stat-tabs-panel');
    expect(css).toContain('border-bottom-color: var(--surface)');
  });

  it('el marco usa proporción 4:3 y altura dinámica, no 400px fija', () => {
    const regla = css.match(/\.scan-frame\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(regla).toContain('aspect-ratio: 4 / 3');
    expect(regla).toContain('42dvh');
    expect(regla).not.toContain('height: 400px');
  });

  it('Social refresca en foco/visibilidad y no promete pendiente en el recibo opaco', () => {
    expect(social).toContain("window.addEventListener('focus', refresh)");
    expect(social).toContain("document.addEventListener('visibilitychange', refresh)");
    expect(social).toContain("t('Envío registrado')");
    expect(social).not.toContain("t('· pendiente')");
  });
});
