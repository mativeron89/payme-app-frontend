/** Capabilities de release: no sustituye ni inventa contrato backend. */
import type { MoneyRailState } from './moneyRail';

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

/**
 * 🔴 CORTE DEL VIERNES · PRODUCCIÓN PÚBLICA SIN PAGOS.
 *
 * Orden `APP-FE-FRIDAY-NO-PAY-GUARD-02-CLAUDE` (2026-09-01), sobre la decisión
 * ratificada por Mati el mismo día: *«Producción Pública sin pago»*. La app
 * pública NO incluye checkout, garantía ni cobro; el flujo termina tras la
 * selección del consumo.
 *
 * ## Qué cierra este predicado, y qué NO
 *
 *   cierra    la vista `pay` de la mesa —sus tres transiciones y sus dos
 *             controles— y el alta de tarjeta en `#/tarjetas` y `#/cuenta`
 *   conserva  `#/pagos`: el histórico propio es card-only ratificado
 *   NO cierra la garantía del organizador en `#/scan`. Depende de A-1, que
 *             sigue ratificado y sin enmienda; la orden lo dice explícito y
 *             este módulo no declara que el corte sistémico esté completo.
 *
 * ## 🔴 ES UNA CONSTANTE DEL FRONT, Y ESO ES TEMPORAL Y DECLARADO
 *
 * El riel saldo se apaga por capability del BACKEND (`walletRail.ts`), porque
 * así un deploy del front no puede reencenderlo. Esta constante tiene el riesgo
 * espejo: un deploy del front podría reabrir pagos sin que el backend se
 * entere. Se acepta para este corte porque la capability la nombra el DUEÑO y
 * hoy no existe, y este repo no inventa campos del contrato. La forma durable
 * es una capability owner-first que este front lea fallando cerrado.
 *
 * Mientras tanto, `releaseGates.test.ts` FIJA el valor: cambiarlo es una
 * decisión de producto y tiene que poner un test rojo, no pasar en silencio.
 *
 * ## Lo que este predicado NO lee, a propósito
 *
 * Ni el modo, ni la URL, ni la sesión, ni ningún principal. Es una constante
 * sin parámetros: **no hay por dónde inyectar una excepción por cuenta**. La
 * misma regla que `allowsWalletRoute`.
 *
 * ⚠️ El backend sigue aceptando el pago, el lock y el setup-intent de tarjetas:
 * este corte es de SUPERFICIE. Que «sin pagos» sea una propiedad del sistema
 * es trabajo del dueño, y está elevado como tal.
 */
/**
 * 🔴 **F2 · el corte ya NO es una constante de este repo: lo declara el dueño.**
 *
 * Hasta acá esto era `const PAGOS_CORTADOS = true`, escrito a mano. Funcionaba,
 * estaba probado y era honesto sobre lo que hacía — pero su autoridad estaba en
 * el lugar equivocado, que es **exactamente** el defecto que `walletRail.ts:9-18`
 * documenta para el riel saldo: *«wallet estaba apagado porque el front decidió
 * apagarlo, no porque el sistema lo declarara apagado»*. Con una constante, un
 * deploy de este front reencendía el checkout sin que el backend se enterara, y
 * al revés: el dueño podía apagar el dinero y la app seguía ofreciendo cobrar.
 *
 * Ahora sale de `money_rail`, la MISMA capability que ya decide si se puede
 * pedir una tarjeta. No hay dos autoridades: hay una, y este módulo la
 * interpreta para las superficies del corte.
 *
 * ## Fail-closed, y hacia dónde
 *
 * ```
 * status 'authoritative' + payments_enabled true  →  hay superficie de pago
 * cualquier otra cosa                             →  NO hay
 * ```
 *
 * `pending`, `absent` y `malformed` cortan. **No se adivina**: ofrecer un cobro
 * sin saber si el dinero está vivo es la única salida que puede terminar en un
 * cargo que nadie esperaba, y por eso el lado seguro acá es no ofrecer nada.
 *
 * Y se exige el `status` además del booleano a propósito: un `puedeCargarTarjeta`
 * verdadero sobre un estado no autoritativo sería media respuesta, y media
 * respuesta no acredita la otra mitad.
 *
 * ⚠️ **Sigue siendo un corte de SUPERFICIE.** Que «sin pagos» sea una propiedad
 * del sistema es del dueño —su C3/C5 lo hacen— y este módulo no lo afirma.
 *
 * 🔴 **Ninguna excepción por principal**: estas funciones reciben el riel y nada
 * más. No hay parámetro de usuario, cuenta ni restaurante donde inyectar un
 * permiso, igual que `allowsWalletRoute`.
 */
export type RielDelCorte = Pick<MoneyRailState, 'status' | 'puedeCargarTarjeta'>;

function hayPagos(rail: RielDelCorte): boolean {
  return rail.status === 'authoritative' && rail.puedeCargarTarjeta;
}

/** Rutas que sólo existen para el alta de tarjeta. `cuenta` es alias de `tarjetas`. */
export const RUTAS_DEL_CORTE: readonly string[] = ['tarjetas', 'cuenta'];

export function allowsCorteRoute(page: string, rail: RielDelCorte): boolean {
  return hayPagos(rail) || !RUTAS_DEL_CORTE.includes(page);
}

/**
 * Lo que cada pantalla lee del corte, desde UN solo origen: `HomeScreen` y
 * `MasScreen` gatean sus accesos a tarjetas con `showCards`; `MesaScreen` y
 * `MesaDetailView` cierran la vista `pay` con `allowsPay`.
 *
 * `accountRailView(...).showCards` sigue en `true` y NO se toca: dice que apagar
 * el riel saldo no apaga tarjetas, y eso sigue siendo cierto. El corte es OTRA
 * razón con OTRO predicado, y los consumidores leen los dos.
 */
export function corteDePagosView(rail: RielDelCorte) {
  const vivos = hayPagos(rail);
  return {
    pagosCortados: !vivos,
    showCards: vivos,
    allowsPay: vivos,
  };
}
