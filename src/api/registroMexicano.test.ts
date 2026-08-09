import { describe, expect, it } from 'vitest';

/**
 * 🔴 EL PRODUCTO HABLA ESPAÑOL MEXICANO · decisión de Mati, 2026-08-09.
 *
 * Su respuesta literal, por el canal de Diseño: *"Cambiar el mockup para que el
 * lenguaje sea español mexicano por favor"*. La pregunta era sobre una captura,
 * pero **los strings viven en los componentes y son los mismos en mock y en
 * real**: no existe forma de cambiar el idioma del demo sin cambiar el del
 * producto.
 *
 * ## 🔴 EL ALCANCE, que es una decisión y no un descuido
 *
 * Esto barre **texto de usuario**, no comentarios de código. Tres motivos:
 *
 * 1. **El gobierno de este repo manda rioplatense para el trabajo**
 *    (`CLAUDE.md`: *"Idioma: español rioplatense"*). El equipo habla
 *    rioplatense; **el PRODUCTO habla mexicano**. Es una división, no una
 *    excepción.
 * 2. Un comentario **no le llega a nadie que use la app** — misma doctrina que
 *    ya se aplica al egress: en `src/` los comentarios se ignoran porque se
 *    compilan y no viajan.
 * 3. Reescribir cientos de comentarios sería un diff enorme donde el cambio
 *    real se pierde, y **traducir prosa técnica a granel es exactamente donde
 *    el sentido se desvía**.
 *
 * Por el mismo criterio, los títulos de `describe()`/`it()` son lenguaje del
 * equipo y se conservan.
 *
 * ## Por qué esta guarda tiene que existir
 *
 * Sin ella la próxima frase nace en rioplatense y nadie se entera hasta que
 * alguien mira una captura. El registro no es algo que se revise leyendo: se
 * cuela de a una frase.
 */

/**
 * 🔴 Las formas se derivan de un PATRÓN, no de una lista de palabras.
 *
 * Una lista escrita a mano nace vieja: mi primer censo tenía diez formas y el
 * barrido ancho encontró **treinta**, incluidas `Reintentá` (×15), `Garantizá`
 * (×9) y `Escaneá` (×5), que nadie había nombrado.
 *
 * El patrón es la morfología del voseo:
 *   · imperativo   verbo terminado en `á`/`é`/`í` tónica  — `Tocá`, `Elegí`
 *   · presente     terminado en `ás`/`és`/`ís`            — `tenés`, `podés`
 *
 * Y como el patrón también matchea español legítimo —`está`, `además`,
 * `sección`— hay una allowlist de excepciones, cada una una palabra real del
 * idioma. **Ese es el precio de derivar: la allowlist se audita, una lista de
 * prohibidos no se puede auditar porque no se sabe qué falta.**
 */
const PATRON_VOSEO = /(?<![A-Za-zÁÉÍÓÚáéíóúñÑ])([A-Za-zñÑ]{2,}(?:[áéí]|[áéí]s))(?![A-Za-zÁÉÍÓÚáéíóúñÑ])/g;

/** Español legítimo que el patrón matchea. Cada entrada es una palabra real. */
const ESPANOL_LEGITIMO = new Set([
  // Verbos y adverbios de uso común con tilde final.
  'está', 'están', 'estás', 'más', 'también', 'después', 'atrás', 'además', 'jamás', 'quizás',
  'así', 'ahí', 'allí', 'aquí', 'allá', 'acá', 'día', 'días', 'sí', 'mí', 'tú',
  // Interrogativos con tilde. `qué` faltaba y la guarda lo encontró en ocho
  // lugares la primera vez que corrió: la allowlist crece por EVIDENCIA, no
  // por adivinanza — que es la diferencia con una lista de prohibidos.
  'qué', 'porqué',
  'demás', 'esté', 'estés', 'dé', 'sé', 'té', 'café', 'cafés', 'continúas', 'aún',
  // Sustantivos y adjetivos.
  'según', 'sección', 'versión', 'sesión', 'razón', 'garantía', 'garantías',
  'línea', 'página', 'código', 'método', 'último', 'único', 'máximo', 'mínimo',
  'rápido', 'válido', 'número', 'términos', 'árbol', 'débito', 'crédito',
  'automático', 'teléfono', 'búsqueda', 'cámara', 'país', 'atención', 'posición',
  // Nombres propios del seed.
  'nicolás', 'josé', 'maría',
  // Pretéritos de primera persona (aparecen en prosa de tests).
  'sumé', 'bloqueé', 'tomé', 'encontré', 'entré', 'pagué',
]);

/**
 * Reemplaza cada comentario por espacios **conservando las posiciones**, para
 * que los números de línea del mensaje de error sigan sirviendo.
 */
function sinComentarios(texto: string): string {
  const out = texto.split('');
  let i = 0;
  while (i < texto.length) {
    if (texto.startsWith('/*', i)) {
      const fin = texto.indexOf('*/', i + 2);
      const j = fin < 0 ? texto.length : fin + 2;
      for (let k = i; k < j; k++) if (out[k] !== '\n') out[k] = ' ';
      i = j;
    } else if (texto.startsWith('//', i)) {
      const fin = texto.indexOf('\n', i);
      const j = fin < 0 ? texto.length : fin;
      for (let k = i; k < j; k++) out[k] = ' ';
      i = j;
    } else {
      i++;
    }
  }
  return out.join('');
}

/** Palabras que disparan la guarda dentro de un texto ya sin comentarios. */
export function vosesEn(texto: string): string[] {
  return [...texto.matchAll(PATRON_VOSEO)]
    .map((m) => m[1]!)
    .filter((w) => !ESPANOL_LEGITIMO.has(w.toLowerCase()));
}

/** Títulos de `describe()`/`it()`: lenguaje del equipo, no del producto. */
const LENGUAJE_DEL_EQUIPO = [
  'walletRailNotifications.mirror.test.ts',
  'historialView.test.ts',
  'payloadIdentity.vectors.test.ts',
];

describe('el producto habla español mexicano', () => {
  const fuentes = import.meta.glob('/src/**/*.{ts,tsx}', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>;

  it('el glob encontró el árbol (si no, todo lo de abajo pasaría en vacío)', () => {
    expect(Object.keys(fuentes).length, 'no se leyó ningún archivo').toBeGreaterThan(100);
  });

  it('🔴 MUTANTE · ninguna forma de voseo en el texto de usuario de `src/`', () => {
    const ofensores: string[] = [];
    for (const [ruta, cuerpo] of Object.entries(fuentes)) {
      // Este archivo NOMBRA las formas para explicarlas y para probarse a sí
      // mismo; barrerlo sería perseguir su propia documentación.
      if (ruta.endsWith('registroMexicano.test.ts')) continue;
      if (LENGUAJE_DEL_EQUIPO.some((f) => ruta.endsWith(f))) continue;
      for (const w of vosesEn(sinComentarios(cuerpo))) ofensores.push(`${ruta} → ${w}`);
    }
    expect(ofensores, `voseo en el producto: ${ofensores.join(' · ')}`).toEqual([]);
  });

  /**
   * 🔴 EL CASO LEGÍTIMO, en sus dos mitades. Sin esto, un detector que marcara
   * TODO dejaría el mutante en rojo igual — y rompería el español normal.
   */
  it('🔴 CASO LEGÍTIMO · el patrón detecta voseo y NO marca español correcto', () => {
    // Detecta: las formas reales que había en el repo, incluidas las que la
    // lista original no nombraba.
    for (const w of ['Tocá', 'Elegí', 'tenés', 'podés', 'Reintentá', 'Garantizá', 'Escaneá', 'consumís']) {
      expect(vosesEn(w), `no detectó "${w}"`).toEqual([w]);
    }
    // Y NO marca: español mexicano correcto, ni palabras que sólo se le parecen.
    const bueno = 'Toca lo que consumiste. Ya está más que listo; después revisa la sección y continúa aquí. '
      + 'Tienes 3 días, el número es válido y el código también. Nicolás pagó $80 en el café.';
    expect(vosesEn(bueno), 'marcó español correcto').toEqual([]);
  });

  it('🔴 el copy convertido de verdad pasa la guarda', () => {
    // La contracara sobre texto REAL del producto, no inventado para el test.
    for (const frase of [
      '¿Cuánto tomas tú?',
      'Toca lo que consumiste. Al elegirlo queda reservado para ti.',
      '¿No tienes cuenta? Regístrate',
      'Divide y paga la cuenta desde la mesa',
      'Elige una guardada o usa otra',
      'Súmate a la mesa PA-2847 en PayMe',
    ]) {
      expect(vosesEn(frase), `el copy nuevo dispara la guarda: ${frase}`).toEqual([]);
    }
  });

  it('🔴 cada excepción de la allowlist es una palabra, no un comodín', () => {
    // Una allowlist se degrada metiéndole frases o fragmentos. Esto lo impide.
    for (const w of ESPANOL_LEGITIMO) {
      expect(w, `"${w}" no es una palabra suelta`).toMatch(/^[a-záéíóúñ]+$/);
      expect(w, `"${w}" está en mayúsculas: la comparación es en minúsculas`).toBe(w.toLowerCase());
    }
  });
});
