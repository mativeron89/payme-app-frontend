import { describe, expect, it } from 'vitest';

const FUENTES = import.meta.glob('../**/*.tsx', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;
/**
 * 🔴 El glob devuelve las claves con prefijos MEZCLADOS: `./CardField.tsx` para
 * los vecinos y `../screens/MesaScreen.tsx` para el resto. Es la misma trampa
 * que rompió la exclusión de `i18n/` en Dashboard Frontend — ahí la exclusión
 * existía y no excluía nada. Se busca por NOMBRE DE ARCHIVO, que es lo único
 * estable entre las dos formas.
 */
const src = (r: string) => {
  const clave = Object.keys(FUENTES).find((k) => k.endsWith(`/${r}`) || k === `./${r}`);
  const hit = clave ? FUENTES[clave] : undefined;
  if (typeof hit !== 'string') {
    throw new Error(`fuente no encontrada: ${r} · claves: ${Object.keys(FUENTES).slice(0, 4).join(', ')}`);
  }
  return hit;
};

/**
 * CARTEL DE TARJETA DE PRUEBA · `D-FF-2-BIS`.
 *
 * 🔴 POR QUÉ ESTO ES UNA GUARDA DE FUENTE Y NO UN RECORRIDO DE NAVEGADOR, que
 * es lo que yo mismo exigí y NO se puede cumplir.
 *
 * El requisito era probar los TRES casos —aparece con `real_money:false`, NO
 * aparece con `true`, y no se ofrece tarjeta si no se determina—. **Medido: el
 * mock NO puede llegar a la superficie donde vive el cartel.**
 *
 * ```
 * CardsPanel:333       IS_MOCK ? «se agrega una tarjeta de ejemplo» : <CardField/>
 * CreateMesaFlow:1497  IS_MOCK ? «la ingresás al confirmar»        : <CardField/>
 * MesaScreen:1712      !IS_MOCK && <CardField/>
 * ```
 *
 * **En mock nadie tipea un número de tarjeta, así que `CardField` no se monta
 * en ninguna de las tres pantallas.** Es el patrón que este repo ya nombró: *el
 * mock más duro que el real no deja pasar algo falso — deja INALCANZABLE el
 * camino que hay que probar.*
 *
 * ⚠️ **LO QUE ESTO NO ACREDITA, y no se disimula:** que en el build REAL el
 * cartel aparezca y desaparezca según el modo. Eso exige Stripe cargando, o sea
 * el build real contra un backend — **acción externa**. Queda declarado como
 * hueco, no resuelto. **Lo que sí está probado end-to-end es la DECISIÓN**
 * (`moneyRail.test.ts`: 18 casos y 3 mutantes), y acá que el componente la
 * consulte en vez de decidir por su cuenta.
 */
describe('🔴 el cartel vive donde se ESCRIBE el número, y lo gobierna la capability', () => {
  const cf = src('CardField.tsx');

  it('`CardField` consulta la capability · no decide por su cuenta', () => {
    expect(cf).toContain('useMoneyRail()');
    expect(cf).toContain('mostrarAvisoDePrueba');
  });

  it('🔴 el cartel está GATEADO por `mostrarAvisoDePrueba`, no suelto', () => {
    // Un render incondicional mostraría «usá una tarjeta falsa» a alguien con
    // dinero real. El gate y el texto tienen que estar en la misma expresión.
    expect(cf).toMatch(/\{mostrarAvisoDePrueba && \(/);
    const i = cf.indexOf('{mostrarAvisoDePrueba && (');
    expect(cf.slice(i, i + 400)).toContain('Esto es una prueba.');
  });

  it('🔴 y vive en el COMPONENTE, no en las pantallas · cubre las tres por construcción', () => {
    // Garantía, pago y alta usan el mismo `CardField`. Si el cartel se mudara a
    // los call sites, haría falta uno por pantalla y el cuarto se olvidaría.
    for (const p of ['CreateMesaFlow.tsx', 'MesaScreen.tsx', 'CardsPanel.tsx']) {
      const s = src(p);
      expect(s, `${p} monta CardField`).toContain('<CardField');
      expect(s, `${p} NO debe repetir el cartel`).not.toContain('Esto es una prueba.');
    }
  });

  it('🔴 SONDA · el texto es el RATIFICADO, palabra por palabra', () => {
    // Copy de dinero ratificada por Mati el 2026-08-11. Suavizarla es cambiarla:
    // «y no la queremos» es la mitad que tranquiliza, y se pierde sola.
    expect(cf).toContain(
      'Esto es una prueba. Usa una tarjeta de prueba — no hace falta la tuya, y no la queremos.',
    );
    /**
     * 🔴 ACÁ HABÍA UNA ASERCIÓN NEGATIVA Y LA SAQUÉ, con motivo.
     *
     * Decía `expect(cf).not.toContain('Us<á> una tarjeta')` para fijar el
     * mexicano —el Bibliotecario propuso la copy en rioplatense y la corrigió
     * al despacharla—. **Y `registroMexicano.test.ts` la cazó: escribir la
     * forma prohibida, aunque sea para prohibirla, la mete en `src/`.**
     *
     * Es la misma trampa que ya me mordió con «sin gate»: una guarda que
     * prohíbe una forma en todo el árbol no distingue AFIRMAR de CITAR.
     *
     * Se saca en vez de pedir excepción por dos motivos: la guarda global ya
     * hace ese trabajo sobre este archivo —y con una excepción dejaría de
     * hacerlo—, y la aserción POSITIVA de arriba ya fija el texto palabra por
     * palabra, que es más fuerte que prohibir una variante.
     */
  });
});
