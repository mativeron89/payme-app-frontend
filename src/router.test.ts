import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EVENTO_RUTA,
  PAGES,
  convertirFragmentoViejo,
  fragmentoConSecreto,
  navigate,
  normalizeUnknownHash,
  parseHash,
  parseLocation,
  replaceRoute,
} from './router';
import { navegadorFalso } from './navegadorFalso.testutil';

const sources = import.meta.glob('/src/router.ts', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;
const routerSource = sources['/src/router.ts'];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseHash', () => {
  it('degrada una URI mal codificada sin lanzar', () => {
    expect(parseHash('#/mesa/%E0%A4%A').page).toBe('home');
  });
});

describe('G-35 · normalización segura de una ruta desconocida', () => {
  it.each(['#/saldo', '#/zzz', '#basura', '#/mesa/%E0%A4%A'])(
    '%s termina en /home reemplazando la entrada inválida',
    (hash) => {
      const b = navegadorFalso(hash);
      expect(normalizeUnknownHash(hash)).toBe(true);
      expect(b.url()).toBe('/home');
      expect(b.replaceState).toHaveBeenCalledTimes(1);
      expect(b.pushState).not.toHaveBeenCalled();
      expect(b.hashWrites).toEqual([]);
      expect(b.dispatched).toEqual([EVENTO_RUTA]);
    },
  );

  it('la población completa de páginas válidas queda intacta', () => {
    for (const page of PAGES) {
      const hash = `#/${page}`;
      const b = navegadorFalso(hash);
      expect(normalizeUnknownHash(hash), hash).toBe(false);
      expect(b.replaceState, hash).not.toHaveBeenCalled();
    }
  });

  it.each([
    '',
    '#',
    '#/',
    '#/mesa/PA-123?t=token&r=restaurant-id',
    '#/scan?r=restaurant-id',
    '#/home?future=query',
  ])('preserva default, deep links y queries conocidas: %s', (hash) => {
    const b = navegadorFalso(hash || '/');
    expect(normalizeUnknownHash(hash)).toBe(false);
    expect(b.replaceState).not.toHaveBeenCalled();
  });

  it('si replaceState está bloqueado, igual sale de la ruta por el fallback explícito', () => {
    const b = navegadorFalso('#/zzz', { historialBloqueado: true });
    expect(normalizeUnknownHash('#/zzz')).toBe(true);
    expect(b.locationReplace).toHaveBeenCalledWith('/home');
    expect(b.url()).toBe('/home');
  });

  it('useRoute normaliza al montar y ante cada cambio de ruta', () => {
    expect(routerSource).toContain('if (normalizarDesconocida()) return;');
    for (const evento of ["'popstate'", "'hashchange'", 'EVENTO_RUTA']) {
      expect(routerSource).toContain(`window.addEventListener(${evento}, onChange);`);
    }
  });
});

describe('n130 · rutas normales con History API', () => {
  it('parseLocation lee path y query', () => {
    const r = parseLocation('/mesa/PA-2847', '?r=rest-1');
    expect(r.page).toBe('mesa');
    expect(r.param).toBe('PA-2847');
    expect(r.query.get('r')).toBe('rest-1');
    expect(parseLocation('/', '').page).toBe('home');
    expect(parseLocation('/pagos/', '').page).toBe('pagos');
  });

  it('navigate empuja una ruta normal, conserva la query de la URL y avisa al router', () => {
    const b = navegadorFalso('/home?r=rest-1');
    navigate('mesa', 'PA-2847');
    expect(b.pushState).toHaveBeenCalledTimes(1);
    expect(b.url()).toBe('/mesa/PA-2847?r=rest-1');
    expect(b.dispatched).toEqual([EVENTO_RUTA]);
  });

  it('navigate a la ruta en la que ya se está no empuja nada', () => {
    const b = navegadorFalso('/pagos');
    navigate('pagos');
    expect(b.pushState).not.toHaveBeenCalled();
  });

  it('replaceRoute reemplaza sin dejar entrada', () => {
    const b = navegadorFalso('/tarjetas');
    replaceRoute('home');
    expect(b.replaceState).toHaveBeenCalledTimes(1);
    expect(b.pushState).not.toHaveBeenCalled();
    expect(b.url()).toBe('/home');
  });
});

/**
 * 🔴 **Opción A, adenda del Bibliotecario.** Los tres enlaces con secreto se
 * quedan en el fragmento: la conversión NUNCA los toca, y el token nunca pasa a
 * path ni a query.
 */
describe('n130 · opción A · los fragmentos con secreto no se convierten', () => {
  it.each([
    ['la invitación del dueño', '#/mesa/PA-2847?t=tok-invitacion-123'],
    ['la recuperación de cuenta', '#/recovery?token=tok-recuperacion-456'],
    ['la invitación de alta', '#/home?signup_invitation=inv-alta-789'],
    ['la familia #/recovery aun sin token', '#/recovery'],
    ['un token con mayúsculas', '#/mesa/PA-1?T=tok'],
    ['un token fuera de una query bien formada', '#/mesa/PA-1&t=tok'],
    // La clave codificada sólo la ve la lectura con URLSearchParams, que la
    // decodifica; la búsqueda de texto no. Las dos reglas cubren cosas distintas.
    ['una clave codificada (%74oken)', '#/mesa/PA-1?%74oken=tok'],
    ['signup_invitation codificada', '#/home?signup%5Finvitation=inv'],
  ])('%s: %s queda intacto en el fragmento', (_nombre, hash) => {
    expect(fragmentoConSecreto(hash)).toBe(true);
    const b = navegadorFalso(hash);
    expect(convertirFragmentoViejo()).toBe(false);
    expect(b.replaceState).not.toHaveBeenCalled();
    expect(b.url()).toBe(`/${hash}`);
    // El secreto nunca llega a path ni a query.
    expect(b.path()).toBe('/');
    expect(b.search()).toBe('');
  });

  it('al navegar desde un fragmento con secreto, el fragmento sale de la URL', () => {
    const b = navegadorFalso('#/mesa/PA-2847?t=tok-invitacion-123');
    navigate('mesa', 'PA-2847');
    expect(b.url()).toBe('/mesa/PA-2847');
    expect(b.url()).not.toContain('tok-invitacion-123');
  });
});

describe('n130 · los #/… viejos sin secreto pasan a su ruta', () => {
  it.each([
    ['#/mesas', '/mesas'],
    ['#/mesa/PA-2847', '/mesa/PA-2847'],
    ['#/scan?r=rest-1', '/scan?r=rest-1'],
    ['#/restaurantes', '/restaurantes'],
  ])('%s → %s, con replaceState', (hash, ruta) => {
    expect(fragmentoConSecreto(hash)).toBe(false);
    const b = navegadorFalso(hash);
    expect(convertirFragmentoViejo()).toBe(true);
    expect(b.replaceState).toHaveBeenCalledTimes(1);
    expect(b.pushState).not.toHaveBeenCalled();
    expect(b.url()).toBe(ruta);
  });

  it('suma la query del fragmento a la de la URL', () => {
    const b = navegadorFalso('/?r=rest-1#/scan?x=1');
    expect(convertirFragmentoViejo()).toBe(true);
    expect(b.url()).toBe('/scan?r=rest-1&x=1');
  });

  it('sin fragmento con ruta, no hace nada', () => {
    for (const inicial of ['/', '/#', '/#/', '/pagos']) {
      const b = navegadorFalso(inicial);
      expect(convertirFragmentoViejo(), inicial).toBe(false);
      expect(b.replaceState, inicial).not.toHaveBeenCalled();
    }
  });
});
