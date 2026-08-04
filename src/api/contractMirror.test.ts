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

/** El README de procedencia es la ÚNICA exclusión legítima. */
const PROCEDENCIA = '/contract-mirror/README.md';

const espejados = Object.keys(espejo).filter((r) => r !== PROCEDENCIA).sort();

describe('inventario del contract-mirror', () => {
  it('el glob encuentra el espejo (si no, todo lo de abajo pasa en vacío)', () => {
    expect(Object.keys(espejo).length).toBeGreaterThan(50);
    expect(Object.keys(espejo)).toContain(PROCEDENCIA);
  });

  /**
   * ⭐ El archivo que se caía del barrido. Se nombra explícitamente para que, si
   * alguien vuelve a escribir una exclusión sin anclar, este test lo diga con
   * nombre y apellido en vez de con un número que nadie va a recalcular.
   */
  it('legal/README.md está espejado y NO se excluye por llamarse README', () => {
    expect(espejados).toContain('/contract-mirror/legal/README.md');
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
  });

  it('el README declara el commit fuente con hash completo de 40 caracteres', () => {
    expect(espejo[PROCEDENCIA]!).toMatch(/Commit exacto: `[0-9a-f]{40}`/);
  });
});
