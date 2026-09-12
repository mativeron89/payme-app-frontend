import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import configDePlaywright, { _paraPruebas } from '../playwright.config.js';
import { rutaContenida, versionEnLock } from './anclar-local.mjs';

const { comillasPosix, VITE_LOCAL } = _paraPruebas;

const RAIZ_DEL_REPO = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * 🔴 `webServer` admite UN objeto o un ARRAY, y el tipo de Playwright lo dice.
 *
 * El typecheck lo cazó apenas se habilitó la ejecución: yo había escrito
 * `configDePlaywright.webServer?.command`, que asume la forma singular. Hoy este config tiene
 * un solo servidor, así que el acceso «funcionaría» — y esa es exactamente la clase de
 * suposición que se rompe callada el día que alguien agregue el segundo.
 *
 * Se normaliza a lista y se exige que haya **exactamente uno**: si mañana hay dos, este test
 * se pone rojo y obliga a decidir cuál se verifica, en vez de mirar el primero sin avisar.
 */
function comandoDelWebServer(): string {
  const ws = configDePlaywright.webServer;
  const lista = ws === undefined ? [] : Array.isArray(ws) ? ws : [ws];
  expect(lista).toHaveLength(1);
  return lista[0]?.command ?? '';
}

/**
 * ✅ **Corrido: 18/18 verde el 2026-09-11T17:17Z.** El typecheck cazó lo primero apenas se
 * habilitó la ejecución: `webServer` admite un objeto O un array, y yo había escrito el acceso
 * asumiendo la forma singular. Hoy hay un solo servidor, así que «funcionaba» — y ésa es
 * justo la suposición que se rompe callada el día que alguien agregue el segundo.
 *
 * EL COMANDO QUE LANZA EL SERVIDOR DE PRUEBA ES UNA LÍNEA DE SHELL.
 *
 * `webServer.command` de Playwright no es un `argv`: es una línea que un shell interpreta.
 * Antes se armaba con `JSON.stringify`, que produce comillas DOBLES — y dentro de comillas
 * dobles el shell **sigue expandiendo** `$(...)`, los backticks y `\`. Una ruta que
 * contuviera `$(...)` se habría ejecutado al arrancar el runner.
 *
 * Entre comillas SIMPLES no se expande nada. La única comilla simple se escapa cerrando la
 * cadena, insertando `\'` y volviendo a abrir: `'` → `'\''`.
 *
 * 🔴 Este test IMPORTA la función de producción. Cuando lo escribí por primera vez verifiqué
 * el comportamiento con una **reimplementación** de `comillasPosix` y lo declaré como límite:
 * probar una copia no prueba el cableado, porque si la de producción cambiara, la copia
 * seguiría verde. Por eso el config ahora la exporta y acá se importa.
 */

describe('comillasPosix · el comando del webServer', () => {
  it('una ruta normal queda entre comillas simples', () => {
    expect(comillasPosix('/usr/local/bin/node')).toBe("'/usr/local/bin/node'");
  });

  it('una ruta con espacios sobrevive sin partirse en dos argumentos', () => {
    expect(comillasPosix('/ruta con espacios/node')).toBe("'/ruta con espacios/node'");
  });

  /** 🔴 EL MUTANTE QUE IMPORTA: sustitución de comando. */
  it('neutraliza $( ) · entre comillas simples el shell no lo expande', () => {
    const hostil = '/ruta/$(whoami)/node';
    const citado = comillasPosix(hostil);
    expect(citado).toBe("'/ruta/$(whoami)/node'");
    expect(citado.startsWith("'")).toBe(true);
    expect(citado.endsWith("'")).toBe(true);
    // El contenido no queda nunca fuera de las comillas simples.
    expect(citado.slice(1, -1)).toBe(hostil);
  });

  it('neutraliza los backticks por el mismo mecanismo', () => {
    expect(comillasPosix('/ruta/`id`/node')).toBe("'/ruta/`id`/node'");
  });

  /** El único carácter que hay que escapar de verdad: la comilla simple. */
  it('escapa la comilla simple cerrando, insertando y reabriendo', () => {
    expect(comillasPosix("/ruta/o'brien/node")).toBe("'/ruta/o'\\''brien/node'");
  });

  /**
   * 🔴 LA VERIFICACIÓN DE VERDAD: se lo damos a un shell real y miramos qué sale.
   *
   * La primera versión de este caso comprobaba el escapado con una regex propia sobre el
   * texto citado. La regex estaba mal y marcó rojo una salida correcta: **yo estaba
   * modelando el escapado en vez de medirlo**. Un shell real es el único árbitro de si una
   * cadena citada es segura, así que se la pasamos a `sh` y exigimos que devuelva EXACTAMENTE
   * el original.
   *
   * ⚠️ Y la carga es inofensiva a propósito. Un test que verifica quoting ejecutando un shell
   * **ejecuta el payload si el quoting falla**: usar `rm -rf /` como caso de prueba sería
   * apostar el disco a que el código bajo prueba está bien. `$(echo INYECTADO)` prueba lo
   * mismo —si se expande, aparece la palabra— y no rompe nada si el test encuentra el bug.
   */
  it.each([
    // [caso, literal hostil, lo que saldría SI el shell lo expandiera]
    ['sustitución de comando', '/ruta/$(echo INYECTADO)/node', '/ruta/INYECTADO/node'],
    ['backticks', '/ruta/`echo INYECTADO`/node', '/ruta/INYECTADO/node'],
    ['comilla simple y punto y coma', "/x'; echo INYECTADO ;'", '/x'],
    ['variable', '/ruta/$HOME/node', `/ruta/${process.env['HOME'] ?? ''}/node`],
    ['espacios y comillas dobles', '/ruta con "comillas"/node', '/ruta con comillas/node'],
  ])('un shell real devuelve el literal intacto · %s', (_caso, hostil, siSeExpandiera) => {
    const salida = execFileSync('/bin/sh', ['-c', `printf '%s' ${comillasPosix(hostil)}`], {
      encoding: 'utf8',
    });
    expect(salida).toBe(hostil);
    // 🔴 El discriminador es éste: que NO sea la forma expandida. Mi primera versión
    // afirmaba que la salida no contenía «INYECTADO», y era una aserción que se contradecía
    // sola — el literal contiene esa palabra por construcción, así que el caso correcto la
    // hacía fallar. La función estaba bien; la aserción, mal.
    expect(salida).not.toBe(siSeExpandiera);
  });

  it('la cadena vacía sigue siendo un argumento vacío, no la desaparición del argumento', () => {
    expect(comillasPosix('')).toBe("''");
  });
});

/**
 * 🔴 EL ANCLAJE DE VITE Y LA LÍNEA QUE EL RUNNER USA DE VERDAD · ítems 2 y 8.
 *
 * No se afirma sobre una copia de la línea ni sobre una reconstrucción: se lee
 * `webServer.command` **del objeto de configuración exportado**, que es exactamente el que
 * Playwright consume. Reconstruirla acá sería probar mi reconstrucción.
 */
describe('el servidor de prueba se lanza con el Node y el Vite de ESTE árbol', () => {
  it('Vite se resuelve por anclar-local, no por una implementación propia del config', () => {
    expect(typeof VITE_LOCAL.ruta).toBe('string');
    expect(typeof VITE_LOCAL.version).toBe('string');
  });

  /** 🔴 Un symlink no puede sacar la resolución del worktree. */
  it('el entrypoint de Vite cae DENTRO del worktree, comprobado por realpath', () => {
    expect(rutaContenida(RAIZ_DEL_REPO, VITE_LOCAL.ruta)).toBe(true);
    expect(VITE_LOCAL.ruta.endsWith('/bin/vite.js')).toBe(true);
  });

  /**
   * 🔴 Versión exacta contra el lock. **Garantía exacta:** el campo `version` del Vite instalado
   * es idéntico al que el lock fija. NO acredita que los archivos provengan de ese lock —editar un
   * archivo in situ no mueve la versión—, ni integridad de contenido —eso exigiría verificar el
   * `integrity` sobre el tarball—, ni nada sobre el resto del árbol.
   */
  it('la versión de Vite es exactamente la que declara package-lock.json', () => {
    expect(VITE_LOCAL.version).toBe(versionEnLock(RAIZ_DEL_REPO, 'vite'));
  });

  it('el comando empieza por el process.execPath citado, y con él se lanza', () => {
    const comando = comandoDelWebServer();
    expect(comando.startsWith(comillasPosix(process.execPath))).toBe(true);
  });

  it('el segundo token es el Vite anclado, también citado', () => {
    const comando = comandoDelWebServer();
    expect(comando).toContain(comillasPosix(VITE_LOCAL.ruta));
  });

  /**
   * 🔴 `npx --no-install <paquete inexistente>` **emite igual una solicitud a
   * registry.npmjs.org** — medido en este repo. O sea que el arranque del gate tenía un
   * fail-open de red justo en el instrumento que pretende acreditar que la corrida no habla
   * con afuera. Este caso existe para que no vuelva por descuido.
   */
  it('el comando NO contiene npx, ni pide nada por PATH', () => {
    const comando = comandoDelWebServer();
    expect(comando).not.toContain('npx');
    expect(comando).not.toMatch(/(^|\s)vite(\s|$)/); // «vite» pelado se resolvería por PATH
  });

  it('sigue apuntando al puerto propio y al modo mock, con strictPort', () => {
    const comando = comandoDelWebServer();
    expect(comando).toContain('--port 5176');
    expect(comando).toContain('--strictPort');
    expect(comando).toContain('--mode mock');
  });
});
