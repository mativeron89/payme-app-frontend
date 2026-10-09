import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * AF-LINK-DE-INVITACION · D252 · la capacidad (`features.invite_link`, App
 * Backend 2.173.0), los decodificadores, la custodia del código que llega por
 * el link y `referral_code` en el alta.
 */
const CODIGO = 'Ab12Cd34Ef56Gh78';
const conf = (invite_link: unknown) => ({ features: { invite_link } });
function almacen() {
  const valores = new Map<string, string>();
  return {
    valores,
    getItem: (k: string) => valores.get(k) ?? null,
    setItem: (k: string, v: string) => { valores.set(k, v); },
    removeItem: (k: string) => { valores.delete(k); },
  };
}

let local = almacen();
let sesion = almacen();

async function modulo() {
  return import('./linkDeInvitacion');
}

beforeEach(() => {
  vi.resetModules();
  local = almacen();
  sesion = almacen();
  vi.stubGlobal('localStorage', local);
  vi.stubGlobal('sessionStorage', sesion);
});
afterEach(() => vi.unstubAllGlobals());

describe('la capacidad `features.invite_link`', () => {
  it('encendida sólo con {supported: true, enabled: true}, claves exactas', async () => {
    const m = await modulo();
    expect(m.aplicarConfigLinkDeInvitacion(conf({ supported: true, enabled: true }))).toBe(true);
    expect(() => m.assertLinkDeInvitacion()).not.toThrow();
    for (const raro of [undefined, null, true, {}, { supported: true }, { enabled: true }, { supported: true, enabled: 'true' },
      { supported: false, enabled: true }, { supported: true, enabled: true, extra: 1 }]) {
      expect(m.decodeCapacidadLinkDeInvitacion(conf(raro)), JSON.stringify(raro)).toBe(false);
    }
    expect(m.aplicarConfigLinkDeInvitacion({})).toBe(false);
    expect(() => m.assertLinkDeInvitacion()).toThrow('invite_link_not_available');
  });

  it('el seam del mock: sólo `encendido` exacto', async () => {
    const m = await modulo();
    expect(m.linkDeInvitacionMockEncendido()).toBe(false);
    local.setItem(m.CLAVE_LINK_DE_INVITACION_MOCK, 'si');
    expect(m.linkDeInvitacionMockEncendido()).toBe(false);
    local.setItem(m.CLAVE_LINK_DE_INVITACION_MOCK, 'encendido');
    expect(m.linkDeInvitacionMockEncendido()).toBe(true);
  });
});

describe('el link del dueño: `{ code, link, created_at }`, claves exactas', () => {
  const bueno = { code: CODIGO, link: `https://app.paymemx.com/#/invitacion/${CODIGO}`, created_at: '2026-10-09T22:00:00.000Z' };

  it('decodifica el del contrato (link absoluto que termina en el código)', async () => {
    const m = await modulo();
    expect(m.decodeLinkDeInvitacion(bueno)).toEqual({ url: bueno.link, codigo: CODIGO, creadoEn: bueno.created_at });
  });

  it('🔴 falla cerrado ante cualquier otra forma', async () => {
    const m = await modulo();
    for (const malo of [
      null, [], {}, { ...bueno, extra: 1 }, { code: bueno.code, link: bueno.link },
      { ...bueno, code: 'corto' }, { ...bueno, code: `${CODIGO}x` },
      { ...bueno, link: '/invitacion/' + CODIGO }, { ...bueno, link: 'https://otro.com/x' },
      { ...bueno, link: `javascript:alert(1)//invitacion/${CODIGO}` }, { ...bueno, created_at: 'ayer' }, { ...bueno, created_at: 1 },
    ]) {
      expect(() => m.decodeLinkDeInvitacion(malo), JSON.stringify(malo)).toThrow();
    }
  });
});

describe('D252 · `referral_code` en el alta', () => {
  it('🔴 con la capacidad y un código guardado, va; sin la capacidad o sin código, no', async () => {
    const m = await modulo();
    const alta = { email: 'a@b.mx', password: 'x' };
    m.guardarCodigoDeInvitacion(CODIGO);
    expect(m.conReferido(alta)).toEqual(alta);
    m.aplicarConfigLinkDeInvitacion(conf({ supported: true, enabled: true }));
    expect(m.conReferido(alta)).toEqual({ ...alta, referral_code: CODIGO });
    m.olvidarCodigoDeInvitacion();
    expect(m.conReferido(alta)).toEqual(alta);
    m.guardarCodigoDeInvitacion(CODIGO);
    m.aplicarConfigLinkDeInvitacion(conf({ supported: true, enabled: false }));
    expect(m.conReferido(alta)).toEqual(alta);
  });
});

describe('la custodia del código, hasta el alta', () => {
  it('guarda un código válido en la pestaña y lo devuelve', async () => {
    const m = await modulo();
    expect(m.guardarCodigoDeInvitacion(CODIGO)).toBe(true);
    expect(sesion.valores.get(m.CLAVE_CODIGO_DE_INVITACION)).toBe(CODIGO);
    expect(m.leerCodigoDeInvitacion()).toBe(CODIGO);
    m.olvidarCodigoDeInvitacion();
    expect(m.leerCodigoDeInvitacion()).toBeNull();
  });

  it('🔴 un código mal formado no se guarda, y uno mal formado guardado se borra al leerlo', async () => {
    const m = await modulo();
    // `codigo.formato` del contrato: exactamente 16 caracteres base64url.
    for (const malo of ['', 'ab', 'abc123def456', `${CODIGO}x`, 'Ab12Cd34Ef56Gh7 ', 'Ab12Cd34Ef56Gh/8', 'ñandú', 'x'.repeat(64)]) {
      expect(m.guardarCodigoDeInvitacion(malo), malo).toBe(false);
    }
    expect(sesion.valores.size).toBe(0);
    sesion.setItem(m.CLAVE_CODIGO_DE_INVITACION, 'no vale');
    expect(m.leerCodigoDeInvitacion()).toBeNull();
    expect(sesion.valores.has(m.CLAVE_CODIGO_DE_INVITACION)).toBe(false);
  });

  it('sin almacenamiento no rompe: no guarda y no lee', async () => {
    vi.stubGlobal('sessionStorage', { getItem: () => { throw new Error('bloqueado'); }, setItem: () => { throw new Error('bloqueado'); }, removeItem: () => { throw new Error('bloqueado'); } });
    const m = await modulo();
    expect(m.guardarCodigoDeInvitacion(CODIGO)).toBe(false);
    expect(m.leerCodigoDeInvitacion()).toBeNull();
    expect(() => m.olvidarCodigoDeInvitacion()).not.toThrow();
  });

  it('la clave del mock y la del real no se cruzan', async () => {
    const m = await modulo();
    expect(m.CLAVE_CODIGO_DE_INVITACION).toMatch(/^payme\.app\.(mock|real)\.referral_code\.v1$/);
  });
});
