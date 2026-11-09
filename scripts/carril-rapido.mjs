// D744/D748: verifica rutas y bytes de versión; VI/e06 clasifican el contenido.
import { execFileSync } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const [base, head, ...extra] = process.argv.slice(2);
const git = (...args) => execFileSync('git', ['--no-replace-objects', '-c', 'core.commitGraph=false', '-c', 'advice.graftFileDeprecated=false', ...args], {
  env: { ...process.env, GIT_GRAFT_FILE: '/dev/null' },
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
});
const show = (sha, path) => git('show', `${sha}:${path}`);
// 0 rápido; 1 ruta protegida; 2 carril normal; 3 sin cambios; 4 entrada o historia inválida.
const PROTEGIDA = 1, NORMAL = 2, SIN_CAMBIOS = 3, INVALIDA = 4;
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
function rejectGrafts() {
  const commonDir = git('rev-parse', '--path-format=absolute', '--git-common-dir').slice(0, -1);
  const paths = [join(commonDir, 'info/grafts'), process.env.GIT_GRAFT_FILE];
  for (const path of paths) {
    if (!path || path === '/dev/null') continue;
    try {
      lstatSync(path);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    throw Error('grafts no permitidos');
  }
}
function regularModes(parent, child, path) {
  const mode = sha => git('ls-tree', '-z', '--full-tree', sha, '--', `:(literal)${path}`).slice(0, 6);
  const before = mode(parent), after = mode(child);
  if (!after) return false; // Borrado o ruta del diff no encontrada.
  return (!before || before === '100644') && after === '100644';
}
function versionOnly(parent, child, paths) {
  if (!VERSION_PATHS.every(path => paths.includes(path))) return false;
  const oldPackage = JSON.parse(show(parent, 'package.json')), nextPackage = JSON.parse(show(child, 'package.json'));
  const previous = oldPackage.version, next = nextPackage.version;
  if (typeof previous !== 'string' || typeof next !== 'string' || !greater(previous, next)) return false;
  nextPackage.version = previous;
  if (!isDeepStrictEqual(oldPackage, nextPackage)) return false;
  const oldLock = JSON.parse(show(parent, 'package-lock.json')), nextLock = JSON.parse(show(child, 'package-lock.json'));
  if (oldLock.version !== previous || oldLock.packages?.['']?.version !== previous ||
      nextLock.version !== next || nextLock.packages?.['']?.version !== next) return false;
  nextLock.version = previous; nextLock.packages[''].version = previous;
  return isDeepStrictEqual(oldLock, nextLock) && VERSION_PATHS.every(path =>
    show(child, path).replaceAll(JSON.stringify(next), JSON.stringify(previous)) === show(parent, path));
}
try {
  if (extra.length || !/^[a-f0-9]{40}$/.test(base) || !/^[a-f0-9]{40}$/.test(head)) {
    throw Error('uso: node scripts/carril-rapido.mjs SHA_BASE SHA_HEAD');
  }
  rejectGrafts();
  if (git('rev-parse', '--is-shallow-repository').trim() !== 'false') throw Error('historia incompleta');
  try {
    git('merge-base', '--is-ancestor', base, head);
  } catch (error) {
    if (error.status === 1) throw Error('la base no es ancestro de la cabeza');
    throw error;
  }
  const policy = JSON.parse(show(base, 'carriles.json'));
  for (const key of ['rapido', 'prohibidas', 'version_sola']) {
    if (!Array.isArray(policy[key]) || policy[key].some(rule => typeof rule !== 'string' || !rule ||
        rule.startsWith('/') || rule.split('/').includes('..') || rule.includes('\0'))) throw Error('política inválida');
  }
  const revisions = git('rev-list', '--parents', `${base}..${head}`).trim().split('\n').filter(Boolean);
  const paths = new Set(), protectedPaths = new Set(), normalPaths = new Set();
  for (const revision of revisions) {
    const [child, ...parents] = revision.split(' ');
    if (!parents.length) throw Error('commit sin padre dentro del rango');
    for (const parent of parents) {
      const changed = git('diff', '--no-ext-diff', '--no-renames', '--no-relative', '--ignore-submodules=none',
        '--name-only', '-z', parent, child, '--').split('\0').filter(Boolean);
      const versionRequested = changed.some(path => VERSION_PATHS.includes(path));
      const allowedVersion = versionRequested && isDeepStrictEqual(policy.version_sola, VERSION_PATHS) &&
        VERSION_PATHS.every(path => regularModes(parent, child, path)) && versionOnly(parent, child, changed);
      for (const path of changed) {
        paths.add(path);
        if (policy.prohibidas.some(rule => matches(path, rule))) protectedPaths.add(path);
        else if (!regularModes(parent, child, path) ||
          !(VERSION_PATHS.includes(path) ? allowedVersion : policy.rapido.some(rule => matches(path, rule)))) {
          normalPaths.add(path);
        }
      }
    }
  }
  if (protectedPaths.size) {
    console.error(`ruta protegida: ${JSON.stringify([...protectedPaths])}`);
    process.exitCode = PROTEGIDA;
  } else if (normalPaths.size) {
    console.error(`requiere carril normal: ${JSON.stringify([...normalPaths])}`);
    process.exitCode = NORMAL;
  } else if (!paths.size) {
    console.error('rango sin cambios');
    process.exitCode = SIN_CAMBIOS;
  } else {
    console.log(JSON.stringify({ base, head, rutas: [...paths].sort() }));
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = INVALIDA;
}
