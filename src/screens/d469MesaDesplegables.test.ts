import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EN } from '../i18n/en';

/**
 * D469 · la pantalla de la mesa (Mati, con captura de «Tu mesa» después de
 * «Listo»): el engranaje arriba a la derecha y visible también después de
 * «Listo»; «Cómo se arma tu parte» pasa al desplegable «Tu parte»; sin la línea
 * «Propina de la mesa: X %»; y el orden «Quiénes están en la mesa», «Tu parte»,
 * «Tus consumos», los tres cerrados al abrir. El comportamiento en el navegador
 * lo prueba `e2e/d469-mesa-desplegables.spec.ts`; acá, las guardas de fuente.
 */
const vista = readFileSync(new URL('./MesaDetailView.tsx', import.meta.url), 'utf8');
const hoja = readFileSync(new URL('../components/HojaDeLaMesa.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');

/** El bloque del organizador: de `{esTitular ? (` al `) : (` de quien no organiza. */
function bloqueDelTitular(): string {
  const desde = vista.indexOf('{esTitular ? (\n          <>');
  const hasta = vista.indexOf(') : (\n          <>', desde);
  expect(desde, 'no encontré el bloque de «Tu mesa»').toBeGreaterThan(0);
  expect(hasta).toBeGreaterThan(desde);
  return vista.slice(desde, hasta);
}

describe('D469 · «Tu mesa»: engranaje y tres desplegables cerrados', () => {
  it('los tres desplegables arrancan cerrados (la lista sólo abierta en la mesa de ejemplo de la guía)', () => {
    expect(vista).toContain('const [quienesAbierto, setQuienesAbierto] = useState(false);');
    expect(vista).toContain('const [miParteAbierta, setMiParteAbierta] = useState(false);');
    expect(vista).toContain('const [consumosAbierto, setConsumosAbierto] = useState(ejemplo);');
    expect(vista).not.toContain('useState(true);\n  /** D469');
  });

  it('«Tu parte» es un desplegable sin el título viejo; adentro platos, propina y «Total»', () => {
    expect(vista).toContain("<Desplegable className=\"mi-parte-desglose\" titulo={t('Tu parte')} abierto={abierto} onToggle={onToggle}>");
    expect(vista).not.toContain("t('Cómo se arma tu parte')");
    expect(vista).not.toContain('mi-parte-desglose-titulo');
    // AF-1 conserva los platos en consumo y muestra la parte en reparto igual.
    // La guarda exige ambas ramas y su discriminador, no sólo los literales.
    expect(vista).toContain("<dt>{esConsumo ? t('Tus platos') : rotuloDePartesIguales(partes, t)}</dt>");
    expect(vista).toContain("<dt>{t('Total')}</dt>");
    expect(EN['Total']).toBe('Total');
    expect(EN['Tu parte']).toBe('Your share');
    expect(EN).not.toHaveProperty('Cómo se arma tu parte');
  });

  it('el orden del organizador: quiénes → solicitudes → Tu parte → Tus consumos → cerrar mesa', () => {
    const bloque = bloqueDelTitular();
    const posiciones = [
      'className="quienes"',
      'className="solicitudes"',
      '{desgloseDeMiParte}',
      'className="tus-consumos"',
      'className="mesa-cerrar"',
    ].map((marca) => [marca, bloque.indexOf(marca)] as const);
    for (const [marca, pos] of posiciones) expect(pos, marca).toBeGreaterThan(0);
    const ordenadas = [...posiciones].sort((a, b) => a[1] - b[1]).map(([m]) => m);
    expect(ordenadas).toEqual(posiciones.map(([m]) => m));
  });

  it('la línea «Propina de la mesa» ya no está en la página del organizador; quien no organiza la conserva (R5)', () => {
    expect(bloqueDelTitular()).not.toContain('propina-mesa-lectura');
    expect(bloqueDelTitular()).not.toContain('{propinaLeida &&');
    // Una vez para quien no organiza y otra dentro de la hoja del engranaje.
    expect(vista.match(/className="propina-mesa-lectura"/g)).toHaveLength(2);
  });

  it('el engranaje va a la derecha de la tarjeta, con su nombre, aria-expanded y 44 × 44', () => {
    expect(vista).toMatch(/derecha=\{hayConfiguracion \? \(\s*<button[\s\S]*?className="title-card-engranaje"/);
    expect(vista).not.toMatch(/cuadro=\{hayConfiguracion/);
    expect(vista).toContain("aria-label={t('Configuración de la mesa')}");
    expect(vista).toContain('aria-expanded={hojaDeLaMesa}');
    expect(vista).toContain("icono={esTitular ? 'tienda' : 'cubiertos'}");
    const regla = css.match(/\n\.title-card-engranaje\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(regla).toContain('width: 44px');
    expect(regla).toContain('height: 44px');
    expect(css).not.toMatch(/\n\.title-card-boton\s*\{/);
  });

  it('después de «Listo» el engranaje no depende de que la propina se pueda cambiar: la hoja la muestra leída', () => {
    expect(vista).toContain('const hayConfiguracion = esTitular && !ejemplo\n    && (codigoParaUnirse !== null || !!propinaDeLaMesa || propinaLeida !== null);');
    expect(vista).toContain('propina={propinaDeLaMesa ?? (propinaLeida !== null ? <p className="propina-mesa-lectura">{propinaLeida}</p> : null)}');
    // La hoja sigue sin decidir nada: dibuja lo que recibe.
    expect(hoja).toContain('{propina}');
  });
});
