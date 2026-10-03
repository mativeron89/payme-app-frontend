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

describe('D158 · visitas, zona personal explícita sin cambiar estadísticas', () => {
  it('MX conserva formato24h y día del instante leído en CDMX', () => {
    expect(partesDeFecha('2026-01-01T04:30:00Z', 'America/Mexico_City'))
      .toEqual({ diaSemana: 3, diaMes: '31/12', hora: '22:30' });
  });
  it('Madrid presenta el mismo instante en otro día, no otra visita', () => {
    expect(partesDeFecha('2026-01-01T04:30:00Z', 'Europe/Madrid'))
      .toEqual({ diaSemana: 4, diaMes: '01/01', hora: '05:30' });
  });
  it('sinIntl/zone no inventa día de semana: ISO neutral visible', () => {
    expect(partesDeFecha('2026-01-01T04:30:00Z', null))
      .toEqual({ diaSemana: null, diaMes: '2026-01-01T04:30:00.000Z', hora: '' });
  });
  it('date-only/naive/imposible no se atribuyen a una zona original', () => {
    for (const iso of ['2026-01-01', '2026-01-01T04:30:00', '2026-02-30T04:30:00Z']) {
      expect(partesDeFecha(iso, 'Europe/Madrid')).toBeNull();
    }
  });
});
