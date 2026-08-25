/**
 * Identidad propia editable y avatar privado.
 *
 * Capability autoritativa activada por la ratificación literal de Mati del
 * 2026-08-25: «OK aviso 2.2.0 y legacy “Sin asignar”». No hay flag de entorno:
 * una decisión nueva, no una variable, gobierna cualquier cambio posterior.
 * Los bytes nunca salen en URLs ni viajan a Stripe, outbox o Dashboard.
 */
'use strict';

const { randomUUID } = require('node:crypto');
const sharp = require('sharp');
const pool = require('../db/pool');
const consent = require('./consent');
const { normalizarNombre } = require('../utils/profileNames');

const MAX_INPUT_BYTES = 5 * 1024 * 1024;
const MAX_INPUT_PIXELS = 16_000_000;
const MAX_SIDE = 512;
const MAX_OUTPUT_BYTES = 256 * 1024;
const OUTPUT_MIME = 'image/jpeg';
const SUPPORTED_INPUT_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const PROFILE_IDENTITY_CAPABILITY = Object.freeze({
  supported: true,
  enabled: true,
  notice_version: '2.2.0',
  notice_required: true,
  activation_blocker: null,
  payme_id_mutable: false,
  avatar_public_url: false,
});
let testRolloutEnabled = false;
const MAX_CONCURRENT_AVATAR_JOBS = 2;
let activeAvatarJobs = 0;
const activeAvatarUsers = new Set();

function profileIdentityRolloutEnabled() {
  return PROFILE_IDENTITY_CAPABILITY.enabled
    || (process.env.NODE_ENV === 'test' && testRolloutEnabled);
}

function habilitarProfileIdentityParaTests() {
  if (process.env.NODE_ENV !== 'test') throw profileError('profile_test_seam_forbidden', 403);
  const previous = testRolloutEnabled;
  testRolloutEnabled = true;
  return () => { testRolloutEnabled = previous; };
}

/**
 * Límite por proceso para que imágenes autenticadas concurrentes no acumulen
 * buffers ni agoten CPU. La ruta lo adquiere antes de `multer.memoryStorage`.
 * Es una defensa adicional al rate limit HTTP; no se presenta como exclusión
 * distribuida entre réplicas.
 */
function acquireAvatarProcessingBudget(userId) {
  if (activeAvatarJobs >= MAX_CONCURRENT_AVATAR_JOBS || activeAvatarUsers.has(userId)) {
    throw profileError('avatar_processing_busy', 429);
  }
  activeAvatarJobs += 1;
  activeAvatarUsers.add(userId);
  let released = false;
  return () => {
    if (released) return false;
    released = true;
    activeAvatarJobs -= 1;
    activeAvatarUsers.delete(userId);
    return true;
  };
}

async function withAvatarProcessingBudget(userId, work) {
  const release = acquireAvatarProcessingBudget(userId);
  try {
    return await work();
  } finally {
    release();
  }
}

function profileError(code, status = 400) {
  return Object.assign(new Error(code), { code, status });
}

function detectedMime(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= 8
      && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (bytes.length >= 12
      && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
      && bytes.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

function sharpErrorCode(error) {
  const message = String(error?.message || '').toLowerCase();
  if (message.includes('pixel limit') || message.includes('input image exceeds pixel limit')) {
    return 'avatar_pixels_exceeded';
  }
  return 'avatar_decode_invalid';
}

async function procesarAvatar(input, declaredMime) {
  if (!Buffer.isBuffer(input) || input.length === 0) throw profileError('avatar_file_required');
  if (input.length > MAX_INPUT_BYTES) throw profileError('avatar_input_too_large', 413);
  if (!SUPPORTED_INPUT_MIMES.has(declaredMime)) {
    throw profileError('avatar_media_type_unsupported', 415);
  }
  const magicMime = detectedMime(input);
  if (!magicMime) throw profileError('avatar_magic_bytes_invalid', 415);
  if (magicMime !== declaredMime) throw profileError('avatar_media_type_mismatch', 415);

  let metadata;
  try {
    metadata = await sharp(input, {
      failOn: 'error',
      limitInputPixels: MAX_INPUT_PIXELS,
      sequentialRead: true,
    }).metadata();
  } catch (error) {
    throw profileError(sharpErrorCode(error), 422);
  }
  if (metadata.format !== magicMime.slice(6)) throw profileError('avatar_decode_invalid', 422);
  if (Number(metadata.pages || 1) !== 1) throw profileError('avatar_animation_unsupported', 415);
  if (!Number.isSafeInteger(metadata.width) || !Number.isSafeInteger(metadata.height)
      || metadata.width < 1 || metadata.height < 1
      || metadata.width * metadata.height > MAX_INPUT_PIXELS) {
    throw profileError('avatar_pixels_exceeded', 422);
  }

  let normalized;
  try {
    // La imagen potencialmente grande se decodifica una sola vez. Los intentos
    // de calidad posteriores trabajan sobre este intermedio de como máximo
    // 512×512, no vuelven a abrir el input hostil.
    normalized = await sharp(input, {
      failOn: 'error',
      limitInputPixels: MAX_INPUT_PIXELS,
      sequentialRead: true,
    })
      .rotate()
      .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: false })
      .toBuffer();
  } catch (error) {
    throw profileError(sharpErrorCode(error), 422);
  }

  let output;
  for (const quality of [82, 74, 66, 58, 50]) {
    try {
      output = await sharp(normalized, { failOn: 'error' })
        // JPEG nuevo y sin `withMetadata`: EXIF/ICC/XMP/comentarios no sobreviven.
        .jpeg({ quality, progressive: true, chromaSubsampling: '4:2:0' })
        .toBuffer({ resolveWithObject: true });
    } catch (error) {
      throw profileError(sharpErrorCode(error), 422);
    }
    if (output.data.length <= MAX_OUTPUT_BYTES) break;
  }
  if (!output || output.data.length > MAX_OUTPUT_BYTES) {
    throw profileError('avatar_output_too_large', 422);
  }
  if (output.info.width > MAX_SIDE || output.info.height > MAX_SIDE) {
    throw profileError('avatar_output_dimensions_invalid', 500);
  }
  return {
    bytes: output.data,
    mimeType: OUTPUT_MIME,
    width: output.info.width,
    height: output.info.height,
  };
}

async function obtenerPerfil(userId, db = pool) {
  const { rows } = await db.query(
    `SELECT u.id, u.payme_id, u.email, u.first_name, u.last_name, u.phone,
            to_char(u.birth_date, 'YYYY-MM-DD') AS birth_date, u.created_at,
            a.revision AS avatar_revision, a.width AS avatar_width,
            a.height AS avatar_height, a.updated_at AS avatar_updated_at
       FROM users u
       LEFT JOIN user_avatars a ON a.user_id=u.id
      WHERE u.id=$1`,
    [userId]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    payme_id: row.payme_id,
    email: row.email,
    first_name: row.first_name,
    last_name: row.last_name,
    phone: row.phone,
    birth_date: row.birth_date,
    created_at: row.created_at,
    birth_date_set: row.birth_date !== null,
    is_adult: await consent.edadConocida(userId, db),
    avatar: row.avatar_revision ? {
      revision: row.avatar_revision,
      width: Number(row.avatar_width),
      height: Number(row.avatar_height),
      updated_at: row.avatar_updated_at,
    } : null,
  };
}

async function actualizarNombre(userId, { first_name, last_name }) {
  return pool.tx(async (client) => {
    const updated = await client.query(
      `UPDATE users SET first_name=$2,last_name=$3 WHERE id=$1 RETURNING id`,
      [userId, first_name, last_name]
    );
    if (updated.rowCount !== 1) throw profileError('user_not_found', 404);
    return obtenerPerfil(userId, client);
  });
}

async function guardarAvatar(userId, image, { expectedRevision }) {
  return pool.tx(async (client) => {
    const user = await client.query(`SELECT id FROM users WHERE id=$1 FOR UPDATE`, [userId]);
    if (user.rowCount !== 1) throw profileError('user_not_found', 404);
    const { rows: [current] } = await client.query(
      `SELECT revision FROM user_avatars WHERE user_id=$1`, [userId]
    );
    if ((current && current.revision !== expectedRevision)
        || (!current && expectedRevision !== null)) {
      throw profileError('avatar_revision_conflict', 409);
    }
    const revision = randomUUID();
    const { rows: [saved] } = await client.query(
      `INSERT INTO user_avatars
         (user_id,revision,mime_type,width,height,byte_size,image_bytes)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (user_id) DO UPDATE SET
         revision=EXCLUDED.revision,mime_type=EXCLUDED.mime_type,
         width=EXCLUDED.width,height=EXCLUDED.height,
         byte_size=EXCLUDED.byte_size,image_bytes=EXCLUDED.image_bytes,
         updated_at=NOW()
       RETURNING revision,width,height,updated_at`,
      [userId, revision, image.mimeType, image.width, image.height,
       image.bytes.length, image.bytes]
    );
    return {
      created: !current,
      revision: saved.revision,
      width: Number(saved.width),
      height: Number(saved.height),
      updated_at: saved.updated_at,
    };
  });
}

async function obtenerAvatar(userId, db = pool) {
  const { rows: [avatar] } = await db.query(
    `SELECT revision,mime_type,width,height,byte_size,image_bytes,updated_at
       FROM user_avatars WHERE user_id=$1`,
    [userId]
  );
  if (!avatar) return null;
  return {
    revision: avatar.revision,
    mimeType: avatar.mime_type,
    width: Number(avatar.width),
    height: Number(avatar.height),
    byteSize: Number(avatar.byte_size),
    bytes: avatar.image_bytes,
    updatedAt: avatar.updated_at,
  };
}

async function borrarAvatar(userId, expectedRevision) {
  return pool.tx(async (client) => {
    const user = await client.query(`SELECT id FROM users WHERE id=$1 FOR UPDATE`, [userId]);
    if (user.rowCount !== 1) throw profileError('user_not_found', 404);
    const deleted = await client.query(
      `DELETE FROM user_avatars WHERE user_id=$1 AND revision=$2`,
      [userId, expectedRevision]
    );
    return deleted.rowCount === 1;
  });
}

module.exports = {
  PROFILE_IDENTITY_CAPABILITY,
  MAX_INPUT_BYTES,
  MAX_CONCURRENT_AVATAR_JOBS,
  profileIdentityRolloutEnabled,
  habilitarProfileIdentityParaTests,
  acquireAvatarProcessingBudget,
  withAvatarProcessingBudget,
  normalizarNombre,
  procesarAvatar,
  obtenerPerfil,
  actualizarNombre,
  guardarAvatar,
  obtenerAvatar,
  borrarAvatar,
};
