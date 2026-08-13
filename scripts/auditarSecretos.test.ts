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

afterEach(() => {
  for (const dir of temporales.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('auditoría de secretos', () => {
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

  it('CI entrega una base alcanzable y no vacía tanto en push como en PR', () => {
    const ci = readFileSync(join(RAIZ, '.github', 'workflows', 'ci.yml'), 'utf8');
    expect(ci).toContain('fetch-depth: 0');
    expect(ci).toContain("github.event.pull_request.base.sha || github.event.before || 'HEAD^'");
    expect(ci).toContain('bash scripts/auditar-secretos.sh');
  });
});
