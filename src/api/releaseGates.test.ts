import { describe, expect, it } from 'vitest';
import { accountRailView, allowsWalletRoute } from './releaseGates';

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
   * 🔴 FASE 3 · NINGÚN EGRESS DE TIPOGRAFÍAS DESDE EL CÓDIGO DE LA APP.
   *
   * `CardField.tsx` le pasaba a Stripe Elements un `cssSrc` a
   * `fonts.googleapis.com`. Era el TERCER egress del repo y **el que no se ve
   * leyendo el `index.html`**: vivía en TypeScript, dentro de la config de un
   * SDK. Se retiró, y sin esta guarda vuelve en silencio — es la superficie
   * más fácil de reintroducir, porque el ejemplo de la documentación de Stripe
   * usa literalmente una URL de Google Fonts.
   *
   * ⚠️ ALCANCE, dicho con precisión: esto barre **`src/`**, no el árbol
   * entero. Los dos `<link>` y el `<link rel=stylesheet>` de `index.html`
   * SIGUEN VIVOS a propósito —la superficie 1 espera los `.woff2` propios— y
   * este test no los mira. Cuando se cierre esa superficie, el barrido se
   * extiende al HTML. No se declara más ancho de lo que mide.
   */
  it('🔴 ningún host de fuentes de terceros en `src/`', () => {
    const fuentes = import.meta.glob('/src/**/*.{ts,tsx}', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>;
    const HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'use.typekit', 'fonts.bunny.net'];
    const ofensores: string[] = [];
    for (const [ruta, cuerpo] of Object.entries(fuentes)) {
      // 🔴 ACÁ los comentarios se IGNORAN, y en la landing CUENTAN. No es
      // inconsistencia: es el mismo fundamento —qué le llega al usuario—
      // aplicado a dos casos distintos. El HTML de la landing SE PUBLICA, así
      // que un comentario suyo es información que viaja al navegador; este
      // archivo SE COMPILA, y un comentario no sobrevive ni hace una request.
      // Lo que se persigue es el `cssSrc`, no la palabra.
      if (ruta.endsWith('releaseGates.test.ts')) continue;
      const sinComentarios = cuerpo
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      for (const host of HOSTS) {
        if (sinComentarios.includes(host)) ofensores.push(`${ruta} → ${host}`);
      }
    }
    expect(ofensores, `egress de tipografías en código vivo: ${ofensores.join(' · ')}`).toEqual([]);
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
