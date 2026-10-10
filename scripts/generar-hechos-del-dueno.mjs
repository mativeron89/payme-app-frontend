#!/usr/bin/env node
/**
 * D268 · S-03 · los HECHOS DEL DUEÑO, generados SÓLO EN LOCAL.
 *
 * El repo del front es público y el espejo ya no copia el código del servidor
 * (sólo `contract/*.json`). Lo que las pruebas del front leían de ese código
 * —rutas, tipos, enums, tablas— y las dos que lo EJECUTABAN (la identidad del
 * pago y los ingredientes) pasan a comparar contra este archivo:
 * `scripts/hechos-del-dueno.json`.
 *
 * - Lee el repo del dueño (`PAYME_APP_BACKEND_DIR` o `../../payme-app-backend`)
 *   EN EL COMMIT DEL INVENTARIO, con `git show`. Cada archivo leído tiene que
 *   tener el sha256 que el inventario declara: si no, no genera nada.
 * - Guarda sólo SALIDAS: booleanos («el dueño declara tal ruta»), números,
 *   listas y las salidas de su código sobre las entradas sintéticas de
 *   `corpusDeHechos.ts`. Ni código, ni secretos, ni datos reales.
 * - Cada fuente con su sha256: `verificar-mirror.mjs --integridad` (el CI)
 *   exige que sea el del inventario. Si el dueño cambia uno de estos archivos,
 *   el CI queda rojo hasta volver a correr esto.
 *
 * 🔴 NUNCA en el CI: necesita el repo del dueño y ejecuta su código.
 *
 * Uso: node scripts/generar-hechos-del-dueno.mjs   (escribe el archivo)
 *      node scripts/generar-hechos-del-dueno.mjs --comprobar   (no escribe: falla si difiere)
 * Exit: 0 ok · 1 difiere o el dueño no respalda el inventario · 2 sin fuente.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CORPUS_IDENTIDAD,
  FRACCIONES_MITADES,
  GRUPO_DE_PLATO,
  RESTAURANTES_INGREDIENTES,
  VERSIONES_MESA_PAY,
} from './corpusDeHechos.ts';

const AQUI = dirname(fileURLToPath(import.meta.url));
const INVENTARIO = join(AQUI, 'mirror-inventory.json');
const SALIDA = join(AQUI, 'hechos-del-dueno.json');
const FUENTE = process.env.PAYME_APP_BACKEND_DIR
  ? resolve(process.env.PAYME_APP_BACKEND_DIR)
  : resolve(AQUI, '..', '..', 'payme-app-backend');

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
function morir(codigo, mensaje) {
  console.error(mensaje);
  process.exit(codigo);
}

if (!existsSync(join(FUENTE, '.git'))) morir(2, `SIN FUENTE: no hay repo git del dueño en ${FUENTE}. Esto corre sólo en local.`);
const inv = JSON.parse(readFileSync(INVENTARIO, 'utf8'));
const porOrigen = new Map(inv.archivos.map((a) => [a.origen, a.sha256]));
const fuentes = {};

/** El texto de un archivo del dueño en el commit del inventario, con su sha verificado. */
function delDueno(origen) {
  if (!porOrigen.has(origen)) morir(1, `${origen} no está en el inventario: no se generan hechos de lo que no se inventaría.`);
  let blob;
  try {
    blob = execFileSync('git', ['-C', FUENTE, 'show', `${inv.commit}:${origen}`], { maxBuffer: 64 * 1024 * 1024 });
  } catch {
    morir(2, `SIN FUENTE: ${origen} no está en ${inv.commit.slice(0, 7)} del dueño.`);
  }
  if (sha256(blob) !== porOrigen.get(origen)) morir(1, `INVENTARIO INFIEL: ${origen} no tiene en ${inv.commit.slice(0, 7)} el sha256 declarado.`);
  fuentes[origen] = porOrigen.get(origen);
  return blob.toString('utf8');
}

const hechos = {};
const hecho = (clave, origen, valor) => { hechos[clave] = { origen, valor }; };
const consta = (texto, aguja) => (aguja instanceof RegExp ? aguja.test(texto) : texto.includes(aguja));
const lista = (bloque) => [...bloque.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();

// ─── Avisos (E174) ────────────────────────────────────────────────────────────
{
  const o = 'routes/notifications.js';
  const t = delDueno(o);
  hecho('avisos.borrar_todos.ruta', o, consta(t, "router.delete('/', async"));
  hecho('avisos.borrar_todos.responde_deleted_count', o, consta(t, 'res.json({ deleted_count: count });'));
  hecho('avisos.borrar_uno.ruta', o, consta(t, "router.delete('/:id', async"));
  hecho('avisos.borrar_uno.responde_deleted_true', o, consta(t, 'res.json({ deleted: true });'));
  hecho('avisos.borrar_uno.404_notification_not_found', o, consta(t, "res.status(404).json({ error: 'notification_not_found' })"));
  hecho('avisos.leido.ruta', o, consta(t, /router\.patch\('\/:id\/read'/));
  hecho('avisos.leido.404_notification_not_found_or_already_read', o, consta(t, 'notification_not_found_or_already_read'));
  hecho('avisos.foto_del_invitador.ruta', o, consta(t, "router.get('/:id/inviter-avatar', async"));
  hecho('avisos.foto_del_invitador.no_store', o, consta(t, "res.setHeader('Cache-Control', 'private, no-store');"));
  hecho('avisos.foto_del_invitador.vary_authorization', o, consta(t, "res.vary('Authorization');"));
  hecho('avisos.foto_del_invitador.404_avatar_not_found', o, consta(t, "JSON.stringify({ error: 'avatar_not_found' })"));
}
{
  const o = 'routes/friends.js';
  hecho('amigos.has_avatar_con_la_foto', o, consta(delDueno(o), 'has_avatar: conFoto.has(f.id),'));
}
{
  const o = 'routes/invitations.js';
  const t = delDueno(o);
  hecho('invitaciones.lista.has_inviter_avatar', o, consta(t, 'has_inviter_avatar: conFoto[i],'));
  hecho('invitaciones.foto_del_invitador.ruta', o, consta(t, "router.get('/:id/inviter-avatar', async"));
  hecho('invitaciones.foto_del_invitador.no_store', o, consta(t, "res.setHeader('Cache-Control', 'private, no-store');"));
  hecho('invitaciones.foto_del_invitador.vary_authorization', o, consta(t, "res.vary('Authorization');"));
  hecho('invitaciones.foto_del_invitador.404_avatar_not_found', o, consta(t, "JSON.stringify({ error: 'avatar_not_found' })"));
}
{
  const o = 'services/invitationAuthority.js';
  const t = delDueno(o);
  hecho('invitaciones.aviso.has_inviter_avatar', o, consta(t, 'has_inviter_avatar: hasInviterAvatar,'));
  hecho('invitaciones.resolveLinkToken.declara_segunda_copia', o, consta(t, 'SEGUNDA COPIA'));
  hecho('invitaciones.alias_legacy.salta_a_la_canonica', o, consta(t, 'COALESCE(source.superseded_by_id, source.id)'));
  hecho('invitaciones.alias_legacy.exige_fuente_vigente', o, consta(t, 'source.expires_at > NOW()'));
  hecho('invitaciones.alias_legacy.exige_canonica_vigente', o, consta(t, 'canonical.expires_at > NOW()'));
}

// ─── OCR ──────────────────────────────────────────────────────────────────────
{
  const o = 'routes/ocr.js';
  const t = delDueno(o);
  hecho('ocr.multipart_con_multer', o, consta(t, 'multer'));
  const m = /limits:\s*\{\s*fileSize:\s*(\d+)\s*\*\s*(\d+)\s*\*\s*(\d+)\s*\}/.exec(t);
  hecho('ocr.tope_de_imagen_bytes', o, m ? Number(m[1]) * Number(m[2]) * Number(m[3]) : null);
  hecho('ocr.rechaza_con_image_too_large', o, consta(t, "errorOcr('image_too_large')"));
}
{
  const o = 'services/ocrResponseContract.js';
  const m = /image_too_large:\s*(\d+)/.exec(delDueno(o));
  hecho('ocr.image_too_large.status', o, m ? Number(m[1]) : null);
}

// ─── El riel saldo (durmiente) ────────────────────────────────────────────────
{
  const o = 'routes/config.js';
  const bloque = /const WALLET_RAIL = Object\.freeze\(\{([\s\S]*?)\}\);/.exec(delDueno(o));
  const literales = {};
  if (bloque) for (const m of bloque[1].matchAll(/(\w+):\s*(true|false)/g)) literales[m[1]] = m[2] === 'true';
  hecho('riel.config.literales', o, bloque ? literales : null);
  hecho('riel.config.enabled_por_la_capacidad', o, bloque ? /enabled:\s*walletRailCapability\(\)/.test(bloque[1]) : null);
}
{
  const o = 'services/walletRail.js';
  const m = /const RIEL_HABILITADO = (true|false);/.exec(delDueno(o));
  hecho('riel.habilitado', o, m ? m[1] === 'true' : null);
}
{
  const o = 'services/notifications.js';
  const m = /const WALLET_RAIL_TYPES = new Set\(\[([\s\S]*?)\]\)/.exec(delDueno(o));
  hecho('riel.tipos_de_avisos', o, m ? lista(m[1]) : null);
}

// ─── La mesa ──────────────────────────────────────────────────────────────────
{
  const o = 'schemas/index.js';
  const t = delDueno(o);
  const m = t.match(/division_mode:\s*z\.enum\(\[([^\]]*)\]\)/);
  hecho('mesa.division_mode', o, m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort() : null);
  // Se mira LA LÍNEA DEL REFINE, no el archivo: el comentario del dueño cita el piso viejo.
  const refine = t.match(/\}\)\.refine\(d => d\.division_mode[^\n]*/)?.[0] ?? null;
  hecho('mesa.refine.encontrado', o, refine !== null);
  hecho('mesa.refine.exige_expected_participants', o, refine !== null && /expected_participants\s*!==\s*undefined/.test(refine));
  hecho('mesa.refine.sin_piso_de_dos', o, refine !== null && !/>=\s*2/.test(refine));
  hecho('mesa.expected_participants_minimo_uno', o, /expected_participants:\s*safeInt\.min\(1\)/.test(t));
}
{
  const o = 'utils/stateMachine.js';
  const bloque = /\bmesa:\s*\{([\s\S]*?)\n\s{2}\}/.exec(delDueno(o));
  hecho('mesa.estados_de_la_fsm', o, bloque ? [...new Set([...bloque[1].matchAll(/^\s{4}([a-z_]+):\s*\[/gm)].map((m) => m[1]))].sort() : null);
}
{
  const o = 'routes/mesas.js';
  const t = delDueno(o);
  const grupos = [
    ['CREACION_REQUIERE_ACCION', 'requires_action'],
    ['CREACION_ABIERTA', 'open'],
    ['CREACION_PARCIAL', 'partially_paid'],
    ['CREACION_TERMINAL', 'terminal'],
    ['CREACION_REPLAYABLE', 'replayable'],
  ];
  const clasificacion = {};
  let completa = true;
  for (const [constante, outcome] of grupos) {
    const b = new RegExp(`const ${constante}\\s*=\\s*Object\\.freeze\\(\\[([\\s\\S]*?)\\]\\)`).exec(t);
    if (!b) { completa = false; continue; }
    for (const e of [...b[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])) clasificacion[e] = outcome;
  }
  hecho('mesa.clasificacion_de_la_creacion', o, completa ? clasificacion : null);
}

// ─── Estadísticas · «Qué comes» por ingredientes (EJECUTA código del dueño) ───
{
  const o = 'routes/account.js';
  const t = delDueno(o);
  const extraer = (nombre) => {
    const inicio = t.indexOf(`function ${nombre}(`);
    if (inicio < 0) morir(1, `no está ${nombre} en ${o}`);
    let i = t.indexOf('{', t.indexOf(')', inicio));
    for (let nivel = 0; i < t.length; i += 1) {
      if (t[i] === '{') nivel += 1;
      if (t[i] === '}') { nivel -= 1; if (nivel === 0) return t.slice(inicio, i + 1); }
    }
    return morir(1, `${nombre} sin cerrar en ${o}`);
  };
  const clasificadorPlatos = { VERSION: '1', clasificar: (n) => GRUPO_DE_PLATO[n.trim().toLowerCase()] ?? 'other' };
  // eslint-disable-next-line no-new-func
  const armarIngredientes = new Function('clasificadorPlatos', `${extraer('normalizarPlato')}\n${extraer('armarIngredientes')}\nreturn armarIngredientes;`)(clasificadorPlatos);
  hecho('estadisticas.ingredientes.salida', o, armarIngredientes(RESTAURANTES_INGREDIENTES));
}

// ─── La identidad del pago (EJECUTA código del dueño) ─────────────────────────
{
  const o = 'utils/idempotency.js';
  const t = delDueno(o);
  const dir = mkdtempSync(join(tmpdir(), 'payme-hechos-idem-'));
  try {
    const archivo = join(dir, 'idempotency.cjs');
    writeFileSync(archivo, t);
    const idem = createRequire(import.meta.url)(archivo);
    const keep = [...idem.PAYLOAD_KEYS.create_mesa];
    hecho('identidad.payload_keys', o, idem.PAYLOAD_KEYS);
    hecho('identidad.contrato', o, idem.IDEMPOTENCY_IDENTITY_CONTRACT);
    hecho('identidad.create_mesa.hash_por_caso', o, Object.fromEntries(CORPUS_IDENTIDAD.map((c) => [c.nombre, idem.payloadHash(c.payload, { keep })])));
    hecho('identidad.fracciones_mitades.hash_de_items', o, idem.payloadHash(FRACCIONES_MITADES, { keep: ['items'] }));
    hecho('identidad.mesa_pay.claves_por_version', o, Object.fromEntries(VERSIONES_MESA_PAY.map((v) => [
      v === null ? 'ausente' : String(v),
      v === null ? idem.payloadKeysForHashVersion('mesa_pay') : idem.payloadKeysForHashVersion('mesa_pay', v),
    ])));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const orden = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
const salida = {
  _comentario: 'GENERADO por scripts/generar-hechos-del-dueno.mjs, SÓLO EN LOCAL, con el repo del dueño en el commit del inventario. No se edita a mano. D268.',
  version: 1,
  commit: inv.commit,
  fuentes: orden(fuentes),
  hechos: orden(hechos),
};
const texto = `${JSON.stringify(salida, null, 2)}\n`;

if (process.argv[2] === '--comprobar') {
  const actual = existsSync(SALIDA) ? readFileSync(SALIDA, 'utf8') : '';
  if (actual !== texto) morir(1, '── LOS HECHOS DEL DUEÑO DIFIEREN de lo que da su código hoy: regenerarlos.');
  console.log(`── hechos del dueño al día: ${Object.keys(hechos).length} hechos de ${Object.keys(fuentes).length} archivos, commit ${inv.commit.slice(0, 7)}.`);
  process.exit(0);
}
writeFileSync(SALIDA, texto);
console.log(`── hechos del dueño escritos: ${Object.keys(hechos).length} hechos de ${Object.keys(fuentes).length} archivos, commit ${inv.commit.slice(0, 7)}.`);
