import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOC = readFileSync(join(RAIZ, 'docs', 'HARDENING_LANDING_LOCAL.md'), 'utf8');

function clavesRecursivas(valor: unknown): string[] {
  if (Array.isArray(valor)) return valor.flatMap(clavesRecursivas);
  if (typeof valor !== 'object' || valor === null) return [];
  return Object.entries(valor).flatMap(([clave, item]) => [clave, ...clavesRecursivas(item)]);
}

describe('headers · inventario local sin ampliar el config compartido', () => {
  it('🔴 `vercel.json` no aplica headers globales a App + Landing', () => {
    const config: unknown = JSON.parse(readFileSync(join(RAIZ, 'vercel.json'), 'utf8'));
    expect(clavesRecursivas(config), 'apareció `headers` en el config compartido').not.toContain('headers');
  });

  it.each([
    ['X-Content-Type-Options: nosniff', 'candidato, no aplicado'],
    ['Referrer-Policy: strict-origin-when-cross-origin', 'candidato, no aplicado'],
    ['CSP / `frame-ancestors` / X-Frame-Options', 'bloqueado'],
    ['COOP / COEP / CORP', 'bloqueado'],
    ['Permissions-Policy', 'bloqueado'],
  ])('la propuesta clasifica `%s` como `%s`', (header, estado) => {
    const fila = DOC.split('\n').find((linea) => linea.startsWith('|') && linea.includes(header));
    expect(fila, `falta el inventario de ${header}`).toBeDefined();
    expect(fila).toContain(`| ${estado} |`);
  });

  it('declara que ningún test local acredita headers servidos', () => {
    expect(DOC).toContain('Ningún test local autoriza afirmar que estos');
    expect(DOC).toContain('headers estén servidos.');
  });
});
