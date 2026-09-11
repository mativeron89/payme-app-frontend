import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';

import { comandoPublicable, rutaPublicable, urlPublicable } from '../scripts/redactar.mjs';

/**
 * QUÉ ORIGEN RESOLVIÓ EL RUNNER · la mitad de configuración de la evidencia de origen.
 *
 * ## Por qué existe
 *
 * La corrida E2E no dejaba rastro de contra qué corría. El log del reporter `list` no
 * tiene una sola URL, y el reporter `json` tampoco alcanza: su tipo
 * `JSONReport.config.projects[]` enumera `outputDir/repeatEach/retries/metadata/id/
 * name/testDir/testIgnore/testMatch/timeout` y **no incluye `use`**. Así que el
 * `baseURL` nunca podía aparecer en la evidencia, y la afirmación «corre sólo contra el
 * mock loopback» se sostenía leyendo `playwright.config.ts` a mano.
 *
 * `FullProject.use` sí está tipado y el runner se lo pasa a un reporter en `onBegin`,
 * así que acá queda registrado el valor **resuelto en corrida** — el que gana después
 * de los overrides de CLI y entorno, no el literal del archivo.
 *
 * ## 🔴 Lo que este archivo NO acredita, y por qué va separado
 *
 * Esto sigue siendo **configuración**. Que el runner haya resuelto
 * `baseURL=http://localhost:5176` no dice contra qué habló el navegador: un test puede
 * navegar a una URL absoluta, un script de la página puede pedir un tercero, y nada de
 * eso se ve acá. El tráfico REAL lo mide `scripts/extraer-origenes.mjs` sobre la entrada
 * de red del trace, y su resultado vive en otro archivo a propósito. Confundir los dos
 * es exactamente el defecto que este par vino a cerrar: **la configuración no es la
 * medición**, y dos rótulos distintos en dos artefactos distintos es lo que impide
 * volver a leerlos como uno solo.
 *
 * ## 🔴 Nada se persiste en claro
 *
 * Un archivo de evidencia se comparte, se adjunta y se audita, así que no puede arrastrar
 * secretos. Cuatro superficies los traen con facilidad y las cuatro se redactan:
 *
 *   · `baseURL` y `webServer.url` — pueden llevar `user:password@`, path, query o token.
 *     Se guarda SÓLO el origen (esquema + host + puerto) y banderas de qué traían.
 *   · `proxy` — su objeto puede traer `username`/`password`. Se guarda el origen del
 *     servidor y un booleano de si tenía credenciales. Nunca las credenciales.
 *   · `webServer.command` — el token puede estar en un argumento **y también en el primer
 *     token** (`TOKEN=secreto cmd`, o una URI). El ejecutable se publica sólo si su
 *     basename pasa una allowlist estricta; si no, queda `REDACTADO` con su motivo.
 *   · `CI` — se publica un booleano de PRESENCIA. Su valor puede ser cualquier cosa.
 *
 * 🔴 **Y no se hashea ningún valor crudo.** La versión anterior de este archivo guardaba
 * `sha256_del_crudo` «para comparar sin republicar». Un sha256 no se revierte, pero un
 * secreto de baja entropía se recupera probando candidatos contra el hash: publicarlo es
 * publicar un oráculo de verificación del secreto. Lo que se hashea es la ESTRUCTURA ya
 * sanitizada, que sirve igual para comparar corridas y no revela nada del valor.
 *
 * `process.env` no se vuelca por el mismo motivo, y eso está declarado en la salida.
 */

/**
 * 🔴 LA POLÍTICA DE REDACCIÓN YA NO VIVE ACÁ · ítem 6 de la reauditoría del CTO.
 *
 * Este archivo tenía `urlSegura`, `proxySeguro`, `comandoSeguro` y su propia allowlist de
 * ejecutables. `scripts/extraer-origenes.mjs` tenía las suyas, gemelas. **Dos
 * implementaciones de la misma decisión se desalinean calladas**, y en este repo ya pasó en
 * su forma más cara: la regla «no se hashea el valor crudo» quedó escrita acá y **no aplicada
 * en el archivo de al lado** la misma noche, con un test que encima fijaba la violación.
 *
 * Ahora las dos mitades importan `scripts/redactar.mjs`. Si alguien cambia la política,
 * cambia para las dos.
 *
 * Se conservan los nombres locales como alias para no reescribir el resto del archivo ni los
 * tests de integración que ya los nombran.
 */
const urlSegura = urlPublicable;
const comandoSeguro = comandoPublicable;

/** El objeto `proxy` puede traer credenciales: se publica el servidor y un booleano. */
function proxySeguro(proxy: unknown): Record<string, unknown> | 'AUSENTE' {
  if (proxy === undefined || proxy === null || typeof proxy !== 'object') return 'AUSENTE';
  const p = proxy as { server?: unknown; username?: unknown; password?: unknown; bypass?: unknown };
  return {
    servidor: urlSegura(typeof p.server === 'string' ? p.server : undefined),
    tiene_credenciales: p.username !== undefined || p.password !== undefined,
    tiene_bypass: p.bypass !== undefined,
  };
}

/** Lo ausente se dice `UNKNOWN`, nunca se omite: un campo que falta se lee como un cero. */
function oDesconocido<T>(valor: T | undefined): T | 'UNKNOWN' {
  return valor === undefined ? 'UNKNOWN' : valor;
}

/**
 * 🔴 IDENTIDAD EXACTA DEL TEST, y el PATH de su trace.
 *
 * El extractor necesita unir cada `trace.zip` con el test que lo produjo. El slug del
 * directorio no sirve: viene truncado y hasheado, no es reversible, y dos títulos parecidos
 * colisionan. `test.trace` tampoco lo trae: en Playwright 1.62.1 no contiene `titlePath` ni
 * el id — el título vive en `*-trace.trace`, que falta justamente en las trazas Node-only,
 * que son las que hay que identificar.
 *
 * Lo único autoritativo está acá: `onTestEnd` recibe el `TestCase` con su `id`, su
 * `titlePath()` y su `location`, y el `TestResult` con los attachments, incluido el path del
 * trace. El extractor une **por igualdad exacta de ese path**, nunca por substring.
 */
interface TestRegistrado {
  readonly id: string;
  readonly titulo: string;
  readonly title_path: readonly string[];
  readonly spec: string;
  readonly linea: number;
  readonly columna: number;
  readonly proyecto: string;
  readonly estado: string;
  readonly reintentos: number;
  readonly duracion_ms: number;
  readonly trace_path_relativo: string | null;
  readonly adjuntos: readonly string[];
}

export default class ReporterOrigen implements Reporter {
  private inicio = '';
  private destino = '';
  private resuelto: Record<string, unknown> = {};
  private raizDelRepo = '';
  private readonly tests: TestRegistrado[] = [];

  onBegin(config: FullConfig, suite: Suite): void {
    this.inicio = new Date().toISOString();
    /**
     * 🔴 LA RAÍZ DEL REPO NO ES `config.rootDir`.
     *
     * Con `testDir: './e2e'`, Playwright expone `rootDir = <repo>/e2e`. Los traces viven en
     * `<repo>/test-results`, así que relativizar contra `rootDir` dejaba el path ABSOLUTO y
     * el extractor —que compara contra paths relativos al repo— marcaba todas las trazas
     * como SIN_REGISTRO. La unión por identidad de la adenda 11 no unía nada en el caso real.
     *
     * Medido: `rootDir` terminaba en `/e2e` y `configFile` apuntaba a
     * `<repo>/playwright.config.ts`. La raíz canónica es el directorio de la config.
     */
    this.raizDelRepo =
      typeof config.configFile === 'string' && config.configFile !== ''
        ? dirname(config.configFile)
        : config.rootDir;

    const salidaDeclarada = process.env.PAYME_ORIGEN_OUT;
    const outputDir = config.projects[0]?.outputDir ?? join(config.rootDir, 'test-results');
    this.destino = salidaDeclarada && salidaDeclarada !== '' ? salidaDeclarada : join(outputDir, 'origen-config.json');

    const proyectos = config.projects.map((p) => ({
      nombre: p.name,
      // `baseURL_origen` es lo que consume el gate para su control positivo: un origen,
      // nunca la URL completa.
      baseURL_origen: urlSegura(p.use.baseURL).origen,
      baseURL: urlSegura(p.use.baseURL),
      trace: oDesconocido(p.use.trace as unknown as string | undefined),
      proxy: proxySeguro(p.use.proxy),
      ignoreHTTPSErrors: oDesconocido(p.use.ignoreHTTPSErrors),
    }));

    const ws = config.webServer;
    const servidores =
      ws === undefined || ws === null
        ? 'UNKNOWN_NO_EXPUESTO_AL_REPORTER'
        : (Array.isArray(ws) ? ws : [ws]).map((w) => ({
            url: urlSegura(w.url),
            url_origen: urlSegura(w.url).origen,
            port: oDesconocido(w.port),
            comando: comandoSeguro(w.command),
            reuseExistingServer: oDesconocido(w.reuseExistingServer),
          }));

    this.resuelto = {
      // 🔴 Ítem 6: ninguna ruta ABSOLUTA se publica. `configFile`, `rootDir` y la raíz
      // derivada son rutas del disco de alguien: filtran usuario, forma del disco y a menudo
      // el nombre del proyecto. Se publican relativas a la raíz, o la constante si caen fuera.
      configFile: rutaPublicable(
        typeof config.configFile === 'string' ? config.configFile : undefined,
        this.raizDelRepo,
      ).publicado,
      rootDir: rutaPublicable(config.rootDir, this.raizDelRepo).publicado,
      raiz_del_repo_derivada: 'NO_SE_PUBLICA_ES_UNA_RUTA_ABSOLUTA',
      raiz_derivada_de: typeof config.configFile === 'string' && config.configFile !== '' ? 'configFile' : 'rootDir_fallback',
      version: config.version,
      workers: config.workers,
      proyectos,
      webServer: servidores,
      tests_descubiertos: suite.allTests().length,
      // Booleano de PRESENCIA: el valor de CI puede ser cualquier cosa, incluido algo sensible.
      CI_definida_en_entorno: 'CI' in process.env,
      env_volcado: 'NO_POR_DISENO_PUEDE_CONTENER_SECRETOS',
      urls_en_claro: 'NO_POR_DISENO_SOLO_ORIGEN_BANDERAS_Y_SHA256',
    };
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const trace = result.attachments.find((a) => a.name === 'trace' && typeof a.path === 'string');
    /**
     * 🔴 CONTAINMENT CANÓNICO, NO PREFIJO TEXTUAL · ítem 12.
     *
     * Acá había `p.startsWith(raizDelRepo + '/')`, y si no matcheaba **devolvía la ruta
     * ABSOLUTA** — o sea que el caso de fallo publicaba justo lo que no se puede publicar.
     * `rutaPublicable` compara rutas con `realpath` + `path.relative` y, cuando la ruta cae
     * fuera del árbol, devuelve una constante en vez del valor.
     *
     * ⚠️ Consecuencia declarada: un trace que cayera fuera del árbol ya no se une por
     * igualdad con el zip medido, y la biyección del extractor lo marcará faltante. Es la
     * conducta correcta —un artefacto fuera del árbol no es de esta corrida— pero es un
     * cambio de comportamiento, no sólo de redacción.
     */
    const rel = (p: string): string => rutaPublicable(p, this.raizDelRepo).publicado;
    this.tests.push({
      id: test.id,
      titulo: test.titlePath().filter(Boolean).join(' > '),
      title_path: test.titlePath().filter(Boolean),
      spec: rel(test.location.file),
      linea: test.location.line,
      columna: test.location.column,
      proyecto: test.parent.project()?.name ?? 'UNKNOWN',
      estado: result.status,
      reintentos: result.retry,
      duracion_ms: result.duration,
      trace_path_relativo: trace?.path !== undefined ? rel(trace.path) : null,
      adjuntos: result.attachments.map((a) => a.name),
    });
  }

  onEnd(resultado: FullResult): void {
    const informe = {
      instrumento: 'e2e/_reporter-origen.ts',
      acredita: 'CONFIGURACION_EFECTIVA_RESUELTA_POR_EL_RUNNER',
      no_acredita: 'TRAFICO_OBSERVADO — eso lo mide scripts/extraer-origenes.mjs sobre el trace',
      inicio_utc: this.inicio,
      fin_utc: new Date().toISOString(),
      estado_corrida: resultado.status,
      config_resuelta: this.resuelto,
      total_tests_ejecutados: this.tests.length,
      tests: this.tests,
    };
    mkdirSync(dirname(this.destino), { recursive: true });
    writeFileSync(this.destino, `${JSON.stringify(informe, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    process.stderr.write(`reporter-origen: configuración efectiva escrita en ${this.destino}\n`);
  }
}

/** Se exportan para que el test focal pruebe la redacción sin levantar un runner. */
export const _paraPruebas = { urlSegura, proxySeguro, comandoSeguro };
