/**
 * routes/ocr.js v2.5.2
 *
 * Cambios vs v2.5.1:
 *   - P1 #8: FAIL-FAST AL STARTUP. Como NO existe implementación real de OCR,
 *     si OCR_FEATURE_FLAG=real el módulo lanza al cargarse (require), sin
 *     importar NODE_ENV. Mensaje exacto:
 *       "OCR real mode is configured but no real OCR provider is implemented"
 *     Esto evita que producción arranque y falle recién en runtime con 501.
 *     Cuando se integre un proveedor real, setear HAS_REAL_IMPL=true.
 *   - P2 #9: HEIC valida MAJOR BRAND (bytes 8-11) contra una allowlist
 *     {heic,heix,hevc,hevx,mif1,msf1}. Un ISO-BMFF genérico (p.ej. mp42/isom)
 *     con mimetype image/heic se rechaza.
 *
 * v2.5.1 (se mantiene):
 *   - magic bytes validation (no confiar solo en mimetype).
 */
'use strict';

const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../middleware/auth');
const matching = require('../services/matching');
const logger = require('../utils/logger');

const router = express.Router();

const USE_REAL = process.env.OCR_FEATURE_FLAG === 'real';
// v2.19 (D5): proveedor real integrado — Amazon Textract (services/ocrTextract).
// El DEFAULT sigue siendo mock: nada cambia hasta setear OCR_FEATURE_FLAG=real
// + credenciales AWS por entorno.
const HAS_REAL_IMPL = true;

// ─── FAIL-FAST AL STARTUP (mismo espíritu que P1 #8) ───
// Modo real sin credenciales AWS → abortar el arranque, no fallar en runtime.
if (USE_REAL && !(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY && process.env.AWS_REGION)) {
  const msg = 'OCR real mode (Textract) requires AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY and AWS_REGION';
  logger.error('ocr_real_mode_missing_aws_credentials', {
    message: msg,
    hint: 'Cambiá OCR_FEATURE_FLAG=mock o configurá las credenciales AWS por entorno.',
  });
  throw new Error(msg);
}
const ocrTextract = USE_REAL ? require('../services/ocrTextract') : null;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!/^image\/(jpe?g|png|webp|heic)$/.test(file.mimetype)) {
      return cb(new Error('invalid_image_type'));
    }
    cb(null, true);
  },
});

const ocrLimiter = rateLimit({
  windowMs: 60_000,
  max: Number(process.env.RATE_LIMIT_OCR_MAX) || 10,
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── Magic bytes ───────────────────────────────────────────
// v2.5.2 P2 #9: brands HEIC/ISO-BMFF aceptados como "imagen HEIC".
const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1']);

function readBrand(buffer, offset) {
  if (buffer.length < offset + 4) return null;
  return buffer.toString('ascii', offset, offset + 4).replace(/\0+$/, '').trim();
}

function detectMagicBytes(buffer) {
  if (!buffer || buffer.length < 12) return null;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'jpeg';

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47 &&
      buffer[4] === 0x0D && buffer[5] === 0x0A && buffer[6] === 0x1A && buffer[7] === 0x0A) {
    return 'png';
  }

  // WebP: RIFF....WEBP
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
    return 'webp';
  }

  // HEIC: ISO-BMFF con box 'ftyp' en bytes 4-7. v2.5.2 P2 #9: validar
  // que el MAJOR BRAND (bytes 8-11) esté en la allowlist HEIC. No basta
  // con que sea un ISO-BMFF cualquiera.
  if (buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70) {
    const majorBrand = readBrand(buffer, 8);
    if (majorBrand && HEIC_BRANDS.has(majorBrand.toLowerCase())) {
      return 'heic';
    }
    // ftyp presente pero brand no es HEIC (p.ej. 'mp42', 'isom', 'M4V ').
    // Podríamos escanear compatible brands, pero para una foto de ticket el
    // major brand alcanza. Rechazamos como ISO-BMFF no-HEIC.
    return 'iso-bmff-other';
  }

  return null;
}

function magicMatchesMime(magic, mimetype) {
  if (!magic) return false;
  if (mimetype === 'image/jpeg' || mimetype === 'image/jpg') return magic === 'jpeg';
  if (mimetype === 'image/png')  return magic === 'png';
  if (mimetype === 'image/webp') return magic === 'webp';
  if (mimetype === 'image/heic') return magic === 'heic';
  return false;
}

router.use(requireAuth);
router.use(ocrLimiter);

router.post('/', upload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'no_image' });

    const magic = detectMagicBytes(req.file.buffer);
    if (!magic || !magicMatchesMime(magic, req.file.mimetype)) {
      logger.warn('ocr_magic_bytes_mismatch', {
        user_id: req.user.id,
        claimed_mime: req.file.mimetype,
        detected_magic: magic,
        size: req.file.size,
      });
      return res.status(400).json({
        error: 'invalid_image_type',
        message: 'File content does not match declared image type',
      });
    }

    logger.audit('ocr_request', {
      user_id: req.user.id, size_bytes: req.file.size,
      mime: req.file.mimetype, magic, mode: USE_REAL ? 'real' : 'mock',
    });

    if (USE_REAL) {
      // v2.19 (D5): Textract. Política del acta ante fallo del proveedor:
      // devolver lo utilizable (acá: nada + warning) para que el usuario
      // edite a mano — el flujo de dividir la cuenta NUNCA se rompe por OCR.
      try {
        const result = await ocrTextract.analyzeExpense(req.file.buffer);
        return res.json({ ...result, mock: false });
      } catch (e) {
        logger.error('ocr_provider_error', { user_id: req.user.id, error: e.message });
        return res.json({
          items: [], total_cents: 0, warnings: ['provider_error'], mock: false,
        });
      }
    }

    const items = matching.parseTicket(mockTicketText());
    res.json({
      items,
      total_cents: items.reduce((s, i) => s + i.price_cents * i.quantity, 0),
      warnings: [],
      mock: true,
    });
  } catch (err) {
    if (err.message === 'invalid_image_type') {
      return res.status(400).json({ error: 'invalid_image_type' });
    }
    next(err);
  }
});

function mockTicketText() {
  return `
    LA PAROLACCIA
    Tagliatelle Bolognese    195.00
    Risotto ai Funghi        220.00
    Pizza Margherita         185.00
    Tiramisú x2              140.00
    Agua mineral              40.00
    Vino tinto (copa)         60.00
    TOTAL                    840.00
  `;
}

// Exports para tests (P2 #9)
module.exports = router;
module.exports.detectMagicBytes = detectMagicBytes;
module.exports.magicMatchesMime = magicMatchesMime;
module.exports.HEIC_BRANDS = HEIC_BRANDS;
