import { describe, expect, it } from 'vitest';

/**
 * §1.5 bis · EL CABLEADO del selector de método — no la regla, que ya está
 * probada pura en `tarjetaElegida.test.ts`.
 *
 * 🔴 **Existe porque probar la función no es probar el cableado.** `metodoSinElegir`
 * puede estar perfecta y no ser llamada, o llamarse sólo desde el `disabled` de
 * un botón. Cada aserción de acá corresponde a un mutante que planté y verifiqué
 * que muere; el listado está en el CHANGELOG de la versión.
 *
 * ⚠️ Es acreditación **de fuente**, más débil que la observable, y se declara:
 * el estado «sin elegir» sólo se alcanza en el navegador durante la ventana del
 * journal, y ese caso lo cubre `e2e/atribucion-ventana.spec.ts`. Lo que NO se
 * puede observar en mock es el reintento congelado.
 */
const FUENTE = import.meta.glob('/src/screens/MesaScreen.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function pantalla(): string {
  const texto = FUENTE['/src/screens/MesaScreen.tsx'];
  // Sin esto, un glob que no encuentra nada deja pasar TODO en verde.
  expect(texto, 'no se pudo leer MesaScreen.tsx').toBeTruthy();
  return texto!;
}
const vivo = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('§1.5 bis · el método de pago no se adivina', () => {
  it('🔴 `cardChoice` NACE sin elegir, no en `new`', () => {
    const v = vivo(pantalla());
    expect(v).toMatch(/useState<string>\(SIN_TARJETA_ELEGIDA\)/);
    expect(v, "volvió a nacer en 'new': la lista desplegada marcaría una fila que nadie tocó")
      .not.toMatch(/useState<string>\('new'\)/);
  });

  it('🔴 el reset por mesa usa EL MISMO sentinela, no un literal propio', () => {
    // Un default escrito en dos lugares se desincroniza: mutar sólo el
    // `useState` dejaba el reset gobernando el camino real después de cambiar
    // de mesa, y ningún test lo veía.
    const v = vivo(pantalla());
    expect(v).toMatch(/setCardChoice\(SIN_TARJETA_ELEGIDA\);\s*setSaveCard/);
    expect(v).not.toMatch(/setCardChoice\('new'\);\s*setSaveCard/);
  });

  it('🔴 LA MITAD DURA: el envío se corta, no sólo se avisa', () => {
    // Sin esto, con guardadas y ninguna elegida `savedCard` da null y el envío
    // cae al camino de la tarjeta NUEVA: en mock cobra con un `pm_` que nadie
    // eligió, en real muere pidiendo un campo que no está en pantalla.
    expect(vivo(pantalla())).toMatch(/if \(frenoPorMetodo\(\{ metodoPendiente, frozenTienePayload: !!frozen\?\.payload \}\)\) \{/);
  });

  it('🔴 y NO traba el reintento congelado: la condición lleva su exclusión', () => {
    // El caso que convertiría la guarda en una trampa. El reenvío manda
    // `frozen.payload`, que ya trae su método; pedir que se elija cortaría la
    // única salida de ese estado.
    const v = vivo(pantalla());
    const corte = v.match(/if \(frenoPorMetodo\([^;]*?\)\) \{/)?.[0] ?? '';
    expect(corte, 'desapareció el corte del método').not.toBe('');
    // 🔴 Se afirma que el call site le PASA el estado del reintento. La regla
    // está probada pura en `tarjetaElegida.test.ts`; acá se prueba el CABLEADO,
    // que es lo que un test de la función sola nunca ve.
    expect(corte, 'el corte dejó de pasarle el reintento congelado').toContain('frozenTienePayload: !!frozen?.payload');
  });

  /**
   * 🔴 SE AFIRMA LA AUSENCIA, y es la aserción más frágil de este archivo
   * porque nada en la pantalla la sugiere.
   *
   * El CTA **no** se apaga por «sin elegir», y es una decisión ratificada de
   * ESTA pantalla: *«un botón gris se lee como error del sistema, no como te
   * falta un paso»* (Mati, sobre la propina obligatoria, §1.5 bis). Alguien
   * «completando» la guarda de buena fe agregaría `metodoPendiente` al
   * `disabled` del CTA y contradiría el acta sin enterarse.
   */
  it('🔴 el CTA NO se apaga por «sin elegir»: se avisa, no se bloquea', () => {
    const v = vivo(pantalla());
    const cta = v.slice(v.indexOf('            disabled:'));
    expect(cta, 'no se encontró el disabled del CTA').not.toBe('');
    expect(cta.slice(0, 800), 'el CTA volvió a apagarse por «sin elegir»')
      .not.toContain('metodoPendiente');
  });

  it('🔴 la fila «sin elegir» no nombra NINGUNA tarjeta', () => {
    // ORDEN 1-B, un nivel más adentro: ni la default ni la última usada. El
    // texto de la tarjeta vive detrás de la negación del predicado.
    const v = vivo(pantalla());
    expect(v).toMatch(/\{metodoPendiente \? t\('Elige tu método de pago'\) : \(tarjetaElegidaTexto/);
    expect(v).toMatch(/\{!metodoPendiente && \(/);
  });

  it('🔴 y el aviso es el de la propina: toast, foco y pulso — los tres', () => {
    // Sin el scroll, en un teléfono el toast se pierde arriba y el borde que
    // pulsa está fuera de pantalla: el aviso existiría y nadie lo vería.
    const v = vivo(pantalla());
    const bloque = v.slice(v.indexOf('if (frenoPorMetodo('));
    expect(bloque.slice(0, 400)).toContain("toast(t('Elige tu método de pago'))");
    expect(bloque.slice(0, 400)).toContain('metodoSectionRef.current?.scrollIntoView');
    expect(bloque.slice(0, 400)).toContain('setMetodoPulse(true)');
  });
});
