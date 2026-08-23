import { describe, expect, it } from 'vitest';
import { filaPropina, rotuloPropina } from './propinaRecibo';

describe('rótulo de propina del comprobante · lo que no se sabe no se nombra', () => {
  it('con las dos cosas, trae porcentaje y nombre', () => {
    expect(rotuloPropina({ pct: 10, nombre: 'Ana' })).toEqual({
      clave: 'Propina ({0}% · {1})',
      args: [10, 'Ana'],
    });
  });

  it('🔴 monto libre: NO se inventa un porcentaje', () => {
    expect(rotuloPropina({ pct: null, nombre: 'Ana' })).toEqual({
      clave: 'Propina (para {0})',
      args: ['Ana'],
    });
  });

  it('🔴 sin destinatario elegido: NO se inventa un nombre', () => {
    expect(rotuloPropina({ pct: 15, nombre: null })).toEqual({
      clave: 'Propina ({0}%)',
      args: [15],
    });
  });

  it('sin ninguno de los dos, queda el rótulo pelado — nunca «para —» ni «0%»', () => {
    expect(rotuloPropina({ pct: null, nombre: null })).toEqual({ clave: 'Propina', args: [] });
  });

  it('🔴 el 0% es un porcentaje ELEGIDO y se dice, no se confunde con «no eligió»', () => {
    // La fila entera se oculta con tipCents === 0, así que este caso sólo
    // llega si alguien deja 0% con un monto custom encima. Igual: 0 no es null.
    expect(rotuloPropina({ pct: 0, nombre: 'Ana' }).args).toEqual([0, 'Ana']);
  });
});

describe('🔴 la fila de propina: una sola decisión para las TRES superficies', () => {
  it('sin propina, la fila NO va — y eso es la mitad que se había desincronizado', () => {
    expect(filaPropina(0, { pct: 0, nombre: 'Ana' })).toBeNull();
    expect(filaPropina(0, { pct: null, nombre: null })).toBeNull();
  });

  it('con propina, devuelve el mismo rótulo que la vista', () => {
    expect(filaPropina(2100, { pct: 10, nombre: 'Ana' })).toEqual(
      rotuloPropina({ pct: 10, nombre: 'Ana' }),
    );
  });

  it('un importe negativo tampoco imprime fila: no se afirma una propina que no existe', () => {
    expect(filaPropina(-1, { pct: 10, nombre: 'Ana' })).toBeNull();
  });

  /**
   * 🔴 EL CASO QUE CODEX PIDIÓ: *«no hay caso que obligue a que vista,
   * descarga y compartido expresen la misma semántica»*. Éste obliga.
   *
   * No se puede comparar el JSX contra el texto sin montar la app (jsdom está
   * vetado), así que se verifica lo que SÍ es verificable y es lo que importa:
   * que **ninguna superficie decida por su cuenta**. Si alguien vuelve a
   * escribir el rótulo a mano —o a repetir el `tip > 0` suelto— en cualquiera
   * de las dos, esto se pone rojo.
   */
  it('🔴 ninguna superficie de MesaScreen decide la propina por su cuenta', () => {
    const src = (
      import.meta.glob('/src/screens/MesaScreen.tsx', {
        query: '?raw',
        import: 'default',
        eager: true,
      }) as Record<string, string>
    )['/src/screens/MesaScreen.tsx']!;
    const vivo = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    // El rótulo viejo, escrito a mano, no vuelve por ninguna vía.
    expect(vivo).not.toMatch(/Propina \(al mesero\)/);
    // Las DOS superficies —la vista y `receiptText()`— pasan por la decisión
    // única, y no hay una tercera que la esquive.
    const usos = [...vivo.matchAll(/filaPropina\(/g)].length;
    expect(usos, 'la vista y receiptText tienen que usar filaPropina, y sólo ellas').toBe(2);
    // Y nadie repite la mitad de la omisión por fuera de la función.
    expect(vivo).not.toMatch(/result\.tip\s*>\s*0/);
  });
});
