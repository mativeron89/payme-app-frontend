import { describe, expect, it } from 'vitest';
import { countdownLong } from './format';

/**
 * `countdownLong` — el countdown de la burbuja de la mesa (SPEC_APP.md §1.1).
 *
 * Se testea acá y no mirando la pantalla porque lo que importa es **el umbral**:
 * el spec dice *"bajo 1 h pasa a `--warning`"*, y cruzar los 60 minutos en un
 * navegador exige esperar o falsear el reloj de la máquina. Con `now` inyectado
 * el borde se prueba en los dos lados y en el minuto exacto.
 */

const T0 = new Date('2026-08-05T12:00:00.000Z');
const en = (min: number) => new Date(T0.getTime() + min * 60_000).toISOString();

describe('countdownLong', () => {
  it('escribe horas y minutos como los lee una persona', () => {
    expect(countdownLong(en(134), T0)).toEqual({ text: '2 h 14 min', urgent: false });
  });

  it('omite los minutos cuando son cero, en vez de decir "2 h 0 min"', () => {
    expect(countdownLong(en(120), T0)).toEqual({ text: '2 h', urgent: false });
  });

  it('bajo una hora usa solo minutos', () => {
    expect(countdownLong(en(45), T0)).toEqual({ text: '45 min', urgent: true });
  });

  /**
   * El borde exacto del spec. 60 min NO es urgente ("bajo 1 h" es estricto);
   * 59 sí. Si alguien invierte el `<` por un `<=`, este par lo mata.
   */
  it('marca urgente por debajo de la hora, y no en la hora exacta', () => {
    expect(countdownLong(en(60), T0)?.urgent).toBe(false);
    expect(countdownLong(en(59), T0)?.urgent).toBe(true);
  });

  it('el último minuto no se muestra como "0 min"', () => {
    expect(countdownLong(new Date(T0.getTime() + 30_000).toISOString(), T0)).toEqual({
      text: 'menos de 1 min',
      urgent: true,
    });
  });

  /**
   * Vencida es `null`, no un cero. La burbuja de §1.1 no dibuja countdown
   * cuando ya venció: "0 min" diría que todavía queda algo.
   */
  it('devuelve null cuando ya venció o cuando la fecha no se entiende', () => {
    expect(countdownLong(en(-1), T0)).toBeNull();
    expect(countdownLong(T0.toISOString(), T0)).toBeNull();
    expect(countdownLong('no-es-una-fecha', T0)).toBeNull();
  });
});
