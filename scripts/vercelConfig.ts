import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * n186 · evalúa `vercel.ts` como ESM real con el entorno dado y devuelve su
 * `config`, igual que `despliegue.test.ts`: copia los bytes exactos a un `.mjs`
 * temporal (node no importa `.ts` sin loader) y lo importa en un proceso
 * aparte, así el `process.env` del módulo es el que se le pasa.
 */
export interface CabeceraVercel { readonly key: string; readonly value: string }
export interface ReglaVercel { readonly source: string; readonly headers: readonly CabeceraVercel[] }
export interface ConfigVercel {
  readonly git: unknown;
  readonly rewrites: ReadonlyArray<{ source: string; destination: string }>;
  readonly headers: readonly ReglaVercel[];
}

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

export function evaluarConfigVercel(env: NodeJS.ProcessEnv): ConfigVercel {
  const temporal = mkdtempSync(join(tmpdir(), 'payme-vercel-csp-'));
  const modulo = join(temporal, 'vercel.mjs');
  writeFileSync(modulo, readFileSync(join(RAIZ, 'vercel.ts'), 'utf8'));
  const script = `import(${JSON.stringify(`file://${modulo}`)})`
    + '.then(m=>process.stdout.write(JSON.stringify(m.config)))'
    + '.catch(e=>{process.stderr.write(String(e.message));process.exitCode=1})';
  const r = spawnSync(process.execPath, ['--input-type=module', '--eval', script], { encoding: 'utf8', env });
  rmSync(temporal, { recursive: true, force: true });
  if (r.status !== 0) throw new Error(`vercel.ts no evaluó: ${r.stdout}${r.stderr}`);
  return JSON.parse(r.stdout) as ConfigVercel;
}

/** `directiva fuente fuente; …` → mapa directiva → fuentes. */
export function directivasCsp(politica: string): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const parte of politica.split(';')) {
    const [nombre, ...fuentes] = parte.trim().split(/\s+/);
    if (nombre) m.set(nombre, fuentes);
  }
  return m;
}

/** El valor de una cabecera en la regla global `/(.*)`, o `undefined`. */
export function cabeceraGlobal(config: ConfigVercel, clave: string): string | undefined {
  return config.headers.find((r) => r.source === '/(.*)')?.headers.find((h) => h.key === clave)?.value;
}
