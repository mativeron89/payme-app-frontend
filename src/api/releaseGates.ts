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

/**
 * OLA 2-B · G-24: el modo demo (`?demo=1`) sustituye Stripe Elements por el
 * PaymentMethod público de test `pm_card_visa` y saltea la captura OCR. Hasta
 * ahora se activaba SOLO desde la URL, así que cualquier visitante del build
 * real podía encenderlo.
 *
 * Ahora requiere DOS llaves y la de build manda: sin capability compilada, la
 * URL no puede nada. Fail-closed — el build real no la trae y no hay forma de
 * pedirla en runtime. Un artefacto de demo separado se compila con la
 * capability encendida y un entorno acreditado como Stripe test.
 */
export function allowsDemoMode(demoBuildAllowed: boolean, search: string, hash: string): boolean {
  if (!demoBuildAllowed) return false;
  if (new URLSearchParams(search).get('demo') === '1') return true;
  const q = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : '';
  return new URLSearchParams(q).get('demo') === '1';
}
