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
 *
 * ─── 🔴 LO QUE NO VA A LA ALLOWLIST, Y POR QUÉ (2026-08-13) ─────────────────
 *
 * **La primera persona del pretérito choca con el patrón y NO se exenta.**
 * Medido:
 *
 *     Todavía no elegí   → marca `elegí`     primera persona, legítima
 *     Ya pagué           → marca `pagué`     primera persona, legítima
 *     Elegí lo que…      → marca `Elegí`     imperativo voseante, real
 *
 * 🔴 **`elegí`, `consumí` y `compartí` son SIMULTÁNEAMENTE la primera persona
 * del pretérito y el imperativo voseante: son la misma cadena.** Meterlas acá
 * no elimina un falso positivo — **apaga la detección del voseo real justo en
 * los verbos que más usa este producto.** La ambigüedad es irreducible para un
 * patrón morfológico: es el límite del método, no un defecto que se pula.
 *
 * **La política es evitar la palabra ambigua en el copy, no exentarla.** Ya se
 * aplicó el 2026-08-13: el CTA de Compartir quedó «Elegir mis ítems» en vez de
 * «Elegir lo que consumí» —el infinitivo no es ambiguo y dice lo mismo—. Ese
 * CTA luego pasó a «Continuar» por la corrección visual del 2026-08-24; Diseño
 * dejó «Todavía no elegí» fuera de su corrección de 16 voseos por ser legítima.
 *
 * ⚠️ **La colisión que todavía no ocurrió y va a ocurrir: `pagué`.** Esto es
 * una app de pagos y «Ya pagué» / «Pagué mi parte» son frases que el producto
 * va a querer decir. Hoy no hay ninguna en `src/`. **Cuando llegue, se
 * reescribe la frase; no se agrega la palabra.**
 */
const PATRON_VOSEO = /(?<![A-Za-zÁÉÍÓÚáéíóúñÑ])([A-Za-zñÑ]{2,}(?:[áéí]|[áéí]s))(?![A-Za-zÁÉÍÓÚáéíóúñÑ])/g;

/**
 * 🔴 EL VOSEO CON ENCLÍTICO NO LLEVA TILDE, así que el patrón de arriba NO
 * PUEDE VERLO: `pedí` + `le` = `pedile`, `escribí` + `nos` = `escribinos`.
 * Al pegarse el pronombre, la tilde deja de ser final y se escapa **la clase
 * entera** — `tocalo`, `elegilo`, `pasalo`, `fijate`, `acordate`.
 *
 * **Había TRES en el producto y la guarda pasaba en verde**, desde que se
 * escribió: `joinLinkView.ts` («Pedile»), `reconciliacionMesaView.ts` y
 * `LoginScreen.tsx` («Escribinos»).
 *
 * ⚠️ **ACÁ SÍ ES UNA LISTA, y digo por qué en vez de disimularlo.** Enfoque
 * tomado de `espanolMexicano.test.ts` de Dashboard Frontend, que ya resolvió
 * esto y **midió** el motivo: la regla morfológica pura —«palabra en
 * `-alo/-ate/-ame` sin tilde»— da falsos positivos masivos contra
 * identificadores en inglés (`navigate`, `create`, `invalidate`, `username`,
 * `candidate`, `activate`). **Una guarda que se pone roja con `navigate` se
 * termina apagando, y ahí se pierde de verdad.**
 *
 * 🔴 Es el punto débil conocido de esta mitad: cubre lo visto y lo cercano, no
 * lo desconocido. La cobertura fuerte —mundo cerrado— es la del patrón de
 * arriba. No se disimula: se declara.
 */
const RAICES_VOSEO = [
  'manda', 'hace', 'usa', 'toca', 'elegi', 'proba', 'mira', 'deja', 'carga',
  'guarda', 'revisa', 'escribi', 'pedi', 'conta', 'fija', 'acorda', 'queda',
  'anda', 'suma', 'pasa', 'busca', 'agrega', 'confirma', 'avisa',
];
const CLITICOS = new RegExp(
  `\\b(${RAICES_VOSEO.join('|')})(lo|la|los|las|me|te|nos|le|les|se)\\b`,
  'gi',
);

/**
 * 🔴 CENSO LÉXICO · otra familia, y la guarda de arriba no puede verla.
 *
 * «Mozo» es rioplatense; en México se dice **«mesero»**. No es voseo: es
 * vocabulario, y el patrón morfológico mira terminaciones verbales. **Que sea
 * su límite no lo deja sin dueño** — por eso este censo aparte, chico y
 * explícito.
 */
const LEXICO_RIOPLATENSE: ReadonlyArray<readonly [string, string]> = [
  ['mozo', 'mesero'],
  ['mozos', 'meseros'],
  ['plata', 'dinero'],
  ['celular', 'celular'],
];

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
  const porTilde = [...texto.matchAll(PATRON_VOSEO)]
    .map((m) => m[1]!)
    .filter((w) => !ESPANOL_LEGITIMO.has(w.toLowerCase()));
  const porClitico = [...texto.matchAll(CLITICOS)].map((m) => m[0]);
  return [...porTilde, ...porClitico];
}

/** Regionalismos léxicos. Devuelve `palabra → reemplazo mexicano`. */
export function lexicoEn(texto: string): string[] {
  const out: string[] = [];
  for (const [rio, mex] of LEXICO_RIOPLATENSE) {
    if (rio === mex) continue;
    const re = new RegExp(`(?<![A-Za-zÁÉÍÓÚáéíóúñÑ])${rio}(?![A-Za-zÁÉÍÓÚáéíóúñÑ])`, 'gi');
    for (const m of texto.matchAll(re)) out.push(`${m[0]} → ${mex}`);
  }
  return out;
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

  it('🔴 MUTANTE · ningún regionalismo LÉXICO en el texto de usuario', () => {
    const ofensores: string[] = [];
    for (const [ruta, cuerpo] of Object.entries(fuentes)) {
      if (ruta.endsWith('registroMexicano.test.ts')) continue;
      if (LENGUAJE_DEL_EQUIPO.some((f) => ruta.endsWith(f))) continue;
      for (const w of lexicoEn(sinComentarios(cuerpo))) ofensores.push(`${ruta} → ${w}`);
    }
    expect(ofensores, `regionalismos en el producto: ${ofensores.join(' · ')}`).toEqual([]);
  });

  /**
   * 🔴 SONDA de las dos mitades nuevas. Sin esto, una lista vacía o una regex
   * rota dejarían el mutante de arriba en verde para siempre.
   */
  it('🔴 SONDA · el enclítico y el léxico SE DETECTAN, y lo legítimo no', () => {
    for (const mal of ['Pedile', 'escribinos', 'tocalo', 'Elegilo', 'fijate', 'acordate'])
      expect(vosesEn(mal), `se escapó ${mal}`).not.toEqual([]);
    // Identificadores en inglés: la razón por la que esto es una lista y no
    // una regla morfológica. Si alguna cayera, la guarda se terminaría apagando.
    for (const bien of ['navigate', 'create', 'invalidate', 'username', 'candidate', 'activate', 'translate'])
      expect(vosesEn(bien), `falso positivo con ${bien}`).toEqual([]);
    expect(lexicoEn('el mozo trajo la cuenta')).toEqual(['mozo → mesero']);
    expect(lexicoEn('el mesero trajo la cuenta'), 'marcó el término correcto').toEqual([]);
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
