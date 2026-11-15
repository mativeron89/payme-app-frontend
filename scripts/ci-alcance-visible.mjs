#!/usr/bin/env node
/** D807: sólo una lista cerrada permite omitir navegador. Toda duda corre todo. */
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
const HEX40 = /^[0-9a-f]{40}$/;
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
function noVisible(path) {
  // Las áreas de ejecución prevalecen sobre la extensión documental.
  if (path.startsWith('.github/') || /^package.*\.json$/.test(path)) return false;
  if (path.startsWith('scripts/')) return /^scripts\/(?:.*\/)?[^/]+\.test\.ts$/.test(path);
  return path.startsWith('docs/') || /\.md$/.test(path) || /^src\/(?:.*\/)?[^/]+\.test\.tsx?$/.test(path);
}
function decidir() {
  const event = process.env.GITHUB_EVENT_NAME;
  if (event !== 'pull_request' && event !== 'push') return true;
  const payload = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const base = event === 'pull_request' ? payload.pull_request?.base?.sha : payload.before;
  const head = event === 'pull_request' ? payload.pull_request?.head?.sha : payload.after;
  if (!HEX40.test(base) || !HEX40.test(head)) throw new Error('base o cabeza inválida');
  git('cat-file', '-e', `${base}^{commit}`); git('cat-file', '-e', `${head}^{commit}`);
  const desde = event === 'pull_request' ? git('merge-base', base, head).trim() : base;
  const tokens = git('diff', '--name-status', '-z', '--find-renames', desde, head, '--').split('\0');
  if (tokens.pop() !== '' || tokens.length === 0) return true;
  let count = 0;
  for (let i = 0; i < tokens.length;) {
    const status = tokens[i++];
    if (!/^(?:[AMD T]|R\d+|C\d+)$/.test(status)) return true;
    const paths = /^[RC]/.test(status) ? [tokens[i++], tokens[i++]] : [tokens[i++]];
    if (paths.some(path => typeof path !== 'string' || path.length === 0 || !noVisible(path))) return true;
    count++;
  }
  return count === 0;
}
let visible;
try { visible = decidir(); } catch { visible = true; }
console.log(`visible=${visible}`);
// No poder entregar la salida falla el job; nunca se interpreta como permiso.
appendFileSync(process.env.GITHUB_OUTPUT, `visible=${visible}\n`);
