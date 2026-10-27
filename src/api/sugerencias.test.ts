import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { traducir } from '../i18n/idioma';
import {
  aplicarConfigSugerencias, capacidadOpcional, confirmarConsentimiento, decodeCapacidadOpcional, decodeConsentimiento,
  decodeSugerenciaDeDividir, permisoDeSugerencias, recordarPermisoDeSugerencias, reiniciarSugerenciasParaTests,
  rutaDeSugerencia, textoDeSugerencia,
} from './sugerencias';

/** n420 · contra `contract-mirror/contract/account-consents-v1.schema.json` y `sugerencias-dividir-v1.schema.json`. */
const HASH = 'a'.repeat(64);
const nunca = (f: string) => ({ consent: { purpose_key: f, granted: false, state: 'never', since: null, notice_version: null, notice_hash: null } });
const otorgado = (f: string) => ({ consent: { purpose_key: f, granted: true, state: 'granted', since: '2026-10-27T03:00:00Z', notice_version: '3.2.0', notice_hash: HASH } });
const es = (s: string, ...a: unknown[]) => traducir(s, 'es', ...a);
const en = (s: string, ...a: unknown[]) => traducir(s, 'en', ...a);

afterEach(() => reiniciarSugerenciasParaTests());

describe('n420 · las capacidades de `features` (apagadas hoy)', () => {
  it('🔴 exactamente `supported: true` y `enabled` booleano; cualquier otra cosa apaga', () => {
    expect(decodeCapacidadOpcional({ features: { sugerencias: { supported: true, enabled: true } } }, 'sugerencias')).toEqual({ supported: true, enabled: true });
    expect(decodeCapacidadOpcional({ features: { sugerencias: { supported: true, enabled: false } } }, 'sugerencias')).toEqual({ supported: true, enabled: false });
    for (const c of [undefined, null, {}, { supported: false, enabled: true }, { supported: true }, { supported: true, enabled: 'si' },
      { supported: true, enabled: true, extra: 1 }]) {
      expect(decodeCapacidadOpcional({ features: { sugerencias: c } }, 'sugerencias'), JSON.stringify(c)).toBeNull();
    }
    expect(decodeCapacidadOpcional(null, 'sugerencias')).toBeNull();
    expect(decodeCapacidadOpcional({ features: { analisis_interno: { supported: true, enabled: true } } }, 'sugerencias')).toBeNull();
  });

  it('🔴 `aplicarConfigSugerencias` guarda las dos, y un `/config` sin ellas las apaga y olvida el permiso', () => {
    expect(capacidadOpcional('sugerencias')).toBeNull();
    aplicarConfigSugerencias({ features: { sugerencias: { supported: true, enabled: true }, analisis_interno: { supported: true, enabled: false } } });
    expect(capacidadOpcional('sugerencias')?.enabled).toBe(true);
    expect(capacidadOpcional('analisis_interno')?.enabled).toBe(false);
    recordarPermisoDeSugerencias(true);
    aplicarConfigSugerencias({ features: {} });
    expect(capacidadOpcional('sugerencias')).toBeNull();
    expect(permisoDeSugerencias.vacia()).toBe(true);
  });
});

describe('n420 · consentimientos', () => {
  it('never, granted y revoked de la finalidad pedida; otra finalidad o una clave de más es error', () => {
    expect(decodeConsentimiento(nunca('sugerencias'), 'sugerencias')).toEqual({ purpose_key: 'sugerencias', granted: false, state: 'never' });
    expect(decodeConsentimiento(otorgado('analisis_interno'), 'analisis_interno').granted).toBe(true);
    expect(() => decodeConsentimiento(nunca('analisis_interno'), 'sugerencias')).toThrow();
    expect(() => decodeConsentimiento({ consent: { ...otorgado('sugerencias').consent, extra: 1 } }, 'sugerencias')).toThrow();
    expect(() => decodeConsentimiento({ consent: { ...nunca('sugerencias').consent, granted: true } }, 'sugerencias')).toThrow();
    expect(() => decodeConsentimiento({ consent: { ...otorgado('sugerencias').consent, notice_hash: 'x' } }, 'sugerencias')).toThrow();
  });

  it('🔴 un grant que el servidor no confirma no se muestra otorgado', () => {
    expect(() => confirmarConsentimiento(nunca('sugerencias'), 'sugerencias', true)).toThrow('consent_change_unconfirmed');
    expect(confirmarConsentimiento(otorgado('sugerencias'), 'sugerencias', true).granted).toBe(true);
  });
});

describe('n420 · la sugerencia (`GET /api/sugerencias/dividir`)', () => {
  it('null, consumo e igual con N de 2 a 50; nunca «total»', () => {
    expect(decodeSugerenciaDeDividir({ sugerencia: null })).toBeNull();
    expect(decodeSugerenciaDeDividir({ sugerencia: { division_mode: 'consumo', personas_esperadas: null } })).toEqual({ modo: 'consumo' });
    expect(decodeSugerenciaDeDividir({ sugerencia: { division_mode: 'igual', personas_esperadas: 4 } })).toEqual({ modo: 'igual', personas: 4 });
    for (const malo of [
      {}, { sugerencia: null, extra: 1 }, { sugerencia: { division_mode: 'total', personas_esperadas: null } },
      { sugerencia: { division_mode: 'igual', personas_esperadas: 1 } }, { sugerencia: { division_mode: 'igual', personas_esperadas: 51 } },
      { sugerencia: { division_mode: 'igual', personas_esperadas: 2.5 } }, { sugerencia: { division_mode: 'igual', personas_esperadas: null } },
      { sugerencia: { division_mode: 'consumo', personas_esperadas: 3 } }, { sugerencia: { division_mode: 'consumo' } },
    ]) expect(() => decodeSugerenciaDeDividir(malo), JSON.stringify(malo)).toThrow();
  });

  it('la query lleva el restaurante sólo si es un UUID', () => {
    expect(rutaDeSugerencia('0f8b1a2c-1234-4abc-9def-0123456789ab')).toBe('/sugerencias/dividir?restaurant_id=0f8b1a2c-1234-4abc-9def-0123456789ab');
    expect(rutaDeSugerencia(null)).toBe('/sugerencias/dividir');
    expect(rutaDeSugerencia('la-parolaccia')).toBe('/sugerencias/dividir');
    expect(rutaDeSugerencia('0f8b1a2c-1234-4abc-9def-0123456789ab&x=1')).toBe('/sugerencias/dividir');
  });

  it('🔴 D411/D413 · «Como siempre», y «entre N» en partes iguales; sólo en la opción sugerida; ES y EN', () => {
    expect(textoDeSugerencia({ modo: 'consumo' }, 'consumo', es)).toBe('Como siempre');
    expect(textoDeSugerencia({ modo: 'igual', personas: 4 }, 'igual', es)).toBe('Como siempre · entre 4');
    expect(textoDeSugerencia({ modo: 'consumo' }, 'consumo', en)).toBe('As usual');
    expect(textoDeSugerencia({ modo: 'igual', personas: 4 }, 'igual', en)).toBe('As usual · between 4');
    expect(textoDeSugerencia({ modo: 'igual', personas: 4 }, 'consumo', es)).toBeNull();
    expect(textoDeSugerencia({ modo: 'consumo' }, 'total', es)).toBeNull();
    expect(textoDeSugerencia(null, 'consumo', es)).toBeNull();
  });
});

/**
 * 🔴 Guardarraíl de fuente: con la capacidad apagada nadie pide nada. Sólo el hook de «¿Cómo dividen?» pide la
 * sugerencia, y sólo él y la sección de Privacidad leen o cambian los permisos opcionales.
 */
describe('n420 · quién llama', () => {
  const RAIZ = new URL('..', import.meta.url).pathname;
  const fuentes = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return fuentes(p);
    return /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : [];
  });
  const llamadores = (metodo: string) => fuentes(RAIZ)
    .filter((p) => new RegExp(`api\\.${metodo}\\(`).test(readFileSync(p, 'utf8')))
    .map((p) => p.slice(RAIZ.length));

  it('getSugerenciaDividir, sólo desde useSugerenciaDeDividir', () => {
    expect(llamadores('getSugerenciaDividir')).toEqual(['screens/useSugerenciaDeDividir.ts']);
  });
  it('getConsentimiento, grantConsentimiento y revokeConsentimiento, sólo desde el hook y la sección de Privacidad', () => {
    expect(llamadores('getConsentimiento').sort()).toEqual(['components/SeccionPrivacidad.tsx', 'screens/useSugerenciaDeDividir.ts']);
    expect(llamadores('grantConsentimiento')).toEqual(['components/SeccionPrivacidad.tsx']);
    expect(llamadores('revokeConsentimiento')).toEqual(['components/SeccionPrivacidad.tsx']);
  });
  it('🔴 el hook no pide nada sin la capacidad encendida, ni en Viajes ni en el ejemplo', () => {
    const hook = readFileSync(join(RAIZ, 'screens/useSugerenciaDeDividir.ts'), 'utf8');
    expect(hook).toMatch(/if \(!activo \|\| !listo \|\| !session \|\| !encendida\) return;/);
    const flujo = readFileSync(join(RAIZ, 'screens/CreateMesaFlow.tsx'), 'utf8');
    expect(flujo).toMatch(/activo: step === 'ticket' && !enViaje && !ejemplo,/);
  });
});
