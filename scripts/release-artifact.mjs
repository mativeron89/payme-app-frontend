// Runner compatible con el Node 20 fijado por CI. No importa `.ts` desde Node:
// delega la transformación al vite-node que package-lock.json inmoviliza junto
// con Vitest. El test focal compara el binario real con esa versión lockeada.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoDir = dirname(scriptsDir);
const viteNode = join(repoDir, 'node_modules', '.bin', 'vite-node');
const programa = join(scriptsDir, 'releaseArtifact.ts');
const resultado = spawnSync(viteNode, ['--script', programa, ...process.argv.slice(2)], {
  cwd: repoDir,
  env: process.env,
  stdio: 'inherit',
});

if (resultado.error || resultado.status === null) {
  process.stderr.write('releaseArtifact: no se pudo iniciar el runner lockeado\n');
  process.exitCode = 1;
} else {
  process.exitCode = resultado.status;
}
