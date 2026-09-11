/**
 * EL GATE DE ORIGEN · qué orígenes contactó realmente el navegador durante el E2E.
 *
 * ## Por qué existe, y qué defecto cierra
 *
 * Hasta ahora, la afirmación «el E2E corre sólo contra el mock loopback, cero red
 * externa» salía de `playwright.config.ts` —de `use.baseURL` y de `webServer.url`— y
 * de los nombres de los tests. **Eso es configuración declarada, no tráfico medido.**
 * Ningún artefacto de la corrida registraba contra qué habló el navegador: el log del
 * reporter `list` no tiene una sola URL, y el reporter `json` tampoco sirve —su tipo
 * `JSONReport.config.projects[]` enumera `outputDir/repeatEach/retries/metadata/id/
 * name/testDir/testIgnore/testMatch/timeout` y **no incluye `use`**—.
 *
 * Lo único que registra tráfico real sin tocar un solo test de producto es el
 * **trace de Playwright**: su zip trae una entrada de red escrita por el HarTracer,
 * con entradas `resource-snapshot` que llevan `request.url`. Este script la lee y
 * enumera TODOS los orígenes contactados.
 *
 * ## 🔴 La guarda que hace que esto valga: cero URLs NO es «cero red externa»
 *
 * Es un instrumento que puede fallar, y si falla devuelve el mismo cero que devolvería
 * una corrida limpia. Por eso exige un **control positivo**: la corrida tiene que verse
 * contactando el origen esperado. Si no aparece, el veredicto es
 * `INSTRUMENTO_NO_ACREDITADO` y no se afirma nada sobre red externa.
 *
 * No es una precaución teórica. La primera versión de este extractor buscaba la entrada
 * literal `trace.network`, tomada del código de `playwright-core`. **El artefacto real la
 * nombra `0-trace.network`**, con el ordinal del chunk adelante: devolvió 0 URLs sobre 6
 * trazas sanas de 660 requests. Lo cazó el control positivo. De ahí que acá se ancle en
 * el SUFIJO `.network` —lo que el zip expone— y no en un literal leído en la fuente.
 *
 * ## Uso
 *
 *   node scripts/extraer-origenes.mjs <dir-de-traces> <origen-esperado> [salida.json]
 *
 * Exit 0 SÓLO con `MEDIDO_SOLO_LOOPBACK_CERO_ORIGENES_EXTERNOS`. Cualquier otro
 * veredicto —incluido «no pude medir»— sale distinto de cero: es un gate, no un informe.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, basename } from 'node:path';

/** Hosts que son la propia máquina. Todo lo demás se enumera explícito. */
export const HOSTS_LOOPBACK = Object.freeze(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);

/** Esquemas que no son red y no se cuentan como origen. */
const ESQUEMAS_SIN_RED = Object.freeze(['data', 'blob', 'about', 'chrome', 'chrome-extension']);

export const VEREDICTOS = Object.freeze({
  SIN_TRACES: 'INSTRUMENTO_SIN_DATOS_CERO_TRACES',
  SIN_URLS: 'INSTRUMENTO_SIN_DATOS_CERO_URLS',
  SIN_CONTROL: 'INSTRUMENTO_NO_ACREDITADO_FALTA_ORIGEN_ESPERADO',
  LIMPIO: 'MEDIDO_SOLO_LOOPBACK_CERO_ORIGENES_EXTERNOS',
  EXTERNOS: 'MEDIDO_CON_ORIGENES_NO_LOOPBACK',
});

/**
 * Clasifica una lista de URLs observadas. Función pura: es la parte que decide, y se
 * prueba sin necesidad de fabricar un zip.
 */
export function clasificarOrigenes(urls, origenEsperado) {
  const porOrigen = new Map();
  const sinRed = new Map();
  const noParseables = [];

  for (const url of urls) {
    if (typeof url !== 'string' || url === '') {
      noParseables.push(String(url));
      continue;
    }
    const esquema = url.slice(0, Math.max(url.indexOf(':'), 0)).toLowerCase();
    if (ESQUEMAS_SIN_RED.includes(esquema)) {
      sinRed.set(esquema, (sinRed.get(esquema) ?? 0) + 1);
      continue;
    }
    let origen;
    let host;
    try {
      const u = new URL(url);
      origen = u.origin;
      host = u.hostname;
      // Algunos esquemas (ws:, file:) devuelven origin "null" en WHATWG; se reconstruye
      // para no perder la información de host, que es lo que discrimina loopback.
      if (origen === 'null') origen = `${u.protocol}//${u.host}`;
    } catch {
      noParseables.push(url.slice(0, 200));
      continue;
    }
    const previo = porOrigen.get(origen);
    if (previo) previo.requests += 1;
    else porOrigen.set(origen, { origen, requests: 1, loopback: HOSTS_LOOPBACK.includes(host) });
  }

  const origenes = [...porOrigen.values()].sort((a, b) => b.requests - a.requests);
  const noLoopback = origenes.filter((o) => !o.loopback);
  const controlPositivo = origenes.some((o) => o.origen === origenEsperado);

  let veredicto;
  if (urls.length === 0) veredicto = VEREDICTOS.SIN_URLS;
  else if (!controlPositivo) veredicto = VEREDICTOS.SIN_CONTROL;
  else if (noLoopback.length === 0) veredicto = VEREDICTOS.LIMPIO;
  else veredicto = VEREDICTOS.EXTERNOS;

  return {
    veredicto,
    control_positivo_ok: controlPositivo,
    origenes,
    origenes_no_loopback: noLoopback,
    esquemas_sin_red: [...sinRed.entries()].map(([esquema, ocurrencias]) => ({ esquema, ocurrencias })),
    urls_no_parseables: noParseables,
  };
}

function zipsDe(dir) {
  const hallados = [];
  if (!existsSync(dir)) return hallados;
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entrada.name);
    if (entrada.isDirectory()) hallados.push(...zipsDe(p));
    else if (entrada.isFile() && entrada.name.endsWith('.zip')) hallados.push(p);
  }
  return hallados;
}

/**
 * 🔴 Si `unzip` no está, esto LANZA en vez de devolver cero entradas. Un extractor que
 * no puede abrir el zip y contesta «no vi orígenes externos» es peor que uno que falla.
 */
function entradasDelZip(zip) {
  const salida = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return salida.split('\n').filter(Boolean);
}

function leerEntrada(zip, entrada) {
  return execFileSync('unzip', ['-p', zip, entrada], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
}

/** Lee todos los traces de `dir` y devuelve el informe completo. */
export function extraerDeDirectorio(dir, origenEsperado) {
  const zips = zipsDe(dir);
  const urls = [];
  const detalle = [];

  for (const zip of zips) {
    const entradas = entradasDelZip(zip);
    // El ordinal del chunk prefija el nombre (`0-trace.network`), así que se ancla en el
    // sufijo. Un zip puede traer más de un chunk: se leen todos.
    const entradasRed = entradas.filter((e) => e.endsWith('.network'));
    let lineas = 0;
    let urlsAqui = 0;
    for (const entradaRed of entradasRed) {
      for (const linea of leerEntrada(zip, entradaRed).split('\n')) {
        if (!linea.trim()) continue;
        lineas += 1;
        let obj;
        try {
          obj = JSON.parse(linea);
        } catch {
          continue;
        }
        const url = obj?.snapshot?.request?.url;
        if (typeof url === 'string') {
          urls.push(url);
          urlsAqui += 1;
        }
      }
    }
    detalle.push({
      zip: relative(dir, zip) || basename(zip),
      entradas_del_zip: entradas.length,
      entradas_de_red: entradasRed,
      lineas_red: lineas,
      urls_extraidas: urlsAqui,
    });
  }

  const clasificacion = clasificarOrigenes(urls, origenEsperado);
  const veredicto = zips.length === 0 ? VEREDICTOS.SIN_TRACES : clasificacion.veredicto;

  return {
    instrumento: 'scripts/extraer-origenes.mjs',
    acredita: 'TRAFICO_OBSERVADO_POR_EL_NAVEGADOR_SEGUN_LA_ENTRADA_DE_RED_DEL_TRACE',
    no_acredita: 'CONFIGURACION — para el baseURL efectivo ver el reporter e2e/_reporter-origen.ts',
    medido_utc: new Date().toISOString(),
    directorio_analizado: dir,
    origen_esperado_control_positivo: origenEsperado,
    ...clasificacion,
    veredicto,
    totales: {
      traces_hallados: zips.length,
      traces_con_entrada_de_red: detalle.filter((d) => d.entradas_de_red.length > 0).length,
      urls_extraidas: urls.length,
      origenes_distintos: clasificacion.origenes.length,
      origenes_externos: clasificacion.origenes_no_loopback.length,
      urls_no_parseables: clasificacion.urls_no_parseables.length,
    },
    detalle_por_trace: detalle,
  };
}

const invocadoDirectamente = process.argv[1] && process.argv[1].endsWith('extraer-origenes.mjs');
if (invocadoDirectamente) {
  const [dir, origenEsperado, salida] = process.argv.slice(2);
  if (!dir || !origenEsperado) {
    process.stderr.write('uso: node scripts/extraer-origenes.mjs <dir-de-traces> <origen-esperado> [salida.json]\n');
    process.exit(2);
  }
  const informe = extraerDeDirectorio(dir, origenEsperado);
  if (salida) writeFileSync(salida, `${JSON.stringify(informe, null, 2)}\n`, 'utf8');
  process.stdout.write(`veredicto: ${informe.veredicto}\n`);
  process.stdout.write(
    `traces ${informe.totales.traces_hallados} · urls ${informe.totales.urls_extraidas} · origenes ${informe.totales.origenes_distintos}\n`,
  );
  for (const o of informe.origenes) {
    process.stdout.write(`  ${o.loopback ? 'loopback' : 'EXTERNO '} ${o.origen} x${o.requests}\n`);
  }
  process.exit(informe.veredicto === VEREDICTOS.LIMPIO ? 0 : 1);
}
