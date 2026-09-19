import { describe, expect, it } from 'vitest';
import { partesDeFecha } from './fechaCorta';

describe('AF-29 · partesDeFecha («Sáb 12/09» · «21:40»)', () => {
  it('arma día, fecha y hora en la hora local', () => {
    // Construida en hora LOCAL: el resultado no depende de la zona de la máquina.
    const local = new Date(2026, 8, 12, 21, 40).toISOString();
    expect(partesDeFecha(local)).toEqual({ diaSemana: 6, diaMes: '12/09', hora: '21:40' });
  });

  it('dos dígitos siempre', () => {
    expect(partesDeFecha(new Date(2026, 0, 4, 7, 5).toISOString())).toEqual({ diaSemana: 0, diaMes: '04/01', hora: '07:05' });
  });

  it('una fecha ilegible no se inventa', () => {
    expect(partesDeFecha('ayer')).toBeNull();
    expect(partesDeFecha('')).toBeNull();
  });
});
