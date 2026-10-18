import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { traducir } from './idioma';

/** n79 · AF-I18N-N79 · los textos que pasaron por el traductor (cinco; D377 sacó «c/u» con el monto del contador). */
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('n79 · el español de los textos traducidos queda byte-idéntico', () => {
  /**
   * El español queda BYTE-IDÉNTICO: en español `t()` devuelve la clave, y la
   * clave es el literal que había en la base (`d566933`). Se afirma sobre la
   * función real y sobre el código que la usa.
   */
  it('🔴 los textos traducidos: el español es el de antes y hay traducción', () => {
    const LITERALES = [
      ['src/screens/CreateMesaFlow.tsx', 'No pudimos leer el ticket'],
      ['src/screens/CreateMesaFlow.tsx', 'Se alcanzó el límite mensual de lectura. Puedes cargar los consumos a mano.'],
      ['src/screens/CreateMesaFlow.tsx', 'El servicio de lectura no está disponible. Puedes cargar los consumos a mano.'],
    ] as const;
    for (const [archivo, literal] of LITERALES) {
      expect(readFileSync(join(RAIZ, archivo), 'utf8'), literal).toContain(`t('${literal}')`);
      expect(traducir(literal, 'es')).toBe(literal);
      expect(traducir(literal, 'en'), literal).not.toBe(literal);
    }
    // El nombre accesible del plato: antes `${name} por ${n}`. D360-5b · el nombre
    // es el que se muestra (`nombreDePlato`), así que la variable es `nombre`.
    expect(readFileSync(join(RAIZ, 'src/screens/MesaDetailView.tsx'), 'utf8')).toContain("t('{0} por {1}', nombre, i.quantity)");
    const nombre = 'Tiramisú';
    const cantidad = 2;
    expect(traducir('{0} por {1}', 'es', nombre, cantidad)).toBe(`${nombre} por ${cantidad}`);
    expect(traducir('{0} por {1}', 'en', nombre, cantidad)).toBe('Tiramisú × 2');
  });
});
