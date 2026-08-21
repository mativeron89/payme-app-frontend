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
describe('un solo camino de publicación · y sus gates, leídos de los PASOS', () => {
  const DIR = join(RAIZ, '.github', 'workflows');

  /**
   * 🔴 P50-02/03 · SIN COMENTARIOS Y SIN SUBSTRINGS — las dos formas en que
   * esta guarda mentía, encontradas por Codex el mismo día.
   *
   * ① **Reconocía TRES cadenas** para decidir si un workflow publica, así que
   *    un `- run: npx vercel --prod` la dejaba **20/20 verde**. Lo refutado no
   *    era un detalle: era la garantía que yo había escrito con todas las
   *    letras — *«un camino nuevo aparece solo»*.
   * ② **Acreditaba los cinco gates con un regex sobre el TEXTO COMPLETO**, así
   *    que reemplazar el paso real de Playwright por **un comentario que
   *    conserva la frase** también quedaba verde. El comentario certificando la
   *    guarda que reemplazó, otra vez.
   *
   * Ahora: **los comentarios se borran antes de mirar**, los gates se buscan en
   * líneas `run:`/`uses:` **que PRECEDEN a la publicación**, y el conjunto de
   * workflows se compara **exacto** — cualquiera que no sea `ci.yml` es rojo
   * hasta que alguien lo adjudique. Es la opción más chica y fail-closed con el
   * árbol de hoy: **no hay heurística que decida si un workflow desconocido
   * publica; lo decide una persona.**
   */
  const sinComentarios = (yml: string) =>
    yml.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

  it('🔴 el conjunto de workflows es EXACTAMENTE el adjudicado', () => {
    const archivos = readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f)).sort();
    expect(
      archivos,
      `apareció o desapareció un workflow. Cualquiera que no sea \`ci.yml\` es rojo hasta ` +
        `adjudicarlo: hay que decidir si publica, si se gatea o si se retira — no dejarlo pasar ` +
        `porque «no parece» publicar.`,
    ).toEqual(['ci.yml']);
  });

  it('🔴 los CINCO gates son pasos REALES y preceden a la publicación', () => {
    const yml = sinComentarios(readFileSync(join(DIR, 'ci.yml'), 'utf8'));
    const lineas = yml.split('\n');
    const iPublica = lineas.findIndex((l) => /^\s*(- )?run:.*publicar-vercel\.sh|publicar-vercel\.sh/.test(l));
    // Control positivo: sin el paso de publicación, «todos preceden» sería
    // trivialmente cierto y este test pasaría sobre un CI que no publica nada.
    expect(iPublica, 'no se encontró el paso de publicación: el test mediría en vacío').toBeGreaterThan(0);

    const GATES: ReadonlyArray<readonly [string, RegExp]> = [
      ['espejo', /verificar-mirror\.mjs/],
      ['test', /npm test\b/],
      ['typecheck', /npm run typecheck/],
      ['build', /npm run build\b/],
      ['playwright', /playwright test/],
    ];
    const faltan: string[] = [];
    for (const [nombre, re] of GATES) {
      const i = lineas.findIndex((l, k) => k < iPublica && /^\s*(- )?(run|uses):/.test(l) && re.test(l));
      if (i < 0) faltan.push(nombre);
    }
    expect(
      faltan,
      `el único camino de publicación dejó de verificar (como PASO real, antes de publicar): ${faltan.join(' · ')}`,
    ).toEqual([]);
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
