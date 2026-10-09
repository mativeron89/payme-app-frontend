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
 *
 * 🔴 Con `features.viajes.enabled` en false (V1: hasta que Mati apruebe el Aviso), el router no existe: cualquier
 * pedido sigue al 404 de siempre de la app, también sin sesión. La lógica y las respuestas están en
 * services/viajes.js; el contrato, en contract/viajes-v1.json.
 */
'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../middleware/auth');
const viajes = require('../services/viajes');

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

const escribir = (res, { status, body }) => res.status(status).json(body);
// v2.172.0 · D245: `viaje_version=2`, la cadena exacta (un valor repetido llega como lista y no negocia).
const version = (req) => ({ version: req.query.viaje_version === '2' ? 2 : 1 });
const ruta = (fn) => async (req, res, next) => {
  try {
    escribir(res, await fn(req));
  } catch (err) { next(err); }
};

router.get('/', ruta((req) => viajes.listar(req.user.id, req.query)));
router.post('/', invitarLimiter, ruta((req) => viajes.crear(req.user.id, req.body, version(req))));
router.get('/invitaciones', ruta((req) => viajes.invitaciones(req.user.id)));
router.get('/:id', ruta((req) => viajes.detalle(req.user.id, req.params.id, version(req))));
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
router.get('/:id/cierre', ruta((req) => viajes.vistaPreviaCierre(req.user.id, req.params.id)));
router.post('/:id/cerrar', ruta((req) => viajes.cerrar(req.user.id, req.params.id, version(req))));
router.post('/:id/transferencias/:trid/:accion(pague|deshacer|recibi|no-llego)',
  ruta((req) => viajes.marcarTransferencia(req.user.id, req.params.id, req.params.trid, req.params.accion)));
router.get('/:id/resumen', ruta((req) => viajes.resumen(req.user.id, req.params.id)));

module.exports = router;
