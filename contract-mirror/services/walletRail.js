/**
 * services/walletRail.js — gate autoritativo del riel wallet (ORDEN 1A · P0-A)
 *
 * POR QUÉ EXISTE, con precisión, porque el registro previo era falso:
 * `/api/config` publicaba `wallet_rail.enabled: false` desde `9d874c4`, y eso
 * se dio por apagado. **No lo era.** Publicar una capability hace autoritativa
 * la DECLARACIÓN, no la EJECUCIÓN: el backend seguía aceptando topups,
 * transferencias, CLABEs, garantía wallet y pago wallet. Ocultar el frontend
 * no es autorización del backend. Este módulo es la ejecución.
 *
 * Gobierna `LEGACY_WALLET_ENABLED`, **apagada por defecto**, con el parsing
 * estricto del repo: definida con cualquier cosa que no sea `'true'`/`'false'`
 * exactos, el proceso no arranca (`utils/flags.js`). Una bandera que se apaga
 * sola por un typo es peor que un arranque fallido — y acá decide si se pueden
 * seguir creando obligaciones de dinero electrónico.
 *
 * ⚠️ ACTIVARLA NO AUTORIZA NADA. La reactivación comercial del wallet exige
 * IFPE vigente, acta específica de Mati, dictamen legal y operativo, inventario
 * en cero/conciliado, auditoría y release coordinado — las seis piezas, según
 * el plan ratificado §10. La bandera es un control técnico para drenar
 * obligaciones legacy en una ventana autorizada, nunca una llave comercial.
 *
 * NO se borra nada: código, rutas, schema, historia, workers y tests del riel
 * quedan durmientes por ratificación (acta 2026-08-02 §2 + addendum 08-03).
 *
 * QUÉ **NO** GATEA, a propósito y declarado:
 *   · lecturas legacy (`GET /api/topup*`, `GET /api/transfers*`, saldo,
 *     movimientos wallet) — el plan §3 preserva acceso autenticado de solo
 *     lectura a comprobantes e historia;
 *   · workers y webhooks de proveedor que DRENAN obligaciones ya existentes
 *     (abono SPEI entrante, procesamiento de topups ya emitidos). Frenarlos
 *     sin inventario es una stop condition del plan, y convertirlos en
 *     cuarentena exige un criterio económico ratificado que no tengo;
 *   · `tip_received` y la actividad legítima de cuenta.
 */
'use strict';

const { banderaEstricta } = require('../utils/flags');
const logger = require('../utils/logger');

const FLAG = 'LEGACY_WALLET_ENABLED';

/**
 * Se lee POR LLAMADA y no como constante de módulo. Si se congelara al
 * importar, un test que flipa la bandera mediría el valor del import y no el
 * del request — el mismo modo de falla que `loadEnv(raw)` corrigió en el
 * receptor del dashboard.
 */
function walletRailEnabled() {
  return banderaEstricta(FLAG, false);
}

/** Cuerpo contractual único. El plan ratificado §4.1.2 sella `410`. */
const RESPUESTA = Object.freeze({ error: 'feature_removed', code: 'feature_removed' });

/**
 * Middleware. Va SIEMPRE después de la autenticación: un usuario sin sesión
 * tiene que recibir su 401 y no enterarse por el 410 de que existe un riel
 * wallet apagado.
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
 * Para los bordes que no son una ruta entera sino un valor del body
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
  FLAG,
  RESPUESTA,
  walletRailEnabled,
  requireWalletRail,
  rechazaPorRielApagado,
};
