import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..');
const SCRIPT = join(AQUI, 'auditar-secretos.sh');
const temporales: string[] = [];

function git(dir: string, ...args: string[]): string {
  const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  expect(result.status, `${result.stderr}\n${result.stdout}`).toBe(0);
  return result.stdout.trim();
}

function repoConCambio(lineaAgregada: string): { dir: string; base: string } {
  const dir = mkdtempSync(join(tmpdir(), 'payme-secret-gate-'));
  temporales.push(dir);
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  mkdirSync(join(dir, 'src'), { recursive: true });
  copyFileSync(SCRIPT, join(dir, 'scripts', 'auditar-secretos.sh'));
  writeFileSync(join(dir, 'README.md'), 'baseline\n');
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'probe@payme.invalid');
  git(dir, 'config', 'user.name', 'PayMe probe');
  git(dir, 'add', '--', 'README.md', 'scripts/auditar-secretos.sh');
  git(dir, 'commit', '-qm', 'baseline');
  const base = git(dir, 'rev-parse', 'HEAD');
  writeFileSync(join(dir, 'src', 'probe.tsx'), `${lineaAgregada}\n`);
  git(dir, 'add', '--', 'src/probe.tsx');
  git(dir, 'commit', '-qm', 'cambio');
  return { dir, base };
}

function repoConArchivos(archivos: Record<string, string>): { dir: string; base: string } {
  const dir = mkdtempSync(join(tmpdir(), 'payme-secret-fixtures-'));
  temporales.push(dir);
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  copyFileSync(SCRIPT, join(dir, 'scripts', 'auditar-secretos.sh'));
  writeFileSync(join(dir, '.keep'), 'baseline\n');
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'probe@payme.invalid');
  git(dir, 'config', 'user.name', 'PayMe probe');
  git(dir, 'add', '--', '.keep', 'scripts/auditar-secretos.sh');
  git(dir, 'commit', '-qm', 'baseline');
  const base = git(dir, 'rev-parse', 'HEAD');
  for (const [ruta, contenido] of Object.entries(archivos)) {
    const destino = join(dir, ruta);
    mkdirSync(dirname(destino), { recursive: true });
    writeFileSync(destino, contenido);
  }
  git(dir, 'add', '--', ...Object.keys(archivos));
  git(dir, 'commit', '-qm', 'fixtures');
  return { dir, base };
}

afterEach(() => {
  for (const dir of temporales.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('auditoría de secretos', () => {
  const fixturePaths = [
    'src/api/mock/seedData.ts',
    'e2e/social-auth.spec.ts',
    'src/api/http.session.test.ts',
  ] as const;

  function lineasSinteticas(ruta: typeof fixturePaths[number]): string {
    const lineas = readFileSync(join(RAIZ, ruta), 'utf8').split('\n').filter((linea) =>
      linea.includes("['payme', 'mock', 'recovery', 'token'")
      || linea.includes("access_token: ['access', 'origin', 'a']")
      || linea.includes("refresh_token: ['refresh', 'origin', 'a']"));
    expect(lineas.length, `no se encontró el fixture sintético en ${ruta}`).toBeGreaterThan(0);
    return `${lineas.join('\n')}\n`;
  }

  it('los tres fixtures reales usan composición sintética y el gate los acepta juntos', () => {
    const archivos = Object.fromEntries(
      fixturePaths.map((ruta) => [ruta, lineasSinteticas(ruta)]),
    );
    const { dir, base } = repoConArchivos(archivos);
    const result = spawnSync('bash', ['scripts/auditar-secretos.sh', base], {
      cwd: dir,
      encoding: 'utf8',
    });

    expect(`${result.stdout}${result.stderr}`).toContain('cero valores con forma de secreto');
    expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
  });

  it.each(fixturePaths)('un secreto real vecino sigue rojo dentro de %s', (ruta) => {
    const key = ['api', 'key'].join('_');
    const value = ['valor', 'plausible', 'que', 'no', 'es', 'fixture'].join('_');
    const contenido = `${lineasSinteticas(ruta)}const ${key} = '${value}';\n`;
    const { dir, base } = repoConArchivos({ [ruta]: contenido });
    const result = spawnSync('bash', ['scripts/auditar-secretos.sh', base], {
      cwd: dir,
      encoding: 'utf8',
    });

    expect(`${result.stdout}${result.stderr}`).toContain('VALOR con forma de secreto');
    expect(result.status, `el fixture eximió un secreto vecino en ${ruta}`).toBe(1);
  });

  it('reconvertir por un carácter la composición a asignación literal no queda autorizado', () => {
    const key = ['recovery', 'token'].join('_');
    const value = ['payme', 'mock', 'recovery', 'token', '0000000000000002'].join('-');
    const { dir, base } = repoConCambio(`const ${key} = '${value}';`);
    const result = spawnSync('bash', ['scripts/auditar-secretos.sh', base], {
      cwd: dir,
      encoding: 'utf8',
    });

    expect(`${result.stdout}${result.stderr}`).toContain('VALOR con forma de secreto');
    expect(result.status, 'el valor vecino quedó permitido como familia genérica').toBe(1);
  });

  it('un password real no se vuelve benigno por usar el mismo texto que autocomplete', () => {
    // Se construye para que el instrumento pueda auditar este mismo commit sin
    // confundir el fixture del test con una credencial agregada al producto.
    const tokenHtml = ['current', 'password'].join('-');
    const linea = ['const password', ` = '${tokenHtml}';`].join('');
    const { dir, base } = repoConCambio(linea);

    const result = spawnSync('bash', ['scripts/auditar-secretos.sh', base], {
      cwd: dir,
      encoding: 'utf8',
    });

    expect(`${result.stdout}${result.stderr}`).toContain('VALOR con forma de secreto');
    expect(result.status, 'la excepción de autocomplete ocultó un password asignado').toBe(1);
  });

  it('los tokens HTML de autocomplete, por sí solos, siguen siendo benignos', () => {
    const { dir, base } = repoConCambio(
      "const input = { autoComplete: mode === 'login' ? 'current-password' : 'new-password' };",
    );

    const result = spawnSync('bash', ['scripts/auditar-secretos.sh', base], {
      cwd: dir,
      encoding: 'utf8',
    });

    expect(`${result.stdout}${result.stderr}`).toContain('cero valores con forma de secreto');
    expect(result.status).toBe(0);
  });

  it('la clave unida por guion NO queda exenta: el guion es de la clave, no del valor', () => {
    // `db-password: "…"` es de las dos formas más comunes de escribir una clave
    // en configuración. El límite izquierdo excluía TODO identificador unido por
    // `-` para dejar pasar `current-password`, y de paso dejaba pasar esto.
    // Se arma en runtime: escrito literal, el fixture sería un valor con forma
    // de secreto en el diff que este mismo gate audita.
    const clave = ['db', 'password'].join('-');
    const valor = ['valor', 'sintetico', 'largo'].join('_');
    const { dir, base } = repoConCambio(`${clave}: '${valor}'`);

    const result = spawnSync('bash', ['scripts/auditar-secretos.sh', base], {
      cwd: dir,
      encoding: 'utf8',
    });

    expect(`${result.stdout}${result.stderr}`).toContain('VALOR con forma de secreto');
    expect(result.status, `el límite por guion omitió ${clave}`).toBe(1);
  });

  it('la clave en MAYÚSCULAS conserva la guarda: la búsqueda no puede ser sensible al caso', () => {
    // `DB_PASSWORD="…"` es la forma canónica de una variable de entorno, y la
    // alternancia sólo listaba minúsculas con `grep -E`, que distingue el caso.
    const clave = ['DB', 'PASSWORD'].join('_');
    const valor = ['valor', 'sintetico', 'largo'].join('_');
    const { dir, base } = repoConCambio(`${clave}='${valor}'`);

    const result = spawnSync('bash', ['scripts/auditar-secretos.sh', base], {
      cwd: dir,
      encoding: 'utf8',
    });

    expect(`${result.stdout}${result.stderr}`).toContain('VALOR con forma de secreto');
    expect(result.status, `la búsqueda sensible al caso omitió ${clave}`).toBe(1);
  });

  it('la línea REAL de LoginScreen con autocomplete ternario sigue sin disparar', () => {
    // Caso inocente tomado de `src/screens/LoginScreen.tsx:202`, textual salvo el
    // armado en runtime. Es la ÚNICA ocurrencia de estos tokens en `src/`, y es
    // la que el límite por guion protegía: al cerrar los dos agujeros de arriba
    // hay que acreditar que ésta no se convirtió en falso positivo.
    const actual = ['current', 'password'].join('-');
    const nuevo = ['new', 'password'].join('-');
    const { dir, base } = repoConCambio(
      `          autoComplete={mode === 'login' ? '${actual}' : '${nuevo}'}`,
    );

    const result = spawnSync('bash', ['scripts/auditar-secretos.sh', base], {
      cwd: dir,
      encoding: 'utf8',
    });

    expect(`${result.stdout}${result.stderr}`).toContain('cero valores con forma de secreto');
    expect(result.status, 'cerrar los agujeros convirtió la línea real en falso positivo').toBe(0);
  });

  it('la clave ENTRE COMILLAS con forma de JSON se marca', () => {
    // El formato del artefacto que filtra de verdad: nadie pega una variable
    // suelta, pega un archivo de configuración entero. `"clave": "valor"` es
    // estructuralmente idéntico al ternario de `autocomplete`, así que acá el
    // límite izquierdo no alcanza y desempata el VALOR.
    const clave = ['db', 'password'].join('-');
    const valor = ['valor', 'sintetico', 'largo'].join('_');
    const { dir, base } = repoConCambio(`  "${clave}": "${valor}",`);

    const result = spawnSync('bash', ['scripts/auditar-secretos.sh', base], {
      cwd: dir,
      encoding: 'utf8',
    });

    expect(`${result.stdout}${result.stderr}`).toContain('VALOR con forma de secreto');
    expect(result.status, `la clave citada ${clave} pasó sin marcar`).toBe(1);
  });

  it('el desempate por valor es por COINCIDENCIA, no por línea', () => {
    // Si el token benigno eximiera la línea entera, una sola línea con el
    // ternario de `autoComplete` alcanzaría para colar un JSON con la clave
    // real al lado. Es el mismo principio que ya fija el caso de `sk_live`,
    // aplicado al desempate nuevo.
    const actual = ['current', 'password'].join('-');
    const nuevo = ['new', 'password'].join('-');
    const clave = ['db', 'password'].join('-');
    const valor = ['valor', 'sintetico', 'largo'].join('_');
    const { dir, base } = repoConCambio(
      `<input autoComplete={x ? '${actual}' : '${nuevo}'} data-cfg='{"${clave}": "${valor}"}' />`,
    );

    const result = spawnSync('bash', ['scripts/auditar-secretos.sh', base], {
      cwd: dir,
      encoding: 'utf8',
    });

    expect(`${result.stdout}${result.stderr}`).toContain('VALOR con forma de secreto');
    expect(result.status, 'el token benigno eximió la línea y ocultó la clave citada').toBe(1);
  });

  it.each(['db_password', 'client_secret', 'auth_token'])(
    'los identificadores compuestos %s conservan la guarda',
    (identifier) => {
      const value = ['valor', 'sintetico', 'largo'].join('_');
      const { dir, base } = repoConCambio(`const ${identifier} = '${value}';`);

      const result = spawnSync('bash', ['scripts/auditar-secretos.sh', base], {
        cwd: dir,
        encoding: 'utf8',
      });

      expect(`${result.stdout}${result.stderr}`).toContain('VALOR con forma de secreto');
      expect(result.status, `el límite omitió ${identifier}`).toBe(1);
    },
  );

  it.each(['password', 'secret', 'token'])(
    'una asignación %s en columna cero conserva la guarda',
    (identifier) => {
      const value = ['valor', 'sintetico', 'largo'].join('_');
      const { dir, base } = repoConCambio(`${identifier}='${value}';`);

      const result = spawnSync('bash', ['scripts/auditar-secretos.sh', base], {
        cwd: dir,
        encoding: 'utf8',
      });

      expect(`${result.stdout}${result.stderr}`).toContain('VALOR con forma de secreto');
      expect(result.status, `el marcador + consumió el inicio de ${identifier}`).toBe(1);
    },
  );

  it('un token HTML benigno no puede ocultar un secreto real en la misma línea', () => {
    // Se arma en runtime para que el propio test no contenga un valor con forma
    // de clave y pueda ser auditado por el instrumento que está probando.
    const secretoFalso = ['sk', 'live', 'A'.repeat(24)].join('_');
    const { dir, base } = repoConCambio(
      `const input = { autoComplete: 'current-password', apiKey: '${secretoFalso}' };`,
    );

    const result = spawnSync('bash', ['scripts/auditar-secretos.sh', base], {
      cwd: dir,
      encoding: 'utf8',
    });

    expect(`${result.stdout}${result.stderr}`).toContain('VALOR con forma de secreto');
    expect(result.status, 'el token benigno eximió la línea completa').toBe(1);
  });

  it('el instrumento corre limpio sobre la documentación REAL del repo', () => {
    // 🔴 ESTE ES EL HUECO QUE LA SUITE NO VEÍA, y costó un rojo real: 15/15 en
    // verde con fixtures sintéticos mientras `auditar-secretos.sh origin/main`
    // salía 1. **Los fixtures ejercitaban el patrón; nadie ejercitaba el
    // documento.** El CHANGELOG que describe este mismo arreglo citaba el
    // ejemplo que NO hay que eximir, y el gate lo marcaba: el instrumento se
    // trabó con el texto que lo describe.
    //
    // La lista se DERIVA de git en vez de escribirse a mano: un archivo nuevo
    // queda cubierto sin que nadie se acuerde de agregarlo acá. Se excluye
    // `contract-mirror/` porque es del dueño del contrato y este repo no puede
    // editarlo — una guarda que se pone roja sobre algo que no podés tocar no
    // es una guarda, es un bloqueo.
    const listado = spawnSync(
      'git',
      ['ls-files', '--', '*.md', ':(exclude)contract-mirror/*'],
      { cwd: RAIZ, encoding: 'utf8' },
    );
    expect(listado.status, listado.stderr).toBe(0);
    const documentos = listado.stdout.split('\n').filter(Boolean);
    expect(documentos.length, 'no se encontró documentación que auditar').toBeGreaterThan(0);
    expect(documentos).toContain('CHANGELOG.md');

    const dir = mkdtempSync(join(tmpdir(), 'payme-secret-docs-'));
    temporales.push(dir);
    mkdirSync(join(dir, 'scripts'), { recursive: true });
    copyFileSync(SCRIPT, join(dir, 'scripts', 'auditar-secretos.sh'));
    writeFileSync(join(dir, '.keep'), 'baseline\n');
    git(dir, 'init', '-q');
    git(dir, 'config', 'user.email', 'probe@payme.invalid');
    git(dir, 'config', 'user.name', 'PayMe probe');
    git(dir, 'add', '--', '.keep', 'scripts/auditar-secretos.sh');
    git(dir, 'commit', '-qm', 'baseline');
    const base = git(dir, 'rev-parse', 'HEAD');

    for (const documento of documentos) {
      const destino = join(dir, documento);
      mkdirSync(dirname(destino), { recursive: true });
      copyFileSync(join(RAIZ, documento), destino);
    }
    git(dir, 'add', '--', ...documentos);
    git(dir, 'commit', '-qm', 'documentacion real');

    const result = spawnSync('bash', ['scripts/auditar-secretos.sh', base], {
      cwd: dir,
      encoding: 'utf8',
    });

    expect(
      result.status,
      `la documentación real dispara el gate:\n${result.stdout}${result.stderr}`,
    ).toBe(0);
  });

  it('CI entrega una base alcanzable y no vacía tanto en push como en PR', () => {
    const ci = readFileSync(join(RAIZ, '.github', 'workflows', 'ci.yml'), 'utf8');
    expect(ci).toContain('fetch-depth: 0');
    expect(ci).toContain("github.event.pull_request.base.sha || github.event.before || 'HEAD^'");
    expect(ci).toContain('bash scripts/auditar-secretos.sh');
  });
});
