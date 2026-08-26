#!/usr/bin/env node

import { lstatSync, readdirSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const AUTORIZADOS = Object.freeze([
  '.env.development',
  '.env.local.example',
  '.env.mock',
]);
const OMITIR = new Set(['.git', 'node_modules']);

function rutaCanonica(root, path) {
  return relative(root, path).split(sep).join('/');
}

function censar(root, dir = root, encontrados = []) {
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    if (dir === root && OMITIR.has(entrada.name)) continue;
    const path = resolve(dir, entrada.name);
    const relativa = rutaCanonica(root, path);
    const stat = lstatSync(path);

    if (entrada.name.startsWith('.env')) {
      encontrados.push({ path: relativa, stat });
    }
    if (stat.isDirectory() && !stat.isSymbolicLink()) censar(root, path, encontrados);
  }
  return encontrados;
}

export function verificarEntornoBuild(repoInput) {
  const repo = realpathSync(resolve(repoInput));
  const statRepo = lstatSync(repo);
  if (!statRepo.isDirectory() || statRepo.isSymbolicLink()) {
    throw new Error('la raíz del repo no es un directorio real');
  }

  const encontrados = censar(repo).sort((a, b) => a.path.localeCompare(b.path));
  const rutas = encontrados.map(({ path }) => path);
  const esperadas = [...AUTORIZADOS].sort();
  const prohibidas = rutas.filter((path) => !AUTORIZADOS.includes(path));
  if (prohibidas.length !== 0) {
    throw new Error(`archivos .env prohibidos en el build: ${prohibidas.join(', ')}`);
  }
  if (rutas.join('\n') !== esperadas.join('\n')) {
    throw new Error(`censo .env incompleto: esperado ${esperadas.join(', ')}; recibido ${rutas.join(', ')}`);
  }
  for (const { path, stat } of encontrados) {
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
      throw new Error(`fixture .env no es archivo regular directo nlink=1: ${path}`);
    }
  }

  const tracked = execFileSync('git', ['ls-files', '-z', '--', '.env*'], {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).split('\0').filter(Boolean).sort();
  if (tracked.join('\n') !== esperadas.join('\n')) {
    throw new Error(`fixtures .env versionados divergentes: ${tracked.join(', ')}`);
  }

  return Object.freeze({ archivos: Object.freeze(esperadas) });
}

function argumentos(argv) {
  if (argv.length !== 2 || argv[0] !== '--repo' || !argv[1]) {
    throw new Error('uso: node scripts/verificar-entorno-build.mjs --repo <repo>');
  }
  return argv[1];
}

const entradaCli = process.argv[1];
const ejecutadoComoCli = typeof entradaCli === 'string' && entradaCli !== '' &&
  import.meta.url === pathToFileURL(realpathSync(entradaCli)).href;

if (ejecutadoComoCli) {
  try {
    const resultado = verificarEntornoBuild(argumentos(process.argv.slice(2)));
    process.stdout.write(`entorno build OK: ${resultado.archivos.length} fixtures públicas exactas\n`);
  } catch (error) {
    process.stderr.write(`entorno build inválido: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
