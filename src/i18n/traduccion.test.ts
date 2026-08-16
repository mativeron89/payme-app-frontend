import { describe, expect, it } from 'vitest';
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
const T_SIN_LITERAL = 14;

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
   * ⚠️ **Dos sitios quedan FUERA a propósito y se declaran:**
   * `LoginScreen.tsx:33` con `t(crudo)` y `EstadisticasScreen.tsx:51` con
   * `t(crudoCocina)` reciben **texto que llega del backend en runtime**. No hay
   * constante que enumerar; su universo lo define otro repo. Traducirlos es
   * best-effort y el fallback al español es el comportamiento correcto.
   * **Es el límite honesto: son el universo que este artefacto NO puede cerrar.**
   */
  it('🔴 cada valor que puede entrar a un `t(VARIABLE)` tiene traducción EN', () => {
    const deModulo = (ruta: string, marca: string): string[] => {
      const src = FUENTES[ruta];
      if (typeof src !== 'string') throw new Error(`fuente no encontrada: ${ruta}`);
      const i = src.indexOf(marca);
      expect(i, `no se encontró ${marca} en ${ruta}`).toBeGreaterThan(-1);
      const bloque = src.slice(i, src.indexOf('};', i) + 2);
      return [...bloque.matchAll(/:\s*'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]!);
    };

    const familias: Record<string, string[]> = {
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
    };

    const sinEntrada: string[] = [];
    for (const [familia, valores] of Object.entries(familias)) {
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

describe('🔵 wallet NO se traduce · el riel está muerto', () => {
  /**
   * Traducir superficie apagada la haría parecer viva. Diseño marcó las 20
   * frases una por una en su documento y quedaron fuera de `en.ts`.
   */
  it('ninguna frase de saldo/transferencia tiene entrada', () => {
    const wallet = ['Saldo PayMe', 'Tu saldo PayMe', 'Transferir', 'Cargar',
      'Mostrar saldo', 'Ocultar saldo', 'Abono por SPEI', 'Carga en OXXO',
      'Últimos movimientos', 'Saldo y tarjetas'];
    const traducidas = wallet.filter((w) => EN[w] !== undefined);
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
