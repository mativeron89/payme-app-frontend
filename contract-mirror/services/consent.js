/**
 * services/consent.js — registro de consentimiento (PQ-1 · 1.2 y 1.3)
 *
 * Acta: ops/actas/[PAYME]_ACTA_2026-07-24_GOBIERNO_DATOS_CONSUMO.md (rev. 4).
 *   · D-06: registro APPEND-ONLY como prueba. Revocar es INSERTAR un evento
 *     nuevo, jamás un UPDATE (la base lo bloquea con un trigger).
 *   · D-05 (reformulado): el control es un GATE en el punto de cómputo, no un
 *     borrado. `getConsentState` es la lectura barata que ese gate consulta
 *     ANTES de calcular; sin opt-in vigente, el motor se niega a computar.
 *   · D-11: a un MENOR no se le ofrece esta finalidad NUNCA, ni con permiso de
 *     los representantes legales. Ver el gate de edad más abajo.
 *
 * NO toca dinero, NO toca el outbox, NO reutiliza su guard de privacidad.
 */
'use strict';

const pool = require('../db/pool');
const legal = require('./legal');
const logger = require('../utils/logger');
const { hoyMenosAnios } = require('../utils/fechas');

/**
 * Finalidades. Lista CERRADA: una finalidad nueva es una decisión de producto
 * con acta, no un string que aparece en un request.
 *
 * `requiere_mayoria_edad`: D-11 — la capa de campañas está prohibida para
 * menores. La finalidad primaria (cobrar, comprobante) no vive acá: no
 * necesita consentimiento, está cubierta por el art. 9 fr. IV.
 */
const PURPOSES = {
  perfilado_campanas: {
    notice_kind: 'aviso_campanas',
    requiere_mayoria_edad: true,
    descripcion: 'Usar el historial de consumo para campañas personalizadas',
  },
};

const CHANNELS = ['app', 'web', 'soporte'];

function isPurpose(key) {
  return Object.prototype.hasOwnProperty.call(PURPOSES, key);
}

/**
 * ¿El titular es mayor de edad?  → true | false | null (NO SE SABE)
 *
 * ⚠️ Toda la comparación se hace con fechas de CALENDARIO en formato
 * YYYY-MM-DD, nunca con objetos Date. Motivo, medido: el driver de pg
 * devuelve un DATE como medianoche LOCAL del proceso, y compararlo con
 * getters UTC corre la fecha un día según la TZ del contenedor. Con
 * TZ=Asia/Tokyo un chico que cumple 18 MAÑANA pasaba el gate HOY — o sea,
 * D-11 (línea roja) violado por una variable de entorno.
 *   · `to_char` en SQL evita el parseo del driver.
 *   · "hoy" se calcula en el calendario de México (D-6), no en UTC.
 *
 * Devuelve null cuando la edad NO se puede verificar: sin la columna (código
 * desplegado antes que su migración) o sin fecha declarada por el titular.
 * El gate de grantConsent trata ese null como BLOQUEO.
 */
async function edadConocida(userId) {
  const { rows } = await pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'users' AND column_name = 'birth_date'`
  );
  if (rows.length === 0) return null;      // el código subió antes que la migración
  const { rows: u } = await pool.query(
    `SELECT to_char(birth_date, 'YYYY-MM-DD') AS bd FROM users WHERE id = $1`,
    [userId]
  );
  const bd = u[0]?.bd;
  if (!bd) return null;                    // el titular no la declaró

  // Quien nació ese día o antes ya cumplió 18 hoy en México.
  return bd <= hoyMenosAnios(18);          // comparación de calendario, sin husos
}

/**
 * Estado vigente de una finalidad. Lectura BARATA (una fila, por índice):
 * es la que consulta el gate de PQ-4 antes de computar un perfil.
 */
async function getConsentState(userId, purposeKey) {
  if (!isPurpose(purposeKey)) throw Object.assign(new Error('unknown_purpose'), { status: 400 });
  const { rows } = await pool.query(
    `SELECT state, notice_version, notice_hash, created_at
       FROM consent_events
      WHERE user_id = $1 AND purpose_key = $2
      ORDER BY created_at DESC, id DESC
      LIMIT 1`,
    [userId, purposeKey]
  );
  const ult = rows[0];
  return {
    purpose_key: purposeKey,
    granted: ult?.state === 'granted',
    state: ult?.state || 'never',
    since: ult?.created_at || null,
    notice_version: ult?.notice_version || null,
    notice_hash: ult?.notice_hash || null,
  };
}

/** Estado de TODAS las finalidades conocidas. */
async function getAllConsentStates(userId) {
  const out = {};
  for (const key of Object.keys(PURPOSES)) {
    out[key] = await getConsentState(userId, key);
  }
  return out;
}

/** Inserta el evento con el texto vigente capturado EN EL MOMENTO DEL ACTO. */
async function registrar({ userId, purposeKey, state, channel, ip, userAgent, appVersion }) {
  const cfg = PURPOSES[purposeKey];
  const vigente = await legal.getVigente(cfg.notice_kind);
  if (!vigente) {
    throw Object.assign(
      new Error('legal_text_missing'),
      { status: 503, detail: `no hay versión vigente de ${cfg.notice_kind}; correr legal:sync` }
    );
  }
  const { rows } = await pool.query(
    `INSERT INTO consent_events
       (user_id, purpose_key, state, notice_kind, notice_version, notice_hash,
        channel, ip, user_agent, app_version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING id, created_at`,
    [userId, purposeKey, state, vigente.kind, vigente.version, vigente.hash,
     channel, ip || null, (userAgent || '').slice(0, 500) || null, appVersion || null]
  );
  logger.audit('consent_event', {
    consent_id: rows[0].id, user_id: userId, purpose_key: purposeKey,
    state, notice_version: vigente.version, channel,
  });
  return { id: rows[0].id, created_at: rows[0].created_at, notice: vigente };
}

/**
 * Otorgar. Captura versión y hash del texto vigente en el momento del acto.
 *
 * 🔒 GATE DE EDAD — FALLA CERRADO (ratificado por Mati, 2026-07-25).
 * D-11 prohíbe dirigir campañas por perfilamiento a menores, **ni con
 * consentimiento de los representantes legales**.
 *
 * ⚠️ **NO asumir que todo usuario nuevo tiene fecha.** PQ-2 (v2.27) agregó
 * `birth_date` al registro, pero **v2.28 la dejó OPCIONAL por default** (modo de
 * compatibilidad del rollout: `PQ2_BIRTH_DATE_REQUIRED`). Mientras esa bandera
 * no esté prendida, **se siguen creando cuentas SIN fecha**. Hay entonces tres
 * poblaciones sin edad verificable:
 *   · usuarios anteriores a PQ-2;
 *   · usuarios creados durante la compatibilidad sin mandar la fecha;
 *   · cualquiera que la app no le haya pedido todavía.
 * Para las tres, la edad es DESCONOCIDA y otorgar se **RECHAZA** hasta que la
 * declaren —en el registro o por `PATCH /api/account/me`—. Ese es el
 * comportamiento correcto y no cambia con la bandera: **el gate falla cerrado
 * siempre**. Preferible bloquear una finalidad opcional que incumplir D-11 en
 * silencio; el acta es explícita en que rechazar NO degrada el servicio.
 */
async function grantConsent({ userId, purposeKey, channel = 'app', ip, userAgent, appVersion }) {
  if (!isPurpose(purposeKey)) throw Object.assign(new Error('unknown_purpose'), { status: 400 });
  if (!CHANNELS.includes(channel)) throw Object.assign(new Error('unknown_channel'), { status: 400 });

  if (PURPOSES[purposeKey].requiere_mayoria_edad) {
    const mayor = await edadConocida(userId);
    if (mayor !== true) {
      logger.warn('consent_bloqueado_por_age_gate', {
        user_id: userId, purpose_key: purposeKey,
        motivo: mayor === null ? 'edad_desconocida' : 'menor_de_edad',
      });
      throw Object.assign(new Error('age_verification_required'), {
        status: 403,
        detail: mayor === null
          ? 'No se puede verificar la mayoría de edad (falta fecha de nacimiento). D-11 exige bloquear.'
          : 'D-11: las campañas por perfilamiento no se ofrecen a menores.',
      });
    }
  }
  return registrar({ userId, purposeKey, state: 'granted', channel, ip, userAgent, appVersion });
}

/**
 * Revocar. SIN gate de edad: retirar el consentimiento siempre se puede, y su
 * efecto es inmediato en la siguiente lectura (no hay job de por medio).
 */
async function revokeConsent({ userId, purposeKey, channel = 'app', ip, userAgent, appVersion }) {
  if (!isPurpose(purposeKey)) throw Object.assign(new Error('unknown_purpose'), { status: 400 });
  if (!CHANNELS.includes(channel)) throw Object.assign(new Error('unknown_channel'), { status: 400 });
  return registrar({ userId, purposeKey, state: 'revoked', channel, ip, userAgent, appVersion });
}

module.exports = {
  PURPOSES,
  CHANNELS,
  isPurpose,
  edadConocida,
  getConsentState,
  getAllConsentStates,
  grantConsent,
  revokeConsent,
};
