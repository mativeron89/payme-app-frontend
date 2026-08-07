#!/usr/bin/env node
/**
 * GATE DEL contract-mirror · INTEGRIDAD · PARIDAD · VIGENCIA (ORDEN R3-A).
 *
 * ## Qué cambió y por qué, contra la versión anterior
 *
 * 1. **La población la declara EL DUEÑO.** Antes salía de un manifiesto que
 *    este repo generaba desde el propio espejo: el inventariado se inventariaba
 *    a sí mismo, así que una omisión coordinada —borrar un archivo y regenerar—
 *    pasaba en verde. Ahora se usa `scripts/mirror-inventory.json`, el artefacto
 *    que publica App Backend (`contract/mirror-inventory.json`), con su mapeo
 *    **`origen → destino` explícito**: siete de los 71 se espejan renombrados
 *    (`services/settlement.js` → `docs/settlement.js.ref`, `docs/history/*` →
 *    `docs/*`), y compararlos por convención daría "ausente" a archivos que sí
 *    están.
 * 2. **Adiós al `--generar-manifiesto`.** Bendecía el espejo tal como estuviera,
 *    sin mirar la fuente. Su reemplazo, `--adoptar-inventario`, copia el
 *    inventario del dueño **sólo después de verificar contra la fuente**: nunca
 *    se bendice lo que no se verificó.
 * 3. **Paths COMPLETOS, no subcadenas.** El chequeo de intruso usaba
 *    `grep -F "  $rel"`, anclado sólo por la izquierda: un archivo cuyo path era
 *    PREFIJO de otro (`routes/auth` frente a `routes/auth.js`) pasaba como
 *    inventariado. Acá la pertenencia es una comparación exacta contra un `Set`;
 *    la clase de defecto no existe, en vez de estar tapada.
 * 4. **INTEGRIDAD y VIGENCIA son preguntas distintas** — lección del dueño, que
 *    la pagó primero: su `--check` gritaba con cada commit posterior aunque
 *    ningún archivo del contrato hubiera cambiado, *"y un gate que grita por lo
 *    que no es un desvío se termina ignorando"*. Que el HEAD avance no es un
 *    desvío; que cambie lo espejado, sí.
 *
 * ## Los modos
 *
 *   --integridad   (sin fuente) El espejo es fiel al INVENTARIO: cada `destino`
 *                  existe con su sha256, no hay intrusos, y el total coincide.
 *                  Es lo único verificable en CI, donde no está el repo hermano.
 *                  🔴 NO es paridad y no se llama paridad: no acredita que el
 *                  inventario describa al backend, sólo que el espejo describe
 *                  al inventario.
 *   --paridad      (default) Integridad + FUENTE: el commit que el inventario
 *                  declara existe en el repo hermano y **cada `origen` en ESE
 *                  commit tiene el sha256 declarado** (o sea: el inventario no
 *                  fue editado a mano). Sin fuente → NO CERTIFICADO, jamás verde.
 *   --vigencia     Paridad + ¿el contenido sigue igual en el HEAD del hermano?
 *                  Si cambió, el espejo quedó VIEJO — se lista qué cambió. Es
 *                  informativo de otra cosa: no ensucia la paridad.
 *   --adoptar-inventario <ruta>
 *                  Reemplaza el inventario local por el del dueño y verifica
 *                  paridad ACTO SEGUIDO. Si la verificación falla, no adopta.
 *
 * Exit: 0 verificado · 1 desvío real · 2 NO CERTIFICADO (no se pudo verificar).
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const ESPEJO = resolve(AQUI, '..', 'contract-mirror');
const INVENTARIO = join(AQUI, 'mirror-inventory.json');
/** Relativa al workspace, no absoluta a una máquina. Overridable para tests. */
const FUENTE = process.env.PAYME_APP_BACKEND_DIR
  ? resolve(process.env.PAYME_APP_BACKEND_DIR)
  : resolve(AQUI, '..', '..', 'payme-app-backend');

/** El README es PROCEDENCIA, no contrato: se documenta a mano y no se inventaría. */
const FUERA_DEL_INVENTARIO = new Set(['README.md']);

const EXIT_OK = 0;
const EXIT_DESVIO = 1;
const EXIT_NO_CERTIFICADO = 2;

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function morir(codigo, mensaje) {
  console.error(mensaje);
  process.exit(codigo);
}

function leerInventario(ruta) {
  if (!existsSync(ruta)) {
    morir(EXIT_NO_CERTIFICADO, `SIN INVENTARIO: no existe ${ruta} — no hay población contra la que verificar.`);
  }
  let inv;
  try {
    inv = JSON.parse(readFileSync(ruta, 'utf8'));
  } catch (e) {
    morir(EXIT_NO_CERTIFICADO, `INVENTARIO ILEGIBLE: ${ruta} no es JSON válido (${e.message}).`);
  }
  const ok =
    inv && typeof inv.commit === 'string' && /^[0-9a-f]{40}$/.test(inv.commit) &&
    Number.isInteger(inv.total) && Array.isArray(inv.archivos) &&
    inv.archivos.every(
      (a) => a && typeof a.origen === 'string' && typeof a.destino === 'string' &&
        typeof a.sha256 === 'string' && /^[0-9a-f]{64}$/.test(a.sha256),
    );
  if (!ok) {
    morir(EXIT_NO_CERTIFICADO, 'INVENTARIO MAL FORMADO: se esperaba { commit: <40 hex>, total, archivos: [{origen, destino, sha256}] }.');
  }
  if (inv.archivos.length !== inv.total) {
    morir(EXIT_DESVIO, `INVENTARIO INCONSISTENTE: declara total ${inv.total} y trae ${inv.archivos.length} entradas.`);
  }
  return inv;
}

/** Todos los archivos del espejo, con path relativo COMPLETO. */
function poblacionDelEspejo(dir = ESPEJO, base = ESPEJO) {
  const salida = [];
  for (const nombre of readdirSync(dir)) {
    const abs = join(dir, nombre);
    if (statSync(abs).isDirectory()) salida.push(...poblacionDelEspejo(abs, base));
    else {
      const rel = relative(base, abs);
      if (!FUERA_DEL_INVENTARIO.has(rel)) salida.push(rel);
    }
  }
  return salida.sort();
}

/**
 * INTEGRIDAD: el espejo es fiel al inventario. Las dos direcciones —lo que
 * falta y lo que sobra— con comparación de path EXACTA (`Set`), nunca por
 * prefijo ni subcadena.
 */
function verificarIntegridad(inv) {
  const problemas = [];
  const declarados = new Set(inv.archivos.map((a) => a.destino));

  for (const a of inv.archivos) {
    const abs = join(ESPEJO, a.destino);
    if (!existsSync(abs)) {
      problemas.push(`FALTA EN EL ESPEJO: ${a.destino}`);
      continue;
    }
    const real = sha256(readFileSync(abs));
    if (real !== a.sha256) problemas.push(`CONTENIDO DISTINTO DEL INVENTARIO: ${a.destino}`);
  }
  for (const rel of poblacionDelEspejo()) {
    if (!declarados.has(rel)) problemas.push(`INTRUSO (no está en el inventario del dueño): ${rel}`);
  }
  return problemas;
}

function gitDisponible() {
  return existsSync(join(FUENTE, '.git'));
}

function blobEn(commit, ruta) {
  try {
    return execFileSync('git', ['-C', FUENTE, 'show', `${commit}:${ruta}`], {
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

/**
 * PARIDAD: la fuente respalda al inventario. Se verifica que cada `origen`
 * tenga, EN EL COMMIT QUE EL INVENTARIO DECLARA, exactamente el sha256
 * declarado — o sea que nadie editó el inventario a mano. Sin fuente no se
 * aprueba: se declara NO CERTIFICADO.
 */
function verificarParidad(inv) {
  if (!gitDisponible()) {
    morir(
      EXIT_NO_CERTIFICADO,
      `NO CERTIFICADO: no hay repo git en ${FUENTE}. La ausencia de fuente NO es paridad — usá --integridad y llamalo por su nombre.`,
    );
  }
  try {
    execFileSync('git', ['-C', FUENTE, 'cat-file', '-e', `${inv.commit}^{commit}`], { stdio: 'pipe' });
  } catch {
    morir(EXIT_NO_CERTIFICADO, `NO CERTIFICADO: el commit declarado ${inv.commit} no existe en ${FUENTE}.`);
  }
  const problemas = [];
  for (const a of inv.archivos) {
    const blob = blobEn(inv.commit, a.origen);
    if (blob === null) {
      problemas.push(`SIN FUENTE EN ${inv.commit.slice(0, 7)}: ${a.origen} (→ ${a.destino})`);
      continue;
    }
    if (sha256(blob) !== a.sha256) {
      problemas.push(`INVENTARIO INFIEL A SU COMMIT: ${a.origen} no tiene el sha256 declarado`);
    }
  }
  return problemas;
}

/**
 * VIGENCIA: ¿el contenido sigue igual en HEAD? Pregunta SEPARADA a propósito.
 * Que el hash del hermano avance no es un desvío del espejo — sólo importa si
 * cambió lo espejado. Fundirlas hacía que el gate gritara siempre y, entonces,
 * que nadie lo mirara.
 */
function verificarVigencia(inv) {
  const cambiados = [];
  for (const a of inv.archivos) {
    const blob = blobEn('HEAD', a.origen);
    if (blob === null) cambiados.push(`${a.origen} ya no existe en HEAD`);
    else if (sha256(blob) !== a.sha256) cambiados.push(a.origen);
  }
  return cambiados;
}

// ─── main ─────────────────────────────────────────────────────────────────────
const modo = process.argv[2] ?? '--paridad';

if (modo === '--adoptar-inventario') {
  const origen = process.argv[3];
  if (!origen || !existsSync(origen)) {
    morir(EXIT_NO_CERTIFICADO, 'ADOPCIÓN: falta la ruta del inventario del dueño. Uso: --adoptar-inventario <ruta>');
  }
  // Se verifica ANTES de escribir: el reemplazado bendecía el espejo tal como
  // estuviera, y así una omisión coordinada quedaba verde para siempre.
  const candidato = leerInventario(origen);
  const problemas = [...verificarIntegridad(candidato), ...verificarParidad(candidato)];
  if (problemas.length > 0) {
    for (const p of problemas) console.error(p);
    morir(EXIT_DESVIO, '── NO SE ADOPTA: el inventario candidato no verifica contra el espejo y la fuente.');
  }
  writeFileSync(INVENTARIO, readFileSync(origen));
  console.log(`── inventario adoptado y verificado: ${candidato.total} archivos · commit ${candidato.commit.slice(0, 7)}`);
  process.exit(EXIT_OK);
}

const inv = leerInventario(INVENTARIO);
const problemas = verificarIntegridad(inv);

if (modo === '--integridad') {
  if (problemas.length > 0) {
    for (const p of problemas) console.error(p);
    morir(EXIT_DESVIO, '── INTEGRIDAD LOCAL ROTA');
  }
  console.log(`── integridad local del espejo OK: ${inv.total} archivos fieles al inventario del dueño (commit ${inv.commit.slice(0, 7)}). NO es paridad: la fuente no se consultó.`);
  process.exit(EXIT_OK);
}

if (modo !== '--paridad' && modo !== '--vigencia') {
  morir(EXIT_NO_CERTIFICADO, `Modo desconocido: ${modo}. Usá --integridad · --paridad · --vigencia · --adoptar-inventario <ruta>`);
}

problemas.push(...verificarParidad(inv));
if (problemas.length > 0) {
  for (const p of problemas) console.error(p);
  morir(EXIT_DESVIO, '── PARIDAD ROTA');
}
console.log(`── paridad OK: ${inv.total} archivos · espejo = inventario = fuente en ${inv.commit.slice(0, 7)}`);

if (modo === '--vigencia') {
  const cambiados = verificarVigencia(inv);
  if (cambiados.length > 0) {
    console.error('── DESACTUALIZADO (no es un desvío del espejo, es que la fuente avanzó):');
    for (const c of cambiados) console.error(`   ${c}`);
    process.exit(EXIT_DESVIO);
  }
  console.log('── vigente: el contenido espejado sigue igual en HEAD.');
}
process.exit(EXIT_OK);
