/**
 * ANCLAJE LOCAL · qué binario corre, de dónde sale, y que no salga del árbol.
 *
 * Dos ítems del CTO son, mirados de cerca, **la misma máquina**:
 *
 *   · «Vite y yauzl por realpath DENTRO del worktree y versión exacta contra lock»
 *   · «containment por `path.relative`»
 *
 * Resolver, `realpath`, y comprobar que el resultado sigue cayendo adentro. Está escrito una
 * sola vez a propósito: dos implementaciones de la misma comprobación se desalinean calladas
 * —el mismo defecto que ya pagué re-declarando un patrón en un test en vez de importarlo—.
 *
 * ## 🔴 Por qué `path.relative` y no `startsWith`
 *
 * `candidato.startsWith(raiz)` aprueba `/repo-malicioso` cuando la raíz es `/repo`: comparar
 * cadenas no sabe dónde termina un segmento de ruta. `path.relative` sí: si el resultado
 * empieza con `..` o es absoluto, el candidato está afuera. Es la diferencia entre comparar
 * texto y comparar rutas.
 *
 * ## 🔴 Por qué `realpath` de LOS DOS lados, y no sólo del candidato
 *
 * En macOS `/tmp` es un symlink a `/private/tmp`. Si resuelvo el candidato y no la raíz, un
 * árbol legítimo bajo `tmpdir()` da «afuera» y el gate falla por una razón inventada. Las dos
 * puntas se normalizan o la comparación no significa nada.
 *
 * ⚠️ Y `realpathSync` **falla si la ruta no existe**. El caso aparece de verdad: hay que
 * comprobar containment de `test-results/` antes de crearlo. Por eso se resuelve el ancestro
 * más profundo que sí existe y se le vuelve a pegar el resto — así el symlink de la parte
 * real se normaliza igual, sin exigir que el destino ya esté.
 *
 * ## 🔴 Versión exacta contra el lock, y qué acredita
 *
 * Que `node_modules/<paquete>/package.json` diga la misma versión que `package-lock.json`.
 *
 * 🔴 **La garantía exacta, enunciada entera porque la versión corta decía de más.** Acredita
 * que el campo `version` del paquete instalado es idéntico al que el lock fija para ese
 * paquete. Nada más que eso. En particular **NO** acredita:
 *   · que los archivos instalados provengan de ese lock — editar un archivo in situ no mueve
 *     la versión, así que un árbol manipulado pasa esta comprobación;
 *   · integridad de contenido — eso exigiría verificar el `integrity` del lock sobre el
 *     tarball, que es otra comprobación y no se hace acá;
 *   · nada sobre el RESTO del árbol: se comparó ese paquete, no todos.
 *
 * Antes acá decía «acredita que el árbol instalado no derivó del lock», y era más de lo que
 * mide: «no derivó» habla de los bytes, y lo único que se miró fue una cadena de versión.
 *
 * Todo lo que no se entiende **lanza**. Un anclaje que no puede verificar dónde está parado
 * nunca debe contestar «está bien»: es exactamente el fail-open que el gate viene a cerrar.
 */

import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, dirname, sep } from 'node:path';
import { createRequire } from 'node:module';

/**
 * `realpathSync` tolerante con rutas que todavía no existen: resuelve el ancestro más
 * profundo que exista y le reanexa el resto. Sin esto no se puede comprobar containment de
 * un directorio que el gate va a crear después.
 */
export function realpathTolerante(p) {
  let actual = resolve(p);
  const cola = [];
  for (;;) {
    if (existsSync(actual)) return cola.length === 0 ? realpathSync(actual) : join(realpathSync(actual), ...cola);
    const padre = dirname(actual);
    // 🔴 En la raíz del filesystem `dirname` devuelve la misma ruta: sin este corte el bucle
    // no termina. No es defensivo de adorno — es la condición de parada real.
    if (padre === actual) return actual;
    cola.unshift(actual.slice(padre.length + (padre.endsWith(sep) ? 0 : 1)));
    actual = padre;
  }
}

/**
 * 🔴 ¿Este texto relativo ESCAPA de su raíz? El límite es exacto: `'..'` solo, o `'..'`
 * seguido del separador, o una ruta absoluta.
 *
 * **No es `startsWith('..')`**, y la diferencia no es teórica: un directorio llamado `..foo`
 * es un hijo legítimo, y `startsWith` lo declara afuera. Falla del lado cerrado, así que no
 * era un agujero — era **incorrecto**, y un gate que rechaza rutas válidas por una razón
 * inventada es un gate en el que nadie va a confiar la próxima vez que rechace algo de
 * verdad. Hallado por el CTO en la reauditoría estática de P3.
 *
 * Vive acá y no en `redactar.mjs` porque es containment, y porque `redactar` ya importa este
 * módulo: definirlo del otro lado sería un ciclo.
 */
export function relativoEscapa(rel) {
  return rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel);
}

/**
 * ¿`candidato` cae dentro de `raiz`? Compara RUTAS, no cadenas, y normaliza symlinks de los
 * dos lados. Por defecto la raíz **no se considera contenida en sí misma**: para una guarda
 * de borrado, «el candidato es la raíz entera» es justo el caso que hay que frenar.
 */
export function rutaContenida(raiz, candidato, { permitirIgual = false } = {}) {
  const r = realpathTolerante(raiz);
  const c = realpathTolerante(candidato);
  const rel = relative(r, c);
  if (rel === '') return permitirIgual;
  return !relativoEscapa(rel);
}

/** Igual que `rutaContenida`, pero lanza con un mensaje que dice qué se estaba anclando. */
export function exigirContenida(raiz, candidato, queEs, opciones = {}) {
  if (!rutaContenida(raiz, candidato, opciones)) {
    throw new Error(
      `ANCLA_FUERA_DEL_ARBOL: ${queEs} resuelve a «${realpathTolerante(candidato)}», que no esta dentro de ` +
        `«${realpathTolerante(raiz)}». No se opera sobre rutas de afuera del worktree.`,
    );
  }
  return realpathTolerante(candidato);
}

/**
 * Versión que el lock declara para un paquete. `lockfileVersion` 3 indexa por la ruta
 * `node_modules/<nombre>`; si el lock tuviera otro formato se lanza en vez de devolver
 * `null`, porque «no encontré la entrada» y «este lock no es el que sé leer» son dos
 * afirmaciones distintas y sólo una permite seguir.
 */
export function versionEnLock(raiz, paquete) {
  const ruta = join(raiz, 'package-lock.json');
  if (!existsSync(ruta)) throw new Error(`ANCLA_LOCK_AUSENTE: no hay package-lock.json en ${raiz}`);
  let lock;
  try {
    lock = JSON.parse(readFileSync(ruta, 'utf8'));
  } catch (e) {
    throw new Error(`ANCLA_LOCK_ILEGIBLE: ${ruta} — ${e.message}`);
  }
  if (!lock.packages || typeof lock.packages !== 'object') {
    throw new Error(
      `ANCLA_LOCK_FORMATO_INESPERADO: ${ruta} no tiene «packages» (lockfileVersion ${lock.lockfileVersion}). ` +
        'Se aborta en vez de adivinar el formato.',
    );
  }
  const entrada = lock.packages[`node_modules/${paquete}`];
  if (!entrada || typeof entrada.version !== 'string') {
    throw new Error(`ANCLA_LOCK_SIN_ENTRADA: el lock no declara version para node_modules/${paquete}`);
  }
  return entrada.version;
}

/**
 * Resuelve un paquete **dentro de este árbol** y verifica que su versión instalada sea
 * exactamente la del lock.
 *
 * `desde` es la URL del módulo que pide la resolución: `createRequire` mira el
 * `node_modules` de ESE archivo, nunca el de un padre que casualmente tenga el paquete.
 */
export function resolverPaqueteLocal({ raiz, desde, paquete }) {
  const requerir = createRequire(desde);
  let pj;
  try {
    pj = requerir.resolve(`${paquete}/package.json`);
  } catch (e) {
    throw new Error(
      `ANCLA_RESOLUCION_FALLIDA: no pude resolver ${paquete}/package.json desde ${desde} — ${e.message}. ` +
        'No se sale a buscarlo por PATH ni con npx: instala dependencias con `npm ci`.',
    );
  }
  const pjReal = exigirContenida(raiz, pj, `${paquete}/package.json`);
  const dir = dirname(pjReal);

  let instalada;
  try {
    instalada = JSON.parse(readFileSync(pjReal, 'utf8')).version;
  } catch (e) {
    throw new Error(`ANCLA_PACKAGE_JSON_ILEGIBLE: ${pjReal} — ${e.message}`);
  }
  const enLock = versionEnLock(raiz, paquete);
  if (instalada !== enLock) {
    throw new Error(
      `ANCLA_VERSION_DISTINTA_DEL_LOCK: ${paquete} instalado es ${instalada} y el lock declara ${enLock}. ` +
        'La version declarada del paquete instalado no es la que el lock fija: se aborta en vez de medir '+
        'con una version que nadie fijo.',
    );
  }
  return { dir, version: instalada, versionEnLock: enLock, packageJson: pjReal };
}

/**
 * Entrypoint concreto de un paquete local — p. ej. `vite` → `bin/vite.js` — ya anclado por
 * realpath, containment y versión. Si el archivo no está, lanza: «no encontré el runner»
 * nunca puede degradar a «no vi nada raro».
 */
export function entrypointLocal({ raiz, desde, paquete, subruta }) {
  const { dir, version } = resolverPaqueteLocal({ raiz, desde, paquete });
  const bruto = join(dir, subruta);
  const ruta = exigirContenida(raiz, bruto, `${paquete}/${subruta}`);
  if (!existsSync(ruta)) {
    throw new Error(`ANCLA_ENTRYPOINT_AUSENTE: ${ruta} no existe. El gate no arranca en vez de salir a buscarlo afuera.`);
  }
  return { ruta, version };
}

/**
 * ────────────────────────────────────────────────────────────────────────────────────────
 * ANCLAJE DEL ENTORNO Y CENSO PREVIO AL BORRADO
 *
 * Estas dos viven acá y no en el gate por una razón concreta: `gate-origen.mjs` es un script
 * con efectos al cargar —si el test lo importara para probar estas funciones, **lanzaría el
 * E2E**, que está prohibido—. Separarlas es lo que permite probarlas de verdad en vez de sólo
 * por caja negra.
 *
 * Y no son ajenas al módulo: `NODE_OPTIONS` inyecta código en el node que corre, `BASH_ENV`
 * en el shell que lanza `webServer.command`, y un proxy redirige a dónde va el tráfico. Eso
 * ES «qué corre y de dónde sale», igual que resolver un binario.
 * ────────────────────────────────────────────────────────────────────────────────────────
 */

/**
 * Variables que se RETIRAN. Cada una puede inyectar código o redirigir tráfico en el proceso
 * que el gate lanza, y el gate existe justamente para afirmar contra qué se habló.
 */
export const ENV_RETIRADAS = Object.freeze([
  'NODE_OPTIONS',            // --require/--import: código arbitrario en cada node hijo
  'NODE_REPL_EXTERNAL_MODULE',
  'NODE_EXTRA_CA_CERTS',     // haría confiable un certificado puesto por un tercero
  'PW_TEST_SOURCE_TRANSFORM', // hook de transformación de fuentes de Playwright
  'PW_TEST_SOURCE_TRANSFORM_SCOPE',
  'BASH_ENV',                // lo sourcea bash no interactivo: el shell del webServer
  'ENV',                     // lo mismo para sh
  'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'FTP_PROXY', 'NO_PROXY',
  'http_proxy', 'https_proxy', 'all_proxy', 'ftp_proxy', 'no_proxy',
  'npm_config_proxy', 'npm_config_https_proxy', 'npm_config_registry',
]);

/**
 * Variables que NO se retiran pero **se declaran** si están presentes.
 *
 * 🔴 Y la razón es una limitación honesta, no una excepción de conveniencia: retirarlas
 * cambiaría qué navegador o qué caché usa la corrida, y **no puedo probar ese cambio** —
 * correr el E2E está prohibido sin egress-deny previo—. Un cambio no probado en el camino
 * que lanza el runner es peor que un dato declarado. Quedan visibles en la evidencia para
 * que un auditor las vea; cerrarlas es trabajo de la unidad que pueda correr el E2E.
 */
export const ENV_DECLARADAS = Object.freeze([
  'PLAYWRIGHT_BROWSERS_PATH',
  'PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD',
  'PLAYWRIGHT_DOWNLOAD_HOST',
  'NODE_PATH',
  'NODE_ENV',
]);

/**
 * Devuelve un entorno sin las variables que pueden inyectar código o redirigir tráfico, y el
 * informe de lo que encontró. No muta el original.
 *
 * ⚠️ El informe dice **qué nombres** estaban presentes, nunca sus valores: un `HTTPS_PROXY`
 * trae credenciales en el userinfo con toda naturalidad.
 */
export function envSaneado(entorno) {
  const limpio = { ...entorno };
  const retiradas = [];
  for (const k of ENV_RETIRADAS) {
    if (Object.prototype.hasOwnProperty.call(limpio, k)) {
      delete limpio[k];
      retiradas.push(k);
    }
  }
  const declaradas = ENV_DECLARADAS.filter((k) => Object.prototype.hasOwnProperty.call(limpio, k));
  return { env: limpio, retiradas, declaradas_presentes: declaradas };
}

/**
 * Censo recursivo de un directorio, para mirar QUÉ se va a destruir antes de destruirlo.
 *
 * 🔴 Existe por INC-08: una prueba de fail-closed entró por la limpieza y se llevó 211 traces
 * de una corrida ya hecha. El orden se arregló entonces —limpiar es lo último—, pero el orden
 * solo no alcanza: aun en el lugar correcto, `rmSync` seguía borrando **sin mirar**. Lo que
 * cierra la clase no es borrar más tarde, es **no borrar lo que nadie inventarió**.
 */
export function censarDirectorio(dir, { tope = 200 } = {}) {
  if (!existsSync(dir)) return { existe: false, archivos: [], cantidad: 0, bytes: 0, truncado: false };
  const archivos = [];
  let bytes = 0;
  const pendientes = [''];
  while (pendientes.length > 0) {
    const rel = pendientes.pop();
    const abs = rel === '' ? dir : join(dir, rel);
    for (const ent of readdirSync(abs, { withFileTypes: true })) {
      const hijo = rel === '' ? ent.name : join(rel, ent.name);
      // 🔴 No se sigue un symlink: un enlace dentro de test-results apuntando afuera haría
      // que el censo describa —y una limpieza recursiva toque— bytes de otro árbol.
      if (ent.isSymbolicLink()) {
        archivos.push({ rel: hijo, bytes: 0, symlink: true });
        continue;
      }
      if (ent.isDirectory()) {
        pendientes.push(hijo);
        continue;
      }
      let tam = 0;
      try {
        tam = statSync(join(dir, hijo)).size;
      } catch {
        tam = 0;
      }
      bytes += tam;
      archivos.push({ rel: hijo, bytes: tam });
    }
  }
  archivos.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  return {
    existe: true,
    cantidad: archivos.length,
    bytes,
    truncado: archivos.length > tope,
    archivos: archivos.slice(0, tope),
  };
}
