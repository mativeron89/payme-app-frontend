/**
 * services/walletRail.js — riel wallet CERRADO, sin llave (P0 · ORDEN 1)
 *
 * ─── QUÉ SE CORRIGE, Y ES UN DEFECTO MÍO ────────────────────────────────────
 *
 * La versión anterior leía `LEGACY_WALLET_ENABLED` por llamada. Con la variable
 * en `true`, las rutas externas volvían a aceptar operaciones wallet y el alta
 * volvía a acuñar fila — mientras `/api/config` seguía publicando
 * `wallet_rail.enabled: false`. **Backend y frontend podían describir estados
 * opuestos, y una variable de entorno reabría la creación de obligaciones
 * NUEVAS de dinero electrónico.**
 *
 * El gobierno raíz es explícito: *"No existe permiso por cuenta, rol, usuario ni
 * restaurante que pueda reactivar wallet durante el MVP."* Una env var es
 * exactamente eso.
 *
 * ─── Y LA BANDERA NO TENÍA USO LEGÍTIMO ─────────────────────────────────────
 *
 * El docstring anterior —también mío— se justificaba diciendo que la bandera
 * era *"un control técnico para drenar obligaciones legacy"*. **En su propia
 * sección siguiente declaraba que los workers y webhooks de drenaje NO pasan
 * por la bandera.** O sea: no habilitaba drenar nada. Lo único que hacía era
 * reabrir los entrypoints que CREAN obligaciones nuevas.
 *
 * Un texto que se contradice a sí mismo dentro del mismo comentario, sostenido
 * durante toda una orden. Por eso la llave se elimina en vez de discutirse.
 *
 * ─── CÓMO QUEDA ─────────────────────────────────────────────────────────────
 *
 * `RIEL_HABILITADO` es una CONSTANTE `false` y es la ÚNICA fuente autoritativa.
 * `/api/config` la publica y el runtime la ejecuta: **no puede haber dos
 * estados.** Reactivar exige IFPE, acta de Mati, dictamen legal, inventario
 * conciliado, auditoría y release coordinado — un cambio de código bajo esas
 * seis piezas, nunca una variable.
 *
 * `LEGACY_WALLET_ENABLED` **ya no es una llave ejecutable**: definirla fuera del
 * harness de test hace que el proceso no arranque (`middleware/envValidation.js`).
 * Falla ruidosa y no ignorada en silencio, para que nadie la configure creyendo
 * que hizo algo.
 *
 * NO se borra nada: código, rutas, schema, historia, balances y workers de
 * drenaje quedan durmientes por ratificación.
 *
 * ─── QUÉ **NO** GATEA, a propósito ──────────────────────────────────────────
 *   · lecturas legacy (`GET /api/topup*`, `/api/transfers*`, saldo, movimientos)
 *     — el plan §3 preserva acceso autenticado de solo lectura a comprobantes;
 *   · workers y webhooks que DRENAN obligaciones YA EXISTENTES (abono SPEI
 *     entrante, topups ya emitidos). Frenarlos sin inventario es stop condition
 *     del plan, y la plata en vuelo dejaría de acreditarse;
 *   · `tip_received` y la actividad legítima de cuenta.
 */
'use strict';

const logger = require('../utils/logger');

/** Nombre conservado sólo para poder RECHAZARLO al arranque. No es una llave. */
const FLAG_PROHIBIDA = 'LEGACY_WALLET_ENABLED';

/**
 * ÚNICA fuente autoritativa. Constante, no bandera, no configurable.
 * `/api/config` publica ESTE valor; el runtime ejecuta ESTE valor.
 */
const RIEL_HABILITADO = false;

// ─── Seam EXCLUSIVO de test ──────────────────────────────────────────────────
// Existe porque la ratificación manda conservar el código durmiente Y SUS
// TESTS, y esas suites necesitan ejercitar rutas históricas.
//
// Sus cuatro propiedades, que son las que lo vuelven aceptable:
//   1. NO se deriva de ninguna variable configurable del proceso productivo;
//   2. es inalcanzable desde un request — ninguna ruta ni middleware lo importa;
//   3. LANZA fuera de `NODE_ENV=test`, en vez de degradar en silencio;
//   4. devuelve su propio restaurador, así que el aislamiento no depende de que
//      alguien se acuerde de apagarlo.
let seamLegacyActivo = false;

function habilitarRielLegacyEnTests() {
  if (process.env.NODE_ENV !== 'test') {
    const err = new Error(
      'wallet_rail_seam_solo_en_test: el riel wallet no se reabre fuera del harness'
    );
    err.code = 'wallet_rail_seam_solo_en_test';
    throw err;
  }
  seamLegacyActivo = true;
  return function restaurar() { seamLegacyActivo = false; };
}

/** ¿Corre el riel? En producto: NUNCA. */
function walletRailEnabled() {
  if (RIEL_HABILITADO) return true;
  return process.env.NODE_ENV === 'test' && seamLegacyActivo;
}

/**
 * Lo que se PUBLICA. Deliberadamente NO consulta el seam: la capability
 * describe el estado del PRODUCTO, y el producto está cerrado siempre.
 */
function walletRailCapability() {
  return RIEL_HABILITADO;
}

/** Cuerpo contractual único. Plan ratificado §4.1.2 sella el 410. */
const RESPUESTA = Object.freeze({ error: 'feature_removed', code: 'feature_removed' });

/**
 * Middleware. Va SIEMPRE después de la autenticación: un usuario sin sesión
 * recibe su 401 y no se entera por el error de que existe un riel apagado.
 */
function requireWalletRail(req, res, next) {
  if (walletRailEnabled()) return next();
  logger.audit('wallet_rail_rejected', {
    user_id: req.user?.id || null,
    method: req.method,
    path: req.originalUrl?.split('?')[0] || req.path,
  });
  return res.status(410).json(RESPUESTA);
}

/**
 * Para bordes que no son una ruta entera sino un valor del body
 * (`guarantee_method='wallet'`, `payment_type='wallet'`). Devuelve true si ya
 * respondió, para que el handler corte antes de cualquier efecto.
 */
function rechazaPorRielApagado(req, res, motivo) {
  if (walletRailEnabled()) return false;
  logger.audit('wallet_rail_rejected', {
    user_id: req.user?.id || null,
    method: req.method,
    path: req.originalUrl?.split('?')[0] || req.path,
    motivo,
  });
  res.status(410).json(RESPUESTA);
  return true;
}

module.exports = {
  FLAG_PROHIBIDA,
  RIEL_HABILITADO,
  RESPUESTA,
  walletRailEnabled,
  walletRailCapability,
  requireWalletRail,
  rechazaPorRielApagado,
  habilitarRielLegacyEnTests,
};
