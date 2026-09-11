/**
 * LECTOR DE ENTRADAS DE UN trace.zip · sin binario externo, sin PATH, sin dependencia nueva.
 *
 * ## Por qué no es `execFileSync('unzip', …)` ni un parser propio
 *
 * La primera versión de este gate abría los zips con `execFileSync('unzip', …)`: eso
 * resuelve el binario **por PATH**, así que lo que corre lo elige el entorno. Este repo ya
 * pagó esa cuenta —`npx tsc` desde una raíz sin dependencias descarga y ejecuta un paquete
 * okupa, documentado en `scripts/aliasesLib.mjs`—. Pinnear el `unzip` del sistema por hash
 * tampoco sirve: el hash es de UNA máquina y rompería en CI por una diferencia legítima de
 * sistema operativo.
 *
 * La segunda versión fue un parser ZIP escrito a mano. **Fue rechazado en auditoría, y con
 * razón**: descomprimía todas las entradas, no verificaba CRC, los nombres duplicados se
 * sobrescribían, el comentario afirmaba rechazar multivolumen y el código no lo chequeaba, y
 * omitía la comparación de tamaño cuando el declarado era 0. Cinco agujeros en ~70 líneas:
 * reimplementar ZIP para un gate de seguridad es traer una superficie que nadie audita.
 *
 * Lo vigente usa **`yauzl`**, que ya viaja pinneado dentro de `playwright-core` —la misma
 * dependencia que produce los traces— y se accede por `playwright-core/lib/utilsBundle`.
 * Cero dependencias nuevas (el gobierno del repo las prohíbe sin OK de Mati) y cero PATH.
 *
 * ⚠️ **Riesgo declarado:** `yauzl` **no figura como paquete en `package-lock.json`**: va
 * embebido en el bundle de `playwright-core`, y `lib/utilsBundle` es API interna. Puede
 * cambiar entre versiones sin ser un breaking change público. Por eso el import se verifica
 * con un probe de forma que **aborta** si no encuentra lo que espera, en vez de degradar.
 *
 * ## 🔴 Lo que este módulo comprueba, y por qué cada cosa
 *
 * · **CRC32 propio contra `entry.crc32`.** `yauzl` valida tamaños con
 *   `validateEntrySizes`, pero **no verifica el CRC de los datos**: un payload corrupto con
 *   el tamaño correcto pasaría. Se calcula en streaming sobre lo que realmente se leyó.
 * · **Duplicados rechazados.** Dos entradas con el mismo nombre dejaban que la segunda
 *   pisara a la primera en silencio — un vector clásico para esconder contenido.
 * · **Caps de entradas y de bytes.** Un zip bomb no puede agotar memoria: se corta y lanza.
 * · **Sólo se leen las entradas que importan.** Inflar screenshots y fuentes para buscar una
 *   línea de red es gasto y superficie de riesgo sin ninguna contrapartida.
 * · **Cierre explícito con `autoClose:false`,** también en el camino de error y en el early
 *   return. Un descriptor filtrado en un gate que corre 200 veces es un problema propio.
 *
 * Todo lo que no se entiende **lanza**. Un lector que no puede abrir el zip nunca debe
 * contestar «no vi nada adentro»: son dos afirmaciones distintas y sólo una es medición.
 */

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolverPaqueteLocal } from './anclar-local.mjs';

/** Tabla CRC32 estándar (polinomio 0xEDB88320), la misma que usa el formato ZIP. */
const TABLA_CRC = (() => {
  const tabla = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabla[n] = c >>> 0;
  }
  return tabla;
})();

/** CRC32 incremental: se alimenta chunk a chunk mientras el stream avanza. */
export function crc32Parcial(buf, previo = 0xffffffff) {
  let c = previo;
  for (const byte of buf) c = TABLA_CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return c >>> 0;
}

export const crc32Final = (acumulado) => (acumulado ^ 0xffffffff) >>> 0;

/** Topes contra zip bombs. Un trace real de Playwright está muy por debajo de los dos. */
export const LIMITES = Object.freeze({
  MAX_ENTRADAS: 4096,
  MAX_BYTES_POR_ENTRADA: 256 * 1024 * 1024,
  MAX_BYTES_TOTALES: 512 * 1024 * 1024,
});

let yauzlCache = null;
let versionDePlaywrightCore = null;

/** La raíz de este árbol, derivada de la ubicación de este archivo: `<raiz>/scripts/…`. */
const RAIZ_POR_DEFECTO = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Importa `yauzl` y **verifica su forma antes de usarlo**. Si el bundle interno de
 * `playwright-core` cambió, esto falla acá con un mensaje que lo dice, en vez de fallar
 * más adentro con un error que parezca del zip.
 */
export async function cargarYauzl(raiz = RAIZ_POR_DEFECTO) {
  if (yauzlCache) return yauzlCache;

  /**
   * 🔴 ANCLAJE ANTES DEL IMPORT · ítem 3.
   *
   * Antes se importaba `playwright-core/lib/utilsBundle` a secas: el resolvedor de Node
   * decidía cuál, y una versión distinta de `playwright-core` —o una copia en un
   * `node_modules` de un padre— habría entrado sin que nadie lo notara. Acá se exige que el
   * paquete resuelva DENTRO de este árbol por `realpath` y que su versión sea exactamente la
   * del lock. Un lector de traces que no sabe de qué paquete salió no puede acreditar nada
   * sobre lo que lee.
   */
  let anclado;
  try {
    anclado = resolverPaqueteLocal({ raiz, desde: import.meta.url, paquete: 'playwright-core' });
  } catch (e) {
    throw new Error(`YAUZL_PAQUETE_NO_ANCLADO: ${e.message}`);
  }

  let mod;
  try {
    mod = await import('playwright-core/lib/utilsBundle');
  } catch (e) {
    throw new Error(`YAUZL_IMPORT_FALLIDO: no pude importar playwright-core/lib/utilsBundle — ${e.message}`);
  }
  const y = mod.yauzl;
  if (!y || typeof y.open !== 'function' || typeof y.openPromise !== 'function') {
    throw new Error(
      'YAUZL_FORMA_INESPERADA: playwright-core/lib/utilsBundle no expone yauzl.open/openPromise. ' +
        'Es API interna del bundle y pudo cambiar de version: se aborta en vez de degradar.',
    );
  }
  yauzlCache = y;
  versionDePlaywrightCore = anclado.version;
  return y;
}

/** Versión de `playwright-core` de la que salió el yauzl en uso, o `null` si no se cargó. */
export function versionDelLector() {
  return versionDePlaywrightCore;
}

/**
 * Lee del zip **sólo** las entradas cuyo nombre satisface `quiero(nombre)`.
 *
 * Devuelve `{ nombres, contenidos }`: `nombres` son TODAS las entradas del zip —hace falta
 * para decidir si una traza tiene contexto de navegador— y `contenidos` sólo las pedidas.
 */
export async function leerEntradas(ruta, quiero) {
  const yauzl = await cargarYauzl();
  const zip = await yauzl.openPromise(ruta, {
    lazyEntries: true,
    strictFileNames: true,
    validateEntrySizes: true,
    autoClose: false,
  });

  const nombres = [];
  const contenidos = Object.create(null);
  const vistos = new Set();
  let bytesTotales = 0;

  const cerrar = () => {
    try {
      zip.close();
    } catch {
      /* cerrar dos veces no es un error que deba tapar al original */
    }
  };

  try {
    await new Promise((resolver, rechazar) => {
      zip.on('error', rechazar);
      zip.on('end', resolver);
      /**
       * 🔴 TODO EL CUERPO EN try/catch · ítem 13.
       *
       * `quiero(nombre)` es código del llamador y puede lanzar. Si la excepción escapa de
       * este listener, sale por `emit()` hacia el callback de `fs` de yauzl, y desde ahí no
       * llega ni a `resolver` ni a `rechazar`: la promesa no se asienta, el `await` no
       * retorna y el `finally` que cierra el descriptor **no corre nunca**. Con este gate
       * abriendo ~200 zips por corrida, un descriptor filtrado por cada zip raro agota la
       * tabla de archivos y la falla aparece lejos, disfrazada de otra cosa.
       *
       * ⚠️ `INFERENCIA_ESTRUCTURAL_NO_MEDIDA`: el recorrido de arriba está razonado leyendo
       * el código, no observado corriendo — P3 prohíbe ejecutar. El arreglo es el mismo en
       * los dos escenarios posibles (excepción no capturada o promesa colgada), así que la
       * corrección no depende de resolver esa duda; el rótulo sí, y por eso está escrito.
       */
      zip.on('entry', (entrada) => {
        try {
          procesarEntrada(entrada);
        } catch (e) {
          rechazar(e instanceof Error ? e : new Error(`ZIP_ENTRADA_FALLIDA: ${String(e)}`));
        }
      });

      function procesarEntrada(entrada) {
        const nombre = entrada.fileName;

        if (nombres.length >= LIMITES.MAX_ENTRADAS) {
          rechazar(new Error(`ZIP_DEMASIADAS_ENTRADAS: mas de ${LIMITES.MAX_ENTRADAS} en ${ruta}`));
          return;
        }
        // 🔴 Duplicado: no se resuelve quedandose con uno. Un zip con dos entradas del mismo
        // nombre es ambiguo por construccion, y la ambiguedad es justo donde se esconde algo.
        if (vistos.has(nombre)) {
          rechazar(new Error(`ZIP_NOMBRE_DUPLICADO: «${nombre}» aparece mas de una vez en ${ruta}`));
          return;
        }
        vistos.add(nombre);
        nombres.push(nombre);

        if (!quiero(nombre)) {
          zip.readEntry();
          return;
        }
        if (entrada.uncompressedSize > LIMITES.MAX_BYTES_POR_ENTRADA) {
          rechazar(new Error(`ZIP_ENTRADA_DEMASIADO_GRANDE: «${nombre}» declara ${entrada.uncompressedSize} B`));
          return;
        }

        zip.openReadStream(entrada, (err, stream) => {
          if (err) {
            rechazar(new Error(`ZIP_STREAM_FALLIDO en «${nombre}»: ${err.message}`));
            return;
          }
          const trozos = [];
          let leidos = 0;
          let crc = 0xffffffff;
          stream.on('data', (trozo) => {
            leidos += trozo.length;
            bytesTotales += trozo.length;
            if (leidos > LIMITES.MAX_BYTES_POR_ENTRADA || bytesTotales > LIMITES.MAX_BYTES_TOTALES) {
              stream.destroy();
              rechazar(new Error(`ZIP_LIMITE_DE_BYTES superado leyendo «${nombre}»`));
              return;
            }
            crc = crc32Parcial(trozo, crc);
            trozos.push(trozo);
          });
          stream.on('error', (e) => rechazar(new Error(`ZIP_ERROR_DE_LECTURA en «${nombre}»: ${e.message}`)));
          stream.on('end', () => {
            // 🔴 yauzl valida TAMAÑOS con validateEntrySizes, pero no el CRC de los datos:
            // un payload corrupto del largo correcto pasaria. Esto lo cierra.
            const calculado = crc32Final(crc);
            if (calculado !== (entrada.crc32 >>> 0)) {
              rechazar(
                new Error(
                  `ZIP_CRC_INVALIDO en «${nombre}»: el zip declara ${(entrada.crc32 >>> 0).toString(16)} ` +
                    `y los datos dan ${calculado.toString(16)}`,
                ),
              );
              return;
            }
            contenidos[nombre] = Buffer.concat(trozos);
            zip.readEntry();
          });
        });
      }
      zip.readEntry();
    });
  } finally {
    cerrar();
  }

  return { nombres, contenidos };
}
