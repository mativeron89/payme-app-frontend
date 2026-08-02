/** Capabilities de release: no sustituye ni inventa contrato backend. */
export function accountRailView(walletRailEnabled: boolean) {
  return {
    showCards: true,
    showBalance: walletRailEnabled,
    showWalletHistory: walletRailEnabled,
    showTopupTransfer: walletRailEnabled,
  };
}

export function allowsWalletRoute(walletRailEnabled: boolean, page: string): boolean {
  return walletRailEnabled || (page !== 'cargar' && page !== 'transferir');
}
