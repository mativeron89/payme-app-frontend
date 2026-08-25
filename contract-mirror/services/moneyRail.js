/**
 * services/moneyRail.js — GATE NO-MONEY GLOBAL (D-FF-2 · 2026-08-10)
 *
 * ─── QUÉ RATIFICÓ MATI ────────────────────────────────────────────────────
 *
 * `D-FF-2 = A`: la app abre a amigos con usuarios reales, **CERO PAGOS — ni
 * siquiera simulados**. Registro y social, nada más. Habilitado por `D-HOLD-1`
 * como "modo monetario fail-closed: disabled | sandbox". No hay decisión
 * pendiente acá: esto ejecuta lo ya decidido.
 *
 * ─── POR QUÉ ES UNA CONSTANTE Y NO UNA BANDERA DE ENTORNO ─────────────────
 *
 * 🔴 Una bandera es exactamente el permiso que el gobierno raíz prohíbe: con
 * `MONEY_ENABLED=true` en un `.env` cualquiera, un despliegue mal configurado
 * mueve dinero real de alguien. `MODO_MONETARIO` es una **constante del
 * código**, igual que `walletRail.RIEL_HABILITADO`: cambiarla exige un commit
 * revisado, no una variable. El frontend **la lee** de `/api/config`; no la
 * decide ni la hardcodea.
 *
 * ─── POR QUÉ NO ALCANZABA `walletRail` ────────────────────────────────────
 *
 * `RIEL_HABILITADO=false` apaga **wallet y nada más**: topup, transferencias y
 * SPEI. Bajo card-only el dinero se mueve por el riel de TARJETA, que ese gate
 * no toca — `POST /mesas` con garantía, `POST /mesas/:code/pay`, y el vault de
 * `/payment-methods` siguen operando. Este gate cubre TODO el dinero.
 *
 * ─── ALCANCE · enumerado desde las rutas MONTADAS, no de memoria ──────────
 *
 * Barrido de `app.use('/api/…')` en `server.js:133-151`. De los 19 montajes,
 * mueven o preparan dinero exactamente éstos:
 *
 *   · `/api/mesas`            garantía (hold) y pago de mesa
 *   · `/api/payment-methods`  SetupIntent y attach de tarjeta al vault
 *   · `/api/topup`            recarga (ya gateada por wallet, se refuerza)
 *   · `/api/transfers`        transferencia (ídem)
 *   · `/api/wallet`           CLABE de abono SPEI (ídem)
 *   · `/api/restaurants/:rid/connect/…`  onboarding de cuenta conectada
 *
 * NO mueven dinero y quedan intactos a propósito: `/api/auth`, `/api/config`,
 * `/api/legal`, `/api/account/consents`, `/api/account`, `/api/friends`,
 * `/api/groups`, `/api/invitations`, `/api/ocr`, `/api/restaurants` (lectura),
 * `/api/me` (earnings, sólo lectura), `/api/notifications`.
 *
 * Los webhooks de Stripe (`/webhooks/…`) **no se gatean acá**: son ENTRADA de
 * hechos ya ocurridos afuera. Rechazarlos perdería la reconciliación de algo
 * que ya pasó. Con este gate no puede nacer ningún cobro nuevo, así que en
 * modo `disabled` no debería llegar ninguno; si llega, se procesa y queda
 * trazado — que es lo correcto para un hecho consumado.
 *
 * ─── FAIL-CLOSED ──────────────────────────────────────────────────────────
 *
 * `dineroHabilitado()` devuelve `true` ÚNICAMENTE si el modo es exactamente
 * `'live'`. Cualquier otro valor —`disabled`, `sandbox`, un typo, `undefined`,
 * o un modo futuro que nadie enseñó a esta función— responde `false`. Si no se
 * puede determinar el modo, no se mueve plata.
 */
'use strict';

const logger = require('../utils/logger');

/**
 * 🔴 ÚNICA FUENTE AUTORITATIVA. Constante, no bandera.
 *
 *   'disabled' — cero pagos, ni simulados. SUPERSEDIDO por `D-FF-2-BIS`.
 *   'sandbox'  — pagos SIMULADOS con tarjetas de prueba. VIGENTE (2026-08-10).
 *   'live'     — dinero real. Requiere ratificación PROPIA de Mati; que
 *                `sandbox` habilite NO lo acerca ni un paso.
 *
 * ─── `D-FF-2-BIS` · qué cambió y qué NO ───────────────────────────────────
 *
 * `D-FF-2` decía «cero pagos, ni siquiera simulados; registro y social, nada
 * más». Quedó supersedido: los amigos abren mesa, confirman ítems, eligen
 * tarjeta de garantía, reparten y «pagan», todo con tarjetas de prueba.
 *
 * ⚠️ El obstáculo NUNCA fue la garantía. Se propuso un acta de «mesa sin
 * garantía» y Mati la rechazó desde el producto: **la garantía es lo que hace
 * que el restaurante cobre; sacarla rompe el invariante.** Lo que bloqueaba era
 * que `D-FF-2` prohibía los pagos simulados. Por eso esto se resuelve moviendo
 * el modo, y NO tocando `guarantee_method`.
 *
 * 🔴 LO QUE HACE SEGURO A `sandbox` NO ES EL MODO: es que la clave de Stripe
 * sea de PRUEBA. `sandbox` + `sk_live_…` cobraría de verdad. Ese acoplamiento
 * es un INVARIANTE y vive en `middleware/envValidation.js`, donde impide el
 * ARRANQUE — no acá, porque este archivo tiene prohibido leer `process.env` (el
 * modo no puede salir del entorno) y el chequeo es la dirección contraria: el
 * entorno tiene que MERECER el modo. Ver el comentario largo allá.
 *
 * El wallet sigue MUERTO: `sandbox` no lo revive, sigue 410 feature_removed.
 */
const MODO_MONETARIO = 'sandbox';

const MODOS_CONOCIDOS = Object.freeze(['disabled', 'sandbox', 'live']);

// ⚠️ ACÁ VIVÍA UN SEAM DE TEST, y se retiró con `D-FF-2-BIS` (2026-08-10).
//
// Existía para que las suites históricas del riel de dinero pudieran operar
// mientras el modo era `disabled`. Con `sandbox` el dinero está habilitado para
// todos, así que el seam quedó INERTE: abría una puerta que ya estaba abierta.
//
// 🔴 Se retira en vez de dejarlo. Un seam inerte es peor que uno ausente: sigue
// pareciendo que protege algo, y el día que alguien vuelva a cerrar el modo va
// a confiar en llamadas que no hacen nada. Además era, por definición, un
// abridor de dinero vivo en seis archivos de test. Si algún día vuelve
// `disabled`, se reescribe con su razón; no se resucita este.

/**
 * Fail-closed: habilitan `live` y `sandbox`, y NADA MÁS.
 *
 * Un modo desconocido, un typo, `undefined` o un modo futuro que nadie enseñó a
 * esta función siguen dando `false`. La lista es explícita a propósito: un
 * `!== 'disabled'` habilitaría cualquier basura.
 *
 * ⚠️ Acá NO se comprueba la clave de Stripe. No es un olvido: con `sandbox` el
 * proceso no llega a arrancar si la clave no es de prueba
 * (`middleware/envValidation.js`), así que cualquier request que alcance esta
 * función ya corre bajo una clave verificada. Repetir el chequeo acá exigiría
 * leer `process.env` en este archivo, que es justamente lo que su guard textual
 * prohíbe.
 */
function dineroHabilitado() {
  return MODO_MONETARIO === 'live' || MODO_MONETARIO === 'sandbox';
}

/**
 * Lo que publica `/api/config` para que el front LEA, no decida.
 *
 * 🔴 `payments_enabled` y `real_money` son DOS PREGUNTAS DISTINTAS, y bajo
 * `sandbox` sus respuestas se separan por primera vez:
 *
 *   payments_enabled  ¿puedo mostrar el flujo de cobro?        sandbox → SÍ
 *   real_money        ¿esto le saca plata a alguien?           sandbox → NO
 *
 * Sin las dos, el front tendría que deducir de `mode` —o peor, hardcodear una
 * lista de modos— para saber si avisarle a la persona que su tarjeta es de
 * prueba. Los dos booleanos son aditivos y explícitos: un consumidor que no
 * conozca un modo futuro ve `false` en ambos, que es el lado seguro.
 */
function modoMonetarioCapability() {
  return {
    mode: MODO_MONETARIO,
    payments_enabled: MODO_MONETARIO === 'sandbox' || MODO_MONETARIO === 'live',
    real_money: MODO_MONETARIO === 'live',
  };
}

/**
 * Middleware para rutas que mueven o preparan dinero.
 * 409 y no 403: no es un problema de permisos de la persona — la operación
 * completa está deshabilitada para todos.
 */
function requireDineroHabilitado(req, res, next) {
  if (dineroHabilitado()) return next();
  logger.warn('money_rail_disabled_reject', {
    path: req.originalUrl, method: req.method, mode: MODO_MONETARIO,
  });
  return res.status(409).json({
    error: 'payments_disabled',
    mode: MODO_MONETARIO,
    message: 'Los pagos están deshabilitados por la configuración vigente.',
  });
}

/**
 * Variante para gatear DENTRO de un handler que ya empezó (mismo patrón que
 * `walletRail.rechazaPorRielApagado`). Devuelve `true` si YA respondió.
 */
function rechazaPorDineroApagado(req, res, motivo) {
  if (dineroHabilitado()) return false;
  logger.warn('money_rail_disabled_reject', {
    path: req.originalUrl, method: req.method, mode: MODO_MONETARIO, motivo,
  });
  res.status(409).json({
    error: 'payments_disabled',
    mode: MODO_MONETARIO,
    ...(motivo && { field: motivo }),
    message: 'Los pagos están deshabilitados por la configuración vigente.',
  });
  return true;
}

module.exports = {
  MODO_MONETARIO,
  MODOS_CONOCIDOS,
  dineroHabilitado,
  modoMonetarioCapability,
  requireDineroHabilitado,
  rechazaPorDineroApagado,
};
