// D744/D748: verifica rutas y bytes de versión; VI/e06 clasifican el contenido.
import { execFileSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';

const [base, head, ...extra] = process.argv.slice(2);
const git = (...args) => execFileSync('git', ['--no-replace-objects', ...args], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
});
const show = (sha, path) => git('show', `${sha}:${path}`);
const VERSION_PATHS = ['package.json', 'package-lock.json'];
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
function matches(path, rule) {
  return rule.endsWith('/**') ? path.startsWith(rule.slice(0, -2)) : path === rule;
}
function greater(previous, next) {
  if (!semver.test(previous) || !semver.test(next)) return false;
  const a = previous.split('.').map(BigInt), b = next.split('.').map(BigInt);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return b[i] > a[i];
  return false;
}
function regularModes(path) {
  const mode = sha => git('ls-tree', '-z', sha, '--', `:(literal)${path}`).slice(0, 6);
  const before = mode(base), after = mode(head);
  // Altas/bajas sólo con el blob regular existente. Nunca symlink, +x ni cambio de mode.
  return (!before || before === '100644') && (!after || after === '100644') &&
    (!before || !after || before === after);
}
function versionOnly(paths) {
  if (!VERSION_PATHS.every(path => paths.includes(path))) return false;
  const oldPackage = JSON.parse(show(base, 'package.json')), nextPackage = JSON.parse(show(head, 'package.json'));
  const previous = oldPackage.version, next = nextPackage.version;
  if (typeof previous !== 'string' || typeof next !== 'string' || !greater(previous, next)) return false;
  nextPackage.version = previous;
  if (!isDeepStrictEqual(oldPackage, nextPackage)) return false;
  const oldLock = JSON.parse(show(base, 'package-lock.json')), nextLock = JSON.parse(show(head, 'package-lock.json'));
  if (oldLock.version !== previous || oldLock.packages?.['']?.version !== previous ||
      nextLock.version !== next || nextLock.packages?.['']?.version !== next) return false;
  nextLock.version = previous; nextLock.packages[''].version = previous;
  return isDeepStrictEqual(oldLock, nextLock);
}
try {
  if (extra.length || !/^[a-f0-9]{40}$/.test(base) || !/^[a-f0-9]{40}$/.test(head)) {
    throw Error('uso: node scripts/carril-rapido.mjs SHA_BASE SHA_HEAD');
  }
  const policy = JSON.parse(show(base, 'carriles.json'));
  for (const key of ['rapido', 'prohibidas', 'version_sola']) {
    if (!Array.isArray(policy[key]) || policy[key].some(rule => typeof rule !== 'string' || !rule ||
        rule.startsWith('/') || rule.split('/').includes('..') || rule.includes('\0'))) throw Error('política inválida');
  }
  const paths = git('diff', '--no-ext-diff', '--no-renames', '--name-only', '-z', base, head, '--').split('\0').filter(Boolean);
  if (!paths.length) throw Error('rango sin cambios');
  const requested = paths.some(path => VERSION_PATHS.includes(path));
  const allowedVersion = requested && isDeepStrictEqual(policy.version_sola, VERSION_PATHS) && versionOnly(paths);
  const rejected = paths.filter(path => policy.prohibidas.some(rule => matches(path, rule)) ||
    !regularModes(path) || !(VERSION_PATHS.includes(path) ? allowedVersion : policy.rapido.some(rule => matches(path, rule))));
  if (rejected.length) throw Error(`requiere carril normal: ${JSON.stringify(rejected)}`);
  console.log(JSON.stringify({ base, head, rutas: paths }));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
