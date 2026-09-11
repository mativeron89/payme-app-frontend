import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { clasificarOrigenes, VEREDICTOS } from './extraer-origenes.mjs';

/**
 * EL GATE DE ORIGEN, PROBADO DONDE FALLA DE VERDAD.
 *
 * El gate contesta una pregunta binaria —«¿el E2E habló con algo que no sea esta
 * máquina?»— y su modo de falla peligroso **no es el rojo, es el verde vacío**: si el
 * extractor no encuentra nada, devuelve exactamente el mismo cero que devolvería una
 * corrida impecable. Un instrumento así, sin control positivo, convierte «no pude
 * medir» en «medí y está limpio».
 *
 * Ya pasó, y por eso estos casos existen: la primera versión buscaba la entrada
 * literal `trace.network` —el nombre que aparece en el código de `playwright-core`—
 * mientras el artefacto real la nombra **`0-trace.network`**, con el ordinal del chunk
 * adelante. Devolvió 0 URLs sobre 6 trazas sanas con 660 requests. No lo cazó una
 * relectura: lo cazó el control positivo. Acá ese hallazgo queda versionado como test,
 * para que el día que alguien vuelva a anclar el parser en un literal, se ponga rojo.
 *
 * Los zips de fixture se arman en Node puro, con entradas STORED y su CRC32 real. Se
 * podría invocar el binario `zip`, pero entonces el test dependería de una herramienta
 * MÁS que el script bajo prueba, y una ausencia de `zip` en CI se leería como falla del
 * gate. `unzip` sí es dependencia legítima: el script lo necesita para existir.
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

/** Zip mínimo sin compresión: suficiente para que `unzip -Z1` y `unzip -p` lo lean. */
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
    local.writeUInt16LE(20, 4); // versión necesaria
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // método: STORED
    local.writeUInt32LE(0, 10); // fecha/hora
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
    central.writeUInt32LE(0, 30); // extra + comentario
    central.writeUInt16LE(0, 36); // disco
    central.writeUInt32LE(0, 38); // atributos
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

function red(...urls: readonly string[]): string {
  return `${urls.map((url) => JSON.stringify({ type: 'resource-snapshot', snapshot: { request: { url } } })).join('\n')}\n`;
}

const ESPERADO = 'http://localhost:5176';
const SCRIPT = join(__dirname, 'extraer-origenes.mjs');

let base: string;

function correr(dir: string, origenEsperado = ESPERADO) {
  const salida = join(base, `informe-${Math.random().toString(36).slice(2)}.json`);
  const r = spawnSync('node', [SCRIPT, dir, origenEsperado, salida], { encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function conTrace(nombreEntrada: string, contenido: string): string {
  const dir = mkdtempSync(join(base, 'traces-'));
  const caso = join(dir, 'un-test');
  mkdirSync(caso, { recursive: true });
  writeFileSync(join(caso, 'trace.zip'), crearZip({ [nombreEntrada]: contenido }));
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

  it('caza un origen externo y lo nombra en vez de resumirlo', () => {
    const r = clasificarOrigenes(
      [`${ESPERADO}/`, 'https://connect.facebook.net/en_US/sdk.js', `${ESPERADO}/x`],
      ESPERADO,
    );
    expect(r.veredicto).toBe(VEREDICTOS.EXTERNOS);
    expect(r.origenes_no_loopback.map((o) => o.origen)).toEqual(['https://connect.facebook.net']);
  });

  /**
   * 🔴 El caso que justifica todo el archivo. Sin control positivo, una lista vacía y
   * una corrida impecable son indistinguibles, y el instrumento firma la segunda.
   */
  it('sin URLs NO dice «cero red externa»: dice que no trajo datos', () => {
    const r = clasificarOrigenes([], ESPERADO);
    expect(r.veredicto).toBe(VEREDICTOS.SIN_URLS);
    expect(r.veredicto).not.toBe(VEREDICTOS.LIMPIO);
    expect(r.control_positivo_ok).toBe(false);
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

  it('registra las URLs no parseables en vez de contarlas como ausencia de tráfico', () => {
    const r = clasificarOrigenes([`${ESPERADO}/`, 'no-es-una-url', ''], ESPERADO);
    expect(r.urls_no_parseables).toHaveLength(2);
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
   * 🔴 REGRESIÓN DEL NOMBRE DE LA ENTRADA. El artefacto real se llama
   * `0-trace.network` —el ordinal del chunk va adelante—, no `trace.network`. Anclar el
   * parser en el literal que aparece en el código de `playwright-core` produjo 0 URLs
   * sobre trazas sanas. Este test se pone rojo si alguien vuelve a anclarlo ahí.
   */
  it('lee la entrada con el ordinal de chunk adelante (0-trace.network)', () => {
    const dir = conTrace('0-trace.network', red(`${ESPERADO}/`, `${ESPERADO}/src/main.tsx`));
    const r = correr(dir);
    expect(r.stdout).toContain(VEREDICTOS.LIMPIO);
    expect(r.stdout).toContain('urls 2');
    expect(r.status).toBe(0);
  });

  it('sigue leyendo el nombre sin ordinal, para no romper trazas viejas', () => {
    const dir = conTrace('trace.network', red(`${ESPERADO}/`));
    const r = correr(dir);
    expect(r.stdout).toContain(VEREDICTOS.LIMPIO);
    expect(r.status).toBe(0);
  });

  it('con un origen externo adentro falla y lo nombra', () => {
    const dir = conTrace('0-trace.network', red(`${ESPERADO}/`, 'https://accounts.google.com/o/oauth2/v2/auth'));
    const r = correr(dir);
    expect(r.stdout).toContain(VEREDICTOS.EXTERNOS);
    expect(r.stdout).toContain('https://accounts.google.com');
    expect(r.status).not.toBe(0);
  });

  it('una traza sin entrada de red no acredita nada', () => {
    const dir = conTrace('0-trace.trace', '{"type":"context-options"}\n');
    const r = correr(dir);
    expect(r.stdout).toContain(VEREDICTOS.SIN_URLS);
    expect(r.status).not.toBe(0);
  });

  it('ignora las líneas rotas sin abortar la lectura del resto', () => {
    const dir = conTrace('0-trace.network', `${red(`${ESPERADO}/`)}esto no es json\n${red(`${ESPERADO}/b`)}`);
    const r = correr(dir);
    expect(r.stdout).toContain('urls 2');
    expect(r.status).toBe(0);
  });
});
