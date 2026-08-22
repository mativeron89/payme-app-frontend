import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { load } from 'js-yaml';
import { leerWorkflow, pasosDeWorkflow, pasosGarantizadosAntesDe } from './yamlWorkflow';

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

  /**
   * 🔴 P71 · LA CONDICIÓN SE CERTIFICA DESDE EL MODELO, NO POR SUBSTRINGS.
   *
   * Esto buscaba **una línea cualquiera** del archivo que empezara con `if:` y
   * contuviera los tres textos. No la ligaba al publicador ni miraba el `if`
   * del JOB. Codex lo rompió de dos formas, las dos con 55/55 verde:
   *
   *   ① `always() || (success() && … push … main)` — SIEMPRE verdadero, publica
   *      tras un gate rojo o fuera de push-main, y **conserva los tres textos**;
   *   ② el publicador movido a un job con `needs: build` + `if: always()`, con
   *      condición permisiva en su paso, **y la línea buena dejada de SEÑUELO**
   *      en otro paso del archivo.
   *
   * **El segundo es el que prueba que faltaba ASOCIACIÓN, no una variante
   * sintáctica**: el texto correcto estaba ahí, en el paso equivocado.
   *
   * 🔴 **Se exige la expresión CANÓNICA EXACTA, y es una decisión, no pereza.**
   * Validar «de forma cerrada» sin exigir literalidad requeriría un evaluador de
   * expresiones de GitHub — la clase de intérprete a medias que este arnés viene
   * cerrando hace catorce vueltas, y que fue justo lo que el mutante ① explotó:
   * los tres textos presentes dentro de una expresión que significa lo opuesto.
   *
   * El costo está aceptado: cambiar la condición a algo equivalente pone esto
   * rojo y hay que venir a decidirlo a mano. **En el gate que decide si se
   * publica producción, esa fricción es la función, no el efecto secundario.**
   */
  const CONDICION_CANONICA =
    "success() && github.event_name == 'push' && github.ref == 'refs/heads/main'";

  it('🔴 CADA publicador lleva la condición canónica, y su JOB no la afloja', () => {
    const { jobs, problemas } = leerWorkflow(ci);
    expect(problemas, 'el modelo no pudo adjudicar el workflow').toEqual([]);

    const publicadores = jobs.flatMap((j) =>
      j.pasos
        .filter((p) =>
          comandosDe(texto(p.claves['run']) ?? '').some((c) =>
            /^bash scripts\/publicar-vercel\.sh/.test(c),
          ),
        )
        .map((p) => ({ paso: p, job: j })),
    );
    // Control positivo: sin publicadores esto pasaría en vacío.
    expect(publicadores.length, 'no se encontró ningún publicador: mediría en vacío')
      .toBeGreaterThan(0);

    const fallas: string[] = [];
    for (const { paso, job } of publicadores) {
      const donde = `${paso.job}.steps[${paso.indice}]`;
      const condicionDelPaso = texto(paso.claves['if']);
      if (condicionDelPaso === null) {
        fallas.push(`${donde}: publica SIN \`if:\` — se dispararía en cualquier evento`);
      } else if (condicionDelPaso.trim() !== CONDICION_CANONICA) {
        fallas.push(
          `${donde}: la condición no es la canónica\n     esperada: ${CONDICION_CANONICA}\n     hallada:  ${condicionDelPaso.trim()}`,
        );
      }
      // El `if` del JOB también decide si el paso corre. Cualquier condición a
      // ese nivel es roja: no se interpreta, se rechaza.
      if (job.condicion !== null) {
        fallas.push(
          `${donde}: su job «${job.nombre}» lleva \`if: ${job.condicion}\` — puede aflojar la compuerta`,
        );
      }
    }
    expect(fallas, `la compuerta del publicador no está cerrada:\n  ${fallas.join('\n  ')}`)
      .toEqual([]);
  });

  /**
   * 🔴 P71 · QUÉ SE DISPARA, CUÁNTAS VECES Y CON QUÉ SECRETO — por multiconjunto.
   *
   * Esto sólo exigía que ambos selectores aparecieran **en algún lugar** del
   * YAML. Codex lo rompió con un swap que deja las dos referencias presentes:
   *
   * ```yaml
   * HOOK_APP: ${{ secrets.VERCEL_HOOK_LANDING }}     # App se dispara 2 veces
   * HOOK_LANDING: ${{ secrets.VERCEL_HOOK_LANDING }} # Landing NINGUNA
   * UNUSED_HOOK_APP: ${{ secrets.VERCEL_HOOK_APP }}  # la referencia «presente»
   * ```
   *
   * Y con una TERCERA invocación en el mismo `run:`, que pasaba porque los
   * censos cuentan pasos con `some` y no invocaciones.
   *
   * **La corrección es de tipo de dato: se deriva el MULTICONJUNTO exacto de
   * invocaciones y de mappings, y se compara con el esperado sin extras.** Un
   * `some` responde «¿existe alguno?»; acá la pregunta es «¿cuáles y cuántos?».
   */
  it('🔴 exactamente DOS disparos, cada uno con SU proyecto y SU secreto', () => {
    const { jobs } = leerWorkflow(ci);
    const publicadores = jobs.flatMap((j) =>
      j.pasos.filter((p) =>
        comandosDe(texto(p.claves['run']) ?? '').some((c) =>
          /^bash scripts\/publicar-vercel\.sh/.test(c),
        ),
      ),
    );
    expect(publicadores.length, 'no hay publicador: mediría en vacío').toBe(1);
    const paso = publicadores[0]!;

    // ① el multiconjunto de invocaciones, en orden y sin extras
    const invocaciones = comandosDe(texto(paso.claves['run']) ?? '')
      .filter((c) => /^bash scripts\/publicar-vercel\.sh/.test(c))
      .map((c) => tokens(c)?.slice(2).join(' ') ?? c);
    expect(
      invocaciones,
      'los disparos no son exactamente los dos esperados (ni de más, ni cambiados)',
    ).toEqual(['app "$HOOK_APP"', 'landing "$HOOK_LANDING"']);

    // ② el `env` del MISMO paso, leído estructuralmente y exacto
    const env = paso.claves['env'];
    expect(env, 'el paso publicador no declara `env`').toBeDefined();
    expect(
      env,
      'el mapeo de secretos no es exacto: un swap deja ambas referencias presentes y publica mal',
    ).toEqual({
      HOOK_APP: '${{ secrets.VERCEL_HOOK_APP }}',
      HOOK_LANDING: '${{ secrets.VERCEL_HOOK_LANDING }}',
    });
  });

  it('🔴 ningún hook escrito a mano en el YAML', () => {
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

  /**
   * 🔴 P68 · EL CUERPO SALE DEL MODELO, NO DE UN `findIndex` SOBRE EL TEXTO.
   *
   * Acá había una segunda lectura del workflow —buscar la línea del `- name:`,
   * contar sangrías a mano— que convivía con el parser real. Es exactamente lo
   * que el dictamen llama «dos vistas del mismo workflow»: la representación
   * mejoró y este consumidor seguía mirando la estructura vieja.
   *
   * 🔴 Y ADEMÁS SE ADJUDICA EL `shell`. La sonda invoca
   * `bash --noprofile --norc -eo pipefail` porque es lo que usa Actions POR
   * DEFECTO, y ese `-e` es parte de lo que se prueba: sin él, si el disparo de
   * `app` falla, el de `landing` corre igual y el paso termina en 0.
   *
   * **Pero un paso puede declarar otro shell**, y entonces el test acreditaría
   * una semántica distinta de la que el workflow declara. Codex lo midió: con
   * `shell: bash {0}` y un doble de curl (App=500, Landing=200), el shell
   * custom hizo DOS llamadas y terminó 0; el fijo cortó en la primera y terminó
   * 1. **El instrumento decía que el paso corta y el paso no cortaba.**
   *
   * Se rechaza conservadoramente TODO override —de paso, de job o de workflow—
   * en vez de intentar reproducir cada semántica posible: interpretar shells es
   * la clase de intérprete a medias que este arnés viene cerrando hace trece
   * vueltas.
   */
  const publicadorDelModelo = (() => {
    const { jobs, problemas } = leerWorkflow(ciTexto);
    const paso = jobs
      .flatMap((j) => [...j.pasos])
      .find((p) =>
        comandosDe(texto(p.claves['run']) ?? '').some((c) =>
          /^bash scripts\/publicar-vercel\.sh/.test(c),
        ),
      );
    return { jobs, problemas, paso };
  })();

  it('🔴 el workflow NO declara un `shell` propio · si lo hiciera, esta sonda mentiría', () => {
    const { jobs, paso } = publicadorDelModelo;
    expect(paso, 'no se encontró el paso de publicación en el modelo').toBeDefined();

    // ① el paso
    expect(
      paso!.claves['shell'],
      'el paso declara `shell:` — la sonda de abajo corre con OTRA semántica que la real',
    ).toBeUndefined();

    // ② su job, y ③ el workflow entero (`defaults.run.shell`)
    const doc = load(ciTexto) as Record<string, unknown>;
    const defaultsDe = (n: unknown): unknown => {
      if (typeof n !== 'object' || n === null) return undefined;
      const d = (n as Record<string, unknown>)['defaults'];
      if (typeof d !== 'object' || d === null) return undefined;
      const r = (d as Record<string, unknown>)['run'];
      if (typeof r !== 'object' || r === null) return undefined;
      return (r as Record<string, unknown>)['shell'];
    };
    expect(defaultsDe(doc), 'el workflow declara `defaults.run.shell`').toBeUndefined();
    const jobDelPaso = (load(ciTexto) as { jobs?: Record<string, unknown> }).jobs?.[paso!.job];
    expect(defaultsDe(jobDelPaso), 'el job declara `defaults.run.shell`').toBeUndefined();

    // Control positivo: el modelo tiene que haber leído jobs de verdad.
    expect(jobs.length, 'el modelo no leyó ningún job: mediría en vacío').toBeGreaterThan(0);
  });

  /** El cuerpo literal del `run:` del paso de publicación, leído del modelo. */
  const cuerpo = (texto(publicadorDelModelo.paso?.claves['run']) ?? '').trimEnd();

  /**
   * 🔴 P71 · DOS DESTINOS DISTINGUIBLES, y no es un detalle de prolijidad.
   *
   * Acá los dos hooks recibían **la MISMA url falsa**, así que la sonda no podía
   * acreditar qué variable alimenta qué proyecto: un swap
   * (`HOOK_APP: secrets.VERCEL_HOOK_LANDING`) disparaba App dos veces y Landing
   * ninguna, y todo seguía verde.
   *
   * Con destinos distintos, el doble de `curl` **registra a dónde fue cada
   * llamada** y el test afirma el multiconjunto exacto: una por proyecto, al
   * destino que le corresponde.
   */
  /**
   * ⚠️ NO imitan la forma de un hook real de Vercel, y es a propósito: la
   * primera versión de estas constantes usaba `api.vercel.com/v1/integrations/
   * deploy/…` y **el gate de secretos cortó el push** — con razón, este repo es
   * público y esa forma es exactamente la que no puede aparecer en el árbol.
   *
   * La sonda no necesita URLs verosímiles: necesita **destinos DISTINGUIBLES**,
   * que es lo único que acredita qué variable alimenta qué proyecto.
   */
  const URL_APP = 'https://ejemplo.invalid/destino-app';
  const URL_LANDING = 'https://ejemplo.invalid/destino-landing';

  /**
   * Corre el cuerpo con un `curl` doble adelante en el PATH.
   * `codigo` es lo que el doble imprime; `salida` con qué exit code termina.
   * `destinos` son las URLs que el doble recibió, en orden.
   */
  function correrCuerpo(
    codigo: string,
    salida: number,
  ): Promise<{ code: number; out: string; destinos: string[] }> {
    const dir = mkdtempSync(join(tmpdir(), 'payme-hook-'));
    const registro = join(dir, 'destinos.txt');
    // El doble anota su ÚLTIMO argumento —la URL— antes de contestar.
    writeFileSync(
      join(dir, 'curl'),
      `#!/usr/bin/env bash\nfor a in "$@"; do :; done\nprintf '%s\\n' "$a" >> ${JSON.stringify(registro)}\nprintf '%s' "${codigo}"\nexit ${salida}\n`,
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
            HOOK_APP: URL_APP,
            HOOK_LANDING: URL_LANDING,
          },
        },
        (err, out, errOut) => {
          const destinos = existsSync(registro)
            ? readFileSync(registro, 'utf8').split('\n').filter(Boolean)
            : [];
          rmSync(dir, { recursive: true, force: true });
          const code = err && typeof err.code === 'number' ? err.code : err ? -1 : 0;
          resolver({ code, out: `${out}${errOut}`, destinos });
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

  it('✅ 200 · UNA llamada por proyecto, cada una a SU destino', async () => {
    const r = await correrCuerpo('200', 0);
    expect(r.code, `el paso falló con dos hooks sanos:\n${r.out}`).toBe(0);
    /**
     * 🔴 El multiconjunto EXACTO, no «aparecen las palabras app y landing».
     * Un swap de secretos manda las dos llamadas al mismo destino y la versión
     * anterior de este test no lo veía; una tercera invocación tampoco.
     */
    expect(
      r.destinos,
      `los disparos no fueron uno por proyecto a su destino:\n${r.destinos.join('\n')}`,
    ).toEqual([URL_APP, URL_LANDING]);
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
  /** Dónde vive, por ESTRUCTURA. Reemplaza al número de línea: sobrevive a que
   *  alguien reordene el YAML, y nombra el job — que antes ni se miraba. */
  job: string;
  indice: number;
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
}


/**
 * 🔴 P60 · UN PASO SE IDENTIFICA POR SER UN ÍTEM DE `steps:`, NO POR SU PRIMERA
 * CLAVE — y mi versión anterior dependía de la primera clave.
 *
 * Abría un paso al ver `- name:`, `- uses:`, `- run:` o `- if:`. **El orden de
 * las claves de un mapping YAML no significa nada**, así que un paso
 * perfectamente válido cuya primera clave fuera otra —`continue-on-error`,
 * `env`, `with`, `id`, `timeout-minutes`— **no abría paso y desaparecía del
 * censo**. Codex lo mostró con el contraejemplo exacto:
 *
 * ```yaml
 * - continue-on-error: false
 *   run: npx vercel --prod
 * ```
 *
 * **Lo verifiqué en mi propio árbol antes de tocar nada: 41/41 verde, con un
 * publicador entero invisible.** 🔴 **Un paso invisible es peor que uno mal
 * adjudicado: no llega ni a la denuncia.**
 *
 * ⚠️ **Y es la misma clase que ya cerré una vez, en otro eje:** allá el
 * resultado dependía del ORDEN DE RECORRIDO del censo, acá del ORDEN DE LAS
 * CLAVES del YAML. Las dos veces la estructura decía algo que el formato no
 * garantiza.
 *
 * Ahora el ítem se reconoce **por la estructura de la lista** —un `- ` a la
 * indentación de los ítems de `steps:`— y de ahí se lee **el mapping entero**,
 * venga la clave que venga y en el orden que venga.
 */
/**
 * Un escalar del YAML como texto.
 *
 * 🔴 Con `js-yaml` los escalares LLEGAN TIPADOS: `continue-on-error: true` es el
 * booleano `true`, no la cadena `'true'`. El lector propio devolvía todo como
 * string, así que un `typeof v === 'string'` dejaba ese metadato en `null` — y
 * el gate que mira si un paso tolera errores lo leía como «no declarado».
 * **Un efecto del cambio de instrumento que ningún punto del dictamen nombra, y
 * que apareció al correrlo.** Se normaliza acá, donde el resto del archivo
 * espera texto.
 */
const texto = (v: unknown): string | null =>
  typeof v === 'string' ? v : typeof v === 'boolean' || typeof v === 'number' ? String(v) : null;

function pasosDe(yml: string): Paso[] {
  const { pasos, indecidibles } = pasosDeWorkflow(yml);

  // 🔴 FAIL-CLOSED, y es el punto del rework entero. Antes, lo que el lector no
  // entendía DESAPARECÍA del censo; ahora detiene la lectura. Se lanza en vez
  // de devolver una lista corta porque TODOS los tests que leen el workflow
  // dependen de esto: uno solo que lo afirme dejaría a los otros midiendo sobre
  // un censo mutilado.
  if (indecidibles.length) {
    throw new Error(
      'el workflow tiene construcciones que este arnés NO puede afirmar:\n  ' +
        indecidibles.join('\n  '),
    );
  }

  return pasos.map((p) => ({
    nombre: texto(p.claves['name']) ?? '',
    uses: texto(p.claves['uses']),
    run: texto(p.claves['run']),
    condicion: texto(p.claves['if']),
    toleraError: texto(p.claves['continue-on-error']),
    job: p.job,
    indice: p.indice,
  }));
}

/**
 * 🔴 P58 · UNA GRAMÁTICA POSITIVA — y por qué lo anterior estaba MAL aunque
 * matara los mutantes que le pusieron.
 *
 * En el P55 escribí, con todas las letras, que esto **no se cierra listando
 * formas malas**… **y construí una lista de cuatro formas malas** (`$()`,
 * backticks, `eval`, `bash -c`). Codex la refutó con la quinta: **la
 * sustitución de proceso de Bash**, `<(npx vercel --prod)` como argumento de un
 * comando permitido por prefijo. Todo verde.
 *
 * 🔴 **Y la parte que duele es la correcta: la prosa afirmaba más que el
 * código.** Es la clase que vengo cazando hace ocho vueltas —el comentario que
 * certifica una guarda que no existe— cometida **en mi propio paquete, en el
 * párrafo donde declaraba la virtud**. Agregar `<(` y `>(` a la lista habría
 * sido la novena vuelta esperando una sintaxis nueva de shell.
 *
 * **Lo que reemplaza a la lista: se afirma lo SIMPLE, no se enumera lo
 * complejo.** Un comando es *afirmable* si cada uno de sus tokens es una de
 * estas formas, y **nada más**:
 *
 *   · una palabra desnuda sin metacaracteres (`npm`, `--integridad`, una ruta);
 *   · un literal entre comillas SIMPLES (el shell no expande nada adentro);
 *   · un literal entre comillas dobles **cuyo contenido sólo tenga texto,
 *     `$VAR`/`${VAR}` o una expresión `${{ … }}` de GitHub**;
 *   · una variable suelta `$VAR` / `${VAR}`.
 *
 * **Todo lo demás es INDECIDIBLE** — no «prohibido», indecidible: paréntesis,
 * redirecciones, `<(`, `>(`, `&`, globs, backticks, `$(`. **No hace falta
 * nombrarlos**, y ése es el punto: una sintaxis de shell que nadie previó cae
 * del lado correcto **por no ser ninguna de las cuatro formas afirmables**.
 *
 * ⚠️ **`${{ … }}` NO es evaluación de shell:** lo sustituye GitHub antes de que
 * el shell vea el script. Se acepta sólo con contenido simple —identificadores,
 * puntos, `||` y literales entre comillas simples— porque un `${{ }}` con
 * cualquier cosa adentro es otra vez algo que este arnés no puede afirmar.
 */
const PALABRA = /^[A-Za-z0-9._/=:@,+-]+$/;
/** `$NOMBRE` o `${NOMBRE}` — sin operadores. Ver `EXPANSION_SIMPLE`. */
const VARIABLE = /^\$(?:[A-Za-z_][A-Za-z0-9_]*|\{[A-Za-z_][A-Za-z0-9_]*\})$/;

/**
 * 🔴 P60 · UNA EXPANSIÓN CON OPERADOR ES INDECIDIBLE, no una variable más.
 *
 * La versión anterior sólo miraba **cómo empieza** cada `$`: le alcanzaba con
 * `${` seguido de letra. Codex plantó esto y quedó verde:
 *
 * ```bash
 * bash scripts/publicar-vercel.sh app "${HOOK_APP:-$HOOK_LANDING}"
 * ```
 *
 * `${VAR:-otra}` es *usá VAR y si está vacía usá otra*. **Si faltara `HOOK_APP`,
 * ese comando publica landing DOS veces y no publica app** — y el gate no tenía
 * cómo verlo, porque nunca parseó el cierre ni el operador. Los tests del cuerpo
 * tampoco: fijan los dos hooks a la misma URL de prueba, así que la confusión
 * era invisible por construcción.
 *
 * La respuesta NO es enumerar operadores (`:-`, `:=`, `:?`, `##`, `%%`, `//`…):
 * ésa es la lista de formas malas que ya me costó dos vueltas. Se afirma **la
 * forma simple** y todo lo demás es «no sé» — que acá es rojo.
 */
const EXPANSION_SIMPLE = /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/;

/**
 * 🔴 P60 · `${{ … }}` SE ADJUDICA POR EL DOMINIO DEL VALOR, NO POR LA SINTAXIS
 * DEL SELECTOR.
 *
 * La versión anterior validaba que el interior tuviera forma de selector, así
 * que esto pasaba:
 *
 * ```bash
 * bash scripts/reportar-flaky.sh resultados.json "${{ github.event.head_commit.message }}"
 * ```
 *
 * El selector es sintácticamente impecable. **El VALOR es el mensaje de commit:
 * texto libre que escribe cualquiera que pushee**, y GitHub lo interpola ANTES
 * de que bash vea el script. Un mensaje con comillas y `;` reescribe el comando.
 *
 * Así que la pregunta correcta no es «¿tiene forma de selector?» sino **«¿de
 * dónde sale ese valor?»**. Sólo se aceptan orígenes cuyo dominio es acotado y
 * no lo escribe quien empuja el commit. Todo lo demás —`github.event.*`,
 * `inputs.*`, `env.*`— es contenido libre y queda indecidible.
 *
 * ⚠️ `secrets.*` entra ACÁ, y no porque su valor sea inofensivo: entra porque el
 * repo ya decidió que los hooks viajan por `secrets` y hay un test aparte que
 * lo fija. Un secreto igual no debería interpolarse sin comillas — por eso esto
 * sólo se consulta DENTRO de comillas dobles.
 */
/**
 * 🔴 P65 · LA LISTA SE ACHICÓ A LO DEMOSTRABLE, y el hallazgo que lo obligó es
 * el más fino de las trece vueltas.
 *
 * La versión anterior admitía `github.workflow` **por el nombre del selector**.
 * Codex mostró que su VALOR es el `name:` del propio workflow, o sea texto que
 * alguien edita:
 *
 * ```yaml
 * name: 'CI"; npx vercel --prod; echo "'
 * - run: bash scripts/reportar-flaky.sh "${{ github.workflow }}"
 * ```
 *
 * Actions interpola **antes** de que bash vea el script, así que el `run` final
 * contiene un comando extra. **61/61 verde.** Lo mismo vale para `github.ref` y
 * `ref_name` (una rama puede llamarse casi cualquier cosa) y para `secrets.*`
 * (su valor no lo demuestra nadie).
 *
 * **El criterio pasa a ser: sólo entra por interpolación directa lo que tiene
 * FORMA DEMOSTRABLE.** Un SHA de Git es 40 hexadecimales; no hay comilla que
 * meterle. Todo lo demás **viaja por `env:` y se consume como `"$VAR"`**, que
 * es como el `ci.yml` ya pasa los hooks (`env: HOOK_APP: ${{ secrets… }}`) —
 * ahí no hay shell interpretando, hay una asignación.
 *
 * ⚠️ Esto es exactamente lo que Codex pidió no hacer al revés: *«la reparación
 * no es sumar otra regex»*. Sacar tres selectores es más chico que agregar uno,
 * y es lo que cierra la clase.
 */
const SELECTORES_DE_DOMINIO_ACOTADO: readonly RegExp[] = [
  /^github\.sha$/,
  /^github\.event\.(before|after)$/,
  /^github\.event\.pull_request\.(base|head)\.sha$/,
];

/**
 * Un literal `'…'` de una expresión de GitHub: dominio acotado por definición,
 * lo escribió quien editó el workflow y está a la vista en el diff.
 */
const LITERAL_GITHUB = /^'[^']*'$/;

/**
 * ¿El interior de un `${{ … }}` tiene dominio acotado?
 *
 * Se admite una **disyunción** (`a || b || 'literal'`) porque el `ci.yml` real
 * la usa —`github.event.before || 'HEAD^'`, el fallback del primer push de una
 * rama— y **cada término se adjudica por separado**: la disyunción no es más
 * confiable que su término más flojo.
 */
function expresionDeDominioAcotado(dentro: string): boolean {
  const terminos = dentro.split('||').map((t) => t.trim());
  if (terminos.some((t) => !t)) return false;
  return terminos.every(
    (t) => LITERAL_GITHUB.test(t) || SELECTORES_DE_DOMINIO_ACOTADO.some((re) => re.test(t)),
  );
}

/** Parte un comando en tokens respetando comillas. `null` si las comillas no cierran. */
function tokens(cmd: string): string[] | null {
  const salida: string[] = [];
  let actual = '';
  let cita: string | null = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i]!;
    if (cita) { actual += c; if (c === cita) cita = null; continue; }
    if (c === '"' || c === "'") { cita = c; actual += c; continue; }
    if (/\s/.test(c)) { if (actual) { salida.push(actual); actual = ''; } continue; }
    actual += c;
  }
  if (cita) return null;
  if (actual) salida.push(actual);
  return salida;
}

/** El contenido de unas comillas dobles, ¿es sólo texto, `$VAR` y `${{ … }}`? */
function dobleComillaSegura(cuerpo: string): boolean {
  // Las expresiones de GitHub se sacan primero, adjudicando su DOMINIO.
  const expr = /\$\{\{([^}]*)\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = expr.exec(cuerpo)) !== null) {
    if (!expresionDeDominioAcotado(m[1]!.trim())) return false;
  }
  const resto = cuerpo.replace(expr, '');
  if (/[`\\]/.test(resto)) return false;
  if (/\$\(/.test(resto)) return false;

  /**
   * 🔴 CADA `$` SE PARSEA ENTERO, no se mira sólo su comienzo. Es el punto 2
   * del cierre mínimo: `${VAR:-otra}` empieza igual que `${VAR}` y significa
   * otra cosa. Se recorre cada expansión hasta su cierre y se exige la forma
   * simple; cualquier operador adentro cae como indecidible sin necesidad de
   * que este arnés sepa qué hace ese operador.
   */
  for (let i = 0; i < resto.length; i++) {
    if (resto[i] !== '$') continue;
    if (resto[i + 1] === '{') {
      const cierre = resto.indexOf('}', i);
      if (cierre < 0) return false; // llave sin cerrar: no se puede afirmar
      if (!EXPANSION_SIMPLE.test(resto.slice(i, cierre + 1))) return false;
      i = cierre;
      continue;
    }
    const simple = /^\$[A-Za-z_][A-Za-z0-9_]*/.exec(resto.slice(i));
    if (!simple) return false; // `$` suelto, `$1`, `$?`, `$@`…
    i += simple[0].length - 1;
  }
  return true;
}

/**
 * ¿Puede este arnés AFIRMAR qué ejecuta este comando? Devuelve el motivo cuando
 * no, y `null` cuando sí. **La respuesta ante lo no afirmable es «no sé», y «no
 * sé» es rojo.**
 */
function noAfirmable(cmd: string): string | null {
  const ts = tokens(cmd);
  if (ts === null) return 'comillas sin cerrar';
  for (const t of ts) {
    if (PALABRA.test(t) || VARIABLE.test(t)) continue;
    if (t.startsWith("'") && t.endsWith("'") && t.length >= 2 && !t.slice(1, -1).includes("'")) continue;
    if (t.startsWith('"') && t.endsWith('"') && t.length >= 2 && dobleComillaSegura(t.slice(1, -1))) continue;
    return `el token \`${t}\` no es una forma que este arnés pueda afirmar sin evaluarla`;
  }
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

/**
 * 🔴 P58 · LA GRAMÁTICA POSITIVA, PROBADA COMO GRAMÁTICA.
 *
 * No alcanza con matar las formas que el auditor nombró: eso es lo que hace una
 * denylist bien mantenida, y **la denylist bien mantenida fue exactamente el
 * defecto**. Lo que hay que demostrar es la propiedad: **una forma que nadie
 * enumeró cae del lado correcto por no ser afirmable**, no por estar prohibida.
 *
 * Por eso la mitad de los casos de acá son sintaxis que **no aparece en ningún
 * comentario de este archivo**.
 */
/**
 * 🔴 P60 · UN PASO NO SE IDENTIFICA POR SU PRIMERA CLAVE.
 *
 * **El orden de las claves de un mapping YAML no significa nada.** Mi parser
 * abría paso al ver `- name:`, `- uses:`, `- run:` o `- if:`, así que un paso
 * válido que empezara por otra clave **desaparecía del censo** — y un paso
 * invisible **no llega ni a la denuncia**.
 *
 * ⚠️ Es la misma clase que ya cerré en otro eje: allá el resultado dependía del
 * ORDEN DE RECORRIDO, acá del ORDEN DE LAS CLAVES. **Las dos veces la
 * implementación apoyaba una conclusión en algo que el formato no garantiza.**
 *
 * 🔴 **ACÁ DECÍA QUE `id` Y `timeout-minutes` ERAN «claves que ningún comentario
 * de este archivo nombra», Y ERA FALSO EN LA FRASE MISMA QUE LAS NOMBRABA.** Lo
 * marcó Codex en el P60 (P3); sólo `working-directory` cumplía la descripción.
 *
 * **El criterio era además insostenible por construcción:** en un archivo que
 * documenta su propio diseño, explicar por qué una clave importa la convierte en
 * nombrada. Una propiedad que se destruye al escribirla no puede ser el
 * fundamento de nada.
 *
 * **El fundamento correcto es otro y sí es verificable: el parser NO CONSULTA
 * NINGUNA LISTA DE CLAVES.** Reconoce el ítem por su estructura y lee el mapping
 * entero, así que la primera clave le da igual — se llame como se llame, esté
 * nombrada acá o no. Lo que acredita eso no es la novedad de un nombre, sino los
 * casos estructurales de `yamlWorkflow.test.ts`: el guion solo y el segundo job.
 * Los de abajo son la cobertura de las formas que ya se vieron, no la prueba de
 * la propiedad.
 */
describe('🔴 el paso se reconoce por ser ítem de `steps:`', () => {
  const armar = (primerPaso: string) => `
name: sonda
on: [push]
jobs:
  x:
    runs-on: ubuntu-latest
    steps:
${primerPaso}
      - run: npm ci
`;

  const PRIMERAS_CLAVES = [
    ['continue-on-error — el contraejemplo de Codex', '      - continue-on-error: false\n        run: npx vercel --prod'],
    ['if', '      - if: always()\n        run: npx vercel --prod'],
    ['env', '      - env:\n          X: "1"\n        run: npx vercel --prod'],
    // Las tres de abajo se agregaron para ampliar la cobertura de primeras
    // claves. NO son «claves que nadie nombró» —este archivo las nombra acá
    // mismo—: la propiedad la acreditan los casos estructurales del parser.
    ['id', '      - id: escondido\n        run: npx vercel --prod'],
    ['timeout-minutes', '      - timeout-minutes: 5\n        run: npx vercel --prod'],
    ['working-directory', '      - working-directory: .\n        run: npx vercel --prod'],
  ] as const;

  for (const [nombre, bloque] of PRIMERAS_CLAVES) {
    it(`🔴 un paso que empieza por \`${nombre}\` NO desaparece`, () => {
      const pasos = pasosDe(armar(bloque));
      expect(pasos.length, 'se perdió un paso entero').toBe(2);
      const cmds = pasos.flatMap((p) => comandosDe(p.run ?? ''));
      expect(cmds, `el comando del primer paso no se ve: ${JSON.stringify(cmds)}`)
        .toContain('npx vercel --prod');
    });
  }

  it('⭐ y los metadatos se leen aunque no vengan primeros', () => {
    // Sin esto, «reconocer el ítem» podría lograrse perdiendo el resto del
    // mapping: el paso entraría al censo pero sin su `if` ni su tolerancia.
    const pasos = pasosDe(armar('      - continue-on-error: true\n        if: always()\n        run: npm test'));
    expect(pasos[0]!.toleraError).toBe('true');
    expect(pasos[0]!.condicion).toBe('always()');
    expect(comandosDe(pasos[0]!.run ?? '')).toEqual(['npm test']);
  });

  it('⭐ CONTROL · un paso normal sigue leyéndose entero', () => {
    const pasos = pasosDe(armar('      - name: normal\n        uses: actions/checkout@v4'));
    expect(pasos.length).toBe(2);
    expect(pasos[0]!.nombre).toBe('normal');
    expect(pasos[0]!.uses).toBe('actions/checkout@v4');
  });
});

describe('🔴 la gramática afirma lo simple, no enumera lo complejo', () => {
  const NO_AFIRMABLES: ReadonlyArray<readonly [string, string]> = [
    ['sustitución de proceso (lectura) — la sonda de Codex', 'bash x.sh <(npx vercel --prod)'],
    ['sustitución de proceso (escritura)', 'bash x.sh >(npx vercel --prod)'],
    ['sustitución de comando', 'bash x.sh $(npx vercel --prod)'],
    ['backticks', 'bash x.sh `npx vercel --prod`'],
    // ── Las de abajo NO se enumeran para que la gramática las rechace: la
    // gramática no las conoce y no las necesita conocer. Están para MEDIR que
    // «afirmo lo simple» cubre formas que nunca se pensaron una por una.
    // 🔴 Acá decía «formas que NINGÚN comentario de este archivo nombra», y era
    // falso por la misma razón que en el bloque de las claves: nombrarlas para
    // explicarlas las nombra. Corregido tras el P3 del P60.
    ['expansión con separador', 'bash x.sh ${IFS}algo'],
    ['glob', 'bash x.sh archivo*.json'],
    ['segundo plano', 'bash x.sh a&b'],
    ['redirección', 'bash x.sh > salida.txt'],
    ['tilde de home', 'bash x.sh ~/algo'],
    ['expansión de llaves', 'bash x.sh {a,b}.json'],
    ['subshell', 'bash x.sh (algo)'],
    ['aritmética', 'bash x.sh $((1+1))'],
    ['comillas sin cerrar', 'bash x.sh "abierta'],
  ];
  for (const [nombre, cmd] of NO_AFIRMABLES) {
    it(`🔴 no afirmable · ${nombre}`, () => {
      expect(noAfirmable(cmd), `pasó como afirmable: ${cmd}`).not.toBeNull();
    });
  }

  /**
   * ⭐ Y LA MITAD QUE NADIE ESCRIBE. Sin esto, «declarar todo indecidible»
   * mataría los trece casos de arriba y dejaría el arnés inservible: no habría
   * comando que pudiera adjudicarse jamás.
   */
  const AFIRMABLES: ReadonlyArray<readonly [string, string]> = [
    ['palabras y flags', 'npx playwright install --with-deps chromium'],
    ['ruta y argumento literal', 'bash scripts/reportar-flaky.sh test-results/resultados.json'],
    ['variable entre comillas', 'bash scripts/publicar-vercel.sh app "$HOOK_APP"'],
    ['literal entre comillas simples', "bash x.sh 'con espacios adentro'"],
    ['flag con valor', 'node scripts/verificar-mirror.mjs --integridad'],
    ['expresión de GitHub, que la sustituye GitHub y no el shell',
     'bash scripts/auditar-secretos.sh "${{ github.event.before || \'HEAD^\' }}"'],
  ];
  for (const [nombre, cmd] of AFIRMABLES) {
    it(`⭐ afirmable · ${nombre}`, () => {
      expect(noAfirmable(cmd), `lo dio por opaco: ${cmd}`).toBeNull();
    });
  }
});

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
  it('🔴 TODO JOB y TODO paso del workflow están adjudicados', () => {
    /**
     * 🔴 P68 · EL CENSO MIRA JOBS, NO SÓLO PASOS — y ésta es la corrección que
     * el dictamen llama «un único validador integrado».
     *
     * El parser YA representaba `jobs.<id>.uses` (un reusable workflow, que
     * ejecuta con sus secretos y NO tiene `steps`), y hasta había un test del
     * modelo puro que lo probaba. **Pero este censo —el que corre sobre el
     * `ci.yml` real— volvía a aplanar sólo `jobs[].pasos`.** Codex agregó un
     * reusable job real y quedó 61/61 focal y 96/96 la full.
     *
     * ⚠️ **La lección es del patrón, no del caso:** arreglar la REPRESENTACIÓN
     * no arregla a los CONSUMIDORES, y un test del modelo puro puede estar
     * verde mientras el gate integrado no usa lo que el modelo aprendió. Dos
     * vistas del mismo workflow es exactamente lo que produjo esto.
     */
    const { jobs, problemas } = leerWorkflow(readFileSync(join(DIR, 'ci.yml'), 'utf8'));
    expect(problemas, 'hay jobs que el modelo no puede adjudicar').toEqual([]);
    expect(jobs.length, 'no se leyó ningún job: el censo mediría en vacío').toBeGreaterThan(0);

    /**
     * Reusables ADJUDICADOS: hoy ninguno. No es una lista vacía por descuido —
     * es la declaración de que este repo no delega su CI en un workflow ajeno.
     * El día que se quiera, se agrega acá con su `owner/repo/.../wf.yml@ref`
     * exacto y se decide qué secretos recibe.
     */
    const REUSABLES_ADJUDICADOS: readonly string[] = [];
    const jobsSinAdjudicar = jobs
      .filter((j) => j.usa !== null && !REUSABLES_ADJUDICADOS.includes(j.usa))
      .map((j) => `job «${j.nombre}»: uses ${j.usa} (secrets: ${JSON.stringify(j.secretos)})`);
    expect(
      jobsSinAdjudicar,
      'un job delega su ejecución en un workflow ajeno y nadie lo adjudicó:\n  ' +
        jobsSinAdjudicar.join('\n  '),
    ).toEqual([]);

    const pasos = pasosDe(readFileSync(join(DIR, 'ci.yml'), 'utf8'));
    expect(pasos.length, 'no se parsearon pasos: el censo mediría en vacío').toBeGreaterThan(8);

    /**
     * 🔴 P60 · SE ADJUDICA POR TOKENS EXACTOS, NO POR PREFIJO DE CADENA.
     *
     * La lista anterior usaba `/^bash scripts\/reportar-flaky\.sh\b/`, y `\b`
     * **no delimita ante un guion**: entre `h` y `-` hay frontera de palabra,
     * así que `bash scripts/reportar-flaky.sh-alternativo` quedaba adjudicado
     * como si fuera el script conocido.
     *
     * ⚠️ Es la MISMA clase que ya cerré en la allowlist de dominios —comparar
     * por prefijo de cadena en vez de por la unidad real, que allá era el
     * origen y acá es el token—. Se repitió en otro archivo y con otra
     * herramienta: la lección no había viajado.
     *
     * Cada entrada es la secuencia de tokens con la que el comando tiene que
     * EMPEZAR, comparados uno a uno con `===`. Los argumentos posteriores
     * quedan libres, y de su contenido responde `noAfirmable`.
     */
    const ADJUDICADOS: readonly (readonly string[])[] = [
      ['npm', 'ci'], // dependencias
      ['npm', 'test'],
      ['npm', 'run', 'typecheck'],
      ['npm', 'run', 'build'],
      ['npx', 'playwright', 'install'],
      ['npx', 'playwright', 'test'],
      ['bash', 'scripts/auditar-secretos.sh'], // gate de secretos
      ['node', 'scripts/verificar-mirror.mjs'], // gate del espejo
      ['bash', 'scripts/reportar-flaky.sh'], // informa, no bloquea
      ['bash', 'scripts/publicar-vercel.sh'], // LA publicación
    ];
    /** `uses:` no es un comando: se adjudica por la acción exacta y su versión. */
    const USES_ADJUDICADOS = /^actions\/(checkout|setup-node)@[A-Za-z0-9._-]+$/;

    const adjudicaComando = (cmd: string): boolean => {
      const ts = tokens(cmd);
      if (ts === null) return false;
      return ADJUDICADOS.some((patron) => patron.every((tok, k) => ts[k] === tok));
    };
    const sinAdjudicar: string[] = [];
    for (const p of pasos) {
      const donde = `${p.job}.steps[${p.indice}]`;
      if (p.uses !== null) {
        if (!USES_ADJUDICADOS.test(p.uses)) sinAdjudicar.push(`${donde}: uses \`${p.uses}\``);
        continue;
      }
      const trozos = comandosDe(p.run ?? '');
      if (!trozos.length) { sinAdjudicar.push(`${donde}: paso sin \`run\` ni \`uses\``); continue; }
      for (const t of trozos) {
        // 🔴 Primero lo indecidible: un prefijo permitido NO adjudica lo que el
        // comando evalúe adentro. El orden importa — si se mirara el allowlist
        // primero, `bash permitido.sh "$(peligroso)"` pasaría por el prefijo.
        const opaco = noAfirmable(t);
        if (opaco) {
          sinAdjudicar.push(`${donde}: ${opaco} → \`${t}\``);
          continue;
        }
        if (!adjudicaComando(t)) sinAdjudicar.push(`${donde}: \`${t}\``);
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
    /**
     * 🔴 P65 · «ANTES» YA NO ES POSICIÓN EN EL ARCHIVO, ES CAUSALIDAD.
     *
     * Esto tomaba `pasos.slice(0, iPublica)` sobre los jobs aplanados, o sea
     * «lo que está más arriba». Codex movió el publicador a un SEGUNDO job sin
     * `needs` y el focal quedó 61/61 verde: en Actions dos jobs sin arista
     * corren EN PARALELO, así que el publicador no esperaba ningún gate y el
     * test lo daba por gateado sólo porque los gates estaban escritos antes.
     *
     * Ahora se pregunta por el modelo: mismo job con índice menor, o job del
     * que se depende transitivamente por `needs`.
     */
    const { jobs, problemas } = leerWorkflow(readFileSync(join(DIR, 'ci.yml'), 'utf8'));
    expect(problemas, 'el workflow tiene jobs que este modelo no puede adjudicar').toEqual([]);
    const pasos = jobs.flatMap((j) => [...j.pasos]);
    /**
     * 🔴 P68 · TODOS los publicadores, no el primero. El `.find(...)` de antes
     * adjudicaba uno y dejaba libre a cualquier otro: Codex agregó un segundo
     * job con un publicador válido y sin `needs`, y el focal quedó 61/61 aunque
     * ese job puede correr en paralelo sin esperar los cinco gates.
     */
    const publicadores = pasos.filter((p) =>
      comandosDe(texto(p.claves['run']) ?? '').some((c) => /^bash scripts\/publicar-vercel\.sh/.test(c)),
    );
    // Control positivo: sin paso de publicación, «todos preceden» sería cierto
    // sobre un CI que no publica nada.
    expect(publicadores.length, 'no se encontró el paso de publicación: el test mediría en vacío')
      .toBeGreaterThan(0);

    // Cada publicador responde por SUS antecesores garantizados. Se acumulan
    // los faltantes de todos, no se mira sólo el primero.
    const antesDeCadaUno = publicadores.map((pub) => ({
      donde: `${pub.job}.steps[${pub.indice}]`,
      cmds: pasosGarantizadosAntesDe(jobs, pub).flatMap((p) => comandosDe(texto(p.claves['run']) ?? '')),
    }));
    const GATES: ReadonlyArray<readonly [string, RegExp]> = [
      ['espejo', /^node scripts\/verificar-mirror\.mjs\b/],
      ['test', /^npm test$/],
      ['typecheck', /^npm run typecheck$/],
      ['build', /^npm run build$/],
      ['playwright', /^npx playwright test$/],
    ];
    const faltan = antesDeCadaUno.flatMap(({ donde, cmds }) =>
      GATES.filter(([, re]) => !cmds.some((c) => re.test(c))).map(([n]) => `${donde}: ${n}`),
    );
    expect(
      faltan,
      `gates que NO se EJECUTAN antes de publicar (mencionarlos no cuenta):\n  ${faltan.join('\n  ')}`,
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
    // Mismo cambio de modelo que el test de arriba: «antes» es causalidad.
    const { jobs } = leerWorkflow(readFileSync(join(DIR, 'ci.yml'), 'utf8'));
    const todos = jobs.flatMap((j) => [...j.pasos]);
    const publicadores2 = todos.filter((p) =>
      comandosDe(texto(p.claves['run']) ?? '').some((c) => /^bash scripts\/publicar-vercel\.sh/.test(c)),
    );
    expect(publicadores2.length, 'no se encontró el paso de publicación').toBeGreaterThan(0);
    // Mismo criterio que arriba: cada publicador responde por sus antecesores.
    const previos = publicadores2.flatMap((pub) => pasosGarantizadosAntesDe(jobs, pub)).map((p) => ({
      job: p.job,
      indice: p.indice,
      run: texto(p.claves['run']),
      condicion: texto(p.claves['if']),
      toleraError: texto(p.claves['continue-on-error']),
    }));

    const GATES = [
      /^node scripts\/verificar-mirror\.mjs\b/, /^npm test$/, /^npm run typecheck$/,
      /^npm run build$/, /^npx playwright test$/,
    ];
    const problemas: string[] = [];
    for (const p of previos) {
      const cmds = comandosDe(p.run ?? '');
      if (!GATES.some((re) => cmds.some((c) => re.test(c)))) continue;
      if (p.condicion !== null) {
        problemas.push(`${p.job}.steps[${p.indice}]: el gate lleva \`if: ${p.condicion}\` — puede no ejecutarse`);
      }
      if (p.toleraError !== null && p.toleraError !== 'false') {
        problemas.push(`${p.job}.steps[${p.indice}]: \`continue-on-error: ${p.toleraError}\` — su fallo NO frena la publicación`);
      }
    }
    // Control positivo: si ningún paso matcheara como gate, el bucle no miraría
    // nada y esto pasaría en vacío sobre un CI sin gates.
    const cuantos = previos.filter((p) => GATES.some((re) => comandosDe(p.run ?? '').some((c) => re.test(c)))).length;
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

/**
 * 🔴 LOS TRES CAMINOS DEL P65, COMO TESTS PERMANENTES.
 *
 * Codex los plantó como sondas manuales sobre el `ci.yml` y las retiró. Acá el
 * mutante se construye **en memoria sobre el workflow real**: el archivo no se
 * toca y la guarda queda viva, que es la diferencia entre «se probó una vez» y
 * «no puede volver».
 */
describe('🔴 P65 · los caminos que quedaban fuera del modelo', () => {
  const ci = () => readFileSync(join(RAIZ, '.github', 'workflows', 'ci.yml'), 'utf8');

  it('🔴 ① un REUSABLE JOB no puede colarse sin adjudicar', () => {
    const conReusable = `${ci()}
  publicador_reusable_no_adjudicado:
    uses: acme/deploy/.github/workflows/vercel.yml@main
    secrets: inherit
`;
    const { jobs } = leerWorkflow(conReusable);
    const reusable = jobs.find((j) => j.usa !== null);
    expect(reusable, 'el reusable job no entró al modelo: volvería a ser invisible').toBeDefined();

    // Y el censo lo tiene que denunciar: ningún `uses` de job está adjudicado.
    const USES_DE_JOB_ADJUDICADOS: readonly string[] = [];
    const sinAdjudicar = jobs
      .filter((j) => j.usa !== null && !USES_DE_JOB_ADJUDICADOS.includes(j.usa))
      .map((j) => `${j.nombre}: uses ${j.usa}`);
    expect(
      sinAdjudicar.length,
      'un job que llama a un workflow ajeno pasó sin adjudicación',
    ).toBeGreaterThan(0);
  });

  it('🔴 ② un publicador en SEGUNDO JOB sin `needs` no cuenta como gateado', () => {
    const conSuelto = `${ci()}
  publica_suelto:
    runs-on: ubuntu-latest
    steps:
      - run: bash scripts/publicar-vercel.sh app "$HOOK_APP"
`;
    const { jobs } = leerWorkflow(conSuelto);
    const suelto = jobs
      .flatMap((j) => [...j.pasos])
      .find((p) => p.job === 'publica_suelto');
    expect(suelto, 'no se encontró el paso del job suelto').toBeDefined();

    // 🔴 LA AFIRMACIÓN CENTRAL: ese publicador NO tiene ningún gate garantizado
    // antes, aunque esté escrito al final del archivo y todos los gates arriba.
    const previos = pasosGarantizadosAntesDe(jobs, suelto!);
    expect(
      previos,
      'el modelo le atribuyó gates previos a un job que corre en paralelo',
    ).toEqual([]);
  });

  it('🔴 ③ `github.workflow` en un `run:` deja de ser afirmable', () => {
    // El valor de ese context es el `name:` del propio workflow — texto que
    // alguien edita. Con `name: 'CI"; npx vercel --prod; echo "'`, Actions
    // interpola ANTES que bash y el `run` termina con un comando de más.
    const cmd = 'bash scripts/reportar-flaky.sh "${{ github.workflow }}"';
    expect(
      noAfirmable(cmd),
      'el instrumento sigue aceptando un context cuyo valor no es demostrable',
    ).not.toBeNull();

    // Control positivo: un SHA sí es demostrable —40 hexadecimales— y pasa.
    expect(noAfirmable('bash scripts/auditar-secretos.sh "${{ github.sha }}"')).toBeNull();
  });
});

/**
 * 🔴 LA CONDICIÓN DE LA DEPENDENCIA, VERIFICADA Y NO PROMETIDA.
 *
 * `js-yaml` entró como devDependency para el instrumento de tests, autorizada
 * por Mati con esa condición explícita. **Una promesa de «sólo en tests» se
 * rompe sin que nadie se entere**: alcanza con que alguien importe el módulo
 * desde `src/` para meter un parser YAML en el bundle que baja un teléfono en
 * la mesa de un restaurante.
 */
describe('🔴 js-yaml vive SÓLO en el instrumento de tests', () => {
  const FUENTES_DEL_BUNDLE = ['src', 'landing'] as const;

  it('🔴 ningún archivo de `src/` ni `landing/` lo importa', () => {
    const culpables: string[] = [];
    const barrer = (dir: string): void => {
      for (const e of readdirSync(join(RAIZ, dir), { withFileTypes: true })) {
        const ruta = join(dir, e.name);
        if (e.isDirectory()) { barrer(ruta); continue; }
        if (!/\.(ts|tsx|js|mjs|html)$/.test(e.name)) continue;
        const texto = readFileSync(join(RAIZ, ruta), 'utf8');
        if (/from\s+['"]js-yaml['"]|require\(['"]js-yaml['"]\)/.test(texto)) culpables.push(ruta);
      }
    };
    for (const d of FUENTES_DEL_BUNDLE) barrer(d);
    expect(
      culpables,
      `js-yaml importado desde código de producción:\n  ${culpables.join('\n  ')}`,
    ).toEqual([]);
  });

  it('🔴 y no aparece en un bundle CONSTRUIDO POR ESTE TEST', async () => {
    /**
     * 🔴 P68 · ESTE TEST CONSTRUYE SU PROPIO ARTEFACTO, y el motivo es un
     * defecto REAL que encontró mi propio intermitente.
     *
     * Antes exigía que existiera algún `dist*` —a propósito: un
     * `if (!existe) return` habría disfrazado de verde una medición ausente—.
     * Pero `ci.yml` corre `npm test` ANTES del build, así que en un checkout
     * limpio ese `dist*` no existe. Codex lo reprodujo en clon fresco: **60
     * pass / 1 fail**.
     *
     * ⚠️ **Y la parte que más enseña: mi suite pasaba en verde por CASUALIDAD.**
     * `apiUrlObligatoria.test.ts` crea un `dist/` para lo suyo, y el scheduling
     * de Vitest lo ponía a correr antes. **La medición dependía de un
     * side-effect de otro test**, no de un prerrequisito declarado — que es
     * justo la clase de verde que este arnés existe para no producir.
     *
     * 🔴 **ACÁ ESCRIBÍ QUE LOS 3 E2E INTERMITENTES ERAN «EL MISMO FENÓMENO», Y
     * NO ESTÁ MEDIDO.** El dictamen dice textual *«No se repitieron los E2E»*:
     * este race es de un test UNITARIO, y los e2e que fallaban eran de login,
     * que no tocan `dist*`. La conexión la trajo el mensaje que me pasó el
     * dictamen y yo la propagué sin ir a la fuente. **El intermitente e2e sigue
     * sin causa asignada.**
     *
     * Lo que sí vale: declarar la roja en vez de esconderla detrás de dos
     * verdes es lo que la puso a la vista del auditor.
     *
     * La salida hermética es construir acá, en un tmpdir propio: no depende del
     * orden del CI, ni de otro test, ni de que alguien haya corrido un build.
     */
    const dir = mkdtempSync(join(tmpdir(), 'payme-bundle-'));
    // 🔴 `try/finally` — residual de higiene del P71. Si algo falla ANTES del
    // `rmSync`, el tmpdir quedaba tirado. No era un falso verde (la prueba
    // queda roja igual), pero un test que ensucia el disco cuando falla es un
    // test que la gente empieza a evitar correr.
    try {
    const build = await new Promise<{ code: number; out: string }>((ok) => {
      execFile(
        'npx',
        ['vite', 'build', '--outDir', dir, '--emptyOutDir', '--logLevel', 'error'],
        { cwd: RAIZ, encoding: 'utf8', env: { ...process.env, VITE_API_URL: 'https://ejemplo.invalid' } },
        (err, out, errOut) => ok({ code: err ? 1 : 0, out: `${out}${errOut}` }),
      );
    });
    expect(build.code, `el build de la sonda falló:\n${build.out}`).toBe(0);

    const archivos: string[] = [];
    const barrer = (d: string): void => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const ruta = join(d, e.name);
        if (e.isDirectory()) { barrer(ruta); continue; }
        if (/\.(js|mjs|css|html)$/.test(e.name)) archivos.push(ruta);
      }
    };
    barrer(dir);
    // Control positivo: sin archivos, el barrido de abajo pasaría en vacío.
    expect(archivos.length, 'el build no produjo artefactos: la medición sería vacía')
      .toBeGreaterThan(0);

    // `js-yaml` deja rastros propios; se busca su firma además de su nombre,
    // que podría no sobrevivir a la minificación.
    const conYaml = archivos.filter((f) => /YAMLException|js-yaml/.test(readFileSync(f, 'utf8')));
    expect(conYaml, `js-yaml llegó a un artefacto servido:\n  ${conYaml.join('\n  ')}`).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
