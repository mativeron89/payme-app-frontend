import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * ⭐ LOS DOS ARTEFACTOS CONTRA EL ESPEJO DE TOKENS RATIFICADOS.
 *
 * ## Por qué existe · el defecto que lo motivó (2026-08-10)
 *
 * `landing/README.md` afirmaba que un test comparaba los tokens de la landing
 * contra los de la app «token por token». **Nunca se escribió.** Puse
 * `--border: #FF00FF` en la landing y las 886 pruebas pasaron en verde. Ya
 * había **cuatro divergencias vivas**, dos reales:
 *
 *     --brand-fg   app #ffffff   landing #0f1f3d   ← valores OPUESTOS
 *     --teal-l     app #e0f8f9   landing #e4fbfc
 *
 * ## 🔴 Por qué NO se comparan entre sí
 *
 * La primera versión comparaba artefacto contra artefacto. Diseño lo corrigió,
 * y el argumento es el que importa: *«la landing con `#0F1F3D` está
 * desactualizada, no es una segunda decisión válida — quedó vieja porque nadie
 * la tocó, no porque alguien la haya elegido distinta»*.
 *
 * **Comparar los dos artefactos entre sí sólo dice que difieren; no dice cuál
 * tiene razón.** Y sin un tercero, el desempate lo gana el que alguien tocó
 * último — antigüedad en vez de ratificación. Los dos se comparan contra el
 * ESPEJO, que copia `diseno/SISTEMA_DISENO.md`.
 *
 * ## 🔴 Por qué un ESPEJO y no leer la fuente directo
 *
 * Diseño pidió anclar contra el archivo fuente. Es la intención correcta y hoy
 * es imposible: **`diseno/` NO está versionado** —ni él ni la raíz son
 * repositorios git—, así que un runner que hace checkout de este repo no puede
 * leerlo. Una guarda que lo lea directo anda en la Mac y falla en CI, o peor,
 * se saltea y pasa en verde: la clase que este repo viene persiguiendo.
 *
 * Se espeja, con la disciplina del `contract-mirror/`: copia con procedencia,
 * solo lectura, y **tres verificaciones separadas que NO se funden en un
 * veredicto único** — porque «no pude verificar» y «verifiqué y coincide»
 * tienen que ser resultados distintos.
 *
 *     INTEGRIDAD   los artefactos coinciden con el espejo.
 *                  Único que se puede correr SIEMPRE, incluido CI.
 *     POBLACIÓN    el espejo no perdió tokens en silencio.
 *     VIGENCIA     el espejo sigue igual a la fuente.
 *                  🔴 Necesita la fuente. Sin ella NO se certifica, y se SALTEA
 *                  con su motivo — nunca se aprueba.
 */

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..');
/** Fuera del repo a propósito: es de la raíz del workspace, no nuestra. */
const FUENTE = join(RAIZ, '..', 'diseno', 'SISTEMA_DISENO.md');

interface Espejo {
  PROCEDENCIA: {
    fuente: string;
    sha256_fuente_al_espejar: string;
    bytes_fuente_al_espejar: number;
    fecha_espejado: string;
  };
  POBLACION: { con_valor_en_tabla: number; mencionados_sin_valor: string[] };
  tokens: Record<string, { valor: string; linea: number; enmendado_desde?: string }>;
}

const espejo: Espejo = JSON.parse(
  readFileSync(join(RAIZ, 'design-mirror', 'tokens.json'), 'utf8'),
) as Espejo;

/** Normaliza SÓLO formato: `rgba(15, 31, 61, 0.10)` === `rgba(15,31,61,0.1)`. */
const normalizar = (v: string): string =>
  v
    .trim()
    .toLowerCase()
    .replace(/\s*,\s*/g, ',')
    .replace(/\s+/g, ' ')
    .replace(/(?<![\w.])\d*\.\d+(?![\w.])/g, (n) => String(Number(n)));

/** Primera declaración de cada token en un CSS: la de `:root`. */
function tokensDeCss(rutaRelativa: string): Map<string, string> {
  const texto = readFileSync(join(RAIZ, rutaRelativa), 'utf8');
  const m = new Map<string, string>();
  for (const t of texto.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) {
    if (!m.has(t[1]!)) m.set(t[1]!, normalizar(t[2]!));
  }
  return m;
}

/**
 * El MISMO parser con el que se generó el espejo. Vive acá para que la
 * verificación de vigencia use el instrumento del espejo y no uno paralelo:
 * dos parsers distintos discrepan por su propia diferencia, no por la fuente.
 */
function tokensDeLaFuente(texto: string): { tokens: Map<string, string>; sinValor: string[] } {
  const tokens = new Map<string, string>();
  const mencionados = new Set<string>();
  for (const l of texto.split('\n')) {
    for (const t of l.matchAll(/`(--[a-z0-9-]+)`/g)) mencionados.add(t[1]!);
    if (!l.trim().startsWith('|')) continue;
    const celdas = l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    if (celdas.length < 2) continue;
    const nombre = /^`(--[a-z0-9-]+)`$/.exec(celdas[0]!);
    if (!nombre) continue;
    const valores = [...celdas[1]!.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);
    if (!valores.length) continue;
    // El último gana: una celda enmendada es `~~viejo~~ → **nuevo**`.
    tokens.set(nombre[1]!, valores[valores.length - 1]!);
  }
  const sinValor = [...mencionados].filter((t) => !tokens.has(t)).sort();
  return { tokens, sinValor };
}

const ARTEFACTOS = [
  { nombre: 'app', css: 'src/styles/global.css' },
  { nombre: 'landing', css: 'landing/landing.css' },
] as const;

describe('INTEGRIDAD · los dos artefactos coinciden con el espejo ratificado', () => {
  it('🔴 el espejo tiene población: si estuviera vacío, todo lo de abajo pasaría en vacío', () => {
    expect(Object.keys(espejo.tokens).length, 'el espejo quedó sin tokens').toBeGreaterThan(20);
  });

  /**
   * 🔴 SEPARADO el 2026-08-10, y por un mutante. Borrar un token del espejo
   * hacía caer el test de arriba —25 sigue siendo > 20, así que lo que fallaba
   * era esta igualdad— **bajo el nombre «el espejo tiene población»**. Quien lo
   * viera rojo iría a buscar un espejo vacío.
   *
   * Es la misma clase que la guarda del `./`, que fallaba bajo «las tres
   * imágenes se USAN»: **un gate que falla con el nombre equivocado manda a la
   * persona a otro lado.** Una afirmación por test.
   */
  it('🔴 el espejo no perdió tokens: el conteo declarado coincide con el contenido', () => {
    expect(
      espejo.POBLACION.con_valor_en_tabla,
      'alguien sacó o agregó un token sin actualizar el conteo declarado',
    ).toBe(Object.keys(espejo.tokens).length);
  });

  it('🔴 la procedencia está completa: sin ella el espejo no es auditable', () => {
    expect(espejo.PROCEDENCIA.fecha_espejado).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(espejo.PROCEDENCIA.sha256_fuente_al_espejar).toMatch(/^[0-9a-f]{64}$/);
    expect(espejo.PROCEDENCIA.bytes_fuente_al_espejar).toBeGreaterThan(1000);
  });

  for (const a of ARTEFACTOS) {
    it(`🔴 ${a.nombre} · ningún token difiere del valor ratificado`, () => {
      const css = tokensDeCss(a.css);
      const compartidos = Object.entries(espejo.tokens).filter(([t]) => css.has(t.slice(2)));
      expect(
        compartidos.length,
        `${a.nombre} no comparte ningún token con el espejo: el barrido mide en vacío`,
      ).toBeGreaterThan(10);

      const difieren = compartidos
        .filter(([t, r]) => css.get(t.slice(2)) !== normalizar(r.valor))
        .map(([t, r]) => `${t}: ratificado ${r.valor} · ${a.nombre} ${css.get(t.slice(2))}`);
      expect(difieren, `divergen del sistema de diseño:\n  ${difieren.join('\n  ')}`).toEqual([]);
    });
  }

  /**
   * 🔴 La landing declara MENOS tokens que la app, y eso está bien: copia sólo
   * lo que usa. Lo que NO puede es declarar uno que el sistema no ratifica y
   * que tampoco sea de layout — ahí estaría inventando color.
   */
  it('🔴 la landing no inventa colores fuera del sistema', () => {
    const css = tokensDeCss('landing/landing.css');
    const deLayout = /^(?:sp|r|fs|mo)-/;
    const inventados = [...css.keys()]
      .filter((t) => !deLayout.test(t))
      .filter((t) => !(`--${t}` in espejo.tokens));
    expect(inventados, `colores que no salen del sistema: ${inventados.join(' · ')}`).toEqual([]);
  });
});

/**
 * 🔴 LO QUE EL ESPEJO NO PUEDE CUBRIR · los tokens que el sistema NO valúa.
 *
 * Los radios (`--r-*`) están en los dos artefactos y el sistema los NOMBRA sin
 * darles valor, así que no hay contra qué anclarlos. Para éstos —y sólo para
 * éstos— vale comparar artefacto contra artefacto: no dice cuál tiene razón,
 * pero sí que alguien los movió de a uno.
 *
 * **La limitación queda escrita a propósito**: si un día divergen, este test
 * dice QUE difieren y no PUEDE decir cuál gana. Eso se resuelve dándoles valor
 * en el sistema de diseño, no acá.
 */
describe('SIN ANCLA · los tokens que el sistema nombra pero no valúa', () => {
  it('🔴 los artefactos no se separan en los tokens de layout', () => {
    const app = tokensDeCss('src/styles/global.css');
    const land = tokensDeCss('landing/landing.css');
    const sinAncla = [...land.keys()].filter((t) => app.has(t) && !(`--${t}` in espejo.tokens));
    expect(
      sinAncla.length,
      'no hay tokens compartidos sin ancla: el barrido mediría en vacío',
    ).toBeGreaterThan(2);
    const difieren = sinAncla
      .filter((t) => app.get(t) !== land.get(t))
      .map((t) => `--${t}: app ${app.get(t)} · landing ${land.get(t)}`);
    expect(
      difieren,
      `divergen y NO hay fuente que desempate — hay que valuarlos en el sistema:\n  ${difieren.join('\n  ')}`,
    ).toEqual([]);
  });
});

describe('POBLACIÓN · el espejo no perdió tokens en silencio', () => {
  /**
   * El sistema NOMBRA 20 tokens que no valúa (`--sp-*`, `--r-*`, `--fs-*`,
   * `--mo-*`). No se inventan. Se fija el número para que **el día que la
   * fuente les dé valor, esto se ponga rojo** en vez de que el espejo siga
   * afirmando una población vieja.
   */
  it('🔴 los tokens SIN valor ratificado están declarados, no omitidos', () => {
    expect(espejo.POBLACION.mencionados_sin_valor.length).toBe(20);
    expect(espejo.POBLACION.mencionados_sin_valor).toContain('--sp-1');
    for (const t of espejo.POBLACION.mencionados_sin_valor) {
      expect(t, `${t} tiene valor ratificado y sigue listado como que no`).not.toBeUndefined();
      expect(`--${t.slice(2)}` in espejo.tokens, `${t} está en las dos listas`).toBe(false);
    }
  });
});

/**
 * 🔴 VIGENCIA · TRES RESULTADOS, NO DOS.
 *
 *   coincide           → PASSED
 *   difiere            → FAILED  (alguien editó la fuente y el espejo quedó viejo)
 *   fuente no legible  → SKIPPED, con el motivo en el nombre
 *
 * El tercero es el que importa y por eso no se aprueba: **«no pude verificar»
 * y «verifiqué y coincide» no pueden salir iguales.** En CI la fuente NUNCA va
 * a estar —`diseno/` no está versionado—, así que ahí este bloque se saltea
 * SIEMPRE y lo que corre es INTEGRIDAD. El step de CI se llama por lo que mide:
 * integridad, jamás «vigencia».
 *
 * Es la misma separación que `verificar-mirror.mjs` hace para el contrato.
 */
describe('VIGENCIA · el espejo sigue igual a la fuente', () => {
  it('🔴 la fuente no cambió desde que se espejó · SKIP = NO CERTIFICADO', (ctx) => {
    if (!existsSync(FUENTE)) {
      ctx.skip(
        `NO CERTIFICADO: ${FUENTE} no existe en este checkout. ` +
          '`diseno/` no está versionado, así que en CI esto se saltea siempre. ' +
          'La vigencia sólo se puede acreditar en una máquina que tenga el workspace.',
      );
      return;
    }
    const texto = readFileSync(FUENTE, 'utf8');

    /**
     * 🔴 EL SHA NO ES UN ATAJO. Acá había `if (sha === …) return`, y un mutante
     * lo mató: edité el espejo Y los dos artefactos para que coincidieran entre
     * sí, no toqué la fuente, y **los 7 tests pasaron en verde**.
     *
     * El sha prueba que la FUENTE no cambió. No dice **nada** sobre si alguien
     * editó el ESPEJO — que es justo la forma más fácil de «arreglar» un rojo.
     * Con el atajo puesto, la comparación de tokens no corría nunca en el caso
     * normal: el gate aprobaba sin haber verificado.
     *
     * Es la misma clase que el manifiesto que se inventariaba a sí mismo, y la
     * razón por la que el `contract-mirror` adopta el inventario DEL DUEÑO.
     * Ahora se compara SIEMPRE; el sha queda como dato de procedencia.
     */
    const sha = createHash('sha256').update(texto).digest('hex');
    const { tokens, sinValor } = tokensDeLaFuente(texto);
    expect(tokens.size, 'el parser no leyó ningún token de la fuente: mediría en vacío')
      .toBeGreaterThan(20);

    const difieren: string[] = [];
    for (const [t, r] of Object.entries(espejo.tokens)) {
      const enFuente = tokens.get(t);
      if (enFuente === undefined) difieren.push(`${t}: desapareció de la fuente`);
      else if (normalizar(enFuente) !== normalizar(r.valor)) {
        difieren.push(`${t}: fuente ${enFuente} · espejo ${r.valor}`);
      }
    }
    for (const t of tokens.keys()) {
      if (!(t in espejo.tokens)) difieren.push(`${t}: la fuente lo ratificó y el espejo no lo tiene`);
    }
    if (sinValor.length !== espejo.POBLACION.mencionados_sin_valor.length) {
      difieren.push(
        `población sin valor: fuente ${sinValor.length} · espejo ${espejo.POBLACION.mencionados_sin_valor.length}`,
      );
    }
    const deQuienEsLaCulpa =
      sha === espejo.PROCEDENCIA.sha256_fuente_al_espejar
        ? '🔴 la fuente NO cambió (sha idéntico), así que lo que se editó fue EL ESPEJO'
        : 'la fuente cambió desde que se espejó';
    expect(difieren, `${deQuienEsLaCulpa} · re-espejar:\n  ${difieren.join('\n  ')}`).toEqual([]);
  });

  /**
   * 🔴 SONDA del parser de vigencia, y corre SIEMPRE — también cuando la fuente
   * falta. Sin esto, un parser roto haría que «la fuente coincide» saliera
   * verde por no encontrar nada, que es el defecto que este repo ya cometió
   * con un control que no encontraba nada y aprobaba igual.
   */
  it('🔴 SONDA · el parser lee la enmienda y se queda con el valor NUEVO', () => {
    const muestra = [
      '| Token | Valor | Uso |',
      '|---|---|---|',
      '| `--brand-fg` | ~~`#0F1F3D`~~ → **`#FFFFFF`** | Glifo sobre `--brand` |',
      '| `--brand` | `#FF6B35` | Botón |',
      'y en prosa se nombra `--sp-4`, que no tiene tabla propia.',
    ].join('\n');
    const { tokens, sinValor } = tokensDeLaFuente(muestra);
    expect(tokens.get('--brand-fg'), 'se quedó con el valor tachado').toBe('#FFFFFF');
    expect(tokens.get('--brand')).toBe('#FF6B35');
    expect(sinValor, 'un token sólo nombrado no puede contar como ratificado').toEqual(['--sp-4']);
    expect(tokens.has('--sp-4')).toBe(false);
  });
});
