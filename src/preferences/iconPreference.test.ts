import { describe, expect, it } from 'vitest';
import { ICON_SIZE_KEY, ICON_SIZES, loadIconSize, parseIconSize, saveIconSize, type IconStorage } from './iconPreference';

function storage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const writes: string[] = [];
  return { data, writes, getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { writes.push(key); data.set(key, value); } };
}
describe('D310 · preferencia local de íconos', () => {
  it('sin preferencia usa Medianos sin escribir, y conserva todas las claves ajenas', () => {
    const s = storage({ 'payme.app.region.v1': 'zona previa', idioma: 'en' });
    expect(loadIconSize(s)).toEqual({ size: 'medianos', notice: null, persistence: 'default' });
    expect(s.writes).toEqual([]);
    expect([...s.data]).toEqual([['payme.app.region.v1', 'zona previa'], ['idioma', 'en']]);
  });
  it.each(ICON_SIZES)('Aplicar %s sobrevive al roundtrip y no escribe preferencias ajenas', (size) => {
    const s = storage({ otra: 'conservar' });
    const saved = saveIconSize(size, s);
    expect(saved).toEqual({ size, notice: null, persistence: 'saved' });
    expect(loadIconSize(s)).toEqual(saved);
    expect(s.writes).toEqual([ICON_SIZE_KEY]);
    expect(s.data.get('otra')).toBe('conservar');
  });
  it.each(['', 'Grande', 'MEDIANOS', 'chicos ', 'null', '{}', '"grandes"'])('dato inválido %j cae a Medianos sin borrar ni sobrescribir', (value) => {
    const s = storage({ [ICON_SIZE_KEY]: value });
    expect(parseIconSize(value)).toBeNull();
    expect(loadIconSize(s)).toEqual({ size: 'medianos', notice: 'corrupt', persistence: 'default' });
    expect(s.data.get(ICON_SIZE_KEY)).toBe(value);
    expect(s.writes).toEqual([]);
  });
  it('no acepta objetos, arrays, números ni coerciones y nunca persiste un valor inválido', () => {
    const s = storage();
    for (const value of [null, undefined, 0, true, {}, ['grandes'], { toString: () => 'grandes' }]) {
      expect(parseIconSize(value)).toBeNull();
      expect(saveIconSize(value, s).notice).toBe('corrupt');
    }
    expect(s.writes).toEqual([]);
  });
  it('lectura bloqueada conserva un fallback utilizable', () => {
    expect(loadIconSize(null).notice).toBe('storage-unavailable');
    expect(loadIconSize({ getItem: () => { throw new Error('blocked'); }, setItem: () => undefined })).toEqual(loadIconSize(null));
  });
  it.each(ICON_SIZES)('escritura bloqueada o no acreditada aplica %s temporalmente', (size) => {
    const blocked: IconStorage = { getItem: () => null, setItem: () => { throw new Error('blocked'); } };
    const noRoundtrip: IconStorage = { getItem: () => 'medianos', setItem: () => undefined };
    const wrongRoundtrip: IconStorage = { getItem: () => 'valor diferente', setItem: () => undefined };
    for (const s of [null, blocked, wrongRoundtrip]) {
      expect(saveIconSize(size, s)).toEqual({ size, notice: 'not-saved', persistence: 'temporary' });
    }
    if (size !== 'medianos') expect(saveIconSize(size, noRoundtrip).notice).toBe('not-saved');
  });
});
