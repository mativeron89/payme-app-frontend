import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * AF-LINK-DE-INVITACION · D252 · la capacidad (tramo 1: apagada en el modo
 * real, el seam en el mock) y la custodia del código que llega por el link.
 */
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

describe('la capacidad del link de invitación (tramo 1)', () => {
  it('🔴 en el modo real queda apagada aunque el seam del mock diga encendido', async () => {
    const m = await modulo();
    local.setItem(m.CLAVE_LINK_DE_INVITACION_MOCK, 'encendido');
    expect(m.aplicarConfigLinkDeInvitacion({ features: {} }, false)).toBe(false);
    expect(() => m.assertLinkDeInvitacion()).toThrow('invite_link_not_available');
  });

  it('en el mock la enciende sólo el seam exacto', async () => {
    const m = await modulo();
    expect(m.aplicarConfigLinkDeInvitacion({}, true)).toBe(false);
    local.setItem(m.CLAVE_LINK_DE_INVITACION_MOCK, 'si');
    expect(m.aplicarConfigLinkDeInvitacion({}, true)).toBe(false);
    local.setItem(m.CLAVE_LINK_DE_INVITACION_MOCK, 'encendido');
    expect(m.aplicarConfigLinkDeInvitacion({}, true)).toBe(true);
    expect(() => m.assertLinkDeInvitacion()).not.toThrow();
  });
});

describe('la custodia del código, hasta el alta', () => {
  it('guarda un código válido en la pestaña y lo devuelve', async () => {
    const m = await modulo();
    expect(m.guardarCodigoDeInvitacion('abc123def456')).toBe(true);
    expect(sesion.valores.get(m.CLAVE_CODIGO_DE_INVITACION)).toBe('abc123def456');
    expect(m.leerCodigoDeInvitacion()).toBe('abc123def456');
    m.olvidarCodigoDeInvitacion();
    expect(m.leerCodigoDeInvitacion()).toBeNull();
  });

  it('🔴 un código mal formado no se guarda, y uno mal formado guardado se borra al leerlo', async () => {
    const m = await modulo();
    for (const malo of ['', 'ab', 'con espacio', 'a/b', '<script>', 'x'.repeat(65), 'ñandú']) {
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
    expect(m.guardarCodigoDeInvitacion('abc123def456')).toBe(false);
    expect(m.leerCodigoDeInvitacion()).toBeNull();
    expect(() => m.olvidarCodigoDeInvitacion()).not.toThrow();
  });

  it('la clave del mock y la del real no se cruzan', async () => {
    const m = await modulo();
    expect(m.CLAVE_CODIGO_DE_INVITACION).toMatch(/^payme\.app\.(mock|real)\.referral_code\.v1$/);
  });
});
