import { existsSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { EN } from '../i18n/en';
import { EN_VIAJES_CREAR } from '../i18n/viajes/crear';

it.each([
  ['Cada uno lo suyo', 'Everyone their own'],
  ['Cada uno marca lo que consumió.', 'Everyone marks what they had.'],
  ['Estamos comprobando el estado de la mesa…', "Checking the table's status…"],
  ['Tienes cambios sin guardar', 'You have unsaved changes'],
  ['Si sales ahora, lo que marcaste aquí no se guarda.', "If you leave now, what you marked here won't be saved."],
  ['Seguir editando', 'Keep editing'],
  ['Salir sin guardar', 'Leave without saving'],
  ['Lo encuentras en Más › Ayuda', "You'll find it under More › Help"],
  ['¿Borrar tu nota?', 'Delete your note?'],
  ['¿Borrar «{0}»?', 'Delete “{0}”?'],
  ['¿Eliminar la foto del viaje?', 'Delete the trip photo?'],
  ['Se borra del viaje y no se puede recuperar.', "It's removed from the trip and can't be recovered."],
  ['Borrar', 'Delete'],
] as const)('diccionario EN · %s', (clave, ingles) => {
  expect(EN[clave]).toBe(ingles);
});

it.each([
  ['El faltante, si existió, quedó registrado. Aún no podemos afirmar la entrega al restaurante.',
    "If there was a shortfall, it's on record. We still can't confirm the handoff to the restaurant."],
  ['No podemos afirmar que exista un cobro o cierre de la mesa.',
    "We can't confirm there's a charge or closing for the table."],
  ['Por privacidad no mostramos a quién hasta que acepte.',
    "For privacy, we don't show who it is until they accept."],
])('U16 · mantiene el significado de %s', (clave, ingles) => {
  expect(EN[clave!]).toBe(ingles);
});

it('U19 · la barra antigua del link ya no está en componentes ni estilos', () => {
  for (const archivo of ['BarraDeLink.tsx', 'BarraDeLink.test.tsx']) {
    expect(existsSync(new URL(`../components/${archivo}`, import.meta.url))).toBe(false);
  }
  expect(readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8')).not.toContain('.link-barra');
});

it('U20 · N0 incluye el caso de altura corta y varios platos', () => {
  const fuente = readFileSync(new URL('../../e2e/mesa-ux-ui.spec.ts', import.meta.url), 'utf8');
  expect(fuente).toContain('{ width: 414, height: 736 }');
  expect(fuente.indexOf('const platos of [1, 6]')).toBeGreaterThan(fuente.indexOf('width: 414, height: 736'));
});

it('U21 · Quitar se traduce desde el diccionario común', () => {
  expect(EN.Quitar).toBe('Remove');
  expect(EN_VIAJES_CREAR).not.toHaveProperty('Quitar');
});

it('el separador conserva el punto en navegadores sin texto alternativo de CSS', () => {
  const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');
  expect(css).toMatch(/\.mesa-selection-context strong::before\s*\{\s*content: '·';\s*content: '·' \/ '';/);
});
