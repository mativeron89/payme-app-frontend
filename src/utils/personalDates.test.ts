import { describe, expect, it, vi } from 'vitest';
import { personalDateLabel, personalDateParts, personalInstant, personalMonth, personalZoneCaption, supportsTimeZone } from './personalDates';
import { nombreDelPeriodo } from './meses';

const mx = 'America/Mexico_City';
const es = 'Europe/Madrid';
const t = (text: string) => text;

describe('D158 · instantes, no fechas civiles ni zona inventada', () => {
  it.each([
    '', 'ayer', '2026-01-01', '2026-01-01T01:00:00',
    '2026-02-30T00:00:00Z', '2025-02-29T00:00:00Z', '2026-00-01T00:00:00Z',
    '2026-13-01T00:00:00Z', '2026-01-00T00:00:00Z', '2026-01-01T24:00:00Z',
    '2026-01-01T00:60:00Z', '2026-01-01T00:00:60Z', '2026-01-01T00:00:00+24:00',
    '2026-01-01T00:00:00+01:60',
  ])('no normaliza ni infiere instante (%s)', (iso) => {
    expect(personalInstant(iso)).toBeNull();
    expect(personalDateLabel(iso, 'es-MX', mx, t)).toBe('Fecha no disponible');
    expect(personalMonth(iso, 'es-MX', mx)).toEqual({ key: 'sin-fecha', label: 'Sin fecha' });
  });
  it('acepta leap real, fracciones y offset explícito sin modificar el instante', () => {
    expect(personalInstant('2024-02-29T23:45:12.345-06:00')?.toISOString()).toBe('2024-03-01T05:45:12.345Z');
    expect(personalInstant('2026-01-01T00:00:00.1Z')?.toISOString()).toBe('2026-01-01T00:00:00.100Z');
  });
  it('mismo instante cambia día/año/mes visible, no el ISO de entrada', () => {
    const iso = '2026-01-01T04:30:00.000Z';
    expect(personalDateParts(iso, mx)).toMatchObject({ year: 2025, month: 12, day: 31, hour: 22, minute: 30, weekday: 3 });
    expect(personalDateParts(iso, es)).toMatchObject({ year: 2026, month: 1, day: 1, hour: 5, minute: 30, weekday: 4 });
    expect(iso).toBe('2026-01-01T04:30:00.000Z');
    const Original = Intl.DateTimeFormat;
    const ctor = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (...args: Parameters<typeof Intl.DateTimeFormat>) {
      return new Original(...args);
    });
    try {
      const now = new Date('2026-02-01T12:00:00Z');
      for (let row = 0; row < 100; row++) {
        expect(personalDateParts(iso, mx)).toMatchObject({ year: 2025, day: 31, hour: 22 });
        expect(personalMonth(iso, 'es-MX', mx)).toEqual({ key: '2025-12', label: 'diciembre de 2025' });
        expect(personalDateLabel(iso, 'es-MX', mx, t, now)).toBe('31 dic');
      }
      expect(ctor).toHaveBeenCalledTimes(3); // partes, mes y fecha, no uno por fila.
      // Reutilizar la plantilla no congela el instante ni el día actual.
      expect(personalDateParts('2026-01-02T04:30:00Z', mx)).toMatchObject({ year: 2026, day: 1 });
      expect(personalDateLabel(iso, 'es-MX', mx, t, new Date('2026-01-01T05:00:00Z'))).toBe('Hoy');
      expect(ctor).toHaveBeenCalledTimes(3);
    } finally { ctor.mockRestore(); }
  });
  it('a pocos minutos de medianoche, menos24h todavía puede ser Ayer', () => {
    expect(personalDateLabel('2026-09-30T05:50:00Z', 'es-MX', mx, t, new Date('2026-09-30T06:10:00Z'))).toBe('Ayer');
  });
  it('mismo día calendario es Hoy, aunque el reloj del host use otra zona', () => {
    expect(personalDateLabel('2026-09-30T06:01:00Z', 'es-MX', mx, t, new Date('2026-09-30T23:00:00Z'))).toBe('Hoy');
  });
  it('futuro no se llama Ayer ni Hoy por resto negativo', () => {
    const label = personalDateLabel('2026-10-02T12:00:00Z', 'es-MX', mx, t, new Date('2026-09-30T12:00:00Z'));
    expect(label).not.toBe('Hoy');
    expect(label).not.toBe('Ayer');
  });
  it('mes personal y label usan la misma zona, locales es/en preservados', () => {
    const iso = '2026-01-01T04:30:00Z';
    expect(personalMonth(iso, 'es-MX', mx)).toEqual({ key: '2025-12', label: 'diciembre de 2025' });
    expect(personalMonth(iso, 'en-US', es)).toEqual({ key: '2026-01', label: 'January 2026' });
  });
  it('salto estacional New York desde instantes: 01:59→03:00, sin offset fijo', () => {
    expect(personalDateParts('2026-03-08T06:59:00Z', 'America/New_York')).toMatchObject({ hour: 1, minute: 59 });
    expect(personalDateParts('2026-03-08T07:00:00Z', 'America/New_York')).toMatchObject({ hour: 3, minute: 0 });
  });
  it('hora repetida estacional: dos instantes distintos conservan diferencia', () => {
    const a = '2026-11-01T05:30:00Z', b = '2026-11-01T06:30:00Z';
    expect(personalDateParts(a, 'America/New_York')).toMatchObject({ hour: 1, minute: 30 });
    expect(personalDateParts(b, 'America/New_York')).toMatchObject({ hour: 1, minute: 30 });
    expect(personalInstant(b)!.getTime() - personalInstant(a)!.getTime()).toBe(3_600_000);
  });
  it('UTC fallback es UTC explícito; sin zona sólo ISO neutral', () => {
    const iso = '2026-01-01T04:30:00Z';
    expect(personalDateParts(iso, 'UTC')).toMatchObject({ day: 1, hour: 4 });
    expect(personalDateLabel(iso, 'es-MX', null, t)).toBe('2026-01-01T04:30:00.000Z');
    expect(personalMonth(iso, 'es-MX', null)).toEqual({ key: '2026-01', label: '2026-01 (UTC)' });
    expect(personalDateParts(iso, mx)).not.toBeNull();
    const unavailable = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function () {
      throw new RangeError('Intl no disponible para esta prueba');
    });
    try {
      expect(supportsTimeZone(mx)).toBe(false);
      expect(personalDateParts(iso, mx)).toBeNull();
      expect(personalDateLabel(iso, 'es-MX', mx, t)).toBe('2026-01-01T04:30:00.000Z');
      expect(personalMonth(iso, 'es-MX', mx)).toEqual({ key: '2026-01', label: '2026-01 (UTC)' });
    } finally { unavailable.mockRestore(); }
    expect(personalDateParts(iso, mx)).toMatchObject({ day: 31, hour: 22 });
  });
  it('zona imposible no cae a hora del teléfono', () => {
    expect(supportsTimeZone('No/Existe')).toBe(false);
    expect(personalDateParts('2026-01-01T04:30:00Z', 'No/Existe')).toBeNull();
    expect(personalDateLabel('2026-01-01T04:30:00Z', 'es-MX', 'No/Existe', t)).toBe('2026-01-01T04:30:00.000Z');
    const Original = Intl.DateTimeFormat;
    const ctor = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (...args: Parameters<typeof Intl.DateTimeFormat>) {
      return new Original(...args);
    });
    try {
      const iso = '2026-01-01T04:30:00Z';
      const zones = [mx, es, 'America/New_York', 'America/Chicago', 'America/Los_Angeles',
        'America/Lima', 'America/Bogota', 'America/Argentina/Buenos_Aires', 'America/Santiago'];
      for (const zone of zones.slice(0, 8)) expect(personalDateParts(iso, zone)).not.toBeNull();
      expect(ctor).toHaveBeenCalledTimes(8);
      personalDateParts(iso, zones[0]!); // refresca la primera: la segunda será la expulsada.
      personalDateParts(iso, zones[8]!);
      personalDateParts(iso, zones[0]!);
      expect(ctor).toHaveBeenCalledTimes(9);
      personalDateParts(iso, zones[1]!);
      expect(ctor).toHaveBeenCalledTimes(10); // LRU acotada a ocho, no caché sin límite.
      expect(supportsTimeZone('No/Existe')).toBe(false);
      expect(supportsTimeZone('No/Existe')).toBe(false);
      expect(ctor).toHaveBeenCalledTimes(12); // tampoco se almacenan errores.
    } finally { ctor.mockRestore(); }
  });
  it('caption distingue elegido/fallbackUTC/ISO, sin zona histórica', () => {
    const translate = (text: string, ...args: unknown[]) => text.replace('{0}', String(args[0]));
    expect(personalZoneCaption(mx, translate)).toContain(mx);
    expect(personalZoneCaption(mx, translate)).toContain('no indican la zona original');
    expect(personalZoneCaption('UTC', translate)).toContain('Fallback UTC');
    expect(personalZoneCaption(null, translate)).toContain('ISO UTC');
  });
  it('período estadístico México permanece contractual, no mes personal Madrid', async () => {
    const start = '2026-08-01T06:00:00Z';
    expect(nombreDelPeriodo('this_month', start, 'es', new Date(start))).toBe('Agosto');
    expect(nombreDelPeriodo('last_3_months', start, 'es', new Date(start))).toBeNull();
    const Original = Intl.DateTimeFormat;
    const ctor = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (...args: Parameters<typeof Intl.DateTimeFormat>) {
      return new Original(...args);
    });
    try {
      vi.resetModules();
      const fresh = await import('./personalDates');
      expect(ctor).not.toHaveBeenCalled(); // módulo importable sin consultar Intl.
      expect(fresh.supportsTimeZone(mx)).toBe(true);
      expect(fresh.supportsTimeZone(mx)).toBe(true);
      expect(ctor).toHaveBeenCalledTimes(1);
    } finally { ctor.mockRestore(); }
  });
});
