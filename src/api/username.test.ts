import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyUsernameConfig,
  arrobaCoincide,
  arrobaVisible,
  consultaValida,
  decodeEstadoUsername,
  decodeResultadosArroba,
  decodeSugerencia,
  decodeUsernameCapability,
  fechaDeCambio,
  formatoValido,
  normalizarUsername,
  problemaDeFormato,
  resetUsernameForTests,
  subscribeUsername,
  usernameSnapshot,
} from './username';

/** AF-USUARIO-ARROBA · decisión 93 · wire `docs/USERNAME_D93_WIRE.md` (AB a8987b06). */

afterEach(() => resetUsernameForTests());

describe('formato del @ (wire §2)', () => {
  it('normaliza como el dueño: sin espacios al borde, sin UNA @ adelante, en minúsculas', () => {
    expect(normalizarUsername('  @MatiVeron ')).toBe('mativeron');
    expect(normalizarUsername('@@mati')).toBe('@mati');
    expect(normalizarUsername('Mati.Veron_1')).toBe('mati.veron_1');
  });

  it('dice qué falta, en orden', () => {
    expect(problemaDeFormato('')).toBe('vacio');
    expect(problemaDeFormato('ma ti')).toBe('caracteres');
    expect(problemaDeFormato('mati-veron')).toBe('caracteres');
    expect(problemaDeFormato('niño')).toBe('caracteres');
    expect(problemaDeFormato('ma')).toBe('corto');
    expect(problemaDeFormato('a'.repeat(21))).toBe('largo');
    expect(problemaDeFormato('.mati')).toBe('punto_en_borde');
    expect(problemaDeFormato('mati.')).toBe('punto_en_borde');
    expect(problemaDeFormato('mati.veron_89')).toBe('ok');
    expect(problemaDeFormato('a'.repeat(20))).toBe('ok');
    expect(problemaDeFormato('abc')).toBe('ok');
  });

  it('formatoValido coincide con la regla del dueño', () => {
    for (const bueno of ['mativeron', 'm.v', 'a_b', '123', 'a'.repeat(20)]) expect(formatoValido(bueno), bueno).toBe(true);
    for (const malo of ['', 'ab', 'a'.repeat(21), '.ab', 'ab.', 'Mati', 'ma ti', 'ma@ti']) expect(formatoValido(malo), malo).toBe(false);
  });

  it('la búsqueda consulta desde 3 caracteres del alfabeto; el punto en el borde vale para buscar', () => {
    expect(consultaValida('ma')).toBe(false);
    expect(consultaValida('mar')).toBe(true);
    expect(consultaValida('ma.')).toBe(true);
    expect(consultaValida('ma ')).toBe(false);
    expect(consultaValida('a'.repeat(21))).toBe(false);
  });
});

describe('capability features.username (wire §1): sólo `{supported:true, enabled:bool}` exacto', () => {
  const conf = (username: unknown) => ({ features: { username } });

  it('encendido sólo con las dos claves exactas y enabled:true', () => {
    expect(decodeUsernameCapability(conf({ supported: true, enabled: true }))).toEqual({ enabled: true });
    expect(decodeUsernameCapability(conf({ supported: true, enabled: false }))).toEqual({ enabled: false });
  });

  it.each([
    ['ausente', { features: {} }],
    ['sin features', {}],
    ['null', null],
    ['clave de más', conf({ supported: true, enabled: true, extra: 1 })],
    ['falta supported', conf({ enabled: true })],
    ['supported false', conf({ supported: false, enabled: true })],
    ['enabled como texto', conf({ supported: true, enabled: 'true' })],
    ['bloque como booleano', conf(true)],
  ])('%s → apagado', (_l, config) => {
    expect(decodeUsernameCapability(config)).toEqual({ enabled: false });
  });

  it('el store avisa sólo cuando cambia, y una config rota lo apaga', () => {
    const oyente = vi.fn();
    const baja = subscribeUsername(oyente);
    applyUsernameConfig(conf({ supported: true, enabled: false }));
    expect(oyente).not.toHaveBeenCalled();
    applyUsernameConfig(conf({ supported: true, enabled: true }));
    expect(usernameSnapshot().enabled).toBe(true);
    expect(oyente).toHaveBeenCalledTimes(1);
    applyUsernameConfig({ features: {} });
    expect(usernameSnapshot().enabled).toBe(false);
    expect(oyente).toHaveBeenCalledTimes(2);
    baja();
  });
});

describe('GET|PUT /api/account/username (wire §4)', () => {
  it('acepta la forma exacta', () => {
    expect(decodeEstadoUsername({ username: 'mativeron', required: false, next_change_at: null }))
      .toEqual({ username: 'mativeron', required: false, next_change_at: null });
    expect(decodeEstadoUsername({ username: null, required: true, next_change_at: null }).required).toBe(true);
    expect(decodeEstadoUsername({ username: 'mati', required: false, next_change_at: '2026-10-27T00:00:00.000Z' })
      .next_change_at).toBe('2026-10-27T00:00:00.000Z');
  });

  it.each([
    ['clave de más', { username: 'mati', required: false, next_change_at: null, email: 'x@y.z' }],
    ['required incoherente con username', { username: null, required: false, next_change_at: null }],
    ['required true con username', { username: 'mati', required: true, next_change_at: null }],
    ['@ fuera de formato', { username: 'Mati', required: false, next_change_at: null }],
    ['fecha no fecha', { username: 'mati', required: false, next_change_at: 'mañana' }],
  ])('rechaza %s', (_l, body) => {
    expect(() => decodeEstadoUsername(body)).toThrow('username_response_malformed');
  });

  it('la sugerencia es un @ válido o null', () => {
    expect(decodeSugerencia({ suggestion: 'mativeron' })).toBe('mativeron');
    expect(decodeSugerencia({ suggestion: null })).toBeNull();
    expect(() => decodeSugerencia({ suggestion: 'Mati Verón' })).toThrow();
    expect(() => decodeSugerencia({ suggestion: 'mati', extra: 1 })).toThrow();
  });
});

describe('GET /api/friends/by-username (wire §5): cuatro claves exactas, hasta 5, nunca el mail', () => {
  const r = (username: string, extra: Record<string, unknown> = {}) => ({
    username, first_name: 'Ana', last_name: 'Paz', has_avatar: false, ...extra,
  });

  it('acepta hasta 5 resultados con las cuatro claves', () => {
    const cinco = ['aaa', 'aab', 'aac', 'aad', 'aae'].map((u) => r(u));
    expect(decodeResultadosArroba({ results: cinco })).toHaveLength(5);
    expect(decodeResultadosArroba({ results: [] })).toEqual([]);
  });

  it.each([
    ['un mail en un resultado', { results: [r('ana', { email: 'ana@mail.com' })] }],
    ['un payme_id', { results: [r('ana', { payme_id: 'payme_mx_ana' })] }],
    ['un id interno', { results: [r('ana', { id: 'u-1' })] }],
    ['seis resultados', { results: ['a1a', 'a2a', 'a3a', 'a4a', 'a5a', 'a6a'].map((u) => r(u)) }],
    ['has_avatar no booleano', { results: [r('ana', { has_avatar: 'true' })] }],
    ['@ fuera de formato', { results: [r('Ana')] }],
    ['clave de más arriba', { results: [], total: 1 }],
  ])('rechaza %s', (_l, body) => {
    expect(() => decodeResultadosArroba(body)).toThrow('username_search_malformed');
  });
});

describe('fecha del próximo cambio', () => {
  it('se muestra en hora de México, en los dos idiomas', () => {
    // 05:00 UTC del 27 = 23:00 del 26 en México.
    expect(fechaDeCambio('2026-10-27T05:00:00.000Z', 'es')).toBe('26 de octubre');
    expect(fechaDeCambio('2026-10-27T05:00:00.000Z', 'en')).toBe('October 26');
  });
});

describe('AF-USERNAME-D104 · qué se ve debajo del nombre (decisión 104)', () => {
  it('el @ con formato válido, con la capability encendida', () => {
    expect(arrobaVisible('mativeron', true)).toBe('@mativeron');
    expect(arrobaVisible('ana.p_1', true)).toBe('@ana.p_1');
  });

  it.each([
    ['ausente (dueño anterior)', undefined, true],
    ['null (sin elegir)', null, true],
    ['fuera de formato', 'Mati Veron', true],
    ['corto', 'ab', true],
    ['punto en el borde', '.mati', true],
    ['no string', 42, true],
    ['un payme_id, apagada', 'payme_mx_ana', false],
    ['un payme_id, encendida (reservado por el dueño)', 'payme_mx_ana', true],
    ['cualquier @ que empiece por «payme»', 'paymeoficial', true],
    ['apagada', 'mativeron', false],
  ])('%s → nada', (_l, username, habilitado) => {
    expect(arrobaVisible(username, habilitado)).toBeNull();
  });

  it('el filtro coincide por el @ que se ve, con o sin «@», y nunca con la capability apagada', () => {
    expect(arrobaCoincide('mativeron', true, 'mati')).toBe(true);
    expect(arrobaCoincide('mativeron', true, '@mati')).toBe(true);
    expect(arrobaCoincide('mativeron', true, 'ana')).toBe(false);
    expect(arrobaCoincide('mativeron', true, '')).toBe(false);
    expect(arrobaCoincide(null, true, 'mati')).toBe(false);
    expect(arrobaCoincide('mativeron', false, 'mati')).toBe(false);
  });
});
