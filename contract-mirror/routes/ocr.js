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
const {
  respuestaOcr, respuestaProveedorNoDisponible, errorOcr,
} = require('../services/ocrResponseContract');

const router = express.Router();

// 🔴 El modo sale de `services/ocrRail.js`, que lo parsea ESTRICTO. Antes acá
// decía `process.env.OCR_FEATURE_FLAG === 'real'`, y con eso `Real`, `REAL`,
// `true` o un typo caían a mock EN SILENCIO: quien configuró AWS quedaba
// convencido de haberlo prendido, y el síntoma habría sido que los tickets se
// leen mal —porque el mock inventa— sin un solo error en los logs.
const { ocrRealHabilitado, proveedorSoporta, MIME_PROVEEDOR } = require('../services/ocrRail');
const USE_REAL = ocrRealHabilitado();
// v2.19 (D5): proveedor real integrado — Amazon Textract (services/ocrTextract).
// El DEFAULT sigue siendo mock: nada cambia hasta setear OCR_FEATURE_FLAG=real
// + credenciales AWS por entorno.

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

const uploadImage = upload.single('image');

// Multer/Busboy corre antes del handler async. Por eso estos errores no llegan
// al try/catch de la ruta y deben traducirse en el callback del middleware.
// Además de mantener un contrato 4xx honesto, este wrapper permite comprobar
// que un multipart truncado no tumba ni envenena el proceso tras migrar a
// Multer >= 2.1.1 (GHSA-5528-5vmv-3xc2).
function parseImageUpload(req, res, next) {
  uploadImage(req, res, (err) => {
    if (!err) return next();
    if (err.message === 'invalid_image_type') {
      const out = errorOcr('invalid_image_type');
      return res.status(out.status).json(out.body);
    }
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        const out = errorOcr('image_too_large');
        return res.status(out.status).json(out.body);
      }
      const out = errorOcr('invalid_multipart');
      return res.status(out.status).json(out.body);
    }
    if (err.message === 'Unexpected end of form') {
      const out = errorOcr('invalid_multipart');
      return res.status(out.status).json(out.body);
    }
    return next(err);
  });
}

// 🔴 C6/R111 · DOS dimensiones, no una. La ventana y el techo son los MISMOS
// para los dos limitadores y por eso viven en una constante cada uno: escritos
// dos veces se desincronizarían al primer ajuste, y un techo por usuario más
// alto que el de IP haría que el segundo carril no rechazara nunca.
const OCR_WINDOW_MS = 60_000;
const OCR_MAX = Number(process.env.RATE_LIMIT_OCR_MAX) || 10;

// Carril 1 · por IP (clave por default de express-rate-limit). Es el que ya
// estaba y NO se reemplaza: sin él, un atacante con muchas cuentas —crear una
// es barato— tendría techo `OCR_MAX × cuentas` desde una sola máquina.
const ocrLimiter = rateLimit({
  windowMs: OCR_WINDOW_MS,
  max: OCR_MAX,
  standardHeaders: true,
  legacyHeaders: false,
});

// Carril 2 · por USUARIO autenticado. Desde C6 el recurso que hay detrás es
// GLOBAL y agotable —`services/ocrDailyQuota.js`, 2000 documentos por día para
// todo PayMe—, y contra un recurso global un techo sólo por IP no alcanza:
// rotar IPs es barato, así que unas pocas manos podían drenar el día entero.
// Ninguno de los dos es suficiente solo; juntos acotan las dos formas de rotar.
//
// La clave se deriva EXCLUSIVAMENTE de `req.user.id`, con prefijo estable, tal
// como `routes/friends.js:69` y `routes/account.js:149`. Que dependa de una
// sola cosa es el punto: mezclarle la IP la volvería a hacer eludible rotando.
//
// ⚠️ Va montado DESPUÉS de `requireAuth` —igual que el carril de IP— porque
// `req.user` no existe antes.
const ocrUserLimiter = rateLimit({
  windowMs: OCR_WINDOW_MS,
  max: OCR_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `ocr:u:${req.user.id}`,
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
router.use(ocrUserLimiter);

router.post('/', parseImageUpload, async (req, res, next) => {
  try {
    if (!req.file) {
      const out = errorOcr('no_image');
      return res.status(out.status).json(out.body);
    }

    const magic = detectMagicBytes(req.file.buffer);
    if (!magic || !magicMatchesMime(magic, req.file.mimetype)) {
      logger.warn('ocr_magic_bytes_mismatch', {
        user_id: req.user.id,
        claimed_mime: req.file.mimetype,
        detected_magic: magic,
        size: req.file.size,
      });
      const out = errorOcr('invalid_image_type', {
        message: 'File content does not match declared image type',
      });
      return res.status(out.status).json(out.body);
    }

    logger.audit('ocr_request', {
      user_id: req.user.id, size_bytes: req.file.size,
      mime: req.file.mimetype, magic, mode: USE_REAL ? 'real' : 'mock',
    });

    // 🔴 En modo REAL, cortar acá lo que Textract no procesa (webp y heic).
    // NO cambia SI falla —hoy ya falla— sino CUÁNDO y con qué claridad: antes
    // la foto viajaba entera, pasaba magic bytes y moría al final con un
    // `provider_error` genérico, indistinguible de una caída de AWS.
    //
    // ⚠️ El código es PROPIO a propósito: el front tiene que poder decirle a la
    // persona «esa foto está en un formato que no podemos leer» en vez de
    // «falló el servicio». Y se publica la lista en /api/config para que arme
    // su `accept` desde el dueño del contrato.
    //
    // En modo MOCK se siguen aceptando los cuatro: apretarlo antes de que
    // exista la decisión de producto rompería la demo para todos los iPhone
    // —HEIC es su formato por defecto— que es justo la prueba que está por
    // abrirse.
    if (USE_REAL && !proveedorSoporta(req.file.mimetype)) {
      logger.warn('ocr_unsupported_for_provider', {
        user_id: req.user.id, mime: req.file.mimetype, magic,
      });
      const out = errorOcr('unsupported_image_type_for_provider', {
        provider_mime_types: [...MIME_PROVEEDOR],
        message: 'El proveedor de lectura no procesa este formato de imagen.',
      });
      return res.status(out.status).json(out.body);
    }

    if (USE_REAL) {
      // v2.19 (D5): Textract. Política del acta ante fallo del proveedor:
      // devolver lo utilizable (acá: nada + warning) para que el usuario
      // edite a mano — el flujo de dividir la cuenta NUNCA se rompe por OCR.
      try {
        const result = await ocrTextract.analyzeExpense(req.file.buffer);
        return res.json(respuestaOcr(result, { mock: false }));
      } catch (e) {
        // 🔴 C6 · la cuota agotada es un RECHAZO deliberado, no una caída del
        // proveedor. Degradarla a 200 `provider_error` le diría a la persona
        // «no pudimos leer el ticket, editá a mano» cuando la verdad es «hoy ya
        // no leemos más» — y dejaría al front sin forma de distinguir un
        // problema pasajero de un techo alcanzado. Va por el mapa contractual
        // cerrado, como todos los demás errores de esta ruta.
        if (e && e.code === 'ocr_daily_quota_exhausted') {
          // Sin `user_id`: el rechazo por cuota no necesita saber quién lo pidió.
          logger.warn('ocr_daily_quota_rejected', {});
          const out = errorOcr('ocr_daily_quota_exhausted');
          return res.status(out.status).json(out.body);
        }
        // Todo lo demás —incluida una base que no responde— conserva la política
        // ratificada en D5: el flujo de dividir la cuenta NUNCA se rompe por
        // OCR. Lo que C6 garantiza en ese caso es que NO hubo llamada a AWS,
        // porque la reserva lanza antes de cargar el SDK.
        logger.error('ocr_provider_error', { user_id: req.user.id, error: e.message });
        return res.json(respuestaProveedorNoDisponible());
      }
    }

    const items = matching.parseTicket(mockTicketText());
    res.json(respuestaOcr({
      items,
      total_cents: items.reduce((s, i) => s + i.price_cents * i.quantity, 0),
      warnings: [],
    }, { mock: true }));
  } catch (err) {
    if (err.message === 'invalid_image_type') {
      const out = errorOcr('invalid_image_type');
      return res.status(out.status).json(out.body);
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
