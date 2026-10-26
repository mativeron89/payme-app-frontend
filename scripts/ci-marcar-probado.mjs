#!/usr/bin/env node
/**
 * D493 · la marca que deja la CI de un PR cuando TODO quedó en verde.
 *
 * Corre en el job `build` sólo en `pull_request`, después del verificador de
 * needs y del build. En un PR el checkout es el merge ref
 * (`refs/pull/N/merge`): su árbol es lo que se probó y su primer padre es la
 * base contra la que se probó. Escribe `nombre=ci-probado-arbol-<árbol>-base-<base>`
 * en `$GITHUB_OUTPUT` y el mismo dato en `ci-probado.json`, que el paso siguiente
 * sube como artefacto con ese nombre.
 *
 * El push a main lo lee por API (`ci-ya-probado.mjs`) y sólo saltea la suite si
 * el árbol es el del SHA pusheado y la base es su ancestro. Sale ≠0 si algo no
 * cuadra: sin marca, main corre la suite completa.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';

const HEX40 = /^[0-9a-f]{40}$/;
const git = (args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

if (process.env.GITHUB_EVENT_NAME !== 'pull_request') {
  console.error('🔴 la marca sólo se deja en pull_request');
  process.exit(1);
}
const padres = git(['rev-list', '--parents', '-n', '1', 'HEAD']).split(/\s+/);
if (padres.length !== 3 || !padres.every((s) => HEX40.test(s))) {
  console.error(`🔴 HEAD no es el merge ref de un PR (padres: ${padres.length - 1})`);
  process.exit(1);
}
const base = padres[1];
const arbol = git(['rev-parse', 'HEAD^{tree}']);
if (!HEX40.test(arbol)) {
  console.error('🔴 no se pudo leer el árbol de HEAD');
  process.exit(1);
}
const nombre = `ci-probado-arbol-${arbol}-base-${base}`;
writeFileSync('ci-probado.json', `${JSON.stringify({ arbol, base, merge: padres[0] })}\n`);
const salida = process.env.GITHUB_OUTPUT;
if (!salida) {
  console.error('🔴 no hay GITHUB_OUTPUT');
  process.exit(1);
}
appendFileSync(salida, `nombre=${nombre}\n`);
console.log(`marca: ${nombre}`);
