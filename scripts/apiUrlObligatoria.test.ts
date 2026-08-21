import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 🔴 L3 · LA COMPUERTA SE PRUEBA CORRIÉNDOLA, no leyendo que existe.
 *
 * Un gate que nunca vio un rojo no está verificado — es la misma disciplina que
 * `publicar-vercel.sh` ya tiene en este repo. Acá se ejecuta `vite build` de
 * verdad, en las cuatro condiciones, y se afirma cuál corta y cuál no.
 *
 * ⚠️ **Lo que esta guarda NO promete, y conviene que esté escrito donde se
 * verifica:** no dice que la URL sea la correcta, ni que el backend exista, ni
 * que la variable esté cargada en Vercel — **ese valor vive fuera del repo y
 * sigue fuera de alcance**. Vuelve ese límite irrelevante en una sola
 * dirección: sin variable no hay artefacto que publicar.
 */
function build(env: Record<string, string | undefined>): { ok: boolean; salida: string } {
  // Sin `VITE_API_URL` heredada del entorno de quien corre la suite: el caso
  // que hay que probar es justamente su ausencia, y heredarla lo taparía.
  const limpio = { ...process.env, VITE_API_URL: undefined, VITE_MOCK: undefined, ...env };
  try {
    const salida = execFileSync('npx', ['--no-install', 'vite', 'build'], {
      cwd: RAIZ,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: limpio as NodeJS.ProcessEnv,
    });
    return { ok: true, salida };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    return { ok: false, salida: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

describe('🔴 el build real exige `VITE_API_URL`', () => {
  it('🔴 SIN la variable, el build REAL falla — y el mensaje dice qué hacer', () => {
    const r = build({});
    expect(r.ok, 'el build real compiló sin `VITE_API_URL`: el bundle apuntaría a localhost').toBe(false);
    expect(r.salida).toContain('BUILD REAL SIN `VITE_API_URL`');
    // El mensaje tiene que traer la salida, no sólo el diagnóstico: un cartel
    // que nombra un problema y no dice cómo salir cuesta más de lo que ahorra.
    expect(r.salida, 'el error no dice cómo seguir').toContain('VITE_MOCK=1');
  }, 180_000);

  it('⭐ CONTROL POSITIVO · con la variable, el mismo build pasa', () => {
    // Sin esto, un `vite build` roto por cualquier otro motivo daría el rojo de
    // arriba y el test celebraría una compuerta que no existe.
    const r = build({ VITE_API_URL: 'https://ejemplo.invalid' });
    expect(r.ok, `el build falló por otra causa:\n${r.salida}`).toBe(true);
  }, 180_000);

  it('⭐ el riel MOCK no la necesita: ahí no hay backend al que apuntar', () => {
    const r = build({ VITE_MOCK: '1' });
    expect(r.ok, `el mock quedó exigiendo una variable que no le corresponde:\n${r.salida}`).toBe(true);
  }, 180_000);

  it('🔴 la CI le pasa la variable a su compuerta de compilación', () => {
    // Si alguien agrega la exigencia y se olvida de esto, el gate cae en rojo
    // sin que haya nada roto — y el reflejo sería aflojar la exigencia.
    const ci = readFileSync(join(RAIZ, '.github/workflows/ci.yml'), 'utf8');
    expect(ci).toMatch(/- run: npm run build\s*\n\s*env:\s*\n\s*VITE_API_URL:/);
  });
});
