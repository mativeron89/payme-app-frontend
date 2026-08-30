import { execFile, spawnSync } from 'node:child_process';
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
  it('🔴 CADA publicador lleva la condición canónica, y su JOB no la afloja', () => {
    // 🔴 P85 · una sola política, en `fallasDelPublicador`. Este `it()` la corre
    // sobre el `ci.yml` real; los casos adversariales la corren sobre el mismo
    // workflow mutado. Desconectar su interior mata a los dos.
    const fallas = fallasDelPublicador(ci);
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
        pasoPublica(texto(p.claves['run'])),
      ),
    );
    expect(publicadores.length, 'no hay publicador: mediría en vacío').toBe(1);
    const paso = publicadores[0]!;

    // ① el multiconjunto de invocaciones, en orden y sin extras
    const invocaciones = comandosDe(texto(paso.claves['run']) ?? '')
      .filter(esInvocacionPublicador)
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
        pasoPublica(texto(p.claves['run'])),
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

describe('vercel.mjs · el despliegue automático sigue apagado', () => {
  it('🔴 `main` NO despliega solo · si alguien lo enciende, esto cae', () => {
    const fuente = readFileSync(join(RAIZ, 'vercel.mjs'), 'utf8');
    expect(fuente).toContain('main: false');
    expect(fuente).not.toContain('main: true');
  });

  /**
   * El motivo vive en un documento. **Esto exige que ese documento
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
 * 🔴 LAS DOS RUTAS LIMPIAS PÚBLICAS · APP-FE-META-PUBLIC-COMPLIANCE-01.
 *
 * `/privacy` y `/facebook-data-deletion/<code>` son rutas limpias: sin un
 * rewrite, un acceso directo o un F5 sobre ellas da 404 en Vercel, porque el
 * router de esta app es hash y nunca necesitó fallback. Meta abre esas URLs en
 * frío, así que el rewrite **es** la funcionalidad, no una comodidad.
 *
 * ## Por qué el censo es de LO PERMITIDO y no de lo prohibido
 *
 * ⚠️ **`payme-app` y `payme-landing` ejecutan ESTE MISMO módulo**, pero con
 * identidad project-scoped distinta. Una regla fuera de la rama `app` volvería
 * a aplicarse a los dos artefactos.
 *
 * Por eso no se enumera lo peligroso —`/(.*)`,`/:path*`, `/`, un `redirects`
 * nuevo, un `cleanUrls`— sino que **se declara lo permitido y todo lo demás
 * cae**: las claves de primer nivel son exactamente estas tres, y los `source`
 * son exactamente los dos paths públicos. Una lista de lo conocido falla
 * abierta; es la lección que este mismo archivo pagó cuatro veces en el censo
 * de pasos.
 *
 * 🔴 **Aislamiento causal:** `PAYME_VERCEL_ARTIFACT=landing` produce cero
 * rewrites y cero headers. No se usa `has: host`; la identidad del proyecto
 * cubre producción y previews sin enumerar dominios.
 *
 * ─── LAS CABECERAS, Y POR QUÉ SU GUARDA VIVE EN DOS ARCHIVOS ────────────────
 *
 * Las dos rutas llevan `Cache-Control: no-store` y `Referrer-Policy:
 * no-referrer`, acotadas a esos dos `source`. La entrega anterior las dejó
 * FUERA: `scripts/headersLandingScope.test.ts` prohibía la clave `headers` de
 * forma total y estaba fuera de la allowlist, así que se cedió ante la guarda
 * viva y se reportó el conflicto. La adenda de corrección amplió la allowlist a
 * ese archivo y a `docs/HARDENING_LANDING_LOCAL.md`, y la prohibición total
 * pasó a ser un **censo cerrado**: sólo esas dos reglas, esos dos pares, esos
 * dos paths.
 *
 * El censo fino —mutantes de tercer path, wildcard, header extra, valor
 * distinto, duplicado— vive en `headersLandingScope.test.ts`, que es su dueño
 * histórico. Acá se afirma lo que le toca a este archivo: que existan, con su
 * valor, sobre los dos paths, y que no aparezca un tercer `source`.
 *
 * 🔴 **Y lo que ninguno de los dos acredita:** que el edge las SIRVA. Esto es
 * configuración del repo. Las cabeceras efectivamente servidas, y en cuál de
 * los dos proyectos, son gate externo previo a producción.
 */
describe('vercel.mjs · las dos rutas limpias públicas', () => {
  interface Cabecera { readonly key: string; readonly value: string }
  interface Regla { readonly source: string; readonly headers?: readonly Cabecera[] }

  const proceso = spawnSync(
    process.execPath,
    ['--input-type=module', '--eval', "import('./vercel.mjs').then(m=>process.stdout.write(JSON.stringify(m.config)))"],
    { cwd: RAIZ, encoding: 'utf8', env: { ...process.env, PAYME_VERCEL_ARTIFACT: 'app' } },
  );
  if (proceso.status !== 0) throw new Error(proceso.stderr);
  const V = JSON.parse(proceso.stdout) as {
    rewrites?: ReadonlyArray<{ source: string; destination: string }>;
    headers?: readonly Regla[];
  };

  /** Los dos únicos `source` que este archivo puede nombrar. */
  const PATHS_PUBLICOS = ['/privacy', '/facebook-data-deletion/:code'] as const;

  it('🔴 las claves de primer nivel son EXACTAMENTE tres', () => {
    // `redirects`, `cleanUrls`, `trailingSlash`, `routes` o `functions` nuevos
    // caen acá: no hace falta nombrarlos, alcanza con no estar en la lista.
    expect(Object.keys(V).sort()).toEqual(
      ['git', 'headers', 'rewrites'],
    );
  });

  it('🔴 los rewrites son los dos exactos · ni de más, ni cambiados', () => {
    expect(
      V.rewrites,
      'si esto cambia, un acceso directo a las páginas de Meta vuelve a dar 404',
    ).toEqual([
      { source: '/privacy', destination: '/index.html' },
      { source: '/facebook-data-deletion/:code', destination: '/index.html' },
    ]);
  });

  it('🔴 cada `source` es un path público exacto · NADA global', () => {
    const fuentes = (V.rewrites ?? []).map((r) => r.source);
    expect(fuentes, 'los rewrites dejaron de cubrir las dos rutas, o cubren de más')
      .toEqual([...PATHS_PUBLICOS]);
  });

  it('🔴 las cabeceras existen, con su valor, sobre los dos paths y ninguno más', () => {
    expect(
      (V.headers ?? []).map((h) => h.source),
      'los bloques de headers dejaron de cubrir las dos rutas, o cubren de más',
    ).toEqual([...PATHS_PUBLICOS]);

    for (const bloque of V.headers ?? []) {
      expect(
        bloque.headers,
        `las cabeceras de \`${bloque.source}\` no son las ratificadas`,
      ).toEqual([
        { key: 'Cache-Control', value: 'no-store' },
        { key: 'Referrer-Policy', value: 'no-referrer' },
      ]);
    }
  });

  /**
   * 🔴 EL LÍMITE, ESCRITO DONDE ALGUIEN LO VA A BUSCAR. Este archivo prueba la
   * configuración; que el edge sirva esas cabeceras es otra medición y vive
   * afuera. Si el doc deja de decirlo, esto cae.
   */
  it('🔴 el doc declara que configurar no es servir', () => {
    const doc = readFileSync(join(RAIZ, 'docs', 'HARDENING_LANDING_LOCAL.md'), 'utf8');
    expect(doc, 'el doc no registra la excepción aislada')
      .toContain('Excepción aislada por proyecto');
    expect(doc, 'el doc no separa configuración de cabecera servida')
      .toContain('gate externo previo a producción');
  });

  /**
   * 🔴 CONTROL POSITIVO. Sin esto, un config sin `rewrites` ni `headers`
   * dejaría en verde los censos de arriba comparando listas vacías y recorriendo
   * cero bloques.
   */
  it('🔴 el archivo tiene las reglas de verdad · nada mide en vacío', () => {
    expect(V.rewrites, 'no hay rewrites: el gate mediría sobre nada').toHaveLength(2);
    expect(V.headers, 'no hay bloques de headers').toHaveLength(2);
    expect((V.headers ?? []).flatMap((h) => h.headers ?? [])).toHaveLength(4);
    expect(PATHS_PUBLICOS).toHaveLength(2);
  });

  /**
   * 🔴 MUTANTE · UNA REGLA GLOBAL. Se planta sobre una COPIA del JSON real y se
   * exige que la política la rechace. Sin esto, «los source son los dos
   * públicos» sería una igualdad que nadie probó que discrimine.
   */
  it.each(['/(.*)', '/:path*', '/', '/assets/(.*)'])(
    '🔴 un `source: "%s"` NO pasa la política',
    (global) => {
      const mutado = structuredClone(V) as unknown as { rewrites: Array<{ source: string }> };
      mutado.rewrites.push({ source: global });
      expect(
        mutado.rewrites.map((r) => r.source),
        `una regla global sobre \`${global}\` alcanzaría también a la landing`,
      ).not.toEqual([...PATHS_PUBLICOS]);
    },
  );
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
 * **UN SOLO** camino automático que mueve los dominios, y que es el gateado.
 * Desde 0.144.6 existe además un workflow manual de staging prebuilt: crea
 * URLs productivas aisladas con `--skip-domain`, las verifica y termina sin
 * promover. No compite con el camino de dominios, pero sí es un workflow con
 * side effect y por eso su archivo entra explícitamente al censo.
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
/** El mapping crudo de un job — para claves que el modelo no expone aún. */
const jobCrudo = (yml: string, nombre: string): Record<string, unknown> | undefined => {
  const doc = load(yml) as { jobs?: Record<string, unknown> } | undefined;
  const j = doc?.jobs?.[nombre];
  return typeof j === 'object' && j !== null ? (j as Record<string, unknown>) : undefined;
};

/**
 * 🔴 P77 · EL CONTEXTO DE EJECUCIÓN EFECTIVO DE UN PASO, EN UN SOLO LUGAR.
 *
 * Las vueltas anteriores fueron agregando dimensiones —`shell`,
 * `working-directory`, `continue-on-error`, `strategy`— **y todas se
 * escribieron sólo para el PUBLICADOR**. Codex mostró la consecuencia: los
 * CINCO GATES que autorizan a publicar quedaban sin gobierno, así que
 * `npm test` con `working-directory: .audit-fake-gate` (un `package.json`
 * no-op) o con `shell: bash -c 'true # {0}'` **terminaba 0 sin ejecutar
 * nada**, y el arnés lo seguía contando como gate real.
 *
 * 📌 **El principio que sale de ahí, y es el que vale más que el parche: de
 * nada sirve blindar al que publica si el que lo AUTORIZA a publicar puede
 * volverse un no-op.**
 *
 * Por eso esto no es un chequeo más: es **una sola definición de "contexto
 * gobernado"** que se aplica a toda la población que importa —el publicador y
 * cada gate—. La dimensión que se agregue mañana entra acá y cubre a todos;
 * escrita en el consumidor de turno, vuelve a dejar la mitad afuera, que es
 * exactamente lo que pasó cuatro vueltas seguidas.
 */
const TOLERANCIA_VALIDA = (v: unknown): boolean => v === undefined || v === false;

/** `defaults.run.<clave>` de un mapping (workflow o job). */
const defaultRun = (n: unknown, clave: string): unknown => {
  if (typeof n !== 'object' || n === null) return undefined;
  const d = (n as Record<string, unknown>)['defaults'];
  if (typeof d !== 'object' || d === null) return undefined;
  const r = (d as Record<string, unknown>)['run'];
  if (typeof r !== 'object' || r === null) return undefined;
  return (r as Record<string, unknown>)[clave];
};

/**
 * `BASH_ENV` heredado — P77.
 *
 * 🔴 Bash NO INTERACTIVO ejecuta el archivo que apunta `BASH_ENV` **antes**
 * del script, y `--noprofile --norc` no lo neutraliza. Codex redefinió `bash`
 * desde ese prelude y **las dos líneas del publicador terminaron 0 sin
 * ejecutar `publicar-vercel.sh`**: el arnés certificaba un cuerpo que no
 * corrió.
 *
 * Se rechaza heredado de workflow y de job. No se intenta "modelar el env
 * efectivo": eso es reimplementar la precedencia de env de Actions, la misma
 * familia de intérprete a medias que ya costó varias vueltas.
 */
/**
 * 🔴 P81 · IGUALDAD DE MAPPINGS POR PAREJAS, NO POR ORDEN.
 *
 * La comparación usaba `JSON.stringify`, que es sensible al orden de las claves:
 * invertir `HOOK_APP`/`HOOK_LANDING` **con las mismas parejas** ponía el gate en
 * rojo. **En YAML el orden de un mapping no cambia su significado**, así que era
 * un FALSO ROJO — el primero de toda la saga en esa dirección.
 *
 * ⚠️ Vale anotarlo porque nueve vueltas fueron de guardas que dejaban pasar de
 * más, y **una guarda que cierra de más también es un defecto**: enseña a
 * desconfiar del gate, y un gate del que se desconfía se termina aflojando.
 */
/**
 * 🔴 P81 · POR PAREJAS CLAVE/VALOR, NO POR `JSON.stringify`: en YAML el orden de
 * un mapping no cambia su significado, y comparar el texto serializado ponía rojo
 * un swap de orden inocuo. 🔴 P85 · el valor se tipa `unknown` porque el `with`
 * del checkout trae `fetch-depth: 0` **numérico**; forzarlo a `'0'` habría dado
 * un falso rojo en el nominal. La comparación sigue siendo estricta.
 */
function mismoMapping(a: unknown, b: Readonly<Record<string, unknown>>): boolean {
  if (typeof a !== 'object' || a === null || Array.isArray(a)) return false;
  const m = a as Record<string, unknown>;
  const claves = Object.keys(m).sort();
  const esperadas = Object.keys(b).sort();
  if (claves.length !== esperadas.length) return false;
  if (claves.some((k, i) => k !== esperadas[i])) return false;
  return claves.every((k) => m[k] === b[k]);
}

const envDe = (n: unknown): unknown => {
  if (typeof n !== 'object' || n === null) return undefined;
  return (n as Record<string, unknown>)['env'];
};

/**
 * 🔴 EL CONTEXTO MÍNIMO DE CADA ROL — la allowlist positiva.
 *
 * Un mapping vacío significa **«este paso no necesita NINGUNA variable»**, que
 * es distinto de «no la miramos». Agregar una entrada acá es una decisión
 * consciente y queda en el diff, que es exactamente lo que se busca.
 */
const ENV_POR_ROL: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  checkout: {},
  scanner: {},
  setup: {},
  instalacion: {},
  espejo: {},
  aliases: {},
  corrida: {},
  'invalidar-corrida': {},
  'invalidar-build': {},
  artefacto: {},
  test: {},
  typecheck: {},
  build: { VITE_API_URL: 'https://payme-app-backend-production.up.railway.app' },
  'playwright-install': {},
  playwright: {},
  reporter: {},
  publicador: {
    HOOK_APP: '${{ secrets.VERCEL_HOOK_APP }}',
    HOOK_LANDING: '${{ secrets.VERCEL_HOOK_LANDING }}',
  },
};

/**
 * 🔴 P81 · LA POBLACIÓN COMPLETA, CON ROL PARA CADA PASO.
 *
 * Los dos arrays `GATES` enumeraban CINCO pasos —espejo, test, typecheck, build,
 * Playwright— y todo lo demás quedaba fuera de la política. **El auditor de
 * secretos estaba entre lo que quedaba fuera**: el censo lo admitía como
 * comando permitido, pero nadie miraba su contexto, así que un
 * `env.BASH_ENV` lo volvía no-op y la suite seguía verde con el scanner
 * terminando 0 sin ejecutarse.
 *
 * ⚠️ **Es exactamente el hueco que yo mismo había mapeado al censar mi deuda:**
 * *«la población de pasos-gate es una lista de nombres; uno no nombrado
 * entra»*. El scanner era ese uno. Que lo hubiera anticipado y no lo hubiera
 * cerrado es la diferencia entre ver la clase y ver la instancia.
 *
 * Ahora la población se deriva de TODOS los pasos del job, y **un paso sin rol
 * es rojo**. Setup, instalación y reporter están clasificados explícitamente —
 * no porque sean inofensivos, sino porque **decir «éste no bloquea» es una
 * afirmación que alguien tuvo que escribir**, y queda en el diff.
 */
const ROL_DE_PASO: ReadonlyArray<readonly [RegExp, string]> = [
  [/^actions\/checkout@/, 'checkout'],
  [/^actions\/setup-node@/, 'setup'],
  [/^bash scripts\/auditar-secretos\.sh$/, 'scanner'],
  [/^npm ci$/, 'instalacion'],
  [/^node scripts\/verificar-mirror\.mjs$/, 'espejo'],
  // 🔴 P88 · EL ROL LLEVA EL MODO. Los dos pasos son el mismo ejecutable con
  // banderas distintas; con un rol común, sacar uno del workflow dejaba al otro
  // satisfaciendo la exigencia y el mutante sobrevivía 85/85.
  [/^node scripts\/verificar-aliases\.mjs --aliases$/, 'aliases'],
  [/^node scripts\/verificar-aliases\.mjs --corrida$/, 'corrida'],
  // 🔴 CADA INVALIDACIÓN ES SU PROPIO ROL. Con un rol común, sacar una del
  // workflow dejaba a la otra satisfaciendo la exigencia — el mismo defecto que
  // ya se pagó con los dos modos del verificador.
  [/^node scripts\/verificar-aliases\.mjs --invalidar corrida$/, 'invalidar-corrida'],
  [/^node scripts\/verificar-aliases\.mjs --invalidar build$/, 'invalidar-build'],
  // 🔴 P90 · EL COMANDO COMPLETO, CON SU DESTINO. `rolDePaso` compara prefijos
  // de hasta 3 tokens, así que el 4º —`dist`— quedaba fuera del rol y del censo:
  // cambiarlo por `--artefacto .` daba exit 0 sobre el `index.html` de la raíz y
  // un `.js` ajeno del contract-mirror. Cuatro tokens, adjudicados.
  [/^node scripts\/verificar-aliases\.mjs --artefacto dist$/, 'artefacto'],

  [/^npm test$/, 'test'],
  [/^npm run typecheck$/, 'typecheck'],
  [/^npm run build$/, 'build'],
  [/^npx playwright install$/, 'playwright-install'],
  [/^npx playwright test$/, 'playwright'],
  [/^bash scripts\/reportar-flaky\.sh$/, 'reporter'],
  [/^bash scripts\/publicar-vercel\.sh$/, 'publicador'],
];

/**
 * 🔴 QUÉ ROLES BLOQUEAN LA PUBLICACIÓN — y por qué esto se declara y no se
 * infiere.
 *
 * Un paso que bloquea no puede llevar `if:` ni tolerar su propio error: si
 * falla, la publicación no sale. El **reporter** es el único que NO bloquea —
 * informa flakies y lleva `if: always()` a propósito, porque tiene que correr
 * aunque Playwright haya fallado.
 *
 * ⚠️ **«Éste no bloquea» es una afirmación, no una omisión.** Está escrita acá y
 * queda en el diff: el día que alguien agregue un paso informativo más, tiene
 * que venir a declararlo, y ahí se decide si de verdad no bloquea.
 */
const ROLES_QUE_NO_BLOQUEAN: ReadonlySet<string> = new Set(['reporter']);

/** El rol de un paso, por el PREFIJO DE TOKENS de su comando o su `uses`. */
function rolDePaso(claves: { readonly [k: string]: unknown }): string | null {
  const uses = typeof claves['uses'] === 'string' ? (claves['uses'] as string) : null;
  if (uses !== null) {
    return ROL_DE_PASO.find(([re]) => re.test(uses))?.[1] ?? null;
  }
  const run = typeof claves['run'] === 'string' ? (claves['run'] as string) : '';
  for (const cmd of comandosDe(run)) {
    const ts = tokens(cmd);
    if (ts === null) return null;
    // Se compara el PREFIJO ejecutable —intérprete + script, o los tokens del
    // comando npm— y no la línea entera: los argumentos son de cada paso.
    //
    // 🔴 P90 · HASTA 4 TOKENS, NO 3. Con tres, `node verificar-aliases.mjs
    // --artefacto dist` perdía su destino: el rol matcheaba igual con
    // `--artefacto .`, que sale 0 sobre el `index.html` de la raíz y un `.js`
    // ajeno del contract-mirror. **Un argumento que cambia QUÉ se verifica no es
    // un argumento del paso: es parte de la identidad del gate.**
    for (const [re, rol] of ROL_DE_PASO) {
      for (const n of [1, 2, 3, 4]) {
        if (ts.length >= n && re.test(ts.slice(0, n).join(' '))) return rol;
      }
    }
  }
  return null;
}

/**
 * Las fallas del contexto de ejecución de UN paso, mirando sus tres niveles.
 * `que` nombra el rol para que el mensaje diga qué se rompe: «el publicador»
 * o «el gate `npm test`».
 */
const fallasDeContexto = (
  yml: string,
  nombreJob: string,
  claves: { readonly [k: string]: unknown },
  donde: string,
  que: string,
  rol: string,
): string[] => {
  const out: string[] = [];
  const crudoJob = jobCrudo(yml, nombreJob);
  const doc = load(yml);

  if (claves['shell'] !== undefined) {
    out.push(`${donde}: ${que} declara \`shell: ${JSON.stringify(claves['shell'])}\` — otra semántica`);
  }
  if (defaultRun(crudoJob, 'shell') !== undefined) {
    out.push(`${donde}: el job «${nombreJob}» declara \`defaults.run.shell\``);
  }
  if (defaultRun(doc, 'shell') !== undefined) {
    out.push(`${donde}: el WORKFLOW declara \`defaults.run.shell\``);
  }

  if (claves['working-directory'] !== undefined) {
    out.push(
      `${donde}: ${que} declara \`working-directory: ${JSON.stringify(claves['working-directory'])}\` — correría en otro lado`,
    );
  }
  if (defaultRun(crudoJob, 'working-directory') !== undefined) {
    out.push(`${donde}: el job «${nombreJob}» declara \`defaults.run.working-directory\``);
  }
  if (defaultRun(doc, 'working-directory') !== undefined) {
    out.push(`${donde}: el WORKFLOW declara \`defaults.run.working-directory\``);
  }

  if (!ROLES_QUE_NO_BLOQUEAN.has(rol) && !TOLERANCIA_VALIDA(claves['continue-on-error'])) {
    out.push(
      `${donde}: ${que} lleva \`continue-on-error: ${JSON.stringify(claves['continue-on-error'])}\` — sólo se admite ausencia o el booleano false`,
    );
  }
  if (!TOLERANCIA_VALIDA(crudoJob?.['continue-on-error'])) {
    out.push(`${donde}: su job «${nombreJob}» lleva \`continue-on-error\` inválido o verdadero`);
  }

  /**
   * 🔴 P79 · EL `env` SE ADJUDICA POR ALLOWLIST POSITIVA, NO POR NOMBRES MALOS.
   * Éste es el giro que cierra la clase entera.
   *
   * Ocho vueltas fui agregando guardas que RECHAZAN formas conocidas —
   * `strategy`, `BASH_ENV` de job, `working-directory`, `shell`,
   * `continue-on-error` string— y cada vuelta apareció la siguiente. Acá la
   * lista de lo malo no tiene fin: además de `BASH_ENV` sobrevivieron
   * `npm_config_script_shell: /usr/bin/true` y
   * `NODE_OPTIONS=--import=data:...process.exit(0)`, **cada uno terminando 0 sin
   * ejecutar la verificación**. Enumerarlos es la carrera perdida.
   *
   * **Al revés sí cierra: cada rol declara el `env` que NECESITA y todo lo no
   * declarado es rojo, sin importar cómo se llame.** No hay «una variable más»:
   * la próxima que alguien invente ya está prohibida por no estar entre las
   * buenas.
   *
   * ⚠️ Es la MISMA forma que ya había usado para la gramática de shell —afirmar
   * lo simple en vez de enumerar lo complejo— **escrita en este mismo archivo,
   * unas líneas más arriba**. Que hicieran falta ocho vueltas para aplicarla al
   * ambiente, teniéndola delante, es lo que más vale registrar de esta vuelta.
   *
   * Los niveles heredados no aportan nada legítimo hoy: un `env` de job o de
   * workflow llega a TODOS los pasos, así que se rechaza entero.
   */
  const envDelPaso = claves['env'];
  const esperado = ENV_POR_ROL[rol];
  if (esperado === undefined) {
    out.push(`${donde}: rol «${rol}» sin política de env declarada`);
  } else if (Object.keys(esperado).length === 0) {
    if (envDelPaso !== undefined) {
      out.push(
        `${donde}: ${que} declara \`env\` y su rol no necesita ninguna: ${JSON.stringify(envDelPaso)}`,
      );
    }
  } else if (!mismoMapping(envDelPaso, esperado)) {
    out.push(
      `${donde}: el \`env\` de ${que} no es EXACTAMENTE el de su rol\n` +
        `     esperado: ${JSON.stringify(esperado)}\n     hallado:  ${JSON.stringify(envDelPaso)}`,
    );
  }
  if (envDe(crudoJob) !== undefined) {
    out.push(`${donde}: el job «${nombreJob}» declara \`env\` — llegaría a TODOS sus pasos`);
  }
  if (envDe(doc) !== undefined) {
    out.push(`${donde}: el WORKFLOW declara \`env\` — llegaría a todos los jobs`);
  }
  /**
   * 🔴 P81 · CUALQUIER `container` ES ROJO. Su `env` —y su `options --env`—
   * llega a TODOS los pasos sin pasar por el `env` directo que se adjudica
   * arriba: es una FUENTE de ambiente que la allowlist no miraba, no una
   * dimensión más. Hoy ningún job lo necesita; el día que haga falta se fija su
   * imagen, su `env` y sus `options` completos, y se decide a la vista.
   */
  if (crudoJob?.['container'] !== undefined) {
    out.push(
      `${donde}: su job «${nombreJob}» declara \`container\` — su env llegaría a TODOS los pasos`,
    );
  }
  return out;
};

/**
 * 🔴 P75 · LA ÚNICA FORMA DE RECONOCER UNA INVOCACIÓN DEL PUBLICADOR.
 *
 * Había SEIS lugares con `/^bash scripts\/publicar-vercel\.sh/`, que exige
 * exactamente **un espacio ASCII**, conviviendo con un censo general que
 * tokeniza cualquier whitespace. Dos vistas del mismo objeto con gramáticas
 * distintas, y Codex metió la cuña justo ahí:
 *
 * ```yaml
 * - run: bash  scripts/publicar-vercel.sh app "$HOOK_APP"   ← DOS espacios
 * ```
 *
 * El censo general lo daba por **permitido** —`tokens()` normaliza el
 * whitespace— y las cinco guardas específicas **no lo veían como publicador**:
 * ni condición, ni cardinalidad, ni secretos, ni causalidad, ni tolerancia. Un
 * publicador ejecutable, allowlisteado y sin gobierno, que además podía correr
 * fuera de push-main. Focal 63/63.
 *
 * ⚠️ **Es una CONTRADICCIÓN INTERNA del arnés, no una forma que faltara.** Es la
 * misma clase que atravesó toda la noche —la sombra que §E pedía con un navy y
 * §D con otro— pero cometida acá adentro, entre dos partes del mismo archivo.
 *
 * Por eso la respuesta no es «agregarle `\s+` al regex»: es que **haya una sola
 * definición**, derivada del mismo `tokens()` que usa el censo, y que todos los
 * consumidores la llamen. Dos gramáticas para el mismo objeto vuelven a
 * divergir apenas se toque una.
 */
function esInvocacionPublicador(cmd: string): boolean {
  const ts = tokens(cmd);
  return ts !== null && ts[0] === 'bash' && ts[1] === 'scripts/publicar-vercel.sh';
}

/** ¿El `run:` de este paso contiene al menos una invocación del publicador? */
function pasoPublica(run: string | null): boolean {
  return comandosDe(run ?? '').some(esInvocacionPublicador);
}

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
 * 🔴 P85 · LAS POLÍTICAS SON FUNCIONES, PARA QUE EL CENTINELA ATRAVIESE EL SEAM.
 *
 * Hasta P83 cada política vivía **dentro** de su `it()`, y los casos
 * adversariales —los que plantan una forma mala sobre el workflow real— llamaban
 * por su cuenta al helper `fallasDeContexto`. Parecía equivalente y **no lo es**:
 * probaban que el HELPER reconoce la forma, no que la POLÍTICA siga llamándolo.
 *
 * Codex lo midió con cuatro mutantes, uno por seam: retirar **sólo** la llamada
 * real —el `fallasDeContexto` del bucle de gates, el del publicador, la guarda de
 * `strategy`, la igualdad exacta del checkout— dejaba la focal **83/83 verde**.
 * El centinela apuntaba a un llamado privado que se le parecía.
 *
 * ⚠️ **Es la misma lección que ya tenía escrita de una vuelta anterior** —probar
 * la función no es probar el cableado— y la volví a cometer en la forma de al
 * lado. La forma que la cierra no es un mutante más: es que **no exista** un
 * segundo camino. Una política = una función; el `it()` nominal la llama con el
 * `ci.yml` real, el adversarial con el mutado, y **desconectar el interior mata a
 * los dos**.
 *
 * Los controles positivos viajan DENTRO de la función, como fallas: si el
 * workflow mutado dejara de tener publicador, checkout o gates, la política lo
 * dice en vez de pasar en vacío.
 */
const CONDICION_CANONICA =
  "success() && github.event_name == 'push' && github.ref == 'refs/heads/main'";

/** Toda la compuerta del publicador: condición, `if` del job, `strategy` y contexto. */
function fallasDelPublicador(yml: string): string[] {
  const { jobs, problemas } = leerWorkflow(yml);
  if (problemas.length > 0) return problemas.map((p) => `el modelo no pudo adjudicar: ${p}`);

  const publicadores = jobs.flatMap((j) =>
    j.pasos
      .filter((p) => pasoPublica(texto(p.claves['run'])))
      .map((p) => ({ paso: p, job: j })),
  );
  // Control positivo, adentro: sin publicadores esto mediría en vacío.
  if (publicadores.length === 0) return ['no se encontró ningún publicador: mediría en vacío'];

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
    /**
     * El `if` del JOB también decide si el paso corre. Cualquier condición a
     * ese nivel es roja: no se interpreta, se rechaza.
     *
     * 🔴 P73 · SE COMPARA CONTRA `undefined`, NO CONTRA `null`. Con `if: true`
     * YAML entrega un booleano; el modelo viejo lo guardaba como `null` y esta
     * guarda lo leía como «no hay condición». **`null` mezclaba «ausente» con
     * «presente en una forma que no supe leer»**, y la segunda tiene que ser
     * roja — es exactamente donde se esconde lo que no anticipé.
     */
    if (job.condicion !== undefined) {
      fallas.push(
        `${donde}: su job «${job.nombre}» lleva \`if: ${JSON.stringify(job.condicion)}\` — puede aflojar la compuerta`,
      );
    }
    /**
     * 🔴 P73 · `strategy` EN EL JOB DEL PUBLICADOR ES ROJO, sin interpretar.
     *
     * Una matriz expande el job en varias ejecuciones, **cada una con su paso
     * publicador completo**. Con `matrix: replica: [1,2]` el workflow dispara
     * App y Landing dos veces cada una —cuatro hooks— mientras el gate de abajo
     * certifica «exactamente dos invocaciones». **Contaba líneas y creía contar
     * ejecuciones.**
     *
     * Se prohíbe en vez de modelar la expansión: modelarla pide reproducir las
     * reglas de `matrix`, `include`, `exclude` y `fail-fast` — otro intérprete a
     * medias, que es la clase que este arnés viene cerrando hace quince vueltas.
     */
    if (job.estrategia !== undefined) {
      fallas.push(
        `${donde}: su job «${job.nombre}» declara \`strategy\` — se expandiría en varias ` +
          'ejecuciones y publicaría más de una vez',
      );
    }
    /**
     * 🔴 P73 · UN FALLO DEL PUBLICADOR NO PUEDE QUEDAR TOLERADO, y 🔴 P75 · SÓLO
     * AUSENCIA O EL BOOLEANO `false`: la cadena `'false'` produce un workflow
     * INVÁLIDO y el arnés lo daba por bueno. Todo el contexto de ejecución sale
     * de la definición única.
     */
    fallas.push(
      ...fallasDeContexto(yml, job.nombre, paso.claves, donde, 'el publicador', 'publicador'),
    );
  }
  return fallas;
}

/**
 * El censo: todo job y todo paso del workflow, adjudicados por allowlist.
 *
 * 🔴 P68 · MIRA JOBS, NO SÓLO PASOS. El parser YA representaba `jobs.<id>.uses`
 * —un reusable workflow, que ejecuta con sus secretos y NO tiene `steps`—, y
 * había un test del modelo puro que lo probaba. **Pero el censo integrado volvía
 * a aplanar sólo `jobs[].pasos`**: Codex agregó un reusable job real y quedó
 * 61/61 focal y 96/96 la full.
 *
 * ⚠️ **La lección es del patrón:** arreglar la REPRESENTACIÓN no arregla a los
 * CONSUMIDORES, y un test del modelo puro puede estar verde mientras el gate
 * integrado no usa lo que el modelo aprendió.
 */
function fallasDelCenso(yml: string): string[] {
  const { jobs, problemas } = leerWorkflow(yml);
  if (problemas.length > 0) return problemas.map((p) => `hay jobs que el modelo no puede adjudicar: ${p}`);
  // Controles positivos, adentro: sin jobs ni pasos el censo mediría en vacío.
  if (jobs.length === 0) return ['no se leyó ningún job: el censo mediría en vacío'];

  const fallas: string[] = [];
  /**
   * Reusables ADJUDICADOS: hoy ninguno. No es una lista vacía por descuido — es
   * la declaración de que este repo no delega su CI en un workflow ajeno. El día
   * que se quiera, se agrega acá con su `owner/repo/.../wf.yml@ref` exacto y se
   * decide qué secretos recibe.
   */
  const REUSABLES_ADJUDICADOS: readonly string[] = [];
  for (const j of jobs) {
    if (j.usa !== null && !REUSABLES_ADJUDICADOS.includes(j.usa)) {
      fallas.push(
        `job «${j.nombre}» delega su ejecución en un workflow ajeno y nadie lo adjudicó: ` +
          `uses ${j.usa} (secrets: ${JSON.stringify(j.secretos)})`,
      );
    }
  }

  /**
   * 🔴 P88 · LA ACCIÓN Y SU `with`, EXACTOS — antes era una regex laxa.
   *
   * Acá había `/^actions\/(checkout|setup-node)@[A-Za-z0-9._-]+$/` **con un
   * comentario que decía «la acción exacta y su versión»**. La regex aceptaba
   * CUALQUIER ref: `actions/setup-node@main` pasaba, y con él `node-version: 24`
   * — un runtime distinto del adjudicado, en los gates que preceden a la
   * publicación. El checkout tenía política exacta; setup-node no tenía ninguna.
   *
   * ⚠️ **Y el comentario era lo peor del defecto**, no un detalle: afirmaba la
   * garantía que faltaba, justo donde alguien iría a verificarla. Se caza
   * comparando qué LEE la guarda contra qué NOMBRA su comentario.
   *
   * Ahora cada acción declara su `with` completo. Una clave de más, una de
   * menos o un valor distinto es rojo sin enumerar cuál — misma forma que el
   * `env` por rol.
   */
  const ACCIONES_ADJUDICADAS: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
    'actions/checkout@v4': { 'fetch-depth': 0, 'persist-credentials': false },
    'actions/setup-node@v4': { 'node-version': 20, cache: 'npm' },
  };

  /**
   * 🔴 P88 · CADA ACCIÓN, CON SU `with` COMPLETO. Se recorre el MODELO y no
   * `pasosDe`, porque `Paso` no conserva el `with` — y sin el `with` se puede
   * adjudicar `setup-node@v4` mientras pide `node-version: 24`.
   */
  let accionesVistas = 0;
  for (const j of jobs) {
    for (const p of j.pasos) {
      const usa = p.claves['uses'];
      if (typeof usa !== 'string') continue;
      accionesVistas++;
      const donde = `${p.job}.steps[${p.indice}]`;
      const esperado = ACCIONES_ADJUDICADAS[usa];
      if (esperado === undefined) {
        fallas.push(`${donde}: uses \`${usa}\` — acción o versión NO adjudicada`);
      } else if (!mismoMapping(p.claves['with'] ?? {}, esperado)) {
        fallas.push(
          `${donde}: el \`with\` de \`${usa}\` no es el exacto — esperado ` +
            `${JSON.stringify(esperado)}, hallado ${JSON.stringify(p.claves['with'] ?? {})}`,
        );
      }
    }
  }
  // Control positivo, adentro: el workflow usa acciones; cero significa que este
  // bucle no midió nada, no que todas estuvieran bien.
  if (accionesVistas === 0) fallas.push('no se vio ninguna acción `uses:`: el censo mediría en vacío');

  const pasos = pasosDe(yml);
  if (pasos.length <= 8) return [...fallas, `sólo se parsearon ${pasos.length} pasos: el censo mediría en vacío`];

  /**
   * 🔴 P60 · SE ADJUDICA POR TOKENS EXACTOS, NO POR PREFIJO DE CADENA. La lista
   * anterior usaba `/^bash scripts\/reportar-flaky\.sh\b/`, y `\b` **no delimita
   * ante un guion**, así que `…-alternativo` quedaba adjudicado como si fuera el
   * script conocido. ⚠️ Es la MISMA clase que la allowlist de dominios —comparar
   * por prefijo en vez de por la unidad real—; se repitió en otro archivo con
   * otra herramienta: la lección no había viajado.
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
    ['node', 'scripts/verificar-aliases.mjs'], // gate del alias→herramienta (P88)
    ['bash', 'scripts/reportar-flaky.sh'], // informa, no bloquea
    // 🔴 P77 · LA PUBLICACIÓN NO VA EN ESTA LISTA. Tenía su propia tupla acá, en
    // paralelo a `esInvocacionPublicador`. Hoy las dos coincidían, **y ésa es la
    // trampa**: dos fuentes que coinciden hoy son una casualidad fechada, no una
    // propiedad. Ahora el censo delega en el MISMO predicado.
  ];

  const adjudicaComando = (cmd: string): boolean => {
    if (esInvocacionPublicador(cmd)) return true;
    const ts = tokens(cmd);
    if (ts === null) return false;
    return ADJUDICADOS.some((patron) => patron.every((tok, k) => ts[k] === tok));
  };

  for (const p of pasos) {
    const donde = `${p.job}.steps[${p.indice}]`;
    // Los `uses:` se adjudican aparte, sobre el modelo, que conserva su `with`.
    if (p.uses !== null) continue;
    const trozos = comandosDe(p.run ?? '');
    if (!trozos.length) { fallas.push(`${donde}: paso sin \`run\` ni \`uses\``); continue; }
    for (const t of trozos) {
      // 🔴 Primero lo indecidible: un prefijo permitido NO adjudica lo que el
      // comando evalúe adentro. El orden importa — si se mirara el allowlist
      // primero, `bash permitido.sh "$(peligroso)"` pasaría por el prefijo.
      const opaco = noAfirmable(t);
      if (opaco) { fallas.push(`${donde}: ${opaco} → \`${t}\``); continue; }
      if (!adjudicaComando(t)) fallas.push(`${donde}: \`${t}\``);
    }
  }
  return fallas;
}

/** El checkout: único, versión adjudicada, `with` EXACTO y contexto gobernado. */
function fallasDelCheckout(yml: string): string[] {
  const { jobs, problemas } = leerWorkflow(yml);
  if (problemas.length > 0) return problemas.map((p) => `el modelo no pudo adjudicar: ${p}`);

  const checkouts = jobs.flatMap((j) =>
    j.pasos
      .filter((p) => typeof p.claves['uses'] === 'string' &&
        /^actions\/checkout@/.test(p.claves['uses'] as string))
      .map((p) => ({ paso: p, job: j.nombre })),
  );
  // Control positivo, adentro: sin checkout único el resto pasaría en vacío.
  if (checkouts.length !== 1) {
    return [`hay ${checkouts.length} checkouts y debe haber exactamente 1: el workspace no es único`];
  }

  const fallas: string[] = [];
  const { paso, job } = checkouts[0]!;
  if (paso.claves['uses'] !== 'actions/checkout@v4') {
    fallas.push(`la versión de la acción no es la adjudicada: ${JSON.stringify(paso.claves['uses'])}`);
  }
  /**
   * 🔴 P85 · LA IGUALDAD EXACTA ES LA GUARDA, y se afirma acá — no en el test.
   *
   * El caso adversarial de P83 plantaba `ref` y afirmaba que el `with` **no** era
   * igual al canónico. Eso es la PRECONDICIÓN del rechazo, no el rechazo: con la
   * guarda debilitada a «`with` presente» el caso seguía verde. Ahora la
   * desigualdad la evalúa esta función, que es la misma que corre el nominal.
   */
  if (!mismoMapping(paso.claves['with'], {
    'fetch-depth': 0,
    'persist-credentials': false,
  })) {
    fallas.push(
      'el `with` del checkout no es el exacto: `ref`/`repository`/`path` desacoplan el ' +
        'workspace del evento, y `persist-credentials` distinto de false deja credenciales ' +
        `Git disponibles para pasos posteriores — ${JSON.stringify(paso.claves['with'])}`,
    );
  }
  fallas.push(
    ...fallasDeContexto(yml, job, paso.claves, `${job}.steps[${paso.indice}]`, 'el checkout', 'checkout'),
  );
  return fallas;
}

type MapaDesconocido = { readonly [clave: string]: unknown };

const esMapaDesconocido = (valor: unknown): valor is MapaDesconocido =>
  typeof valor === 'object' && valor !== null && !Array.isArray(valor);

interface ReferenciaSecreto {
  readonly ruta: string;
  readonly referencia: string;
}

/**
 * Censa `secrets.*` sobre el YAML PARSEADO, no por grep del archivo.
 *
 * La frontera es deliberadamente angosta: dos referencias, como valores
 * completos de `env`, en el único paso que invoca al publicador. Una referencia
 * en `run`, otro paso, otro job o una clave extra es roja aunque conserve las
 * dos referencias legítimas en algún rincón del documento.
 */
function referenciasDeSecretos(valor: unknown, ruta = '$'): ReferenciaSecreto[] {
  if (typeof valor === 'string') {
    return [...valor.matchAll(/\$\{\{[\s\S]*?\}\}/g)]
      .filter((m) => /\bsecrets\b/.test(m[0]))
      .map((m) => ({ ruta, referencia: m[0] }));
  }
  if (Array.isArray(valor)) {
    return valor.flatMap((item, indice) => referenciasDeSecretos(item, `${ruta}[${indice}]`));
  }
  if (esMapaDesconocido(valor)) {
    return Object.entries(valor)
      .flatMap(([clave, item]) => referenciasDeSecretos(item, `${ruta}.${clave}`));
  }
  return [];
}

/** Permisos mínimos + custodia exclusiva de los dos secretos del publicador. */
function fallasDeMinimoPrivilegio(yml: string): string[] {
  let doc: unknown;
  try {
    doc = load(yml);
  } catch (error) {
    return [`el YAML no parsea: ${(error as Error).message}`];
  }
  if (!esMapaDesconocido(doc)) return ['la raíz del workflow no es un mapping'];

  const fallas: string[] = [];
  if (!mismoMapping(doc['permissions'], { contents: 'read' })) {
    fallas.push(
      '`permissions` debe ser exactamente `{ contents: read }`: cualquier ausencia o permiso extra amplía el token',
    );
  }

  const jobsCrudos = doc['jobs'];
  if (!esMapaDesconocido(jobsCrudos)) {
    fallas.push('`jobs` no es un mapping adjudicable');
  } else {
    for (const [nombre, job] of Object.entries(jobsCrudos)) {
      if (esMapaDesconocido(job) && job['permissions'] !== undefined) {
        fallas.push(
          `jobs.${nombre}.permissions no está permitido: un override de job reemplaza el mínimo global`,
        );
      }
    }
  }

  const { jobs, problemas } = leerWorkflow(yml);
  if (problemas.length > 0) {
    fallas.push(...problemas.map((p) => `el modelo no pudo adjudicar: ${p}`));
    return fallas;
  }
  const publicadores = jobs.flatMap((job) => job.pasos
    .filter((paso) => pasoPublica(texto(paso.claves['run'])))
    .map((paso) => ({ job, paso })));
  if (publicadores.length !== 1) {
    fallas.push(`hay ${publicadores.length} publicadores; se esperaba exactamente uno`);
    return fallas;
  }
  const [{ job, paso }] = publicadores;
  const prefijo = `$.jobs.${job.nombre}.steps[${paso.indice}].env`;
  const esperadas = [
    `${prefijo}.HOOK_APP|\${{ secrets.VERCEL_HOOK_APP }}`,
    `${prefijo}.HOOK_LANDING|\${{ secrets.VERCEL_HOOK_LANDING }}`,
  ].sort();
  const halladas = referenciasDeSecretos(doc)
    .map(({ ruta, referencia }) => `${ruta}|${referencia}`)
    .sort();
  if (JSON.stringify(halladas) !== JSON.stringify(esperadas)) {
    fallas.push(
      'las referencias `secrets.*` no están exclusivamente en el `env` correspondiente del publicador: ' +
        JSON.stringify(halladas),
    );
  }
  return fallas;
}

describe('hardening mínimo del token y los secretos de CI', () => {
  const ci = () => readFileSync(join(RAIZ, '.github', 'workflows', 'ci.yml'), 'utf8');

  const conMutacion = (de: string, a: string): string => {
    const original = ci();
    expect(original.includes(de), `la mutación no se plantó: falta «${de}»`).toBe(true);
    return original.replace(de, a);
  };

  it('🔴 nominal · permisos, checkout y referencias de secretos son mínimos', () => {
    expect(fallasDeMinimoPrivilegio(ci())).toEqual([]);
    expect(fallasDelCheckout(ci())).toEqual([]);
    expect(fallasDelPublicador(ci())).toEqual([]);
  });

  it('🔴 MUTANTE · permiso de escritura en raíz muere', () => {
    const mutado = conMutacion('permissions:\n  contents: read', 'permissions:\n  contents: write');
    expect(fallasDeMinimoPrivilegio(mutado).join(' · ')).toMatch(/permissions/);
  });

  it('🔴 MUTANTE · un override de permisos en el job muere', () => {
    const mutado = conMutacion(
      '  build:\n    runs-on: ubuntu-latest',
      '  build:\n    permissions:\n      contents: write\n    runs-on: ubuntu-latest',
    );
    expect(fallasDeMinimoPrivilegio(mutado).join(' · ')).toMatch(/override|permissions/);
  });

  it('🔴 MUTANTE · credenciales persistidas o valor ausente mueren', () => {
    const verdadero = conMutacion('          persist-credentials: false', '          persist-credentials: true');
    const ausente = conMutacion('          persist-credentials: false\n', '');
    expect(fallasDelCheckout(verdadero).join(' · ')).toMatch(/persist-credentials|with/);
    expect(fallasDelCheckout(ausente).join(' · ')).toMatch(/persist-credentials|with/);
  });

  it('🔴 MUTANTE · el publicador sin `push/main` canónico muere', () => {
    const mutado = conMutacion(
      `        if: ${CONDICION_CANONICA}`,
      '        if: success()',
    );
    expect(fallasDelPublicador(mutado).join(' · ')).toMatch(/condición no es la canónica/);
  });

  it('🔴 MUTANTE · una copia de `secrets.*` fuera del publicador muere', () => {
    const mutado = conMutacion(
      '      - run: npm ci',
      '      - run: npm ci\n        env:\n          COLADO: ${{ secrets.VERCEL_HOOK_APP }}',
    );
    expect(fallasDeMinimoPrivilegio(mutado).join(' · ')).toMatch(/exclusivamente/);
  });

  it('🔴 MUTANTE · la sintaxis indexada de `secrets` también entra al censo', () => {
    const mutado = conMutacion(
      '      - run: npm ci',
      "      - run: npm ci\n        env:\n          COLADO: ${{ secrets['VERCEL_HOOK_APP'] }}",
    );
    expect(fallasDeMinimoPrivilegio(mutado).join(' · ')).toMatch(/exclusivamente/);
  });

  it('🔴 MUTANTE · serializar el contexto `secrets` completo también muere', () => {
    const mutado = conMutacion(
      '      - run: npm ci',
      '      - run: npm ci\n        env:\n          COLADO: ${{ toJSON(secrets) }}',
    );
    expect(fallasDeMinimoPrivilegio(mutado).join(' · ')).toMatch(/exclusivamente/);
  });
});

/** Todo paso que precede al publicador: rol declarado, sin `if:` y contexto gobernado. */
function fallasDeGatesPrevios(yml: string): string[] {
  const { jobs, problemas } = leerWorkflow(yml);
  if (problemas.length > 0) return problemas.map((p) => `el modelo no pudo adjudicar: ${p}`);

  const todos = jobs.flatMap((j) => [...j.pasos]);
  const publicadores = todos.filter((p) => pasoPublica(texto(p.claves['run'])));
  if (publicadores.length === 0) return ['no se encontró el paso de publicación'];
  /**
   * 🔴 P85 · LOS GATES SE EXIGEN POR PUBLICADOR, NO SOBRE LA UNIÓN.
   *
   * Acá había un `flatMap` que juntaba los previos de todos los publicadores y
   * después verificaba los roles sobre ese conjunto. **La unión tapaba al
   * individuo**: un publicador en un job suelto —sin `needs`, corriendo en
   * paralelo— tiene CERO gates garantizados antes, y los gates del publicador
   * legítimo completaban la lista por él. Lo destapó el caso ② al atravesar la
   * política real en vez de afirmar sobre el helper.
   *
   * Es la misma clase que el dictamen vino a señalar, una capa más abajo: un
   * agregado que se lee como cobertura individual.
   */
  const fallasPorPublicador: string[] = [];
  const previos = publicadores.flatMap((pub) => pasosGarantizadosAntesDe(jobs, pub));
  for (const pub of publicadores) {
    const suyos = new Set(pasosGarantizadosAntesDe(jobs, pub).map((p) => rolDePaso(p.claves)));
    for (const g of ['espejo', 'test', 'typecheck', 'build', 'playwright', 'scanner', 'aliases', 'invalidar-corrida', 'corrida', 'invalidar-build', 'artefacto'] as const) {
      if (!suyos.has(g)) {
        fallasPorPublicador.push(
          `${pub.job}.steps[${pub.indice}]: publica sin el gate «${g}» garantizado antes`,
        );
      }
    }
  }

  /**
   * 🔴 P81 · LA POBLACIÓN ES **TODO** LO QUE PRECEDE AL PUBLICADOR, con rol.
   *
   * Antes acá había una lista de cinco gates y **el resto de los pasos no pasaba
   * por ninguna política**. El auditor de secretos quedaba fuera: su
   * `env.BASH_ENV` lo volvía no-op y la suite seguía verde con el scanner
   * terminando 0 sin ejecutarse. Ahora **cada paso previo tiene que tener un rol
   * declarado** —incluidos setup, instalación y reporter— y todos pasan por el
   * mismo contexto. Un paso sin rol es rojo: así un paso NUEVO no entra callado.
   */
  const fallas: string[] = [...fallasPorPublicador];
  for (const p of previos) {
    const donde = `${p.job}.steps[${p.indice}]`;
    const rolP = rolDePaso(p.claves);
    if (rolP === null) {
      fallas.push(`${donde}: paso SIN ROL declarado — no se puede adjudicar su contexto`);
      continue;
    }
    const condicion = p.claves['if'];
    if (condicion !== undefined && !ROLES_QUE_NO_BLOQUEAN.has(rolP)) {
      fallas.push(
        `${donde}: el paso «${rolP}» BLOQUEA y lleva \`if: ${JSON.stringify(condicion)}\` — puede no ejecutarse`,
      );
    }
    /**
     * 🔴 P77 · EL GATE PASA POR EL MISMO CONTEXTO QUE EL PUBLICADOR. Antes acá
     * sólo se miraba `if` y `continue-on-error`, y este último por `texto()`, que
     * aceptaba la cadena `'false'`. **Un gate con otro `working-directory` o con
     * `shell: bash -c 'true # {0}'` terminaba 0 sin ejecutar nada** y el arnés lo
     * contaba como gate cumplido. Es la misma llamada que hace el publicador —
     * una definición, dos poblaciones.
     */
    fallas.push(...fallasDeContexto(yml, p.job, p.claves, donde, `el paso «${rolP}»`, rolP));
  }

  /**
   * Controles positivos, adentro: si ningún paso matcheara, el bucle mediría
   * sobre una población vacía o incompleta y devolvería `[]` como si todo
   * estuviera bien.
   */
  const rolesVistos = new Set(previos.map((p) => rolDePaso(p.claves)));
  for (const g of ['espejo', 'test', 'typecheck', 'build', 'playwright', 'scanner', 'aliases', 'invalidar-corrida', 'corrida', 'invalidar-build', 'artefacto'] as const) {
    if (!rolesVistos.has(g)) fallas.push(`el gate «${g}» no está entre los pasos previos`);
  }
  return fallas;
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

/**
 * 🔴 P77 · EL ORÁCULO QUE MATA LA RECAÍDA, POR SÍ SOLO.
 *
 * `esInvocacionPublicador` existe desde la vuelta pasada, pero **nada la
 * probaba directamente**: se la ejercitaba de refilón a través del `ci.yml`
 * real, que sólo contiene la forma canónica de un espacio. Codex lo mostró de la
 * peor manera posible: revirtiendo el helper al regex sensible al espacio, la
 * focal quedó **63/63** — o sea que la corrección central de la vuelta 7 no
 * tenía ningún testigo propio.
 *
 * Es la misma lección que ya me costó el parser (`yamlWorkflow.test.ts`): **un
 * reconocedor probado sólo contra la entrada que ya funciona no tiene cómo
 * fallar en el test y sí en la realidad.**
 *
 * Estos casos no dependen del workflow: si alguien vuelve a un patrón que exija
 * un espacio exacto, esto se pone rojo solo.
 */
describe('🔴 el reconocedor del publicador no depende del whitespace', () => {
  const EQUIVALENTES = [
    ['un espacio (canónico)', 'bash scripts/publicar-vercel.sh app "$HOOK_APP"'],
    ['dos espacios', 'bash  scripts/publicar-vercel.sh app "$HOOK_APP"'],
    ['tres espacios', 'bash   scripts/publicar-vercel.sh landing "$HOOK_LANDING"'],
    ['tabulador', 'bash\tscripts/publicar-vercel.sh app "$HOOK_APP"'],
    ['espacios mezclados', 'bash \t scripts/publicar-vercel.sh app "$HOOK_APP"'],
  ] as const;

  for (const [nombre, cmd] of EQUIVALENTES) {
    it(`⭐ lo reconoce con ${nombre}`, () => {
      expect(
        esInvocacionPublicador(cmd),
        'un separador distinto lo volvió invisible: volvió el regex spacing-sensitive',
      ).toBe(true);
    });
  }

  /**
   * Control NEGATIVO: reconocer de más es tan malo como reconocer de menos —
   * marcaría como publicador algo que no lo es y el gate pediría condiciones a
   * un paso cualquiera.
   */
  const AJENOS = [
    ['otro script', 'bash scripts/auditar-secretos.sh'],
    ['sufijo parecido', 'bash scripts/publicar-vercel.sh-alternativo app'],
    ['otro intérprete', 'sh scripts/publicar-vercel.sh app'],
    ['ruta distinta', 'bash otro/scripts/publicar-vercel.sh app'],
  ] as const;

  for (const [nombre, cmd] of AJENOS) {
    it(`⭐ NO lo confunde con ${nombre}`, () => {
      expect(esInvocacionPublicador(cmd), 'reconoció de más').toBe(false);
    });
  }
});

describe('el camino de publicación · leído de los PASOS, no del texto', () => {
  const DIR = join(RAIZ, '.github', 'workflows');

  it('🔴 el conjunto de workflows es EXACTAMENTE el adjudicado', () => {
    const archivos = readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f)).sort();
    expect(
      archivos,
      'apareció o desapareció un workflow. Cualquiera que no esté adjudicado es rojo hasta ' +
        'adjudicarlo: hay que decidir si publica, si se gatea o si se retira.',
    ).toEqual(['ci.yml', 'release-prebuilt-stage.yml']);
  });

  /**
   * 🔴 P53-03 · **cada PASO adjudicado, uno por uno.** Exigir que el archivo sea
   * `ci.yml` no dice nada de lo que hay adentro: un `- run: npx vercel --prod`
   * metido antes de los gates dejaba la suite 20/20. Ahora **todo paso que no
   * esté en esta lista es rojo** — y la lista es de lo ADJUDICADO, no de lo
   * prohibido: un mecanismo nuevo no tiene forma de colarse por no parecerse a
   * nada conocido.
   */
  /**
   * 🔴 P79 · EL CHECKOUT SE ADJUDICA ENTERO, `with` INCLUIDO.
   *
   * El censo aceptaba el string `actions/checkout@v4` y **no miraba su `with`**.
   * Codex agregó `ref: <un ancestro>` y quedó 72/72: ese input fija en el
   * workspace **bytes VIEJOS**, los cinco gates miden esos bytes, y el paso
   * final sólo llama dos hooks sin transmitir ningún SHA.
   *
   * 🔴 **El resultado es que se pierde la IDENTIDAD entre lo verificado y lo que
   * se publica** — la suite da verde sobre un árbol y el push publica otro. Es
   * el agujero más grande de las nueve vueltas, porque no rompe una guarda: las
   * deja a todas midiendo el objeto equivocado.
   *
   * Se fija el `with` EXACTO. `ref`, `repository` y `path` desacoplan el
   * workspace del evento; `fetch-depth: 0` es necesario y está explicado en el
   * propio workflow (el scanner compara contra la base del push/PR).
   */
  it('🔴 UN checkout causal, con su `with` EXACTO', () => {
    // 🔴 P85 · la igualdad exacta vive en `fallasDelCheckout`, no acá: el caso
    // adversarial planta `ref` y corre ESTA misma función. Debilitar la guarda a
    // «`with` presente» pone rojos los dos.
    const fallas = fallasDelCheckout(readFileSync(join(DIR, 'ci.yml'), 'utf8'));
    expect(fallas, `el checkout no es el adjudicado:\n  ${fallas.join('\n  ')}`).toEqual([]);
  });

  it('🔴 TODO JOB y TODO paso del workflow están adjudicados', () => {
    // 🔴 P85 · el censo es `fallasDelCenso`. El caso adversarial ① —un reusable
    // job ajeno— corre ESTA función en vez de reconstruir la adjudicación a mano,
    // así que retirar la guarda de `uses` de job pone rojos los dos.
    const fallas = fallasDelCenso(readFileSync(join(DIR, 'ci.yml'), 'utf8'));
    expect(
      fallas,
      'pasos o jobs SIN adjudicar en el único camino de publicación — decidí qué son antes de dejarlos:\n  ' +
        fallas.join('\n  '),
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
      pasoPublica(texto(p.claves['run'])),
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
    // 🔴 P85 · el recorrido y sus controles positivos viven en
    // `fallasDeGatesPrevios`. El caso del scanner corre ESTA función sobre el
    // workflow mutado, así que omitir su llamada a `fallasDeContexto` —el mutante
    // P2-01— pone rojo el adversarial además del nominal.
    const fallas = fallasDeGatesPrevios(readFileSync(join(DIR, 'ci.yml'), 'utf8'));
    expect(fallas, `gates que están escritos pero no gatean:\n  ${fallas.join('\n  ')}`).toEqual([]);
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

    // 🔴 P85 · Y EL CENSO REAL lo tiene que denunciar. Antes acá se reconstruía
    // la adjudicación a mano —un oráculo sombra: probaba que ESTE test sabe
    // filtrar, no que el censo lo rechace—. Ahora corre `fallasDelCenso`, la
    // misma función que corre sobre el `ci.yml` sin mutar.
    expect(
      fallasDelCenso(conReusable).join(' · '),
      'un job que llama a un workflow ajeno pasó sin adjudicación',
    ).toMatch(/workflow ajeno/);
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

    // 🔴 P85 · y la consecuencia, por la POLÍTICA y no por el modelo: sin gates
    // garantizados antes, la compuerta de gates previos no puede certificarse.
    // Antes esto terminaba en la línea de arriba —una propiedad del helper— y
    // dejaba sin acreditar que alguna política actúe sobre ella.
    expect(
      fallasDeGatesPrevios(conSuelto).length,
      'un publicador sin ningún gate garantizado antes no fue denunciado por la política',
    ).toBeGreaterThan(0);
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
/**
 * 🔴 P88 · LA DEUDA DEL P85, CERRADA COMO GUARDA VIVA.
 *
 * El P85 cerró que cada política sea una función única y que los casos
 * adversariales la atraviesen. Al declararlo quedó dicho —por mí, en el paquete—
 * que **nada en el repo impedía que mañana apareciera un `it` llamando al helper
 * directo**, y que hasta entonces la propiedad la sostenía la medición a mano de
 * dos sesiones.
 *
 * 🔴 **Una propiedad sostenida por la memoria de dos sesiones no es una
 * propiedad.** Si alguien escribe un caso nuevo con el patrón viejo —llamar a
 * `fallasDeContexto` directo, que es lo más natural de tipear— el arnés vuelve
 * al estado exacto del P83 y **la suite no lo denuncia**.
 *
 * Esto lo convierte en test. Es la misma forma que la guarda de `js-yaml`: el
 * límite VERIFICADO en vez de prometido.
 */
/**
 * 🔴 P94 · EL ORDEN DEL PIPELINE ES PARTE DE LA GARANTÍA.
 *
 * `--invalidar X` sólo acredita si corre ANTES de la herramienta, y el validador
 * sólo acredita si corre DESPUÉS. Con los pasos en otro orden cada gate sigue
 * existiendo y **no garantiza nada**: se borraría lo que la herramienta acaba de
 * escribir, o se validaría lo que quedó de la corrida anterior.
 *
 * Ese orden no lo fijaba nada — vivía en el archivo y en la buena memoria de
 * quien lo editara. Acá pasa a ser afirmación verificada.
 */
describe('🔴 invalidar → herramienta → validar, en ese orden', () => {
  const TRIOS = [
    ['la suite', 'invalidar-corrida', 'test', 'corrida'],
    ['el build', 'invalidar-build', 'build', 'artefacto'],
  ] as const;

  for (const [que, antes, herramienta, despues] of TRIOS) {
    it(`🔴 ${que}: se invalida ANTES y se valida DESPUÉS`, () => {
      const yml = readFileSync(join(RAIZ, '.github', 'workflows', 'ci.yml'), 'utf8');
      const { jobs, problemas } = leerWorkflow(yml);
      expect(problemas).toEqual([]);
      /**
       * 🔴 P96 · EL CLAIM SE ACOTA AL JOB ÚNICO, y se declara por qué.
       *
       * Comparar índices de pasos **aplanados de varios jobs** no dice nada del
       * orden real: jobs distintos corren en paralelo salvo que haya `needs`, y
       * un índice menor en otro job no significa «antes». Hoy el workflow tiene
       * UN job, así que el índice sí es el orden — pero eso es una propiedad del
       * target, no del método, y por eso se **afirma** en vez de suponerse.
       *
       * El día que aparezca un segundo job, este caso se pone rojo y hay que
       * venir a decidir cómo se evalúa el orden entre jobs. Es la fricción
       * correcta: la alternativa es un claim universal que se cumple por
       * casualidad.
       */
      expect(jobs.length, 'hay más de un job: el orden por índice ya no es el orden real')
        .toBe(1);
      const pasos = [...jobs[0]!.pasos];
      const idx = (rol: string) => pasos.findIndex((p) => rolDePaso(p.claves) === rol);
      const [i, j, k] = [idx(antes), idx(herramienta), idx(despues)];
      // Control positivo: los tres tienen que EXISTIR, o el orden se cumpliría
      // en vacío con -1 < -1 siendo falso por accidente.
      expect([i, j, k].every((n) => n >= 0), `falta alguno de los tres pasos de ${que}`).toBe(true);
      expect(i, `la invalidación de ${que} no precede a su herramienta`).toBeLessThan(j);
      expect(j, `el validador de ${que} no sucede a su herramienta`).toBeLessThan(k);
    });
  }
});

describe('🔴 el helper de contexto vive SÓLO dentro de las políticas', () => {
  /**
   * Allowlist positiva: las funciones que PUEDEN consumirlo. Una función nueva
   * que lo necesite tiene que venir a declararse acá, y ahí se decide si de
   * verdad es una política o es un atajo desde un test.
   */
  const POLITICAS = [
    'fallasDelPublicador',
    'fallasDelCenso',
    'fallasDelCheckout',
    'fallasDeGatesPrevios',
  ] as const;

  it('🔴 ninguna llamada a `fallasDeContexto` fuera de las cuatro políticas', () => {
    const lineas = readFileSync(join(AQUI, 'despliegue.test.ts'), 'utf8').split('\n');
    let dentroDe: string | null = null;
    const intrusas: string[] = [];
    let dentroDeAlguna = 0;

    lineas.forEach((linea, i) => {
      const abre = /^function ([A-Za-z0-9_]+)\(/.exec(linea);
      if (abre) { dentroDe = abre[1]!; return; }
      // Toda función de módulo se cierra con una llave en la columna 0.
      if (dentroDe !== null && linea === '}') { dentroDe = null; return; }
      // La definición del helper no es una llamada.
      if (/^const fallasDeContexto/.test(linea)) return;
      if (!/fallasDeContexto\(/.test(linea)) return;
      if (dentroDe !== null && (POLITICAS as readonly string[]).includes(dentroDe)) {
        dentroDeAlguna++;
      } else {
        intrusas.push(`${i + 1}: ${linea.trim().slice(0, 70)} — en «${dentroDe ?? 'ninguna función'}»`);
      }
    });

    // 🔴 Control positivo: si el reconocedor de funciones se rompiera, no vería
    // NINGUNA llamada y el `toEqual([])` de abajo pasaría en vacío, certificando
    // exactamente lo contrario de lo que dice.
    expect(dentroDeAlguna, 'no se vio ninguna llamada legítima: el barrido midió en vacío')
      .toBeGreaterThanOrEqual(POLITICAS.length - 1);
    expect(
      intrusas,
      'un test que llama al helper por su cuenta NO acredita que la política lo use — ' +
        `es la recaída del P83:\n  ${intrusas.join('\n  ')}`,
    ).toEqual([]);
  });
});

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

/**
 * 🔴 P83 · LAS DOS FORMAS DEL P81, COMO REGRESIONES PERMANENTES.
 *
 * En la vuelta pasada corrí estas dos sondas, reporté sus conteos y **no dejé
 * ni un `it()` versionado**. El delta P81→P83 tiene **cero declaraciones de test
 * nuevas** —medido: 36 invocaciones `it(` antes y después— y las formas
 * adversariales viven en comentarios y en el CHANGELOG.
 *
 * 📌 **Una sonda corrida una vez prueba el PRESENTE; un `it()` versionado
 * protege el FUTURO.** Los replays demuestran que hoy funciona; no dejan nada
 * que caiga si mañana alguien desconecta `jobCrudo(...).container` o deja de
 * aplicarle `fallasDeContexto` al scanner. Eso era, textual, la condición 3 del
 * P81, y la leí como «verificá» cuando decía «versioná».
 *
 * ## Por qué cada caso tiene DOS mitades
 *
 * Un test que sólo afirme «el arnés rechaza esta forma» prueba media cosa:
 * podría estar rechazando algo inofensivo. La condición 3 pide separar **«el
 * YAML contiene el comando»** de **«la herramienta se ejecutó»**, así que cada
 * forma va con:
 *
 *   (a) el arnés la RECHAZA — sobre el workflow real, en memoria;
 *   (b) un CONTROL EJECUTABLE de que esa forma **de verdad neutraliza** la
 *       herramienta: la misma invocación deja marca sin la variable y no la deja
 *       con ella.
 *
 * Sin (b), (a) es una regla sin fundamento. Sin (a), (b) es una curiosidad.
 */
describe('🔴 P83 · las formas del P81, versionadas y con control ejecutable', () => {
  const ciReal = () => readFileSync(join(RAIZ, '.github', 'workflows', 'ci.yml'), 'utf8');

  /** El YAML real con una mutación textual mínima, verificando que se plantó. */
  const conMutacion = (de: string, a: string): string => {
    const yml = ciReal();
    expect(yml.includes(de), `la mutación no se plantó: no está «${de}»`).toBe(true);
    return yml.replace(de, a);
  };

  /**
   * 🔴 P85 · CADA CASO ATRAVIESA LA POLÍTICA REAL, NO EL HELPER.
   *
   * Hasta P83 estos casos llamaban `fallasDeContexto` por su cuenta. Codex midió
   * que retirar el callsite verdadero —el del bucle de gates, el del publicador,
   * la guarda de `strategy`, la igualdad del checkout— dejaba todo verde: yo
   * acreditaba que el helper reconoce la forma, **no que la política lo use**.
   *
   * Ahora cada caso corre `fallasDeGatesPrevios` / `fallasDelPublicador` /
   * `fallasDelCheckout` — las mismas funciones que corren los `it()` nominales
   * sobre el `ci.yml` sin mutar. **Desconectar el seam pone rojos a los dos.**
   *
   * Los SEIS casos son la clase entera, no los cuatro que el dictamen nombró:
   * `container` y el reusable ① compartían el defecto y se convierten con los
   * otros. (Decía «cinco» y enumeraba seis — corregido en el P96.)
   */
  it('🔴 `container.env` del job → RECHAZADO por la política de gates', () => {
    const mutado = conMutacion(
      '  build:\n    runs-on: ubuntu-latest',
      '  build:\n    container:\n      image: node:20\n      env:\n' +
        '        npm_config_script_shell: /usr/bin/true\n    runs-on: ubuntu-latest',
    );
    expect(
      fallasDeGatesPrevios(mutado).join(' · '),
      'el arnés no rechazó `container`: su env llega a TODOS los pasos',
    ).toMatch(/container/);
  });

  it('🔴 `step.env.BASH_ENV` en el SCANNER → RECHAZADO por la política de gates', () => {
    const mutado = conMutacion(
      '        run: bash scripts/auditar-secretos.sh',
      '        env:\n          BASH_ENV: .noop.sh\n        run: bash scripts/auditar-secretos.sh',
    );
    // 🔴 Atraviesa el consumidor integrado: si el bucle dejara de llamar a
    // `fallasDeContexto` para el rol scanner, esto queda rojo.
    expect(
      fallasDeGatesPrevios(mutado).join(' · '),
      'el arnés no rechazó el env del scanner: su rol no exige mapping vacío',
    ).toMatch(/env/);
  });

  /**
   * 🔴 LA CLASE ENTERA, no sólo las que el dictamen nombró.
   *
   * Censé el archivo buscando qué formas adversariales de la jornada vivían
   * **sólo en replays ad-hoc** —corridas a mano, reportadas en un paquete, sin
   * `it()` que las plante—. Aparecieron seis.
   *
   * No entran acá `NODE_OPTIONS` ni ninguna otra variable de entorno, **y eso es
   * a propósito**: la allowlist positiva las cubre por construcción, sin
   * nombrarlas. Un mutante por cada nombre sería volver a la denylist que costó
   * ocho vueltas abandonar.
   */
  const FORMAS: ReadonlyArray<readonly [string, string, string, RegExp]> = [
    [
      'strategy en el job del publicador',
      '  build:\n    runs-on: ubuntu-latest',
      '  build:\n    strategy:\n      matrix:\n        replica: [1, 2]\n    runs-on: ubuntu-latest',
      /strategy/,
    ],
    [
      'working-directory en el publicador',
      '        run: |\n          bash scripts/publicar-vercel.sh app',
      '        working-directory: landing\n        run: |\n          bash scripts/publicar-vercel.sh app',
      /working-directory/,
    ],
    [
      'shell propio en el publicador',
      '        run: |\n          bash scripts/publicar-vercel.sh app',
      '        shell: bash {0}\n        run: |\n          bash scripts/publicar-vercel.sh app',
      /shell/,
    ],
    [
      'continue-on-error verdadero en el publicador',
      '      - name: Publicar en Vercel (sólo con TODO en verde)',
      '      - name: Publicar en Vercel (sólo con TODO en verde)\n        continue-on-error: true',
      /continue-on-error/,
    ],
    [
      'swap de secretos, con ambas referencias presentes',
      '          HOOK_APP: ${{ secrets.VERCEL_HOOK_APP }}',
      '          HOOK_APP: ${{ secrets.VERCEL_HOOK_LANDING }}\n' +
        '          UNUSED_HOOK_APP: ${{ secrets.VERCEL_HOOK_APP }}',
      /env/,
    ],
  ];

  for (const [nombre, de, a, esperado] of FORMAS) {
    it(`🔴 ${nombre} → RECHAZADO por la política del publicador`, () => {
      // 🔴 `strategy` incluida: la adjudica `fallasDelPublicador`, no un oráculo
      // sombra escrito en el test. Retirar esa guarda pone rojo este caso.
      expect(
        fallasDelPublicador(conMutacion(de, a)).join(' · '),
        `el arnés no rechazó «${nombre}»`,
      ).toMatch(esperado);
    });
  }

  /**
   * 🔴 P85 · LOS CONTROLES POSITIVOS DE LAS POLÍTICAS, VERSIONADOS.
   *
   * Cada política lleva adentro su control de «no medir en vacío» —sin
   * publicador, sin checkout, sin pasos, devuelve falla en vez de `[]`—. Vivían
   * sólo en el cuerpo de la función: **si alguien los retirara, la política
   * devolvería `[]` sobre un workflow vacío y todo quedaría verde.**
   *
   * Un `[]` puede significar «no encontré nada malo» o «no miré nada», y son
   * cosas distintas. Esto fija cuál de las dos es.
   */
  it('🔴 ninguna política devuelve `[]` sobre un workflow VACÍO', () => {
    const vacio = 'name: CI\non: push\njobs: {}\n';
    expect(fallasDelPublicador(vacio), 'el publicador midió en vacío').not.toEqual([]);
    expect(fallasDelCheckout(vacio), 'el checkout midió en vacío').not.toEqual([]);
    expect(fallasDeGatesPrevios(vacio), 'los gates midieron en vacío').not.toEqual([]);
    expect(fallasDelCenso(vacio), 'el censo midió en vacío').not.toEqual([]);
  });

  it('🔴 el checkout con `ref` a un ancestro → RECHAZADO por la igualdad exacta', () => {
    const mutado = conMutacion(
      '          fetch-depth: 0',
      '          ref: 7d5b92088416eff648f87c6901c75ad77fe331ec\n          fetch-depth: 0',
    );
    // 🔴 Antes esto afirmaba que el `with` NO era igual al canónico — la
    // PRECONDICIÓN del rechazo, no el rechazo. Ahora corre la guarda real:
    // debilitarla a «`with` presente» deja este caso rojo.
    expect(
      fallasDelCheckout(mutado).join(' · '),
      '`ref` desacopla el workspace de lo que se publica y el arnés no lo rechazó',
    ).toMatch(/with|exacto/);
  });

  /**
   * (b) EL CONTROL EJECUTABLE de `npm_config_script_shell`.
   *
   * Demuestra la premisa del hallazgo, no la regla: con esa variable el script
   * de npm **no corre**. Se mide por MARCA en disco, no por exit code — un
   * `exit 0` es justamente lo que el mecanismo produce, así que usarlo como
   * oráculo sería medir con el instrumento que el ataque manipula.
   */
  it('🔴 (b) CONTROL · `npm_config_script_shell` impide que el script corra', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'payme-scriptshell-'));
    try {
      const marca = join(dir, 'CORRIO');
      writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify({
          name: 'sonda',
          version: '1.0.0',
          scripts: { marca: `node -e "require('fs').writeFileSync('CORRIO','1')"` },
        }),
      );
      const correr = (env: NodeJS.ProcessEnv): Promise<number> =>
        new Promise((ok) => {
          execFile('npm', ['run', 'marca', '--silent'], { cwd: dir, env }, (err) =>
            ok(err && typeof err.code === 'number' ? err.code : err ? -1 : 0),
          );
        });

      // Control POSITIVO: sin la variable, el script deja su marca.
      await correr({ ...process.env, npm_config_script_shell: undefined });
      expect(existsSync(marca), 'el escenario no funciona: el script no corrió ni sin la variable')
        .toBe(true);
      rmSync(marca, { force: true });

      // Con la variable: npm termina 0 y el script NO deja marca.
      const code = await correr({ ...process.env, npm_config_script_shell: '/usr/bin/true' });
      expect(code, 'el mecanismo no produjo el exit 0 que lo hace peligroso').toBe(0);
      expect(
        existsSync(marca),
        'la variable NO neutralizó el script: la premisa del hallazgo no se sostiene acá',
      ).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);

  /**
   * (b) EL CONTROL EJECUTABLE de `BASH_ENV`.
   *
   * `--noprofile --norc` NO lo neutraliza en un Bash no interactivo: el prelude
   * corre antes y puede redefinir la herramienta. Igual que arriba, se mide por
   * marca y no por exit code.
   */
  it('🔴 (b) CONTROL · `BASH_ENV` intercepta la herramienta antes del cuerpo', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'payme-bashenv-'));
    try {
      const marca = join(dir, 'CORRIO');
      // 🔴 SIN extensión: el cuerpo la invoca como `herramienta` y bash la busca
      // por ese nombre exacto en el PATH. Con `herramienta.sh` el control
      // positivo falló —la herramienta no corría ni sin BASH_ENV— y sin ese
      // control habría leído «no dejó marca» como éxito del mecanismo.
      const herramienta = join(dir, 'herramienta');
      writeFileSync(herramienta, `#!/usr/bin/env bash\ntouch ${JSON.stringify(marca)}\n`, {
        mode: 0o755,
      });
      // El prelude redefine la herramienta como una función que no hace nada.
      const prelude = join(dir, 'prelude.sh');
      writeFileSync(prelude, `herramienta() { return 0; }\n`);
      const cuerpo = join(dir, 'cuerpo.sh');
      writeFileSync(cuerpo, `herramienta\n`);

      const correr = (env: NodeJS.ProcessEnv): Promise<number> =>
        new Promise((ok) => {
          execFile(
            'bash',
            ['--noprofile', '--norc', '-eo', 'pipefail', cuerpo],
            { cwd: dir, env: { ...env, PATH: `${dir}:${process.env.PATH ?? ''}` } },
            (err) => ok(err && typeof err.code === 'number' ? err.code : err ? -1 : 0),
          );
        });

      // Control POSITIVO: sin BASH_ENV, la herramienta real corre y deja marca.
      await correr({ ...process.env, BASH_ENV: undefined });
      expect(existsSync(marca), 'el escenario no funciona: la herramienta no corrió ni sin BASH_ENV')
        .toBe(true);
      rmSync(marca, { force: true });

      // Con BASH_ENV: termina 0 y la herramienta NO dejó marca.
      const code = await correr({ ...process.env, BASH_ENV: prelude });
      expect(code, 'el mecanismo no produjo el exit 0 que lo hace peligroso').toBe(0);
      expect(
        existsSync(marca),
        '`--noprofile --norc` habría neutralizado BASH_ENV: la premisa no se sostiene acá',
      ).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
