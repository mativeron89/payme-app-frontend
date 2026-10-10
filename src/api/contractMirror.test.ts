import { describe, expect, it } from 'vitest';

/**
 * ORDEN 3A · el inventario del espejo, como TEST.
 *
 * ## Por qué existe
 *
 * Dos refreshes declararon **67/67** y **68/68**, y los dos números eran falsos.
 * El comando de enumeración usaba `find . -type f | grep -v README.md` **sin
 * anclar**, así que descartaba en silencio `legal/README.md` — un archivo
 * ESPEJADO, con fuente real, que por eso **nunca se verificó contra ella**.
 *
 * El número equivocado era el síntoma. El defecto era que había un archivo del
 * espejo fuera de todo barrido, y que resultara idéntico fue suerte.
 *
 * **La lista hecha a mano no es un método: es un borrador.** Esto la reemplaza.
 *
 * ## Límite declarado, y es grande
 *
 * Este test **no compara byte a byte contra la fuente**: `../payme-app-backend`
 * está fuera de la raíz de Vite y `import.meta.glob` no llega. La paridad se
 * verifica al refrescar, con el script que documenta el README, y su resultado
 * se registra ahí. Lo que este test sí impide es que el inventario cambie sin
 * que nadie lo note, y que el número escrito y el número real se separen.
 */

const espejo = import.meta.glob('/contract-mirror/**/*', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const inventarioRaw = import.meta.glob('/scripts/mirror-inventory.json', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

interface MirrorInventory {
  commit: string;
  total: number;
  archivos: Array<{ origen: string; destino: string }>;
}

/** D268 · S-03 · lo que el espejo público copia: los JSON de `contract/`. El resto del inventario, sólo por hash. */
const SE_COPIA = (destino: string) => /^contract\/[^/]+\.json$/.test(destino);

function inventario(): MirrorInventory {
  const raw = inventarioRaw['/scripts/mirror-inventory.json'];
  expect(raw, 'no se encontró el inventario autoritativo adoptado').toBeTruthy();
  return JSON.parse(raw!) as MirrorInventory;
}

/** El README de procedencia es la ÚNICA exclusión legítima. */
const PROCEDENCIA = '/contract-mirror/README.md';

const espejados = Object.keys(espejo).filter((r) => r !== PROCEDENCIA).sort();

describe('inventario del contract-mirror', () => {
  it('el glob encuentra el espejo (si no, todo lo de abajo pasa en vacío)', () => {
    expect(espejados.length).toBeGreaterThan(10);
    expect(Object.keys(espejo)).toContain(PROCEDENCIA);
  });

  /**
   * 🔴 D268 · S-03 · el repo es público: en el espejo está EXACTAMENTE lo que el
   * inventario del dueño declara como contrato (`contract/*.json`), ni un
   * archivo del servidor. Se compara contra el inventario, no contra una lista
   * a mano: si el dueño agrega un contrato, falta acá; si alguien vuelve a
   * copiar código, sobra.
   */
  it('🔴 D268 · el espejo es exactamente el contrato del inventario: sin código del servidor ni documentos', () => {
    const delInventario = inventario().archivos.filter((a) => SE_COPIA(a.destino)).map((a) => `/contract-mirror/${a.destino}`).sort();
    expect(espejados).toEqual(delInventario);
    for (const r of espejados) expect(r, r).toMatch(/^\/contract-mirror\/contract\/[^/]+\.json$/);
    // Lo que se iba antes, nombrado: ni el código, ni `legal/README.md`, ni el settlement renombrado.
    for (const fuera of ['/contract-mirror/routes/mesas.js', '/contract-mirror/middleware/auth.js',
      '/contract-mirror/schemas/index.js', '/contract-mirror/legal/README.md', '/contract-mirror/docs/settlement.js.ref']) {
      expect(Object.keys(espejo)).not.toContain(fuera);
    }
  });

  it('la única exclusión es el README de procedencia de la raíz', () => {
    const excluidos = Object.keys(espejo).filter((r) => !espejados.includes(r));
    expect(excluidos).toEqual([PROCEDENCIA]);
  });

  /**
   * El conteo que el README declara tiene que ser el real. Si alguien agrega o
   * saca un archivo del espejo y no toca la procedencia, esto se pone rojo — que
   * es exactamente lo que no pasó las dos veces anteriores.
   */
  it('el número declarado en el README es el número real', () => {
    const readme = espejo[PROCEDENCIA];
    expect(readme, 'no se encontró el README de procedencia').toBeTruthy();
    const m = /\*\*(\d+) archivos espejados\*\*/.exec(readme!);
    expect(m, 'el README debe declarar "**N archivos espejados**"').toBeTruthy();
    expect(Number(m![1])).toBe(espejados.length);
    // D268 · el inventario es el del dueño (138); en el espejo, sólo lo que se copia.
    expect(inventario().archivos.filter((a) => SE_COPIA(a.destino)).length).toBe(espejados.length);
    expect(inventario().total).toBe(inventario().archivos.length);
  });

  it('la procedencia VIGENTE declara exactamente el commit del inventario', () => {
    const readme = espejo[PROCEDENCIA]!;
    const vigente = readme.split('### Refresh anterior', 1)[0] ?? '';
    const hashes = [...vigente.matchAll(/`([0-9a-f]{40})`/g)].map((m) => m[1]);
    expect(hashes.length, 'la procedencia vigente debe declarar al menos contenido y publicación')
      .toBeGreaterThanOrEqual(2);
    expect(hashes[0]).toBe(inventario().commit);
  });
});
