import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * CIERRE DEL PAGO SIN CUENTA · el mock del canje.
 *
 * Lo que se verifica no es que "devuelva algo": es que **replique la ceguera**.
 * Un mock que distinguiera "no existe" de "vencido" le enseñaría a quien usa la
 * demo el oráculo que el contrato eliminó — lección 18 de este ciclo. Y peor,
 * lo volvería inverificable a mano, que es la lección 32: un mock permisivo ya
 * le escondió a este repo un defecto vivo mientras alguien "verificaba en
 * navegador".
 */

const storage = new Map<string, string>();
const mk = () => ({
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => { storage.set(k, v); },
  removeItem: (k: string) => { storage.delete(k); },
  clear: () => storage.clear(),
  key: (i: number) => [...storage.keys()][i] ?? null,
  get length() { return storage.size; },
}) as unknown as Storage;

vi.stubGlobal('localStorage', mk());
vi.stubGlobal('window', { location: { origin: 'https://payme.test', pathname: '/' } });

const { mockAcceptInvitationLink, mockCreateInvitation, mockOpenMesas, MockApiError } = await import('./mockApi');
const { state } = await import('./store');
const { saveSession } = await import('../storage');

function sesion() {
  saveSession({
    access_token: 'a', refresh_token: 'r', family_id: 'fam', principal_id: 'p1',
  });
}

async function fallo(p: Promise<unknown>): Promise<{ status: number; error: string }> {
  try { await p; throw new Error('no falló'); }
  catch (e) {
    if (!(e instanceof MockApiError)) throw e;
    return { status: e.status, error: e.message };
  }
}

beforeEach(() => { sesion(); });

describe('el mock del canje replica la CEGUERA del emisor', () => {
  it('un token emitido se canjea y devuelve su mesa', async () => {
    const code = state.mesas[0].code;
    const inv = await mockCreateInvitation(code, 'idem-canje-0001');
    const token = new URL(inv.link!).hash.split('t=')[1];
    await expect(mockAcceptInvitationLink(token)).resolves.toEqual({
      joined: true, mesa_code: code,
    });
  });

  /**
   * ⭐ EL TEST QUE IMPORTA. Los motivos de rechazo tienen que ser
   * INDISTINGUIBLES entre sí: mismo status y mismo código de error. Si alguien
   * agrega un 404 para "no existe", esto se pone rojo.
   */
  it('token inexistente y token de una mesa que ya no está dan EXACTAMENTE lo mismo', async () => {
    const inexistente = await fallo(mockAcceptInvitationLink('tok-que-nadie-emitio'));
    state.linkTokens['tok-de-mesa-fantasma'] = 'PA-NO-EXISTE';
    const mesaMuerta = await fallo(mockAcceptInvitationLink('tok-de-mesa-fantasma'));

    expect(inexistente).toEqual(mesaMuerta);
    expect(inexistente).toEqual({ status: 403, error: 'invitation_link_not_valid' });
  });

  it('canjear dos veces es idempotente: una sola inscripción', async () => {
    const code = state.mesas[1].code;
    const inv = await mockCreateInvitation(code, 'idem-canje-0002');
    const token = new URL(inv.link!).hash.split('t=')[1];
    await mockAcceptInvitationLink(token);
    await mockAcceptInvitationLink(token);
    expect(state.joinedMesaCodes.filter((c) => c === code)).toHaveLength(1);
  });

  /** El link es MULTIUSO: canjearlo no lo consume para el resto de la mesa. */
  it('canjear NO invalida el link', async () => {
    const code = state.mesas[2].code;
    const inv = await mockCreateInvitation(code, 'idem-canje-0003');
    const token = new URL(inv.link!).hash.split('t=')[1];
    await mockAcceptInvitationLink(token);
    await expect(mockAcceptInvitationLink(token)).resolves.toMatchObject({ joined: true });
  });

  /**
   * ⭐ **G-28.** Canjear el link tiene que dejar la mesa donde la persona la va
   * a buscar. Antes de v2.42.0 no: `GET /mesas/open` filtraba por quién la
   * abrió y era el ÚNICO listado del contrato, así que quien se sumaba veía
   * "No tenés mesas abiertas" **mientras debía plata** — y no daba error, que
   * es lo que lo hacía difícil de ver.
   *
   * Se afirma sobre una mesa que el usuario NO abrió, porque sobre una propia
   * el test pasaría igual sin el arreglo.
   */
  it('la mesa a la que me sumé aparece en mis mesas abiertas', async () => {
    const ajena = state.mesas.find((m) => !m.openedByUser && m.status === 'open');
    expect(ajena, 'el seed no tiene ninguna mesa abierta ajena').toBeTruthy();
    // Los tests de arriba canjean sus propios links y el `state` del mock es
    // compartido: se limpian las inscripciones para que lo que se afirme sea
    // ESTE canje y no el rastro de otro.
    state.joinedMesaCodes.length = 0;

    const antes = await mockOpenMesas();
    expect(antes.mesas.map((m) => m.code)).not.toContain(ajena!.code);

    const inv = await mockCreateInvitation(ajena!.code, 'idem-canje-g28');
    await mockAcceptInvitationLink(new URL(inv.link!).hash.split('t=')[1]!);

    const despues = await mockOpenMesas();
    expect(despues.mesas.map((m) => m.code)).toContain(ajena!.code);
  });

  it('sin sesión da 401, igual que el adaptador real', async () => {
    storage.clear();
    expect(await fallo(mockAcceptInvitationLink('tok-cualquiera'))).toMatchObject({ status: 401 });
  });

  it.each([['vacío', ''], ['corto', 'abc']])('un token %s da 400 antes de mirar nada', async (_c, tok) => {
    expect(await fallo(mockAcceptInvitationLink(tok))).toEqual({
      status: 400, error: 'invitation_token_required',
    });
  });
});
