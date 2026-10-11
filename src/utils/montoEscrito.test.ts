import { describe, expect, it } from 'vitest';
import { leerMonto } from './montoEscrito';

/**
 * 🔴 F-03 · V-04 (auditorías de Codex) · «12,50» se volvía $1,250 en un gasto a mano: el lector borraba todas las
 * comas. Ahora se reconocen los formatos inequívocos y los ambiguos se rechazan, nunca se adivinan (criterio aprobado
 * por el Bibliotecario: la coma con tres cifras son miles, como en México; un punto con tres cifras es ambiguo).
 */
const cents = (texto: string) => {
  const m = leerMonto(texto);
  return m.tipo === 'ok' ? m.cents : m.tipo;
};

describe('🔴 F-03 · el monto escrito, en centavos enteros', () => {
  it('la lista de Codex: «12,50» y «12.50» son $12.50; «1,250.00» y «1.250,00» son $1,250', () => {
    expect(cents('12,50')).toBe(1250);
    expect(cents('12.50')).toBe(1250);
    expect(cents('1,250.00')).toBe(125000);
    expect(cents('1.250,00')).toBe(125000);
    // Los controles de la auditoría total.
    expect(cents('1,200.50')).toBe(120050);
  });

  it.each([
    ['1200', 120000], ['12,5', 1250], ['12.5', 1250], ['0,50', 50], ['0.01', 1], ['$ 85.5 ', 8550],
    ['1,250', 125000], ['1,000,000', 100_000_000], ['1,250.5', 125050],
    ['1.250,5', 125050], ['1.250.000', 125_000_000], ['1.250.000,75', 125_000_075],
  ])('inequívoco: «%s» → %i centavos', (texto, esperado) => {
    expect(cents(texto)).toBe(esperado);
  });

  it.each(['1.250', '12.345', '12.505', '999.000', '1.000'])('🔴 ambiguo, se rechaza: «%s» (¿miles o decimales?)', (texto) => {
    expect(cents(texto)).toBe('ambiguo');
  });

  it.each([
    '1,25,0', '1,2,3', '12,345,67', '1.250.00', '1,250,50', '12,50.00', '1.250,000', '0,250', '0.250', '12.345.6',
    '12.', '12,', '.5', ',5', '1..2', '1250.505', 'abc', '-5', '1e3', '0', '0,00', '0.00', '99999999', '12345678.00',
  ])('inválido: «%s»', (texto) => {
    expect(cents(texto)).toBe('invalido');
  });

  it('vacío no es inválido: todavía no se escribió nada', () => {
    expect(leerMonto('')).toEqual({ tipo: 'vacio' });
    expect(leerMonto('  $ ')).toEqual({ tipo: 'vacio' });
  });

  it('nunca un float: siempre centavos enteros', () => {
    for (const t of ['0,1', '0.07', '1,234,567.89', '1.234.567,89']) {
      const m = leerMonto(t);
      expect(m.tipo, t).toBe('ok');
      if (m.tipo === 'ok') expect(Number.isSafeInteger(m.cents), t).toBe(true);
    }
    expect(cents('1,234,567.89')).toBe(123456789);
    expect(cents('1.234.567,89')).toBe(123456789);
  });
});
