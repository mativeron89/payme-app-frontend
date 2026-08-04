import { describe, expect, it, vi } from 'vitest';
import { acceptInvitationLinkResponse } from './contractResponses';

/**
 * CIERRE DEL PAGO SIN CUENTA · el test que ACREDITA el cierre del lado del
 * consumidor, y no sólo que la pantalla nueva existe.
 *
 * El emisor cerró el gate: `GET /mesas/:code`, `items/lock` y `pay` exigen
 * sesión y contestan 401. Pero un consumidor que siguiera mandando el token
 * como credencial de invitado se comería 401 silenciosos, y el flujo quedaría
 * roto de una forma que ninguna pantalla explica. Lo que hay que fijar es que
 * **este repo dejó de operar la mesa como invitado**.
 *
 * El emisor midió lo suyo así: `guestOrAuth` quedó con CERO call sites. Éste es
 * el espejo de esa medición.
 */

const fuentes = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const espejo = import.meta.glob('/contract-mirror/services/invitationAuthority.js', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

describe('C1/C2/C3 · el front no opera la mesa como invitado', () => {
  it('el barrido ve el árbol (si no, todo lo de abajo pasa en vacío)', () => {
    expect(Object.keys(fuentes).length).toBeGreaterThan(20);
  });

  /**
   * ⭐ CERO CALL SITES, igual que `guestOrAuth` del otro lado — pero medido
   * sobre lo que HACE inalcanzables las llamadas, no sobre el texto.
   *
   * **Mi primera versión de este test medía mal y lo dejo escrito porque es la
   * trampa.** Buscaba la presencia textual de `api.getMesa(code, guestToken)` en
   * `MesaScreen` y la marcaba como ofensora. Pero esas tres llamadas siguen ahí
   * y están BIEN: `MesaScreen` se monta en un solo lugar y ya no recibe el prop,
   * así que `guestToken` vale `undefined` siempre y las tres se van por la rama
   * autenticada. Son exactamente el equivalente de las ramas `req.isGuest` que
   * el emisor dejó en pie, inalcanzables e intactas.
   *
   * Un test que las prohibiera me habría obligado a editar un archivo de 1800
   * líneas que toca dinero para satisfacer al test — **mezclando borrado de
   * código con un cambio de autorización, que es justo lo que las dos partes
   * decidieron no hacer.**
   *
   * Lo que sí hay que fijar es la propiedad de la que depende que sean
   * inalcanzables: **nadie puede montar `MesaScreen` con un guest token.**
   */
  it('nadie monta MesaScreen con un guest token: por eso sus ramas no se alcanzan', () => {
    const ofensores: string[] = [];
    for (const [ruta, cuerpo] of Object.entries(fuentes)) {
      if (ruta.includes('.test.')) continue;
      for (const m of cuerpo.matchAll(/<MesaScreen\b[^>]*/g)) {
        if (/guestToken/.test(m[0])) ofensores.push(`${ruta} → ${m[0].slice(0, 80)}`);
      }
    }
    expect(ofensores).toEqual([]);
  });

  /**
   * Y la otra mitad: el transporte de invitado sólo puede salir de la fachada.
   * Si una pantalla empezara a llamar `httpGuestRequest` directo, se saltearía
   * la fachada entera —decoders de contrato y guardas de dinero incluidos— y el
   * barrido de arriba no lo vería.
   */
  it('httpGuestRequest sólo se usa desde la fachada, donde queda durmiente', () => {
    const PERMITIDOS = ['/src/api/http.ts', '/src/api/index.ts'];
    const ofensores = Object.entries(fuentes)
      .filter(([ruta]) => !PERMITIDOS.includes(ruta) && !ruta.includes('.test.'))
      .filter(([, cuerpo]) => cuerpo.includes('httpGuestRequest'))
      .map(([ruta]) => ruta);
    expect(ofensores).toEqual([]);
  });

  /**
   * `App` es quien montaba `MesaScreen` en modo invitado. Ése ERA el defecto: el
   * link llevaba directo a la mesa, sin cuenta. Ahora tiene que llevar al canje.
   */
  it('App rutea el link a JoinMesaScreen y NO a MesaScreen con token', () => {
    const app = fuentes['/src/App.tsx'];
    expect(app, 'no se encontró App.tsx').toBeTruthy();
    expect(app!).toContain('JoinMesaScreen');
    expect(app!).not.toMatch(/<MesaScreen[^>]*guestToken/);
  });

  /**
   * Nada se borra, y esto lo fija: si alguien "limpia" la superficie de invitado
   * junto con el cierre, mezcla borrado de código con un cambio de autorización
   * sobre rutas de dinero — que es cómo se cuelan errores.
   */
  it('la superficie de invitado sigue en el árbol, durmiente', () => {
    expect(fuentes['/src/api/http.ts']!).toContain('httpGuestRequest');
    expect(fuentes['/src/api/idempotency.ts']!).toContain('guest:');
    expect(fuentes['/src/screens/MesaScreen.tsx']!).toContain('isGuest');
  });
});

describe('ORDEN 3A · el token nunca se muestra', () => {
  /**
   * La credencial no puede aparecer en copy, en un `console`, ni en un atributo
   * del DOM. La pantalla de canje la RECIBE, así que es donde puede escaparse.
   */
  it('JoinMesaScreen no imprime el token en ningún lado', () => {
    const pantalla = fuentes['/src/screens/JoinMesaScreen.tsx'];
    expect(pantalla, 'no se encontró JoinMesaScreen').toBeTruthy();
    // Ni interpolado en JSX, ni logueado, ni puesto en un atributo.
    expect(pantalla!).not.toMatch(/\{\s*token\s*\}/);
    expect(pantalla!).not.toMatch(/console\.(log|error|warn|info)\([^)]*token/);
    expect(pantalla!).not.toMatch(/(title|aria-label|alt|value|data-[\w-]+)=\{[^}]*token/);
  });

  it('la copy del canje no interpola nada: son literales', () => {
    const view = fuentes['/src/screens/joinLinkView.ts'];
    expect(view, 'no se encontró joinLinkView').toBeTruthy();
    // Un template literal en la copy es la vía por la que entraría el token.
    expect(view!.replace(/^[\s\S]*?export type/, '')).not.toContain('${');
  });

  it('la custodia no loguea la credencial', () => {
    const custodia = fuentes['/src/api/invitationLink.ts'];
    expect(custodia, 'no se encontró invitationLink').toBeTruthy();
    expect(custodia!).not.toMatch(/console\./);
  });
});

describe('ORDEN 3A · dos mesas no cruzan credenciales', () => {
  /**
   * A y B viven en el mismo `sessionStorage` con UNA sola clave, así que el
   * riesgo no es teórico: el respaldo de A tiene que quedar inerte al entrar a
   * B, y el de B tiene que reemplazarlo, no convivir. La lógica está en
   * `tokenForMesa`; acá se fija que la propiedad se sostenga en secuencia.
   */
  it('el respaldo de A no autoriza a B, y el de B reemplaza al de A', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    } as unknown as Storage);
    const { rememberInvitationLink, tokenForMesa } = await import('./invitationLink');

    rememberInvitationLink('PA-AAAA', 'tok-de-la-mesa-A');
    expect(tokenForMesa('PA-AAAA', null)).toBe('tok-de-la-mesa-A');
    expect(tokenForMesa('PA-BBBB', null)).toBeNull();

    rememberInvitationLink('PA-BBBB', 'tok-de-la-mesa-B');
    expect(tokenForMesa('PA-BBBB', null)).toBe('tok-de-la-mesa-B');
    // Y el de A deja de valer: una sola credencial viva por vez.
    expect(tokenForMesa('PA-AAAA', null)).toBeNull();
    vi.unstubAllGlobals();
  });
});

describe('ORDEN 3A · la semántica REAL de los alias legacy', () => {
  /**
   * ⚠️ CORRECCIÓN de una afirmación previa, del emisor y espejada acá.
   *
   * `211fccd` dijo que `resolveLinkToken` dejaba el predicado "este token
   * autoriza entrar a esta mesa" con **una sola definición**. Es falso, y el
   * propio emisor lo corrigió en `a7027b7`: `middleware/auth.js` conserva una
   * SEGUNDA copia sin refactorizar. Este test no puede ejecutar SQL, así que
   * fija lo único que puede fijar desde acá: que el espejo **dice** la
   * semántica real, para que nadie razone sobre un token leyendo un resumen.
   */
  it('el espejo declara que resolveLinkToken NO es definición única', () => {
    const svc = espejo['/contract-mirror/services/invitationAuthority.js'];
    expect(svc, 'no se encontró invitationAuthority en el espejo').toBeTruthy();
    expect(svc!).toContain('SEGUNDA COPIA');
  });

  /**
   * Un alias legacy salta a su canónica por `COALESCE(source.superseded_by_id,
   * source.id)`, y exige que **las DOS** filas estén vigentes. Es la parte que
   * un resumen se come: sin `source.expires_at`, un link viejo y vencido
   * reviviría por haber sido supersedido por uno nuevo.
   */
  it('el alias legacy exige vigencia de la fila FUENTE y de la canónica', () => {
    const svc = espejo['/contract-mirror/services/invitationAuthority.js']!;
    expect(svc).toContain('COALESCE(source.superseded_by_id, source.id)');
    expect(svc).toContain('source.expires_at > NOW()');
    expect(svc).toContain('canonical.expires_at > NOW()');
  });
});

describe('el 200 de accept-link se decodifica: un 2xx malformado no es éxito', () => {
  it('el shape del contrato pasa', () => {
    expect(acceptInvitationLinkResponse({ joined: true, mesa_code: 'PA-2847' })).toMatchObject({
      mesa_code: 'PA-2847',
    });
  });

  /**
   * De este 200 depende que el front navegue a la mesa dando por hecho que la
   * persona quedó INSCRIPTA. Aceptar un cuerpo que no es el del contrato la
   * manda a una mesa donde el próximo request le va a dar 403 sin explicación.
   */
  it.each([
    ['joined ausente', { mesa_code: 'PA-2847' }],
    ['joined falso', { joined: false, mesa_code: 'PA-2847' }],
    ['joined string', { joined: 'true', mesa_code: 'PA-2847' }],
    ['joined 1', { joined: 1, mesa_code: 'PA-2847' }],
    ['mesa_code ausente', { joined: true }],
    ['mesa_code vacío', { joined: true, mesa_code: '' }],
    ['no es objeto', 'ok'],
    ['null', null],
  ])('rechaza %s', (_caso, body) => {
    expect(() => acceptInvitationLinkResponse(body)).toThrow('contract_response_invalid');
  });
});
