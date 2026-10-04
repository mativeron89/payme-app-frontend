import { describe, expect, it, vi } from 'vitest';
import { REGION_COUNTRIES, zoneLabel } from './regionCatalog';
import { DEFAULT_REGION, DEFAULT_AUTOMATIC_REGION, REGION_KEY, defaultRegionState, loadRegion, parseRegion, readDeviceTimeZone, refreshAutomaticRegion, resetRegion, saveRegion, type RegionStorage } from './regionPreference';
import { supportsTimeZone } from '../utils/personalDates';
import { personalDateParts } from '../utils/personalDates';
import { timeZoneDisplay } from './timezoneDisplay';
import { countdownLong } from '../utils/format';

class MemoryStorage implements RegionStorage {
  readonly values = new Map<string, string>();
  readonly operations: string[] = [];
  getItem(key: string) { this.operations.push('get:' + key); return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.operations.push('set:' + key); this.values.set(key, value); }
  removeItem(key: string) { this.operations.push('remove:' + key); this.values.delete(key); }
}
const allSupported = () => true;
const colombia = { country: 'CO', timeZone: 'America/Bogota' } as const;
const pairs = REGION_COUNTRIES.flatMap((country) => country.zones.map((timeZone) => ({ country: country.code, timeZone })));

describe('D158 · catálogo finito/runtime, NO certificado mundial', () => {
  it('son7países/62pares únicos y conteos por país fijados antes de código', () => {
    expect(REGION_COUNTRIES).toHaveLength(7);
    expect(pairs).toHaveLength(62);
    expect(new Set(pairs.map((p) => p.country + '/' + p.timeZone)).size).toBe(62);
    expect(Object.fromEntries(REGION_COUNTRIES.map((c) => [c.code, c.zones.length])))
      .toEqual({ MX: 12, CO: 1, PE: 1, AR: 12, CL: 4, ES: 3, US: 29 });
    expect(parseRegion(DEFAULT_REGION)).toEqual(DEFAULT_REGION);
  });
  it.each(pairs)('par $country/$timeZone: aplicar o excluir explícitamente según Intl', (pair) => {
    expect(parseRegion(pair)).toEqual(pair);
    expect(zoneLabel(pair.timeZone)).not.toContain('/');
    expect(zoneLabel(pair.timeZone)).not.toContain('_');
    expect(zoneLabel(pair.timeZone)).not.toBe('');
    const supported = supportsTimeZone(pair.timeZone);
    const storage = new MemoryStorage();
    const result = saveRegion(pair, storage);
    if (supported) {
      expect(result).toMatchObject({ preference: pair, presentationZone: pair.timeZone, persistence: 'saved', notice: null });
      expect(JSON.parse(storage.values.get(REGION_KEY)!)).toEqual(pair);
    } else {
      // Exclusión comprobada ≠ soporte comprobado. Primario permite medir lista.
      expect(result.notice).toBe('unsupported');
      expect(storage.values.has(REGION_KEY)).toBe(false);
    }
  });
});

describe('D158 · sólo la preferencia propia, datos mínimos', () => {
  it.each([
    null, [], {}, { country: 'CO' }, { country: 'CO', timeZone: 'America/Mexico_City' },
    { country: 'XX', timeZone: 'UTC' }, { country: 'CO', timeZone: 3 },
    { country: 'CO', timeZone: 'America/Bogota', user: 'no' },
  ])('rechaza estructura/par desconocido sin inventar perfil (%j)', (value) => {
    expect(parseRegion(value)).toBeNull();
    const storage = new MemoryStorage();
    expect(saveRegion(value, storage, allSupported).notice).toBe('corrupt');
    expect(storage.operations).toEqual([]);
  });
  it('sin dato usa país México y zona automática del dispositivo sin escribir', () => {
    const storage = new MemoryStorage();
    expect(loadRegion(storage, allSupported)).toEqual(defaultRegionState(null, allSupported));
    expect(storage.operations).toEqual(['get:' + REGION_KEY]);
  });
  it('aplicar+recargar conserva exactamente dos campos, sin identidad', () => {
    const storage = new MemoryStorage();
    expect(saveRegion(colombia, storage, allSupported).persistence).toBe('saved');
    expect(storage.values.get(REGION_KEY)).toBe('{"country":"CO","timeZone":"America/Bogota"}');
    expect(loadRegion(storage, allSupported).preference).toEqual(colombia);
    expect(Object.keys(JSON.parse(storage.values.get(REGION_KEY)!))).toEqual(['country', 'timeZone']);
  });
  it('edición reemplaza sólo la clave propia', () => {
    const storage = new MemoryStorage();
    storage.values.set('ajena', 'preservada');
    saveRegion(colombia, storage, allSupported);
    saveRegion(DEFAULT_REGION, storage, allSupported);
    expect(loadRegion(storage, allSupported).preference).toEqual(DEFAULT_REGION);
    expect(storage.values.get('ajena')).toBe('preservada');
  });
  it('reset borra sólo esa clave y confirma ausencia', () => {
    const storage = new MemoryStorage();
    storage.values.set('ajena', 'preservada');
    saveRegion(colombia, storage, allSupported);
    storage.operations.length = 0;
    expect(resetRegion(storage, allSupported)).toEqual(defaultRegionState(null, allSupported));
    expect(storage.operations).toEqual(['remove:' + REGION_KEY, 'get:' + REGION_KEY]);
    expect(storage.values.get('ajena')).toBe('preservada');
    expect(storage.values.has(REGION_KEY)).toBe(false);
  });
  it('corrupto no se borra ni sobrescribe automáticamente', () => {
    const storage = new MemoryStorage();
    storage.values.set(REGION_KEY, 'no-json');
    expect(loadRegion(storage, allSupported).notice).toBe('corrupt');
    expect(storage.values.get(REGION_KEY)).toBe('no-json');
    expect(storage.operations).toEqual(['get:' + REGION_KEY]);
  });
  it('par cruzado persistido tampoco se repara silenciosamente', () => {
    const storage = new MemoryStorage();
    const raw = '{"country":"CO","timeZone":"America/Tijuana"}';
    storage.values.set(REGION_KEY, raw);
    expect(loadRegion(storage, allSupported).preference).toEqual(DEFAULT_AUTOMATIC_REGION);
    expect(storage.values.get(REGION_KEY)).toBe(raw);
  });
  it('get inaccesible no bloquea y declara fallback', () => {
    const storage = new MemoryStorage();
    storage.getItem = () => { throw new Error('blocked'); };
    expect(loadRegion(storage, allSupported).notice).toBe('storage-unavailable');
  });
  it('storage ausente permite selección temporal', () => {
    expect(loadRegion(null, allSupported).notice).toBe('storage-unavailable');
    expect(saveRegion(colombia, null, allSupported)).toMatchObject({ preference: colombia, persistence: 'temporary', notice: 'not-saved' });
  });
  it('cuota/set falla conserva selección temporal y datos anteriores', () => {
    const storage = new MemoryStorage();
    storage.values.set(REGION_KEY, JSON.stringify(DEFAULT_REGION));
    storage.setItem = () => { throw new Error('quota'); };
    expect(saveRegion(colombia, storage, allSupported)).toMatchObject({ preference: colombia, persistence: 'temporary', notice: 'not-saved' });
    expect(JSON.parse(storage.values.get(REGION_KEY)!)).toEqual(DEFAULT_REGION);
  });
  it('set silencioso/roundtrip distinto no se llama guardado', () => {
    const storage = new MemoryStorage();
    storage.setItem = () => undefined;
    expect(saveRegion(colombia, storage, allSupported).notice).toBe('not-saved');
    expect(loadRegion(storage, allSupported).preference).toEqual(DEFAULT_AUTOMATIC_REGION);
  });
  it('get después de set falla: no hay promesa de recarga', () => {
    const storage = new MemoryStorage();
    storage.getItem = () => { throw new Error('read-back'); };
    expect(saveRegion(colombia, storage, allSupported).persistence).toBe('temporary');
  });
  it('remove falla: default sólo de vista, advertir posible retorno anterior', () => {
    const storage = new MemoryStorage();
    saveRegion(colombia, storage, allSupported);
    storage.removeItem = () => { throw new Error('blocked'); };
    expect(resetRegion(storage, allSupported)).toMatchObject({ preference: DEFAULT_AUTOMATIC_REGION, notice: 'not-reset' });
    expect(loadRegion(storage, allSupported).preference).toEqual(colombia);
  });
  it('remove silencioso no acredita borrado', () => {
    const storage = new MemoryStorage();
    saveRegion(colombia, storage, allSupported);
    storage.removeItem = () => undefined;
    expect(resetRegion(storage, allSupported).notice).toBe('not-reset');
  });
  it('reset sin storage y fallo de lectura de confirmación se declaran', () => {
    expect(resetRegion(null, allSupported).notice).toBe('not-reset');
    const storage = new MemoryStorage();
    storage.getItem = () => { throw new Error('read-back'); };
    expect(resetRegion(storage, allSupported).notice).toBe('not-reset');
  });
  it('zona guardada no soportada: fallback explícito sin borrar original', () => {
    const storage = new MemoryStorage();
    storage.values.set(REGION_KEY, JSON.stringify(colombia));
    const result = loadRegion(storage, (zone) => zone !== colombia.timeZone);
    expect(result).toMatchObject({ preference: colombia, presentationZone: DEFAULT_REGION.timeZone, notice: 'unsupported' });
    expect(storage.values.get(REGION_KEY)).toBe(JSON.stringify(colombia));
  });
  it('CDMX no soportado: UTC efectivo explícito, no par MX/UTC guardado', () => {
    const storage = new MemoryStorage();
    const state = loadRegion(storage, (zone) => zone === 'UTC', () => null);
    expect(state).toMatchObject({ presentationZone: 'UTC', preference: DEFAULT_AUTOMATIC_REGION, notice: 'device-unavailable' });
    expect(parseRegion({ country: 'MX', timeZone: 'UTC' })).toBeNull();
    expect(storage.values.size).toBe(0);
  });
  it('Intl indisponible: ISO neutral, cero zona original inventada', () => {
    expect(defaultRegionState(null, () => false)).toMatchObject({ presentationZone: null, notice: 'unsupported' });
  });
  it('misma clave de navegador heredable sin parámetro de cuenta', () => {
    const storage = new MemoryStorage();
    saveRegion(colombia, storage, allSupported);
    expect(loadRegion(storage, allSupported)).toMatchObject({ preference: colombia, persistence: 'saved', notice: null });
    expect(loadRegion(storage, allSupported).preference).toEqual(colombia);
    expect([...storage.values.keys()]).toEqual([REGION_KEY]);
  });
});

describe('D171 · modo del dispositivo independiente del país y sin zona congelada', () => {
  it.each(['America/Mexico_City', 'America/New_York', 'Asia/Tokyo', 'Asia/Kathmandu'])
  ('navegador nuevo: México permanece manual y zona efectiva %s, sin escribir', (device) => {
    const storage = new MemoryStorage();
    const state = loadRegion(storage, supportsTimeZone, () => device);
    expect(state).toMatchObject({ preference: DEFAULT_AUTOMATIC_REGION, presentationZone: device, notice: null });
    expect(storage.operations).toEqual(['get:' + REGION_KEY]);
    expect(storage.values.size).toBe(0);
  });
  it('legacy manual conserva bytes, IANA y modo ante lectura/refresh/recarga', () => {
    const storage = new MemoryStorage();
    const raw = ' { "country": "MX", "timeZone": "America/Matamoros" } ';
    storage.values.set(REGION_KEY, raw);
    const reader = vi.fn(() => 'Asia/Tokyo');
    const state = loadRegion(storage, supportsTimeZone, reader);
    expect(state.preference).toEqual({ country: 'MX', timeZone: 'America/Matamoros' });
    expect(state.presentationZone).toBe('America/Matamoros');
    expect(refreshAutomaticRegion(state, reader)).toBe(state);
    expect(loadRegion(storage, supportsTimeZone, reader)).toEqual(state);
    expect(reader).not.toHaveBeenCalled();
    expect(storage.values.get(REGION_KEY)).toBe(raw);
    expect(storage.operations.every((op) => op === 'get:' + REGION_KEY)).toBe(true);
  });
  it('Aplicar auto guarda elección/fallback manual, no Tokyo; recarga toma Madrid y foreground Kathmandu', () => {
    const storage = new MemoryStorage();
    storage.values.set('ajena', 'retain');
    const choice = { ...colombia, mode: 'automatic' } as const;
    const applied = saveRegion(choice, storage, supportsTimeZone, () => 'Asia/Tokyo');
    expect(applied.presentationZone).toBe('Asia/Tokyo');
    expect(JSON.parse(storage.values.get(REGION_KEY)!)).toEqual(choice);
    const reloaded = loadRegion(storage, supportsTimeZone, () => 'Europe/Madrid');
    expect(reloaded.presentationZone).toBe('Europe/Madrid');
    storage.operations.length = 0;
    const refreshed = refreshAutomaticRegion(reloaded, () => 'Asia/Kathmandu');
    expect(refreshed.presentationZone).toBe('Asia/Kathmandu');
    expect(refreshed.preference).toEqual(choice);
    expect(storage.operations).toEqual([]);
    expect(storage.values.get('ajena')).toBe('retain');
  });
  it.each(['', 'Invalid/Zone', '+05:00', 123, null, undefined])
  ('dispositivo inválido %j usa último efectivo válido; frío usa fallback manual/CDMX', (invalid) => {
    const state = saveRegion({ ...colombia, mode: 'automatic' }, new MemoryStorage(), supportsTimeZone, () => 'Asia/Tokyo');
    const refreshed = refreshAutomaticRegion(state, () => invalid);
    expect(refreshed).toMatchObject({ presentationZone: 'Asia/Tokyo', notice: 'device-unavailable' });
    const storage = new MemoryStorage();
    storage.values.set(REGION_KEY, JSON.stringify(state.preference));
    expect(loadRegion(storage, supportsTimeZone, () => invalid).presentationZone).toBe('America/Bogota');
    expect(loadRegion(new MemoryStorage(), supportsTimeZone, () => invalid).presentationZone).toBe('America/Mexico_City');
  });
  it('lector/Intl lanzan: no excepción, fallback previo o ISO neutral, y recuperación automática', () => {
    const state = loadRegion(new MemoryStorage(), supportsTimeZone, () => 'Asia/Tokyo');
    expect(refreshAutomaticRegion(state, () => { throw new Error('device'); }).presentationZone).toBe('Asia/Tokyo');
    const broken = refreshAutomaticRegion(state, () => null, () => false);
    expect(broken).toMatchObject({ presentationZone: null, notice: 'unsupported' });
    expect(refreshAutomaticRegion(broken, () => 'Asia/Kathmandu').presentationZone).toBe('Asia/Kathmandu');
    const spy = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => { throw new Error('Intl unavailable'); });
    try {
      expect(readDeviceTimeZone()).toBeNull();
      expect(loadRegion(null)).toMatchObject({ presentationZone: null, notice: 'storage-unavailable' });
    } finally { spy.mockRestore(); }
  });
  it.each(['absent', 'get', 'set', 'silent-set'] as const)
  ('storage %s: automático sigue en memoria sin afirmar guardado ni borrar otra clave', (failure) => {
    const storage = new MemoryStorage();
    storage.values.set('ajena', 'retain');
    if (failure === 'get') storage.getItem = () => { throw new Error('get'); };
    if (failure === 'set') storage.setItem = () => { throw new Error('quota'); };
    if (failure === 'silent-set') storage.setItem = () => undefined;
    const selected = saveRegion({ ...colombia, mode: 'automatic' }, failure === 'absent' ? null : storage,
      supportsTimeZone, () => 'Asia/Tokyo');
    expect(selected).toMatchObject({ presentationZone: 'Asia/Tokyo', persistence: 'temporary', notice: 'not-saved' });
    expect(refreshAutomaticRegion(selected, () => 'Asia/Kathmandu')).toMatchObject({
      presentationZone: 'Asia/Kathmandu', persistence: 'temporary', notice: 'not-saved',
    });
    expect(storage.values.get('ajena')).toBe('retain');
  });
  it('offset/DST se calcula por instante IANA y no altera el ISO ni countdown compartido', () => {
    const winter = new Date('2026-01-15T12:30:00Z');
    const summer = new Date('2026-07-15T12:30:00Z');
    const state = loadRegion(new MemoryStorage(), supportsTimeZone, () => 'America/New_York');
    expect(timeZoneDisplay(state.presentationZone!, winter)).toEqual({ offsetMinutes: -300, time: '07:30' });
    expect(timeZoneDisplay(state.presentationZone!, summer)).toEqual({ offsetMinutes: -240, time: '08:30' });
    const expiry = '2026-01-15T17:30:00Z';
    const before = countdownLong(expiry, winter);
    const changed = refreshAutomaticRegion(state, () => 'Asia/Kathmandu');
    expect(personalDateParts(winter.toISOString(), changed.presentationZone)?.hour).toBe(18);
    expect(winter.toISOString()).toBe('2026-01-15T12:30:00.000Z');
    expect(countdownLong(expiry, winter)).toEqual(before);
    expect(before).toEqual({ text: '5 h', urgent: false });
  });
});
