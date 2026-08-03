/** Capabilities de release: no sustituye ni inventa contrato backend. */

/**
 * OLA 2-B · N-10: el historial de pagos PROPIO y sus estadísticas son
 * superficie **card-only ratificada que se conserva**, y no pueden colgar del
 * gate del riel saldo.
 *
 * El nombre anterior —`showWalletHistory`— era parte del error: aplicaba la
 * palabra "wallet" al historial de la cuenta y con eso apagaba en el build real
 * `GET /account/stats`, `GET /account/history` y la torta de gastos (G-09),
 * que nada tienen que ver con el riel saldo.
 *
 * Quedan separados:
 *  - `showAccountActivity`: pagos propios + estadísticas. SIEMPRE activo; su
 *    fuente son endpoints card-only.
 *  - `showWalletMovements`: la lista de `wallet_transactions`. Esa sí es riel
 *    saldo y sigue el flag.
 *
 * El apagado completo del wallet es OLA 5 y no se anticipa acá.
 */
export function accountRailView(walletRailEnabled: boolean) {
  return {
    showCards: true,
    showAccountActivity: true,
    showBalance: walletRailEnabled,
    showWalletMovements: walletRailEnabled,
    showTopupTransfer: walletRailEnabled,
  };
}

export function allowsWalletRoute(walletRailEnabled: boolean, page: string): boolean {
  return walletRailEnabled || (page !== 'cargar' && page !== 'transferir');
}
