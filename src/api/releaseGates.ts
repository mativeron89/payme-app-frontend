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
 *  - `showAccountActivity`: pagos propios + estadísticas. Su fuente son
 *    endpoints card-only (`payment_attempts`), no tablas de wallet.
 *  - `showWalletMovements`: la lista de `wallet_transactions`. Esa sí es riel
 *    saldo y sigue el gate del riel.
 *
 * **OLA 5D · los dos parámetros vienen del BACKEND, no de acá.** Antes
 * `showAccountActivity` era la constante `true` que corrigió `ef9811d`, y
 * mantenerla habría sido volver a decidir del lado del front lo que el emisor
 * ya declara: `GET /api/config` publica `enabled` y `account_activity` como
 * **dos campos separados**, y el emisor tiene un test que falla si vuelven a
 * moverse juntos.
 *
 * Que sean dos parámetros distintos es lo que hace estructuralmente imposible
 * repetir `07f0ba2`: **no hay una variable de la que puedan derivar los dos.**
 * Ante capability ausente o mal formada, `walletRail.ts` entrega
 * `accountActivity: true` — o sea, la superficie card-only NO se esconde por un
 * fallo de red.
 */
export function accountRailView(walletRailEnabled: boolean, accountActivity: boolean) {
  return {
    showCards: true,
    showAccountActivity: accountActivity,
    showBalance: walletRailEnabled,
    showWalletMovements: walletRailEnabled,
    showTopupTransfer: walletRailEnabled,
  };
}

export function allowsWalletRoute(walletRailEnabled: boolean, page: string): boolean {
  return walletRailEnabled || (page !== 'cargar' && page !== 'transferir');
}
