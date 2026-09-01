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

// ─── Evidencia dormida, censada ──────────────────────────────────────────────

/**
 * 🔴 ORDEN 04 · LOS SKIPS DE PLAYWRIGHT LEEN EL GATE, Y ESTÁN CENSADOS.
 *
 * El candidato anterior dormía 14 casos con un `true` fijo, y tres auditorías
 * ciegas dijeron lo mismo: esa evidencia no vuelve sola al levantar el gate.
 * Ahora cada skip es `test.skip(CORTE.pagosCortados, MOTIVO)` con
 * `CORTE = corteDePagosView()` importado de `releaseGates.ts` — el MISMO objeto
 * que lee la app—, y este censo lo fija fail-closed:
 *
 *   · la población es TODO `e2e/*.spec.ts`, no una lista de los que duermen;
 *   · un skip sólo es válido como PRIMERA sentencia de un `test(...)`, con el
 *     predicado EXACTO; cualquier otra forma —`true`, `fixme`, `describe.skip`,
 *     `only`, la forma declarativa `test.skip('título', fn)`— es rojo;
 *   · el conjunto (archivo, título) de los dormidos es EXACTO en las dos
 *     direcciones: uno de más o uno de menos es rojo;
 *   · los casos se DERIVAN: un `test` dentro de un `for … of [a, b]` cuenta
 *     por la longitud del array (af02: un call site, dos casos);
 *   · la garantía de `#/scan` —que el corte NO retira— tiene su recorrido
 *     ACTIVO, sin skip, afirmado por título y por contenido.
 *
 * Y con controles positivos sobre fuentes sintéticas: el clasificador ve el
 * `true` fijo, la forma declarativa y el `fixme`, o este censo no prueba nada.
 */
describe('🔴 corte · los skips de Playwright leen el gate y están censados', () => {
  const E2E = import.meta.glob('/e2e/*.spec.ts', {
    query: '?raw', import: 'default', eager: true,
  }) as Record<string, string>;

  const PREDICADO = 'CORTE.pagosCortados';
  const IMPORT_DEL_GATE = "from '../src/api/releaseGates'";

  /** Los que duermen MIENTRAS el gate esté activo. Título = texto fuente del primer argumento. */
  const DORMIDOS: Record<string, readonly string[]> = {
    '/e2e/af-correcciones-visuales-01.spec.ts': [
      "'Pagar separa resumen, propina, método y total sin duplicar el monto'",
    ],
    '/e2e/af-diseno-02.spec.ts': [
      "'Pagar centra el título, contiene destinatario y usa tarjeta en el CTA'",
      "'Comprobante solapa el cierre, rotula la tarjeta y conserva sus acciones'",
    ],
    '/e2e/af02-alta-tarjeta-durable.spec.ts': [
      "'AF-02 · una key fallida no fabrica continuidad ni atraviesa un rail luego cerrado'",
      '`AF-02 · continuidad ${stage} durable sobrevive con el rail cerrado`',
    ],
    '/e2e/atribucion-ventana.spec.ts': [
      "'🔴 con el journal pendiente NO se puede elegir tarjeta: la ventana se cierra'",
      "'🔴 tras un remount REAL, pantalla, compartir y descarga dicen lo mismo'",
    ],
    '/e2e/guardar-tarjeta-default.spec.ts': [
      "'nace desmarcado en garantía y en pago, y marcarlo sigue guardando'",
      "'sin marcar, la tarjeta NO aparece: el default es una decisión, no una decoración'",
    ],
    '/e2e/pago-completo.spec.ts': [
      "'la propina se recalcula: 0% deja el total en la parte exacta'",
      "'elegir 0% es una elección: se marca, y paga'",
    ],
    '/e2e/propina-coma.spec.ts': [
      '\'tipear "12,34" en el input real deja 1234 centavos, no 123400\'',
    ],
    '/e2e/propina-reconfirmacion.spec.ts': [
      '\'la propina desmedida pide reconfirmar: editar conserva el valor, y "Sí, pagar" paga\'',
    ],
  };
  const GARANTIA_ACTIVA = {
    archivo: '/e2e/guardar-tarjeta-default.spec.ts',
    titulo: "'la garantía de #/scan sigue viva bajo el corte: el checkbox existe y nace desmarcado'",
  };

  interface Hallazgo {
    archivo: string;
    titulo: string;
    /** `gate` = primera sentencia `test.skip(CORTE.pagosCortados, …)`; `ninguno` = sin skip. */
    skip: 'gate' | 'ninguno';
    /** Cuántos casos genera este call site: 1, o la longitud del array del `for … of` que lo envuelve. */
    casos: number;
    /** Algo dentro del test que no es la forma permitida. */
    ilegales: string[];
  }

  function* recorrer(n: ts.Node): Generator<ts.Node> {
    yield n;
    for (const h of n.getChildren()) yield* recorrer(h);
  }

  /** Desenvuelve `as const` y paréntesis; resuelve un identificador a su `const X = [...]` de nivel superior. */
  function arrayEnumerable(expr: ts.Expression, sf: ts.SourceFile): ts.ArrayLiteralExpression | null {
    let e: ts.Expression = expr;
    while (ts.isAsExpression(e) || ts.isParenthesizedExpression(e) || ts.isSatisfiesExpression(e)) e = e.expression;
    if (ts.isArrayLiteralExpression(e)) return e;
    if (ts.isIdentifier(e)) {
      for (const st of sf.statements) {
        if (!ts.isVariableStatement(st)) continue;
        for (const d of st.declarationList.declarations) {
          if (ts.isIdentifier(d.name) && d.name.text === e.text && d.initializer) return arrayEnumerable(d.initializer, sf);
        }
      }
    }
    return null;
  }

  /**
   * Sólo se DERIVA para los dormidos: un test activo dentro de un `for` sobre
   * algo no enumerable es legítimo (ej. `inicio-accesos`) y no es asunto de
   * este censo. Un DORMIDO dentro de un bucle no derivable sí es rojo: sus
   * casos no se podrían contar.
   */
  function casosDe(test: ts.Node, sf: ts.SourceFile): number {
    let p: ts.Node | undefined = test.parent;
    while (p) {
      if (ts.isForOfStatement(p)) {
        const arr = arrayEnumerable(p.expression, sf);
        if (arr) return arr.elements.length;
        throw new Error(`for…of no enumerable en ${sf.fileName}: ${p.expression.getText(sf)}`);
      }
      if (ts.isForStatement(p) || ts.isForInStatement(p) || ts.isWhileStatement(p)) {
        throw new Error(`bucle no derivable alrededor de un test en ${sf.fileName}`);
      }
      p = p.parent;
    }
    return 1;
  }

  /** Censa un spec: cada `test(...)`, su skip (o no), y todo lo que no sea la forma permitida. */
  function censarSkips(nombre: string, crudo: string): { tests: Hallazgo[]; ilegalesSueltos: string[] } {
    const sf = ts.createSourceFile(nombre, crudo, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const tests: Hallazgo[] = [];
    const ilegalesSueltos: string[] = [];
    const cuerposDeTests = new Set<ts.Node>();

    for (const n of recorrer(sf)) {
      if (!ts.isCallExpression(n)) continue;
      const callee = n.expression.getText(sf);
      // Formas que nunca pueden existir en la suite, estén donde estén.
      if (/^test\.(fixme|only)$/.test(callee) || /\.describe\.(skip|only|fixme)$/.test(callee) || callee === 'test.describe.skip') {
        ilegalesSueltos.push(`${nombre}: ${callee}(…)`);
        continue;
      }
      if (callee === 'test' && n.arguments.length >= 2) {
        const [tituloArg, fn] = n.arguments;
        if (!tituloArg || !fn || !(ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) || !fn.body || !ts.isBlock(fn.body)) continue;
        cuerposDeTests.add(fn.body);
        const h: Hallazgo = { archivo: nombre, titulo: tituloArg.getText(sf), skip: 'ninguno', casos: 1, ilegales: [] };
        fn.body.statements.forEach((st, i) => {
          if (!ts.isExpressionStatement(st) || !ts.isCallExpression(st.expression)) return;
          const c = st.expression;
          if (c.expression.getText(sf) !== 'test.skip') return;
          const args = c.arguments.map((a) => a.getText(sf));
          if (i === 0 && args.length === 2 && args[0] === PREDICADO) { h.skip = 'gate'; return; }
          h.ilegales.push(`test.skip(${args.join(', ')}) en la sentencia ${i}`);
        });
        if (h.skip === 'gate') h.casos = casosDe(n, sf);
        tests.push(h);
      }
      if (callee === 'test.skip') {
        // Un skip que NO sea la primera sentencia de un test ya quedó anotado arriba;
        // acá se caza la forma DECLARATIVA (`test.skip('título', fn)`) y cualquier
        // skip fuera de un cuerpo de test.
        let dentro = false;
        let p: ts.Node | undefined = n.parent;
        while (p) { if (cuerposDeTests.has(p)) { dentro = true; break; } p = p.parent; }
        const primer = n.arguments[0];
        if (!dentro || (primer && ts.isStringLiteralLike(primer))) {
          ilegalesSueltos.push(`${nombre}: test.skip(${n.arguments.map((a) => a.getText(sf)).join(', ')})`);
        }
      }
    }
    return { tests, ilegalesSueltos };
  }

  it('la población es TODO e2e/*.spec.ts, y no está vacía', () => {
    expect(Object.keys(E2E).length, 'el glob no encontró los specs').toBeGreaterThan(30);
    for (const archivo of Object.keys(DORMIDOS)) expect(E2E[archivo], `no existe ${archivo}`).toBeTruthy();
    expect(E2E[GARANTIA_ACTIVA.archivo]).toBeTruthy();
  });

  it('🔴 ningún skip permanente ni forma prohibida en TODA la suite de navegador', () => {
    const ilegales: string[] = [];
    for (const [archivo, crudo] of Object.entries(E2E)) {
      const { tests, ilegalesSueltos } = censarSkips(archivo, crudo);
      ilegales.push(...ilegalesSueltos);
      for (const t of tests) ilegales.push(...t.ilegales.map((x) => `${archivo} › ${t.titulo}: ${x}`));
      // Y a nivel texto, sin parser: el `true` fijo no puede existir ni escondido.
      const codigo = crudo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      if (codigo.includes('test.skip(true')) ilegales.push(`${archivo}: test.skip(true…)`);
    }
    expect(ilegales, `skips permanentes o formas prohibidas:\n  ${ilegales.join('\n  ')}`).toEqual([]);
  });

  it('🔴 el conjunto (archivo, título) de los dormidos es EXACTO, en las dos direcciones', () => {
    const hallados: Record<string, string[]> = {};
    for (const [archivo, crudo] of Object.entries(E2E)) {
      for (const t of censarSkips(archivo, crudo).tests) {
        if (t.skip === 'gate') (hallados[archivo] ??= []).push(t.titulo);
      }
    }
    const esperado = Object.fromEntries(Object.entries(DORMIDOS).map(([k, v]) => [k, [...v].sort()]));
    const medido = Object.fromEntries(Object.entries(hallados).map(([k, v]) => [k, [...v].sort()]));
    expect(medido).toEqual(esperado);
  });

  it('🔴 13 call sites → 14 casos, derivados del árbol; y todos leen el MISMO gate', () => {
    let callSites = 0;
    let casos = 0;
    for (const [archivo, crudo] of Object.entries(E2E)) {
      const dormidos = censarSkips(archivo, crudo).tests.filter((t) => t.skip === 'gate');
      if (dormidos.length === 0) continue;
      callSites += dormidos.length;
      casos += dormidos.reduce((s, t) => s + t.casos, 0);
      // El gate no se copia ni se redeclara: se IMPORTA del módulo de producción.
      expect(crudo, `${archivo} no importa el gate de releaseGates`).toContain(IMPORT_DEL_GATE);
      expect(crudo, `${archivo} no instancia CORTE desde corteDePagosView()`).toContain('const CORTE = corteDePagosView();');
    }
    expect(callSites).toBe(13);
    expect(casos).toBe(14);
    // Lo que Playwright tiene que reportar como `skipped`, DERIVADO del gate real.
    const dormidosEsperados = corteDePagosView().pagosCortados ? 14 : 0;
    expect(dormidosEsperados, 'con el gate activo, Playwright debe reportar 14 skipped').toBe(14);
  });

  it('🔴 la garantía de #/scan tiene un recorrido ACTIVO, sin skip, que afirma el checkbox desmarcado', () => {
    const crudo = E2E[GARANTIA_ACTIVA.archivo] as string;
    const activo = censarSkips(GARANTIA_ACTIVA.archivo, crudo).tests.find((t) => t.titulo === GARANTIA_ACTIVA.titulo);
    expect(activo, 'no existe el recorrido activo de la garantía').toBeDefined();
    expect(activo!.skip).toBe('ninguno');
    expect(activo!.ilegales).toEqual([]);
    // Contenido, no sólo título: llega a la garantía y afirma el checkbox.
    const sf = ts.createSourceFile('g', crudo, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const cuerpo = [...recorrer(sf)].find((n) => ts.isCallExpression(n) && n.expression.getText(sf) === 'test' && n.arguments[0]?.getText(sf) === GARANTIA_ACTIVA.titulo)!.getText(sf);
    expect(cuerpo).toContain("'Garantiza la mesa'");
    expect(cuerpo).toContain('not.toBeChecked()');
    expect(cuerpo).not.toContain("'Garantizar'");
    expect(cuerpo).not.toContain("'Pagar'");
  });

  /**
   * ⭐ CONTROLES POSITIVOS · el clasificador VE lo que promete cazar. Sin esto,
   * «cero ilegales» no distingue *no hay* de *no los veo*.
   */
  it('⭐ SONDA · el clasificador caza el true fijo, la forma declarativa, el fixme y el skip tardío', () => {
    const sonda = `
      import { test } from '@playwright/test';
      test('fijo', async () => { test.skip(true, 'x'); });
      test.skip('declarativo', async () => {});
      test.fixme('arreglar', async () => {});
      test('tardío', async () => { const a = 1; test.skip(CORTE.pagosCortados, MOTIVO); void a; });
      test('bien', async () => { test.skip(CORTE.pagosCortados, MOTIVO); });
      test('sin skip', async () => {});
    `;
    const { tests, ilegalesSueltos } = censarSkips('/sonda.spec.ts', sonda);
    expect(tests.find((t) => t.titulo === "'fijo'")!.ilegales).toEqual(["test.skip(true, 'x') en la sentencia 0"]);
    expect(tests.find((t) => t.titulo === "'tardío'")!.ilegales).toEqual(['test.skip(CORTE.pagosCortados, MOTIVO) en la sentencia 1']);
    expect(tests.find((t) => t.titulo === "'bien'")!.skip).toBe('gate');
    expect(tests.find((t) => t.titulo === "'sin skip'")!.skip).toBe('ninguno');
    expect(ilegalesSueltos).toEqual([
      "/sonda.spec.ts: test.skip('declarativo', async () => {})",
      '/sonda.spec.ts: test.fixme(…)',
    ]);
  });

  it('⭐ SONDA · los casos se derivan del for…of, y un bucle no enumerable es rojo', () => {
    const conLoop = `
      import { test } from '@playwright/test';
      for (const s of ['a', 'b', 'c'] as const) {
        test(\`t \${s}\`, async () => { test.skip(CORTE.pagosCortados, MOTIVO); });
      }
    `;
    expect(censarSkips('/loop.spec.ts', conLoop).tests[0]!.casos).toBe(3);
    // Un dormido dentro de un bucle que no se puede enumerar es rojo…
    const opaco = `
      import { test } from '@playwright/test';
      for (const s of casos()) { test(\`t \${s}\`, async () => { test.skip(CORTE.pagosCortados, MOTIVO); }); }
    `;
    expect(() => censarSkips('/opaco.spec.ts', opaco)).toThrow(/no enumerable/);
    // …pero un test ACTIVO en ese mismo bucle no es asunto del censo.
    const activoOpaco = `
      import { test } from '@playwright/test';
      for (const s of casos()) { test(\`t \${s}\`, async () => {}); }
    `;
    expect(censarSkips('/activo.spec.ts', activoOpaco).tests[0]!.skip).toBe('ninguno');
    // Y un identificador que apunta a un array de nivel superior SÍ se enumera.
    const porIdentificador = `
      import { test } from '@playwright/test';
      const CASOS = ['x', 'y'] as const;
      for (const s of CASOS) { test(\`t \${s}\`, async () => { test.skip(CORTE.pagosCortados, MOTIVO); }); }
    `;
    expect(censarSkips('/ident.spec.ts', porIdentificador).tests[0]!.casos).toBe(2);
  });
});
