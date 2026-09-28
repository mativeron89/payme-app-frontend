import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CLAVE_VINCULAR_EN_CURSO,
  leerVueltaVincular,
  marcarVincularEnCurso,
  olvidarVincularEnCurso,
  vincularEnCurso,
} from './googleVincularRedirect';

/**
 * AF-VINCULAR-GOOGLE · la vuelta de «Vincular Google» en la misma pestaña. Los
 * errores comparten fragmento con «Entrar»: sólo con una ida a vincular vigente
 * se leen como de vincular.
 */

describe('AF-VINCULAR-GOOGLE · leer la vuelta', () => {
  it('`#google_link=listo` es la vuelta de vincular, con o sin marca', () => {
    expect(leerVueltaVincular('#google_link=listo', false)).toEqual({ tipo: 'listo' });
    expect(leerVueltaVincular('#google_link=listo', true)).toEqual({ tipo: 'listo' });
  });

  it.each(['#google_link=otra', '#google_link=listo&x=1', '#google_link='])('%s: con la forma pero sin el valor ⇒ inválida', (hash) => {
    expect(leerVueltaVincular(hash, true)).toEqual({ tipo: 'invalida' });
  });

  it('🔴 un error SIN ida a vincular vigente es de «Entrar»: acá no se lee', () => {
    expect(leerVueltaVincular('#google_redirect_error=social_auth_failed', false)).toEqual({ tipo: 'nada' });
  });

  it.each(['csrf_failed', 'social_auth_failed', 'temporarily_unavailable'] as const)('con la ida vigente, %s es de vincular', (error) => {
    expect(leerVueltaVincular(`#google_redirect_error=${error}`, true)).toEqual({ tipo: 'error', error });
  });

  it('otras cosas no son de vincular', () => {
    for (const hash of ['', '#/mas', '#google_redirect=abc', '#google_signup=abc', '#google_redirect_error=otro']) {
      expect(leerVueltaVincular(hash, true), hash).toEqual({ tipo: 'nada' });
    }
  });
});

describe('AF-VINCULAR-GOOGLE · la marca de «ida a vincular»', () => {
  const datos = new Map<string, string>();
  const almacen = {
    getItem: (k: string) => datos.get(k) ?? null,
    setItem: (k: string, v: string) => { datos.set(k, v); },
    removeItem: (k: string) => { datos.delete(k); },
  };
  afterEach(() => { datos.clear(); vi.unstubAllGlobals(); });

  it('dura 10 minutos, guarda sólo la hora y se suelta', () => {
    vi.stubGlobal('window', { sessionStorage: almacen });
    marcarVincularEnCurso(1_000_000);
    expect([...datos.entries()]).toEqual([[CLAVE_VINCULAR_EN_CURSO, '1000000']]);
    expect(vincularEnCurso(1_000_000 + 10 * 60 * 1000)).toBe(true);
    expect(vincularEnCurso(1_000_000 + 10 * 60 * 1000 + 1)).toBe(false);
    expect(vincularEnCurso(999_999)).toBe(false);
    olvidarVincularEnCurso();
    expect(vincularEnCurso(1_000_000)).toBe(false);
  });

  it('sin sessionStorage, no hay ida vigente (los errores quedan para «Entrar»)', () => {
    vi.stubGlobal('window', {});
    marcarVincularEnCurso();
    expect(vincularEnCurso()).toBe(false);
  });
});
