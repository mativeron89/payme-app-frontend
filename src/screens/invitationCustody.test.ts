import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readPendingInvitationLink, tokenForMesa } from '../api/invitationLink';
import {
  closeInvitationCustody,
  openInvitationCustody,
  settleInvitationFailure,
} from './invitationCustody';

/**
 * ORDEN 4B · el token terminal, probado sobre el CABLEADO y no sobre el helper.
 *
 * ## Por qué el helper aislado no alcanzaba
 *
 * `stripTokenFromUrl` tiene sus propios tests y **funciona perfecto**: retira
 * `t`, preserva `r`, usa `replaceState`, no explota si el navegador no deja
 * tocar el historial. Todos pasaban con el defecto adentro, porque el defecto
 * nunca estuvo ahí: estaba en que la rama terminal **no lo llamaba**.
 *
 * Un helper correcto que nadie invoca es exactamente el antipatrón que este
 * ciclo ya se comió dos veces —defensas declaradas que no ejecutan nada—. Así
 * que lo que se recorre acá es la SECUENCIA: qué pasa con las dos custodias,
 * storage y URL, para cada resultado del canje.
 *
 * ## Las dos custodias, que es la clave de todo
 *
 * El token vive en dos lados y **no siempre en los dos a la vez**:
 *
 *  - **storage**, si el round-trip cerró;
 *  - **la URL**, siempre al principio, y para siempre si el round-trip falló —
 *    porque ahí `openInvitationCustody` NO limpia el hash, a propósito:
 *    preferimos un token visible a un token perdido.
 *
 * El estado peligroso es justamente el segundo. Por eso cada fila de la matriz
 * se corre con storage funcional, con storage que **lanza**, y con storage que
 * acepta la escritura y **no persiste** — que es el caso que ninguna excepción
 * delata y el que dejaba el `?t=` muerto vivo en la barra de direcciones.
 *
 * ## Lo que NO se puede cerrar sin navegador · ANCLA DECLARADA
 *
 * Ver el bloque `ANCLA` al final. El botón Atrás real y una recarga real
 * necesitan un navegador; acá se fija lo que sí es verificable —que ninguna
 * entrada de historial nueva se crea, o sea que no hay adónde volver que tenga
 * el token— y se declara explícitamente lo que queda afuera.
 */

// ─── Storages ────────────────────────────────────────────────────────────────

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

/** Safari en modo privado y algunos WebView TIRAN al tocar `sessionStorage`. */
function throwingStorage() {
  return {
    getItem() { throw new Error('SecurityError'); },
    setItem() { throw new Error('SecurityError'); },
    removeItem() { throw new Error('SecurityError'); },
  } as unknown as Storage;
}

/**
 * El peor de los tres: acepta el `setItem` sin quejarse y no guarda nada. Cuota
 * llena, storage particionado. Ninguna excepción lo delata — sólo el
 * round-trip.
 */
function amnesicStorage() {
  return {
    getItem: () => null,
    setItem() { /* acepta y descarta */ },
    removeItem() {},
  } as unknown as Storage;
}

const STORAGES: ReadonlyArray<readonly [string, () => Storage]> = [
  ['storage funcional', memoryStorage],
  ['storage que lanza', throwingStorage],
  ['storage que acepta y no persiste', amnesicStorage],
];

// ─── URL ─────────────────────────────────────────────────────────────────────

/**
 * Un `window` mínimo donde `replaceState` **de verdad reescribe el hash**. Sin
 * eso sólo se podría assertar "me llamaron con tal string", que es una
 * afirmación sobre la llamada; lo que importa es el estado en el que queda la
 * barra de direcciones.
 *
 * `hashWrites` existe para atrapar la regresión inversa: si alguien "arregla"
 * esto asignando `location.hash`, crea una entrada de historial nueva y deja
 * viva la anterior con el `?t=`. Back revive el token.
 */
function urlStub(hash: string) {
  let actual = hash;
  const hashWrites: string[] = [];
  const replaceState = vi.fn((_state: unknown, _title: string, url: string) => {
    const i = url.indexOf('#');
    actual = i >= 0 ? url.slice(i) : '';
  });
  const pushState = vi.fn();
  vi.stubGlobal('window', {
    location: {
      pathname: '/',
      search: '',
      get hash() { return actual; },
      set hash(v: string) { hashWrites.push(v); actual = v; },
    },
    history: { state: null, replaceState, pushState },
  });
  return {
    replaceState,
    pushState,
    hashWrites,
    /** El hash como quedaría en la barra de direcciones. */
    hash: () => actual,
  };
}

const CODE = 'PA-2847';
const TOKEN = 'tok-abcdefgh';
const LINK = `#/mesa/${CODE}?t=${TOKEN}`;

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── La matriz ───────────────────────────────────────────────────────────────

/**
 * Las siete filas del contrato de `invitationCustody.ts`. `status` es el de
 * `extractApiError`: `null` cubre red caída, timeout y 2xx malformado, que es
 * el conjunto que NO dice nada sobre si el token sirve.
 */
const MATRIZ: ReadonlyArray<{
  caso: string;
  status: number | null;
  terminal: boolean;
  outcome: string;
}> = [
  { caso: '400 · el link no tiene forma de link', status: 400, terminal: true, outcome: 'invalid' },
  { caso: '403 · rechazo ciego (los cuatro motivos)', status: 403, terminal: true, outcome: 'rejected' },
  // v2.45.0 · token GENUINO, mesa muerta. Terminal: la mesa no revive y el
  // emisor lo dice ("no hay replay útil") — conservar el token sería invitar
  // a reintentar contra una puerta que no se va a abrir.
  { caso: '410 · mesa_not_joinable (v2.45.0)', status: 410, terminal: true, outcome: 'mesa_cerrada' },
  { caso: '503 · el emisor no pudo verificar', status: 503, terminal: false, outcome: 'unavailable' },
  { caso: 'red caída / timeout', status: null, terminal: false, outcome: 'error' },
  { caso: '5xx genérico', status: 500, terminal: false, outcome: 'error' },
  { caso: '502 del proxy', status: 502, terminal: false, outcome: 'error' },
  { caso: '2xx malformado (status null)', status: null, terminal: false, outcome: 'error' },
];

describe('ORDEN 4B · matriz de custodia · una fila por resultado', () => {
  for (const [nombreStorage, hacerStorage] of STORAGES) {
    describe(nombreStorage, () => {
      beforeEach(() => {
        vi.stubGlobal('sessionStorage', hacerStorage());
      });

      /**
       * ⭐ EL DEFECTO DE 4B, EXACTO.
       *
       * Con storage que no persiste, `openInvitationCustody` deja el `?t=` en la
       * URL a propósito — es la única custodia que queda. Un 400 o un 403
       * limpiaban un storage vacío y **no tocaban la URL**: la credencial que el
       * emisor acaba de declarar inservible seguía en la barra de direcciones y
       * en el historial de un teléfono que se pasa en la mesa.
       */
      for (const fila of MATRIZ.filter((f) => f.terminal)) {
        it(`${fila.caso} ⇒ suelta storage Y URL`, () => {
          const url = urlStub(LINK);
          openInvitationCustody(CODE, TOKEN);

          expect(settleInvitationFailure(fila.status)).toBe(fila.outcome);

          // Las DOS custodias, no una.
          expect(readPendingInvitationLink()).toBeNull();
          expect(url.hash()).not.toContain('t=');
          expect(url.hash()).not.toContain(TOKEN);
          // Y no queda por dónde volver a agarrarlo.
          expect(tokenForMesa(CODE, null)).toBeNull();
        });
      }

      /**
       * Conservar no es un detalle: si se suelta un token vivo, el botón
       * Reintentar no tiene qué canjear y la persona queda afuera de la mesa a
       * la que la invitaron sin siquiera un error que lo explique.
       */
      for (const fila of MATRIZ.filter((f) => !f.terminal)) {
        it(`${fila.caso} ⇒ CONSERVA la custodia que haya`, () => {
          const url = urlStub(LINK);
          const custodiado = openInvitationCustody(CODE, TOKEN);

          expect(settleInvitationFailure(fila.status)).toBe(fila.outcome);

          // El token sigue disponible por ALGUNA de las dos vías: si el
          // round-trip cerró está en storage y la URL ya se limpió; si no
          // cerró, la URL es la única custodia y tiene que seguir intacta.
          if (custodiado) {
            expect(readPendingInvitationLink()?.token).toBe(TOKEN);
          } else {
            expect(url.hash()).toContain(`t=${TOKEN}`);
          }
          const desdeLaUrl = new URLSearchParams(url.hash().split('?')[1] ?? '').get('t');
          expect(tokenForMesa(CODE, desdeLaUrl)).toBe(TOKEN);
        });
      }

      it('el canje exitoso suelta storage Y URL', () => {
        const url = urlStub(LINK);
        openInvitationCustody(CODE, TOKEN);

        closeInvitationCustody();

        expect(readPendingInvitationLink()).toBeNull();
        expect(url.hash()).not.toContain(TOKEN);
        expect(tokenForMesa(CODE, null)).toBeNull();
      });
    });
  }
});

// ─── El estado que hacía invisible al defecto ────────────────────────────────

describe('ORDEN 4B · el round-trip decide quién custodia', () => {
  it('storage funcional: la URL se limpia en la apertura, el storage guarda', () => {
    vi.stubGlobal('sessionStorage', memoryStorage());
    const url = urlStub(LINK);

    expect(openInvitationCustody(CODE, TOKEN)).toBe(true);

    expect(url.hash()).toBe(`#/mesa/${CODE}`);
    expect(readPendingInvitationLink()?.token).toBe(TOKEN);
  });

  /**
   * ⭐ La decisión que nadie debe "corregir": si el round-trip falla, **la URL
   * NO se toca**. Un token visible es peor que nada, pero un token perdido deja
   * a la persona registrada y afuera de la mesa — que es peor que el defecto
   * que el cierre del pago sin cuenta vino a cerrar.
   */
  it('storage que no persiste: la URL queda como ÚNICA custodia, intacta', () => {
    vi.stubGlobal('sessionStorage', amnesicStorage());
    const url = urlStub(LINK);

    expect(openInvitationCustody(CODE, TOKEN)).toBe(false);

    expect(url.hash()).toBe(LINK);
    expect(url.replaceState).not.toHaveBeenCalled();
  });

  it('storage que lanza: idem, y sin explotar', () => {
    vi.stubGlobal('sessionStorage', throwingStorage());
    const url = urlStub(LINK);

    expect(() => openInvitationCustody(CODE, TOKEN)).not.toThrow();
    expect(url.hash()).toBe(LINK);
  });

  /**
   * `r` es el uuid del restaurante del QR (G-01). El terminal se lleva el token
   * y **sólo** el token: llevarse `r` puesto rompería otro flujo para arreglar
   * éste.
   */
  it('el terminal preserva los demás parámetros legítimos', () => {
    vi.stubGlobal('sessionStorage', amnesicStorage());
    const url = urlStub(`#/mesa/${CODE}?r=uuid-del-qr&t=${TOKEN}`);
    openInvitationCustody(CODE, TOKEN);

    settleInvitationFailure(403);

    expect(url.hash()).toBe(`#/mesa/${CODE}?r=uuid-del-qr`);
  });
});

// ─── Historial ───────────────────────────────────────────────────────────────

describe('ORDEN 4B · Back no revive el token', () => {
  /**
   * ⭐ `replaceState` REEMPLAZA la entrada actual. Asignar `location.hash`
   * crearía una nueva y dejaría viva la anterior **con el `?t=` adentro**: el
   * botón Atrás la recupera, `useRoute` la parsea y la app vuelve a custodiar
   * un token que ya se había soltado.
   *
   * Esto es lo que hace que la limpieza del terminal sirva de algo: sin ello,
   * limpiar la URL actual y dejar la vieja en el historial no limpia nada.
   */
  it.each([[400], [403]])('el terminal %i limpia sin crear entrada de historial', (status) => {
    vi.stubGlobal('sessionStorage', amnesicStorage());
    const url = urlStub(LINK);
    openInvitationCustody(CODE, TOKEN);

    settleInvitationFailure(status);

    expect(url.replaceState).toHaveBeenCalledTimes(1);
    expect(url.pushState).not.toHaveBeenCalled();
    expect(url.hashWrites).toEqual([]);
  });

  it('el éxito tampoco crea entrada de historial', () => {
    vi.stubGlobal('sessionStorage', amnesicStorage());
    const url = urlStub(LINK);
    openInvitationCustody(CODE, TOKEN);

    closeInvitationCustody();

    expect(url.pushState).not.toHaveBeenCalled();
    expect(url.hashWrites).toEqual([]);
  });

  /**
   * Un navegador que no deja tocar el historial no puede romper el canje: el
   * estado visible tiene que salir igual, aunque la URL no se pueda limpiar.
   */
  it('un historial bloqueado no rompe el resultado', () => {
    vi.stubGlobal('sessionStorage', memoryStorage());
    vi.stubGlobal('window', {
      location: { hash: LINK, pathname: '/', search: '' },
      history: { state: null, replaceState() { throw new Error('SecurityError'); } },
    });

    expect(() => openInvitationCustody(CODE, TOKEN)).not.toThrow();
    expect(settleInvitationFailure(403)).toBe('rejected');
    // La custodia que SÍ se pudo soltar, se soltó.
    expect(readPendingInvitationLink()).toBeNull();
  });
});

// ─── Recarga ─────────────────────────────────────────────────────────────────

describe('ORDEN 4B · recargar después de un terminal no resucita el token', () => {
  /**
   * Recargar vuelve a montar la pantalla y a resolver el token desde cero, con
   * `tokenForMesa(code, ?t= de la URL)`. Después de un terminal las dos fuentes
   * tienen que estar vacías — si una sobrevive, esa mesa queda capturada por un
   * link inválido en cada visita: entrás, canjea solo, falla, y no hay salida.
   */
  it.each(STORAGES)('%s · ninguna de las dos fuentes sobrevive', (_n, hacerStorage) => {
    vi.stubGlobal('sessionStorage', hacerStorage());
    const url = urlStub(LINK);
    openInvitationCustody(CODE, TOKEN);
    settleInvitationFailure(403);

    // El remonte de la recarga: la URL es la fuente primaria, el storage el
    // respaldo. Exactamente como lo resuelve `App.tsx`.
    const desdeLaUrl = new URLSearchParams(url.hash().split('?')[1] ?? '').get('t');
    expect(tokenForMesa(CODE, desdeLaUrl)).toBeNull();
  });

  it('en cambio, un 503 sobrevive a la recarga y se puede reintentar', () => {
    vi.stubGlobal('sessionStorage', memoryStorage());
    const url = urlStub(LINK);
    openInvitationCustody(CODE, TOKEN);
    settleInvitationFailure(503);

    const desdeLaUrl = new URLSearchParams(url.hash().split('?')[1] ?? '').get('t');
    expect(tokenForMesa(CODE, desdeLaUrl)).toBe(TOKEN);
  });
});

// ─── Guardarraíl de cableado ─────────────────────────────────────────────────

describe('ORDEN 4B · la pantalla delega, no reimplementa', () => {
  const FUENTE = import.meta.glob('/src/screens/JoinMesaScreen.tsx', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>;

  function cuerpo(): string {
    const [ruta] = Object.keys(FUENTE);
    // Guardarraíl del guardarraíl: si el glob no encontró el archivo, todo lo
    // de abajo pasaría en vacío y no probaría absolutamente nada.
    expect(ruta).toBeDefined();
    const texto = FUENTE[ruta as string] as string;
    expect(texto.length).toBeGreaterThan(1000);
    return texto;
  }

  /**
   * La parte del cableado que NO es ejercitable sin librería de render son las
   * tres llamadas dentro de los `useEffect`. Esto no las ejecuta —no puede— pero
   * sí impide la regresión concreta que 4B cierra: que alguien vuelva a llamar
   * `clearPendingInvitationLink()` suelto y se olvide otra vez de la URL.
   *
   * Es un guardarraíl más débil que un test de comportamiento, y queda dicho.
   */
  it('no toca los helpers de custodia por su cuenta', () => {
    const texto = cuerpo();
    expect(texto).not.toContain('clearPendingInvitationLink');
    expect(texto).not.toContain('rememberInvitationLink');
    expect(texto).not.toContain('stripTokenFromUrl');
  });

  it('usa las tres entradas de la secuencia', () => {
    const texto = cuerpo();
    expect(texto).toContain('openInvitationCustody(code, token)');
    expect(texto).toContain('closeInvitationCustody()');
    expect(texto).toContain('settleInvitationFailure(status)');
  });
});

// ─── Ancla ───────────────────────────────────────────────────────────────────

describe('ORDEN 4B · el ancla, YA CERRADA en navegador (ORDEN 5)', () => {
  /**
   * ✅ EL ANCLA SE CERRÓ. Este bloque decía "no probado acá, y no se da por
   * probado": faltaba el comportamiento REAL de `history.back()` y de una
   * recarga real. **Ya no falta** — `e2e/invitacion-back.spec.ts` (ORDEN 5) lo
   * ejercita en Chromium con viewport de teléfono.
   *
   * No se borra el ancla: se la **actualiza y se la apunta a donde vive ahora**.
   * Una nota que dice "esto no se prueba" borrada sin más deja al siguiente sin
   * saber si se cerró o si alguien se cansó de leerla.
   *
   * Lo que sigue fijado ACÁ, sin navegador, y que sigue siendo lo primero que se
   * rompe si alguien toca la custodia:
   *
   *  - la limpieza usa `replaceState` y **nunca** `pushState` ni asignación de
   *    hash, así que no se CREA ninguna entrada de historial nueva con el token;
   *  - el hash resultante no contiene `t`;
   *  - resolver el token desde cero después de un terminal —que es lo que hace
   *    el remonte de una recarga— devuelve `null` en las tres variantes de
   *    storage.
   *
   * Lo que sigue SIN poderse afirmar desde acá, y por eso hay un e2e: qué pasa
   * con entradas de historial **anteriores** a que la pantalla se montara.
   * `replaceState` no las alcanza y ningún test de esta suite las ve.
   *
   * El test de abajo es el puntero: exige que el runner y **el spec concreto**
   * existan. Si alguien borra el e2e o desinstala Playwright, esto se pone rojo
   * y el ancla vuelve a estar declarada en vez de desaparecer en silencio.
   */
  it('el recorrido de navegador que cierra el ancla existe', () => {
    const pkg = import.meta.glob('/package.json', {
      query: '?raw', import: 'default', eager: true,
    }) as Record<string, string>;
    const manifiesto = JSON.parse(pkg['/package.json'] as string) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = Object.keys({ ...manifiesto.dependencies, ...manifiesto.devDependencies });

    // El runner está, y es el único que Mati autorizó.
    expect(deps).toContain('@playwright/test');
    /**
     * ⚠️ Y jsdom / happy-dom / Testing Library **siguen prohibidos**, que es una
     * ratificación distinta y que Playwright NO derogó. La diferencia importa:
     * un navegador de verdad prueba la app; un DOM simulado prueba una
     * aproximación al DOM, y esa aproximación fue lo que se rechazó.
     */
    const domSimulado = deps.filter((d) => /jsdom|happy-dom|testing-library|enzyme/i.test(d));
    expect(domSimulado).toEqual([]);

    // Y el recorrido concreto existe. Si alguien borra el e2e o desinstala
    // Playwright, esto se pone rojo y el ancla vuelve a estar declarada en vez
    // de desaparecer en silencio.
    const specs = import.meta.glob('/e2e/*.spec.ts', {
      query: '?raw', import: 'default', eager: true,
    }) as Record<string, string>;
    const back = specs['/e2e/invitacion-back.spec.ts'];
    expect(back, 'falta el e2e que cierra el ancla de 4B').toBeTruthy();
    // Que sea el recorrido que decimos que es, no un archivo vacío con el
    // nombre correcto.
    expect(back).toContain('page.goBack()');
  });
});
