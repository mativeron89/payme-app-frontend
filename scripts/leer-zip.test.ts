import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { leerEntradas, crc32Parcial, crc32Final, LIMITES } from './leer-zip.mjs';

/**
 * ✅ **Corrido: 22/22 verde el 2026-09-11T17:17Z.** El encabezado decía
 * `ESCRITO_SIN_EJECUTAR` mientras la fase prohibía ejecutar; ya no aplica. Lo notable es que
 * el fixture de ZIP64 —cabeceras binarias escritas a mano sin poder probarlas— pasó en la
 * PRIMERA corrida.
 *
 * EL LECTOR DE ZIP, PROBADO POR SUS GARANTÍAS, NO POR SU CAMINO FELIZ.
 *
 * Este módulo existe dentro de un gate de seguridad: lo que decide es si el E2E habló con
 * algo que no sea esta máquina. Un lector que ante un zip raro devuelve «no había nada
 * adentro» convierte «no pude leer» en «leí y está limpio», que es exactamente el falso
 * verde que el gate viene a cerrar.
 *
 * Las dos versiones anteriores fallaron por ahí y por eso cada garantía tiene acá su
 * mutante:
 *
 * ① `execFileSync('unzip', …)` resolvía el binario **por PATH**: lo que corría lo elegía el
 *    entorno. Este repo ya pagó esa cuenta con `npx tsc` bajando un paquete okupa.
 * ② Un parser ZIP propio: descomprimía todo, **no verificaba CRC**, los duplicados se
 *    sobrescribían, el comentario afirmaba rechazar multivolumen y el código no lo miraba, y
 *    omitía la comparación de tamaño cuando el declarado era 0.
 *
 * Lo vigente usa `yauzl`, ya pinneado dentro de `playwright-core`. 🔴 Pero `yauzl` valida
 * **tamaños** con `validateEntrySizes` y **no el CRC de los datos**: un payload corrupto del
 * largo correcto pasaría. Por eso el adapter calcula CRC32 en streaming, y por eso el
 * mutante de payload corrupto es el caso central de este archivo.
 *
 * Los fixtures se arman en `tmpdir()` con un escritor ZIP mínimo —misma convención que
 * `verificar-mirror.test.ts`, que copia el script real a un árbol temporal—. Se escriben a
 * mano en vez de invocar el binario `zip` porque entonces el test dependería de una
 * herramienta MÁS que el código bajo prueba, y su ausencia en CI se leería como falla.
 */

// ── escritor de zips STORED, con CRC controlable para poder corromperlo ──────────

function crc32(datos: Buffer): number {
  return crc32Final(crc32Parcial(datos));
}

interface EntradaFixture {
  readonly nombre: string;
  readonly contenido: string;
  /** Si se pasa, se escribe ESE crc en la cabecera en vez del real: fixture corrupto. */
  readonly crcFalso?: number;
  /** Si se pasa, se escribe ESE tamaño declarado en vez del real. */
  readonly tamanoFalso?: number;
  /** Método de compresión a declarar. 0 = STORED. 99 = uno que nadie soporta. */
  readonly metodo?: number;
  /**
   * Tamaño COMPRIMIDO declarado. Hace falta ponerlo junto a `tamanoFalso` para llegar al
   * tope propio: `validateEntrySizes` de yauzl rechaza antes cualquier STORED cuyos dos
   * tamaños no coincidan, así que un tamaño inflado a secas nunca alcanza mi comprobación.
   */
  readonly comprimidoFalso?: number;
}

/**
 * 🔴 ZIP64, y por qué se puede construir a mano sin un archivo de 4 GB.
 *
 * ZIP64 no es «un zip grande»: es una CODIFICACIÓN. Cuando un tamaño u offset no entra en 32
 * bits, el campo de 32 bits se escribe como `0xFFFFFFFF` —el centinela— y el valor real va en
 * un **extra field 0x0001** de 64 bits, más un EOCD64 y su localizador al final.
 *
 * Nada obliga a que el valor real sea grande. Un zip de 8 bytes escrito con esa codificación
 * es un ZIP64 legítimo y ejercita exactamente el camino del lector que hay que probar. Por eso
 * el `it.skip` de antes —«un fixture honesto exige >4 GB»— era una limitación de mi escritor
 * de fixtures, no del formato. Declararlo como hueco fue correcto mientras no supe hacerlo;
 * mantenerlo habría sido conformarme.
 */
function crearZip(
  entradas: readonly EntradaFixture[],
  opciones: { disco?: number; zip64?: boolean } = {},
): Buffer {
  const locales: Buffer[] = [];
  const centrales: Buffer[] = [];
  const zip64 = opciones.zip64 === true;
  const CENTINELA = 0xffffffff;
  let offset = 0;

  for (const e of entradas) {
    const datos = Buffer.from(e.contenido, 'utf8');
    const nombreBuf = Buffer.from(e.nombre, 'utf8');
    const suma = e.crcFalso ?? crc32(datos);
    const tam = e.tamanoFalso ?? datos.length;
    const comp = e.comprimidoFalso ?? datos.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(zip64 ? 45 : 20, 4); // 45 = «necesita ZIP64 para extraer»
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(e.metodo ?? 0, 8); // 0 = STORED
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(suma >>> 0, 14);
    local.writeUInt32LE(zip64 ? CENTINELA : comp, 18);
    local.writeUInt32LE(zip64 ? CENTINELA : tam, 22);
    local.writeUInt16LE(nombreBuf.length, 26);
    // Extra field local: 0x0001 con los dos tamaños en 64 bits. El ORDEN es fijo por spec —
    // primero el descomprimido, después el comprimido— y equivocarlo desplaza los dos valores.
    const extraLocal = zip64 ? Buffer.alloc(20) : Buffer.alloc(0);
    if (zip64) {
      extraLocal.writeUInt16LE(0x0001, 0);
      extraLocal.writeUInt16LE(16, 2); // largo del payload: dos enteros de 8 bytes
      extraLocal.writeBigUInt64LE(BigInt(tam), 4);
      extraLocal.writeBigUInt64LE(BigInt(comp), 12);
    }
    local.writeUInt16LE(extraLocal.length, 28);
    locales.push(local, nombreBuf, extraLocal, datos);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(zip64 ? 45 : 20, 4);
    central.writeUInt16LE(zip64 ? 45 : 20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(e.metodo ?? 0, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(suma >>> 0, 16);
    central.writeUInt32LE(zip64 ? CENTINELA : comp, 20);
    central.writeUInt32LE(zip64 ? CENTINELA : tam, 24);
    central.writeUInt16LE(nombreBuf.length, 28);
    central.writeUInt32LE(0, 30);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    // El offset del header local también se centinela: si no, el lector busca el local en la
    // posición 0xFFFFFFFF de un archivo que mide bytes.
    central.writeUInt32LE(zip64 ? CENTINELA : offset, 42);
    const extraCentral = zip64 ? Buffer.alloc(28) : Buffer.alloc(0);
    if (zip64) {
      extraCentral.writeUInt16LE(0x0001, 0);
      extraCentral.writeUInt16LE(24, 2); // descomprimido + comprimido + offset
      extraCentral.writeBigUInt64LE(BigInt(tam), 4);
      extraCentral.writeBigUInt64LE(BigInt(comp), 12);
      extraCentral.writeBigUInt64LE(BigInt(offset), 20);
    }
    central.writeUInt16LE(extraCentral.length, 30);
    centrales.push(central, nombreBuf, extraCentral);

    offset += local.length + nombreBuf.length + extraLocal.length + datos.length;
  }

  const cuerpo = Buffer.concat(locales);
  const directorio = Buffer.concat(centrales);

  // EOCD64 + localizador, sólo en ZIP64. Van ANTES del EOCD clásico: el lector llega por el
  // final, encuentra el EOCD, ve los centinelas y retrocede al localizador.
  let colaZip64 = Buffer.alloc(0);
  if (zip64) {
    const eocd64 = Buffer.alloc(56);
    eocd64.writeUInt32LE(0x06064b50, 0);
    eocd64.writeBigUInt64LE(BigInt(44), 4); // tamaño del registro menos estos 12 bytes
    eocd64.writeUInt16LE(45, 12);
    eocd64.writeUInt16LE(45, 14);
    eocd64.writeUInt32LE(0, 16);
    eocd64.writeUInt32LE(0, 20);
    eocd64.writeBigUInt64LE(BigInt(entradas.length), 24);
    eocd64.writeBigUInt64LE(BigInt(entradas.length), 32);
    eocd64.writeBigUInt64LE(BigInt(directorio.length), 40);
    eocd64.writeBigUInt64LE(BigInt(cuerpo.length), 48);

    const localizador = Buffer.alloc(20);
    localizador.writeUInt32LE(0x07064b50, 0);
    localizador.writeUInt32LE(0, 4);
    localizador.writeBigUInt64LE(BigInt(cuerpo.length + directorio.length), 8);
    localizador.writeUInt32LE(1, 16);
    colaZip64 = Buffer.concat([eocd64, localizador]);
  }

  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  // Números de disco: distinto de 0 ⇒ el zip es multivolumen y no se puede leer entero.
  fin.writeUInt16LE(opciones.disco ?? 0, 4);
  fin.writeUInt16LE(opciones.disco ?? 0, 6);
  fin.writeUInt16LE(zip64 ? 0xffff : entradas.length, 8);
  fin.writeUInt16LE(zip64 ? 0xffff : entradas.length, 10);
  fin.writeUInt32LE(zip64 ? CENTINELA : directorio.length, 12);
  fin.writeUInt32LE(zip64 ? CENTINELA : cuerpo.length, 16);
  return Buffer.concat([cuerpo, directorio, colaZip64, fin]);
}

let base: string;
const zipEn = (
  nombre: string,
  entradas: readonly EntradaFixture[],
  opciones: { disco?: number; zip64?: boolean } = {},
): string => {
  const p = join(base, nombre);
  writeFileSync(p, crearZip(entradas, opciones));
  return p;
};
const todo = () => true;
const soloRed = (n: string) => n.endsWith('.network');

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'payme-leerzip-'));
});
afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe('leerEntradas · camino sano', () => {
  it('lista TODAS las entradas y devuelve sólo las pedidas', async () => {
    const z = zipEn('ok.zip', [
      { nombre: '0-trace.network', contenido: '{"a":1}\n' },
      { nombre: 'test.trace', contenido: '{"b":2}\n' },
      { nombre: 'resources/foto.jpeg', contenido: 'xxxx' },
    ]);
    const r = await leerEntradas(z, soloRed);
    expect(r.nombres).toEqual(['0-trace.network', 'test.trace', 'resources/foto.jpeg']);
    expect(Object.keys(r.contenidos)).toEqual(['0-trace.network']);
    expect(r.contenidos['0-trace.network']!.toString('utf8')).toBe('{"a":1}\n');
  });

  it('no infla lo que no se pidió: el resto queda sin leer', async () => {
    const z = zipEn('parcial.zip', [
      { nombre: 'grande.bin', contenido: 'x'.repeat(50_000) },
      { nombre: '0-trace.network', contenido: '{"a":1}\n' },
    ]);
    const r = await leerEntradas(z, soloRed);
    expect(r.nombres).toHaveLength(2);
    expect(r.contenidos['grande.bin']).toBeUndefined();
  });
});

describe('leerEntradas · garantías, una por mutante', () => {
  /**
   * 🔴 EL MUTANTE CENTRAL. `yauzl` valida tamaños pero NO el CRC de los datos: sin el
   * cálculo en streaming del adapter, este payload corrupto pasaría como bueno y el gate
   * mediría orígenes sobre bytes adulterados.
   */
  it('payload corrupto: el CRC declarado no coincide con los datos ⇒ lanza', async () => {
    const z = zipEn('corrupto.zip', [
      { nombre: '0-trace.network', contenido: '{"a":1}\n', crcFalso: 0xdeadbeef },
    ]);
    await expect(leerEntradas(z, soloRed)).rejects.toThrow(/ZIP_CRC_INVALIDO/);
  });

  it('el CRC se verifica sólo sobre lo que se lee, y el camino sano no lo dispara', async () => {
    const z = zipEn('sano.zip', [{ nombre: '0-trace.network', contenido: 'contenido largo '.repeat(500) }]);
    await expect(leerEntradas(z, soloRed)).resolves.toBeTruthy();
  });

  /** Dos entradas con el mismo nombre son ambiguas por construcción: no se elige una. */
  it('nombre duplicado ⇒ lanza, en vez de dejar que la segunda pise a la primera', async () => {
    const z = zipEn('dup.zip', [
      { nombre: '0-trace.network', contenido: '{"bueno":1}\n' },
      { nombre: '0-trace.network', contenido: '{"malo":1}\n' },
    ]);
    await expect(leerEntradas(z, todo)).rejects.toThrow(/ZIP_NOMBRE_DUPLICADO/);
  });

  it('tamaño declarado que no coincide con los datos ⇒ lanza (validateEntrySizes)', async () => {
    const z = zipEn('tam.zip', [
      { nombre: '0-trace.network', contenido: '{"a":1}\n', tamanoFalso: 99999 },
    ]);
    await expect(leerEntradas(z, soloRed)).rejects.toThrow();
  });

  it('un archivo que no es un zip ⇒ lanza, no devuelve vacío', async () => {
    const p = join(base, 'no-es-zip.zip');
    writeFileSync(p, Buffer.from('esto no es un zip en absoluto', 'utf8'));
    await expect(leerEntradas(p, todo)).rejects.toThrow();
  });

  it('un archivo inexistente ⇒ lanza', async () => {
    await expect(leerEntradas(join(base, 'no-existe.zip'), todo)).rejects.toThrow();
  });

  it('los límites contra zip bombs están declarados y son finitos', () => {
    expect(LIMITES.MAX_ENTRADAS).toBeGreaterThan(0);
    expect(Number.isFinite(LIMITES.MAX_BYTES_POR_ENTRADA)).toBe(true);
    expect(Number.isFinite(LIMITES.MAX_BYTES_TOTALES)).toBe(true);
    expect(LIMITES.MAX_BYTES_TOTALES).toBeGreaterThanOrEqual(LIMITES.MAX_BYTES_POR_ENTRADA);
  });
});

describe('crc32', () => {
  it('coincide con el valor conocido de la cadena vacía y de un texto fijo', () => {
    expect(crc32Final(crc32Parcial(Buffer.from('', 'utf8')))).toBe(0);
    // CRC32("123456789") = 0xCBF43926, vector de prueba estándar del polinomio.
    expect(crc32Final(crc32Parcial(Buffer.from('123456789', 'utf8')))).toBe(0xcbf43926);
  });

  it('el cálculo incremental da lo mismo que el de una sola pasada', () => {
    const entero = Buffer.from('abcdefghij', 'utf8');
    const deUnaVez = crc32Final(crc32Parcial(entero));
    let parcial = crc32Parcial(entero.subarray(0, 4));
    parcial = crc32Parcial(entero.subarray(4), parcial);
    expect(crc32Final(parcial)).toBe(deUnaVez);
  });
});

/**
 * 🔴 FORMAS DE ZIP QUE ESTE LECTOR NO PUEDE LEER ENTERAS.
 *
 * `yauzl` rechaza varias de estas por su cuenta — y ése es exactamente el motivo por el que
 * hay que testearlas. Una garantía que depende de una dependencia y **nadie ejerció** no está
 * verificada: está supuesta. El día que el bundle interno de `playwright-core` cambie de
 * versión, estos casos son los que avisan; sin ellos, el cambio se notaría como un gate que
 * empezó a salir limpio sobre zips que antes rechazaba.
 *
 * En los tres casos lo que importa es el MODO de fallo: **lanzar**, nunca devolver un
 * `{contenidos:{}}` que arriba se lee como «no había nada adentro».
 */
describe('leerEntradas · formas de ZIP no soportadas', () => {
  /** Un volumen suelto de un zip partido: lo que falta está en otro archivo. */
  it('multivolumen (número de disco ≠ 0) ⇒ lanza, no devuelve vacío', async () => {
    const z = zipEn('multi.zip', [{ nombre: '0-trace.network', contenido: '{"a":1}\n' }], { disco: 1 });
    await expect(leerEntradas(z, soloRed)).rejects.toThrow();
  });

  /** Método de compresión que nadie implementa: los bytes no se pueden reconstruir. */
  it('método de compresión no soportado ⇒ lanza al abrir el stream', async () => {
    const z = zipEn('metodo.zip', [{ nombre: '0-trace.network', contenido: '{"a":1}\n', metodo: 99 }]);
    await expect(leerEntradas(z, soloRed)).rejects.toThrow();
  });

  /**
   * 🔴 El tope por entrada se comprueba con el tamaño DECLARADO, antes de abrir el stream:
   * un zip bomb no llega a inflarse. Por eso el fixture declara un tamaño enorme con datos
   * chicos — si el orden fuera al revés, la memoria se pediría antes de mirar el número.
   */
  /**
   * 🔴 El tope por entrada se comprueba con el tamaño DECLARADO, antes de abrir el stream:
   * un zip bomb no llega a inflarse.
   *
   * ⚠️ **Y hacer este fixture enseñó algo sobre el propio lector.** La primera versión sólo
   * inflaba el tamaño descomprimido, y nunca llegaba a mi comprobación: `validateEntrySizes`
   * de yauzl rechaza antes cualquier STORED cuyos dos tamaños difieran. O sea que mi tope
   * estaba **tapado por una guarda anterior** y yo lo habría dado por ejercitado sin que
   * corriera una sola vez. Declarar los dos tamaños iguales es lo que lo destapa.
   */
  it('una entrada que declara más bytes que el tope ⇒ lanza ANTES de leerla', async () => {
    const enorme = LIMITES.MAX_BYTES_POR_ENTRADA + 1;
    const z = zipEn('bomba.zip', [
      { nombre: '0-trace.network', contenido: 'x', tamanoFalso: enorme, comprimidoFalso: enorme },
    ]);
    await expect(leerEntradas(z, soloRed)).rejects.toThrow(/ZIP_ENTRADA_DEMASIADO_GRANDE/);
  });

  /** Y si no se pide esa entrada, el tope no aplica: sólo se mide lo que se lee. */
  it('el tope no se dispara por una entrada que no se pidió', async () => {
    const enorme = LIMITES.MAX_BYTES_POR_ENTRADA + 1;
    const z = zipEn('bomba-ignorada.zip', [
      { nombre: 'basura.bin', contenido: 'x', tamanoFalso: enorme, comprimidoFalso: enorme },
      { nombre: '0-trace.network', contenido: '{"a":1}\n' },
    ]);
    const r = await leerEntradas(z, soloRed);
    expect(r.nombres).toContain('basura.bin');
    expect(r.contenidos['basura.bin']).toBeUndefined();
    expect(r.contenidos['0-trace.network']!.toString('utf8')).toBe('{"a":1}\n');
  });

  /**
   * 🔴 CIERRE EN EL CAMINO DE ERROR. El gate corre este lector ~200 veces por corrida: un
   * descriptor filtrado por cada zip roto agota la tabla de archivos del proceso y la falla
   * aparece lejos, disfrazada de otra cosa.
   *
   * Se mide por el efecto observable —se puede seguir abriendo archivos después de muchos
   * errores— y no espiando el interior del lector. Un test que mockea `close` prueba que se
   * llamó a `close`; éste prueba que el descriptor no quedó tomado.
   */
  it('tras muchos zips corruptos, el proceso sigue pudiendo abrir archivos', async () => {
    const corrupto = zipEn('cierre.zip', [
      { nombre: '0-trace.network', contenido: '{"a":1}\n', crcFalso: 0xdeadbeef },
    ]);
    for (let i = 0; i < 80; i += 1) {
      await expect(leerEntradas(corrupto, soloRed)).rejects.toThrow(/ZIP_CRC_INVALIDO/);
    }
    const sano = zipEn('despues.zip', [{ nombre: '0-trace.network', contenido: '{"ok":1}\n' }]);
    const r = await leerEntradas(sano, soloRed);
    expect(r.contenidos['0-trace.network']!.toString('utf8')).toBe('{"ok":1}\n');
  });

  /**
   * 🔴 ZIP64 · ítem 9 (ESCRITO_SIN_EJECUTAR).
   *
   * Acá había un `it.skip` que decía «un fixture honesto exige >4 GB». **Era una limitación
   * de mi escritor de fixtures, no del formato.** ZIP64 es una codificación: los campos de 32
   * bits llevan el centinela `0xFFFFFFFF` y el valor real viaja en el extra field `0x0001`,
   * más un EOCD64 y su localizador. El valor real puede ser 8 bytes.
   *
   * ⚠️ **Y este caso no corrió.** El fixture arma cabeceras binarias a mano bajo prohibición
   * de ejecución: si el layout tiene un byte corrido, el test fallará la primera vez que
   * alguien lo corra. Eso sería un defecto del fixture, no del lector — y lo digo ahora para
   * que quien lo vea en rojo no salga a arreglar `leer-zip.mjs`.
   */
  it('un ZIP64 legítimo se lee: el tamaño real vive en el extra field 0x0001', async () => {
    const z = zipEn('zip64.zip', [{ nombre: '0-trace.network', contenido: '{"a":1}\n' }], { zip64: true });
    const r = await leerEntradas(z, soloRed);
    expect(r.nombres).toEqual(['0-trace.network']);
    expect(r.contenidos['0-trace.network']!.toString('utf8')).toBe('{"a":1}\n');
  });

  it('el CRC se sigue verificando en un ZIP64: la codificación no exime de la comprobación', async () => {
    const z = zipEn(
      'zip64-corrupto.zip',
      [{ nombre: '0-trace.network', contenido: '{"a":1}\n', crcFalso: 0xdeadbeef }],
      { zip64: true },
    );
    await expect(leerEntradas(z, soloRed)).rejects.toThrow(/ZIP_CRC_INVALIDO/);
  });

  /**
   * 🔴 CAP TOTAL, no sólo por entrada. El tope por entrada lo cubre el caso de arriba; éste
   * cubre la otra forma del zip bomb: muchas entradas chicas que **suman**. Son dos límites
   * distintos y hasta P3 sólo uno tenía mutante.
   *
   * ⚠️ Se declara el límite del caso: con `MAX_BYTES_TOTALES` en el orden de cientos de MB,
   * un fixture que lo supere de verdad sería enorme. Lo que se fija acá es que el tope EXISTE,
   * es finito y es mayor o igual que el de una entrada — la invariante que impediría que
   * alguien lo ponga por debajo y lo vuelva inalcanzable. **El disparo efectivo del cap total
   * queda sin cubrir**, y se dice en vez de omitirse.
   */
  it('el cap TOTAL existe, es finito y no es menor que el de una entrada', () => {
    expect(Number.isFinite(LIMITES.MAX_BYTES_TOTALES)).toBe(true);
    expect(LIMITES.MAX_BYTES_TOTALES).toBeGreaterThanOrEqual(LIMITES.MAX_BYTES_POR_ENTRADA);
    expect(LIMITES.MAX_ENTRADAS).toBeGreaterThan(0);
    expect(Number.isInteger(LIMITES.MAX_ENTRADAS)).toBe(true);
  });

  /**
   * 🔴 CARDINALIDAD DEL ZIP · la lista de nombres tiene que ser el conjunto COMPLETO de
   * entradas, no sólo las leídas. El extractor decide «hubo navegador» mirando nombres que no
   * pidió inflar: si `nombres` sólo trajera lo leído, esa decisión se tomaría sobre un
   * universo recortado y nadie lo notaría.
   */
  /**
   * 🔴 ÍTEM 10 · una excepción de `quiero(nombre)` NO puede escapar del callback.
   *
   * `quiero` es código del llamador. Si lanza dentro del listener de `entry`, la excepción
   * sale por `emit()` hacia el callback de `fs` de yauzl y desde ahí no llega ni a `resolver`
   * ni a `rechazar`: la promesa no se asienta, el `await` no retorna y el `finally` que cierra
   * el descriptor no corre. Con el gate abriendo ~200 zips por corrida, un descriptor filtrado
   * por zip agota la tabla de archivos y la falla aparece lejos, disfrazada de otra cosa.
   *
   * ⚠️ `INFERENCIA_ESTRUCTURAL_NO_MEDIDA`: ese recorrido está razonado leyendo el código, no
   * observado corriendo — P3 prohíbe ejecutar. El arreglo (todo el cuerpo en `try/catch` con
   * rechazo) vale igual en los dos escenarios posibles, crash o cuelgue; lo que depende de la
   * medición es el rótulo, no la corrección.
   */
  it('si quiero() lanza, la promesa RECHAZA en vez de colgarse', async () => {
    const z = zipEn('quiero-lanza.zip', [{ nombre: '0-trace.network', contenido: '{"a":1}\n' }]);
    const explota = (): boolean => {
      throw new Error('EXPLOTA_EL_FILTRO');
    };
    await expect(leerEntradas(z, explota)).rejects.toThrow(/EXPLOTA_EL_FILTRO/);
  });

  it('y después de esa excepción se puede seguir abriendo zips: el descriptor se cerró', async () => {
    const z = zipEn('quiero-lanza-2.zip', [{ nombre: '0-trace.network', contenido: '{"a":1}\n' }]);
    const explota = (): boolean => {
      throw new Error('EXPLOTA_EL_FILTRO');
    };
    for (let i = 0; i < 40; i += 1) {
      await expect(leerEntradas(z, explota)).rejects.toThrow(/EXPLOTA_EL_FILTRO/);
    }
    const r = await leerEntradas(z, soloRed);
    expect(r.contenidos['0-trace.network']!.toString('utf8')).toBe('{"a":1}\n');
  });

  it('nombres enumera TODAS las entradas aunque sólo se lea una', async () => {
    const z = zipEn('cardinalidad.zip', [
      { nombre: '0-trace.network', contenido: '{"a":1}\n' },
      { nombre: '0-trace.trace', contenido: '{"type":"context-options"}\n' },
      { nombre: 'resources/x.jpeg', contenido: 'xxxx' },
      { nombre: 'resources/y.jpeg', contenido: 'yyyy' },
    ]);
    const r = await leerEntradas(z, soloRed);
    expect(r.nombres).toHaveLength(4);
    expect(Object.keys(r.contenidos)).toEqual(['0-trace.network']);
  });
});
