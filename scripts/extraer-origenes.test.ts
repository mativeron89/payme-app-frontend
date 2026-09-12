import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { clasificarOrigenes, extraerDeDirectorio, VEREDICTOS, VEREDICTOS_DE_TRAZA } from './extraer-origenes.mjs';

/**
 * ✅ **Corrido: 49/49 verde**, leído del log del CANDIDATO `logs/B2-npm-test.log:74`
 * (sha256 `956708f7818e5f215345009423203f0d5ea2e35c6713c220bf80cec0af5738b6`,
 * encabezado `payme-app-frontend@0.161.21`).
 *
 * ⚠️ El encabezado decía **Corrido: 47/47**, que era la cuenta ANTES de que AF-1
 * agregara dos casos: el archivo cambió y el número no. Lo cazó la auditoría independiente de
 * Qwen. Ahora la cuenta sale del log del candidato y no de la memoria de quien edita.
 *
 * Antes de eso decía `ESCRITOS_SIN_EJECUTAR`, mientras la fase prohibía ejecutar.
 *
 * 🔴 Y al correr, dos casos se pusieron rojos y los dos enseñaron algo: el pareo ordinal
 * reportaba `LINEA ILEGIBLE` cuando las líneas se leían perfectamente —bloqueaba por la razón
 * correcta y lo contaba mal—, y un fixture de línea ilegible **no tenía contexto**, así que ni
 * siquiera llegaba a ejercitar lo que decía probar. El chequeo nuevo destapó una prueba vieja
 * que no probaba lo suyo.
 *
 * EL GATE DE ORIGEN, PROBADO DONDE FALLA DE VERDAD.
 *
 * El gate contesta una pregunta binaria —«¿el E2E habló con algo que no sea esta
 * máquina?»— y su modo de falla peligroso **no es el rojo, es el verde vacío**: si el
 * extractor no encuentra nada, devuelve exactamente el mismo cero que devolvería una
 * corrida impecable. Un instrumento así convierte «no pude medir» en «medí y está bien».
 *
 * Los tres agujeros que este archivo vigila NO son hipotéticos. Los tres existieron:
 *
 * ① **El nombre de la entrada.** La primera versión buscaba el literal `trace.network`,
 *    tomado del código de `playwright-core`; el artefacto real la nombra
 *    `0-trace.network`. Devolvió 0 URLs sobre 6 trazas sanas con 660 requests.
 * ② **La línea ilegible.** Se salteaba en silencio y el veredicto podía salir LIMPIO
 *    igual — o sea, un trace truncado podía esconder el origen externo y el gate lo
 *    aprobaba. Hubo incluso un test que consagraba ese comportamiento.
 * ③ **La agregación global.** Todas las URLs iban a una bolsa: una traza sin entrada de
 *    red aportaba cero y quedaba invisible, porque otra ya satisfacía el control
 *    positivo. Medido: en una corrida presentada como limpia, **2 de 211 trazas** no
 *    tenían red y la afirmación cubría 209, no 211.
 *
 * Cada uno tiene acá su caso y su mutante. Los zips de fixture se arman en Node puro,
 * con entradas STORED y su CRC32 real: invocar el binario `zip` haría que el test
 * dependiera de una herramienta MÁS que el script bajo prueba, y su ausencia en CI se
 * leería como falla del gate.
 *
 * 🔴 Acá decía «`unzip` sí es dependencia legítima: el script la necesita», y **ya no era
 * cierto**: el lector vigente es `yauzl` resuelto dentro del árbol (`scripts/leer-zip.mjs:4`),
 * justamente para no depender de un binario del PATH. La frase quedó de cuando el script
 * shelleaba a `unzip`; se corrige porque una prosa que nombra una dependencia que no existe
 * manda a buscar el problema al lugar equivocado el día que algo falle.
 *
 * Por el mismo motivo, los subprocesos de este archivo se lanzan con `process.execPath` y no
 * con `'node'`: el Node que corre la suite es el que tiene que correr el script, no el primero
 * que aparezca en el PATH.
 */

// ── fixture: un zip STORED escrito a mano ────────────────────────────────────────

const TABLA_CRC = (() => {
  const tabla = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabla[n] = c >>> 0;
  }
  return tabla;
})();

function crc32(datos: Buffer): number {
  let c = 0xffffffff;
  for (const byte of datos) c = TABLA_CRC[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Zip mínimo sin compresión: suficiente para que el lector `yauzl` de `leer-zip.mjs` lo lea. */
function crearZip(entradas: Readonly<Record<string, string>>): Buffer {
  const locales: Buffer[] = [];
  const centrales: Buffer[] = [];
  let offset = 0;

  for (const [nombre, contenido] of Object.entries(entradas)) {
    const datos = Buffer.from(contenido, 'utf8');
    const nombreBuf = Buffer.from(nombre, 'utf8');
    const suma = crc32(datos);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8); // STORED
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(suma, 14);
    local.writeUInt32LE(datos.length, 18);
    local.writeUInt32LE(datos.length, 22);
    local.writeUInt16LE(nombreBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locales.push(local, nombreBuf, datos);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(suma, 16);
    central.writeUInt32LE(datos.length, 20);
    central.writeUInt32LE(datos.length, 24);
    central.writeUInt16LE(nombreBuf.length, 28);
    central.writeUInt32LE(0, 30);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrales.push(central, nombreBuf);

    offset += local.length + nombreBuf.length + datos.length;
  }

  const cuerpo = Buffer.concat(locales);
  const directorio = Buffer.concat(centrales);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(Object.keys(entradas).length, 8);
  fin.writeUInt16LE(Object.keys(entradas).length, 10);
  fin.writeUInt32LE(directorio.length, 12);
  fin.writeUInt32LE(cuerpo.length, 16);
  return Buffer.concat([cuerpo, directorio, fin]);
}

/**
 * Contenido mínimo de una traza de navegador válida.
 *
 * 🔴 Medido sobre trazas reales: `test.trace` **también** trae `context-options`, así que ese
 * evento por sí solo no discrimina. Lo que identifica la traza del navegador es el nombre con
 * ordinal (`0-trace.trace`) más un `context-options` parseable adentro. Los fixtures de camino
 * feliz DEBEN traerla: sin ella, consagran el fail-open que este archivo vigila.
 */
function ctx(): string {
  return `${JSON.stringify({ type: 'context-options' })}\n${JSON.stringify({ type: 'frame-snapshot' })}\n`;
}

function red(...urls: readonly string[]): string {
  return `${urls.map((url) => JSON.stringify({ type: 'resource-snapshot', snapshot: { request: { url } } })).join('\n')}\n`;
}

const ESPERADO = 'http://localhost:5176';
const SCRIPT = join(__dirname, 'extraer-origenes.mjs');
const GATE = join(__dirname, 'gate-origen.mjs');

let base: string;

function correr(dir: string, origenEsperado = ESPERADO) {
  const salida = join(base, `informe-${Math.random().toString(36).slice(2)}.json`);
  const r = spawnSync(process.execPath, [SCRIPT, dir, origenEsperado, salida], { encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, salida };
}

/** Un directorio de traces con una entrada por zip: `{ nombreDelCaso: { entrada: contenido } }`. */
function conTraces(casos: Readonly<Record<string, Readonly<Record<string, string>>>>): string {
  const dir = mkdtempSync(join(base, 'traces-'));
  for (const [caso, entradas] of Object.entries(casos)) {
    const d = join(dir, caso);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'trace.zip'), crearZip(entradas));
  }
  return dir;
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'payme-origenes-'));
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

// ── la regla que decide, probada sin tocar disco ─────────────────────────────────

describe('clasificarOrigenes', () => {
  it('con sólo loopback y el control positivo presente, acredita limpio', () => {
    const r = clasificarOrigenes([`${ESPERADO}/`, `${ESPERADO}/src/main.tsx`], ESPERADO);
    expect(r.veredicto).toBe(VEREDICTOS.LIMPIO);
    expect(r.control_positivo_ok).toBe(true);
    expect(r.origenes_no_loopback).toHaveLength(0);
  });

  /**
   * 🔴 AF-1 · `0.0.0.0` YA NO ACREDITA LIMPIO, y éste es el testigo del veredicto.
   *
   * Hasta el 2026-09-12 la dirección no especificada estaba en `HOSTS_LOOPBACK`, así que este
   * mismo arreglo de URLs devolvía `LIMPIO`: el gate certificaba «sólo loopback» sobre un
   * comodín que nunca midió.
   */
  it('un origen no especificado conviviendo con loopback rompe el limpio y queda atribuible', () => {
    const r = clasificarOrigenes([`${ESPERADO}/`, 'http://0.0.0.0:5176/x', `${ESPERADO}/y`], ESPERADO);
    expect(r.veredicto).toBe(VEREDICTOS.EXTERNOS);
    expect(r.veredicto).not.toBe(VEREDICTOS.LIMPIO);
    expect(r.origenes_no_loopback).toHaveLength(1);
    expect(r.origenes_no_loopback[0]!.clase).toBe('NO_ESPECIFICADA');
    // El literal SÍ se publica: es una constante del protocolo, no el dato de nadie, y sin él
    // el hallazgo quedaría sin sujeto. Es la misma razón por la que un tercero declarado se
    // nombra y un host desconocido no.
    expect(r.origenes_no_loopback[0]!.origen).toBe('http://0.0.0.0:5176');
  });

  /**
   * 🔴 Y ACÁ EL CONTROL POSITIVO ES EL PROPIO `0.0.0.0`, a propósito.
   *
   * Con `ESPERADO` como origen esperado, un arreglo que sólo tenga `0.0.0.0` sale
   * `SIN_CONTROL` — no limpio, sí, pero **por el motivo equivocado**: el caso pasaría aunque la
   * clasificación siguiera rota. Haciendo que el origen esperado SEA el no especificado, el
   * control positivo se cumple y lo único que puede decidir el veredicto es la clasificación.
   * Es la pregunta de siempre: ¿qué OTRA cosa satisface este predicado?
   */
  it('sólo no especificado, con su propio control positivo, tampoco acredita limpio', () => {
    const soloNoEspecificado = 'http://0.0.0.0:5176';
    const r = clasificarOrigenes([`${soloNoEspecificado}/`], soloNoEspecificado);
    expect(r.control_positivo_ok).toBe(true);
    expect(r.veredicto).not.toBe(VEREDICTOS.LIMPIO);
    expect(r.veredicto).toBe(VEREDICTOS.EXTERNOS);
    expect(r.origenes_no_loopback).toHaveLength(1);
  });

  /**
   * 🔴 CONTRATO NUEVO, adjudicado el 2026-09-11: un externo se caza y queda ATRIBUIBLE, pero
   * el host crudo no se publica. `connect.facebook.net` cae bajo `facebook.com`… no: su
   * eTLD+1 es `facebook.net`, que NO esta en la allowlist, asi que va a seudonimo. El caso
   * esta elegido a proposito para que no se confunda «parece de un tercero conocido» con
   * «esta declarado»: la allowlist es por sufijo exacto, no por parecido.
   */
  it('caza un origen externo y lo deja atribuible SIN publicar el host crudo', () => {
    const r = clasificarOrigenes(
      [`${ESPERADO}/`, 'https://connect.facebook.net/en_US/sdk.js', `${ESPERADO}/x`],
      ESPERADO,
    );
    expect(r.veredicto).toBe(VEREDICTOS.EXTERNOS);
    expect(r.origenes_no_loopback).toHaveLength(1);
    expect(r.origenes_no_loopback[0]!.clase).toBe('EXTERNO_NO_ALLOWLISTADO');
    expect(r.origenes_no_loopback[0]!.requests).toBe(1);
    expect(JSON.stringify(r)).not.toContain('connect.facebook.net');
  });

  /** Un tercero SI declarado se nombra: ocultarlo dejaria el hallazgo sin sujeto. */
  it('un tercero de la allowlist se nombra, sin su subdominio', () => {
    const r = clasificarOrigenes([`${ESPERADO}/`, 'https://js.stripe.com/v3/'], ESPERADO);
    expect(r.origenes_no_loopback[0]!.origen).toBe('https://stripe.com');
    expect(r.origenes_no_loopback[0]!.tercero).toBe('stripe.com');
    expect(JSON.stringify(r)).not.toContain('js.stripe.com');
  });

  /**
   * 🔴 EL MUTANTE DE LA REDACCION. Un subdominio puede llevar tenant, token o id de cuenta.
   * Este es el caso que los 31 tests anteriores NO vigilaban: cuando se agrego el seudonimo,
   * todos siguieron verdes porque ninguno afirmaba la AUSENCIA del crudo — la redaccion se
   * ve, la NO redaccion hay que ir a buscarla.
   */
  it('el tenant escondido en el subdominio no aparece en NINGUN campo', () => {
    const r = clasificarOrigenes([`${ESPERADO}/`, 'https://tok-abc123-tenant.malicioso.example/x'], ESPERADO);
    const serializado = JSON.stringify(r);
    expect(serializado).not.toContain('tok-abc123-tenant');
    expect(serializado).not.toContain('malicioso.example');
    expect(r.origenes_no_loopback[0]!.origen).toBe('EXTERNO_NO_ALLOWLISTADO');
    expect(r.origenes_no_loopback[0]!.esquema).toBe('https:');
    expect(r.origenes_no_loopback[0]!.largo_del_host).toBe('tok-abc123-tenant.malicioso.example'.length);
  });

  /** El loopback SI se publica literal: son constantes, no datos. */
  it('el loopback se publica literal y clasificado', () => {
    const r = clasificarOrigenes([`${ESPERADO}/`], ESPERADO);
    expect(r.origenes[0]!.origen).toBe(ESPERADO);
    expect(r.origenes[0]!.clase).toBe('LOOPBACK');
  });

  it('sin URLs NO dice «cero red externa»: dice que no trajo datos', () => {
    const r = clasificarOrigenes([], ESPERADO);
    expect(r.veredicto).toBe(VEREDICTOS.SIN_URLS);
    expect(r.veredicto).not.toBe(VEREDICTOS.LIMPIO);
  });

  it('si el origen esperado no aparece, no acredita aunque todo lo visto sea loopback', () => {
    const r = clasificarOrigenes(['http://127.0.0.1:4321/'], ESPERADO);
    expect(r.veredicto).toBe(VEREDICTOS.SIN_CONTROL);
  });

  it('cuenta el websocket de HMR como loopback y no como origen externo', () => {
    const r = clasificarOrigenes([`${ESPERADO}/`, 'ws://localhost:5176/'], ESPERADO);
    expect(r.veredicto).toBe(VEREDICTOS.LIMPIO);
    expect(r.origenes.map((o) => o.origen)).toContain('ws://localhost:5176');
  });

  it('separa data:/blob: de los orígenes de red en vez de descartarlos en silencio', () => {
    const r = clasificarOrigenes([`${ESPERADO}/`, 'data:image/png;base64,AAAA', 'blob:x'], ESPERADO);
    expect(r.origenes).toHaveLength(1);
    expect(r.esquemas_sin_red.map((e) => e.esquema).sort()).toEqual(['blob', 'data']);
  });

  /** 🔴 MUTANTE DEL FAIL-OPEN ②: una URL ilegible NO puede terminar en verde. */
  it('una URL que no parsea vuelve el veredicto NO_VERIFICABLE, nunca LIMPIO', () => {
    const r = clasificarOrigenes([`${ESPERADO}/`, 'no-es-una-url'], ESPERADO);
    expect(r.veredicto).toBe(VEREDICTOS.NO_VERIFICABLE);
    expect(r.veredicto).not.toBe(VEREDICTOS.LIMPIO);
  });

  /**
   * 🔴 Una URL ilegible puede traer query o token: no se persiste cruda **ni hasheada**.
   *
   * La versión anterior guardaba su sha256 «para comparar sin republicar», y este test lo
   * EXIGÍA. Un sha256 no se revierte, pero un secreto de baja entropía se recupera probando
   * candidatos contra el digest: publicarlo es publicar un oráculo del secreto. La regla ya
   * estaba escrita en el reporter y no se había aplicado acá, en el archivo de al lado.
   */
  it('redacta las URLs ilegibles: esquema, largo y motivo · nunca el texto ni su digest', () => {
    const secreto = 'callback?token=NO-DEBE-QUEDAR-ESCRITO';
    const r = clasificarOrigenes([`${ESPERADO}/`, secreto], ESPERADO);
    expect(r.urls_no_parseables).toHaveLength(1);
    const red0 = r.urls_no_parseables[0]! as unknown as Record<string, unknown>;
    expect(red0['motivo']).toBe('NO_PARSEA_COMO_URL');
    expect(red0['largo']).toBe(secreto.length);
    expect(red0['sha256']).toBeUndefined();
    const serializado = JSON.stringify(r);
    expect(serializado).not.toContain('NO-DEBE-QUEDAR-ESCRITO');
    // Y tampoco su digest: se comprueba que NO haya ningún hex de 64 en la salida.
    expect(serializado).not.toMatch(/[0-9a-f]{64}/);
  });
});

// ── el script real, como caja negra ──────────────────────────────────────────────

describe('extraer-origenes.mjs como gate', () => {
  it('sin traces sale distinto de cero y dice SIN_DATOS, no limpio', () => {
    const vacio = mkdtempSync(join(base, 'vacio-'));
    const r = correr(vacio);
    expect(r.stdout).toContain(VEREDICTOS.SIN_TRACES);
    expect(r.status).not.toBe(0);
  });

  /**
   * 🔴 MUTANTE DEL FAIL-OPEN ①. El artefacto real se llama `0-trace.network` —el ordinal
   * del chunk va adelante—, no `trace.network`. Anclar el parser en el literal que
   * aparece en el código de `playwright-core` produjo 0 URLs sobre trazas sanas.
   */
  it('lee la entrada con el ordinal de chunk adelante (0-trace.network)', () => {
    const dir = conTraces({ uno: { '0-trace.trace': ctx(), '0-trace.network': red(`${ESPERADO}/`, `${ESPERADO}/src/main.tsx`) } });
    const r = correr(dir);
    expect(r.stdout).toContain(VEREDICTOS.LIMPIO);
    expect(r.stdout).toContain('urls 2');
    expect(r.status).toBe(0);
  });

  /**
   * 🔴 ACÁ HABÍA EL CASO INVERSO, Y LO ESCRIBÍ YO · ítem 4.
   *
   * Decía «sigue leyendo el nombre sin ordinal, para no romper trazas viejas» y exigía
   * `LIMPIO` con una entrada llamada `trace.network`. Lo escribí cuando el hallazgo era el
   * opuesto: el artefacto real llevaba ordinal (`0-trace.network`) y mi parser lo ignoraba,
   * devolviendo cero URLs sobre seis trazas sanas con 660 requests.
   *
   * Aquella tolerancia era **compatibilidad**, y hoy es la puerta que el CTO señala: sin
   * ordinal no hay con qué parear, así que no se puede decir de qué contexto salieron esos
   * bytes. Se invierte el caso y se deja escrito el porqué — borrar un test sin decir por qué
   * es cómo se pierde una razón.
   */
  it('una entrada de red SIN ordinal ya no acredita: es NO_VERIFICABLE', () => {
    const dir = conTraces({ uno: { '0-trace.trace': ctx(), 'trace.network': red(`${ESPERADO}/`) } });
    const r = correr(dir);
    expect(r.stdout).not.toContain(VEREDICTOS.LIMPIO);
    expect(r.status).not.toBe(0);
  });

  /**
   * 🔴 EL MUTANTE DEL PAREO. Contexto del chunk 0 y red del chunk 1: antes el contexto se
   * acreditaba GLOBAL para el zip, así que esta combinación salía limpia — un contexto
   * legítimo acreditaba una entrada de red que podía venir de cualquier lado.
   */
  it('un contexto del ordinal 0 NO acredita la red del ordinal 1', () => {
    const dir = conTraces({ uno: { '0-trace.trace': ctx(), '1-trace.network': red(`${ESPERADO}/`) } });
    const r = correr(dir);
    expect(r.stdout).not.toContain(VEREDICTOS.LIMPIO);
    expect(r.status).not.toBe(0);
  });

  it('con el contexto y la red del MISMO ordinal, sí acredita', () => {
    const dir = conTraces({ uno: { '1-trace.trace': ctx(), '1-trace.network': red(`${ESPERADO}/`) } });
    const r = correr(dir);
    expect(r.stdout).toContain(VEREDICTOS.LIMPIO);
    expect(r.status).toBe(0);
  });

  it('con un origen externo adentro falla y lo deja atribuible', () => {
    const dir = conTraces({
      uno: { '0-trace.trace': ctx(), '0-trace.network': red(`${ESPERADO}/`, 'https://accounts.google.com/o/oauth2/v2/auth') },
    });
    const r = correr(dir);
    expect(r.stdout).toContain(VEREDICTOS.EXTERNOS);
    // `accounts.google.com` cae bajo `google.com`, que SI esta declarado: se nombra el
    // tercero, nunca el subdominio.
    expect(r.stdout).toContain('https://google.com');
    expect(r.stdout).not.toContain('accounts.google.com');
    expect(r.status).not.toBe(0);
  });

  /**
   * 🔴 MUTANTE DEL FAIL-OPEN ③ — el que de verdad estaba ocurriendo.
   *
   * Dos trazas: una sana con el origen esperado, otra SIN entrada de red. Con la
   * agregación global, la primera satisfacía el control positivo y la segunda
   * desaparecía: veredicto LIMPIO sobre una población que no se midió entera. Ahora la
   * muda es un hallazgo y sale nombrada.
   */
  it('una traza sana NO tapa a otra que abrió navegador y no dejó red', () => {
    const dir = conTraces({
      sana: { '0-trace.trace': ctx(), '0-trace.network': red(`${ESPERADO}/`, `${ESPERADO}/a`) },
      muda: { '0-trace.trace': ctx() },
    });
    const r = correr(dir);
    expect(r.stdout).toContain(VEREDICTOS.SIN_NETWORK_EN_ZIP);
    expect(r.stdout).not.toContain(VEREDICTOS.LIMPIO);
    expect(r.stdout).toContain('SIN NETWORK EN EL ZIP');
    expect(r.stdout).toContain('muda');
    expect(r.status).not.toBe(0);
  });

  /**
   * 🔴 Las tres formas de «no vi tráfico» son distintas y el gate tiene que decir CUÁL.
   * Colapsarlas en «sin URLs» fue el agujero: una traza que nunca abrió navegador y una
   * que lo abrió y perdió el archivo de red exigen respuestas opuestas.
   */
  it('distingue la traza que NUNCA abrió navegador de la que lo abrió', () => {
    const dir = conTraces({
      sana: { '0-trace.trace': ctx(), '0-trace.network': red(`${ESPERADO}/`) },
      'sin-navegador': { 'test.trace': '{"type":"test"}\n' },
    });
    const r = correr(dir);
    expect(r.stdout).toContain(VEREDICTOS.SIN_NAVEGADOR_NO_DECLARADO);
    expect(r.stdout).toContain('SIN NAVEGADOR (no declarada)');
    expect(r.stdout).not.toContain(VEREDICTOS.LIMPIO);
    expect(r.status).not.toBe(0);
  });

  it('una traza con navegador y entrada de red vacía es SIN RED, no sin navegador', () => {
    const dir = conTraces({
      sana: { '0-trace.trace': ctx(), '0-trace.network': red(`${ESPERADO}/`) },
      'sin-requests': { '0-trace.trace': ctx(), '0-trace.network': '\n' },
    });
    const r = correr(dir);
    expect(r.stdout).toContain(VEREDICTOS.TRAZAS_SIN_RED);
    expect(r.stdout).toContain('SIN RED OBSERVABLE');
    expect(r.status).not.toBe(0);
  });

  /**
   * 🔴 MUTANTE de la línea con forma inesperada. Medido sobre 211 trazas reales:
   * `trace.network` trae exclusivamente `resource-snapshot`, 110 de 110 con `url` string.
   * Una forma distinta es un formato que este parser no entiende, y no entender no es
   * aprobar — se comprueba que NO se ignore.
   */
  it('una línea que parsea pero no tiene la forma esperada NO se ignora', () => {
    const dir = conTraces({
      sana: { '0-trace.trace': ctx(), '0-trace.network': red(`${ESPERADO}/`) },
      rara: {
        '0-trace.trace': ctx(),
        '0-trace.network': `${red(`${ESPERADO}/`)}{"type":"otra-cosa","snapshot":{"request":{"url":123}}}\n`,
      },
    });
    const r = correr(dir);
    expect(r.stdout).toContain(VEREDICTOS.NO_VERIFICABLE);
    expect(r.stdout).not.toContain(VEREDICTOS.LIMPIO);
    expect(r.status).not.toBe(0);
  });

  /**
   * 🔴 MUTANTE DEL FAIL-OPEN ②, extremo a extremo: la línea rota contamina la corrida.
   *
   * ⚠️ Los dos fixtures ganaron su `0-trace.trace`, y eso NO es cosmética. Sin contexto
   * pareado, el ítem 4 dispara antes y el caso salía `PAREO_ORDINAL_ROTO` — o sea que no
   * llegaba a ejercitar la línea ilegible que viene a probar. **El fixture estaba incompleto
   * desde antes** y se sostenía porque el contexto se acreditaba globalmente; al endurecer el
   * pareo, quedó a la vista. El chequeo nuevo destapó una prueba que no probaba lo que decía.
   */
  it('una línea ilegible en una traza vuelve toda la corrida NO_VERIFICABLE', () => {
    const dir = conTraces({
      sana: { '0-trace.trace': ctx(), '0-trace.network': red(`${ESPERADO}/`, `${ESPERADO}/a`) },
      rota: { '0-trace.trace': ctx(), '0-trace.network': `${red(`${ESPERADO}/`)}{esto no es json\n` },
    });
    const r = correr(dir);
    expect(r.stdout).toContain(VEREDICTOS.NO_VERIFICABLE);
    expect(r.stdout).not.toContain(VEREDICTOS.LIMPIO);
    expect(r.stdout).toContain('LINEA ILEGIBLE');
    expect(r.status).not.toBe(0);
  });

  it('rinde un veredicto por traza y no sólo el global', () => {
    const dir = conTraces({
      ok: { '0-trace.trace': ctx(), '0-trace.network': red(`${ESPERADO}/`) },
      externa: { '0-trace.trace': ctx(), '0-trace.network': red(`${ESPERADO}/`, 'https://evil.example/x') },
    });
    const r = correr(dir);
    const informe = JSON.parse(readFileSync(r.salida, 'utf8')) as {
      detalle_por_trace: { zip: string; veredicto: string }[];
    };
    const porZip = Object.fromEntries(informe.detalle_por_trace.map((t) => [t.zip.split('/')[0], t.veredicto]));
    expect(porZip['ok']).toBe(VEREDICTOS_DE_TRAZA.OK);
    expect(porZip['externa']).toBe(VEREDICTOS_DE_TRAZA.EXTERNOS);
  });
});

describe('fail-open de URL ilegible · flujo completo', () => {
  /**
   * 🔴 MUTANTE DE FLUJO. `clasificarOrigenes` ya marcaba NO_VERIFICABLE, pero ni el
   * veredicto por traza ni el global miraban `urls_no_parseables`: un `.network` con líneas
   * JSON perfectamente válidas, donde UNA de ellas trae una URL ilegible, daba traza OK,
   * global LIMPIO y exit 0. La línea se parseaba; la URL adentro, no.
   */
  it('una URL ilegible dentro de una línea válida vuelve la corrida NO_VERIFICABLE', () => {
    const dir = conTraces({
      una: { '0-trace.trace': ctx(), '0-trace.network': red(`${ESPERADO}/`, 'no-es-una-url-con-token-abc', `${ESPERADO}/b`) },
    });
    const r = correr(dir);
    expect(r.stdout).toContain(VEREDICTOS.NO_VERIFICABLE);
    expect(r.stdout).not.toContain(VEREDICTOS.LIMPIO);
    expect(r.status).not.toBe(0);
  });

  it('y el informe no filtra el texto ilegible ni su digest', () => {
    const dir = conTraces({
      una: { '0-trace.trace': ctx(), '0-trace.network': red(`${ESPERADO}/`, 'rota?token=SECRETO-QUE-NO-VA') },
    });
    const r = correr(dir);
    const crudo = readFileSync(r.salida, 'utf8');
    expect(crudo).not.toContain('SECRETO-QUE-NO-VA');
    expect(crudo).not.toMatch(/[0-9a-f]{64}/);
  });
});

describe('contexto de navegador · acreditado por contenido, no por nombre', () => {
  /**
   * 🔴 MUTANTE DE COMBINACIÓN CONTRADICTORIA. Un zip SIN traza de contexto pero CON un
   * `0-trace.network` fabricado lleno de localhost salía LIMPIO: la regla anterior sólo
   * declaraba SIN_NAVEGADOR cuando ADEMÁS faltaba el `.network`. Red sin contexto no es una
   * traza sana: es una contradicción, y bloquea.
   */
  it('network sin contexto de navegador NO puede dar limpio', () => {
    const dir = conTraces({ contradictoria: { '0-trace.network': red(`${ESPERADO}/`, `${ESPERADO}/a`) } });
    const r = correr(dir);
    expect(r.stdout).not.toContain(VEREDICTOS.LIMPIO);
    expect(r.status).not.toBe(0);
    /**
     * 🔴 El diagnóstico cambió y es MÁS preciso · ítem 4. Antes esto salía `SIN NAVEGADOR`,
     * que describe el zip entero; ahora dice qué entrada concreta quedó sin pareja.
     *
     * ⚠️ Y la primera versión de este cambio reportaba `LINEA ILEGIBLE`, que era **falso**:
     * las líneas se leyeron perfectamente, lo que falta es de qué contexto salieron. Bloqueaba
     * por la razón correcta y lo contaba mal, que manda al auditor a buscar un problema de
     * parseo inexistente. Lo cazó este test al correr, no una lectura.
     */
    expect(r.stdout).toContain(VEREDICTOS.PAREO_ROTO);
    expect(r.stdout).toContain('PAREO ORDINAL ROTO');
    expect(r.stdout).not.toContain('LINEA ILEGIBLE');
  });

  /** 🔴 MUTANTE: la entrada de contexto existe pero su contenido no parsea. */
  it('un contexto ilegible NO acredita navegador: vuelve la corrida NO_VERIFICABLE', () => {
    const dir = conTraces({
      rota: { '0-trace.trace': '{esto no parsea\n', '0-trace.network': red(`${ESPERADO}/`) },
    });
    const r = correr(dir);
    expect(r.stdout).toContain(VEREDICTOS.NO_VERIFICABLE);
    expect(r.stdout).not.toContain(VEREDICTOS.LIMPIO);
    expect(r.status).not.toBe(0);
  });

  /** `test.trace` trae `context-options` pero NO es la traza del navegador. */
  it('test.trace con context-options no alcanza: hace falta la traza con ordinal', () => {
    const dir = conTraces({
      solo_test: { 'test.trace': '{"type":"context-options"}\n', '0-trace.network': red(`${ESPERADO}/`) },
    });
    const r = correr(dir);
    expect(r.stdout).not.toContain(VEREDICTOS.LIMPIO);
    expect(r.status).not.toBe(0);
  });
});

// ── unión por identidad exacta del test (adenda 11) ─────────────────────────────

describe('unión traza ↔ test por path exacto del attachment', () => {
  /**
   * El directorio de un trace tiene nombre truncado y hasheado: no es reversible y dos
   * títulos parecidos colisionan. `test.trace` tampoco trae el título en Playwright 1.62.1.
   * Lo único autoritativo es el path del attachment que el reporter registró en `onTestEnd`,
   * y la unión es por **igualdad exacta** de ese path.
   */
  function registroDe(pares: readonly (readonly [string, string])[]) {
    return pares.map(([rel, titulo], i) => ({
      id: `id-${i}`, titulo, spec: 'e2e/x.spec.ts', linea: 10 + i,
      trace_path_relativo: rel,
    }));
  }

  function correrConRegistro(dir: string, registro: unknown) {
    const reg = join(base, `reg-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(reg, JSON.stringify({ tests: registro }));
    const salida = join(base, `inf-${Math.random().toString(36).slice(2)}.json`);
    const r = spawnSync(process.execPath, [SCRIPT, dir, ESPERADO, salida, reg], { encoding: 'utf8' });
    return { status: r.status, stdout: r.stdout, salida };
  }

  /** 🔴 MUTANTE: apareció un trace que ningún test declara haber producido. */
  it('una traza sin registro en el reporter ⇒ NO_VERIFICABLE, nunca LIMPIO', () => {
    const dir = conTraces({ huerfana: { '0-trace.trace': ctx(), '0-trace.network': red(`${ESPERADO}/`) } });
    const r = correrConRegistro(dir, registroDe([['test-results/otra/trace.zip', 'un test que no es éste']]));
    expect(r.stdout).toContain('NO_VERIFICABLE_TRAZA_SIN_REGISTRO');
    expect(r.stdout).not.toContain(VEREDICTOS.LIMPIO);
    expect(r.status).not.toBe(0);
  });

  /**
   * 🔴 MUTANTE: dos slugs que comparten prefijo. Con `includes` o un regex laxo, el registro
   * de uno cubriría al otro y una traza quedaría acreditada por el test equivocado.
   */
  it('dos trazas de nombre parecido no se confunden entre sí', () => {
    const dir = conTraces({
      'rutas-montan-pantalla-cada': { '0-trace.trace': ctx(), '0-trace.network': red(`${ESPERADO}/`) },
      'rutas-montan-pantalla-cada-ruta': { '0-trace.trace': ctx(), '0-trace.network': red(`${ESPERADO}/`) },
    });
    // Sólo la PRIMERA está registrada. Con igualdad exacta, la segunda queda sin registro.
    const r = correrConRegistro(dir, registroDe([
      [`${dir.split('/').pop()}/rutas-montan-pantalla-cada/trace.zip`, 'el corto'],
    ]));
    expect(r.stdout).toContain('NO_VERIFICABLE_TRAZA_SIN_REGISTRO');
    expect(r.status).not.toBe(0);
  });

  it('sin registro pasado, el informe lo declara NO_SOLICITADA en vez de fingir que unió', () => {
    const dir = conTraces({ una: { '0-trace.trace': ctx(), '0-trace.network': red(`${ESPERADO}/`) } });
    const r = correr(dir);
    const informe = JSON.parse(readFileSync(r.salida, 'utf8')) as { union_por_identidad: string };
    expect(informe.union_por_identidad).toBe('NO_SOLICITADA');
  });
});

// ── el orquestador rechaza lo que lo desacoplaría de lo que mide ─────────────────

describe('gate-origen.mjs · validación de argumentos', () => {
  const correrGate = (...args: readonly string[]) =>
    spawnSync(process.execPath, [GATE, ...args], { encoding: 'utf8', cwd: join(__dirname, '..') });

  /**
   * 🔴 `--output` mandaría los traces a otro directorio y el gate mediría el de siempre:
   * un verde sobre un universo vacío. `--trace off` los apagaría. `--reporter` podría
   * sacar el reporter que produce el control positivo. Ninguna llega a lanzar Playwright.
   */
  it.each(['--output', '--trace', '--config', '--reporter'])(
    'rechaza «%s» antes de lanzar nada',
    (flag) => {
      const r = correrGate(flag, 'loquesea');
      expect(r.status).toBe(2);
      expect(r.stderr).toContain(flag);
      expect(r.stdout ?? '').not.toContain('corriendo E2E');
    },
  );

  it('rechaza una opción desconocida en vez de pasarla al runner (fail-closed)', () => {
    const r = correrGate('--opcion-que-no-existe');
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('fail-closed');
  });
});

/**
 * 🔴 BIYECCIÓN Y CARDINALIDAD registro ↔ ZIP.
 *
 * El gate sabía denunciar la traza huérfana —un artefacto que ningún test declara— y le
 * faltaban la dirección contraria y las degeneradas. Son las que dejan pasar un vacío
 * disfrazado de limpio: medir «las trazas que encontré» se lee igual que medir «todas las
 * que la corrida produjo», y sólo la cardinalidad separa las dos frases.
 *
 * El árbol se arma bajo `.../test-results` a propósito: es lo que hace que el extractor
 * derive rutas relativas como las que el reporter registra. Un fixture con otra forma
 * probaría un camino que en producción no ocurre.
 */
describe('biyección registro ↔ trazas', () => {
  function arbolConTestResults(casos: Readonly<Record<string, Readonly<Record<string, string>>>>): {
    dir: string;
    rel: (caso: string) => string;
  } {
    const repo = mkdtempSync(join(base, 'repo-'));
    const dir = join(repo, 'test-results');
    for (const [caso, entradas] of Object.entries(casos)) {
      mkdirSync(join(dir, caso), { recursive: true });
      writeFileSync(join(dir, caso, 'trace.zip'), crearZip(entradas));
    }
    return { dir, rel: (caso: string) => `test-results/${caso}/trace.zip` };
  }
  const sana = () => ({ '0-trace.trace': ctx(), '0-trace.network': red(`${ESPERADO}/`) });

  it('sin registro declara NO_SOLICITADA, no una biyección rota', async () => {
    const { dir } = arbolConTestResults({ uno: sana() });
    const r = await extraerDeDirectorio(dir, ESPERADO, null);
    expect(r.biyeccion.estado).toBe('NO_SOLICITADA');
    expect(r.veredicto).not.toBe(VEREDICTOS.BIYECCION_ROTA);
  });

  it('con el registro completo, es biyectiva y el veredicto pasa de largo', async () => {
    const { dir, rel } = arbolConTestResults({ uno: sana(), dos: sana() });
    const r = await extraerDeDirectorio(dir, ESPERADO, [
      { id: 'a', titulo: 'test a', spec: 'fixture.spec.ts', linea: 1, trace_path_relativo: rel('uno') },
      { id: 'b', titulo: 'test b', spec: 'fixture.spec.ts', linea: 1, trace_path_relativo: rel('dos') },
    ]);
    expect(r.biyeccion.estado).toBe('BIYECTIVA');
    expect(r.biyeccion.cardinalidad.zips_en_el_directorio).toBe(2);
    expect(r.biyeccion.cardinalidad.tests_con_traza_declarada).toBe(2);
    expect(r.veredicto).toBe(VEREDICTOS.LIMPIO);
  });

  /** 🔴 `[]` no es «todo en orden»: es un reporter que no declaró un solo test. */
  it('registro VACÍO ⇒ NO_BIYECTIVA, aunque haya trazas sanas', async () => {
    const { dir } = arbolConTestResults({ uno: sana() });
    const r = await extraerDeDirectorio(dir, ESPERADO, []);
    expect(r.biyeccion.estado).toBe('NO_BIYECTIVA');
    expect(r.biyeccion.problemas).toContain('REGISTRO_VACIO');
    expect(r.veredicto).not.toBe(VEREDICTOS.LIMPIO);
  });

  /** Hay tests, y ninguno declaró traza: no hay nada que unir, y eso no es «unido». */
  it('registro con todos los paths nulos ⇒ NO_BIYECTIVA', async () => {
    const { dir } = arbolConTestResults({ uno: sana() });
    const r = await extraerDeDirectorio(dir, ESPERADO, [
      { id: 'a', titulo: 'test a', spec: 'fixture.spec.ts', linea: 1, trace_path_relativo: null },
      { id: 'b', titulo: 'test b', spec: 'fixture.spec.ts', linea: 1, trace_path_relativo: null },
    ]);
    expect(r.biyeccion.problemas).toContain('REGISTRO_SIN_NINGUNA_TRAZA_DECLARADA');
    expect(r.biyeccion.cardinalidad.tests_sin_traza_declarada).toBe(2);
    expect(r.veredicto).toBe(VEREDICTOS.BIYECCION_ROTA);
  });

  /** 🔴 Dos tests declarando el mismo path: la unión deja de ser una función. */
  it('paths DUPLICADOS en el registro ⇒ NO_BIYECTIVA y los lista', async () => {
    const { dir, rel } = arbolConTestResults({ uno: sana() });
    const r = await extraerDeDirectorio(dir, ESPERADO, [
      { id: 'a', titulo: 'test a', spec: 'fixture.spec.ts', linea: 1, trace_path_relativo: rel('uno') },
      { id: 'b', titulo: 'test b', spec: 'fixture.spec.ts', linea: 1, trace_path_relativo: rel('uno') },
    ]);
    expect(r.biyeccion.problemas).toContain('PATHS_DUPLICADOS_EN_EL_REGISTRO');
    expect(r.biyeccion.duplicados_en_el_registro).toEqual([rel('uno')]);
    expect(r.veredicto).toBe(VEREDICTOS.BIYECCION_ROTA);
  });

  /**
   * 🔴 EL CASO QUE ANTES PASABA. Un test declaró su traza y la traza no está: el directorio
   * tiene MENOS artefactos que la corrida. Sin esta comprobación se medía lo que había y
   * salía limpio — la mitad de una corrida se lee igual que una corrida entera.
   */
  it('un test declara una traza que FALTA ⇒ NO_BIYECTIVA y la nombra', async () => {
    const { dir, rel } = arbolConTestResults({ uno: sana() });
    const r = await extraerDeDirectorio(dir, ESPERADO, [
      { id: 'a', titulo: 'test a', spec: 'fixture.spec.ts', linea: 1, trace_path_relativo: rel('uno') },
      { id: 'b', titulo: 'test b', spec: 'fixture.spec.ts', linea: 1, trace_path_relativo: rel('la-que-falta') },
    ]);
    expect(r.biyeccion.problemas).toContain('TESTS_CON_TRAZA_DECLARADA_QUE_NO_ESTA');
    expect(r.biyeccion.tests_con_traza_faltante).toEqual([rel('la-que-falta')]);
    expect(r.veredicto).toBe(VEREDICTOS.BIYECCION_ROTA);
  });

  /** La dirección que ya existía, ahora también contada en la cardinalidad. */
  it('una traza HUÉRFANA ⇒ NO_BIYECTIVA y aparece en trazas_huerfanas', async () => {
    const { dir, rel } = arbolConTestResults({ uno: sana(), intrusa: sana() });
    const r = await extraerDeDirectorio(dir, ESPERADO, [{ id: 'a', titulo: 'test a', spec: 'fixture.spec.ts', linea: 1, trace_path_relativo: rel('uno') }]);
    expect(r.biyeccion.trazas_huerfanas).toEqual([rel('intrusa')]);
    expect(r.biyeccion.estado).toBe('NO_BIYECTIVA');
  });

  /**
   * Los skips NO son un defecto: un test salteado no produce traza y el gate no puede
   * exigirle una. Se CUENTAN, que es distinto — si fueran todos, el gate estaría midiendo
   * cero sobre una corrida que sí ocurrió, y eso lo dice la cardinalidad.
   */
  /**
   * 🔴 ÍTEM 5 · un nulo **justificado** por el estado de salteo es benigno y no rompe nada.
   * El fixture ahora declara `estado`, porque sin él el gate ya no acepta el nulo.
   */
  it('tests SALTEADOS se cuentan sin romper la biyección', async () => {
    const { dir, rel } = arbolConTestResults({ uno: sana() });
    const r = await extraerDeDirectorio(dir, ESPERADO, [
      { id: 'a', titulo: 'test a', spec: 'fixture.spec.ts', linea: 1, estado: 'passed', trace_path_relativo: rel('uno') },
      { id: 'salteado', titulo: 'test salteado', spec: 'fixture.spec.ts', linea: 1, estado: 'skipped', trace_path_relativo: null },
    ]);
    expect(r.biyeccion.estado).toBe('BIYECTIVA');
    expect(r.biyeccion.cardinalidad.tests_en_el_registro).toBe(2);
    expect(r.biyeccion.cardinalidad.tests_con_traza_declarada).toBe(1);
    expect(r.biyeccion.cardinalidad.tests_sin_traza_declarada).toBe(1);
    expect(r.biyeccion.nulos_sin_estado_de_salteo).toEqual([]);
  });

  /**
   * 🔴 EL CASO QUE ANTES PASABA CALLADO · ítem 5. Un test que **corrió** y no dejó traza no es
   * un salteo: es un artefacto que el instrumento perdió. Hasta P3 el nulo se contaba y se
   * dejaba pasar, así que «este test no dejó traza» era una afirmación que el gate aceptaba
   * sin pedir el motivo.
   */
  it('un nulo de un test que PASÓ rompe la biyección y lo nombra', async () => {
    const { dir, rel } = arbolConTestResults({ uno: sana() });
    const r = await extraerDeDirectorio(dir, ESPERADO, [
      { id: 'a', titulo: 'test a', spec: 'fixture.spec.ts', linea: 1, estado: 'passed', trace_path_relativo: rel('uno') },
      { id: 'perdido', titulo: 'test perdido', spec: 'fixture.spec.ts', linea: 1, estado: 'passed', trace_path_relativo: null },
    ]);
    expect(r.biyeccion.problemas).toContain('TRAZA_NULA_SIN_ESTADO_DE_SALTEO');
    expect(r.biyeccion.nulos_sin_estado_de_salteo).toEqual(['perdido']);
    expect(r.veredicto).toBe(VEREDICTOS.BIYECCION_ROTA);
  });

  /** Sin `estado`, el nulo tampoco se acepta: ausente no es lo mismo que justificado. */
  it('un nulo SIN estado declarado tampoco pasa', async () => {
    const { dir, rel } = arbolConTestResults({ uno: sana() });
    const r = await extraerDeDirectorio(dir, ESPERADO, [
      { id: 'a', titulo: 'test a', spec: 'fixture.spec.ts', linea: 1, estado: 'passed', trace_path_relativo: rel('uno') },
      { id: 'sin-estado', titulo: 'sin estado', spec: 'fixture.spec.ts', linea: 1, trace_path_relativo: null },
    ]);
    expect(r.biyeccion.problemas).toContain('TRAZA_NULA_SIN_ESTADO_DE_SALTEO');
  });

  /** Ni string usable ni nulo explícito: una forma que este gate no entiende, y no entender no es aprobar. */
  it('un trace_path de forma inesperada rompe la biyección', async () => {
    const { dir, rel } = arbolConTestResults({ uno: sana() });
    const r = await extraerDeDirectorio(dir, ESPERADO, [
      { id: 'a', titulo: 'test a', spec: 'fixture.spec.ts', linea: 1, estado: 'passed', trace_path_relativo: rel('uno') },
      { id: 'raro', titulo: 'raro', spec: 'fixture.spec.ts', linea: 1, estado: 'passed', trace_path_relativo: 42 as unknown as string },
    ]);
    expect(r.biyeccion.problemas).toContain('TRACE_PATH_DE_FORMA_INESPERADA');
    expect(r.biyeccion.trace_path_de_forma_inesperada).toEqual(['raro']);
  });
});
