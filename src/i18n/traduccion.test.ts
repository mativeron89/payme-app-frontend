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
