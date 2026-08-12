/**
 * services/ocrRail.js — modo del OCR y qué formatos acepta de verdad
 *
 * ─── LOS DOS DEFECTOS QUE CIERRA (2026-08-10) ───────────────────────────────
 *
 * 🔴 1 · EL FLAG DEGRADABA EN SILENCIO. `routes/ocr.js` leía
 * `process.env.OCR_FEATURE_FLAG === 'real'`, así que `Real`, `REAL`, `true`,
 * `1` o un typo caían a mock **sin avisar**. El síntoma no sería un error: sería
 * que los tickets se leen mal, porque el mock inventa datos — y nadie iría a
 * mirar la variable de entorno. Ahora el valor se parsea ESTRICTO y un valor no
 * reconocible impide el ARRANQUE (`middleware/envValidation.js`).
 *
 * 🔴 2 · EL BACKEND ACEPTABA FORMATOS QUE EL PROVEEDOR NO PROCESA.
 *
 *     routes/ocr.js aceptaba   jpeg · png · webp · heic
 *     AnalyzeExpense procesa   JPEG · PNG · PDF · TIFF
 *
 * O sea que un `webp` o un `heic` —que es **el formato por defecto del
 * iPhone**— viajaba entero, pasaba la validación de magic bytes y recién moría
 * en Textract, al final del camino, con un error de proveedor genérico.
 *
 * ─── QUÉ SE DECIDE ACÁ Y QUÉ NO ─────────────────────────────────────────────
 *
 * ⚠️ **Este módulo NO decide qué hace el producto con el HEIC del iPhone.** Esa
 * elección —rechazar en el front, convertir en el servidor, o sacar `heic` del
 * `accept` para que iOS convierta solo— es de producto, cambia la experiencia y
 * está abierta. Lo que hace este módulo es DOS cosas que son ciertas en las tres
 * salidas:
 *
 *   · PUBLICAR la lista real del proveedor, para que el front la lea del dueño
 *     del contrato en vez de hardcodear un `accept` que ya se desincronizó una
 *     vez;
 *   · en modo REAL, rechazar temprano y con un código PROPIO
 *     (`unsupported_image_type_for_provider`) lo que el proveedor no va a poder
 *     leer. **No cambia SI falla —hoy ya falla— sino CUÁNDO y con qué claridad.**
 *
 * 🔴 En modo MOCK se siguen aceptando los cuatro, a propósito: apretar el mock
 * antes de que exista la decisión rompería la demo para todos los iPhone, que
 * es justo la prueba que está por abrirse.
 */
'use strict';

const { valorEstricto } = require('../utils/flags');

const MODOS = Object.freeze(['mock', 'real']);

/**
 * Formatos de imagen que Amazon Textract `AnalyzeExpense` procesa de verdad.
 * PDF y TIFF también, pero esta ruta sube imágenes de cámara y no los acepta.
 */
const MIME_PROVEEDOR = Object.freeze(['image/jpeg', 'image/png']);

/** Lo que la ruta acepta subir hoy. Superset del proveedor; ver el header. */
const MIME_ACEPTADOS = Object.freeze([
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic',
]);

/** 'mock' | 'real'. Estricto: un valor no reconocible LANZA, no degrada. */
function modoOcr(env = process.env) {
  return valorEstricto('OCR_FEATURE_FLAG', MODOS, 'mock', env);
}

function ocrRealHabilitado(env = process.env) {
  return modoOcr(env) === 'real';
}

/** ¿Este mimetype lo puede leer el proveedor real? */
function proveedorSoporta(mimetype) {
  const m = mimetype === 'image/jpg' ? 'image/jpeg' : mimetype;
  return MIME_PROVEEDOR.includes(m);
}

/**
 * Lo que publica `/api/config`.
 *
 * 🔴 `credentials_present` dice EXACTAMENTE lo que mide: que las tres variables
 * de AWS están definidas. **NO acredita que la clave sea válida, que el rol
 * tenga permiso de Textract, que la región sea la correcta ni que haya salida a
 * internet.** Eso sólo lo prueba un escaneo real, y publicarlo como si fuera
 * "el OCR funciona" sería la misma mentira por omisión que un `/ready` que sólo
 * mira que el proceso esté vivo.
 */
function ocrCapability(env = process.env) {
  const mode = modoOcr(env);
  return {
    mode,
    credentials_present: !!(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY && env.AWS_REGION),
    // Para que el front construya su `accept` desde el DUEÑO del contrato y no
    // de una lista escrita a mano que ya se desincronizó una vez.
    accepted_mime_types: [...MIME_ACEPTADOS],
    provider_mime_types: [...MIME_PROVEEDOR],
  };
}

module.exports = {
  MODOS,
  MIME_PROVEEDOR,
  MIME_ACEPTADOS,
  modoOcr,
  ocrRealHabilitado,
  proveedorSoporta,
  ocrCapability,
};
