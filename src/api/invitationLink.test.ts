import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPendingInvitationLink,
  readPendingInvitationLink,
  rememberInvitationLink,
  stripTokenFromUrl,
  tokenForMesa,
} from './invitationLink';

/**
 * CIERRE DEL PAGO SIN CUENTA · la custodia del token.
 *
 * Lo que se fija acá no es "guarda un string": es **el tramo del alta**. El
 * circuito ratificado exige que el token sobreviva al registro, y si se pierde
 * la persona se registra y queda AFUERA de la mesa a la que la invitaron — que
 * es peor que el defecto que el cierre viene a corregir.
 */

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

beforeEach(() => {
  vi.stubGlobal('sessionStorage', memoryStorage());
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('el token del link sobrevive al alta', () => {
  it('lo que se guarda se recupera igual', () => {
    rememberInvitationLink('PA-2847', 'tok-abcdefgh');
    expect(readPendingInvitationLink()).toMatchObject({
      code: 'PA-2847',
      token: 'tok-abcdefgh',
    });
  });

  it('canjearlo lo suelta: una credencial no se conserva después de usarla', () => {
    rememberInvitationLink('PA-2847', 'tok-abcdefgh');
    clearPendingInvitationLink();
    expect(readPendingInvitationLink()).toBeNull();
  });

  /**
   * La URL manda. El respaldo existe SÓLO para el tramo en que la URL se
   * pierde; si los dos están, el de la URL es el que la persona acaba de abrir.
   */
  it('la URL gana sobre el respaldo', () => {
    rememberInvitationLink('PA-2847', 'tok-viejo-guardado');
    expect(tokenForMesa('PA-2847', 'tok-recien-abierto')).toBe('tok-recien-abierto');
  });

  it('sin URL, el respaldo cubre el tramo del alta', () => {
    rememberInvitationLink('PA-2847', 'tok-abcdefgh');
    expect(tokenForMesa('PA-2847', null)).toBe('tok-abcdefgh');
  });

  /**
   * ⭐ EL CASO QUE JUSTIFICA GUARDAR EL `code` Y NO SÓLO EL TOKEN.
   *
   * Sin esta comprobación, alguien abre el link de la mesa A, no se registra, y
   * después navega a la mesa B: el respaldo colgado lo mandaría a canjear el
   * token de A estando en B. El token nombra su mesa; el respaldo también.
   */
  it('el respaldo NO se aplica a otra mesa', () => {
    rememberInvitationLink('PA-2847', 'tok-de-la-mesa-A');
    expect(tokenForMesa('PA-9999', null)).toBeNull();
  });

  it('sin token por ningún lado no hay nada que canjear', () => {
    expect(tokenForMesa('PA-2847', null)).toBeNull();
  });
});

describe('ORDEN 3A · la secuencia de custodia', () => {
  /**
   * ⭐ El round-trip no es paranoia: `setItem` puede no tirar y aun así no
   * persistir (cuota, modo privado, WebView con storage particionado). El
   * booleano es lo que decide si se puede retirar el token de la URL, y
   * retirarlo sin custodia es pérdida silenciosa.
   */
  it('confirma el guardado leyendo de vuelta, no por ausencia de excepción', () => {
    expect(rememberInvitationLink('PA-2847', 'tok-abcdefgh')).toBe(true);
  });

  it('un storage que ACEPTA la escritura y no persiste devuelve false', () => {
    vi.stubGlobal('sessionStorage', {
      setItem() { /* acepta y no guarda: el caso que una excepción no delata */ },
      getItem: () => null,
      removeItem() {},
    } as unknown as Storage);
    expect(rememberInvitationLink('PA-2847', 'tok-abcdefgh')).toBe(false);
  });

  it('un storage bloqueado devuelve false en vez de explotar', () => {
    vi.stubGlobal('sessionStorage', {
      setItem() { throw new Error('SecurityError'); },
      getItem() { throw new Error('SecurityError'); },
      removeItem() { throw new Error('SecurityError'); },
    } as unknown as Storage);
    expect(rememberInvitationLink('PA-2847', 'tok-abcdefgh')).toBe(false);
  });

  it('no guarda basura, y lo dice', () => {
    expect(rememberInvitationLink('', 'tok-abcdefgh')).toBe(false);
    expect(rememberInvitationLink('PA-2847', '')).toBe(false);
  });
});

describe('ORDEN 3A · retirar el token de la URL sin tocar el historial', () => {
  function urlStub(hash: string) {
    const replaceState = vi.fn();
    vi.stubGlobal('window', {
      location: { hash, pathname: '/', search: '' },
      history: { state: null, replaceState },
    });
    return replaceState;
  }

  it('lo retira del hash', () => {
    const replaceState = urlStub('#/mesa/PA-2847?t=tok-abcdefgh');
    expect(stripTokenFromUrl()).toBe(true);
    expect(replaceState).toHaveBeenCalledWith(null, '', '/#/mesa/PA-2847');
  });

  /**
   * ⭐ `replaceState`, NUNCA asignar el hash. Asignarlo crea una entrada nueva y
   * deja viva la anterior con el `?t=`: el botón Atrás la recupera y la app
   * vuelve a custodiar un token ya soltado. Back no debe revivir el token.
   */
  it('usa replaceState y NO agrega una entrada de historial', () => {
    const replaceState = urlStub('#/mesa/PA-2847?t=tok-abcdefgh');
    const pushState = vi.fn();
    (globalThis as unknown as { window: { history: Record<string, unknown> } })
      .window.history.pushState = pushState;
    stripTokenFromUrl();
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(pushState).not.toHaveBeenCalled();
  });

  /**
   * `r` es el uuid del restaurante del QR (G-01). Llevárselo puesto rompería
   * otro flujo para arreglar éste.
   */
  it('preserva los demás parámetros legítimos', () => {
    const replaceState = urlStub('#/mesa/PA-2847?r=uuid-del-qr&t=tok-abcdefgh');
    stripTokenFromUrl();
    expect(replaceState).toHaveBeenCalledWith(null, '', '/#/mesa/PA-2847?r=uuid-del-qr');
  });

  it('sin token no toca nada', () => {
    const replaceState = urlStub('#/mesa/PA-2847?r=uuid-del-qr');
    expect(stripTokenFromUrl()).toBe(false);
    expect(replaceState).not.toHaveBeenCalled();
  });

  it('sin query no toca nada', () => {
    const replaceState = urlStub('#/mesa/PA-2847');
    expect(stripTokenFromUrl()).toBe(false);
    expect(replaceState).not.toHaveBeenCalled();
  });

  it('un navegador que no deja tocar el historial no rompe el canje', () => {
    vi.stubGlobal('window', {
      location: { hash: '#/mesa/PA-2847?t=tok-abcdefgh', pathname: '/', search: '' },
      history: { state: null, replaceState() { throw new Error('SecurityError'); } },
    });
    expect(() => stripTokenFromUrl()).not.toThrow();
    expect(stripTokenFromUrl()).toBe(false);
  });
});

describe('higiene de la credencial', () => {
  it('vencido el TTL local se descarta Y se borra, no queda dando vueltas', () => {
    rememberInvitationLink('PA-2847', 'tok-abcdefgh');
    // 24 h + 1 minuto.
    vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000 + 60_000);
    expect(readPendingInvitationLink()).toBeNull();
    vi.useRealTimers();
    expect(sessionStorage.getItem('payme_pending_invitation_link')).toBeNull();
  });

  it('dentro del TTL sigue disponible', () => {
    rememberInvitationLink('PA-2847', 'tok-abcdefgh');
    vi.setSystemTime(Date.now() + 23 * 60 * 60 * 1000);
    expect(readPendingInvitationLink()?.token).toBe('tok-abcdefgh');
  });

  /**
   * Un valor corrupto no puede romper la app NI quedar guardado: si sobrevive,
   * la ruta de esa mesa queda rota para siempre en ese dispositivo.
   */
  it.each([
    ['no es JSON', 'esto no es json'],
    ['no es objeto', '"un string"'],
    ['sin token', JSON.stringify({ code: 'PA-1', savedAt: Date.now() })],
    ['sin code', JSON.stringify({ token: 'tok-abcdefgh', savedAt: Date.now() })],
    ['savedAt no numérico', JSON.stringify({ code: 'PA-1', token: 'tok-abcdefgh', savedAt: 'ayer' })],
  ])('un respaldo corrupto (%s) se ELIMINA FÍSICAMENTE, no sólo devuelve null', (_caso, raw) => {
    sessionStorage.setItem('payme_pending_invitation_link', raw);
    expect(readPendingInvitationLink()).toBeNull();
    // ⭐ Devolver null no es descartar. Antes la fila QUEDABA: una credencial
    // que la app ya no puede usar sobreviviendo en el dispositivo, y sin TTL que
    // la alcance si el campo roto es justamente `savedAt`.
    expect(sessionStorage.getItem('payme_pending_invitation_link')).toBeNull();
  });

  /**
   * El caso que la orden nombró: shape inválido **con un token sensible
   * adentro**. Lo que no puede pasar es que la credencial sobreviva.
   */
  it('un shape inválido con token adentro no deja el token en storage', () => {
    sessionStorage.setItem('payme_pending_invitation_link', JSON.stringify({
      code: 'PA-2847', token: 'tok-super-sensible', savedAt: 'no-es-numero',
    }));
    expect(readPendingInvitationLink()).toBeNull();
    const crudo = JSON.stringify([...Object.entries(sessionStorage)]);
    expect(crudo).not.toContain('tok-super-sensible');
  });

  it('no guarda basura: sin code o sin token no escribe nada', () => {
    rememberInvitationLink('', 'tok-abcdefgh');
    rememberInvitationLink('PA-2847', '');
    expect(sessionStorage.getItem('payme_pending_invitation_link')).toBeNull();
  });

  /**
   * Safari en modo privado y algunos WebView TIRAN al tocar `sessionStorage`, y
   * el link de una invitación se abre desde WhatsApp justamente en un WebView.
   * Si esto explotara, la pantalla no cargaría — y la URL, que es la vía
   * primaria, alcanza perfectamente para el caso normal.
   */
  it('un storage que explota no rompe el circuito', () => {
    vi.stubGlobal('sessionStorage', {
      getItem() { throw new Error('SecurityError'); },
      setItem() { throw new Error('SecurityError'); },
      removeItem() { throw new Error('SecurityError'); },
    } as unknown as Storage);
    expect(() => rememberInvitationLink('PA-2847', 'tok-abcdefgh')).not.toThrow();
    expect(readPendingInvitationLink()).toBeNull();
    expect(() => clearPendingInvitationLink()).not.toThrow();
    // Y con la URL el circuito sigue andando.
    expect(tokenForMesa('PA-2847', 'tok-de-la-url')).toBe('tok-de-la-url');
  });
});
