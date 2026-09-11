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
 * ## Dónde escribe
 *
 * En `<outputDir>/origen-config.json` —`test-results/`, que está en `.gitignore`— salvo
 * que `PAYME_ORIGEN_OUT` indique otra ruta. No vuelca `process.env`: ese objeto puede
 * contener secretos, y una evidencia que los copia es peor que no tener evidencia.
 */

type Anotable = string | number | boolean | null;

function origenDe(valor: unknown): Anotable {
  if (typeof valor !== 'string' || valor === '') return null;
  try {
    return new URL(valor).origin;
  } catch {
    return `NO_PARSEABLE:${valor}`;
  }
}

/** Lo ausente se dice `UNKNOWN`, nunca se omite: un campo que falta se lee como un cero. */
function oDesconocido<T>(valor: T | undefined): T | 'UNKNOWN' {
  return valor === undefined ? 'UNKNOWN' : valor;
}

interface TestRegistrado {
  readonly titulo: string;
  readonly proyecto: string;
  readonly estado: string;
  readonly reintentos: number;
  readonly duracion_ms: number;
}

export default class ReporterOrigen implements Reporter {
  private inicio = '';
  private destino = '';
  private resuelto: Record<string, unknown> = {};
  private readonly tests: TestRegistrado[] = [];

  onBegin(config: FullConfig, suite: Suite): void {
    this.inicio = new Date().toISOString();

    const salidaDeclarada = process.env.PAYME_ORIGEN_OUT;
    const outputDir = config.projects[0]?.outputDir ?? join(config.rootDir, 'test-results');
    this.destino = salidaDeclarada && salidaDeclarada !== '' ? salidaDeclarada : join(outputDir, 'origen-config.json');

    const proyectos = config.projects.map((p) => ({
      nombre: p.name,
      baseURL: oDesconocido(p.use.baseURL),
      baseURL_origen: origenDe(p.use.baseURL),
      trace: oDesconocido(p.use.trace as unknown as string | undefined),
      // Un proxy declarado cambiaría por completo el destino real del tráfico: se
      // registra explícito en vez de darse por ausente.
      proxy: p.use.proxy ? p.use.proxy : 'AUSENTE',
      ignoreHTTPSErrors: oDesconocido(p.use.ignoreHTTPSErrors),
    }));

    const ws = config.webServer;
    const servidores =
      ws === undefined || ws === null
        ? 'UNKNOWN_NO_EXPUESTO_AL_REPORTER'
        : (Array.isArray(ws) ? ws : [ws]).map((w) => ({
            url: oDesconocido(w.url),
            url_origen: origenDe(w.url),
            port: oDesconocido(w.port),
            command: oDesconocido(w.command),
            reuseExistingServer: oDesconocido(w.reuseExistingServer),
          }));

    this.resuelto = {
      configFile: oDesconocido(config.configFile),
      rootDir: config.rootDir,
      version: config.version,
      workers: config.workers,
      proyectos,
      webServer: servidores,
      tests_descubiertos: suite.allTests().length,
      CI_en_entorno: 'CI' in process.env ? String(process.env.CI) : 'AUSENTE',
      env_volcado: 'NO_POR_DISENO_PUEDE_CONTENER_SECRETOS',
    };
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    this.tests.push({
      titulo: test.titlePath().filter(Boolean).join(' > '),
      proyecto: test.parent.project()?.name ?? 'UNKNOWN',
      estado: result.status,
      reintentos: result.retry,
      duracion_ms: result.duration,
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
