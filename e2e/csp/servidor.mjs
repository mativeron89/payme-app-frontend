// n186 · servidor estático del harness CSP (orden AF-CSP-N186-20260925).
//
// Sirve un build (app mock o landing) con la política que genera `vercel.ts`
// para ese artefacto, pero SIEMPRE como `Content-Security-Policy` OBLIGATORIA:
// en producción la de la app va en Report-Only, y acá se aplica de verdad para
// demostrar que alcanza. La política sale del archivo real, no de una copia:
// se evalúan los bytes de `vercel.ts` como ESM, igual que `despliegue.test.ts`.
//
// Uso: node e2e/csp/servidor.mjs <dir-del-build> <puerto> <app|landing>
// Puerto ocupado ⇒ falla al arrancar (mismo criterio que `--strictPort`).
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [dir, puerto, artefacto] = process.argv.slice(2);
if (!dir || !puerto || !['app', 'landing'].includes(artefacto ?? '')) {
  console.error('uso: servidor.mjs <dir> <puerto> <app|landing>');
  process.exit(2);
}
const raizRepo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const raiz = resolve(dir);

process.env.PAYME_VERCEL_ARTIFACT = artefacto;
process.env.VITE_API_URL = '';
const temporal = mkdtempSync(join(tmpdir(), 'payme-csp-e2e-'));
const modulo = join(temporal, 'vercel.mjs');
writeFileSync(modulo, readFileSync(join(raizRepo, 'vercel.ts'), 'utf8'));
const { config } = await import(pathToFileURL(modulo).href);
rmSync(temporal, { recursive: true, force: true });
const cabecera = config.headers
  .find((r) => r.source === '/(.*)')
  ?.headers.find((h) => h.key === 'Content-Security-Policy' || h.key === 'Content-Security-Policy-Report-Only');
if (!cabecera) {
  console.error(`vercel.ts no genera CSP para «${artefacto}»`);
  process.exit(1);
}

const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon', '.txt': 'text/plain',
};

function archivo(ruta) {
  const limpio = normalize(decodeURIComponent(ruta.split('?')[0] ?? '/')).replace(/^([/\\])+/, '');
  const candidato = join(raiz, limpio);
  if (!candidato.startsWith(raiz)) return null;
  try { if (statSync(candidato).isFile()) return candidato; } catch { /* no existe */ }
  return null;
}

createServer((req, res) => {
  // SPA: lo que no es un archivo del build cae en index.html (como el rewrite de Vercel).
  const f = archivo(req.url ?? '/') ?? join(raiz, 'index.html');
  res.setHeader('Content-Security-Policy', cabecera.value);
  res.setHeader('X-Payme-Csp-Origen', cabecera.key);
  res.setHeader('Content-Type', TIPOS[extname(f)] ?? 'application/octet-stream');
  res.end(readFileSync(f));
})
  .on('error', (e) => { console.error(String(e)); process.exit(1); })
  .listen(Number(puerto), '127.0.0.1', () => console.log(`csp ${artefacto} en ${puerto}`));
