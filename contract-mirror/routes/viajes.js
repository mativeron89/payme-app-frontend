/**
 * routes/viajes.js — v2.171.0 · AB-VIAJES · los gastos compartidos de un viaje (decisión 242 de Mati).
 *
 *   GET  /api/viajes?estado=abiertos|cerrados                     → los míos, con los contadores
 *   POST /api/viajes                                              → crear (nombre, fechas, miembros, clave)
 *   GET  /api/viajes/invitaciones                                 → las invitaciones pendientes
 *   GET  /api/viajes/:id                                          → el detalle (balance en vivo incluido)
 *   POST /api/viajes/:id/miembros                                 → invitar desde Amigos o por @usuario
 *   POST /api/viajes/:id/aceptar | /rechazar | /salir
 *   POST /api/viajes/:id/tickets/check                            → ¿este escaneo ya está en el viaje?
 *   POST /api/viajes/:id/tickets                                  → cargar un ticket (quien carga, pagó)
 *   GET  /api/viajes/:id/tickets/:tid
 *   PUT  /api/viajes/:id/tickets/:tid/seleccion                   → lo que consumí
 *   PUT  /api/viajes/:id/tickets/:tid/presentes                   → partes iguales: quién estuvo
 *   GET  /api/viajes/:id/cierre                                   → la hoja de cierre, antes de cerrar
 *   POST /api/viajes/:id/cerrar
 *   POST /api/viajes/:id/transferencias/:trid/pague|deshacer|recibi|no-llego
 *   GET  /api/viajes/:id/resumen                                  → Cerrados: sólo lo propio
 *   POST /api/viajes/:id/gastos                                   → v2.172.0 · D244: un gasto a mano
 *   GET  /api/viajes/:id/miembros/:mid/avatar                     → v2.172.0 · D245: la foto de un miembro (n164)
 *   `viaje_version=2` en las rutas que devuelven `viaje`           → v2.172.0 · D245: foto, lo que pagó y consumos
 *   PATCH /api/viajes/:id                                         → v2.174.0 · D255: nombre, fechas y color
 *   PUT | DELETE | GET /api/viajes/:id/foto                       → v2.174.0 · D255: la foto del viaje (sólo miembros)
 *   `viaje_version=3` (también en la lista)                       → v2.174.0 · D255: color y has_photo
 *   DELETE /api/viajes/:id/tickets/:tid                           → v2.175.0 · D256: eliminar un ticket o un gasto
 *   `viaje_version=4`                                             → v2.175.0 · D256: puede_eliminar por ticket
 *
 * 🔴 Con `features.viajes.enabled` en false (V1: hasta que Mati apruebe el Aviso), el router no existe: cualquier
 * pedido sigue al 404 de siempre de la app, también sin sesión. La lógica y las respuestas están en
 * services/viajes.js; el contrato, en contract/viajes-v1.json.
 */
'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const { requireAuth } = require('../middleware/auth');
const viajes = require('../services/viajes');
// v2.174.0 · D255: la foto del viaje reutiliza, sin tocarlo, el procesamiento de la foto de perfil (los mismos límites,
// el mismo cupo de CPU por proceso y por cuenta).
const profileIdentity = require('../services/profileIdentity');

const router = express.Router();
router.use((req, res, next) => (viajes.habilitado() ? next() : next('router')));
router.use(requireAuth);

/**
 * Invitar (al crear o después) resuelve cuentas por @usuario: el mismo techo que la búsqueda por @ de hoy, por
 * cuenta. Constantes y no variables de entorno: la orden no admite variables nuevas.
 */
const invitarLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `viajes:invitar:${req.user.id}`,
  handler: (req, res) => res.status(429).json({ error: 'viajes_rate_limited' }),
});

// v2.174.0 · D255: la foto del viaje. Lo mismo que `PUT /api/account/me/avatar` (routes/account.js), copiado acá: el
// límite por cuenta, el cupo de procesamiento tomado ANTES de bufferizar, y multer en memoria con un solo archivo.
const fotoLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `viajes:foto:${req.user.id}`,
  handler: (req, res) => res.status(429).json({ error: 'viaje_photo_rate_limited' }),
});
const fotoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: profileIdentity.MAX_INPUT_BYTES, files: 1, fields: 0 },
});
function reservarCupoDeFoto(req, res, next) {
  let release;
  try {
    release = profileIdentity.acquireAvatarProcessingBudget(req.user.id);
  } catch (error) {
    if (error.status && typeof error.code === 'string') return res.status(error.status).json({ error: error.code });
    return next(error);
  }
  let released = false;
  const releaseOnce = () => {
    if (released) return;
    released = true;
    res.off('finish', releaseOnce);
    res.off('close', releaseOnce);
    req.off('aborted', releaseOnce);
    release();
  };
  res.once('finish', releaseOnce);
  res.once('close', releaseOnce);
  req.once('aborted', releaseOnce);
  next();
}
function unaFoto(req, res, next) {
  fotoUpload.single('foto')(req, res, (error) => {
    if (!error) return next();
    const muyGrande = error.code === 'LIMIT_FILE_SIZE';
    return res.status(muyGrande ? 413 : 400).json({ error: muyGrande ? 'avatar_input_too_large' : 'avatar_multipart_invalid' });
  });
}

const escribir = (res, { status, body }) => res.status(status).json(body);
// v2.172.0 · D245: `viaje_version=2`; v2.174.0 · D255: `viaje_version=3`; v2.175.0 · D256: `viaje_version=4`. La cadena
// exacta (un valor repetido llega como lista y no negocia).
const version = (req) => {
  const v = req.query.viaje_version;
  return { version: v === '4' ? 4 : v === '3' ? 3 : v === '2' ? 2 : 1 };
};
const ruta = (fn) => async (req, res, next) => {
  try {
    escribir(res, await fn(req));
  } catch (err) { next(err); }
};

router.get('/', ruta((req) => viajes.listar(req.user.id, req.query)));
router.post('/', invitarLimiter, ruta((req) => viajes.crear(req.user.id, req.body, version(req))));
router.get('/invitaciones', ruta((req) => viajes.invitaciones(req.user.id)));
router.get('/:id', ruta((req) => viajes.detalle(req.user.id, req.params.id, version(req))));
// v2.174.0 · D255: la configuración (cualquier miembro activo, con el viaje abierto).
router.patch('/:id', ruta((req) => viajes.actualizar(req.user.id, req.params.id, req.body, version(req))));
router.put('/:id/foto', fotoLimiter, reservarCupoDeFoto, unaFoto, async (req, res, next) => {
  try {
    // Primero quién pide (barato y sin decir nada a quien no es miembro); después, la imagen.
    const no = await viajes.puedoEditarFoto(req.user.id, req.params.id);
    if (no) return escribir(res, no);
    if (!req.file) return res.status(400).json({ error: 'avatar_file_required' });
    let image;
    try {
      image = await profileIdentity.procesarAvatar(req.file.buffer, req.file.mimetype);
    } catch (err) {
      if (err.status && typeof err.code === 'string') return res.status(err.status).json({ error: err.code });
      throw err;
    }
    return escribir(res, await viajes.guardarFoto(req.user.id, req.params.id, image));
  } catch (err) { return next(err); }
});
router.delete('/:id/foto', async (req, res, next) => {
  try {
    const r = await viajes.quitarFoto(req.user.id, req.params.id);
    return r.status === 204 ? res.status(204).end() : escribir(res, r);
  } catch (err) { return next(err); }
});
// La foto, sólo para miembros activos. Las cabeceras van antes de decidir y el 404 sale sin ETag: «no existe», «no sos
// miembro» y «sin foto» son la misma respuesta, byte por byte.
router.get('/:id/foto', async (req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store');
  res.vary('Authorization');
  try {
    const r = await viajes.fotoDelViaje(req.user.id, req.params.id);
    if (r.res) return res.status(r.res.status).type('application/json').end(JSON.stringify(r.res.body));
    res.type(r.foto.mimeType);
    res.setHeader('Content-Length', String(r.foto.bytes.length));
    return res.end(r.foto.bytes);
  } catch (err) { return next(err); }
});
router.post('/:id/miembros', invitarLimiter, ruta((req) => viajes.invitar(req.user.id, req.params.id, req.body, version(req))));
router.post('/:id/aceptar', ruta((req) => viajes.aceptar(req.user.id, req.params.id, version(req))));
router.post('/:id/rechazar', ruta((req) => viajes.rechazar(req.user.id, req.params.id)));
router.post('/:id/salir', ruta((req) => viajes.salir(req.user.id, req.params.id)));
router.post('/:id/tickets/check', ruta((req) => viajes.revisarTicket(req.user.id, req.params.id, req.body)));
router.post('/:id/tickets', ruta((req) => viajes.cargarTicket(req.user.id, req.params.id, req.body)));
// v2.172.0 · D244: el gasto a mano (descripción, monto y entre quiénes se reparte).
router.post('/:id/gastos', ruta((req) => viajes.cargarGasto(req.user.id, req.params.id, req.body)));
// v2.172.0 · D245: la foto de un miembro, con la regla n164. Sin URL pública; `private, no-store`.
router.get('/:id/miembros/:mid/avatar', async (req, res, next) => {
  try {
    const r = await viajes.avatarDeMiembro(req.user.id, req.params.id, req.params.mid);
    if (r.res) return escribir(res, r.res);
    res.setHeader('Cache-Control', 'private, no-store');
    res.type(r.avatar.mimeType);
    res.setHeader('Content-Length', String(r.avatar.bytes.length));
    return res.end(r.avatar.bytes);
  } catch (err) { return next(err); }
});
router.get('/:id/tickets/:tid', ruta((req) => viajes.verTicket(req.user.id, req.params.id, req.params.tid)));
router.put('/:id/tickets/:tid/seleccion',
  ruta((req) => viajes.elegir(req.user.id, req.params.id, req.params.tid, req.body)));
router.put('/:id/tickets/:tid/presentes',
  ruta((req) => viajes.marcarPresentes(req.user.id, req.params.id, req.params.tid, req.body)));
router.delete('/:id/tickets/:tid',
  ruta((req) => viajes.eliminarTicket(req.user.id, req.params.id, req.params.tid, version(req))));
router.get('/:id/cierre', ruta((req) => viajes.vistaPreviaCierre(req.user.id, req.params.id)));
router.post('/:id/cerrar', ruta((req) => viajes.cerrar(req.user.id, req.params.id, version(req))));
router.post('/:id/transferencias/:trid/:accion(pague|deshacer|recibi|no-llego)',
  ruta((req) => viajes.marcarTransferencia(req.user.id, req.params.id, req.params.trid, req.params.accion)));
router.get('/:id/resumen', ruta((req) => viajes.resumen(req.user.id, req.params.id)));

module.exports = router;
