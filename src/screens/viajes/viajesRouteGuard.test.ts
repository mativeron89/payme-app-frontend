import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { aplicarConfigViajes, reiniciarViajesParaTests, type EstadoCapacidadViajes } from '../../api/viajes';
import { navegadorFalso } from '../../navegadorFalso.testutil';
import { EVENTO_RUTA, PAGES, parseLocation, type PageId } from '../../router';
import { enforceViajesRouteGuard, PAGINAS_DE_VIAJES } from './viajesRouteGuard';

/**
 * AF-VIAJES · sin la capacidad `features.viajes`, las rutas de Viajes no
 * existen: la cadena completa, config → capacidad → `replaceRoute('home')`.
 */
afterEach(() => {
  vi.unstubAllGlobals();
  reiniciarViajesParaTests();
});

const capacidadDe = (config: unknown): EstadoCapacidadViajes =>
  aplicarConfigViajes(config) ? 'encendida' : 'apagada';

describe('las rutas de Viajes', () => {
  it('son exactamente las siete de Viajes que declara el router', () => {
    expect([...PAGINAS_DE_VIAJES].sort()).toEqual(PAGES.filter((p) => p.startsWith('viaje')).sort());
  });

  for (const page of PAGINAS_DE_VIAJES) {
    it(`🔴 apagada (la de hoy del dueño), /${page} vuelve a Inicio sin dejar rastro`, () => {
      const b = navegadorFalso(`/${page}/d1000000-0000-4000-8000-000000000001`);
      const capacidad = capacidadDe({ features: { viajes: { supported: true, enabled: false } } });
      expect(enforceViajesRouteGuard(capacidad, page)).toBe(true);
      expect(b.url()).toBe('/home');
      expect(parseLocation(b.path(), b.search()).page).toBe('home');
      expect(b.replaceState).toHaveBeenCalledTimes(1);
      expect(b.pushState).not.toHaveBeenCalled();
      expect(b.dispatched).toEqual([EVENTO_RUTA]);
    });
  }

  it('sin saber todavía (la config viaja), no se redirige: entrar directo no expulsa a Inicio', () => {
    const b = navegadorFalso('/viaje/d1000000-0000-4000-8000-000000000001');
    expect(enforceViajesRouteGuard('pendiente', 'viaje')).toBe(false);
    expect(b.replaceState).not.toHaveBeenCalled();
  });

  it('encendida, la ruta se queda', () => {
    const b = navegadorFalso('/viaje/d1000000-0000-4000-8000-000000000001');
    const capacidad = capacidadDe({ features: { viajes: { supported: true, enabled: true } } });
    expect(enforceViajesRouteGuard(capacidad, 'viaje')).toBe(false);
    expect(b.url()).toBe('/viaje/d1000000-0000-4000-8000-000000000001');
  });

  it.each(['home', 'mesa', 'scan', 'avisos'] as PageId[])('apagada, /%s no se toca', (page) => {
    const b = navegadorFalso(`/${page}`);
    expect(enforceViajesRouteGuard('apagada', page)).toBe(false);
    expect(b.replaceState).not.toHaveBeenCalled();
  });

  it('App.tsx la ejecuta y no monta nada mientras la ruta no está permitida', () => {
    const app = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8');
    expect(app).toMatch(/useEffect\(\(\) => \{\s*enforceViajesRouteGuard\(capacidadViajes, route\.page\);\s*\}, \[capacidadViajes, route\.page\]\);/);
    expect(app).toMatch(/const rutaDeViajes = esPaginaDeViajes\(route\.page\) && capacidadViajes !== 'encendida';/);
    expect(app).toMatch(/if \(rutaDeViajes\) return null;/);
  });
});
