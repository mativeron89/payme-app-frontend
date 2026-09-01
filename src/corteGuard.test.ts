import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { RUTAS_DEL_CORTE, allowsCorteRoute, corteDePagosView } from './api/releaseGates';
import type { MesaDetail } from './api/types';
import { resetWalletRailForTests } from './api/walletRail';
import { enforceCorteRouteGuard } from './corteGuard';
import { PAGES, parseHash, type PageId } from './router';
import { MesaDetailView, type MesaDetailViewProps } from './screens/MesaDetailView';

/**
 * CORTE DEL VIERNES · orden `APP-FE-FRIDAY-NO-PAY-GUARD-02-CLAUDE` (2026-09-01).
 *
 * Producción pública SIN PAGOS: se cierra el checkout del participante —la
 * vista `pay` de la mesa, sus tres transiciones y sus dos controles— y el alta
 * de tarjeta en `#/tarjetas` y `#/cuenta`. `#/pagos` se conserva. La garantía
 * del organizador en `#/scan` queda alcanzable hasta la enmienda de A-1: este
 * archivo NO afirma que el corte sistémico esté completo.
 *
 * ## Qué se prueba, y por qué cada cosa
 *
 * Es el mismo molde que `walletRouteGuard.test.tsx`, porque el defecto que ese
 * archivo cerró es el que acá no puede volver: un predicado correcto que nadie
 * obedece no protege nada. Así que se recorre la cadena entera:
 *
 *   `corteDePagosView` → `allowsCorteRoute` → `enforceCorteRouteGuard` →
 *   `replaceRoute('home')` → `history.replaceState` → el hash queda en `#/home`
 *   → `App` no monta NADA de tarjetas → `MesaDetailView` no ofrece `Continuar`
 *   ni `Reintentar` → `MesaScreen` frena ANTES de `api.lockItems`
 *
 * Y con controles positivos en cada tramo: sin ellos, «no aparece» no distingue
 * *el gate funciona* de *acá no se renderiza nada*.
 *
 * ## 🔴 El pin, que es la afirmación más importante
 *
 * El corte es una CONSTANTE del front (ver `releaseGates.ts`, y por qué eso es
 * temporal y declarado). Este archivo la fija: cambiarla es una decisión de
 * producto y tiene que poner rojo, no pasar en silencio.
 *
 * ## Mutantes plantados el 2026-09-01, medidos y restaurados
 *
 *   `PAGOS_CORTADOS = false`                 → 17 rojos: el pin, la cadena,
 *                                              el árbol y releaseGates.test
 *   `goToPay` sin `if (!CORTE.allowsPay)`    → 1 rojo: el AST del lock
 *   `App.tsx` sin `if (rutaCortada) return`  → 3 rojos: árbol + cableado
 *   `corteGuard.ts` sin `replaceRoute`       → 8 rojos: la cadena entera
 *
 * ⚠️ El primero NO toca la vista: `MesaDetailView` recibe `pagosCortados` por
 * prop, así que sus tests prueban el componente bajo los dos valores y no la
 * constante. Lo que ata la constante a la vista es `MesaScreen`, que la lee
 * (`CORTE.pagosCortados`) y se afirma por AST; el e2e `mesa-igual-continuar`
 * es el que ejecuta esa unión de punta a punta.
 */

// ─── Harness (mismo que walletRouteGuard.test.tsx, y por las mismas razones) ─

function browserStub(hash: string) {
  let actual = hash;
  const hashWrites: string[] = [];
  const replaceState = vi.fn((_s: unknown, _t: string, url: string) => {
    const i = url.indexOf('#');
    actual = i >= 0 ? url.slice(i) : '';
  });
  const pushState = vi.fn();
  const dispatched: string[] = [];
  class FakeHashChangeEvent {
    type: string;
    constructor(type: string) { this.type = type; }
  }
  vi.stubGlobal('HashChangeEvent', FakeHashChangeEvent);
  vi.stubGlobal('window', {
    location: {
      pathname: '/',
      search: '',
      get hash() { return actual; },
      set hash(v: string) { hashWrites.push(v); actual = v; },
    },
    history: { state: null, replaceState, pushState },
    dispatchEvent: (e: { type: string }) => { dispatched.push(e.type); return true; },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  });
  return { replaceState, pushState, hashWrites, dispatched, hash: () => actual };
}

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  } as unknown as Storage;
}

/** Una sesión válida para `loadSession`, para que `App` pase del login. */
function conSesion() {
  const store = memoryStorage();
  store.setItem(
    'payme_app_session',
    JSON.stringify({
      access_token: 'at', refresh_token: 'rt',
      family_id: 'fam-1', principal_id: 'usr-1',
      user: { id: 'usr-1', name: 'Test', email: 't@e.mx' },
    }),
  );
  vi.stubGlobal('localStorage', store);
  vi.stubGlobal('sessionStorage', memoryStorage());
}

function render(hash: string) {
  conSesion();
  browserStub(hash);
  const fetchSpy = vi.fn(() => Promise.reject(new Error('ningún test debe llamar a la red')));
  vi.stubGlobal('fetch', fetchSpy);
  const markup = renderToStaticMarkup(createElement(App));
  return { markup, fetchSpy };
}

const CORTADAS: readonly PageId[] = ['tarjetas', 'cuenta'];
const NO_CORTADAS: readonly PageId[] = PAGES.filter((p) => !CORTADAS.includes(p));

beforeEach(() => {
  resetWalletRailForTests();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetWalletRailForTests();
});

// ─── El pin ──────────────────────────────────────────────────────────────────

describe('🔴 corte · el predicado está FIJADO y es coherente consigo mismo', () => {
  it('🔴 PIN · el corte está activo; cambiarlo es una decisión de producto, no un ajuste', () => {
    expect(
      corteDePagosView(),
      'PAGOS_CORTADOS cambió: eso reabre el checkout público y exige orden nueva, no un commit',
    ).toEqual({ pagosCortados: true, showCards: false, allowsPay: false });
  });

  it('las rutas cortadas son EXACTAMENTE tarjetas y cuenta, y las dos están en el router', () => {
    expect([...RUTAS_DEL_CORTE].sort()).toEqual([...CORTADAS].sort());
    for (const r of RUTAS_DEL_CORTE) expect(PAGES).toContain(r);
  });

  it('la lista se deriva del router: toda página está cortada o permitida, ninguna las dos', () => {
    for (const page of PAGES) {
      expect(allowsCorteRoute(page)).toBe(!CORTADAS.includes(page));
    }
    // `#/pagos` es la superficie card-only que el corte CONSERVA, y se nombra
    // sola: es lo que vuelve significativos los negativos de abajo.
    expect(allowsCorteRoute('pagos')).toBe(true);
  });
});

// ─── La cadena ───────────────────────────────────────────────────────────────

describe('🔴 corte · ruta cortada → replace de historial → home', () => {
  for (const page of CORTADAS) {
    it(`#/${page} termina en #/home sin dejar rastro`, () => {
      const b = browserStub(`#/${page}`);

      expect(enforceCorteRouteGuard(page)).toBe(true);

      expect(b.hash()).toBe('#/home');
      expect(parseHash(b.hash()).page).toBe('home');
      // ⭐ Por `replaceState`: con `navigate` o una asignación de hash la ruta
      // seguiría viva en el historial y el botón Atrás la recuperaría.
      expect(b.replaceState).toHaveBeenCalledTimes(1);
      expect(b.pushState).not.toHaveBeenCalled();
      expect(b.hashWrites).toEqual([]);
      // `replaceState` no dispara `hashchange`: sin esto el router no se entera.
      expect(b.dispatched).toEqual(['hashchange']);
    });
  }

  it.each(NO_CORTADAS)('ninguna otra ruta del router se toca · #/%s', (page) => {
    const b = browserStub(`#/${page}`);
    expect(enforceCorteRouteGuard(page)).toBe(false);
    expect(b.replaceState).not.toHaveBeenCalled();
    expect(b.hash()).toBe(`#/${page}`);
  });

  /**
   * La firma es `(page)` y no recibe la query: no hay lista de parámetros
   * prohibidos porque no hay por dónde pasarlos. Se afirma igual, con la URL
   * completa, para que quede dicho con casos y no con un argumento.
   */
  it.each([
    '#/tarjetas?pagos=1',
    '#/cuenta?corte=off',
    '#/tarjetas?demo=1',
    '#/cuenta?t=tok-abcdefgh',
    '#/TARJETAS',
  ])('%s sigue cortada', (hash) => {
    const b = browserStub(hash);
    const route = parseHash(hash);
    expect(enforceCorteRouteGuard(route.page)).toBe(true);
    expect(b.hash()).toBe('#/home');
  });

  it('si el historial está bloqueado, igual saca de la ruta', () => {
    let actual = '#/tarjetas';
    const hashWrites: string[] = [];
    vi.stubGlobal('HashChangeEvent', class { constructor(public type: string) {} });
    vi.stubGlobal('window', {
      location: {
        pathname: '/', search: '',
        get hash() { return actual; },
        set hash(v: string) { hashWrites.push(v); actual = v; },
      },
      history: { state: null, replaceState() { throw new Error('SecurityError'); } },
      dispatchEvent: () => true,
    });

    expect(() => enforceCorteRouteGuard('tarjetas')).not.toThrow();
    expect(actual).toBe('#/home');
    expect(hashWrites).toEqual(['#/home']);
  });
});

// ─── El árbol real ───────────────────────────────────────────────────────────

describe('🔴 corte · el árbol REAL no monta el alta de tarjeta', () => {
  /**
   * Vocabulario que SÓLO existe en la gestión de tarjetas. `renderToStaticMarkup`
   * no corre efectos —la redirección la prueban los tests de arriba—; lo que
   * esto prueba es lo otro: que `TarjetasScreen` **no se monta** y que nada
   * llama a la red.
   */
  const VOCABULARIO_TARJETAS = ['Mis tarjetas', 'Agregar tarjeta', 'Guardar tarjeta'];

  for (const page of CORTADAS) {
    it(`#/${page} no monta UI de tarjetas ni llama a nadie`, () => {
      const { markup, fetchSpy } = render(`#/${page}`);
      for (const palabra of VOCABULARIO_TARJETAS) expect(markup).not.toContain(palabra);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  }

  /**
   * ⭐ CONTROL POSITIVO. `#/pagos` es la superficie card-only que el corte
   * CONSERVA, y tiene que seguir montando SU pantalla. Es además la ruta que
   * reemplaza a `#/cuenta` como «ruta card-only de referencia» en toda prueba
   * que la usaba así: con el corte, `#/cuenta` ya no acredita que App renderice.
   */
  it('control positivo · #/pagos SÍ monta Mis pagos', () => {
    const { markup } = render('#/pagos');
    expect(markup).toContain('Mis pagos');
    expect(markup.length).toBeGreaterThan(200);
  });

  it('Inicio ofrece «Ver pagos» y NO «Ver tarjetas»', () => {
    const { markup } = render('#/home');
    expect(markup).toContain('Ver pagos');
    expect(markup).not.toContain('Ver tarjetas');
  });

  it('Configuración conserva sus filas y NO la de tarjetas', () => {
    const { markup } = render('#/mas');
    expect(markup).toContain('Configuraci');
    expect(markup).toContain('Idioma');
    expect(markup).not.toContain('Mis tarjetas');
  });
});

// ─── La vista de la mesa ─────────────────────────────────────────────────────

describe('🔴 corte · MesaDetailView cierra sus dos controles y conserva el aviso', () => {
  const MESA: MesaDetail = {
    id: 'm-1',
    code: 'PA-0001',
    full_name: 'La Parolaccia · Roma Norte',
    restaurant: { id: 'r-1', name: 'La Parolaccia', category: 'italiana', address: null },
    total_cents: 84000,
    total_display: '$840.00',
    paid_amount_cents: 0,
    tip_amount_cents: 0,
    tip_base_cents: 21000,
    division_mode: 'consumo',
    expected_participants: 4,
    status: 'open',
    expires_at: new Date(Date.now() + 25 * 60_000).toISOString(),
    items: [{
      id: 'i-1', name: 'Tagliatelle Bolognese', category: 'pasta', price_cents: 19500, quantity: 1,
      status: 'available', remaining_bps: 10000, my_bps: 0, locked_by_me: false, lock_expires_at: null,
    }],
    active_staff: [],
    my_role: 'participant',
  };

  function props(sobre: Partial<MesaDetailViewProps>): MesaDetailViewProps {
    return {
      mesa: MESA,
      code: MESA.code,
      isGuest: false,
      guestHeader: null,
      selected: new Map(),
      itemsAmount: 0,
      mySlotsTaken: 0,
      frozenScope: null,
      pagosCortados: true,
      busy: false,
      inviteOpen: false,
      onToggleItem: () => undefined,
      onSetFraction: () => undefined,
      onGoToPay: () => undefined,
      onRetryFrozenPay: () => undefined,
      onLeave: () => undefined,
      onOpenInvite: () => undefined,
      onCopyInvitationLink: () => undefined,
      onBack: () => undefined,
      ...sobre,
    };
  }

  function vista(sobre: Partial<MesaDetailViewProps>): string {
    browserStub('#/mesa/PA-0001');
    return renderToStaticMarkup(createElement(MesaDetailView, props(sobre)));
  }

  it('con el corte, el círculo es «Listo» y no hay «Continuar» hacia el pago', () => {
    const markup = vista({ pagosCortados: true });
    expect(markup).toContain('aria-label="Listo"');
    expect(markup).not.toContain('aria-label="Continuar"');
    // La selección sigue viva: es lo que la pantalla ofrece bajo el corte.
    expect(markup).toContain('Tagliatelle Bolognese');
    expect(markup).toContain('¿Qué consumiste?');
  });

  it('un pago congelado SE AVISA, sin botón de reintento y sin prometer reintentar', () => {
    const markup = vista({ pagosCortados: true, frozenScope: 'pay:PA-0001' });
    expect(markup).toContain('Tienes un pago sin confirmar.');
    expect(markup).toContain('Puedes revisarlo en Mis pagos.');
    expect(markup).not.toContain('Reintentar ese pago');
    expect(markup).not.toContain('Reinténtalo');
  });

  it('sin pago congelado no hay aviso', () => {
    const markup = vista({ pagosCortados: true, frozenScope: null });
    expect(markup).not.toContain('Tienes un pago sin confirmar.');
  });

  /**
   * ⭐ CONTROL POSITIVO · el camino al pago sigue AHÍ, dormido. Sin esto, las
   * ausencias de arriba pasarían igual si alguien hubiera borrado los
   * controles en vez de cerrarlos — y «desactivar no es borrar».
   */
  it('control positivo · sin el corte, la vista vuelve a ofrecer Continuar y Reintentar', () => {
    const markup = vista({ pagosCortados: false, frozenScope: 'pay:PA-0001' });
    expect(markup).toContain('aria-label="Continuar"');
    expect(markup).not.toContain('aria-label="Listo"');
    expect(markup).toContain('Reintentar ese pago');
    expect(markup).toContain('Reinténtalo tal cual');
  });
});

// ─── El dueño de las transiciones ────────────────────────────────────────────

describe('🔴 corte · MesaScreen frena ANTES de api.lockItems', () => {
  const FUENTES = import.meta.glob('/src/screens/MesaScreen.tsx', {
    query: '?raw', import: 'default', eager: true,
  }) as Record<string, string>;

  function arbol(): ts.SourceFile {
    const crudo = FUENTES['/src/screens/MesaScreen.tsx'];
    expect(crudo, 'no se pudo leer MesaScreen.tsx').toBeTruthy();
    return ts.createSourceFile('MesaScreen.tsx', crudo as string, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  }

  function* recorrer(n: ts.Node): Generator<ts.Node> {
    yield n;
    for (const h of n.getChildren()) yield* recorrer(h);
  }

  /**
   * Un `MesaScreen` montado necesita red y efectos, y esta suite no tiene
   * librería de render. Lo que sí se puede afirmar sin montar es la FORMA de
   * las tres transiciones: las dos de `goToPay` quedan después de un `return`
   * que precede a `api.lockItems`, y la del reintento va envuelta en el mismo
   * predicado. Es un guardarraíl de fuente por AST —más débil que ejecutar,
   * y queda dicho—; el e2e `mesa-igual-continuar` es el que lo ejecuta.
   */
  it('la primera sentencia de goToPay es el corte, y el lock viene después', () => {
    const sf = arbol();
    const goToPay = [...recorrer(sf)].find(
      (n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n) && n.name?.text === 'goToPay',
    );
    expect(goToPay, 'no se encontró goToPay').toBeDefined();
    const primera = goToPay!.body!.statements[0]!;
    expect(ts.isIfStatement(primera), 'goToPay no empieza con un if').toBe(true);
    const si = primera as ts.IfStatement;
    expect(si.expression.getText(sf)).toBe('!CORTE.allowsPay');
    expect(ts.isReturnStatement(si.thenStatement), 'el corte no retorna').toBe(true);

    const lock = [...recorrer(goToPay!)].find(
      (n) => ts.isCallExpression(n) && n.expression.getText(sf) === 'api.lockItems',
    );
    expect(lock, 'goToPay dejó de llamar a api.lockItems: se borró en vez de cerrar').toBeDefined();
    expect(lock!.getStart(sf)).toBeGreaterThan(si.getEnd());
  });

  it('las TRES transiciones a `pay` quedan bajo el predicado, y son tres', () => {
    const sf = arbol();
    const goToPay = [...recorrer(sf)].find(
      (n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n) && n.name?.text === 'goToPay',
    )!;
    const guarda = goToPay.body!.statements[0]!;
    const retry = [...recorrer(sf)].find(
      (n): n is ts.JsxAttribute => ts.isJsxAttribute(n) && n.name.getText(sf) === 'onRetryFrozenPay',
    );
    expect(retry, 'no se encontró onRetryFrozenPay').toBeDefined();
    expect(retry!.initializer!.getText(sf)).toContain('CORTE.allowsPay');

    const transiciones = [...recorrer(sf)].filter(
      (n) => ts.isCallExpression(n) && n.getText(sf) === "setView('pay')",
    );
    expect(transiciones.length, 'cambió la población de transiciones a pay').toBe(3);
    for (const tr of transiciones) {
      const enGoToPay = tr.getStart(sf) > guarda.getEnd() && tr.getEnd() <= goToPay.getEnd();
      const enRetry = tr.getStart(sf) >= retry!.getStart(sf) && tr.getEnd() <= retry!.getEnd();
      expect(enGoToPay || enRetry, `una transición quedó fuera del predicado: ${tr.getText(sf)}`).toBe(true);
    }
  });
});

// ─── Independencia y cableado ────────────────────────────────────────────────

describe('🔴 corte · el gate no lee el modo, la URL ni ningún principal', () => {
  const FUENTES = import.meta.glob(
    ['/src/corteGuard.ts', '/src/api/releaseGates.ts'],
    { query: '?raw', import: 'default', eager: true },
  ) as Record<string, string>;

  it('ningún módulo del gate lee nada del entorno', () => {
    expect(Object.keys(FUENTES).length).toBe(2);
    for (const [ruta, crudo] of Object.entries(FUENTES)) {
      const codigo = crudo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      for (const token of ['IS_MOCK', 'VITE_MOCK', 'import.meta.env', 'location', 'URLSearchParams', 'localStorage', 'sessionStorage', 'session']) {
        expect(`${ruta} → ${codigo.includes(token)}`).toBe(`${ruta} → false`);
      }
    }
  });
});

describe('🔴 corte · App.tsx delega en el guard', () => {
  const FUENTE = import.meta.glob('/src/App.tsx', {
    query: '?raw', import: 'default', eager: true,
  }) as Record<string, string>;

  it('llama al guard, devuelve null en la ruta cortada, y no reimplementa la redirección', () => {
    const texto = FUENTE['/src/App.tsx'];
    expect(texto).toBeDefined();
    expect((texto as string).length).toBeGreaterThan(1000);
    expect(texto).toContain('enforceCorteRouteGuard(route.page)');
    expect(texto).toContain('if (rutaCortada) return null;');
    expect(texto).not.toContain("replaceRoute('home')");
  });
});
