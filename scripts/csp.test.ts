import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cabeceraGlobal, directivasCsp, evaluarConfigVercel } from './vercelConfig';

/**
 * n186 · las cabeceras CSP que genera `vercel.ts` (orden AF-CSP-N186-20260925).
 * Que el edge las sirva lo verifica el Bibliotecario por la API de Vercel; que
 * la política ALCANCE para la app lo prueba el e2e con la CSP obligatoria
 * (`e2e/csp/`). Acá: qué se configura, por artefacto.
 */
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const CSP = 'Content-Security-Policy';
const CSP_RO = 'Content-Security-Policy-Report-Only';
const sinApi = { ...process.env, VITE_API_URL: '' };
const sha = (s: string) => `'sha256-${createHash('sha256').update(s).digest('base64')}'`;
const todasLasClaves = (c: ReturnType<typeof evaluarConfigVercel>) => c.headers.flatMap((r) => r.headers.map((h) => h.key));

describe('n186 · App: CSP SÓLO de reporte', () => {
  const app = evaluarConfigVercel({ ...sinApi, PAYME_VERCEL_ARTIFACT: 'app' });
  const politica = cabeceraGlobal(app, CSP_RO) ?? '';
  const d = directivasCsp(politica);

  it('🔴 va en Report-Only sobre `/(.*)` y NUNCA como obligatoria', () => {
    expect(politica.length).toBeGreaterThan(50);
    expect(todasLasClaves(app)).not.toContain(CSP);
    expect(app.headers[0]?.source).toBe('/(.*)');
  });

  it('permite Google Identity, Stripe (con el 3DS), el service worker, el manifest y las imágenes del escáner', () => {
    expect(d.get('script-src')).toEqual(expect.arrayContaining(["'self'", 'https://accounts.google.com/gsi/client', 'https://js.stripe.com']));
    expect(d.get('frame-src')).toEqual(expect.arrayContaining(['https://accounts.google.com/gsi/', 'https://js.stripe.com', 'https://hooks.stripe.com']));
    expect(d.get('connect-src')).toEqual(expect.arrayContaining(["'self'", 'https://accounts.google.com/gsi/', 'https://api.stripe.com']));
    expect(d.get('style-src')).toEqual(expect.arrayContaining(["'self'", 'https://accounts.google.com/gsi/style']));
    expect(d.get('img-src')).toEqual(expect.arrayContaining(["'self'", 'blob:', 'data:']));
    expect(d.get('worker-src')).toEqual(["'self'"]);
    expect(d.get('manifest-src')).toEqual(["'self'"]);
    expect(d.get('object-src')).toEqual(["'none'"]);
    expect(d.get('frame-ancestors')).toEqual(["'none'"]);
  });

  /**
   * AF-CSP-ESTILOS (n186) · lo que inyecta `gsi/client` se midió con el script
   * real: un `<style>` constante (por su hash) y el atributo `style` del botón,
   * que lleva el ancho del contenedor y cambia con cada teléfono. El ÚNICO
   * `unsafe-` admitido es `'unsafe-inline'` en `style-src-attr`.
   */
  it('🔴 el único `unsafe-` es `\'unsafe-inline\'` en `style-src-attr`; ningún `unsafe-eval` ni `unsafe-hashes`', () => {
    const conUnsafe = [...d.entries()].filter(([, fuentes]) => fuentes.some((f) => f.includes('unsafe-')));
    expect(conUnsafe).toEqual([['style-src-attr', ["'unsafe-inline'"]]]);
    expect(politica).not.toMatch(/unsafe-eval|unsafe-hashes|wasm-unsafe/);
  });

  it('🔴 script-src, connect-src y frame-src quedan EXACTAMENTE como antes (no se relajan por los estilos)', () => {
    expect(d.get('script-src')).toEqual(["'self'", 'https://accounts.google.com/gsi/client', 'https://js.stripe.com', 'https://*.js.stripe.com']);
    expect(d.get('connect-src')).toEqual(["'self'", 'https://accounts.google.com/gsi/', 'https://api.stripe.com']);
    expect(d.get('frame-src')).toEqual(['https://accounts.google.com/gsi/', 'https://js.stripe.com', 'https://*.js.stripe.com', 'https://hooks.stripe.com']);
    expect(d.get('default-src')).toEqual(["'self'"]);
  });

  it('style-src y style-src-elem: lo propio, el splash, la hoja de GIS y el `<style>` de GIS por su hash; nada más', () => {
    const GIS = "'sha256-RU4sU0AaS8IBGZx8XrGt/pa9A5SLA3dQszGeqT5L3Kw='";
    for (const directiva of ['style-src', 'style-src-elem']) {
      const fuentes = d.get(directiva) ?? [];
      expect(fuentes, directiva).toHaveLength(4);
      expect(fuentes, directiva).toEqual(expect.arrayContaining(["'self'", 'https://accounts.google.com/gsi/style', GIS]));
      expect(fuentes.join(' '), directiva).not.toMatch(/unsafe-|\*|https?:\/\/(?!accounts\.google\.com\/gsi\/style)/);
    }
  });

  it('🔴 el `<style>` del splash va por su hash exacto', () => {
    const html = readFileSync(join(RAIZ, 'index.html'), 'utf8');
    const estilos = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1] ?? '');
    expect(estilos).toHaveLength(1);
    // Ningún <script> inline en la app: el único es el módulo con `src`.
    expect([...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>/g)]).toHaveLength(0);
    for (const directiva of ['style-src', 'style-src-elem']) {
      expect(d.get(directiva), `el hash del <style> de index.html no está en ${directiva}: el splash quedaría bloqueado`)
        .toContain(sha(estilos[0]!));
    }
  });

  it('el origen de la API sale de `VITE_API_URL`, y sólo si es http(s) válido', () => {
    const con = directivasCsp(cabeceraGlobal(evaluarConfigVercel({
      ...process.env, PAYME_VERCEL_ARTIFACT: 'app', VITE_API_URL: 'https://api.example.test/v1/',
    }), CSP_RO) ?? '');
    expect(con.get('connect-src')).toContain('https://api.example.test');
    expect(con.get('img-src')).toContain('https://api.example.test');
    for (const malo of ['', 'no-es-url', 'javascript:alert(1)']) {
      const p = cabeceraGlobal(evaluarConfigVercel({ ...process.env, PAYME_VERCEL_ARTIFACT: 'app', VITE_API_URL: malo }), CSP_RO) ?? '';
      expect(p, `«${malo}» no debería agregar un origen`).not.toMatch(/api\.example|javascript:/);
      expect(directivasCsp(p).get('connect-src')).toEqual(["'self'", 'https://accounts.google.com/gsi/', 'https://api.stripe.com']);
    }
  });
});

describe('n186 · Landing: CSP OBLIGATORIA', () => {
  const landing = evaluarConfigVercel({ ...sinApi, PAYME_VERCEL_ARTIFACT: 'landing' });
  const politica = cabeceraGlobal(landing, CSP) ?? '';
  const d = directivasCsp(politica);

  it('🔴 obligatoria sobre `/(.*)`, sin Report-Only, sin rewrites ni otras cabeceras', () => {
    expect(landing.headers).toEqual([{ source: '/(.*)', headers: [{ key: CSP, value: politica }] }]);
    expect(landing.rewrites).toEqual([]);
  });

  it('🔴 sólo lo propio, y el único script es el inline de idioma por su hash', () => {
    expect(politica).not.toMatch(/unsafe-|https?:/);
    expect(d.get('default-src')).toEqual(["'self'"]);
    const scripts = d.get('script-src') ?? [];
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toMatch(/^'sha256-[A-Za-z0-9+/]{43}='$/);
    expect(d.get('connect-src')).toEqual(["'none'"]);
    expect(d.get('form-action')).toEqual(["'none'"]);
    expect(d.get('frame-ancestors')).toEqual(["'none'"]);
  });
});

describe('n186 · artefacto desconocido', () => {
  it.each(['', 'otra-cosa', 'APP'])('«%s»: ninguna cabecera ni rewrite', (artefacto) => {
    const c = evaluarConfigVercel({ ...sinApi, PAYME_VERCEL_ARTIFACT: artefacto });
    expect(c.headers).toEqual([]);
    expect(c.rewrites).toEqual([]);
  });
});
