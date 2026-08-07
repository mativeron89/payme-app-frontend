import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * EL GATE DEL ESPEJO, PROBADO COMO CAJA NEGRA (ORDEN 1-C·C, ampliado en R3-A).
 *
 * El verificador decide si el contrato copiado sigue siendo el que el emisor
 * publicó — y hasta el 2026-08-06 **reportaba diferencias y devolvía exit 0**.
 * Después cortó, pero su población salía de un manifiesto que él mismo
 * generaba desde el espejo: **el inventariado se inventariaba a sí mismo**, y
 * una omisión coordinada (borrar y regenerar) pasaba en verde. Desde R3-A la
 * población la declara el DUEÑO.
 *
 * Se ejercita el script REAL copiándolo a un árbol temporal con la misma
 * forma (`scripts/` + `contract-mirror/` hermanos, más un repo git de
 * mentira como fuente). Copiar no es instrumentar: si se lo modificara para
 * hacerlo testeable, se probaría otra cosa.
 */

let raiz: string;
let scripts: string;
let espejo: string;
let fuente: string;

const SCRIPT_REAL = join(__dirname, 'verificar-mirror.mjs');

function correr(...args: string[]): number {
  try {
    execFileSync('node', [join(scripts, 'verificar-mirror.mjs'), ...args], {
      stdio: 'pipe',
      env: { ...process.env, PAYME_APP_BACKEND_DIR: fuente },
    });
    return 0;
  } catch (e) {
    return (e as { status?: number }).status ?? -1;
  }
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** Contenido de los archivos del contrato de mentira: origen → cuerpo. */
const CONTRATO: Record<string, string> = {
  'routes/auth.js': 'module.exports = "auth";\n',
  'routes/mesas.js': 'module.exports = "mesas";\n',
  'services/settlement.js': 'module.exports = "settlement";\n',
};
/** El espejo RENOMBRA: el mapeo lo declara el inventario, no una convención. */
const DESTINO: Record<string, string> = {
  'routes/auth.js': 'routes/auth.js',
  'routes/mesas.js': 'routes/mesas.js',
  'services/settlement.js': 'docs/settlement.js.ref',
};

function escribir(base: string, rel: string, cuerpo: string) {
  const abs = join(base, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, cuerpo);
}

function inventario(commit: string) {
  const archivos = Object.keys(CONTRATO).map((origen) => ({
    origen,
    destino: DESTINO[origen]!,
    sha256: sha(CONTRATO[origen]!),
    bytes: CONTRATO[origen]!.length,
  }));
  return { version: 1, commit, total: archivos.length, archivos };
}

function git(...args: string[]): string {
  return execFileSync('git', ['-C', fuente, ...args], { encoding: 'utf8' }).trim();
}

beforeEach(() => {
  raiz = mkdtempSync(join(tmpdir(), 'mirror-gate-'));
  scripts = join(raiz, 'scripts');
  espejo = join(raiz, 'contract-mirror');
  fuente = join(raiz, 'backend');
  mkdirSync(scripts, { recursive: true });
  mkdirSync(espejo, { recursive: true });
  mkdirSync(fuente, { recursive: true });
  copyFileSync(SCRIPT_REAL, join(scripts, 'verificar-mirror.mjs'));

  // La FUENTE es un repo git real con el contrato de mentira commiteado: el
  // verificador lee con `git show <commit>:<origen>`, así que necesita uno.
  git('init', '-q');
  git('config', 'user.email', 'test@payme.invalid');
  git('config', 'user.name', 'test');
  for (const [rel, cuerpo] of Object.entries(CONTRATO)) escribir(fuente, rel, cuerpo);
  git('add', '-A');
  git('commit', '-qm', 'contrato de mentira');
  const commit = git('rev-parse', 'HEAD');

  // El espejo, con los RENOMBRES aplicados, y el inventario del "dueño".
  for (const [origen, cuerpo] of Object.entries(CONTRATO)) escribir(espejo, DESTINO[origen]!, cuerpo);
  escribir(espejo, 'README.md', '# procedencia — no se inventaría\n');
  writeFileSync(join(scripts, 'mirror-inventory.json'), JSON.stringify(inventario(commit), null, 2));
});

afterEach(() => {
  rmSync(raiz, { recursive: true, force: true });
});

describe('integridad local · el espejo contra el inventario del dueño', () => {
  it('espejo fiel → 0, incluidos los archivos RENOMBRADOS', () => {
    expect(correr('--integridad')).toBe(0);
  });

  it('un archivo CAMBIADO → 1 (el defecto original: esto devolvía 0)', () => {
    escribir(espejo, 'routes/mesas.js', 'module.exports = "otra cosa";\n');
    expect(correr('--integridad')).toBe(1);
  });

  it('un archivo BORRADO del espejo → 1', () => {
    rmSync(join(espejo, 'routes/mesas.js'));
    expect(correr('--integridad')).toBe(1);
  });

  it('un archivo DE MÁS (intruso) → 1 · la dirección que el verificador viejo callaba', () => {
    escribir(espejo, 'routes/colado.js', 'no lo declaró el dueño\n');
    expect(correr('--integridad')).toBe(1);
  });

  /**
   * 🔴 EL BUG DE PREFIJO, MUERTO. El chequeo viejo hacía `grep -F "  $rel"`,
   * anclado sólo por la izquierda: `routes/auth` matcheaba la entrada
   * `routes/auth.js` y el intruso pasaba como inventariado. Acá la pertenencia
   * es igualdad exacta contra un Set — la clase no existe, no está tapada.
   * (Este caso llevaba `test.fails` mientras la orden prohibía tocar el
   * verificador; R3-A lo autorizó y el marcador se retiró, como correspondía.)
   */
  it('🔴 un intruso que es PREFIJO de un archivo declarado → 1', () => {
    escribir(espejo, 'routes/auth', 'intruso disfrazado de prefijo\n');
    expect(correr('--integridad')).toBe(1);
  });

  it('el README no se inventaría: cambiarlo no rompe nada', () => {
    // Es procedencia, no contrato — por eso se lo puede editar (marcar un
    // cierre como provisional, por ejemplo) sin tocar el inventario del dueño.
    escribir(espejo, 'README.md', '# otra prosa\n');
    expect(correr('--integridad')).toBe(0);
  });

  it('sin inventario → 2 · el que no puede verificar FALLA, no aprueba', () => {
    rmSync(join(scripts, 'mirror-inventory.json'));
    expect(correr('--integridad')).toBe(2);
  });

  it('un inventario con total mentiroso → 1', () => {
    const inv = JSON.parse(readFileSync(join(scripts, 'mirror-inventory.json'), 'utf8'));
    inv.total = 99;
    writeFileSync(join(scripts, 'mirror-inventory.json'), JSON.stringify(inv));
    expect(correr('--integridad')).toBe(1);
  });
});

describe('paridad · la fuente respalda al inventario', () => {
  it('todo coherente → 0', () => {
    expect(correr('--paridad')).toBe(0);
  });

  it('🔴 fuente ausente → 2 NO CERTIFICADO, nunca un verde de paridad', () => {
    rmSync(fuente, { recursive: true, force: true });
    expect(correr('--paridad')).toBe(2);
  });

  it('🔴 hash declarado inexistente → 2', () => {
    const inv = JSON.parse(readFileSync(join(scripts, 'mirror-inventory.json'), 'utf8'));
    inv.commit = 'f'.repeat(40);
    writeFileSync(join(scripts, 'mirror-inventory.json'), JSON.stringify(inv));
    expect(correr('--paridad')).toBe(2);
  });

  /**
   * 🔴 LA OMISIÓN COORDINADA — el defecto que R3-A vino a cerrar. Con el
   * manifiesto auto-generado, borrar un archivo del espejo y regenerar el
   * inventario daba verde: la población salía del propio espejo. Con el
   * inventario del DUEÑO, el archivo que falta se ve contra la fuente.
   */
  it('🔴 quitar un archivo del espejo Y del inventario local → sigue rojo contra la fuente', () => {
    rmSync(join(espejo, 'routes/mesas.js'));
    const inv = JSON.parse(readFileSync(join(scripts, 'mirror-inventory.json'), 'utf8'));
    inv.archivos = inv.archivos.filter((a: { origen: string }) => a.origen !== 'routes/mesas.js');
    inv.total = inv.archivos.length;
    writeFileSync(join(scripts, 'mirror-inventory.json'), JSON.stringify(inv));
    // La integridad local no puede verlo —el inventario adulterado es coherente
    // consigo mismo— y por eso la integridad NO se llama paridad…
    expect(correr('--integridad')).toBe(0);
    // …pero adoptar ese inventario contra la fuente REAL no pasa: el dueño
    // declara 3 archivos y el candidato trae 2.
    const delDuenio = join(raiz, 'inv-del-dueno.json');
    writeFileSync(delDuenio, JSON.stringify(inventario(git('rev-parse', 'HEAD'))));
    expect(correr('--adoptar-inventario', delDuenio)).toBe(1);
  });

  it('🔴 un sha256 adulterado en el inventario → 1: el inventario es INFIEL a su commit', () => {
    // El caso "corromper y regenerar": el espejo y el inventario coinciden
    // entre sí, pero el commit declarado dice otra cosa.
    const cuerpoFalso = 'module.exports = "adulterado";\n';
    escribir(espejo, 'routes/mesas.js', cuerpoFalso);
    const inv = JSON.parse(readFileSync(join(scripts, 'mirror-inventory.json'), 'utf8'));
    for (const a of inv.archivos) if (a.origen === 'routes/mesas.js') a.sha256 = sha(cuerpoFalso);
    writeFileSync(join(scripts, 'mirror-inventory.json'), JSON.stringify(inv));
    expect(correr('--integridad')).toBe(0); // coherente consigo mismo…
    expect(correr('--paridad')).toBe(1); // …y desmentido por la fuente.
  });
});

describe('vigencia · pregunta SEPARADA de la paridad', () => {
  it('la fuente avanza SIN tocar lo espejado → sigue vigente (0)', () => {
    // La lección del dueño: su gate gritaba con cada commit posterior aunque
    // el contrato no se moviera, y un gate que grita por lo que no es un
    // desvío se termina ignorando.
    escribir(fuente, 'README.md', 'un cambio que no es contrato\n');
    git('add', '-A');
    git('commit', '-qm', 'commit posterior, contrato intacto');
    expect(correr('--vigencia')).toBe(0);
  });

  it('la fuente CAMBIA un archivo espejado → desactualizado (1), sin ensuciar la paridad', () => {
    escribir(fuente, 'routes/mesas.js', 'module.exports = "v2";\n');
    git('add', '-A');
    git('commit', '-qm', 'el contrato se movió');
    expect(correr('--paridad')).toBe(0); // el espejo sigue fiel a SU commit…
    expect(correr('--vigencia')).toBe(1); // …pero quedó viejo.
  });
});

describe('adoptar inventario · nunca bendice sin verificar', () => {
  it('el inventario del dueño se adopta sólo si verifica contra espejo Y fuente', () => {
    const delDuenio = join(raiz, 'inv.json');
    writeFileSync(delDuenio, JSON.stringify(inventario(git('rev-parse', 'HEAD'))));
    expect(correr('--adoptar-inventario', delDuenio)).toBe(0);
  });

  it('🔴 si el espejo no coincide, NO se adopta (el reemplazado bendecía cualquier cosa)', () => {
    escribir(espejo, 'routes/mesas.js', 'desviado\n');
    const delDuenio = join(raiz, 'inv.json');
    writeFileSync(delDuenio, JSON.stringify(inventario(git('rev-parse', 'HEAD'))));
    const antes = readFileSync(join(scripts, 'mirror-inventory.json'), 'utf8');
    expect(correr('--adoptar-inventario', delDuenio)).toBe(1);
    // Y no lo escribió: un gate que falla no puede dejar rastro de éxito.
    expect(readFileSync(join(scripts, 'mirror-inventory.json'), 'utf8')).toBe(antes);
  });
});
