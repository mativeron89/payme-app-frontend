import { describe, expect, it } from 'vitest';
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
