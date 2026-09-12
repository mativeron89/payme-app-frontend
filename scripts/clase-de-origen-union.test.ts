import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * LA UNIÓN DE TIPOS CONTRA LO QUE EL MÓDULO EMITE DE VERDAD · OBS-AF-01.
 *
 * `ClaseDeOrigen` vivía escrita a mano en DOS `.d.mts` y las dos divergieron de la
 * implementación: a `redactar.d.mts` le faltaba `NO_ESPECIFICADA` —que `origenPublicable`
 * emite desde que `0.0.0.0` dejó de contar como loopback— y a `extraer-origenes.d.mts` le
 * faltaban además `NO_PARSEABLE` y `AUSENTE`.
 *
 * 🔴 **Nada se puso rojo, y ésa es la parte que importa.** Ningún test tipa contra la unión,
 * así que el typecheck no la ejercita: un tipo que nadie usa no falla el día que se rompe,
 * falla el día que alguien lo usa. Lo encontró una auditoría independiente leyendo el archivo.
 *
 * Este archivo cierra esa clase **derivando la invariante en vez de patrullarla**: no lleva una
 * lista de literales a mano —eso sería una tercera copia que también se desalinea—, sino que
 * compara dos conjuntos extraídos del propio código.
 *
 * ⚠️ **Es una comprobación a nivel TEXTO y lo digo acá para que nadie la lea como más fuerte de
 * lo que es.** No ejecuta el módulo ni hace inferencia de tipos: si alguien emitiera una clase
 * construida (`clase: ALGO`, con una variable), esta guarda no la vería. Cubre la forma que el
 * defecto tuvo —literales escritos a mano en dos lados— y no la clase entera de «el tipo miente».
 */

const AQUI = join(__dirname);
const MODULO = readFileSync(join(AQUI, 'redactar.mjs'), 'utf8');
const TIPOS_REDACTAR = readFileSync(join(AQUI, 'redactar.d.mts'), 'utf8');
const TIPOS_EXTRACTOR = readFileSync(join(AQUI, 'extraer-origenes.d.mts'), 'utf8');

/**
 * 🔴 LOS COMENTARIOS SE SACAN ANTES DE BUSCAR, Y NO ES COSMÉTICO.
 *
 * El docblock de `redactar.d.mts` **nombra** `NO_ESPECIFICADA` y las clases de ruta para
 * explicar la corrección. Si el extractor mirara el archivo entero, un literal mencionado en
 * una explicación contaría como declarado y la contención sería trivialmente cierta: la guarda
 * se volvería verde por su propia documentación. Es el fail-open exacto de esta familia.
 *
 * 🔴 **Y la línea de comentario sólo se saca cuando ABRE el renglón.** La primera versión de
 * esta función borraba desde cualquier `//` hasta el fin de línea, y se comía
 * `` `${u.protocol}//${u.host}` `` —código, no comentario— junto con el `clase:` que venía
 * después. Resultado: el extractor devolvía 6 de 9 literales y la contención daba verde igual,
 * porque un conjunto más chico también está contenido. **Lo cazó el control positivo de abajo,
 * no yo**, y por eso ese caso existe: mi instrumento estaba roto y el veredicto seguía siendo
 * «todo bien».
 */
function sinComentarios(fuente: string): string {
  return fuente.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/[^\n]*/gm, ' ');
}

/** Literales que el MÓDULO asigna al campo `clase`. La fuente de verdad de qué existe. */
function clasesEmitidas(fuente: string): readonly string[] {
  return [...new Set([...sinComentarios(fuente).matchAll(/\bclase:\s*'([A-Z_0-9]+)'/g)].map((m) => m[1]!))].sort();
}

/** Literales declarados en posiciones de tipo, ya sin comentarios. */
function literalesDeclarados(tipos: string): readonly string[] {
  return [...new Set([...sinComentarios(tipos).matchAll(/'([A-Z_0-9]+)'/g)].map((m) => m[1]!))].sort();
}

describe('ClaseDeOrigen · el tipo dice lo que el módulo emite', () => {
  /**
   * 🔴 EL CONTROL POSITIVO VA PRIMERO Y NO ES DECORACIÓN.
   *
   * Toda esta guarda es una contención de conjuntos, y **un conjunto vacío está contenido en
   * cualquier cosa**. Si un regex dejara de encontrar literales —porque alguien reformatea el
   * módulo, o porque el patrón se rompe—, el caso de abajo pasaría en verde sin haber
   * comparado nada. Sin esto, la guarda falla abierta exactamente como el tipo que vino a
   * arreglar.
   */
  it('los dos extractores encuentran algo, o esta guarda no está midiendo nada', () => {
    const emitidas = clasesEmitidas(MODULO);
    const declaradas = literalesDeclarados(TIPOS_REDACTAR);
    expect(emitidas.length, 'el extractor no encontró ningún `clase:` en redactar.mjs').toBeGreaterThan(4);
    expect(declaradas.length, 'el extractor no encontró literales en redactar.d.mts').toBeGreaterThan(4);
    // Anclas concretas: si el formato cambia de manera que estas dos se pierdan, quiero el rojo
    // acá y no un verde silencioso tres casos más abajo.
    expect(emitidas).toContain('LOOPBACK');
    expect(emitidas).toContain('NO_ESPECIFICADA');
  });

  it('toda clase que el módulo emite está declarada en redactar.d.mts', () => {
    const declaradas = new Set(literalesDeclarados(TIPOS_REDACTAR));
    const faltantes = clasesEmitidas(MODULO).filter((c) => !declaradas.has(c));
    expect(faltantes, `el módulo emite clases que el tipo no declara: ${faltantes.join(', ')}`).toEqual([]);
  });

  /**
   * Las dos taxonomías comparten el nombre del campo y no el significado. Se fijan por separado
   * para que «arreglar» un hallazgo ampliando el tipo equivocado se ponga rojo.
   */
  it('las clases de ORIGEN están en ClaseDeOrigen y las de RUTA no', () => {
    const union = /export type ClaseDeOrigen =([^;]+);/.exec(sinComentarios(TIPOS_REDACTAR));
    expect(union, 'no encontré la declaración de ClaseDeOrigen').not.toBeNull();
    const miembros = [...union![1]!.matchAll(/'([A-Z_0-9]+)'/g)].map((m) => m[1]!);

    for (const c of ['LOOPBACK', 'EXTERNO_ALLOWLISTADO', 'EXTERNO_NO_ALLOWLISTADO', 'NO_ESPECIFICADA', 'NO_PARSEABLE', 'AUSENTE']) {
      expect(miembros, `${c} es una clase de origen y falta en la unión`).toContain(c);
    }
    for (const r of ['RELATIVA_AL_ARBOL', 'FUERA_DEL_ARBOL', 'SIN_RAIZ']) {
      expect(miembros, `${r} clasifica RUTAS, no orígenes: no va en ClaseDeOrigen`).not.toContain(r);
    }
  });

  /** Una sola definición: la copia de al lado ya divergió una vez. */
  it('extraer-origenes.d.mts RE-EXPORTA el tipo, no lo vuelve a escribir', () => {
    const limpio = sinComentarios(TIPOS_EXTRACTOR);
    expect(limpio).toMatch(/export type \{[^}]*\bClaseDeOrigen\b[^}]*\} from '\.\/redactar\.mjs'/);
    expect(limpio, 'volvió a definirse la unión en vez de re-exportarla').not.toMatch(
      /export type ClaseDeOrigen\s*=\s*'/,
    );
  });

  /**
   * 🔴 EL MUTANTE, sobre el predicado y no sobre producción.
   *
   * Los tres casos de arriba comprueban que hoy está bien. Éste comprueba que **se pondrían
   * rojos si dejara de estarlo**: se le quita un miembro a una copia EN MEMORIA de la
   * declaración y se corre la misma comparación. Si igual diera contenido, la guarda no
   * discrimina y los verdes de arriba no significan nada.
   */
  it('si a la unión le faltara un miembro, la comparación lo detectaría', () => {
    const mutada = TIPOS_REDACTAR.replace("| 'NO_ESPECIFICADA'\n", '');
    expect(mutada, 'el mutante no cambió nada: revisá el literal que se quita').not.toBe(TIPOS_REDACTAR);

    const declaradas = new Set(literalesDeclarados(mutada));
    const faltantes = clasesEmitidas(MODULO).filter((c) => !declaradas.has(c));
    expect(faltantes).toContain('NO_ESPECIFICADA');
  });
});
