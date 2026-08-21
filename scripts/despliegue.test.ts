import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * ⭐ LA COMPUERTA DE PUBLICACIÓN · que corte de verdad, no que lo diga.
 *
 * ## El defecto que la motivó, medido en `a79c6a3` (2026-08-10)
 *
 *     push                     06:01:05Z
 *     ÁPICE PUBLICADO (Vercel) 06:03:01Z   ← producción viva
 *     CI termina               06:05:56Z   ← 2 m 55 s DESPUÉS
 *
 * Producción salía antes de que terminara la verificación, y el único gate que
 * existía —el de Pages— **protegía la copia que nadie visita**.
 *
 * ## 🔴 Qué se acredita EJECUTANDO y qué sólo por LECTURA
 *
 * No las mezclo, porque valen distinto:
 *
 *   EJECUTANDO   (a) `publicar-vercel.sh` contra un servidor real que contesta
 *                200, 429, 500 y que se cae; y (b) **el cuerpo literal del
 *                `run:` extraído del `.yml`**, con `curl` sustituido. Es la
 *                condición 3 de la orden —«si el curl falla, el job falla»— y
 *                es la que más importa: un curl que informa y no corta deja
 *                creyendo que se publicó.
 *
 *   POR LECTURA  sólo el condicional (`success()`, `push`, `main`), que lo
 *                evalúa Actions. **Queda declarado como no ejecutado**, no
 *                disfrazado de verificación.
 *
 * 🔴 (b) SE AGREGÓ DESPUÉS, y tapa un hueco de (a). Probar el script no prueba
 * que el workflow lo INVOQUE: si alguien reescribe esas dos líneas del `run:`,
 * le saca un `"$HOOK_LANDING"` o le agrega un `|| true`, las sondas de (a)
 * siguen todas en verde. Método tomado de Dashboard Frontend: **se prueba el
 * workflow, no una reescritura propia del workflow.**
 */

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..');
const SCRIPT = join(AQUI, 'publicar-vercel.sh');

/**
 * Corre el script como lo corre el CI y devuelve su veredicto crudo.
 *
 * 🔴 ASÍNCRONO, Y NO ES UN DETALLE. La primera versión usaba `spawnSync`, que
 * **bloquea el event loop de Node** — el mismo loop donde vive el servidor de
 * prueba de más abajo. Resultado: `curl` esperaba una respuesta que el servidor
 * no podía dar porque el loop estaba tomado, hasta agotar `--max-time` en cada
 * reintento. **La suite colgó más de 120 s; el script solo tarda 4.**
 *
 * Se deadlockeó mi propia sonda. Vale anotarlo porque el síntoma —«el gate es
 * lentísimo»— invita a subir el timeout, y el timeout no tenía nada que ver.
 */
function publicar(url: string): Promise<{ code: number; out: string }> {
  return new Promise((resolver) => {
    execFile('bash', [SCRIPT, 'app-de-prueba', url], { encoding: 'utf8' }, (err, out, errOut) => {
      const code = err && typeof err.code === 'number' ? err.code : err ? -1 : 0;
      resolver({ code, out: `${out}${errOut}` });
    });
  });
}

describe('EJECUTANDO · el disparo corta cuando el hook no acepta', () => {
  let servidor: Server;
  let puerto = 0;
  /** Lo decide cada test antes de disparar. */
  let responder: 200 | 500 | 429 = 200;
  let recibidos = 0;

  beforeAll(async () => {
    servidor = createServer((_req, res) => {
      recibidos += 1;
      res.writeHead(responder).end();
    });
    await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
    const dir = servidor.address();
    puerto = typeof dir === 'object' && dir ? dir.port : 0;
    expect(puerto, 'el servidor de prueba no levantó: los tests medirían en vacío')
      .toBeGreaterThan(0);
  });

  afterAll(async () => {
    await new Promise<void>((ok) => servidor.close(() => ok()));
  });

  it('✅ CASO LEGÍTIMO · con 200 el script sale 0 y el CI sigue', async () => {
    responder = 200;
    const antes = recibidos;
    const r = await publicar(`http://127.0.0.1:${puerto}/hook`);
    expect(recibidos, 'el script no llegó a disparar nada').toBe(antes + 1);
    expect(r.code, `salió ≠0 con un hook sano:\n${r.out}`).toBe(0);
    expect(r.out).toContain('✅');
  });

  it('🔴 MUTANTE · con 500 el script SALE ≠0 · el job tiene que caer', async () => {
    responder = 500;
    const r = await publicar(`http://127.0.0.1:${puerto}/hook`);
    expect(r.code, `aprobó un hook que contestó 500:\n${r.out}`).not.toBe(0);
    expect(r.out).toContain('500');
    expect(r.out).toContain('NO se publicó');
  });

  it('🔴 MUTANTE · con 429 tampoco pasa: sólo 2xx publica', async () => {
    responder = 429;
    const r = await publicar(`http://127.0.0.1:${puerto}/hook`);
    expect(r.code, 'un 429 no es una publicación').not.toBe(0);
  });

  it('🔴 MUTANTE · si no hay nadie escuchando, el script SALE ≠0', async () => {
    // Puerto 1: privilegiado y sin servicio. `--retry-connrefused` reintenta y
    // después se rinde, que es justo lo que tiene que pasar.
    const r = await publicar('http://127.0.0.1:1/hook');
    expect(r.code, `un hook inalcanzable no puede dar por publicado:\n${r.out}`).not.toBe(0);
  });

  it('🔴 FAIL-CLOSED · con el secreto vacío no dispara y avisa', async () => {
    const antes = recibidos;
    const r = await publicar('');
    expect(r.code, 'un secreto ausente no puede pasar en silencio').not.toBe(0);
    expect(recibidos, 'disparó algo con la URL vacía').toBe(antes);
    expect(r.out).toContain('Deploy Hook');
  });

  it('🔴 el script NO imprime la URL del hook · es el secreto', async () => {
    responder = 200;
    const url = `http://127.0.0.1:${puerto}/hook-con-token-secretisimo`;
    const r = await publicar(url);
    expect(r.out, 'la URL del hook salió al log').not.toContain('hook-con-token-secretisimo');
    expect(r.out, 'tampoco el host').not.toContain(String(puerto));
  });
});

/**
 * 🔴 POR LECTURA, y lo digo: esto NO se ejecutó.
 *
 * ⚠️ Es lo ÚNICO que queda sin ejecutar. El cuerpo del `run:` sí se corre —ver
 * el bloque de más abajo—; lo que no se puede correr es el CONDICIONAL, porque
 * `success()`, `github.event_name` y `github.ref` los evalúa Actions y verlos
 * en rojo exigiría romper producción a propósito.
 *
 * Lo que sigue afirma sobre el TEXTO del YAML: vale para que nadie afloje el
 * condicional sin querer, no como prueba de que Actions se comporta así.
 */
describe('POR LECTURA · el condicional del workflow (no ejecutado)', () => {
  const ci = readFileSync(join(RAIZ, '.github', 'workflows', 'ci.yml'), 'utf8');

  it('🔴 el paso de publicar existe y es el ÚLTIMO', () => {
    // Por POSICIÓN, no por conteo desde un `indexOf`: la primera versión
    // cortaba con `slice(indexOf('- name: …'))`, que empieza DESPUÉS de la
    // sangría, así que el ancla `^ {6}` ya no matcheaba el propio paso y el
    // test se caía solo. El instrumento fallaba, no el workflow.
    const pasos = [...ci.matchAll(/^ {6}- (?:name|run|uses):.*$/gm)];
    expect(pasos.length, 'no se parsearon pasos: el barrido mide en vacío').toBeGreaterThan(5);

    const publicar = pasos.filter((p) => p[0].includes('Publicar en Vercel'));
    expect(publicar.length, 'no está el paso de publicación, o está dos veces').toBe(1);

    // Nada ejecutable después. Si alguien agrega un paso abajo, esto cae y hay
    // que decidir a conciencia si va antes o después de publicar — porque
    // después de publicar ya no protege nada.
    expect(
      pasos[pasos.length - 1]![0],
      'quedó un paso DESPUÉS de publicar: ya no lo gatea nada',
    ).toContain('Publicar en Vercel');
  });

  it('🔴 las tres condiciones están en el `if`', () => {
    const linea = ci.split('\n').find((l) => l.trim().startsWith('if:') && l.includes('success()'));
    expect(linea, 'el paso de publicar no condiciona por success()').toBeDefined();
    expect(linea).toContain("github.event_name == 'push'");
    expect(linea).toContain("github.ref == 'refs/heads/main'");
  });

  it('🔴 los hooks viajan por `secrets`, nunca escritos en el YAML', () => {
    expect(ci).toContain('${{ secrets.VERCEL_HOOK_APP }}');
    expect(ci).toContain('${{ secrets.VERCEL_HOOK_LANDING }}');
    expect(ci, 'hay una URL de hook escrita a mano').not.toMatch(/api\/deploy\/prj_/);
    expect(ci, 'hay un hook de vercel hardcodeado').not.toMatch(/vercel\.com\/v1\/integrations/);
  });
});

/**
 * 🔴 EJECUTANDO EL CUERPO REAL DEL `run:` · el hueco que dejaba lo de arriba.
 *
 * Los tests de más arriba corren `publicar-vercel.sh`, que es lo que el
 * workflow invoca. **Pero no verifican que el workflow lo invoque.** Si alguien
 * reescribe esas dos líneas del `run:` —o le saca un `"$HOOK_LANDING"`, o le
 * agrega un `|| true`— mis sondas siguen todas en verde.
 *
 * Método tomado de Dashboard Frontend, que lo acreditó mejor: **se extrae el
 * cuerpo del `.yml` y se ejecuta**, con `curl` sustituido por un doble que
 * contesta lo que el caso pida. Se prueba el workflow, no una reescritura mía
 * del workflow.
 *
 * Se invoca igual que Actions —`bash --noprofile --norc -eo pipefail`—, porque
 * ese `-e` es parte del comportamiento: sin él, si el disparo de `app` falla,
 * el de `landing` correría igual y el paso terminaría en 0.
 */
describe('EJECUTANDO el `run:` del workflow · con curl sustituido', () => {
  const ciTexto = readFileSync(join(RAIZ, '.github', 'workflows', 'ci.yml'), 'utf8');

  /** El cuerpo literal del `run: |` del paso de publicación. */
  const cuerpo = (() => {
    const lineas = ciTexto.split('\n');
    const i = lineas.findIndex((l) => l.includes('- name: Publicar en Vercel'));
    const j = lineas.findIndex((l, k) => k > i && l.trim() === 'run: |');
    const sangria = (lineas[j]!.match(/^\s*/)?.[0].length ?? 0) + 2;
    const out: string[] = [];
    for (let k = j + 1; k < lineas.length; k += 1) {
      const l = lineas[k]!;
      if (l.trim() && !l.startsWith(' '.repeat(sangria))) break;
      out.push(l.slice(sangria));
    }
    return out.join('\n').trimEnd();
  })();

  const URL_FALSA = 'https://api.vercel.com/v1/integrations/deploy/prj_FALSO/tokenSECRETO123';

  /**
   * Corre el cuerpo con un `curl` doble adelante en el PATH.
   * `codigo` es lo que el doble imprime; `salida` con qué exit code termina.
   */
  function correrCuerpo(codigo: string, salida: number): Promise<{ code: number; out: string }> {
    const dir = mkdtempSync(join(tmpdir(), 'payme-hook-'));
    writeFileSync(
      join(dir, 'curl'),
      `#!/usr/bin/env bash\nprintf '%s' "${codigo}"\nexit ${salida}\n`,
      { mode: 0o755 },
    );
    writeFileSync(join(dir, 'cuerpo.sh'), cuerpo);
    return new Promise((resolver) => {
      execFile(
        'bash',
        ['--noprofile', '--norc', '-eo', 'pipefail', join(dir, 'cuerpo.sh')],
        {
          cwd: RAIZ,
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${dir}:${process.env.PATH ?? ''}`,
            HOOK_APP: URL_FALSA,
            HOOK_LANDING: URL_FALSA,
          },
        },
        (err, out, errOut) => {
          rmSync(dir, { recursive: true, force: true });
          const code = err && typeof err.code === 'number' ? err.code : err ? -1 : 0;
          resolver({ code, out: `${out}${errOut}` });
        },
      );
    });
  }

  it('🔴 el cuerpo se extrajo de verdad · si viniera vacío, todo pasaría en vacío', () => {
    expect(cuerpo.length, 'no se extrajo el `run:` del paso').toBeGreaterThan(40);
    expect(cuerpo, 'el cuerpo no dispara el hook de app').toContain('publicar-vercel.sh app');
    expect(cuerpo, 'el cuerpo no dispara el hook de landing').toContain('publicar-vercel.sh landing');
    expect(cuerpo, 'alguien le puso un escape que anula el corte').not.toMatch(/\|\|\s*true|;\s*exit 0/);
  });

  it('✅ 200 · el paso termina en 0 y publica los DOS proyectos', async () => {
    const r = await correrCuerpo('200', 0);
    expect(r.code, `el paso falló con dos hooks sanos:\n${r.out}`).toBe(0);
    expect(r.out).toContain('app');
    expect(r.out, 'no llegó a disparar landing: el `-e` cortó antes o falta la línea')
      .toContain('landing');
  });

  for (const codigo of ['401', '500'] as const) {
    it(`🔴 ${codigo} · el paso FALLA · nada se da por publicado`, async () => {
      const r = await correrCuerpo(codigo, 0);
      expect(r.code, `el paso aprobó un hook que contestó ${codigo}:\n${r.out}`).not.toBe(0);
      expect(r.out).toContain(codigo);
    });
  }

  it('🔴 curl falla (red) · el paso FALLA', async () => {
    const r = await correrCuerpo('', 7);
    expect(r.code, `un curl caído no puede dar por publicado:\n${r.out}`).not.toBe(0);
  });

  it('🔴 y en los CUATRO casos la URL del hook NO aparece en la salida', async () => {
    const salidas = await Promise.all([
      correrCuerpo('200', 0),
      correrCuerpo('401', 0),
      correrCuerpo('500', 0),
      correrCuerpo('', 7),
    ]);
    expect(salidas.length, 'no se corrió ningún caso').toBe(4);
    for (const s of salidas) {
      expect(s.out, `la URL del hook salió al log:\n${s.out}`).not.toContain('tokenSECRETO123');
      expect(s.out).not.toContain('prj_FALSO');
    }
  });
});

describe('vercel.json · el despliegue automático sigue apagado', () => {
  it('🔴 `main` NO despliega solo · si alguien lo enciende, esto cae', () => {
    const v = JSON.parse(readFileSync(join(RAIZ, 'vercel.json'), 'utf8')) as {
      git?: { deploymentEnabled?: Record<string, boolean> };
    };
    expect(
      v.git?.deploymentEnabled?.main,
      'volvió el despliegue automático: producción publicaría antes que el CI',
    ).toBe(false);
  });

  /**
   * `vercel.json` no puede llevar el motivo adentro —es JSON estricto y una
   * clave desconocida puede invalidar la configuración de despliegue entera—,
   * así que el motivo vive en un documento. **Esto exige que ese documento
   * exista y siga explicando lo que hay que saber**: sin él, el `false` de
   * arriba es un número sin historia que alguien flipea en seis meses.
   */
  it('🔴 y el porqué está escrito donde alguien lo va a buscar', () => {
    const doc = readFileSync(join(RAIZ, 'docs', 'DESPLIEGUE_GATEADO.md'), 'utf8');
    expect(doc).toContain('deploymentEnabled');
    expect(doc, 'el doc no trae la medición que motivó el gate').toContain('06:03:01');
    expect(doc, 'no advierte sobre los dos proyectos').toContain('Root Directory');
    expect(doc, 'no declara el retiro del camino de Pages').toContain('deploy-demo.yml');
  });
});

/**
 * 🔴 YA NO HAY DOS CAMINOS · el de Pages se retiró el 2026-08-21.
 *
 * Acá vivía la guarda que MEDÍA la divergencia entre los dos pipelines:
 * `ci.yml` corría espejo + Playwright y `deploy-demo.yml` no, así que un commit
 * que reprobaba Playwright **se publicaba en Pages y no en Vercel** — las dos
 * superficies divergían con **la menos verificada arriba**.
 *
 * Esa guarda hizo su trabajo: midió la divergencia hasta que se decidió
 * retirarla. **Lo que la reemplaza no es menos, es otra afirmación**: que hay
 * **UN SOLO** camino de publicación, y que es el gateado.
 *
 * ⚠️ **Y se deriva del árbol, no de una lista.** Un workflow «publica» si
 * despliega Pages o llama al script de Vercel; se detecta escaneando
 * `.github/workflows/`, así que **un workflow nuevo que publique aparece solo**
 * en vez de necesitar que alguien se acuerde de agregarlo acá. Es la misma
 * lección que costó cuatro vueltas en el censo de la pantalla de pago: una
 * lista de lo conocido falla abierta.
 */
/**
 * 🔴 P53-03/04 · UN PARSER DE PASOS, porque el regex sobre el texto MIENTE.
 *
 * Codex mostró las dos formas en que mentía, y son la misma familia:
 * ① **un segundo publicador DENTRO del archivo permitido** —`- run: npx vercel
 *    --prod` antes de los gates— quedaba invisible: yo censaba el conjunto de
 *    ARCHIVOS y no sus PASOS;
 * ② **mencionar un gate no es ejecutarlo**: `- run: echo "npm test"` y un
 *    `uses:` con `# npm test` al lado dejaban la suite verde.
 *
 * Lo que sigue no es «mejores regex»: es leer los pasos como pasos. Se separan
 * `uses:` de `run:`, se respeta que un `#` dentro de comillas **no** abre
 * comentario, y un gate cuenta sólo si algún **segmento de comando** EMPIEZA
 * con él — así `echo "npm test"` empieza con `echo` y no cuenta.
 */
interface Paso {
  nombre: string;
  uses: string | null;
  run: string | null;
  /**
   * 🔴 P55 · LOS DOS METADATOS QUE DECIDEN SI UN PASO CORRE Y SI BLOQUEA.
   *
   * Codex mostró que **leer el paso no es leer si el paso CORRE**: con
   * `if: false`, GitHub **no lo ejecuta**, y con `continue-on-error: true` lo
   * ejecuta pero **tolera su fallo**. Los dos dejaban la suite 21/21 verde
   * porque yo guardaba `run`/`uses` y tiraba el resto — o sea que probaba que
   * el gate **está escrito**, no que **gatea**.
   */
  condicion: string | null;
  toleraError: string | null;
  linea: number;
}

/** Quita el comentario YAML de una línea respetando comillas. */
function sinComentario(l: string): string {
  let dentro: string | null = null;
  for (let i = 0; i < l.length; i++) {
    const c = l[i]!;
    if (dentro) { if (c === dentro) dentro = null; continue; }
    if (c === '"' || c === "'") { dentro = c; continue; }
    if (c === '#') return l.slice(0, i);
  }
  return l;
}

function pasosDe(yml: string): Paso[] {
  const lineas = yml.split('\n');
  const pasos: Paso[] = [];
  let actual: Paso | null = null;
  let bloque: { indent: number; partes: string[] } | null = null;

  const cerrar = () => { if (actual) pasos.push(actual); actual = null; bloque = null; };

  for (let i = 0; i < lineas.length; i++) {
    const cruda = lineas[i]!;
    if (bloque) {
      const indent = cruda.search(/\S/);
      if (cruda.trim() === '' || indent > bloque.indent) { bloque.partes.push(sinComentario(cruda)); continue; }
      actual!.run = bloque.partes.join('\n');
      bloque = null;
    }
    const l = sinComentario(cruda);
    if (/^\s*-\s+(name|uses|run|if):/.test(l)) { cerrar(); actual = { nombre: '', uses: null, run: null, condicion: null, toleraError: null, linea: i + 1 }; }
    if (!actual) continue;
    const m = l.match(/^\s*(?:-\s+)?(name|uses|run|if|continue-on-error):\s*(.*)$/);
    if (!m) continue;
    const [, clave, valor] = m;
    if (clave === 'name') actual.nombre = valor!.trim();
    else if (clave === 'if') actual.condicion = valor!.trim();
    else if (clave === 'continue-on-error') actual.toleraError = valor!.trim();
    else if (clave === 'uses') actual.uses = valor!.trim();
    else if (clave === 'run') {
      if (valor!.trim() === '|' || valor!.trim() === '|-') bloque = { indent: cruda.search(/\S/), partes: [] };
      else actual.run = valor!.trim();
    }
  }
  cerrar();
  return pasos;
}

/**
 * Los comandos efectivos de un `run:`, partidos por separadores de shell.
 *
 * 🔴 **No se parte a ciegas, y el primer intento sí lo hacía:** el paso de
 * secretos lleva `"${{ a || b || 'HEAD^' }}"` —una expresión de GitHub con `||`
 * ADENTRO— y quedaba troceada en pedazos que después figuraban como «pasos sin
 * adjudicar». El separador tiene que respetar comillas y `${{ … }}`, o el
 * fail-closed empieza a denunciar cosas que no existen **y a alguien se le
 * ocurre aflojarlo para que calle**.
 */
/**
 * 🔴 P55 · EVALUACIÓN ANIDADA — **leer el comando no es leer lo que EVALÚA.**
 *
 * Codex: `bash scripts/reportar-flaky.sh … "$(npx vercel --prod)"`. El shell
 * evalúa la sustitución **ANTES** de invocar el script, así que el allowlist
 * —que acepta por PREFIJO— lo daba por adjudicado: el prefijo es el script
 * permitido y lo peligroso viaja adentro, como argumento.
 *
 * 🔴 **No se cierra listando formas malas.** Se declara al revés: **si un
 * comando contiene evaluación anidada, este arnés NO PUEDE decir qué ejecuta**,
 * y lo que no se puede decidir no se aprueba. `$( )`, backticks, `eval` y
 * `bash -c` son las formas que hoy sé nombrar; el punto no es la lista, es que
 * la respuesta ante cualquiera de ellas es **«no sé», y «no sé» es rojo**.
 */
function evaluacionAnidada(cmd: string): string | null {
  if (/\$\(/.test(cmd)) return 'sustitución `$(…)`';
  if (/`/.test(cmd)) return 'sustitución con backticks';
  if (/(^|\s)eval(\s|$)/.test(cmd)) return '`eval`';
  if (/(^|\s)bash\s+-c(\s|$)/.test(cmd)) return '`bash -c`';
  return null;
}

function comandosDe(run: string): string[] {
  const partes: string[] = [];
  let actual = '';
  let cita: string | null = null;
  let expr = 0;
  for (let i = 0; i < run.length; i++) {
    const c = run[i]!;
    const dos = run.slice(i, i + 2);
    if (cita) { actual += c; if (c === cita) cita = null; continue; }
    if (c === '"' || c === "'") { cita = c; actual += c; continue; }
    if (dos === '${' && run.slice(i, i + 3) === '${{') { expr++; actual += dos; i++; continue; }
    if (expr > 0 && dos === '}}') { expr--; actual += dos; i++; continue; }
    if (expr === 0) {
      if (dos === '&&' || dos === '||') { partes.push(actual); actual = ''; i++; continue; }
      if (c === '\n' || c === ';' || c === '|') { partes.push(actual); actual = ''; continue; }
    }
    actual += c;
  }
  partes.push(actual);
  return partes.map((c) => c.trim()).filter(Boolean);
}

describe('el camino de publicación · leído de los PASOS, no del texto', () => {
  const DIR = join(RAIZ, '.github', 'workflows');

  it('🔴 el conjunto de workflows es EXACTAMENTE el adjudicado', () => {
    const archivos = readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f)).sort();
    expect(
      archivos,
      'apareció o desapareció un workflow. Cualquiera que no sea ci.yml es rojo hasta ' +
        'adjudicarlo: hay que decidir si publica, si se gatea o si se retira.',
    ).toEqual(['ci.yml']);
  });

  /**
   * 🔴 P53-03 · **cada PASO adjudicado, uno por uno.** Exigir que el archivo sea
   * `ci.yml` no dice nada de lo que hay adentro: un `- run: npx vercel --prod`
   * metido antes de los gates dejaba la suite 20/20. Ahora **todo paso que no
   * esté en esta lista es rojo** — y la lista es de lo ADJUDICADO, no de lo
   * prohibido: un mecanismo nuevo no tiene forma de colarse por no parecerse a
   * nada conocido.
   */
  it('🔴 TODO paso del workflow está adjudicado', () => {
    const pasos = pasosDe(readFileSync(join(DIR, 'ci.yml'), 'utf8'));
    expect(pasos.length, 'no se parsearon pasos: el censo mediría en vacío').toBeGreaterThan(8);

    const ADJUDICADOS: RegExp[] = [
      /^actions\/(checkout|setup-node)@/,          // traer el repo y node
      /^bash scripts\/auditar-secretos\.sh\b/,      // gate de secretos
      /^npm ci$/,                                   // dependencias
      /^node scripts\/verificar-mirror\.mjs\b/,     // gate del espejo
      /^npm test$/, /^npm run typecheck$/, /^npm run build$/,
      /^npx playwright install\b/, /^npx playwright test$/,
      /^bash scripts\/reportar-flaky\.sh\b/,        // informa, no bloquea
      /^bash scripts\/publicar-vercel\.sh\b/,       // LA publicación
    ];
    const sinAdjudicar: string[] = [];
    for (const p of pasos) {
      const trozos = p.uses ? [p.uses] : comandosDe(p.run ?? '');
      if (!trozos.length) { sinAdjudicar.push(`línea ${p.linea}: paso sin \`run\` ni \`uses\``); continue; }
      for (const t of trozos) {
        // 🔴 Primero lo indecidible: un prefijo permitido NO adjudica lo que el
        // comando evalúe adentro. El orden importa — si se mirara el allowlist
        // primero, `bash permitido.sh "$(peligroso)"` pasaría por el prefijo.
        const anidada = evaluacionAnidada(t);
        if (anidada) {
          sinAdjudicar.push(`línea ${p.linea}: lleva ${anidada} — no se puede saber qué ejecuta: \`${t}\``);
          continue;
        }
        if (!ADJUDICADOS.some((re) => re.test(t))) sinAdjudicar.push(`línea ${p.linea}: \`${t}\``);
      }
    }
    expect(
      sinAdjudicar,
      'pasos SIN adjudicar en el único camino de publicación — decidí qué son antes de dejarlos:\n  ' +
        sinAdjudicar.join('\n  '),
    ).toEqual([]);
  });

  /**
   * 🔴 P53-04 · **mencionar un gate no es ejecutarlo.** El detector buscaba
   * substrings, así que `- run: echo "npm test"` y un comentario al lado de un
   * `uses:` lo dejaban verde. Ahora un gate cuenta sólo si es el **comienzo de
   * un comando efectivo** dentro de un paso `run:` que **precede** a la
   * publicación.
   */
  it('🔴 los CINCO gates se EJECUTAN, y antes de publicar', () => {
    const pasos = pasosDe(readFileSync(join(DIR, 'ci.yml'), 'utf8'));
    const iPublica = pasos.findIndex((p) => comandosDe(p.run ?? '').some((c) => /^bash scripts\/publicar-vercel\.sh/.test(c)));
    // Control positivo: sin paso de publicación, «todos preceden» sería cierto
    // sobre un CI que no publica nada.
    expect(iPublica, 'no se encontró el paso de publicación: el test mediría en vacío').toBeGreaterThan(0);

    const antes = pasos.slice(0, iPublica).flatMap((p) => comandosDe(p.run ?? ''));
    const GATES: ReadonlyArray<readonly [string, RegExp]> = [
      ['espejo', /^node scripts\/verificar-mirror\.mjs\b/],
      ['test', /^npm test$/],
      ['typecheck', /^npm run typecheck$/],
      ['build', /^npm run build$/],
      ['playwright', /^npx playwright test$/],
    ];
    const faltan = GATES.filter(([, re]) => !antes.some((c) => re.test(c))).map(([n]) => n);
    expect(
      faltan,
      `gates que NO se EJECUTAN antes de publicar (mencionarlos no cuenta): ${faltan.join(' · ')}`,
    ).toEqual([]);
  });

  /**
   * 🔴 P55 · Y ADEMÁS TIENEN QUE CORRER Y BLOQUEAR — que es otra afirmación.
   *
   * El test de arriba prueba que el gate **está como comando** antes de
   * publicar. **No prueba que GitHub lo ejecute ni que su fallo frene nada.**
   * Codex lo mostró con dos mutantes de YAML perfectamente válido, uno por vez:
   *   · `if: false` → el paso **no se ejecuta**;
   *   · `continue-on-error: true` → se ejecuta y **su fallo se tolera**.
   * Los dos dejaban la suite **21/21 verde**: yo guardaba `run`/`uses` y tiraba
   * el resto, así que probaba que el gate **está escrito**, no que **gatea**.
   *
   * La regla es fail-closed y no interpreta condiciones: **un gate con
   * CUALQUIER `if:` es rojo**. No intento evaluar si esa condición es cierta en
   * el evento que publica — eso es un intérprete de expresiones de GitHub, y un
   * intérprete a medias es justo lo que vengo cerrando hace seis vueltas. Si
   * algún día un gate necesita condición, se adjudica a mano y se escribe por
   * qué.
   */
  it('🔴 los gates CORREN y su fallo BLOQUEA: sin `if:` y sin tolerar error', () => {
    const pasos = pasosDe(readFileSync(join(DIR, 'ci.yml'), 'utf8'));
    const iPublica = pasos.findIndex((p) => comandosDe(p.run ?? '').some((c) => /^bash scripts\/publicar-vercel\.sh/.test(c)));
    expect(iPublica, 'no se encontró el paso de publicación').toBeGreaterThan(0);

    const GATES = [
      /^node scripts\/verificar-mirror\.mjs\b/, /^npm test$/, /^npm run typecheck$/,
      /^npm run build$/, /^npx playwright test$/,
    ];
    const problemas: string[] = [];
    for (const p of pasos.slice(0, iPublica)) {
      const cmds = comandosDe(p.run ?? '');
      if (!GATES.some((re) => cmds.some((c) => re.test(c)))) continue;
      if (p.condicion !== null) {
        problemas.push(`línea ${p.linea}: el gate lleva \`if: ${p.condicion}\` — puede no ejecutarse`);
      }
      if (p.toleraError !== null && p.toleraError !== 'false') {
        problemas.push(`línea ${p.linea}: \`continue-on-error: ${p.toleraError}\` — su fallo NO frena la publicación`);
      }
    }
    // Control positivo: si ningún paso matcheara como gate, el bucle no miraría
    // nada y esto pasaría en vacío sobre un CI sin gates.
    const cuantos = pasos.slice(0, iPublica).filter((p) => GATES.some((re) => comandosDe(p.run ?? '').some((c) => re.test(c)))).length;
    expect(cuantos, 'no se reconoció ningún gate: el test mediría en vacío').toBe(5);
    expect(problemas, `gates que están escritos pero no gatean:\n  ${problemas.join('\n  ')}`).toEqual([]);
  });

  it('🔴 el retiro está EXPLICADO donde alguien lo va a buscar', () => {
    // Un workflow que desaparece sin rastro se lee como un borrado accidental
    // seis meses después, y la demo sigue viva en su URL sin que nadie sepa
    // por qué dejó de actualizarse.
    const doc = readFileSync(join(RAIZ, 'docs', 'DESPLIEGUE_GATEADO.md'), 'utf8');
    expect(doc, 'el doc no explica el retiro de Pages').toMatch(/retirad|se retiró/i);
    expect(doc, 'el doc no dice dónde queda la demo').toContain('github.io/payme-app-frontend');
  });
});
