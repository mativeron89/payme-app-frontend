import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  realpathTolerante,
  rutaContenida,
  exigirContenida,
  versionEnLock,
  resolverPaqueteLocal,
  entrypointLocal,
  envSaneado,
  censarDirectorio,
  relativoEscapa,
  ENV_RETIRADAS,
  ENV_DECLARADAS,
} from './anclar-local.mjs';

/**
 * EL ANCLAJE, PROBADO POR SUS GARANTÍAS.
 *
 * Este módulo decide dos cosas de las que depende todo el gate: **qué binario corre** y
 * **sobre qué rutas se opera**. Las dos fallan hacia el desastre si fallan abiertas — un
 * `vite` de otro árbol mide otro código; una ruta mal contenida borra evidencia ajena.
 *
 * Cada garantía tiene acá su mutante, y dos de ellos son los que de verdad importan:
 *
 * ① **`startsWith` en vez de `path.relative`.** Aprueba `/repo-malicioso` cuando la raíz es
 *    `/repo`, porque comparar cadenas no sabe dónde termina un segmento de ruta.
 * ② **`realpath` de un solo lado.** En macOS `tmpdir()` cuelga de `/var`, que es symlink a
 *    `/private/var`: resolver el candidato y no la raíz declara «afuera» un árbol legítimo.
 *    El caso no es hipotético — es el entorno donde corre esta misma suite.
 */

const RAIZ_DEL_REPO = dirname(dirname(fileURLToPath(import.meta.url)));

let base: string;
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'payme-ancla-'));
});
afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe('rutaContenida · el mutante que importa', () => {
  /** 🔴 MUTANTE ①: con `startsWith` esto pasaría y sería un agujero de containment. */
  it('un hermano con prefijo común NO está contenido: /repo-malicioso bajo /repo', () => {
    const raiz = join(base, 'repo');
    mkdirSync(raiz);
    mkdirSync(join(base, 'repo-malicioso'));
    expect(rutaContenida(raiz, join(base, 'repo-malicioso'))).toBe(false);
    expect(rutaContenida(raiz, join(base, 'repo-malicioso', 'x', 'y'))).toBe(false);
  });

  /** 🔴 MUTANTE ②: si sólo se hace realpath del candidato, esto da false y rompe el gate. */
  it('con symlinks en el medio sigue viendo adentro lo que está adentro', () => {
    const raiz = join(base, 'repo');
    mkdirSync(join(raiz, 'test-results'), { recursive: true });
    // `base` cuelga de tmpdir(), que en macOS ya es un symlink: la raíz sin resolver y el
    // candidato resuelto viven en prefijos distintos.
    expect(base).not.toBe(realpathSync(base));
    expect(rutaContenida(raiz, join(raiz, 'test-results'))).toBe(true);
    expect(rutaContenida(realpathSync(raiz), join(raiz, 'test-results'))).toBe(true);
    expect(rutaContenida(raiz, realpathSync(join(raiz, 'test-results')))).toBe(true);
  });

  it('un `..` que se escapa queda afuera', () => {
    const raiz = join(base, 'repo');
    mkdirSync(raiz);
    expect(rutaContenida(raiz, join(raiz, '..', 'otro'))).toBe(false);
    expect(rutaContenida(raiz, join(raiz, 'a', '..', '..', 'otro'))).toBe(false);
  });

  /**
   * 🔴 EL MUTANTE DEL ÍTEM 12. ✅ **Corrido: 34/34 verde**, última medición sobre `0071671b`
   * dentro de la suite completa del 2026-09-12T00:14Z (140 archivos · 2475 passed · 2 skipped,
   * `c26/paso-06-p2.log`). El rótulo `ESCRITO_SIN_EJECUTAR` que estaba acá era cierto bajo su
   * condición —la fase prohibía ejecutar— y dejó de serlo cuando la fase cambió; se reemplaza
   * por la medición en vez de conservarse, porque un «no se ejecutó» junto a un caso que lleva
   * corriendo verde desde hace horas se lee como una advertencia vigente y no lo es.
   *
   * Con `startsWith('..')` —lo que había
   * hasta P3— un directorio llamado `..foo` se declaraba AFUERA, y es un hijo legítimo.
   *
   * Fallaba del lado cerrado, así que no era un agujero de seguridad: era **incorrecto**. Y
   * eso tiene su propio costo — un gate que rechaza rutas válidas por una razón inventada
   * gasta la confianza que va a necesitar la próxima vez que rechace algo de verdad.
   */
  it('un hijo cuyo nombre EMPIEZA con dos puntos está adentro', () => {
    const raiz = join(base, 'repo');
    mkdirSync(join(raiz, '..foo', 'bar'), { recursive: true });
    expect(rutaContenida(raiz, join(raiz, '..foo'))).toBe(true);
    expect(rutaContenida(raiz, join(raiz, '..foo', 'bar'))).toBe(true);
  });

  /** El predicado canónico, probado solo: es el que importan extractor y reporter. */
  it('relativoEscapa distingue el ascenso real del nombre que lo parece', () => {
    expect(relativoEscapa('..')).toBe(true);
    expect(relativoEscapa(`..${sep}otro`)).toBe(true);
    expect(relativoEscapa('/absoluta')).toBe(true);
    expect(relativoEscapa('..foo')).toBe(false);
    expect(relativoEscapa('...tres')).toBe(false);
    expect(relativoEscapa('')).toBe(false);
    expect(relativoEscapa(join('a', 'b'))).toBe(false);
  });

  it('lo hondo adentro sigue adentro', () => {
    const raiz = join(base, 'repo');
    mkdirSync(join(raiz, 'a', 'b', 'c'), { recursive: true });
    expect(rutaContenida(raiz, join(raiz, 'a', 'b', 'c'))).toBe(true);
  });

  /** Para una guarda de borrado, «el candidato es la raíz entera» es el caso a frenar. */
  it('la raíz no se contiene a sí misma salvo que se pida explícitamente', () => {
    const raiz = join(base, 'repo');
    mkdirSync(raiz);
    expect(rutaContenida(raiz, raiz)).toBe(false);
    expect(rutaContenida(raiz, raiz, { permitirIgual: true })).toBe(true);
  });

  /** El gate ancla `test-results/` ANTES de crearlo: sin esto, no se puede. */
  it('una ruta que todavía no existe se puede anclar igual', () => {
    const raiz = join(base, 'repo');
    mkdirSync(raiz);
    const futuro = join(raiz, 'test-results', 'todavia', 'no');
    expect(rutaContenida(raiz, futuro)).toBe(true);
    expect(rutaContenida(raiz, join(base, 'afuera', 'todavia', 'no'))).toBe(false);
  });

  it('exigirContenida lanza con el nombre de lo que se anclaba, y devuelve la ruta real', () => {
    const raiz = join(base, 'repo');
    mkdirSync(join(raiz, 'dentro'), { recursive: true });
    expect(() => exigirContenida(raiz, join(base, 'afuera'), 'el CLI')).toThrow(/ANCLA_FUERA_DEL_ARBOL.*el CLI/s);
    expect(exigirContenida(raiz, join(raiz, 'dentro'), 'algo')).toBe(realpathSync(join(raiz, 'dentro')));
  });
});

describe('realpathTolerante', () => {
  it('resuelve el ancestro existente y reanexa lo que falta', () => {
    const real = realpathSync(base);
    expect(realpathTolerante(join(base, 'no', 'existe'))).toBe(join(real, 'no', 'existe'));
  });

  /**
   * 🔴 En la raíz del filesystem `dirname('/')` devuelve `'/'`: sin la condición de parada
   * esto no termina. El test existe porque un bucle infinito en un gate no se ve como bug,
   * se ve como «el gate está lento».
   */
  it('termina aunque nada de la ruta exista hasta la raíz del filesystem', () => {
    expect(realpathTolerante('/payme-no-existe-jamas/a/b/c')).toBe('/payme-no-existe-jamas/a/b/c');
  });
});

describe('versionEnLock · sobre el lock REAL de este repo', () => {
  it('devuelve la versión que el lock declara', () => {
    expect(versionEnLock(RAIZ_DEL_REPO, 'vite')).toMatch(/^\d+\.\d+\.\d+/);
    expect(versionEnLock(RAIZ_DEL_REPO, 'playwright-core')).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('un paquete que el lock no declara LANZA, no devuelve null', () => {
    expect(() => versionEnLock(RAIZ_DEL_REPO, 'paquete-que-no-existe-payme')).toThrow(/ANCLA_LOCK_SIN_ENTRADA/);
  });

  it('un lock sin `packages` lanza FORMATO_INESPERADO en vez de adivinar', () => {
    writeFileSync(join(base, 'package-lock.json'), JSON.stringify({ lockfileVersion: 1, dependencies: {} }));
    expect(() => versionEnLock(base, 'vite')).toThrow(/ANCLA_LOCK_FORMATO_INESPERADO/);
  });

  it('sin lock, lanza AUSENTE', () => {
    expect(() => versionEnLock(base, 'vite')).toThrow(/ANCLA_LOCK_AUSENTE/);
  });

  it('un lock ilegible lanza ILEGIBLE, no se traga el error', () => {
    writeFileSync(join(base, 'package-lock.json'), '{ esto no es json');
    expect(() => versionEnLock(base, 'vite')).toThrow(/ANCLA_LOCK_ILEGIBLE/);
  });
});

describe('resolverPaqueteLocal · contra el árbol REAL', () => {
  it('ancla vite y playwright-core dentro del worktree, con la versión del lock', () => {
    for (const paquete of ['vite', 'playwright-core']) {
      const r = resolverPaqueteLocal({ raiz: RAIZ_DEL_REPO, desde: import.meta.url, paquete });
      expect(r.version).toBe(r.versionEnLock);
      expect(rutaContenida(RAIZ_DEL_REPO, r.dir)).toBe(true);
      expect(r.dir).toContain('node_modules');
    }
  });

  it('un paquete inexistente lanza RESOLUCION_FALLIDA y nombra el npm ci', () => {
    expect(() =>
      resolverPaqueteLocal({ raiz: RAIZ_DEL_REPO, desde: import.meta.url, paquete: 'payme-paquete-inexistente-2026' }),
    ).toThrow(/ANCLA_RESOLUCION_FALLIDA.*npm ci/s);
  });

  /**
   * 🔴 MUTANTE: la versión declarada del paquete instalado no es la que el lock fija. Se arma un
   * árbol sintético porque
   * desalinear el real sería romper el repo para probar una comprobación.
   */
  it('si la versión instalada difiere del lock, LANZA', () => {
    const raiz = join(base, 'arbol');
    const pkgDir = join(raiz, 'node_modules', 'paquete-x');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: 'paquete-x', version: '9.9.9' }));
    writeFileSync(join(pkgDir, 'index.js'), '');
    writeFileSync(
      join(raiz, 'package-lock.json'),
      JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/paquete-x': { version: '1.0.0' } } }),
    );
    const consumidor = join(raiz, 'consumidor.mjs');
    writeFileSync(consumidor, '');

    expect(() =>
      resolverPaqueteLocal({ raiz, desde: pathToFileURL(consumidor).href, paquete: 'paquete-x' }),
    ).toThrow(/ANCLA_VERSION_DISTINTA_DEL_LOCK.*9\.9\.9.*1\.0\.0/s);
  });

  it('y si coinciden, no lanza', () => {
    const raiz = join(base, 'arbol');
    const pkgDir = join(raiz, 'node_modules', 'paquete-x');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: 'paquete-x', version: '1.0.0' }));
    writeFileSync(
      join(raiz, 'package-lock.json'),
      JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/paquete-x': { version: '1.0.0' } } }),
    );
    const consumidor = join(raiz, 'consumidor.mjs');
    writeFileSync(consumidor, '');
    const r = resolverPaqueteLocal({ raiz, desde: pathToFileURL(consumidor).href, paquete: 'paquete-x' });
    expect(r.version).toBe('1.0.0');
  });
});

describe('entrypointLocal', () => {
  it('ancla el bin real de vite dentro del árbol', () => {
    const { ruta, version } = entrypointLocal({
      raiz: RAIZ_DEL_REPO,
      desde: import.meta.url,
      paquete: 'vite',
      subruta: join('bin', 'vite.js'),
    });
    expect(ruta.endsWith(join('bin', 'vite.js'))).toBe(true);
    expect(rutaContenida(RAIZ_DEL_REPO, ruta)).toBe(true);
    expect(version).toBe(versionEnLock(RAIZ_DEL_REPO, 'vite'));
  });

  /** «No encontré el entrypoint» nunca puede degradar a «no vi nada raro». */
  it('una subruta que no existe LANZA en vez de devolver la ruta', () => {
    expect(() =>
      entrypointLocal({ raiz: RAIZ_DEL_REPO, desde: import.meta.url, paquete: 'vite', subruta: 'bin/no-existe.js' }),
    ).toThrow(/ANCLA_ENTRYPOINT_AUSENTE/);
  });

  /** 🔴 Una subruta con `..` no puede sacarnos del paquete ni del árbol. */
  it('una subruta que se escapa del árbol LANZA FUERA_DEL_ARBOL', () => {
    expect(() =>
      entrypointLocal({
        raiz: RAIZ_DEL_REPO,
        desde: import.meta.url,
        paquete: 'vite',
        subruta: join('..', '..', '..', '..', '..', '..', 'etc', 'passwd'),
      }),
    ).toThrow(/ANCLA_FUERA_DEL_ARBOL/);
  });
});

describe('envSaneado', () => {
  it('retira lo que inyecta código y lo que redirige tráfico, y no muta el original', () => {
    const original = {
      NODE_OPTIONS: '--require /tmp/payload.js',
      BASH_ENV: '/tmp/rc.sh',
      HTTPS_PROXY: 'http://usuario:secreto@proxy.local:8080',
      PW_TEST_SOURCE_TRANSFORM: '/tmp/t.js',
      PATH: '/usr/bin',
      HOME: '/Users/x',
    };
    const copia = { ...original };
    const r = envSaneado(original);

    expect(r.env['NODE_OPTIONS']).toBeUndefined();
    expect(r.env['BASH_ENV']).toBeUndefined();
    expect(r.env['HTTPS_PROXY']).toBeUndefined();
    expect(r.env['PW_TEST_SOURCE_TRANSFORM']).toBeUndefined();
    expect(r.env['PATH']).toBe('/usr/bin');
    expect(r.env['HOME']).toBe('/Users/x');
    expect([...r.retiradas].sort()).toEqual(['BASH_ENV', 'HTTPS_PROXY', 'NODE_OPTIONS', 'PW_TEST_SOURCE_TRANSFORM']);
    expect(original).toEqual(copia);
  });

  /** 🔴 El informe dice NOMBRES, jamás valores: un proxy trae credenciales en el userinfo. */
  it('el informe no arrastra el valor del proxy', () => {
    const r = envSaneado({ HTTPS_PROXY: 'http://u:clave-secretisima@proxy:8080' });
    expect(JSON.stringify(r.retiradas)).not.toContain('clave-secretisima');
    expect(JSON.stringify(r.retiradas)).not.toContain('proxy:8080');
    expect(JSON.stringify(r.declaradas_presentes)).not.toContain('clave-secretisima');
  });

  it('las minúsculas de los proxies también se retiran: el shell respeta las dos formas', () => {
    const r = envSaneado({ http_proxy: 'x', https_proxy: 'y', no_proxy: 'z' });
    expect(Object.keys(r.env)).toHaveLength(0);
    expect([...r.retiradas].sort()).toEqual(['http_proxy', 'https_proxy', 'no_proxy']);
  });

  it('un entorno limpio no reporta nada retirado', () => {
    const r = envSaneado({ PATH: '/usr/bin' });
    expect(r.retiradas).toEqual([]);
    expect(r.declaradas_presentes).toEqual([]);
  });

  it('lo que se declara pero no se retira aparece como declarado y SIGUE en el entorno', () => {
    const r = envSaneado({ PLAYWRIGHT_BROWSERS_PATH: '/opt/navegadores' });
    expect(r.retiradas).toEqual([]);
    expect(r.declaradas_presentes).toEqual(['PLAYWRIGHT_BROWSERS_PATH']);
    expect(r.env['PLAYWRIGHT_BROWSERS_PATH']).toBe('/opt/navegadores');
  });

  it('las dos listas son disjuntas: ninguna variable se retira y se declara a la vez', () => {
    expect(ENV_RETIRADAS.filter((k) => ENV_DECLARADAS.includes(k))).toEqual([]);
  });
});

describe('censarDirectorio · mirar antes de destruir', () => {
  it('un directorio inexistente se declara inexistente, no vacío', () => {
    const c = censarDirectorio(join(base, 'no-existe'));
    expect(c.existe).toBe(false);
    expect(c.cantidad).toBe(0);
  });

  /** 🔴 «No existe» y «existe y está vacío» NO son lo mismo para una guarda de borrado. */
  it('un directorio vacío existe y tiene cero archivos', () => {
    const d = join(base, 'vacio');
    mkdirSync(d);
    const c = censarDirectorio(d);
    expect(c.existe).toBe(true);
    expect(c.cantidad).toBe(0);
  });

  it('cuenta recursivo, suma bytes y ordena', () => {
    const d = join(base, 'salida');
    mkdirSync(join(d, 'a', 'b'), { recursive: true });
    writeFileSync(join(d, 'z.txt'), 'xxxxx');
    writeFileSync(join(d, 'a', 'b', 'trace.zip'), 'yy');
    const c = censarDirectorio(d);
    expect(c.cantidad).toBe(2);
    expect(c.bytes).toBe(7);
    expect(c.archivos.map((a) => a.rel)).toEqual([join('a', 'b', 'trace.zip'), 'z.txt']);
  });

  it('con más entradas que el tope, `cantidad` sigue siendo el total real', () => {
    const d = join(base, 'muchos');
    mkdirSync(d);
    for (let i = 0; i < 12; i += 1) writeFileSync(join(d, `f${i}.txt`), 'x');
    const c = censarDirectorio(d, { tope: 5 });
    expect(c.cantidad).toBe(12);
    expect(c.truncado).toBe(true);
    expect(c.archivos).toHaveLength(5);
  });

  /** 🔴 Un symlink hacia afuera haría que el censo describa bytes de otro árbol. */
  it('no sigue symlinks: los reporta como enlace y no entra', () => {
    const d = join(base, 'consimbolo');
    const afuera = join(base, 'afuera');
    mkdirSync(d);
    mkdirSync(afuera);
    writeFileSync(join(afuera, 'ajeno.zip'), 'xxxxxxxxxx');
    symlinkSync(afuera, join(d, 'enlace'));
    const c = censarDirectorio(d);
    expect(c.cantidad).toBe(1);
    expect(c.archivos[0]!.rel).toBe('enlace');
    expect(c.archivos[0]!.symlink).toBe(true);
    expect(c.bytes).toBe(0);
    expect(c.archivos.map((a) => a.rel)).not.toContain(join('enlace', 'ajeno.zip'));
  });
});
