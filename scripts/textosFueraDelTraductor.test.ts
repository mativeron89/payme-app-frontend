import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { censar, censarFuente } from './textosFueraDelTraductor.mjs';

/**
 * n79 · AF-I18N-N79 · TEXTOS VISIBLES QUE NO PASAN POR EL TRADUCTOR.
 *
 * El censo (`textosFueraDelTraductor.mjs`) recorre por AST los `.tsx` de `src/`.
 * Cada hallazgo tiene que estar CLASIFICADO en
 * `textosFueraDelTraductor.clasificados.json`:
 *   - `b`: garantía, saldo o pagos, apagado; espera textos de Diseño;
 *   - `c`: legal;
 *   - `marca`, `token`, `dinamico` (ya pasa por `t(variable)`), `decision`.
 * El grupo `a` (copy común) se TRADUJO y no puede volver a aparecer.
 *
 * Un texto visible NUEVO fuera de `t()` pone esto en rojo: se traduce o se
 * clasifica a propósito, con su motivo. El listado sólo cambia con intención.
 */
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

interface Clasificado { archivo: string; texto: string; grupo: string; veces: number; motivo: string }
const CLASIFICADOS = JSON.parse(readFileSync(join(RAIZ, 'scripts/textosFueraDelTraductor.clasificados.json'), 'utf8')) as Clasificado[];
const GRUPOS = new Set(['b', 'c', 'marca', 'token', 'dinamico', 'decision']);
const clave = (archivo: string, texto: string) => `${archivo} · ${texto}`;

describe('n79 · textos visibles fuera del traductor', () => {
  it('🔴 SONDA · el censo encuentra texto suelto y deja pasar lo que va por t()', () => {
    const h = censarFuente('src/x.tsx', `
      const A = () => <div aria-label="Cerrar" className="caja">
        <p>Hola mundo</p>
        {ok ? 'Sí' : 'No'}
        {t('Traducido')}
        {t(ok ? 'Uno traducido' : 'Otro traducido')}
        <span>{\`Hay \${n} mesas\`}</span>
        {estado === 'abierta' && <b>{n}</b>}
      </div>;`);
    expect(h.map((x) => x.texto).sort()).toEqual(['Cerrar', 'Hay mesas', 'Hola mundo', 'No', 'Sí']);
  });

  it('🔴 cada texto visible fuera de t() está clasificado, y la clasificación no tiene sobrantes', () => {
    const contados = new Map<string, number>();
    for (const h of censar()) contados.set(clave(h.archivo, h.texto), (contados.get(clave(h.archivo, h.texto)) ?? 0) + 1);
    const esperados = new Map(CLASIFICADOS.map((c) => [clave(c.archivo, c.texto), c.veces]));
    const nuevos = [...contados].filter(([k, n]) => (esperados.get(k) ?? 0) < n).map(([k]) => k);
    const sobrantes = [...esperados].filter(([k, n]) => (contados.get(k) ?? 0) < n).map(([k]) => k);
    expect(nuevos, 'texto visible NUEVO fuera de t(): tradúcelo o clasifícalo con su motivo').toEqual([]);
    expect(sobrantes, 'clasificado que ya no está en el código: sácalo del listado').toEqual([]);
  });

  it('el listado sólo tiene los grupos que no se traducen, cada uno con su motivo', () => {
    for (const c of CLASIFICADOS) {
      expect(GRUPOS.has(c.grupo), `${clave(c.archivo, c.texto)} · grupo «${c.grupo}»`).toBe(true);
      expect(c.motivo.length, clave(c.archivo, c.texto)).toBeGreaterThan(10);
    }
  });

  // El español byte-idéntico de los cinco traducidos se prueba en
  // `src/i18n/n79.test.ts`: acá no se compila JSX y `traducir` vive en un .tsx.
});
