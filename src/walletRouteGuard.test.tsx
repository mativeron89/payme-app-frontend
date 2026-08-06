import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { accountRailView } from './api/releaseGates';
import { applyWalletRailConfig, readWalletRail, resetWalletRailForTests } from './api/walletRail';
import { parseHash, type PageId } from './router';
import { enforceWalletRouteGuard } from './walletRouteGuard';

/**
 * ORDEN 4C · las rutas del riel saldo, probadas sobre la CADENA COMPLETA.
 *
 * ## Qué sobrevivía antes
 *
 * El único test de esto afirmaba `allowsWalletRoute(false, 'cargar') === false`
 * — o sea *"la ruta está prohibida"*. Eso sigue siendo cierto aunque **nadie
 * actúe en consecuencia**: borrar `replaceRoute('home')` dejaba la suite entera
 * en verde. Un predicado correcto que nadie obedece no protege nada, y lo que
 * acá no se protegería es la ratificación de wallet durmiente: cero UI y cero
 * rutas, en real y en mock.
 *
 * Así que lo que se recorre acá es la cadena entera, eslabón por eslabón:
 *
 *   payload real de `GET /api/config` → `readWalletRail` → decisión →
 *   `replaceRoute('home')` → `history.replaceState` → el hash queda en `#/home`
 *   → `App` no monta NADA del riel → cero endpoints llamados
 *
 * Cortá cualquier eslabón y algo de este archivo se pone rojo. Está verificado
 * con mutantes sobre el estado commiteado, no supuesto.
 *
 * ## Una trampa del entorno que hay que declarar
 *
 * `replaceRoute` despacha un `HashChangeEvent` porque `replaceState` no dispara
 * `hashchange` solo. **Node no tiene `HashChangeEvent`**, así que sin stub esa
 * línea tira, cae al `catch` y el redirect se hace asignando `location.hash` —
 * la vía que SÍ crea entrada de historial. El test pasaría igual y estaría
 * midiendo el camino equivocado.
 *
 * Por eso el harness lo define, y los tests afirman explícitamente que se usó
 * `replaceState` y **no** una asignación de hash. El fallback tiene su propio
 * test, aparte y declarado.
 */

// ─── Harness ─────────────────────────────────────────────────────────────────

/**
 * Un `window` donde `replaceState` **reescribe el hash de verdad**. Assertar
 * "me llamaron con tal string" sería una afirmación sobre la llamada; lo que
 * importa es en qué ruta queda la persona.
 */
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

// ─── Los payloads de capability ──────────────────────────────────────────────

/**
 * Los estados en que el riel está APAGADO. No son variantes decorativas: cada
 * uno es un backend real posible —uno viejo, uno a media configuración, un
 * proxy que reescribe, uno que todavía no contestó— y los cuatro tienen que
 * bloquear igual. `principal_scoped` además es un STOP reportable: es la forma
 * del permiso por cuenta que la ratificación prohíbe.
 */
const APAGADO: ReadonlyArray<readonly [string, unknown]> = [
  ['capability FALSA', { features: { wallet_rail: { enabled: false, account_activity: true } } }],
  ['capability AUSENTE (backend previo a OLA 5)', { features: {} }],
  ['capability MALFORMADA · no es objeto', { features: { wallet_rail: 'on' } }],
  ['capability MALFORMADA · enabled string', { features: { wallet_rail: { enabled: 'true', account_activity: true } } }],
  ['capability MALFORMADA · falta account_activity', { features: { wallet_rail: { enabled: true } } }],
  ['capability MALFORMADA · config no es objeto', 'no soy json'],
  ['PERMISO POR PRINCIPAL (STOP)', { features: { wallet_rail: { enabled: true, account_activity: true, enabled_for_restaurant: true } } }],
];

const RUTAS_DEL_RIEL: readonly PageId[] = ['cargar', 'transferir'];
const RUTAS_LEGITIMAS: readonly PageId[] = [
  // `grupos` salió de la unión con §1.9: Grupos es una pestaña de `amigos`, no
  // una ruta. El compilador la sacó de acá, que es lo que tiene que pasar.
  'home', 'cuenta', 'amigos', 'mas', 'avisos', 'mesas', 'mesa', 'scan',
  // §1.11 · las tres pantallas que lanzan las pestañas de Inicio. Se agregan
  // acá porque `allowsWalletRoute` es una lista de PROHIBIDOS: toda ruta nueva
  // nace permitida sin que nadie la mire, así que la única forma de que su
  // permiso quede acreditado es nombrarla en esta lista.
  'tarjetas', 'pagos', 'estadisticas',
];

beforeEach(() => {
  resetWalletRailForTests();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetWalletRailForTests();
});

// ─── La cadena ───────────────────────────────────────────────────────────────

describe('ORDEN 4C · ruta bloqueada → replace de historial → home', () => {
  for (const [nombre, config] of APAGADO) {
    for (const page of RUTAS_DEL_RIEL) {
      it(`${nombre} · #/${page} termina en #/home sin dejar rastro`, () => {
        const b = browserStub(`#/${page}`);
        const { walletRailEnabled } = applyWalletRailConfig(config);
        // El eslabón de arriba: ningún payload apagado puede encender el riel.
        expect(walletRailEnabled).toBe(false);

        expect(enforceWalletRouteGuard(walletRailEnabled, page)).toBe(true);

        // Dónde queda la persona.
        expect(b.hash()).toBe('#/home');
        expect(parseHash(b.hash()).page).toBe('home');
        // ⭐ Y por qué vía: `replaceState` REEMPLAZA la entrada actual. Con
        // `navigate` o con una asignación de hash, `#/cargar` seguiría viva en
        // el historial y el botón Atrás la recuperaría. Una ruta a la que no se
        // puede entrar tampoco se puede volver.
        expect(b.replaceState).toHaveBeenCalledTimes(1);
        expect(b.pushState).not.toHaveBeenCalled();
        expect(b.hashWrites).toEqual([]);
        // `replaceState` no dispara `hashchange`: sin esto el router no se
        // entera y la app queda pintando la ruta vieja.
        expect(b.dispatched).toEqual(['hashchange']);
      });
    }
  }

  /**
   * El estado inicial, antes de que el backend conteste. Es el que más importa
   * de todos: si acá el riel estuviera encendido, `#/cargar` sería alcanzable
   * durante toda la ventana en que la capability viaja por la red.
   */
  it('capability que todavía NO llegó (pending) también bloquea', () => {
    const b = browserStub('#/cargar');
    expect(enforceWalletRouteGuard(readWalletRail(undefined).walletRailEnabled, 'cargar')).toBe(true);
    expect(b.hash()).toBe('#/home');
  });

  /**
   * La única fila que NO bloquea, y está acá para que las de arriba signifiquen
   * algo: si el guard bloqueara siempre —por ejemplo porque alguien lo cableó a
   * `true`— este test se pone rojo. Un test que sólo prueba el caso prohibido
   * no distingue "gate correcto" de "gate trabado".
   *
   * Que el riel encendido habilite la ruta es autoridad del BACKEND, no de este
   * repo. Hoy el emisor declara `enabled: false` y siete entrypoints devuelven
   * 410; esto no enciende nada, sólo prueba que el gate obedece a quien manda.
   */
  it('con el backend declarando el riel ENCENDIDO, el guard no redirige', () => {
    const b = browserStub('#/cargar');
    const { walletRailEnabled } = applyWalletRailConfig({
      features: { wallet_rail: { enabled: true, account_activity: true } },
    });
    expect(walletRailEnabled).toBe(true);

    expect(enforceWalletRouteGuard(walletRailEnabled, 'cargar')).toBe(false);

    expect(b.replaceState).not.toHaveBeenCalled();
    expect(b.hash()).toBe('#/cargar');
  });

  it.each(RUTAS_LEGITIMAS)('la ruta card-only #/%s nunca se toca', (page) => {
    const b = browserStub(`#/${page}`);
    expect(enforceWalletRouteGuard(false, page)).toBe(false);
    expect(b.replaceState).not.toHaveBeenCalled();
    expect(b.hash()).toBe(`#/${page}`);
  });

  /**
   * El fallback: un navegador que no deja tocar el historial. Sacar a la
   * persona de la ruta prohibida importa más que preservar el historial, así
   * que ahí SÍ se asigna el hash — y queda dicho que es el camino degradado,
   * no el normal.
   */
  it('si el historial está bloqueado, igual saca de la ruta', () => {
    let actual = '#/cargar';
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

    expect(() => enforceWalletRouteGuard(false, 'cargar')).not.toThrow();
    expect(actual).toBe('#/home');
    expect(hashWrites).toEqual(['#/home']);
  });
});

// ─── Nada de la URL puede reencender el riel ─────────────────────────────────

describe('ORDEN 4C · ningún parámetro de URL alcanza el gate', () => {
  /**
   * El modo `?demo=1` fue ELIMINADO el 2026-08-03, no gateado (G-24, cerrado
   * por eliminación). Así que "cubrir demo" no puede ser un tercer build: es
   * comprobar que **ninguna** query string alcanza esta decisión.
   *
   * Y no depende de una lista de parámetros prohibidos —esas sólo defienden
   * contra lo que ya se te ocurrió—: la firma de `enforceWalletRouteGuard` es
   * `(walletRailEnabled, page)` y no recibe la query. No hay por dónde.
   */
  it.each([
    '#/cargar?demo=1',
    '#/cargar?wallet=1',
    '#/transferir?enabled=true',
    '#/cargar?wallet_rail=on&demo=1',
    '#/transferir?t=tok-abcdefgh',
  ])('%s sigue bloqueada', (hash) => {
    const b = browserStub(hash);
    const route = parseHash(hash);
    expect(enforceWalletRouteGuard(false, route.page)).toBe(true);
    expect(b.hash()).toBe('#/home');
  });
});

// ─── Cero montaje, cero endpoints ────────────────────────────────────────────

describe('ORDEN 4C · el árbol REAL no monta nada del riel saldo', () => {
  /**
   * Acá se monta `App` de verdad con `renderToStaticMarkup` —el mismo recurso
   * que usó Dashboard Frontend, ya es dependencia, no agrega ninguna—. No corre
   * efectos, así que **esto no prueba la redirección**: eso lo prueban los tests
   * de arriba. Lo que prueba es lo otro que la orden pide, y que ningún test de
   * decisión puede cubrir: que `TopupScreen` y `TransferScreen` **no se montan**
   * y que **no se llama a ningún endpoint**.
   */
  function render(hash: string) {
    conSesion();
    browserStub(hash);
    const fetchSpy = vi.fn(() => Promise.reject(new Error('ningún test debe llamar a la red')));
    vi.stubGlobal('fetch', fetchSpy);
    const markup = renderToStaticMarkup(<App />);
    return { markup, fetchSpy };
  }

  /**
   * Vocabulario que SÓLO existe en la UI del riel saldo. Si alguna de estas
   * palabras aparece en el markup, algo de wallet se montó.
   */
  const VOCABULARIO_WALLET = ['CLABE', 'Saldo PayMe', 'OXXO', 'Cargar saldo', 'Transferir'];

  for (const [nombre, config] of APAGADO) {
    for (const page of RUTAS_DEL_RIEL) {
      it(`${nombre} · #/${page} no monta UI ni llama a nadie`, () => {
        const { markup, fetchSpy } = render(`#/${page}`);
        applyWalletRailConfig(config);
        const salida = renderToStaticMarkup(<App />);

        for (const palabra of [...VOCABULARIO_WALLET]) {
          expect(markup).not.toContain(palabra);
          expect(salida).not.toContain(palabra);
        }
        expect(fetchSpy).not.toHaveBeenCalled();
      });
    }
  }

  /**
   * ⭐ CONTROL POSITIVO. Sin esto, todo lo de arriba podría estar pasando
   * porque `App` no renderiza nada NUNCA en este entorno —un throw tragado, un
   * provider que corta— y no me enteraría: la ausencia de una palabra no
   * distingue "el gate funciona" de "acá no se renderiza nada".
   *
   * Con el backend declarando el riel encendido, la pantalla del riel SÍ
   * aparece. O sea: el markup puede contener ese vocabulario, y si en los tests
   * de arriba no lo contiene es por el gate.
   */
  it('control positivo · con el riel ENCENDIDO por el backend, la pantalla sí monta', () => {
    conSesion();
    browserStub('#/cargar');
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('sin red'))));
    applyWalletRailConfig({ features: { wallet_rail: { enabled: true, account_activity: true } } });

    const markup = renderToStaticMarkup(<App />);

    expect(VOCABULARIO_WALLET.some((p) => markup.includes(p))).toBe(true);
  });

  /**
   * El otro control: que el árbol renderice ALGO en las rutas legítimas. Si
   * `App` devolviera vacío siempre, los tests de ausencia serían humo.
   */
  it('control positivo · una ruta card-only sí renderiza contenido', () => {
    const { markup } = render('#/cuenta');
    applyWalletRailConfig({ features: { wallet_rail: { enabled: false, account_activity: true } } });
    const salida = renderToStaticMarkup(<App />);
    expect(markup.length).toBeGreaterThan(200);
    expect(salida.length).toBeGreaterThan(200);
  });
});

// ─── Lo card-only no puede quedar gateado por wallet ─────────────────────────

describe('ORDEN 4C · apagar el riel no apaga nada card-only', () => {
  /**
   * El error de `07f0ba2`, que esta suite tiene que impedir que vuelva: un
   * único flag gobernaba el riel saldo Y el historial de pagos propio, y con
   * eso se escondió superficie card-only RATIFICADA que se conserva.
   */
  it.each(APAGADO)('%s · tarjetas y actividad de cuenta siguen visibles', (_n, config) => {
    const estado = readWalletRail(config);
    const vista = accountRailView(estado.walletRailEnabled, estado.accountActivity);

    expect(vista.showCards).toBe(true);
    expect(vista.showAccountActivity).toBe(true);
    // Y lo que sí es riel saldo, apagado.
    expect(vista.showBalance).toBe(false);
    expect(vista.showWalletMovements).toBe(false);
    expect(vista.showTopupTransfer).toBe(false);
  });

  /**
   * La forma fuerte: la actividad de cuenta falla hacia **conservar**. Ante un
   * backend viejo, uno malformado o la red caída, el historial propio NO se
   * esconde — apagarlo ahí sería repetir `07f0ba2` por fail-closed mal
   * orientado. Fallar "cerrado" para esa superficie significa no ocultarla.
   */
  it('ante cualquier fallo de capability, la actividad de cuenta se CONSERVA', () => {
    for (const [, config] of APAGADO) {
      expect(readWalletRail(config).accountActivity).toBe(true);
    }
    expect(readWalletRail(undefined).accountActivity).toBe(true);
  });
});

// ─── Independencia del modo ──────────────────────────────────────────────────

describe('ORDEN 4C · el gate no depende del modo ni de ningún principal', () => {
  const FUENTES = import.meta.glob(
    ['/src/walletRouteGuard.ts', '/src/api/releaseGates.ts', '/src/api/walletRail.ts'],
    { query: '?raw', import: 'default', eager: true },
  ) as Record<string, string>;

  /**
   * `IS_MOCK` y `VITE_MOCK` no aparecen en el CÓDIGO de ninguno de los tres
   * módulos que deciden esto. Por eso real y mock recorren el **mismo** lector:
   * no hay rama que el modo pueda tomar.
   *
   * Es una afirmación sobre la fuente porque el modo se congela en tiempo de
   * import: no se puede alternar dentro de una misma corrida sin fingir el
   * entorno, y fingirlo probaría el fingimiento.
   *
   * ⚠️ LÍMITE DECLARADO, porque me lo pregunté y la respuesta fue incómoda:
   * **la suite NO se puede correr con `VITE_MOCK=1`.** Ya estaba roja así antes
   * de esta orden —34 tests en 8 archivos, sobre el HEAD `4b490ca` sin ningún
   * cambio mío— porque está escrita contra el adaptador real. Así que "corrida
   * en los dos modos" no es evidencia disponible hoy, y no la invoco. Lo que sí
   * está verificado en modo mock es el **build** (`VITE_MOCK=1 npm run build`),
   * verde.
   */
  it('ningún módulo del gate lee el modo', () => {
    expect(Object.keys(FUENTES).length).toBe(3);
    for (const [ruta, crudo] of Object.entries(FUENTES)) {
      // Se mira el CÓDIGO, no la prosa: estos tres archivos NOMBRAN `IS_MOCK`
      // en sus comentarios justamente para explicar que no lo usan, y la
      // primera versión de este test se puso roja por eso. Bien puesta la
      // alarma, mal apuntada: lo que no puede existir es la lectura.
      // (Sin comillas de por medio en estos archivos, quitar comentarios
      //  alcanza; no pretende ser un parser.)
      const codigo = crudo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(`${ruta} → ${codigo.includes('IS_MOCK')}`).toBe(`${ruta} → false`);
      expect(`${ruta} → ${codigo.includes('VITE_MOCK')}`).toBe(`${ruta} → false`);
      expect(`${ruta} → ${codigo.includes('import.meta.env')}`).toBe(`${ruta} → false`);
    }
  });

  /**
   * Un payload con forma de permiso por cuenta apaga el riel **y se denuncia**.
   * Apagarlo en silencio haría indistinguible "el backend está bien" de "el
   * backend intentó reactivar wallet por restaurante".
   */
  it('un permiso por principal apaga el riel Y queda denunciado', () => {
    const denuncia = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const b = browserStub('#/cargar');
    const { walletRailEnabled, status, offendingKeys } = applyWalletRailConfig({
      features: { wallet_rail: { enabled: true, account_activity: true, enabled_for_restaurant: true } },
    });

    expect(status).toBe('principal_scoped');
    expect(offendingKeys).toEqual(['enabled_for_restaurant']);
    expect(walletRailEnabled).toBe(false);
    expect(enforceWalletRouteGuard(walletRailEnabled, 'cargar')).toBe(true);
    expect(b.hash()).toBe('#/home');
    expect(denuncia).toHaveBeenCalledTimes(1);
  });
});

// ─── Guardarraíl de cableado ─────────────────────────────────────────────────

describe('ORDEN 4C · App.tsx delega en el guard', () => {
  const FUENTE = import.meta.glob('/src/App.tsx', {
    query: '?raw', import: 'default', eager: true,
  }) as Record<string, string>;

  function cuerpo(): string {
    const texto = FUENTE['/src/App.tsx'];
    // Guardarraíl del guardarraíl: sin esto, un glob vacío haría pasar todo lo
    // de abajo sin probar nada.
    expect(texto).toBeDefined();
    expect((texto as string).length).toBeGreaterThan(1000);
    return texto as string;
  }

  /**
   * Lo único del cableado que NO es ejercitable sin librería de render es la
   * llamada dentro del `useEffect`. Esto no la ejecuta —no puede— pero impide
   * la regresión concreta: que alguien vuelva a poner la redirección inline y
   * la deje otra vez fuera del alcance de cualquier test.
   *
   * Es un guardarraíl más débil que un test de comportamiento, y queda dicho.
   */
  it('llama al guard y no reimplementa la redirección', () => {
    const texto = cuerpo();
    expect(texto).toContain('enforceWalletRouteGuard(walletRailEnabled, route.page)');
    expect(texto).not.toContain("replaceRoute('home')");
  });
});
