/**
 * D181 · la reserva de ancho de «¿Cuántos pagan?»: el monto más ancho posible
 * con el formateador que se ve, con los dígitos en 0.
 */
import { describe, expect, it } from 'vitest';
import { formatMXN } from '../utils/format';
import { splitEqual } from '../utils/money';
import { reservaDelMonto } from './reservaDelMonto';

describe('D181 · reservaDelMonto', () => {
  it('un total entero cuyos repartos llevan centavos reserva la forma con centavos', () => {
    // $840 entre 9 = $93.34: más ancho que «$840».
    expect(reservaDelMonto(84000, true)).toBe('$00.00');
  });

  it('el más ancho de TODOS los repartos posibles, de 1 a 20', () => {
    for (const total of [84000, 125000, 1990, 100, 33333]) {
      for (const reparte of [true, false]) {
        const reserva = reservaDelMonto(total, reparte);
        for (let n = 1; n <= 20; n += 1) {
          const monto = formatMXN(reparte ? splitEqual(total, n)[0]! : Math.round(total / n));
          expect(monto.length, `${total} / ${n}`).toBeLessThanOrEqual(reserva.length);
        }
      }
    }
  });

  it('con miles, el separador queda en su lugar y los dígitos en 0', () => {
    // $1,250: el más ancho es $1,250 / 3 = «$416.67», no «$1,250».
    expect(reservaDelMonto(125000, true)).toBe('$000.00');
    // $1,250.50 entero: «$1,250.50».
    expect(reservaDelMonto(125050, true)).toBe('$0,000.00');
  });

  it('«Por lo que pidió cada uno» usa el redondeo del promedio, sin centavos de reparto', () => {
    // $840 / 9 redondeado = 9333 centavos → «$93.33»: misma forma.
    expect(reservaDelMonto(84000, false)).toBe('$00.00');
    // $1 entre lo que sea: «$1», «$0.50», «$0.33»…
    expect(reservaDelMonto(100, false)).toBe('$0.00');
  });
});
