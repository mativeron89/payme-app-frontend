import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPendingInvitationLink,
  readPendingInvitationLink,
  rememberInvitationLink,
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
  ])('un respaldo corrupto (%s) se descarta sin romper', (_caso, raw) => {
    sessionStorage.setItem('payme_pending_invitation_link', raw);
    expect(readPendingInvitationLink()).toBeNull();
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
