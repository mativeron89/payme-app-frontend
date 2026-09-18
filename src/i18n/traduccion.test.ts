import { describe, expect, it } from 'vitest';
import { rotuloPropina } from '../screens/propinaRecibo';
import { EN } from './en';
import { traducir } from './idioma';

/**
 * GUARDA DE COBERTURA DE TRADUCCIÓN · `D-IDIOMA-1`.
 *
 * 🔴 EL MODO DE FALLA QUE ESTA GUARDA EXISTE PARA CAZAR:
 *
 * > **Una clave faltante que cae al español no rompe nada y no se ve — hasta
 * > que un usuario mira media pantalla en cada idioma. Fallá ruidoso, no
 * > elegante.**
 *
 * El fallback al español es DELIBERADO en runtime —ver `idioma.tsx`— porque en
 * pantalla es mejor el idioma equivocado que una pantalla rota. **En CI no hay
 * ninguna razón para tolerarlo.**
 */

const FUENTES = import.meta.glob('../**/*.{ts,tsx}', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

/**
 * Cada `t('…')` del código de producto.
 *
 * 🔴 LÍMITE CONOCIDO, y en el dashboard lo encontró LA PANTALLA con esta guarda
 * en verde: **esto mira los `t()` que EXISTEN, no los que FALTAN.** Un texto
 * visible que nadie envolvió es invisible acá. Las constantes de módulo son la
 * clase que se escapa —`NAV_ITEMS` les dejó la navegación entera en español con
 * 753 tests verdes—; acá se traducen al renderizar y hay tests abajo que lo
 * fijan, pero **cerrarlo del todo exigiría que esta guarda supiera qué texto es
 * visible sin que nadie se lo marque**. Queda anotado como límite, no resuelto:
 * la red que lo agarra es mirar la pantalla.
 */
/**
 * Todo valor que puede llegar a un `t(VARIABLE)`, familia por familia — la
 * MISMA fuente que exige la cobertura de traducción (abajo) y que descarta
 * huérfanas (más abajo todavía). Una sola función: dos usos que dejaran de
 * coincidir serían dos censos del mismo universo divergiendo en silencio.
 */
function familiasDinamicas(): Record<string, string[]> {
  const deModulo = (ruta: string, marca: string): string[] => {
    const src = FUENTES[ruta];
    if (typeof src !== 'string') throw new Error(`fuente no encontrada: ${ruta}`);
    const i = src.indexOf(marca);
    if (i < 0) throw new Error(`no se encontró ${marca} en ${ruta}`);
    const bloque = src.slice(i, src.indexOf('};', i) + 2);
    return [...bloque.matchAll(/:\s*'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]!);
  };

  return {
    // HomeScreen.tsx:186 · `t(mesaStatusLabel(mesa.status))`, con su fallback.
    'mesaStatusLabel': [...deModulo('../utils/labels.ts', 'MESA_STATUS'), 'En curso'],
    // MesasScreen.tsx:148 · `t(FRANJA_LABEL[franja])`.
    'FRANJA_LABEL': deModulo('../screens/historialView.ts', 'FRANJA_LABEL'),
    // Cuatro sitios: CardField, CardsPanel, CreateMesaFlow, MesaScreen.
    'CARD_RAIL_UNAVAILABLE_COPY': ['Todavía no está disponible'],
    // AppBottomBar.tsx:68 `t(it.label)` y HomeScreen.tsx:112 `t(x.label)`.
    'las etiquetas de la barra': ['Inicio', 'Mesas', 'Amigos', 'Más'],
    // AppBottomBar.tsx:84,88 · el centro por defecto cuando nadie pasa `center`.
    'el centro por defecto': ['Nueva'],
    // AppHeader.tsx:132 y ui.tsx:32 · `t(backLabel)` con su valor por defecto.
    'backLabel por defecto': ['Volver'],
    // §1.3-bis · CreateMesaFlow: las tres formas de dividir viven en una
    // lista y se traducen por variable. Se enumeran los SEIS strings.
    'las tres formas de dividir': [
      'Por lo que pidió cada uno', 'Cada uno elige sus platos',
      'En partes iguales', 'El total dividido entre todos',
      'Pagar el total', 'Uno o varios cubren toda la cuenta',
    ],
    // Tanda 4 · `t(r.clave, ...r.args)` en el comprobante. Las CUATRO claves
    // se derivan de la función real recorriendo sus cuatro combinaciones: si
    // alguien agrega una quinta forma allá, este test la exige acá sin que
    // nadie se acuerde de venir a escribirla.
    'rotuloPropina': [
      ...new Set(
        [
          { pct: 10, nombre: 'x' },
          { pct: 10, nombre: null },
          { pct: null, nombre: 'x' },
          { pct: null, nombre: null },
        ].map((c) => rotuloPropina(c).clave),
      ),
    ],
    // LoginScreen.tsx:140-141 · `t(ERROR_TEXT[code])`, con fallback genérico
    // (ya cubierto porque es un literal `t('…')` propio). Corregido 2026-09-18:
    // ver nota arriba, no es texto de backend.
    'ERROR_TEXT (LoginScreen)': deModulo('../screens/LoginScreen.tsx', 'const ERROR_TEXT'),
    // EstadisticasScreen.tsx:70 · `t(categoryLabel(stats?.favorite_category))`,
    // con `null` guardado antes de llamar a `t()` (no aplica acá). Corregido
    // 2026-09-18: ver nota arriba, no es texto de backend.
    'categoryLabel (utils/labels)': deModulo('../utils/labels.ts', 'const CATEGORIA'),
  };
}

/** Las 20 frases de wallet que Diseño marcó fuera a propósito (riel muerto). */
const FRASES_WALLET = ['Saldo PayMe', 'Tu saldo PayMe', 'Transferir', 'Cargar',
  'Mostrar saldo', 'Ocultar saldo', 'Abono por SPEI', 'Carga en OXXO',
  'Últimos movimientos', 'Saldo y tarjetas'];

function envueltos(): { ruta: string; texto: string }[] {
  const out: { ruta: string; texto: string }[] = [];
  for (const [ruta, src] of Object.entries(FUENTES)) {
    // Se excluyen los tests y este mismo directorio. 🔴 El glob entrega los
    // vecinos como `./en.ts`, SIN el segmento `i18n/` — la exclusión del
    // dashboard fallaba justamente por eso, así que acá se contempla la forma
    // corta además de la larga.
    if (/\.test\.tsx?$/.test(ruta)) continue;
    if (/(^|\/)(i18n\/)?(en|idioma)\.tsx?$/.test(ruta)) continue;
    const codigo = src
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    for (const m of codigo.matchAll(/\bt\('((?:[^'\\]|\\.)*)'/g)) {
      out.push({ ruta, texto: m[1]!.replace(/\\'/g, "'").replace(/\\\\/g, '\\') });
    }
  }
  return out;
}

/**
 * 🔴 LA CLASE QUE EL EXTRACTOR NO PUEDE VER · enumerada el 2026-08-16.
 *
 * El extractor de arriba es `/\bt\('…'/`: **sólo ve comilla SIMPLE pegada al
 * paréntesis.** Todo lo demás —`t(VARIABLE)`, `t(f(x))`, `t(mapa[k])`— le pasa
 * un identificador, **no aparece en el inventario, y nada avisa**: el texto sale
 * en español dentro de la pantalla en inglés.
 *
 * `payme-dashboard-frontend` chocó con esto TRES VECES en un día. Acá pesa más:
 * su pantalla la mira el dueño del restaurante, ésta la mira el comensal
 * mientras paga.
 *
 * ## El censo, medido con ESTE artefacto y no con un grep de afuera
 *
 * 🔴 **Un conteo hecho con una herramienta y fijado con otra mide dos
 * poblaciones distintas y nadie se entera.** El número de abajo lo produce el
 * mismo código que lo vigila, sobre la misma población que el extractor —sin
 * tests, sin `en`/`idioma`—.
 *
 * ```
 * 658  t(  en todo el repo trackeado
 * 638  con literal de comilla simple   → el extractor los ve
 *  17  con identificador o expresión   → invisibles  (14 en producción, 3 en este archivo)
 *   3  `t()` citado en prosa de este mismo archivo, no son llamadas
 * ```
 *
 * **Particiona: 638 + 17 + 3 = 658, sin resto.** Se verificó además que NO hay
 * comilla doble, ni backtick, ni `t(` multilínea, ni `t('…' + var)` — esa última
 * es la peor porque el extractor ve el prefijo y el runtime compone otra cosa.
 *
 * ## Qué NO cierra este contador, dicho antes de que alguien lo suponga
 *
 * ⚠️ Fija **cuántos** sitios hay, no que cada uno esté cubierto. Lo segundo lo
 * hace el test de abajo, familia por familia y con la constante REAL. Y ninguno
 * de los dos ve el texto visible que nadie envolvió en `t()`: ése es el límite
 * ya declarado arriba y sigue abierto.
 */
// 🔴 SUBIÓ A 17/18 EL 2026-08-20, con intención: la pantalla fusionada
// (§1.3-bis) agregó la familia de opciones de división y vinculó la pregunta
// visible con su nombre accesible. AF-DISENO-02 conserva esa equivalencia, pero
// la maqueta final fija un único literal para ambos sitios (ver ajuste de abajo).
// 🔴 SUBIÓ A 19 el 2026-08-20 (tanda 4, ítem 4): el rótulo de la propina del
// comprobante sale de `rotuloPropina()`, que elige entre CUATRO claves según
// qué se sepa —porcentaje y/o destinatario—. Cubierto por familia acá abajo.
// 🔴 SUBIÓ A 20 el 2026-08-20 (bloqueante 2 de Codex): `receiptText()` —el que
// alimenta compartir y descargar— pasó a usar el MISMO rótulo que la vista en
// vez de emitir «Propina (al mesero)» fijo. Es un `t(VARIABLE)` más, y es
// justamente el que hace que las tres superficies digan lo mismo. La familia
// `rotuloPropina` de abajo ya lo cubre.
// 🔴 BAJÓ A 18 el 2026-08-23 (AF-DISENO-02): los dos sitios que usaban
// `t(tituloStepper(division))` ahora dicen literalmente «¿Cuántos pagan?»,
// tanto en pantalla como en el nombre accesible. La maqueta fija una única
// pregunta para las tres divisiones; se retiró esa familia dinámica, no una
// cobertura de traducción.
const T_SIN_LITERAL = 18;

function sitiosSinLiteral(): string[] {
  const out: string[] = [];
  for (const [ruta, src] of Object.entries(FUENTES)) {
    if (/\.test\.tsx?$/.test(ruta)) continue;
    if (/(^|\/)(i18n\/)?(en|idioma)\.tsx?$/.test(ruta)) continue;
    const codigo = src
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    for (const m of codigo.matchAll(/\bt\(/g)) {
      const resto = codigo.slice(m.index! + m[0].length, m.index! + m[0].length + 2);
      if (/^'/.test(resto)) continue;
      out.push(`${ruta}:${codigo.slice(0, m.index!).split('\n').length}`);
    }
  }
  return out;
}

describe('🔴 los `t()` que NO reciben literal · el extractor no los ve', () => {
  it('🔴 el contador SÓLO SUBE con intención: agregar uno sin cubrirlo es un acto explícito', () => {
    const sitios = sitiosSinLiteral();
    expect(
      sitios.length,
      `cambió la población de \`t(VARIABLE)\`.\n  ${sitios.join('\n  ')}\n\n` +
        'Si se AGREGÓ uno: hay que cubrir su constante en el test de abajo y ' +
        'aumentar T_SIN_LITERAL. Si se SACÓ uno, hay que bajarlo.\n' +
        'Lo que no vale es tocar el número sin mirar la lista.',
    ).toBe(T_SIN_LITERAL);
  });

  /**
   * 🔴 CASO PROPIO POR FAMILIA, con la constante REAL — no un caso genérico.
   *
   * Un test genérico («todo lo que entre a `t()` tiene traducción») no se puede
   * escribir: el argumento es una variable y su valor sólo existe en runtime.
   * Lo que SÍ se puede es enumerar, para cada sitio, **de dónde salen sus
   * valores posibles** y exigir que cada uno tenga entrada EN.
   *
   * 🔴 CORREGIDO 2026-09-18 (censo de huérfanas, AF-07): este comentario decía
   * que `LoginScreen.tsx` (`t(crudo)`) y `EstadisticasScreen.tsx`
   * (`t(crudoCocina)`) quedaban FUERA porque recibían "texto que llega del
   * backend en runtime, sin constante que enumerar". **Era falso: los dos
   * indexan una constante de módulo LOCAL** — `ERROR_TEXT` en `LoginScreen.tsx`
   * y `CATEGORIA` en `utils/labels.ts` (vía `categoryLabel()`) — sobre un
   * código/enum que sí viene del backend, pero el TEXTO en español que se le
   * pasa a `t()` es 100% local y enumerable. Las dos familias ya están abajo.
   * No queda ningún sitio deliberadamente afuera: los 18 de `T_SIN_LITERAL`
   * están cubiertos por alguna familia.
   */
  it('🔴 cada valor que puede entrar a un `t(VARIABLE)` tiene traducción EN', () => {
    const sinEntrada: string[] = [];
    for (const [familia, valores] of Object.entries(familiasDinamicas())) {
      expect(valores.length, `la familia ${familia} quedó vacía: mediría en vacío`).toBeGreaterThan(0);
      for (const v of valores) if (EN[v] === undefined) sinEntrada.push(`${familia} → «${v}»`);
    }
    expect(
      sinEntrada,
      `valores que llegan a un t(VARIABLE) y saldrían en español:\n  ${sinEntrada.join('\n  ')}`,
    ).toEqual([]);
  });

  /**
   * 🔴 SONDA · si el clasificador dejara de distinguir, los dos tests de arriba
   * pasarían en vacío. Se le dan las formas a mano y se exige que las separe.
   */
  it('🔴 SONDA · el clasificador separa el literal de todo lo demás', () => {
    const clasifica = (s: string) => /^'/.test(s);
    expect(clasifica("'Mis tarjetas')"), 'dejó de ver el literal').toBe(true);
    expect(clasifica('VARIABLE)'), 'contó una variable como literal').toBe(false);
    expect(clasifica('mapa[k])'), 'contó un acceso a mapa como literal').toBe(false);
    expect(clasifica('f(x))'), 'contó una llamada como literal').toBe(false);
    // 🔴 El caso que al panel le costó un contador equivocado: empieza con
    // comilla y NO es un literal. Acá cae del lado correcto porque lo que se
    // mira es el carácter pegado al paréntesis, y ahí hay una `x`.
    expect(clasifica("x ? 'A' : 'B')"), 'un ternario no es un literal').toBe(false);
  });
});

describe('🔴 cobertura de traducción · ninguna clave puede faltar', () => {
  it('el extractor encuentra los `t()` del producto · si no, no prueba nada', () => {
    // Control positivo: un extractor que dejó de ver devuelve cero y todo lo de
    // abajo pasaría en vacío.
    expect(envueltos().length, 'el extractor no encontró ningún t()').toBeGreaterThan(400);
  });

  it('🔴 cada string envuelto en `t()` tiene traducción EN', () => {
    const faltan = [...new Set(
      envueltos().filter(({ texto }) => EN[texto] === undefined)
        .map(({ ruta, texto }) => `${ruta} · «${texto}»`),
    )];
    expect(
      faltan,
      `Sin traducción EN:\n  ${faltan.join('\n  ')}\n\n`
        + 'Pedísela a Diseño. NO la inventes: si es copy de dinero o privacidad, '
        + 'una traducción que promete de más es peor que el español.',
    ).toEqual([]);
  });
});

/**
 * 🔴 GUARDA INVERSA · D-IDIOMA-1 sólo vigilaba lo que FALTA. Una clave EN a la
 * que ya nadie llama —copy vieja tras un rediseño, p. ej. LoginScreen— sigue
 * viajando en el bundle para siempre y nadie se entera: no rompe nada, no se
 * ve, y `EN[x] === undefined` nunca la va a cazar porque la entrada SÍ existe.
 *
 * El universo de "usado" es la unión de dos partes, y las DOS ya las mide
 * este mismo archivo para la cobertura de arriba — no se inventa un tercer
 * censo que pudiera divergir: los `t('…')` literales (`envueltos()`) y los
 * valores de cada familia `t(VARIABLE)` (`familiasDinamicas()`).
 */
function huerfanasDe(clavesEN: string[], usados: ReadonlySet<string>): string[] {
  return clavesEN.filter((k) => !usados.has(k));
}

/**
 * 🔴 CENSO 2026-09-18 (AF-07) · 72 claves EN sin ningún `t()` que las llame,
 * clasificadas UNA POR UNA contra el árbol completo de `src/` (no sólo contra
 * `envueltos()`/`familiasDinamicas()`, que es lo que mide el test de abajo):
 *
 *   - 64 estaban MUERTAS DE VERDAD: el texto en español no aparece en ningún
 *     archivo de `src/`, ni siquiera en un test. Esas 64 SE BORRARON de
 *     `en.ts` en esta misma orden (incluida la nombrada por el Bibliotecario,
 *     «O usa tu correo y contraseña», copy vieja de `LoginScreen` superseded
 *     por el rediseño en curso).
 *   - Las 72 que quedan acá abajo SIGUEN VIVAS como texto plano en algún
 *     archivo — la mayoría en `src/api/paymentStatus.ts` (el estado de cierre
 *     de mesa: `mesaClosureView`) y `src/screens/joinLinkView.ts`/
 *     `reconciliacionMesaView.ts` — pero NADIE las envuelve en `t()` todavía.
 *     Es el límite que el propio archivo declara arriba: "ninguno de los dos
 *     ve el texto visible que nadie envolvió en `t()`". Envolver esos sitios
 *     toca `MesaScreen.tsx`/`paymentStatus.ts`/pantallas de link — fuera del
 *     alcance de paths de AF-07 (`GAPS.md`/`src/i18n/**`/`index.html`/
 *     `pwaInstallability.test.ts`), y varias son copy de garantía/banco: NO
 *     se tocan sin una orden que autorice esos paths.
 *
 * Por eso el contador es FIJO, no vacío: si BAJA con intención (alguien
 * envolvió un sitio en `t()`, o borró un texto que quedó realmente muerto),
 * se achica esta lista. Si alguien más pierde su `t()` y por eso aparece acá
 * SIN que nadie lo haya revisado, el test se pone rojo con el nombre exacto —
 * igual que `T_SIN_LITERAL` arriba.
 */
const HUERFANAS_CONOCIDAS_SIN_ENVOLVER = [
  'Ajuste a favor', 'Ajuste en contra', 'Asociadas', 'Cuenta', 'Devolución de mesa',
  'El cierre sigue en proceso; todavía no está confirmado.',
  'El cierre y cualquier liquidación todavía requieren confirmación.',
  'El faltante, si existió, quedó registrado. Aún no podemos afirmar la entrega al restaurante.',
  'Entrega en proceso', 'Esa apertura terminó sin quedar en pie. Ya puedes abrir una nueva.',
  'Esta mesa ya cerró', 'Estado de la mesa', 'Estadísticas',
  'Este intento no coincide con la apertura que quedó pendiente. No vamos a reenviarlo ni a abrir otra mesa: escríbenos para resolverlo.',
  'Este link está incompleto',
  'Está bloqueada hasta reconciliarla; no vamos a reenviarla ni abrir otra mesa.',
  'Garantía en confirmación', 'Garantía no confirmada',
  'Habla con quien te invitó si crees que es un error.',
  'La garantía ya no está vigente.',
  'La liquidación sigue en proceso; todavía no está confirmada.',
  'La mesa se creó, pero su garantía quedó sin confirmar. No abrimos otra mesa.',
  'La mesa terminó su proceso de cierre.',
  'La mesa todavía está pendiente de cierre y liquidación.',
  'Mesa cancelada', 'Mesa en liquidación', 'Mesa liquidada', 'Mesa vencida',
  'Modo demo:', 'Movimiento',
  'No encontramos ninguna mesa creada con este intento. Podemos reenviarlo tal cual: si llegó a crearse, te devolvemos esa misma mesa en vez de retener el total otra vez.',
  'No es que no sirva: no pudimos comprobarlo ahora. Prueba de nuevo en un momento.',
  'No podemos afirmar que exista un cobro o cierre de la mesa.',
  'No pudimos confirmar la respuesta de tu banco.', 'No pudimos guardar la tarjeta.',
  'No pudimos leer la tarjeta.', 'No pudimos sumarte',
  'No pudimos verificar cómo quedó esa apertura. Prueba de nuevo en un momento; no vamos a abrir otra mesa mientras tanto.',
  'No pudimos verificar el link', 'No pudimos verificar esta invitación. Actualiza en un momento.',
  'Pago de mesa', 'Pagos registrados', 'Propina (al mesero)', 'Propina enviada', 'Propina recibida',
  'Puede haberse cortado al copiarlo. Pide que te lo manden de nuevo y ábrelo entero.',
  'Puede ser la conexión. Prueba de nuevo.', 'Pídele a quien te invitó que te comparta uno nuevo.',
  'Si tocas pagar de nuevo, cubres la parte de otro comensal.', 'Sin fecha',
  'Sumándote a la mesa…', 'Súmate a la mesa {0} en PayMe: {1}',
  'Todavía no podemos confirmar el cierre ni una entrega al restaurante.',
  'Todavía no podemos confirmar el resultado de la garantía.', 'Total',
  'Tu banco no autorizó la operación.',
  'Tu banco pudo haber autorizado la garantía; todavía la estamos verificando.',
  'Tu cuenta ya está lista — puedes abrir tu propia mesa cuando quieras.', 'Tu propina',
  'Un segundo.', 'Ver mesa', 'Ya sabemos cómo quedó: puedes reenviarla tal cual desde el botón de abajo.',
  'acreditada', 'conflicto', 'entero', 'menos de 1 min', 'muerta', 'o Apple Pay',
  'por pagar.', 'reservado', '{0} h', '{0} min',
];

describe('🔴 entradas EN huérfanas · fijo y enumerado, no cero todavía', () => {
  it('🔴 SONDA · `huerfanasDe` distingue lo usado de lo huérfano', () => {
    const usados = new Set(['Cancelar', 'Volver']);
    expect(huerfanasDe(['Cancelar', 'Volver'], usados), 'marcó huérfano lo usado').toEqual([]);
    expect(huerfanasDe(['Cancelar', 'Fantasma'], usados), 'no cazó la huérfana real')
      .toEqual(['Fantasma']);
  });

  it('🔴 las huérfanas de EN son EXACTAMENTE las 72 ya clasificadas · el contador SÓLO BAJA con intención', () => {
    const usados = new Set(envueltos().map(({ texto }) => texto));
    for (const valores of Object.values(familiasDinamicas())) {
      for (const v of valores) usados.add(v);
    }
    const huerfanas = huerfanasDe(Object.keys(EN), usados);
    expect(
      [...huerfanas].sort(),
      `Cambió el conjunto de huérfanas frente al censo del 2026-09-18.\n  ${huerfanas.join('\n  ')}\n\n` +
        'Si SUBIÓ: algo perdió su `t()` sin que nadie lo revisara — investigar antes de aceptar.\n' +
        'Si BAJÓ con intención: alguien envolvió el sitio en `t()` (sacarla de esta lista) o confirmó ' +
        'que el texto ya no existe en ninguna pantalla (borrar la entrada de `en.ts` y sacarla de acá).',
    ).toEqual([...HUERFANAS_CONOCIDAS_SIN_ENVOLVER].sort());
  });
});

describe('🔵 wallet NO se traduce · el riel está muerto', () => {
  /**
   * Traducir superficie apagada la haría parecer viva. Diseño marcó las 20
   * frases una por una en su documento y quedaron fuera de `en.ts`.
   */
  it('ninguna frase de saldo/transferencia tiene entrada', () => {
    const traducidas = FRASES_WALLET.filter((w) => EN[w] !== undefined);
    expect(traducidas, 'wallet traducido: el riel está muerto').toEqual([]);
  });
});

describe('`traducir()` · el contrato de la función', () => {
  it('en español es la IDENTIDAD: sin lookup, sin forma de romper', () => {
    expect(traducir('cualquier cosa', 'es')).toBe('cualquier cosa');
    expect(traducir('Mis tarjetas', 'es')).toBe('Mis tarjetas');
  });

  it('🔴 un valor que NO es string no la rompe · el backend puede no mandar el campo', () => {
    /**
     * A Dashboard Frontend casi le rompe producción: tres `t()` recibían campos
     * tipados `string` por contrato que el backend desplegado no mandaba, así
     * que en runtime eran `undefined` y `texto.replace()` tiraba `TypeError`.
     *
     * 🔴 Y SÓLO EN INGLÉS: el camino español retorna antes de tocar el valor.
     * Esta app consume mesas, pagos, invitaciones y notificaciones — tiene MÁS
     * superficie de eso, no menos.
     */
    for (const malo of [undefined, null, 0, {}]) {
      expect(() => traducir(malo as unknown as string, 'en')).not.toThrow();
      expect(() => traducir(malo as unknown as string, 'es')).not.toThrow();
      expect(traducir(malo as unknown as string, 'en')).toBe(malo);
    }
    // 🔴 CONTROL, sin el cual esto no prueba nada: con un string de verdad
    // sigue traduciendo. Un `return texto` al tope pasaría el bloque de arriba
    // y rompería la traducción entera.
    expect(traducir('Mis tarjetas', 'en')).toBe(EN['Mis tarjetas']);
  });

  it('🔴 sustituye placeholders POSICIONALES · la frase interpolada no es la clave', () => {
    expect(traducir('Quedan {0} de {1}', 'es', 3, 5)).toBe('Quedan 3 de 5');
    // Un índice que no llegó deja el placeholder CRUDO a propósito: es visible
    // y se arregla. Poner '' lo escondería, que es como sobrevive un defecto.
    expect(traducir('Quedan {0} de {1}', 'es', 3)).toBe('Quedan 3 de {1}');
  });

  it('sin entrada cae al español, que es texto real y no una clave cruda', () => {
    expect(traducir('frase que nadie tradujo jamás', 'en')).toBe('frase que nadie tradujo jamás');
  });
});

describe('🔴 el cableado · sin esto la app se ve entera en español y nadie se entera', () => {
  const src = (r: string) => {
    const hit = FUENTES[r];
    if (typeof hit !== 'string') throw new Error(`fuente no encontrada: ${r}`);
    return hit;
  };

  it('`main.tsx` monta el proveedor', () => {
    // `useIdioma()` cae al español sin proveedor —a propósito—, así que
    // olvidarlo NO rompe nada: se ve todo en español. Por eso se fija acá.
    expect(src('../main.tsx')).toContain('<IdiomaProvider>');
  });

  it('el selector vive en `Más` · pedido de Mati, 2026-08-10', () => {
    expect(src('../screens/MasScreen.tsx')).toContain('<SelectorIdioma />');
  });

  it('🔴 las constantes de MÓDULO se traducen al RENDERIZAR', () => {
    // La clase que dejó la navegación entera del dashboard en español. Acá los
    // `label` viven en constantes fuera de todo componente y se envuelven en el
    // punto de render; si alguien saca el `t()`, esto cae.
    expect(src('../components/AppBottomBar.tsx')).toContain('{t(it.label)}');
    expect(src('../components/AppBottomBar.tsx')).toContain('{t(centro.label)}');
    expect(src('../screens/HomeScreen.tsx')).toContain('label: t(x.label)');
    // CONTROL: que las constantes sigan existiendo. Sin esto, borrarlas también
    // pasaría el test.
    expect(src('../components/AppBottomBar.tsx')).toContain("label: 'Inicio'");
    expect(src('../screens/HomeScreen.tsx')).toContain('const TABS: BubbleTab[]');
  });
});
