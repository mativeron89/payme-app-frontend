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

describe('🔴 el campo de Stripe se cierra durante la ventana (AF-01, P27)', () => {
  /**
   * 🔴 P27-① · SE AFIRMA EL CABLEADO AL PREDICADO, NO UN LITERAL.
   *
   * La versión anterior matcheaba `disabled={journalPendiente}` — y por eso
   * quedaba **verde 4/4 con el valor forzado a `false`**, y también con la
   * copia PARCIAL del predicado que fue el defecto funcional de esta vuelta.
   * Ahora se exige que reciba **el mismo predicado unificado que las demás
   * superficies**, y que ese predicado contenga sus dos términos: mutar
   * cualquiera de los dos pone esto rojo.
   */
  it('🔴 el campo recibe el PREDICADO UNIFICADO, no una copia ni un literal', () => {
    expect(vivo(PANTALLA)).toMatch(/<CardField[\s\S]{0,300}disabled=\{seleccionBloqueada\}/);
    // Y no una llave propia: si vuelve a tener la suya, esto cae.
    expect(vivo(PANTALLA)).not.toMatch(/<CardField[\s\S]{0,300}disabled=\{journalPendiente\}/);
    expect(vivo(PANTALLA)).not.toMatch(/<CardField[\s\S]{0,300}disabled=\{(true|false)\}/);
  });

  it('🔴 el predicado cierra la ventana por SUS DOS estados, no por uno', () => {
    // «todavía no sé» y «sé que hay replay» son distintos: pasarle sólo el
    // primero fue exactamente el defecto del P27.
    const def = vivo(PANTALLA).match(/const seleccionBloqueada = [^;]+;/)?.[0] ?? '';
    expect(def, 'desapareció el predicado unificado').not.toBe('');
    expect(def).toMatch(/journalPendiente/);
    expect(def).toMatch(/frozenScope/);
  });

  /**
   * 🔴 P34 · EL CENSO SE MUDÓ, Y SE MUDÓ PORQUE ESTABA MAL.
   *
   * Acá vivían dos oráculos que Codex **refutó con cuatro sondas verdes**:
   *   · un «censo por exhaución» que construía su universo buscando
   *     `disabled={…}` — o sea, la PROYECCIÓN de la población y no la
   *     población: borrar el prop sacaba la superficie del censo en vez de
   *     denunciarla, y su control positivo era un umbral (`> 8`) que doce
   *     superficies satisfacían aunque una perdiera la guarda;
   *   · unas anclas «por identidad» que miraban ±900 caracteres alrededor y
   *     **aceptaban la guarda de un vecino**.
   *
   * El reemplazo vive en `src/screens/censoSuperficiesPago.test.ts`, deriva la
   * población por AST de las superficies interactuables y ata cada guarda al
   * atributo propio del elemento. **No se aflojó nada acá: se sacó lo que
   * afirmaba de más.** Lo que queda en este archivo es lo que de verdad es de
   * `CardField` — su cableado y la cadena del nacer.
   */

  it('🔴 el campo lo aplica por la API del SDK, no por el DOM', () => {
    // `disabled={...}` no toca un iframe de otro origen: el gate es
    // `element.update({ disabled })`. Si alguien lo "simplifica" a un atributo
    // HTML, esto se pone rojo.
    expect(vivo(CAMPO)).toMatch(/update\(\{\s*disabled\s*\}\)/);
  });

  /**
   * 🔴 P30 · EL MUTANTE `disabledRef.current = false`.
   *
   * Codex cambió **sólo esa asignación** y el campo **podía nacer habilitado
   * aunque el prop ya fuera `true`** — sobrevivieron 22/22 focales y la suite
   * entera. Mi test anterior sólo miraba que el montaje usara
   * `disabledRef.current`, y **eso seguía siendo cierto con el ref mintiendo**.
   *
   * El testigo tiene que cubrir **la cadena completa del NACER**, que son tres
   * eslabones y cada uno se puede romper solo:
   *   ① el ref se INICIALIZA con el prop, no con `false`;
   *   ② el efecto lo SINCRONIZA con el prop en cada cambio;
   *   ③ el montaje APLICA ese valor al seam del SDK.
   *
   * ⚠️ Es acreditación **de fuente** —el campo no monta en la suite mock— y se
   * declara como tal, igual que el resto de este archivo.
   */
  it('🔴 ① el ref del estado inicial se inicializa CON EL PROP, no con un literal', () => {
    expect(vivo(CAMPO)).toMatch(/useRef\(disabled\)/);
    expect(vivo(CAMPO)).not.toMatch(/useRef\((?:false|true)\)\s*;?\s*\n[\s\S]{0,80}disabledRef/);
  });

  it('🔴 ② el efecto lo sincroniza con el prop, sin literal de por medio', () => {
    expect(vivo(CAMPO)).toMatch(/disabledRef\.current\s*=\s*disabled\s*;/);
    // El mutante exacto que sobrevivió: la asignación forzada a un literal.
    expect(vivo(CAMPO)).not.toMatch(/disabledRef\.current\s*=\s*(?:false|true)\s*;/);
  });

  it('🔴 ③ y el montaje aplica ese valor al seam del SDK', () => {
    expect(vivo(CAMPO)).toMatch(/update\(\{\s*disabled:\s*disabledRef\.current\s*\}\)/);
  });

  it('el prop existe en la interfaz: no se pasa a un componente que lo ignora', () => {
    expect(vivo(CAMPO)).toMatch(/disabled\?:\s*boolean/);
    expect(vivo(CAMPO)).toMatch(/disabled\s*=\s*false\s*\}: Props/);
  });
});
