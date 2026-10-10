import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HECHOS_DEL_DUENO } from './hechosDelDueno';

/**
 * D268 · las condiciones del OK del Bibliotecario sobre los hechos del dueño:
 * - sólo entradas y salidas de vectores sintéticos, con el origen y el sha256
 *   del archivo fuente: nada de código, secretos ni datos reales;
 * - el generador va en `scripts/` y corre SÓLO EN LOCAL, nunca en el CI;
 * - el CI exige que los sha coincidan con el inventario (eso lo hace
 *   `verificar-mirror.mjs --integridad`, probado en su propia suite).
 */
const RAIZ = join(__dirname, '..');
const inventario = JSON.parse(readFileSync(join(RAIZ, 'scripts', 'mirror-inventory.json'), 'utf8')) as {
  commit: string;
  archivos: Array<{ origen: string; destino: string; sha256: string }>;
};

/** Todo valor hoja de los hechos, con su ruta. */
function hojas(valor: unknown, ruta: string, salida: Array<[string, unknown]> = []): Array<[string, unknown]> {
  if (Array.isArray(valor)) valor.forEach((v, i) => hojas(v, `${ruta}[${i}]`, salida));
  else if (valor && typeof valor === 'object') for (const [k, v] of Object.entries(valor)) hojas(v, `${ruta}.${k}`, salida);
  else salida.push([ruta, valor]);
  return salida;
}

describe('🔴 D268 · los hechos del dueño', () => {
  it('son del commit del inventario, y cada fuente es un archivo del dueño que NO se copia, con su sha', () => {
    expect(HECHOS_DEL_DUENO.commit).toBe(inventario.commit);
    const porOrigen = new Map(inventario.archivos.map((a) => [a.origen, a]));
    const fuentes = Object.entries(HECHOS_DEL_DUENO.fuentes);
    expect(fuentes.length).toBeGreaterThan(5);
    for (const [origen, sha] of fuentes) {
      expect(porOrigen.get(origen)?.sha256, origen).toBe(sha);
      expect(porOrigen.get(origen)!.destino, origen).not.toMatch(/^contract\/[^/]+\.json$/);
    }
    for (const [clave, h] of Object.entries(HECHOS_DEL_DUENO.hechos)) expect(HECHOS_DEL_DUENO.fuentes, clave).toHaveProperty([h.origen]);
  });

  it('🔴 nada de código: los valores son booleanos, números, nulos o textos cortos sin sintaxis de programa', () => {
    const todas = Object.entries(HECHOS_DEL_DUENO.hechos).flatMap(([k, h]) => hojas(h.valor, k));
    expect(todas.length).toBeGreaterThan(40);
    for (const [ruta, v] of todas) {
      if (typeof v === 'string') {
        expect(v.length, ruta).toBeLessThanOrEqual(80);
        expect(v, ruta).not.toMatch(/[(){};=<>`\n]|=>|\bfunction\b|\brequire\b|\bSELECT\b/i);
      } else {
        expect(v === null || typeof v === 'boolean' || typeof v === 'number', ruta).toBe(true);
      }
    }
  });

  it('🔴 el generador corre sólo en local: ningún workflow ni script de npm lo llama', () => {
    const dir = join(RAIZ, '.github', 'workflows');
    const workflows = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));
    expect(workflows.length).toBeGreaterThan(0);
    for (const f of workflows) expect(readFileSync(join(dir, f), 'utf8'), f).not.toContain('generar-hechos-del-dueno');
    expect(readFileSync(join(RAIZ, 'package.json'), 'utf8')).not.toContain('generar-hechos-del-dueno');
  });
});
