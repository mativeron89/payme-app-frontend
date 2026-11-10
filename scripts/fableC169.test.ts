import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('C169 · documentación y scripts', () => {
  it('AF-P1 · el README reconoce el script de idioma inline y su CSP', () => {
    const landing = readFileSync('landing/index.html', 'utf8');
    expect([...landing.matchAll(/<script\b[^>]*>/gi)].map(([tag]) => tag)).toEqual(['<script>']);
    expect(landing).toContain('function applyLang');
    const readme = readFileSync('README.md', 'utf8');
    expect(readme).toContain('un único script inline para cambiar de idioma');
    expect(readme).toContain('su hash está en la CSP de `vercel.ts`');
  });

  it('AF-P3 · los tres scripts retirados salen también del inventario de carriles', () => {
    const carriles = readFileSync('carriles.json', 'utf8');
    for (const script of ['envolver-copy.mjs', 'inventario-copy.mjs', 't7-setup-db.sh']) {
      expect(carriles).not.toContain(`"scripts/${script}"`);
      expect(existsSync(`scripts/${script}`)).toBe(false);
    }
  });
});
