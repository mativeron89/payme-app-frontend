import { describe, expect, it } from 'vitest';

/**
 * 🔴 P23-AF-01 · EL CAMPO DE STRIPE DURANTE LA VENTANA — y **por qué esto es
 * un test de fuente y no un E2E**, que es la parte que hay que leer.
 *
 * `CardField` sólo se renderiza con `!IS_MOCK` (`MesaScreen.tsx:1932`), y la
 * suite de navegador corre **en modo mock**: la superficie **no existe** ahí,
 * así que ningún E2E puede verla. Lo comprobé plantando el mutante —quitarle
 * el `update({ disabled })`— y **el E2E siguió verde 2/2**.
 *
 * ⚠️ **Es una acreditación MÁS DÉBIL que las otras ocho superficies, y se
 * declara como tal:** verifica el CABLEADO (que el prop viaje y que el SDK lo
 * aplique), no la conducta observable. La conducta sólo se puede acreditar en
 * el riel real, con Stripe cargado — y eso hoy no está en ninguna suite.
 *
 * No se "arregla" haciendo que el mock renderice un campo falso: sería un
 * oráculo mirando algo que no es Stripe.
 */
const FUENTES = import.meta.glob(
  ['/src/components/CardField.tsx', '/src/screens/MesaScreen.tsx'],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

const CAMPO = FUENTES['/src/components/CardField.tsx']!;
const PANTALLA = FUENTES['/src/screens/MesaScreen.tsx']!;
const vivo = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('🔴 el campo de Stripe se cierra durante la ventana (AF-01)', () => {
  it('la pantalla le pasa la ventana al campo', () => {
    expect(vivo(PANTALLA)).toMatch(/<CardField[\s\S]{0,200}disabled=\{journalPendiente\}/);
  });

  it('🔴 el campo lo aplica por la API del SDK, no por el DOM', () => {
    // `disabled={...}` no toca un iframe de otro origen: el gate es
    // `element.update({ disabled })`. Si alguien lo "simplifica" a un atributo
    // HTML, esto se pone rojo.
    expect(vivo(CAMPO)).toMatch(/update\(\{\s*disabled\s*\}\)/);
  });

  it('🔴 y lo aplica también AL MONTAR: si nace dentro de la ventana, nace cerrado', () => {
    // Sin esto, un campo montado durante la ventana quedaba interactivo hasta
    // el primer cambio de prop — el mismo hueco, una vez más.
    expect(vivo(CAMPO)).toMatch(/update\(\{\s*disabled:\s*disabledRef\.current\s*\}\)/);
  });

  it('el prop existe en la interfaz: no se pasa a un componente que lo ignora', () => {
    expect(vivo(CAMPO)).toMatch(/disabled\?:\s*boolean/);
    expect(vivo(CAMPO)).toMatch(/disabled\s*=\s*false\s*\}: Props/);
  });
});
