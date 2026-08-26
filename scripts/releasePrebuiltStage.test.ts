import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

type Mapa = Record<string, unknown>;

const WORKFLOW = resolve('.github/workflows/release-prebuilt-stage.yml');
const textoReal = readFileSync(WORKFLOW, 'utf8');

const esMapa = (valor: unknown): valor is Mapa =>
  typeof valor === 'object' && valor !== null && !Array.isArray(valor);

function mapa(valor: unknown, nombre: string): Mapa {
  if (!esMapa(valor)) throw new Error(`${nombre} no es mapping`);
  return valor;
}

function pasos(job: Mapa): Mapa[] {
  const value = job.steps;
  if (!Array.isArray(value) || !value.every(esMapa)) throw new Error('steps no es lista de mappings');
  return value;
}

function comando(paso: Mapa): string {
  return typeof paso.run === 'string' ? paso.run : '';
}

function ocurrencias(texto: string, patron: RegExp): number {
  return [...texto.matchAll(new RegExp(patron.source, `${patron.flags.replace('g', '')}g`))].length;
}

function encontrarSecretos(valor: unknown, ruta = '$'): string[] {
  if (typeof valor === 'string') return valor.includes('${{ secrets.') ? [ruta] : [];
  if (Array.isArray(valor)) return valor.flatMap((item, i) => encontrarSecretos(item, `${ruta}[${i}]`));
  if (!esMapa(valor)) return [];
  return Object.entries(valor).flatMap(([key, item]) => encontrarSecretos(item, `${ruta}.${key}`));
}

/**
 * Política ejecutable del ensayo. Devuelve TODOS los desvíos para que cada
 * mutante pruebe una propiedad causal, no un detalle incidental del YAML.
 */
function validar(texto: string): string[] {
  const errores: string[] = [];
  let root: Mapa;
  try {
    root = mapa(load(texto), 'workflow');
  } catch (error) {
    return [(error as Error).message];
  }

  const events = root.on;
  if (!esMapa(events) || Object.keys(events).sort().join(',') !== 'workflow_dispatch') {
    errores.push('el workflow no es exclusivamente manual');
  }
  const permissions = root.permissions;
  if (!esMapa(permissions) || Object.keys(permissions).join(',') !== 'contents' ||
      permissions.contents !== 'read') {
    errores.push('permissions no es contents:read exacto');
  }

  let jobs: Mapa;
  let gate: Mapa;
  let stage: Mapa;
  let verifyTransport: Mapa;
  let verifyRemote: Mapa;
  try {
    jobs = mapa(root.jobs, 'jobs');
    if (Object.keys(jobs).sort().join(',') !== 'gate,stage,verify_remote,verify_transport') {
      errores.push('DAG con jobs inesperados');
    }
    gate = mapa(jobs.gate, 'gate');
    stage = mapa(jobs.stage, 'stage');
    verifyTransport = mapa(jobs.verify_transport, 'verify_transport');
    verifyRemote = mapa(jobs.verify_remote, 'verify_remote');
  } catch (error) {
    return [...errores, (error as Error).message];
  }
  if (!Array.isArray(stage.needs) || [...stage.needs].sort().join(',') !== 'gate,verify_transport') {
    errores.push('stage no espera gate + verificación aislada');
  }
  if (verifyTransport.needs !== 'gate' || !Array.isArray(verifyRemote.needs) ||
      [...verifyRemote.needs].sort().join(',') !== 'gate,stage') {
    errores.push('DAG de verificación no es causal');
  }
  if (stage.environment !== 'production-staging') errores.push('falta environment aislado');
  if ('environment' in verifyTransport || 'environment' in verifyRemote) {
    errores.push('un verificador heredó environment');
  }
  if (Object.entries(jobs).filter(([, job]) => esMapa(job) && 'environment' in job)
    .map(([name]) => name).join(',') !== 'stage') {
    errores.push('environment no está confinado exclusivamente a stage');
  }
  const concurrency = stage.concurrency;
  if (!esMapa(concurrency) || concurrency['cancel-in-progress'] !== false ||
      concurrency.group !== 'payme-prebuilt-production-staging') {
    errores.push('concurrency no preserva el run en curso');
  }

  const gateSteps = pasos(gate);
  const stageSteps = pasos(stage);
  const transportSteps = pasos(verifyTransport);
  const remoteSteps = pasos(verifyRemote);
  const todos = [...gateSteps, ...transportSteps, ...stageSteps, ...remoteSteps];
  const usos = todos.map((step) => step.uses).filter((use): use is string => typeof use === 'string');
  const esperados = [
    'actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5',
    'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
    'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
    'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
    'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
    'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
    'actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093',
    'actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093',
    'actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093',
  ].sort();
  if ([...usos].sort().join('\n') !== esperados.join('\n')) errores.push('actions no están pinneadas exactamente');
  if (stageSteps.some((step) => typeof step.uses === 'string' && step.uses.startsWith('actions/checkout@'))) {
    errores.push('stage hace checkout');
  }

  const gateRun = gateSteps.map(comando).join('\n');
  const stageRun = stageSteps.map(comando).join('\n');
  const transportRun = transportSteps.map(comando).join('\n');
  const remoteRun = remoteSteps.map(comando).join('\n');
  for (const requerido of [
    'scripts/auditar-secretos.sh',
    'scripts/verificar-entorno-build.mjs --repo .',
    'npm ci',
    'scripts/verificar-mirror.mjs --integridad',
    'scripts/verificar-aliases.mjs --aliases',
    'npm test',
    'scripts/verificar-aliases.mjs --corrida',
    'npm run typecheck',
    'npm run build',
    'npm run build:landing',
    'npx playwright test',
    'scripts/release-artifact.mjs',
    'scripts/verify-release-artifact.mjs',
    'scripts/verify-release-url.mjs',
  ]) {
    if (!gateRun.includes(requerido)) errores.push(`gate perdió ${requerido}`);
  }
  if (ocurrencias(gateRun, /node scripts\/verificar-entorno-build\.mjs --repo \./) !== 3) {
    errores.push('el censo .env no corre al inicio y antes de ambos builds');
  }
  const appBuildIndex = gateSteps.findIndex((step) => comando(step).includes('npm run build') &&
    !comando(step).includes('build:landing'));
  const landingBuildIndex = gateSteps.findIndex((step) => comando(step).includes('npm run build:landing'));
  if (appBuildIndex < 1 || landingBuildIndex < 1 ||
      !comando(gateSteps[appBuildIndex - 1]!).includes('verificar-entorno-build.mjs') ||
      !comando(gateSteps[landingBuildIndex - 1]!).includes('verificar-entorno-build.mjs')) {
    errores.push('el censo .env no es inmediatamente anterior a cada build');
  }
  if (!gateRun.includes("variables.join(',') !== 'VITE_API_URL'")) {
    errores.push('build App no limita VITE_*');
  }
  const pasosVite = gateSteps.filter((step) => JSON.stringify(step).includes('VITE_API_URL'));
  if (pasosVite.length !== 1 || !comando(pasosVite[0]!).includes('npm run build') ||
      comando(pasosVite[0]!).includes('build:landing')) {
    errores.push('VITE_API_URL no está confinada al build App');
  }

  const upload = gateSteps.find((step) => typeof step.uses === 'string' && step.uses.startsWith('actions/upload-artifact@'));
  const uploadWith = upload && esMapa(upload.with) ? upload.with : {};
  if (uploadWith['include-hidden-files'] !== true || uploadWith['if-no-files-found'] !== 'error' ||
      uploadWith['compression-level'] !== 0) {
    errores.push('transporte no incluye .vercel de forma fail-closed');
  }
  const downloads = todos.filter((step) =>
    typeof step.uses === 'string' && step.uses.startsWith('actions/download-artifact@'));
  if (downloads.length !== 3 || downloads.some((download) => {
    const withMap = esMapa(download.with) ? download.with : {};
    return withMap['artifact-ids'] !== '${{ needs.gate.outputs.artifact_id }}' ||
      withMap['merge-multiple'] !== true || 'name' in withMap;
  })) {
    errores.push('algún download no usa artifact-id y raíz exactos');
  }
  if (!JSON.stringify(gate.outputs).includes('artifact-digest') ||
      !JSON.stringify(stage.outputs).includes('artifact_digest')) {
    errores.push('transporte no conserva digest ni extracción raíz exacta');
  }

  const installIndex = stageSteps.findIndex((step) => comando(step).includes('vercel@59.5.0'));
  const localVerifyIndex = transportSteps.findIndex((step) =>
    comando(step).includes('node "$release_root/tools/verify-release-artifact.mjs"'));
  if (installIndex < 0 || localVerifyIndex < 0 ||
      !comando(stageSteps[installIndex]!).includes('--ignore-scripts') ||
      !comando(stageSteps[installIndex]!).includes("59\\.5\\.0")) {
    errores.push('CLI no está exacta o falta verificación aislada');
  }
  if (ocurrencias(transportRun, /sha256sum .*verify-release-/) !== 2 ||
      ocurrencias(remoteRun, /sha256sum .*verify-release-/) !== 2) {
    errores.push('los dos verificadores transportados no se hashean');
  }
  const transportVerifyRun = localVerifyIndex >= 0 ? comando(transportSteps[localVerifyIndex]!) : '';
  if (!transportVerifyRun.includes('test -f "$tool_path" && test ! -L "$tool_path"') ||
      !transportVerifyRun.includes('stat -c \'%h\' "$tool_path"')) {
    errores.push('tools transportados no exigen archivo regular directo nlink=1');
  }
  if (transportVerifyRun.indexOf('sha256sum "$release_root/tools/verify-release-artifact.mjs"') < 0 ||
      transportVerifyRun.indexOf('sha256sum "$release_root/tools/verify-release-artifact.mjs"') >=
        transportVerifyRun.indexOf('node "$release_root/tools/verify-release-artifact.mjs"') ||
      transportVerifyRun.indexOf('sha256sum "$release_root/tools/verify-release-url.mjs"') < 0 ||
      transportVerifyRun.indexOf('sha256sum "$release_root/tools/verify-release-url.mjs"') >=
        transportVerifyRun.indexOf('node "$release_root/tools/verify-release-artifact.mjs"')) {
    errores.push('se ejecuta un verificador antes de fijar ambos hashes');
  }
  if (/npm ci|npm run (?:build|typecheck|test)|npx playwright/.test(stageRun)) {
    errores.push('stage recompila o repite gates');
  }
  if (/scripts\//.test(stageRun)) errores.push('stage ejecuta scripts del repo');
  if (/node "?\$release_root\/tools\//.test(stageRun) ||
      /import\s*\([^\n]*tools\/verify-/.test(stageRun) ||
      /(?:bash|sh|source|node)\s+[^\n]*payme-prebuilt\//.test(stageRun) ||
      stageRun.includes('verify-release-artifact.mjs --stage') ||
      stageRun.includes('verify-release-url.mjs --stage')) {
    errores.push('stage ejecuta código transportado');
  }
  if (!stageRun.includes('INLINE_BOSA_VERIFIER_V1') ||
      !stageRun.includes("exactEntries(releaseRoot, ['app', 'landing', 'tools'])") ||
      !stageRun.includes('sha256(canonical(files)) !== expectedRoot') ||
      !stageRun.includes('rmSync(tools, { recursive: true })') ||
      !stageRun.includes("exactEntries(releaseRoot, ['app', 'landing'])")) {
    errores.push('stage no trata BOSA como datos con censo inline fail-closed');
  }

  const deploys = stageSteps.filter((step) => comando(step).includes('vercel deploy'));
  if (deploys.length !== 2) errores.push('no hay exactamente dos deploys');
  for (const step of deploys) {
    const run = comando(step);
    if (!run.includes('vercel deploy --prebuilt --prod --skip-domain --yes --json') ||
        run.includes('--token')) {
      errores.push('deploy sin flags prebuilt staged exactos');
    }
    const env = esMapa(step.env) ? step.env : {};
    if (env.VERCEL_TOKEN !== '${{ secrets.VERCEL_TOKEN }}' ||
        typeof env.VERCEL_ORG_ID !== 'string' || typeof env.VERCEL_PROJECT_ID !== 'string') {
      errores.push('deploy sin binding/secret step-local');
    }
    const esperado = env.VERCEL_PROJECT_ID === '${{ vars.VERCEL_PROJECT_ID_APP }}'
      ? 'payme-app'
      : env.VERCEL_PROJECT_ID === '${{ vars.VERCEL_PROJECT_ID_LANDING }}'
        ? 'payme-landing'
        : '';
    if (!esperado || ocurrencias(run, new RegExp(`EXPECTED_PROJECT="${esperado}"`)) !== 2) {
      errores.push('deploy no fija su nombre de proyecto en ambas adjudicaciones');
    }
    if (!run.includes('api.vercel.com/v9/projects/') || !run.includes('EXPECTED_PROJECT=') ||
        !run.includes('api.vercel.com/v13/deployments/') ||
        !run.includes("deployment.projectId !== process.env.VERCEL_PROJECT_ID") ||
        !run.includes("deployment.readyState !== 'READY'") || run.includes("'readyState' in deployment") ||
        !run.includes("deployment.target !== 'production'") ||
        !run.includes('remoteUrl.origin !== url.origin') || !run.includes('url.port') ||
        !run.includes("headers: { authorization: `Bearer ${process.env.VERCEL_TOKEN}` }") ||
        !run.includes("redirect: 'error'")) {
      errores.push('deploy no adjudica proyecto y resultado READY exactos');
    }
  }
  if (!stageRun.includes('EXPECTED_PROJECT="payme-app"') ||
      !stageRun.includes('EXPECTED_PROJECT="payme-landing"')) {
    errores.push('binding semántico App/Landing ausente');
  }
  if (ocurrencias(remoteRun, /node "\$release_root\/tools\/verify-release-url\.mjs"/) !== 2) {
    errores.push('faltan las dos verificaciones remotas');
  }
  const remoteSerialized = JSON.stringify(remoteSteps);
  if (!remoteSerialized.includes('${{ needs.stage.outputs.app_url }}') ||
      !remoteSerialized.includes('${{ needs.stage.outputs.landing_url }}')) {
    errores.push('verificación remota no consume outputs del stage cerrado');
  }

  const secretPaths = encontrarSecretos(root);
  if (secretPaths.length !== 2 || secretPaths.some((path) => !path.includes('.steps[') || !path.endsWith('.env.VERCEL_TOKEN'))) {
    errores.push('el secreto escapó de los dos pasos deploy');
  }
  if (/(?:publicar-vercel|VERCEL_HOOK|\bpromote\b|\brollback\b)/i.test(texto)) {
    errores.push('el ensayo contiene otro camino de publicación o promoción');
  }
  return errores;
}

describe('release prebuilt staged manual', () => {
  it('satisface el contrato exacto', () => {
    expect(validar(textoReal)).toEqual([]);
  });

  it.each([
    ['trigger push', (s: string) => s.replace('  workflow_dispatch:', '  push:\n  workflow_dispatch:')],
    ['checkout mutable', (s: string) => s.replace('actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5', 'actions/checkout@v4')],
    ['secreto global', (s: string) => s.replace('permissions:\n  contents: read', 'permissions:\n  contents: read\nenv:\n  BAD: ${{ secrets.VERCEL_TOKEN }}')],
    ['sin dependencia', (s: string) => s.replace('    needs: gate\n', '')],
    ['stage saltea verificador aislado', (s: string) => s.replace('    needs: [gate, verify_transport]', '    needs: [gate]')],
    ['verificador hereda environment', (s: string) => s.replace('  verify_transport:\n    needs: gate', '  verify_transport:\n    needs: gate\n    environment: production-staging')],
    ['sin hidden files', (s: string) => s.replace('          include-hidden-files: true\n', '')],
    ['download por nombre', (s: string) => s.replace('          artifact-ids: ${{ needs.gate.outputs.artifact_id }}', '          name: cualquiera')],
    ['download anidado', (s: string) => s.replace('          merge-multiple: true', '          merge-multiple: false')],
    ['sin guarda env', (s: string) => s.replace('node scripts/verificar-entorno-build.mjs --repo .', 'true')],
    ['build contaminado', (s: string) => s.replace("variables.join(',') !== 'VITE_API_URL'", 'false')],
    ['stage hace checkout', (s: string) => s.replace('      - name: Preparar Node sin checkout', '      - uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5\n      - name: Preparar Node sin checkout')],
    ['stage ejecuta artifact', (s: string) => s.replace('// INLINE_BOSA_VERIFIER_V1:', 'await import(`${process.env.RELEASE_ROOT}/tools/verify-release-artifact.mjs`);\n          // INLINE_BOSA_VERIFIER_V1:')],
    ['stage conserva tools ejecutables', (s: string) => s.replace('rmSync(tools, { recursive: true });', 'void tools;')],
    ['sin skip-domain', (s: string) => s.replace(' --skip-domain', '')],
    ['agrega promote', (s: string) => `${s}\n# vercel promote accidental\n`],
    ['sin binding Landing', (s: string) => s.replaceAll('EXPECTED_PROJECT="payme-landing"', 'EXPECTED_PROJECT="payme-app"')],
    ['sin readjudicar deployment', (s: string) => s.replaceAll('api.vercel.com/v13/deployments/', 'api.vercel.com/v13/omitido/')],
    ['READY condicional', (s: string) => s.replaceAll("deployment.readyState !== 'READY'", "'readyState' in deployment && deployment.readyState !== 'READY'")],
  ])('rechaza mutante: %s', (_nombre, mutar) => {
    expect(validar(mutar(textoReal))).not.toEqual([]);
  });
});
