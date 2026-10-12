import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * 🔴 D295 · eliminar un amigo deslizando a la izquierda (0.245.1). Mati: «Cambia el formato de eliminar amigos por el de
 * desplazar a la izquierda y que aparezca el botón de eliminar».
 *
 * La pantalla no se puede montar acá (sin DOM, por ratificación): se vigila la fuente. La conducta la prueba
 * `e2e/amigos-deslizar.spec.ts` en el navegador.
 */

const social = readFileSync(new URL('./SocialScreen.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');

/** La lista de amigos: del `map` de `amigosVisibles` al cierre de la pestaña. */
const listaDeAmigos = (() => {
  const desde = social.indexOf('{amigosVisibles?.map((f) => (');
  expect(desde).toBeGreaterThan(0);
  return social.slice(desde, social.indexOf("{tab === 'grupos' && (", desde));
})();

describe('🔴 D295 · Amigos: deslizar para eliminar, sin la ✕', () => {
  it('cada amigo va en FilaDeslizable (el de Mesas), con el nombre completo para «Eliminar {nombre}»', () => {
    expect(social).toContain("import { FilaDeslizable } from '../components/FilaDeslizable';");
    expect(listaDeAmigos).toMatch(/<FilaDeslizable\s+key=\{f\.id\}\s+className="amigo-deslizable"/);
    expect(listaDeAmigos).toContain('nombre={f.full_name}');
    expect(listaDeAmigos).toContain('</FilaDeslizable>');
  });

  it('una sola fila abierta: la pantalla guarda la única, y cerrar sólo cierra la propia', () => {
    expect(social).toContain('const [amigoDeslizado, setAmigoDeslizado] = useState<string | null>(null);');
    expect(listaDeAmigos).toContain('abierta={amigoDeslizado === f.id}');
    expect(listaDeAmigos).toContain('onAbrir={() => setAmigoDeslizado(f.id)}');
    expect(listaDeAmigos).toContain('onCerrar={() => setAmigoDeslizado((actual) => (actual === f.id ? null : actual))}');
  });

  it('«Eliminar» hace lo que hacía la ✕: la misma confirmación, la misma llamada, los mismos avisos y recargas', () => {
    const accion = listaDeAmigos.slice(listaDeAmigos.indexOf('onEliminar={async () => {'), listaDeAmigos.indexOf('<div className="friend-row"'));
    const pasos = [
      'setAmigoDeslizado(null);',
      "if (!window.confirm(t('¿Quitar a {0} de tus amigos?', f.full_name))) return;",
      'await api.removeFriend(f.id);',
      "toast(t('Amigo quitado'));",
      'loadFriends();',
      'loadRequests();',
      "toast(t('No se pudo quitar de tus amigos'));",
    ];
    let desde = 0;
    for (const paso of pasos) {
      const i = accion.indexOf(paso, desde);
      expect(i, paso).toBeGreaterThan(desde - 1);
      desde = i + paso.length;
    }
  });

  it('🔴 la ✕ ya no está en la lista de amigos; la de los miembros de un grupo sigue (Grupos no cambia)', () => {
    expect(listaDeAmigos).not.toContain('✕');
    expect(listaDeAmigos).not.toContain("t('Quitar a {0}', f.first_name)");
    expect(listaDeAmigos).not.toContain('className="back-btn"');
    expect(social).toContain("aria-label={t('Quitar a {0} del grupo', m.first_name)}");
  });

  it('CSS: la línea entre amigos la pone el envoltorio, sin radio propio, y después de `.deslizable` (gana la última)', () => {
    const base = css.indexOf('\n.deslizable {');
    const propio = css.indexOf('\n.amigo-deslizable {');
    expect(base).toBeGreaterThan(0);
    expect(propio).toBeGreaterThan(base);
    expect(css.slice(propio, css.indexOf('}', propio))).toContain('border-radius: 0;');
    const linea = css.indexOf('\n.amigo-deslizable:not(:last-child) {');
    expect(linea).toBeGreaterThan(base);
    expect(css.slice(linea, css.indexOf('}', linea))).toContain('border-bottom: 1px solid var(--gray-l);');
  });
});
