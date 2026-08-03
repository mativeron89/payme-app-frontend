import { describe, expect, it } from 'vitest';
import { accountRailView, allowsDemoMode, allowsWalletRoute } from './releaseGates';

describe('gate IFPE de release', () => {
  it('real conserva tarjetas y elimina todo affordance wallet', () => {
    expect(accountRailView(false)).toEqual({
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

  it('mock explícito conserva ambos rieles', () => {
    expect(accountRailView(true)).toEqual({
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
   * riel saldo no puede apagarlos. Este test es el que impide que vuelva a
   * colgarse del mismo flag.
   */
  it('la actividad de cuenta card-only NO depende del riel saldo', () => {
    expect(accountRailView(false).showAccountActivity).toBe(true);
    expect(accountRailView(true).showAccountActivity).toBe(true);
    expect(accountRailView(false).showAccountActivity).toBe(
      accountRailView(true).showAccountActivity,
    );
  });

  it('separa la actividad de cuenta de los movimientos de wallet', () => {
    const real = accountRailView(false);
    expect(real.showAccountActivity).toBe(true);
    expect(real.showWalletMovements).toBe(false);
  });

  /**
   * G-24 · el build real no puede activar `pm_card_visa` ni el bypass OCR desde
   * la URL. La capability de build manda: sin ella, ninguna forma de `?demo=1`
   * enciende nada. Fail-closed.
   */
  describe('G-24 · modo demo por capability de build', () => {
    const FORMAS = [
      ['query directa', '?demo=1', ''],
      ['dentro del hash', '', '#/mesa/PA-1?demo=1'],
      ['hash con varios params', '', '#/mesa/PA-1?t=abc&demo=1'],
      ['query y hash a la vez', '?demo=1', '#/mesa/PA-1?demo=1'],
    ] as const;

    it('sin capability de build, NINGUNA forma de la URL lo activa', () => {
      for (const [, search, hash] of FORMAS) {
        expect(allowsDemoMode(false, search, hash)).toBe(false);
      }
    });

    it('con capability de build, la URL sí lo activa', () => {
      for (const [, search, hash] of FORMAS) {
        expect(allowsDemoMode(true, search, hash)).toBe(true);
      }
    });

    it('con capability pero sin flag en la URL, sigue apagado', () => {
      expect(allowsDemoMode(true, '', '')).toBe(false);
      expect(allowsDemoMode(true, '?demo=0', '')).toBe(false);
      expect(allowsDemoMode(true, '?demo=true', '')).toBe(false);
      expect(allowsDemoMode(true, '', '#/mesa/PA-1?r=uuid')).toBe(false);
    });
  });
});
