import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { navegadorFalso } from '../../navegadorFalso.testutil';
import { EVENTO_RUTA, parseLocation } from '../../router';
import { enforceRutaDelEjemplo, esRutaDelEjemploSinEjemplo } from './rutaDelEjemplo';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('D363 · #/mesa/PA-1224 sin el ejemplo vuelve a Inicio', () => {
  it.each(['PA-1224', 'pa-1224'])('/mesa/%s sin ejemplo termina en /home, reemplazando la entrada', (code) => {
    const b = navegadorFalso(`/mesa/${code}`);
    const ruta = parseLocation(b.path(), b.search());
    expect(ruta).toMatchObject({ page: 'mesa', param: code });
    expect(enforceRutaDelEjemplo(ruta.page, ruta.param, false)).toBe(true);
    expect(b.url()).toBe('/home');
    expect(b.replaceState).toHaveBeenCalledTimes(1);
    expect(b.pushState).not.toHaveBeenCalled();
    expect(b.dispatched).toEqual([EVENTO_RUTA]);
  });

  it('control · con el ejemplo activo, la mesa de ejemplo se queda (es el paso 2e)', () => {
    const b = navegadorFalso('/mesa/PA-1224');
    expect(enforceRutaDelEjemplo('mesa', 'PA-1224', true)).toBe(false);
    expect(b.replaceState).not.toHaveBeenCalled();
    expect(b.url()).toBe('/mesa/PA-1224');
  });

  it('control · una mesa de verdad, con o sin ejemplo, nunca se toca', () => {
    for (const activo of [false, true]) {
      const b = navegadorFalso('/mesa/PA-12240');
      expect(enforceRutaDelEjemplo('mesa', 'PA-12240', activo)).toBe(false);
      expect(b.replaceState).not.toHaveBeenCalled();
    }
    expect(esRutaDelEjemploSinEjemplo('mesas', null, false)).toBe(false);
    expect(esRutaDelEjemploSinEjemplo('scan', 'PA-1224', false)).toBe(false);
  });

  it('App la llama en un efecto y, mientras redirige, no monta nada (tampoco el link de invitado)', () => {
    const app = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8');
    expect(app).toContain('enforceRutaDelEjemplo(route.page, route.param, ejemploActivo);');
    // El `return null` va antes de la rama del link de invitado (`JoinMesaScreen`), no adentro.
    const corte = app.indexOf('if (rutaDelEjemplo) return null;');
    const ramaDelLink = app.indexOf("if (route.page === 'mesa' && route.param && linkToken) {");
    expect(corte).toBeGreaterThan(-1);
    expect(ramaDelLink).toBeGreaterThan(-1);
    expect(corte).toBeLessThan(ramaDelLink);
  });
});
