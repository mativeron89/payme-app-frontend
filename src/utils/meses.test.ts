import { describe, expect, it } from 'vitest';
import { mesCorto, mesLargo, pesosCortos } from './meses';

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
