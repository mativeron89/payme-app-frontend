// Runner compatible con el Node 20 fijado por CI. No importa `.ts` desde Node:
// delega la transformación al `runnerImport` de Vite, la devDependency directa
// que package-lock.json inmoviliza. El test focal compara la versión que resuelve
// este runner con esa versión lockeada.
//
// AF-VITE-MAYOR (vite 6 / vitest 4): hasta acá lo hacía el binario `vite-node`,
// que llegaba arrastrado por vitest 3 y vitest 4 ya no instala. `runnerImport`
// carga `releaseArtifact.ts` con el mismo módulo de Vite, sin dependencia nueva;
// se llama a la función exportada, así que la guarda de entrada del `.ts` no
// interviene y la salida sigue siendo sólo el resumen canónico.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoDir = dirname(scriptsDir);
const programa = join(scriptsDir, 'releaseArtifact.ts');

let ejecutar;
try {
  const { runnerImport } = await import('vite');
  const { module } = await runnerImport(programa, {
    root: repoDir,
    configFile: false,
    envFile: false,
    logLevel: 'silent',
  });
  ejecutar = module.ejecutarCliReleaseArtifact;
  if (typeof ejecutar !== 'function') throw new Error('entrada ausente');
} catch {
  process.stderr.write('releaseArtifact: no se pudo iniciar el runner lockeado\n');
  process.exitCode = 1;
}

if (ejecutar) process.exitCode = ejecutar(process.argv.slice(2));
