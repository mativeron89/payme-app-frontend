import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * ✅ **Corrido: 21/21 verde (1 skip declarado) el 2026-09-11T17:17Z.**
 *
 * 🔴 Dos casos se pusieron rojos al correr por primera vez, y los dos eran míos: uno esperaba
 * `exit 10` donde la identidad de raíz ya salía con `6` —había escrito la comprobación dos
 * veces— y el otro afirmaba sobre una **ruta absoluta** que el ítem 6 dejó de publicar, o sea
 * que la redacción se llevó puesto al discriminador de la prueba. El reemplazo no afloja la
 * aserción: pone artefactos con NOMBRES distintos en las dos raíces.
 *
 * ⚠️ Y una dependencia del entorno que conviene saber antes de leer un rojo: el preflight
 * comprueba que el **5176 esté libre**, así que estos casos fallan si hay algo escuchando ahí.
 * Es la conducta correcta del gate —adoptar un servidor ajeno fue un hallazgo real— pero acopla
 * la suite a la máquina, y eso se dice en vez de descubrirse.
 *
 * EL GATE, EN CAJA NEGRA — Y SU LÍMITE, DECLARADO ARRIBA DE TODO.
 *
 * 🔴 **LÍMITE DEL ARCHIVO, fijado antes de escribirlo y ratificado por el Bibliotecario:
 * este test ejercita ÚNICAMENTE los caminos que fallan cerrado ANTES del `spawnSync` del
 * runner. Ninguno de sus casos puede alcanzar el lanzamiento de Playwright.**
 *
 * El motivo no es estético. `gate-origen.mjs` corrido de verdad **arranca el E2E**, y el E2E
 * está prohibido sin un egress-deny previo al lanzamiento: un detector post hoc mide después
 * de que el tráfico salió, no lo contiene. Un test que «casualmente» llegue al spawn estaría
 * corriendo lo que la orden prohíbe, y lo haría sin que nadie lo mirara.
 *
 * ⚠️ **Lo que este límite deja sin cubrir, dicho acá y no escondido:** el camino de aceptación
 * de `--descartar-salida-previa`, el saneado efectivo del entorno del hijo, el `cwd` con el
 * que se lanza, y que las banderas propias del gate no viajen al runner. Los cuatro viven
 * después del spawn. Quedan declarados como hueco, no como cubiertos.
 *
 * ## Cómo se ejercita sin tocar el árbol real
 *
 * `RAIZ` sale de la ubicación del propio script, así que los `scripts/*.mjs` se copian a un
 * árbol temporal con un `package.json`, un `playwright.config.ts` y un `node_modules`
 * sintéticos. Misma convención que `verificar-mirror.test.ts`. Así el gate cree estar en un
 * repo y **no hay Playwright real que pueda arrancar**: la prohibición no depende de que los
 * casos estén bien elegidos, depende de que en ese árbol no exista el runner.
 *
 * 🔴 **Y el canario está VERIFICADO, no supuesto.** Sonda del 2026-09-11 sobre un árbol
 * sintético: con la guarda del censo viva, `RC=9` y el canario NO aparece; con la guarda
 * anulada, `RC=66`, el canario aparece **y el `previo.zip` desaparece** — la reproducción
 * fiel de INC-08. Un detector que nunca se vio disparar no es un detector, es un adorno que
 * tranquiliza.
 */

const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const NODE = process.execPath;

/** Entorno mínimo y saneado para el hijo: el gate no puede depender de lo que herede. */
const ENV_LIMPIO: NodeJS.ProcessEnv = { PATH: '/usr/bin:/bin', HOME: process.env['HOME'] ?? '/tmp' };

let raiz: string;

/**
 * Arma el árbol sintético. **Por defecto está COMPLETO**: con CLI, con perfil de deny y con
 * un Vite sintético, de modo que el preflight pase y cada caso pueda quitar exactamente UNA
 * pieza. Un fixture al que le faltan tres cosas a la vez no discrimina cuál lo hizo fallar —
 * y ese defecto ya me costó una vuelta entera comparando dos arranques que diferían en dos
 * variables.
 */
function armarArbol({
  conCli = true,
  nombre = 'payme-app-frontend',
  conPerfil = true,
  conVite = true,
  versionViteEnLock = '5.4.21',
} = {}): void {
  mkdirSync(join(raiz, 'scripts'), { recursive: true });
  for (const f of readdirSync(SCRIPTS)) {
    if (f.endsWith('.mjs')) copyFileSync(join(SCRIPTS, f), join(raiz, 'scripts', f));
  }
  if (conPerfil) copyFileSync(join(SCRIPTS, 'deny-egress.sb'), join(raiz, 'scripts', 'deny-egress.sb'));
  writeFileSync(join(raiz, 'package.json'), JSON.stringify({ name: nombre, version: '0.0.0' }));
  writeFileSync(join(raiz, 'playwright.config.ts'), '// sintético\n');

  const pw = join(raiz, 'node_modules', '@playwright', 'test');
  if (conCli) {
    mkdirSync(pw, { recursive: true });
    writeFileSync(join(pw, 'package.json'), JSON.stringify({ name: '@playwright/test', version: '1.62.1' }));
    // 🔴 CANARIO, no un runner. Si alguna vez la ejecución llegara hasta acá, deja rastro y
    // el caso se pone rojo con diagnóstico, en vez de arrancar algo de verdad.
    writeFileSync(join(pw, 'cli.js'), `require('fs').writeFileSync(${JSON.stringify(join(raiz, 'CANARIO'))}, 'EL SPAWN SE ALCANZO');\nprocess.exit(66);\n`);
  }

  // Vite sintético: existe para que el preflight pueda PASAR. Nunca se ejecuta.
  if (conVite) {
    const vite = join(raiz, 'node_modules', 'vite');
    mkdirSync(join(vite, 'bin'), { recursive: true });
    writeFileSync(join(vite, 'package.json'), JSON.stringify({ name: 'vite', version: '5.4.21' }));
    writeFileSync(join(vite, 'bin', 'vite.js'), '// sintético: nunca se ejecuta en estos casos\n');
  }

  writeFileSync(
    join(raiz, 'package-lock.json'),
    JSON.stringify({
      lockfileVersion: 3,
      packages: {
        'node_modules/@playwright/test': { version: '1.62.1' },
        'node_modules/vite': { version: versionViteEnLock },
      },
    }),
  );
}

/**
 * 🔴 El guardián del límite NO es algo que cada caso deba acordarse de llamar: lo aplica el
 * propio helper, antes de devolver nada. Una invariante que depende de que el autor del
 * próximo test la invoque es mantenimiento disfrazado de garantía — y la primera vez que
 * alguien la olvide, el archivo estará corriendo justo lo que declara no correr.
 *
 * Va PRIMERO, antes que cualquier aserción de status: si la ejecución llegó al spawn, el
 * diagnóstico correcto es «se alcanzó el spawn», no «esperaba 9 y recibí 66».
 */
function exigirQueNoSeLanzoNada(): void {
  expect(
    existsSync(join(raiz, 'CANARIO')),
    'el gate alcanzó el spawnSync del runner: este archivo declara que ningún caso puede llegar ahí',
  ).toBe(false);
}

function correrGate(args: readonly string[] = []): { status: number | null; stderr: string; stdout: string } {
  const r = spawnSync(NODE, [join(raiz, 'scripts', 'gate-origen.mjs'), ...args], {
    encoding: 'utf8',
    env: ENV_LIMPIO,
    cwd: raiz,
    timeout: 20_000,
  });
  exigirQueNoSeLanzoNada();
  return { status: r.status, stderr: r.stderr ?? '', stdout: r.stdout ?? '' };
}

beforeEach(() => {
  raiz = mkdtempSync(join(tmpdir(), 'payme-gate-'));
});
afterEach(() => {
  rmSync(raiz, { recursive: true, force: true });
});

describe('validación de argumentos · fail-closed antes de todo', () => {
  it.each([
    ['--output', ['--output', '/tmp/otro'], /desacoplar/],
    ['--trace', ['--trace', 'off'], /desacoplar/],
    ['--reporter', ['--reporter', 'dot'], /desacoplar/],
    ['--config', ['--config', 'otro.ts'], /desacoplar/],
  ])('rechaza «%s» con exit 2', (_n, args, patron) => {
    armarArbol();
    const r = correrGate(args);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(patron);
  });

  it('una opción no declarada se rechaza (fail-closed, no allowlist abierta)', () => {
    armarArbol();
    const r = correrGate(['--inventada']);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/no está en la lista de opciones permitidas/);
  });

  it('una opción con valor faltante no consume el argumento siguiente', () => {
    armarArbol();
    const r = correrGate(['--grep']);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/viene sin valor/);
  });

  it('un «valor» que empieza con «-» es una opción camuflada y se rechaza', () => {
    armarArbol();
    const r = correrGate(['--grep', '--output']);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/opcion camuflada/);
  });
});

describe('anclaje de la raíz y del runner', () => {
  it('sin el CLI local, falla cerrado con exit 5 y nombra que no sale por PATH ni npx', () => {
    armarArbol({ conCli: false });
    const r = correrGate();
    expect(r.status).toBe(5);
    expect(r.stderr).toMatch(/no pude anclar el CLI local/);
  });

  /** 🔴 Un `rm -rf` que confía en una ruta calculada es cómo se pierde evidencia. */
  it('si la raíz derivada no es este repo, no borra nada y sale con 6', () => {
    armarArbol({ nombre: 'otro-repo-cualquiera' });
    mkdirSync(join(raiz, 'test-results'), { recursive: true });
    writeFileSync(join(raiz, 'test-results', 'no-tocar.zip'), 'evidencia ajena');
    const r = correrGate();
    expect(r.status).toBe(6);
    expect(r.stderr).toMatch(/No borro nada/);
    expect(existsSync(join(raiz, 'test-results', 'no-tocar.zip'))).toBe(true);
  });

  it('el árbol sintético tiene la versión del lock: un desajuste lo haría fallar al anclar', () => {
    armarArbol();
    writeFileSync(
      join(raiz, 'package-lock.json'),
      JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/@playwright/test': { version: '9.9.9' } } }),
    );
    const r = correrGate();
    expect(r.status).toBe(5);
    expect(r.stderr).toMatch(/ANCLA_VERSION_DISTINTA_DEL_LOCK/);
  });
});

describe('🔴 censo previo al borrado · la clase de INC-08', () => {
  /**
   * El corazón del ítem: una corrida previa no inventariada NO se destruye. INC-08 no fue
   * sólo un problema de orden —eso ya estaba arreglado—: era que `rmSync` borraba sin mirar.
   */
  it('con artefactos previos, se detiene con exit 9 y NO los borra', () => {
    armarArbol();
    const salida = join(raiz, 'test-results');
    mkdirSync(join(salida, 'un-test'), { recursive: true });
    writeFileSync(join(salida, 'un-test', 'trace.zip'), 'traza de una corrida ya hecha');
    writeFileSync(join(salida, 'otro.json'), '{}');

    const r = correrGate();
    expect(r.status).toBe(9);
    expect(r.stderr).toMatch(/nadie los inventario/);
    expect(r.stderr).toMatch(/--descartar-salida-previa/);
    // Lo que importa no es el mensaje: es que los bytes sigan estando.
    expect(existsSync(join(salida, 'un-test', 'trace.zip'))).toBe(true);
    expect(existsSync(join(salida, 'otro.json'))).toBe(true);
  });

  it('los lista uno por uno, para que se sepa qué se estaba por perder', () => {
    armarArbol();
    const salida = join(raiz, 'test-results');
    mkdirSync(salida, { recursive: true });
    writeFileSync(join(salida, 'a.zip'), 'xx');
    writeFileSync(join(salida, 'b.zip'), 'yyy');
    const r = correrGate();
    expect(r.status).toBe(9);
    expect(r.stderr).toContain('a.zip');
    expect(r.stderr).toContain('b.zip');
    expect(r.stderr).toMatch(/2 archivo\(s\)/);
  });

  /**
   * ⚠️ El caso complementario —con `--descartar-salida-previa` el gate SIGUE— no se cubre acá
   * a propósito: seguir significa llegar al `spawnSync`, y este archivo declara que ningún
   * caso llega ahí. Queda como hueco declarado, no como cubierto.
   */
  it.skip('DECLARADO SIN CUBRIR: --descartar-salida-previa deja seguir (vive después del spawn)', () => {});
});

describe('el gate no depende del cwd de quien lo invoca', () => {
  it('corrido desde otro directorio, sigue midiendo su propia raíz', () => {
    armarArbol();
    const salida = join(raiz, 'test-results');
    mkdirSync(salida, { recursive: true });
    writeFileSync(join(salida, 'de-la-raiz-del-gate.zip'), 'x');

    const otro = mkdtempSync(join(tmpdir(), 'payme-cwd-'));
    // Un `test-results` señuelo en el cwd ajeno, con OTRO nombre de archivo: si el gate
    // midiera el cwd en vez de su raíz, nombraría éste.
    mkdirSync(join(otro, 'test-results'), { recursive: true });
    writeFileSync(join(otro, 'test-results', 'del-cwd-ajeno.zip'), 'y');
    try {
      const r = spawnSync(NODE, [join(raiz, 'scripts', 'gate-origen.mjs')], {
        encoding: 'utf8',
        env: ENV_LIMPIO,
        cwd: otro, // 🔴 invocado desde afuera
        timeout: 20_000,
      });
      /**
       * 🔴 EL DISCRIMINADOR CAMBIÓ, Y EL CAMBIO LO FORZÓ EL ÍTEM 6.
       *
       * Antes este caso probaba «mide su raíz y no el cwd» comparando la **ruta absoluta**
       * impresa. Esa ruta ya no se publica —una absoluta filtra usuario, disco y proyecto—,
       * así que la prueba se quedó sin su evidencia. Fue el propio test el que lo mostró al
       * correr: la redacción se llevó puesto al discriminador.
       *
       * El reemplazo no es aflojar la aserción: es poner artefactos DISTINTOS en las dos
       * raíces y exigir que nombre el de la suya. Con la ruta relativa sola no alcanzaría
       * —ambas se llamarían `test-results`—; con nombres distintos, sí discrimina.
       */
      expect(r.status).toBe(9);
      expect(r.stderr).toContain('de-la-raiz-del-gate.zip');
      expect(r.stderr).not.toContain('del-cwd-ajeno.zip');
      expect(existsSync(join(salida, 'de-la-raiz-del-gate.zip'))).toBe(true);
      // Este caso no pasa por `correrGate` —necesita otro `cwd`—, así que invoca el
      // guardián explícitamente. Es la única excepción, y por eso está dicha.
      exigirQueNoSeLanzoNada();
    } finally {
      rmSync(otro, { recursive: true, force: true });
    }
  });
});

/**
 * 🔴 PREFLIGHT · ítems 1, 7 y 8 (ESCRITOS_SIN_EJECUTAR).
 *
 * El preflight corre ANTES de cualquier limpieza. Antes de P3 el gate anclaba el CLI y
 * validaba la raíz, y **después borraba**: si faltaba la config, si Vite no resolvía o si el
 * puerto estaba ocupado, la limpieza ya se había llevado la corrida anterior y recién entonces
 * se descubría que no se podía correr. Destruir primero y averiguar después es la forma
 * general de INC-08, no su instancia.
 *
 * Todos estos casos terminan ANTES del `spawnSync`, así que el canario sigue sin dispararse —
 * lo aplica `correrGate` y no cada caso.
 */
describe('preflight · nada se destruye ni se lanza si algo falta', () => {
  /** 🔴 El fail-closed central: sin perfil de deny NO se lanza el E2E. */
  it('sin scripts/deny-egress.sb, el gate NO lanza y lo dice', () => {
    armarArbol({ conPerfil: false });
    const r = correrGate();
    expect(r.status).toBe(10);
    expect(r.stderr).toMatch(/preflight/);
    expect(r.stderr).toMatch(/deny-egress\.sb/);
  });

  /** Y no borra: el preflight es anterior a la limpieza, no simultáneo. */
  it('cuando el preflight falla, los artefactos previos siguen ahí', () => {
    armarArbol({ conPerfil: false });
    const salida = join(raiz, 'test-results');
    mkdirSync(join(salida, 'un-test'), { recursive: true });
    writeFileSync(join(salida, 'un-test', 'trace.zip'), 'traza de una corrida ya hecha');
    const r = correrGate();
    expect(r.status).toBe(10);
    expect(existsSync(join(salida, 'un-test', 'trace.zip'))).toBe(true);
  });

  /**
   * 🔴 Sale con **6**, no con 10, y el número importa: la falta de `playwright.config.ts` la
   * caza `validarIdentidadDeRaiz`, que corre ANTES del preflight. Escribí la comprobación dos
   * veces y este caso lo mostró al correr. El arreglo fue **sacar la duplicada**, no alinear
   * el número esperado: una rama inalcanzable es código que nadie prueba y que el próximo
   * lector va a creer que corre.
   */
  it('sin playwright.config.ts, la identidad de raíz lo caza antes del preflight (exit 6)', () => {
    armarArbol();
    rmSync(join(raiz, 'playwright.config.ts'));
    const r = correrGate();
    expect(r.status).toBe(6);
    expect(r.stderr).toMatch(/playwright\.config\.ts/);
    expect(r.stderr).toMatch(/No borro nada/);
  });

  /** Una pieza por caso: acá sólo falta Vite, y el diagnóstico tiene que nombrarlo a él. */
  it('si Vite no ancla, el preflight lo denuncia y no sigue', () => {
    armarArbol({ conVite: false });
    const r = correrGate();
    expect(r.status).toBe(10);
    expect(r.stderr).toMatch(/Vite no ancla/);
  });

  /**
   * 🔴 Vite instalado pero DERIVADO del lock. Es el caso silencioso: el binario está, arranca,
   * y sirve un código que nadie fijó. Medir contra eso da un verde que no dice nada del commit.
   */
  it('si la versión de Vite no coincide con el lock, el preflight falla', () => {
    armarArbol({ versionViteEnLock: '9.9.9' });
    const r = correrGate();
    expect(r.status).toBe(10);
    expect(r.stderr).toMatch(/ANCLA_VERSION_DISTINTA_DEL_LOCK/);
  });

  /**
   * 🔴 El puerto ocupado importa por una razón medida, no por prolijidad: con
   * `reuseExistingServer` activo Playwright **adopta cualquier servidor que encuentre** en el
   * puerto, aunque sea de otro árbol — corrió specs de un commit contra el build de otro y
   * salió verde. Acá `strictPort` hace fallar el arranque, y el preflight lo dice antes.
   */
  it('con el 5176 ocupado, el preflight lo denuncia', async () => {
    armarArbol({ conPerfil: true });
    const ocupante = createServer();
    await new Promise<void>((listo) => ocupante.listen(5176, '127.0.0.1', () => listo()));
    try {
      const r = correrGate();
      expect(r.status).toBe(10);
      expect(r.stderr).toMatch(/5176/);
    } finally {
      await new Promise<void>((listo) => ocupante.close(() => listo()));
    }
  });
});

describe('el binario que corre es el de este árbol', () => {
  /** No es un test del gate sino del entorno en el que se afirma: sin esto, nada se sostiene. */
  it('el node que ejecuta los casos es process.execPath, no uno del PATH', () => {
    const v = execFileSync(NODE, ['-v'], { encoding: 'utf8', env: ENV_LIMPIO }).trim();
    expect(v).toBe(process.version);
  });
});
