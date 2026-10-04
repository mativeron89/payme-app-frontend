import { afterEach, describe, expect, it, vi } from 'vitest';
import { REGION_COUNTRIES } from './regionCatalog';
import { groupTimeZones, timeZoneDisplay, utcOffsetLabel, zoneForGroup } from './timezoneDisplay';

const winter = new Date('2026-01-15T12:30:00Z');
const summer = new Date('2026-07-15T12:30:00Z');
afterEach(() => vi.restoreAllMocks());

describe('D169 · grupos de presentación UTC sin perder IANA', () => {
  it('offset y hora salen del mismo instante, con DST real', () => {
    expect(timeZoneDisplay('America/Mexico_City', winter)).toEqual({ offsetMinutes: -360, time: '06:30' });
    expect(timeZoneDisplay('America/Mexico_City', summer)).toEqual({ offsetMinutes: -360, time: '06:30' });
    expect(timeZoneDisplay('America/New_York', winter)).toEqual({ offsetMinutes: -300, time: '07:30' });
    expect(timeZoneDisplay('America/New_York', summer)).toEqual({ offsetMinutes: -240, time: '08:30' });
    expect(timeZoneDisplay('America/Matamoros', winter)?.offsetMinutes).toBe(-360);
    expect(timeZoneDisplay('America/Matamoros', summer)?.offsetMinutes).toBe(-300);
  });
  it('admite UTC y offsets fraccionarios, sin ampliar el catálogo', () => {
    expect(timeZoneDisplay('UTC', winter)).toEqual({ offsetMinutes: 0, time: '12:30' });
    expect(timeZoneDisplay('Asia/Kathmandu', winter)).toEqual({ offsetMinutes: 345, time: '18:15' });
    expect(timeZoneDisplay('America/St_Johns', winter)).toEqual({ offsetMinutes: -210, time: '09:00' });
    expect(utcOffsetLabel(0)).toBe('UTC');
    expect(utcOffsetLabel(-360)).toBe('UTC−6');
    expect(utcOffsetLabel(345)).toBe('UTC+5:45');
    expect(utcOffsetLabel(-210)).toBe('UTC−3:30');
  });
  it('medianoche se muestra 00 y el minuto se vuelve a calcular', () => {
    expect(timeZoneDisplay('America/Mexico_City', new Date('2026-01-15T06:00:00Z'))?.time).toBe('00:00');
    const first = timeZoneDisplay('America/Mexico_City', winter);
    const second = timeZoneDisplay('America/Mexico_City', new Date(winter.getTime() + 60_000));
    expect(first?.time).toBe('06:30'); expect(second?.time).toBe('06:31');
  });
  it('no congela México en tres grupos: Tijuana cambia entre verano e invierno', () => {
    const zones = REGION_COUNTRIES.find((c) => c.code === 'MX')!.zones;
    expect(groupTimeZones(zones, summer).groups.map((g) => g.offsetMinutes)).toEqual([-360, -300, -420]);
    expect(groupTimeZones(zones, winter).groups.map((g) => g.offsetMinutes)).toEqual([-360, -300, -420, -480]);
  });
  it('cada zona del catálogo aparece exactamente una vez; grupos únicos y sin mutar catálogo', () => {
    for (const country of REGION_COUNTRIES) for (const instant of [winter, summer]) {
      const before = [...country.zones], result = groupTimeZones(country.zones, instant);
      const represented = [...result.groups.flatMap((g) => g.zones), ...result.unavailable];
      expect([...represented].sort()).toEqual([...before].sort());
      expect(new Set(represented).size).toBe(before.length);
      expect(new Set(result.groups.map((g) => g.offsetMinutes)).size).toBe(result.groups.length);
      expect(country.zones).toEqual(before);
      for (const group of result.groups) for (const zone of group.zones) {
        expect(timeZoneDisplay(zone, instant)).toEqual({ offsetMinutes: group.offsetMinutes, time: group.time });
      }
    }
  });
  it('elegir el mismo grupo conserva IANA no representante, incluso tras cambio estacional', () => {
    const zones = REGION_COUNTRIES.find((c) => c.code === 'MX')!.zones;
    for (const instant of [winter, summer]) {
      const group = groupTimeZones(zones, instant).groups.find((g) => g.zones.includes('America/Matamoros'))!;
      expect(zoneForGroup(group, 'America/Matamoros')).toBe('America/Matamoros');
      expect(zoneForGroup(group, '')).toBe(group.zones[0]);
      expect(zoneForGroup(group, 'Europe/Madrid')).toBe(group.zones[0]);
    }
  });
  it('selección de otro grupo sólo toma un representante disponible y determinístico', () => {
    const result = groupTimeZones(['America/Mexico_City', 'America/Merida', 'America/Cancun'], summer,
      (zone) => zone !== 'America/Mexico_City');
    expect(result.unavailable).toEqual(['America/Mexico_City']);
    expect(zoneForGroup(result.groups[0]!, 'America/Mexico_City')).toBe('America/Merida');
    expect(zoneForGroup(result.groups[1]!, 'America/Merida')).toBe('America/Cancun');
  });
  it('Intl fallido, IANA inválido e instante inválido no inventan UTC ni bloquean el render', () => {
    expect(timeZoneDisplay('synthetic/invalid', winter)).toBeNull();
    expect(timeZoneDisplay('UTC', new Date(NaN))).toBeNull();
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function () { throw new RangeError('synthetic unsupported'); });
    expect(timeZoneDisplay('America/Mexico_City', winter)).toBeNull();
    expect(groupTimeZones(['America/Mexico_City'], winter)).toEqual({ groups: [], unavailable: ['America/Mexico_City'] });
  });
});
