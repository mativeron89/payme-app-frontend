import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PAGES } from '../router';
import { RUTAS_DEL_CORTE, accountRailView, allowsCorteRoute, allowsWalletRoute, corteDePagosView } from './releaseGates';
import { MONEY_RAIL_CERRADO } from './moneyRail';

/**
 * 🔴 CORTE DEL VIERNES · orden `APP-FE-FRIDAY-NO-PAY-GUARD-02-CLAUDE`.
 *
 * El predicado es una constante del front —temporal y declarado en
 * `releaseGates.ts`—, y por eso este archivo lo FIJA: cambiarlo reabre el
 * checkout público y tiene que poner rojo, no pasar en silencio. La cadena
 * completa (guard → historial → árbol → vista) vive en `corteGuard.test.ts`.
 */
describe('corte del viernes · producción pública sin pagos', () => {
  /**
   * 🔴 F2 · el «PIN» ya no fija una constante: fija el ESTADO INICIAL del riel,
   * que es el que ve cualquier pantalla antes de que conteste el dueño. Ése es
   * el momento en que el corte tiene que estar activo sí o sí.
   */
  it('🔴 PIN · con el riel en su estado inicial el corte está activo', () => {
    expect(corteDePagosView(MONEY_RAIL_CERRADO))
      .toEqual({ pagosCortados: true, showCards: false, allowsPay: false });
  });

  it('corta EXACTAMENTE tarjetas y cuenta; toda otra página del router pasa', () => {
    expect([...RUTAS_DEL_CORTE].sort()).toEqual(['cuenta', 'tarjetas']);
    for (const page of PAGES) {
      expect(`${page} → ${allowsCorteRoute(page, MONEY_RAIL_CERRADO)}`)
        .toBe(`${page} → ${!RUTAS_DEL_CORTE.includes(page)}`);
    }
    // Lo que el corte CONSERVA, nombrado: el histórico propio.
    expect(allowsCorteRoute('pagos', MONEY_RAIL_CERRADO)).toBe(true);
  });

  /**
   * Dos gates, dos razones. `accountRailView(...).showCards` sigue en `true`
   * —apagar el riel saldo NO apaga tarjetas, y `walletRouteGuard.test.tsx` lo
   * exige—; lo que las esconde es el corte. Un consumidor tiene que leer los
   * dos, y ninguno puede sustituir al otro.
   */
  it('el corte NO se cuela en accountRailView: son predicados distintos', () => {
    expect(accountRailView(false, true).showCards).toBe(true);
    expect(accountRailView(true, true).showCards).toBe(true);
    expect(corteDePagosView(MONEY_RAIL_CERRADO).showCards).toBe(false);
  });
});

describe('gate IFPE de release', () => {
  it('riel apagado conserva tarjetas y elimina todo affordance wallet', () => {
    expect(accountRailView(false, true)).toEqual({
      showCards: true,
      showAccountActivity: true,
      showBalance: false,
      showWalletMovements: false,
      showTopupTransfer: false,
    });
    expect(allowsWalletRoute(false, 'cargar')).toBe(false);
    expect(allowsWalletRoute(false, 'transferir')).toBe(false);
    expect(allowsWalletRoute(false, 'cuenta')).toBe(true);
  });

  it('riel encendido por el backend conserva ambos rieles', () => {
    expect(accountRailView(true, true)).toEqual({
      showCards: true,
      showAccountActivity: true,
      showBalance: true,
      showWalletMovements: true,
      showTopupTransfer: true,
    });
    expect(allowsWalletRoute(true, 'cargar')).toBe(true);
    expect(allowsWalletRoute(true, 'transferir')).toBe(true);
  });

  /**
   * N-10 · el error que esta ola corrige: el historial de pagos propio y sus
   * estadísticas son superficie card-only RATIFICADA QUE SE CONSERVA. Apagar el
   * riel saldo no puede apagarlos.
   *
   * OLA 5D lo vuelve **estructural**: son dos parámetros distintos, así que ya
   * no hay una variable de la que puedan derivar los dos. El test recorre las
   * cuatro combinaciones y exige que `showAccountActivity` siga al segundo
   * parámetro y sea INDIFERENTE al primero.
   */
  it('la actividad de cuenta card-only NO depende del riel saldo', () => {
    expect(accountRailView(false, true).showAccountActivity).toBe(true);
    expect(accountRailView(true, true).showAccountActivity).toBe(true);
    expect(accountRailView(false, false).showAccountActivity).toBe(false);
    expect(accountRailView(true, false).showAccountActivity).toBe(false);

    // La forma fuerte: con el segundo parámetro fijo, mover el riel no la mueve.
    for (const actividad of [true, false]) {
      expect(accountRailView(false, actividad).showAccountActivity).toBe(
        accountRailView(true, actividad).showAccountActivity,
      );
    }
  });

  /**
   * El caso exacto de `07f0ba2`, escrito como test: el backend declara el riel
   * APAGADO y la actividad de cuenta CONSERVADA. Si alguien vuelve a fundir los
   * dos gates, este test se pone rojo.
   */
  it('separa la actividad de cuenta de los movimientos de wallet', () => {
    const real = accountRailView(false, true);
    expect(real.showAccountActivity).toBe(true);
    expect(real.showWalletMovements).toBe(false);
  });

  /**
   * G-24 · CERRADO POR ELIMINACIÓN.
   *
   * Los tests anteriores probaban que ninguna forma de `?demo=1` activaba la
   * rama del modo demo. Al eliminarse esa rama, **esos tests dejaron de probar
   * algo**: verificar que no se activa lo que no existe es exactamente el
   * antipatrón que ya nos mordió en este ciclo —defensas declaradas que no
   * ejecutan nada—. Así que no se conservan como estaban.
   *
   * Lo que sí sigue teniendo valor es el INVARIANTE que protegían: que un
   * PaymentMethod de prueba no pueda llegar a la app. Eso ahora se puede
   * afirmar mucho más fuerte, sobre el código fuente entero en vez de sobre una
   * función: si alguien reintroduce `pm_card_visa` por cualquier vía —otra
   * pantalla, otro flag, un helper nuevo— este test lo frena.
   */
  /**
   * 🔴 REGLA GENERAL DE EGRESS EN EL FUENTE · reemplaza la lista negra.
   *
   * Hasta la fase anterior esto prohibía CUATRO proveedores de tipografías:
   * `googleapis`, `gstatic`, `typekit`, `bunny`. **Una lista negra deja pasar
   * el quinto**, y el quinto es justamente el que importa, porque el que se
   * cuela es siempre el que nadie anticipó. Se invierte la lógica: **sólo pasa
   * lo que está en la allowlist, con su motivo; cualquier otro host es rojo.**
   *
   * Prohibir `fonts.googleapis.com` deja de ser una regla propia y pasa a ser
   * una consecuencia: no está en la lista de abajo.
   *
   * ## Por qué ESTE barrido existe además del del artefacto
   *
   * `scripts/artefactos.test.ts` mira los bytes emitidos, que es más fuerte…
   * salvo en un punto: **el bundler elimina lo que no se usa.** Un destino
   * escrito en `src/` y todavía no invocado —una constante durmiente, una rama
   * apagada por un flag— NO llega al artefacto y ese barrido no lo ve. Éste
   * sí. Se verificó con un mutante: una constante con un CDN desconocido deja
   * el artefacto limpio y pone rojo este archivo.
   *
   * Los dos cubren poblaciones distintas y ninguno alcanza solo.
   *
   * ⚠️ ALCANCE: barre `src/` e `index.html`. **No cubre `landing/`**, que
   * tiene su guarda propia y más estricta sobre el artefacto construido.
   */
  const DESTINOS_PERMITIDOS = [
    {
      host: 'accounts.google.com',
      porque: 'Google Identity Services se carga sólo al montar una acción social habilitada por capability exacta',
    },
    {
      host: 'app.paymemx.com',
      porque: 'redirect URI exacto de Facebook publicado y validado; no es un recurso que la app cargue sola',
    },
    { host: 'localhost', porque: 'default de desarrollo de la API y de Stripe; no es destino de producción' },
    { host: 'wa.me', porque: 'DESTINO DE NAVEGACIÓN al compartir el link, no un recurso que se cargue solo' },
    {
      host: 'www.facebook.com',
      porque: 'DESTINO DE NAVEGACIÓN del diálogo OAuth iniciado por el usuario; no es una carga automática',
    },
  ] as const;

  /** Todo host absoluto que aparezca en un texto, sin juzgar todavía. */
  const hostsDe = (texto: string): string[] =>
    [...texto.matchAll(/https?:\/\/([a-zA-Z0-9._-]+)/g)].map((m) => m[1]!);

  const noPermitidos = (texto: string): string[] => {
    const ok = new Set<string>(DESTINOS_PERMITIDOS.map((d) => d.host));
    return [...new Set(hostsDe(texto))].filter((h) => !ok.has(h));
  };

  it('🔴 MUTANTE · ningún destino fuera de la allowlist en `src/`', () => {
    const fuentes = import.meta.glob('/src/**/*.{ts,tsx}', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>;
    expect(Object.keys(fuentes).length, 'el glob no encontró fuentes').toBeGreaterThan(20);
    const queSeCompilan = Object.keys(fuentes).filter((r) => !/\.test\.tsx?$/.test(r));
    expect(queSeCompilan.length, 'quedaron cero archivos por barrer').toBeGreaterThan(20);

    const ofensores: string[] = [];
    for (const [ruta, cuerpo] of Object.entries(fuentes)) {
      // 🔴 ACÁ los comentarios se IGNORAN, y en la landing CUENTAN. No es
      // inconsistencia: es el mismo fundamento —qué le llega al usuario—
      // aplicado a dos casos distintos. El HTML de la landing SE PUBLICA, así
      // que un comentario suyo es información que viaja al navegador; este
      // archivo SE COMPILA, y un comentario no sobrevive ni hace una request.
      //
      // 🔴 Los archivos de test se saltean, y la población es la correcta:
      // esto persigue EGRESS, y un test no se compila al artefacto ni hace una
      // request en producción. Barrerlos daba siete falsos positivos —
      // `evil.example`, `payme.test`, `demo.payme.test`— que son fixtures
      // adversariales, justamente de las guardas que protegen esto.
      //
      // Y la contracara importa: dejarlos adentro obligaría a meter esos
      // dominios en la allowlist, que es como una allowlist se convierte en
      // una lista de cualquier cosa y deja de decir nada.
      if (/\.test\.tsx?$/.test(ruta)) continue;
      const sinComentarios = cuerpo
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      for (const host of noPermitidos(sinComentarios)) ofensores.push(`${ruta} → ${host}`);
    }
    expect(ofensores, `destinos que nadie autorizó: ${ofensores.join(' · ')}`).toEqual([]);
  });

  it('🔴 CASO LEGÍTIMO · cada destino autorizado SÍ pasa', () => {
    // Sin esto, una guarda que rechazara absolutamente todo dejaría el mutante
    // en rojo igual, y nadie notaría que rompió el compartir por WhatsApp.
    expect(noPermitidos('https://wa.me/?text=hola')).toEqual([]);
    expect(noPermitidos('http://localhost:3000/api')).toEqual([]);
    expect(noPermitidos('https://accounts.google.com/gsi/client')).toEqual([]);
    expect(noPermitidos('https://www.facebook.com/v20.0/dialog/oauth')).toEqual([]);
    expect(noPermitidos('https://app.paymemx.com/#/auth/facebook/callback')).toEqual([]);
    // Y la contracara: un CDN cualquiera no pasa.
    expect(noPermitidos('https://cdn-que-nadie-nombro.example.net/x.js')).toEqual([
      'cdn-que-nadie-nombro.example.net',
    ]);
  });

  it('🔴 cada destino permitido dice por qué está', () => {
    for (const d of DESTINOS_PERMITIDOS) {
      expect(d.porque.length, `${d.host} sin motivo`).toBeGreaterThan(20);
    }
  });

  /**
   * 🔴 FASE 4 · el mismo invariante sobre el HTML, que es por donde entró la
   * primera vez.
   *
   * Acá los comentarios CUENTAN, al revés que arriba. No es inconsistencia: es
   * el mismo fundamento —qué le llega al usuario— aplicado a dos casos
   * distintos. `index.html` **se publica tal cual**, así que un `<!-- … -->`
   * suyo es texto que viaja al navegador; los `.ts` se compilan y sus
   * comentarios no sobreviven ni hacen una request.
   *
   * Y hay una razón práctica además de la doctrinal: la forma más probable de
   * que esto vuelva es alguien dejando el `<link>` viejo comentado "por si
   * acaso". Un `<link>` comentado no carga nada hoy, pero es la línea que se
   * descomenta sin pensarlo dentro de seis meses.
   */
  it('🔴 ningún destino fuera de la allowlist en `index.html`, comentarios incluidos', () => {
    const htmls = import.meta.glob('/index.html', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>;

    // Sonda: si el glob dejara de resolver, el `for` iteraría vacío y esto
    // pasaría sin mirar nada. Es exactamente cómo una guarda queda en verde
    // sin verificar.
    expect(Object.keys(htmls), 'el glob no encontró `index.html`').toHaveLength(1);

    const ofensores: string[] = [];
    for (const [ruta, cuerpo] of Object.entries(htmls)) {
      for (const host of noPermitidos(cuerpo)) ofensores.push(`${ruta} → ${host}`);
    }
    expect(ofensores, `destinos que nadie autorizó en el HTML: ${ofensores.join(' · ')}`).toEqual([]);
  });

  /**
   * 🔴 EL CASO LEGÍTIMO de las dos guardas de arriba.
   *
   * Cinco mutantes en rojo son compatibles con una guarda que rechaza todo. Lo
   * que ninguno de ellos prueba es que la tipografía PROPIA se acepte — y una
   * guarda que la bloqueara se aflojaría el día que estorbe, que es justo
   * cuando hace falta. Esto afirma que el `@font-face` existe, apunta a un
   * archivo del repo, y no dispara nada.
   */
  it('🔴 CASO LEGÍTIMO · el `@font-face` propio existe y NO es egress', () => {
    const hojas = import.meta.glob('/src/styles/global.css', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>;
    const css = Object.values(hojas)[0] ?? '';
    expect(css.length, 'no se pudo leer `global.css`').toBeGreaterThan(1000);

    const caras = [...css.matchAll(/@font-face\s*\{[^}]*\}/g)].map((m) => m[0]);
    expect(caras.length, 'no hay ningún @font-face propio declarado').toBe(2);

    for (const cara of caras) {
      // Apunta al repo, no a un host.
      expect(cara, `un @font-face sin ruta propia: ${cara}`).toMatch(
        /url\(\s*'\.\.\/assets\/fonts\/[A-Za-z-]+\.ttf'\s*\)/,
      );
      // Y no apunta a ningún host: ni a los de tipografías ni a ningún otro.
      expect(noPermitidos(cara), `el @font-face apunta afuera: ${cara}`).toEqual([]);
      // `swap`: el texto se lee desde el primer frame.
      expect(cara, `un @font-face sin swap: ${cara}`).toMatch(/font-display\s*:\s*swap/);
    }
  });

  it('G-24 · ningún PaymentMethod de prueba de Stripe existe en el código fuente', () => {
    // `import.meta.glob` es nativo de Vite: barre el árbol sin agregar ninguna
    // dependencia (los tipos de node lo serían).
    const fuentes = import.meta.glob('/src/**/*.{ts,tsx}', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>;
    const PROHIBIDOS = ['pm_card_visa', 'tok_visa'];
    const ofensores: string[] = [];
    for (const [ruta, cuerpo] of Object.entries(fuentes)) {
      if (ruta.endsWith('releaseGates.test.ts')) continue; // este archivo los nombra
      for (const token of PROHIBIDOS) {
        if (cuerpo.includes(token)) ofensores.push(`${ruta} → ${token}`);
      }
    }
    // Guardarraíl del guardarraíl: si el glob no encuentra nada, el test pasaría
    // en vacío y no probaría absolutamente nada.
    expect(Object.keys(fuentes).length).toBeGreaterThan(20);
    expect(ofensores).toEqual([]);
  });

  /**
   * §1.9 · paso 6 · **`showWalletMovements` se quedó sin consumidor vivo.**
   *
   * `CuentaScreen` era el único que lo leía —dos bloques, `:252` y `:281`— y se
   * retiró con la demolición. La pregunta que había que contestar era si el gate
   * **se reubica** o si **se acredita que la superficie ya no existe**, y es lo
   * segundo: no hay dónde reubicarlo, porque no quedó ninguna lista de
   * `wallet_transactions` en ninguna pantalla.
   *
   * 🔴 **`accountRailView` CONSERVA sus cinco campos.** Durmiente es durmiente:
   * el campo no se borra porque su consumidor se haya ido. Los dos tests de
   * arriba siguen exigiendo los cinco, y el `toEqual` los falla si alguien
   * "limpia" el que sobra.
   *
   * Lo que cambia es esto: se prueba, **no se afirma**. Si mañana alguien
   * vuelve a colgar superficie del riel saldo, este test la encuentra sola —
   * incluso en una pantalla que hoy no existe.
   */
  it('§1.9 · ningún consumidor VIVO lee `showWalletMovements`', () => {
    const fuentes = import.meta.glob('/src/**/*.{ts,tsx}', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>;

    /**
     * Dónde SÍ puede aparecer, y por qué cada uno:
     *  - `releaseGates.ts` lo DECLARA — es el campo durmiente que se conserva;
     *  - los `.test.ts`/`.test.tsx` lo afirman apagado, que es su trabajo.
     * Cualquier otro archivo de `src/` es un consumidor vivo.
     */
    const esDeclaracionOTest = (ruta: string) =>
      ruta === '/src/api/releaseGates.ts' || /\.test\.tsx?$/.test(ruta);

    const consumidores = Object.entries(fuentes)
      .filter(([ruta]) => !esDeclaracionOTest(ruta))
      .filter(([, cuerpo]) => cuerpo.includes('showWalletMovements'))
      .map(([ruta]) => ruta);

    // Control positivo, por la misma razón que el de G-24: sin él, un glob que
    // no encuentra nada daría cero y el cero no significaría nada. Se exige
    // además que el barrido SÍ vea la declaración — o sea que busca donde debe.
    expect(Object.keys(fuentes).length).toBeGreaterThan(20);
    expect(fuentes['/src/api/releaseGates.ts']).toContain('showWalletMovements');

    expect(consumidores).toEqual([]);
  });
});

/**
 * F2 · **el corte deja de ser una constante de este repo y lo declara el dueño.**
 *
 * Hasta acá `PAGOS_CORTADOS` era `true` escrito a mano. Funcionaba y estaba
 * probado, pero su autoridad estaba en el lugar equivocado —exactamente el
 * defecto que `walletRail.ts:9-18` documenta para el riel saldo—: un deploy de
 * este front con otro valor reencendía el checkout sin que el backend se
 * enterara, y al revés, el dueño podía apagar el dinero sin que la app lo
 * supiera.
 *
 * Ahora sale de `money_rail`, la MISMA capability que ya gobierna si se puede
 * pedir una tarjeta. Y falla hacia el mismo lado que ella: **si no se puede
 * determinar el estado, no hay superficie de pago.**
 */
describe('F2 · el corte lo declara el owner, y falla cerrado', () => {
  const VIVO = { status: 'authoritative', puedeCargarTarjeta: true } as const;

  it('sólo un riel autoritativo con pagos habilitados levanta el corte', () => {
    const vista = corteDePagosView(VIVO);
    expect(vista.pagosCortados).toBe(false);
    expect(vista.showCards).toBe(true);
    expect(vista.allowsPay).toBe(true);
  });

  it('pending, absent y malformed cortan: no se adivina', () => {
    for (const status of ['pending', 'absent', 'malformed'] as const) {
      const vista = corteDePagosView({ status, puedeCargarTarjeta: false });
      expect(vista.pagosCortados, status).toBe(true);
      expect(vista.showCards, status).toBe(false);
      expect(vista.allowsPay, status).toBe(false);
    }
  });

  it('un riel autoritativo con los pagos apagados corta', () => {
    const vista = corteDePagosView({ status: 'authoritative', puedeCargarTarjeta: false });
    expect(vista.pagosCortados).toBe(true);
  });

  /**
   * 🔴 El caso que parece imposible y es el que importa: un estado NO
   * autoritativo que igual dice que se puede cobrar. No debería existir —el
   * decoder de `moneyRail` no lo produce—, pero si algún día lo produjera, el
   * corte no puede levantarse por la mitad de la respuesta.
   */
  it('«puede cargar tarjeta» sin autoridad NO levanta el corte', () => {
    expect(corteDePagosView({ status: 'pending', puedeCargarTarjeta: true }).pagosCortados).toBe(true);
    expect(corteDePagosView({ status: 'malformed', puedeCargarTarjeta: true }).pagosCortados).toBe(true);
  });

  it('las rutas del corte se abren y se cierran con el mismo riel', () => {
    for (const ruta of RUTAS_DEL_CORTE) {
      expect(allowsCorteRoute(ruta, { status: 'pending', puedeCargarTarjeta: false })).toBe(false);
      expect(allowsCorteRoute(ruta, VIVO)).toBe(true);
    }
    // Una ruta que no es del corte nunca se bloquea, con cualquier riel.
    expect(allowsCorteRoute('pagos', { status: 'pending', puedeCargarTarjeta: false })).toBe(true);
    expect(allowsCorteRoute('home', { status: 'malformed', puedeCargarTarjeta: false })).toBe(true);
  });

  /**
   * 🔴 **Ninguna excepción por principal.** `corteDePagosView` y
   * `allowsCorteRoute` reciben el riel y NADA más: no hay parámetro de usuario,
   * cuenta ni restaurante donde inyectar un permiso. Es la misma regla que
   * `allowsWalletRoute`, y se verifica sobre la fuente para que agregar uno
   * ponga la suite en rojo.
   */
  it('no hay por dónde inyectar una excepción por cuenta', () => {
    const fuente = readFileSync(new URL('./releaseGates.ts', import.meta.url), 'utf8');
    // Las firmas exactas: riel y nada más. Un parámetro nuevo rompe esto.
    expect(fuente).toContain('export function allowsCorteRoute(page: string, rail: RielDelCorte): boolean {');
    expect(fuente).toContain('export function corteDePagosView(rail: RielDelCorte) {');
    expect(fuente).toContain('function hayPagos(rail: RielDelCorte): boolean {');
    /**
     * Y la constante ya no EJECUTA: si vuelve, alguien puede leerla en vez de la
     * capability, que es el defecto que este cambio corrige.
     *
     * ⚠️ Se veta la DECLARACIÓN, no la mención. La primera versión de esta línea
     * usaba `not.toContain` y se puso roja contra el comentario de arriba, que
     * cuenta la historia del cambio y **debe** poder nombrar lo que se retiró.
     * Una guarda que prohíbe hablar de algo en vez de prohibir que corra empuja
     * a borrar justo la explicación que hace falta en tres semanas.
     */
    expect(fuente).not.toMatch(/^\s*(export\s+)?const PAGOS_CORTADOS/m);
  });
});
