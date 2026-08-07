import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * EL GATE DEL ESPEJO, PROBADO COMO CAJA NEGRA (ORDEN 1-C·C).
 *
 * El verificador es el gate que decide si el contrato copiado sigue siendo el
 * que el emisor publicó — y hasta el 2026-08-07 **reportaba diferencias y
 * devolvía exit 0**. Ahora corta, pero eso también hay que poder acreditarlo
 * sin ejecutarlo a mano: acá se ejercita el script REAL contra fixtures.
 *
 * ## Cómo se prueba sin tocar el script
 *
 * El verificador resuelve sus rutas desde su PROPIA ubicación
 * (`$(dirname $0)/../contract-mirror` y `$(dirname $0)/mirror.manifest.sha256`),
 * así que se lo COPIA a un árbol temporal con esa misma forma. Copiar no es
 * modificar: el archivo del repo no se toca, y si alguien lo cambia, estos
 * tests ejercitan la versión nueva.
 *
 * Se usa el modo `--manifiesto`, que es el que corre la CI y el único que no
 * necesita el repo hermano.
 */

let raiz: string;
let scripts: string;
let espejo: string;

const SCRIPT_REAL = join(__dirname, 'verificar-mirror.sh');

function correr(): number {
  try {
    execFileSync('bash', [join(scripts, 'verificar-mirror.sh'), '--manifiesto'], {
      stdio: 'pipe',
    });
    return 0;
  } catch (e) {
    return (e as { status?: number }).status ?? -1;
  }
}

/** Escribe un archivo del espejo falso y devuelve su ruta relativa. */
function archivo(rel: string, contenido: string): string {
  const abs = join(espejo, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, contenido);
  return rel;
}

function generarManifiesto(): void {
  execFileSync('bash', [join(scripts, 'verificar-mirror.sh'), '--generar-manifiesto'], {
    stdio: 'pipe',
  });
}

beforeEach(() => {
  raiz = mkdtempSync(join(tmpdir(), 'mirror-gate-'));
  scripts = join(raiz, 'scripts');
  espejo = join(raiz, 'contract-mirror');
  mkdirSync(scripts, { recursive: true });
  mkdirSync(espejo, { recursive: true });
  copyFileSync(SCRIPT_REAL, join(scripts, 'verificar-mirror.sh'));
  archivo('README.md', '# procedencia falsa\n\n- Commit exacto: `' + 'a'.repeat(40) + '`\n');
  archivo('routes/mesas.js', 'module.exports = 1;\n');
  archivo('docs/nota.md', 'nota\n');
});

afterEach(() => {
  rmSync(raiz, { recursive: true, force: true });
});

describe('el gate del espejo corta por exit code', () => {
  it('espejo intacto contra su manifiesto → 0', () => {
    generarManifiesto();
    expect(correr()).toBe(0);
  });

  it('un archivo CAMBIADO → 1 (el defecto original: esto devolvía 0)', () => {
    generarManifiesto();
    archivo('routes/mesas.js', 'module.exports = 2; // alguien lo tocó\n');
    expect(correr()).toBe(1);
  });

  it('un archivo BORRADO del espejo → 1', () => {
    generarManifiesto();
    rmSync(join(espejo, 'routes/mesas.js'));
    expect(correr()).toBe(1);
  });

  it('un archivo DE MÁS (intruso) → 1 · la dirección que el verificador viejo callaba', () => {
    generarManifiesto();
    archivo('routes/colado.js', 'no estaba en el inventario\n');
    expect(correr()).toBe(1);
  });

  it('sin manifiesto → 2 · el que no puede verificar FALLA, no aprueba', () => {
    expect(correr()).toBe(2);
  });

  it('el README no entra al inventario: cambiarlo no rompe la paridad', () => {
    // Es la procedencia, no contrato — y por eso se lo puede editar (por
    // ejemplo para marcar un cierre como provisional) sin tocar el manifiesto.
    generarManifiesto();
    archivo('README.md', '# otra prosa\n\n- Commit exacto: `' + 'b'.repeat(40) + '`\n');
    expect(correr()).toBe(0);
  });

  /**
   * 🔴 DEFECTO CONOCIDO, PENDIENTE POR ORDEN.
   *
   * El chequeo de intruso hace `grep -F "  $rel"` sobre el manifiesto: una
   * búsqueda de SUBCADENA anclada sólo por la izquierda (los dos espacios que
   * separan hash y path en la salida de `shasum`). Un archivo cuyo path es
   * PREFIJO del de otra entrada pasa como inventariado sin estarlo.
   *
   * `test.fails` a propósito: documenta el defecto Y AVISA CUANDO SE ARREGLE
   * —al pasar, este test se pone rojo y obliga a sacarle el marcador—, en vez
   * de un `skip` que se olvida o de un test que fija el bug como si fuera la
   * conducta correcta. La orden 1-C·C dijo "sólo los tests: no toques el
   * verificador todavía".
   */
  it.fails('PENDIENTE · un path que es PREFIJO de otro debería contar como intruso', () => {
    generarManifiesto(); // inventaría docs/nota.md, entre otros
    // Precondición VERIFICADA: sin el intruso el fixture está sano. Sin esta
    // línea, un fixture roto (exit 2) también haría "pasar" un `it.fails` — la
    // trampa del marcador es que cualquier fallo lo satisface, así que el
    // único fallo posible tiene que ser el que se está documentando.
    expect(correr()).toBe(0);
    // `docs/nota.m` es prefijo de `docs/nota.md`: nunca fue inventariado.
    archivo('docs/nota.m', 'intruso que se disfraza de prefijo\n');
    expect(correr()).toBe(1);
  });
});
