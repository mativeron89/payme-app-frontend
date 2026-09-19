import { describe, expect, it } from 'vitest';
import { mesCorto, mesLargo, mesesDeMexico, nombreDelPeriodo, pesosCortos } from './meses';

describe('AF-31 · meses de 2f', () => {
  it('mes corto con mayúscula y sin punto, en los dos idiomas', () => {
    expect(mesCorto('2026-04-01T06:00:00.000Z', 'es')).toBe('Abr');
    expect(mesCorto('2026-09-01T06:00:00.000Z', 'es')).toBe('Sep');
    expect(mesCorto('2026-03-01T06:00:00.000Z', 'en')).toBe('Mar');
  });

  it('el 1 a las 00:00 de México sigue siendo ese mes', () => {
    expect(mesLargo('2026-09-01T06:00:00.000Z', 'es')).toBe('septiembre');
  });

  it('pesos cortos redondeados, con separador de miles', () => {
    expect(pesosCortos(61200)).toBe('$612');
    expect(pesosCortos(216500)).toBe('$2,165');
    expect(pesosCortos(0)).toBe('$0');
  });
});

describe('AF-36 · el nombre del período en la burbuja', () => {
  const SEP = new Date('2026-09-19T16:00:00Z');

  it('lee el `period.start` del dueño (medianoche de México = 06:00Z)', () => {
    expect(nombreDelPeriodo('this_month', '2026-09-01T06:00:00.000Z', 'es', SEP)).toBe('Septiembre');
    expect(nombreDelPeriodo('last_month', '2026-08-01T06:00:00.000Z', 'es', SEP)).toBe('Agosto');
    expect(nombreDelPeriodo('this_year', '2026-01-01T06:00:00.000Z', 'es', SEP)).toBe('2026');
    expect(nombreDelPeriodo('this_month', '2026-09-01T06:00:00.000Z', 'en', SEP)).toBe('September');
  });

  it('«Últimos 3 meses» no tiene nombre de mes: la pantalla usa su rótulo', () => {
    expect(nombreDelPeriodo('last_3_months', '2026-07-01T06:00:00.000Z', 'es', SEP)).toBeNull();
  });

  it('🔴 el 31 a las 23:30 de México todavía es ese mes, aunque en UTC ya sea el 1', () => {
    const ultimaNoche = new Date('2026-09-01T05:30:00Z'); // 31 de agosto, 23:30 en México
    expect(nombreDelPeriodo('this_month', null, 'es', ultimaNoche)).toBe('Agosto');
    expect(mesesDeMexico(ultimaNoche, 'es')).toEqual({ actual: 'Agosto', anterior: 'Julio' });
    // …y el inicio de un mes del dueño, leído en México, es ese mes y no el anterior.
    expect(nombreDelPeriodo('this_month', '2026-09-01T06:00:00.000Z', 'es', ultimaNoche)).toBe('Septiembre');
  });

  it('sin `period` del dueño: el mes en curso de México', () => {
    expect(nombreDelPeriodo('this_month', null, 'es', SEP)).toBe('Septiembre');
    expect(nombreDelPeriodo('this_month', 'no-es-fecha', 'es', SEP)).toBe('Septiembre');
  });

  it('enero: el mes anterior es diciembre del año pasado', () => {
    expect(mesesDeMexico(new Date('2027-01-10T18:00:00Z'), 'es')).toEqual({ actual: 'Enero', anterior: 'Diciembre' });
  });
});
