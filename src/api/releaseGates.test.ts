import { describe, expect, it } from 'vitest';
import { accountRailView, allowsWalletRoute } from './releaseGates';

describe('gate IFPE de release', () => {
  it('real conserva tarjetas y elimina todo affordance wallet', () => {
    expect(accountRailView(false)).toEqual({ showCards: true, showBalance: false, showWalletHistory: false, showTopupTransfer: false });
    expect(allowsWalletRoute(false, 'cargar')).toBe(false);
    expect(allowsWalletRoute(false, 'transferir')).toBe(false);
    expect(allowsWalletRoute(false, 'cuenta')).toBe(true);
  });

  it('mock explícito conserva ambos rieles', () => {
    expect(accountRailView(true)).toEqual({ showCards: true, showBalance: true, showWalletHistory: true, showTopupTransfer: true });
    expect(allowsWalletRoute(true, 'cargar')).toBe(true);
    expect(allowsWalletRoute(true, 'transferir')).toBe(true);
  });
});
