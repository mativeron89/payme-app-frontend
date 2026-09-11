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
 * enumera TODOS los orígenes contactados, **traza por traza**.
 *
 * ## 🔴 Tres cosas que este gate se niega a hacer, y por qué
 *
 * ① **Cero URLs no es «cero red externa».** El instrumento puede fallar, y si falla
 * devuelve el mismo cero que una corrida limpia. Por eso exige un control positivo: la
 * corrida tiene que verse contactando el origen esperado. Si no aparece, es
 * `INSTRUMENTO_NO_ACREDITADO` y no se afirma nada.
 *
 * No es teórico. La primera versión buscaba la entrada literal `trace.network`, tomada
 * del código de `playwright-core`. **El artefacto real la nombra `0-trace.network`**,
 * con el ordinal del chunk adelante: devolvió 0 URLs sobre 6 trazas sanas de 660
 * requests. Lo cazó el control positivo. De ahí que acá se ancle en el SUFIJO
 * `.network` —lo que el zip expone— y no en un literal leído en la fuente.
 *
 * ② **Una línea que no parsea NO se ignora.** Antes se salteaba y el veredicto podía
 * salir `LIMPIO` igual: un trace truncado o corrupto podía esconder un origen externo
 * y el gate lo aprobaba. Ahora una sola línea ilegible produce `NO_VERIFICABLE`. «No
 * pude leer todo» nunca es «leí todo y está bien».
 *
 * ③ **El veredicto es POR TRAZA, no agregado.** Antes se juntaban todas las URLs en una
 * bolsa y se miraba el conjunto: una traza sin entrada de red aportaba cero y quedaba
 * **invisible**, porque el control positivo ya lo satisfacía otra. No es hipotético —
 * ocurrió: en una corrida que se presentó como limpia, 2 de 211 trazas no tenían red y
 * la afirmación cubría 209, no 211. Ahora cada traza rinde su propio veredicto y una
 * traza sin red observable es un HALLAZGO.
 *
 * ## Uso
 *
 *   node scripts/extraer-origenes.mjs <dir-de-traces> <origen-esperado> [salida.json]
 *
 * Exit 0 SÓLO con `MEDIDO_SOLO_LOOPBACK_CERO_ORIGENES_EXTERNOS`. Cualquier otro
 * veredicto —incluido «no pude medir»— sale distinto de cero: es un gate, no un informe.
 */

import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, basename } from 'node:path';

import { leerEntradas } from './leer-zip.mjs';
import {
  esLoopback,
  origenPublicable,
  rutaPublicable,
  HOSTS_LOOPBACK,
  TERCEROS_CONOCIDOS,
} from './redactar.mjs';

/**
 * Hosts que son la propia máquina. **Definidos una sola vez, en `redactar.mjs`**, y
 * re-exportados acá para no romper a quien los importe de este módulo. Ver el ítem 6.
 */
export { HOSTS_LOOPBACK };

/**
 * 🔴 UTF-8 ESTRICTO. `buf.toString('utf8')` **no falla nunca**: los bytes invalidos se
 * reemplazan callados por U+FFFD. Sobre una traza corrupta eso es leer basura como si fuera
 * texto — y si la linea mutilada era la que traia el origen externo, el gate sale LIMPIO
 * sobre datos que nadie pudo leer. Es el mismo fail-open que el CRC vino a cerrar, una capa
 * mas arriba.
 *
 * Con `fatal: true` el decodificador LANZA y el llamador contamina la traza. «No pude
 * decodificar» y «decodifique y no habia nada» son afirmaciones distintas.
 */
const DECODIFICADOR_ESTRICTO = new TextDecoder('utf-8', { fatal: true });

export function decodificarUtf8Estricto(buf, queEs) {
  try {
    return DECODIFICADOR_ESTRICTO.decode(buf);
  } catch (e) {
    throw new Error(`UTF8_INVALIDO en ${queEs}: ${e.message}`);
  }
}

/**
 * 🔴 LA ALLOWLIST NO VIVE ACA · item 6 de la reauditoria del CTO.
 *
 * `TERCEROS_CONOCIDOS` y la politica de publicacion estaban escritas en este archivo Y en
 * `e2e/_reporter-origen.ts` a la vez. Dos implementaciones de la misma decision se desalinean
 * calladas, y en este repo ya paso en su forma mas cara: la regla «no se hashea el crudo»
 * quedo escrita en el reporter y **no aplicada aca** la misma noche, con un test que encima
 * imponia la violacion.
 *
 * Se re-exporta desde `redactar.mjs` para no romper a quien la importe de aca, pero la
 * definicion es UNA sola.
 */
export { TERCEROS_CONOCIDOS };

/** Esquemas que no son red y no se cuentan como origen. */
const ESQUEMAS_SIN_RED = Object.freeze(['data', 'blob', 'about', 'chrome', 'chrome-extension']);

export const VEREDICTOS = Object.freeze({
  SIN_TRACES: 'INSTRUMENTO_SIN_DATOS_CERO_TRACES',
  SIN_URLS: 'INSTRUMENTO_SIN_DATOS_CERO_URLS',
  SIN_CONTROL: 'INSTRUMENTO_NO_ACREDITADO_FALTA_ORIGEN_ESPERADO',
  NO_VERIFICABLE: 'NO_VERIFICABLE_LINEA_ILEGIBLE_O_DE_FORMA_INESPERADA',
  BIYECCION_ROTA: 'NO_VERIFICABLE_CARDINALIDAD_REGISTRO_VS_TRAZAS',
  PAREO_ROTO: 'NO_VERIFICABLE_PAREO_ORDINAL_RED_VS_CONTEXTO',
  TRAZAS_SIN_RED: 'HALLAZGO_TRAZAS_SIN_RED_OBSERVABLE',
  SIN_REGISTRO: 'NO_VERIFICABLE_TRAZA_SIN_REGISTRO_EN_EL_REPORTER',
  SIN_NETWORK_EN_ZIP: 'HALLAZGO_TRAZAS_SIN_NETWORK_EN_ZIP',
  SIN_NAVEGADOR_NO_DECLARADO: 'HALLAZGO_TRAZAS_SIN_NAVEGADOR_NO_DECLARADAS',
  LIMPIO: 'MEDIDO_SOLO_LOOPBACK_CERO_ORIGENES_EXTERNOS',
  EXTERNOS: 'MEDIDO_CON_ORIGENES_NO_LOOPBACK',
});

/**
 * 🔴 Las tres formas de «no vi tráfico» NO son la misma, y colapsarlas es lo que dejaba
 * pasar el agujero. Se distinguen por lo que el zip contiene, no por una lista a mano:
 *
 *   · sin entrada de contexto (`*-trace.trace`) ⇒ el test NUNCA abrió navegador.
 *   · con contexto y sin `.network`             ⇒ hubo navegador y falta el archivo: HALLAZGO.
 *   · con `.network` y cero requests            ⇒ hubo navegador y no pidió nada.
 */
export const VEREDICTOS_DE_TRAZA = Object.freeze({
  OK: 'TRAZA_SOLO_LOOPBACK',
  SIN_REGISTRO: 'TRAZA_SIN_REGISTRO_EN_EL_REPORTER',
  SIN_NAVEGADOR: 'TRAZA_SIN_NAVEGADOR',
  SIN_NETWORK_EN_ZIP: 'TRAZA_SIN_NETWORK_EN_ZIP',
  SIN_RED: 'TRAZA_SIN_RED_OBSERVABLE',
  ILEGIBLE: 'TRAZA_CON_LINEA_ILEGIBLE',
  INESPERADA: 'TRAZA_CON_LINEA_DE_FORMA_INESPERADA',
  CONTEXTO_CORRUPTO: 'TRAZA_CON_CONTEXTO_ILEGIBLE',
  RED_SIN_ORDINAL: 'TRAZA_CON_ENTRADA_DE_RED_SIN_ORDINAL',
  RED_SIN_CONTEXTO_PAREADO: 'TRAZA_CON_RED_SIN_CONTEXTO_DEL_MISMO_ORDINAL',
  EXTERNOS: 'TRAZA_CON_ORIGEN_NO_LOOPBACK',
});

/**
 * Tests que legítimamente NO abren navegador, y por eso no dejan red.
 *
 * 🔴 **Estuvo vacía a propósito durante toda la fase anterior**, con este motivo: una traza
 * sin navegador es un HALLAZGO hasta que alguien explique por qué ese test no lo necesita, y
 * llenarla yo mismo habría sido marcarme la tarea — el gate quedaría verde por decisión del
 * mismo que lo escribió.
 *
 * Se llena ahora, y lo que cambió no es el permiso sino **la evidencia**. No se declara por
 * conveniencia ni por slug: se declara por IDENTIDAD del test, y con la prueba a la vista.
 * La corrida completa del 2026-09-11 midió 211 trazas y exactamente DOS sin contexto de
 * navegador; abiertas sus fuentes, ninguna de las dos toma el fixture `page`:
 *
 *   · `e2e/runner-servidor.spec.ts:49` — `async () => {…}` sin fixtures. Lee
 *     `playwright.config.ts` como TEXTO y afirma sobre él. Verifica CONFIGURACIÓN, no
 *     conducta, justamente porque la conducta que le importa —no reutilizar un servidor
 *     ajeno— no se puede observar desde una corrida ya arrancada.
 *   · `e2e/rutas-montan-pantalla.spec.ts:267` — `() => {…}` sin fixtures. Compara dos
 *     arreglos en memoria para que falte una expectativa se vea en UNA línea en vez de en
 *     cuál de catorce casos. Su propio comentario dice «no necesita navegador».
 *
 * 🔴 **Se matchea por `spec:linea`, NUNCA por el slug del directorio.** El slug viene truncado
 * y hasheado: dos títulos parecidos colisionan, y un test nuevo podría caer dentro de una
 * declaración escrita para otro. La identidad la provee el reporter en `onTestEnd`.
 *
 * ⚠️ Y el límite: esto declara que esos dos NO ABREN NAVEGADOR. No declara que sean
 * correctos, ni que su ausencia de red sea benigna para siempre. Si uno de los dos empieza a
 * tomar `page`, dejará de aparecer acá y el gate volverá a marcarlo — que es lo que se quiere.
 */
export const SIN_NAVEGADOR_DECLARADAS = Object.freeze([
  { spec: 'e2e/runner-servidor.spec.ts', linea: 49, por_que: 'sin fixtures: lee playwright.config.ts como texto' },
  { spec: 'e2e/rutas-montan-pantalla.spec.ts', linea: 267, por_que: 'sin fixtures: compara dos arreglos en memoria' },
]);

/**
 * ¿Esta traza corresponde a un test declarado sin navegador? Se decide con la IDENTIDAD que
 * el reporter registró, no con el nombre del directorio.
 *
 * Una traza sin registro **nunca** cuenta como declarada: si no se sabe qué test la produjo,
 * tampoco se sabe si tenía permiso de no abrir navegador.
 */
function estaDeclaradaSinNavegador(traza) {
  const t = traza.test;
  if (t === null || t === undefined) return false;
  return SIN_NAVEGADOR_DECLARADAS.some((d) => d.spec === t.spec && d.linea === t.linea);
}

/**
 * La traza del navegador lleva el ordinal del chunk: `0-trace.trace`. `test.trace` no.
 * El ordinal se **captura** porque es la clave con la que se parea la entrada de red.
 */
const ES_TRAZA_DE_NAVEGADOR = /^(\d+)-trace\.trace$/;

/**
 * La entrada de red del mismo chunk: `0-trace.network`. **Exige ordinal**: sin él no hay con
 * qué parear, y una entrada de red que no se puede atribuir a un contexto no acredita nada.
 */
const ES_RED_DE_NAVEGADOR = /^(\d+)-trace\.network$/;

/**
 * Una URL que no parsea NO se guarda cruda: puede traer query, tokens o identificadores.
 *
 * 🔴 **Y tampoco se guarda su sha256.** La versión anterior lo publicaba «para poder
 * comparar sin republicar el valor». Un sha256 no se revierte, pero un secreto de baja
 * entropía —un token corto, un PIN— se recupera probando candidatos contra el digest:
 * publicarlo es publicar un oráculo de verificación del secreto.
 *
 * Esta misma regla la escribí en `e2e/_reporter-origen.ts` y **no la apliqué acá**, en el
 * archivo de al lado, la misma noche, con el razonamiento ya redactado. Peor: dejé un test
 * que EXIGÍA el campo, así que la violación estaba fijada por una prueba.
 *
 * Queda sólo estructura no sensible: esquema, largo y por qué no se pudo parsear.
 */
function redactar(url) {
  const texto = typeof url === 'string' ? url : String(url);
  const dosPuntos = texto.indexOf(':');
  return {
    esquema: dosPuntos > 0 ? texto.slice(0, dosPuntos).toLowerCase() : 'SIN_ESQUEMA',
    largo: texto.length,
    motivo: typeof url === 'string' ? 'NO_PARSEA_COMO_URL' : 'NO_ES_STRING',
  };
}

/**
 * Clasifica una lista de URLs observadas. Función pura: es la parte que decide, y se
 * prueba sin necesidad de fabricar un zip.
 */
/**
 * 🔴 La POLITICA de publicacion tampoco vive aca: la decide `redactar.mjs` · item 6.
 *
 * Este modulo tenia su propia `seudonimoDeOrigen`, gemela de la del reporter. Ahora solo
 * arma la FILA del censo —origen publicable + cantidad de requests— y delega en la unica
 * politica del repo que decide que se publica de cada origen.
 *
 * Lo que si es de este modulo, y se conserva: para lo no loopback el campo crudo **se
 * retira**, no se acompaña. Cuando se introdujo el seudonimo, los 31 tests del extractor
 * siguieron verdes porque ninguno afirmaba la AUSENCIA del host crudo: la redaccion se ve,
 * la no-redaccion hay que ir a buscarla.
 */
export function publicarOrigen(o) {
  const seudo = origenPublicable(o.origen);
  if (seudo.clase === 'LOOPBACK') {
    return { origen: seudo.publicado, requests: o.requests, loopback: true, clase: seudo.clase };
  }
  const fila = { origen: seudo.publicado, requests: o.requests, loopback: false, clase: seudo.clase };
  if (seudo.tercero !== undefined) fila.tercero = seudo.tercero;
  if (seudo.esquema !== undefined) fila.esquema = seudo.esquema;
  if (seudo.largo_del_host !== undefined) fila.largo_del_host = seudo.largo_del_host;
  return fila;
}

export function clasificarOrigenes(urls, origenEsperado) {
  const porOrigen = new Map();
  const sinRed = new Map();
  const noParseables = [];

  for (const url of urls) {
    if (typeof url !== 'string' || url === '') {
      noParseables.push(redactar(url));
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
      noParseables.push(redactar(url));
      continue;
    }
    const previo = porOrigen.get(origen);
    if (previo) previo.requests += 1;
    else porOrigen.set(origen, { origen, requests: 1, loopback: esLoopback(host) });
  }

  const origenes = [...porOrigen.values()].sort((a, b) => b.requests - a.requests).map(publicarOrigen);
  // 🔴 El control positivo compara contra el valor MEDIDO, no contra el publicado: el
  // seudonimo existe para la evidencia, no para decidir. Si se comparara contra el publicado,
  // un origen esperado que cayera en EXTERNO_NO_ALLOWLISTADO dejaria de reconocerse.
  const controlPositivo = [...porOrigen.values()].some((o) => o.origen === origenEsperado);
  const noLoopback = origenes.filter((o) => !o.loopback);

  let veredicto;
  if (noParseables.length > 0) veredicto = VEREDICTOS.NO_VERIFICABLE;
  else if (urls.length === 0) veredicto = VEREDICTOS.SIN_URLS;
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
 * Lee todos los traces de `dir` y devuelve el informe completo, traza por traza.
 *
 * Es `async` porque el lector de zip lo es: `yauzl` trabaja por stream, que es lo que
 * permite calcular el CRC32 sobre lo que realmente se leyo en vez de confiar en el tamano.
 */
export async function extraerDeDirectorio(dir, origenEsperado, registroDeTests = null) {
  /**
   * 🔴 UNIÓN POR IDENTIDAD EXACTA, cuando el reporter la provee.
   *
   * El slug del directorio de un trace viene truncado y hasheado: no es reversible y dos
   * títulos parecidos colisionan. `test.trace` tampoco trae el título — en Playwright 1.62.1
   * no contiene `titlePath` ni el id, y el título vive en `*-trace.trace`, que falta
   * justamente en las trazas Node-only, que son las que hay que identificar.
   *
   * Lo único autoritativo es el path del attachment que `onTestEnd` registró. Se une por
   * **igualdad exacta** de ese path, nunca por substring ni por regex laxa. Una traza que
   * no figura en el registro es `NO_VERIFICABLE`: apareció un artefacto que ningún test
   * declara haber producido, y eso no se interpreta, se denuncia.
   */
  const porPath = new Map();
  if (Array.isArray(registroDeTests)) {
    for (const t of registroDeTests) {
      if (typeof t?.trace_path_relativo === 'string') porPath.set(t.trace_path_relativo, t);
    }
  }
  const raizDelRepo = dir.endsWith('/test-results') ? dir.slice(0, -'/test-results'.length) : null;
  const zips = zipsDe(dir);
  const urlsGlobales = [];
  const trazas = [];

  for (const zip of zips) {
    // El lector usa yauzl (ya pinneado dentro de playwright-core), no depende del PATH ni de
    // un binario externo, verifica CRC32 en streaming y LANZA si el zip no se entiende, en
    // vez de devolver un vacío que se leería como «nada raro». Se leen SOLO las entradas de
    // red: inflar screenshots y fuentes seria gasto y superficie de riesgo sin contrapartida.
    // Se leen las entradas de red Y la traza de contexto del navegador. Leerla —no sólo
    // ver su nombre— es lo que permite verificar su CRC y su contenido.
    const { nombres: entradas, contenidos: contenido } = await leerEntradas(
      zip,
      // Se leen sólo las entradas con ordinal. Una `.network` sin ordinal se DENUNCIA por su
      // nombre —que `leerEntradas` devuelve igual— y no se infla: no va a acreditar nada, así
      // que leerla sería gasto y superficie de riesgo sin contrapartida.
      (n) => ES_RED_DE_NAVEGADOR.test(n) || ES_TRAZA_DE_NAVEGADOR.test(n),
    );
    /**
     * 🔴 EMPAREJAMIENTO ORDINAL · ítem 4 de la reauditoría del CTO.
     *
     * Antes el contexto se acreditaba **globalmente para el zip**: bastaba UNA entrada
     * `N-trace.trace` válida para que TODAS las `.network` del zip contaran como tráfico de
     * navegador. Un zip con un contexto legítimo y una entrada de red fabricada al lado salía
     * acreditado entero. La acreditación tiene que ser por chunk, no por archivo.
     *
     * Ahora cada `M-trace.network` exige **su** `M-trace.trace`, leído y con `context-options`
     * parseable. Sin pareja del mismo ordinal, esa entrada de red no acredita nada.
     *
     * ⚠️ **Y una `.network` SIN ordinal deja de aceptarse.** Había un caso mío que la toleraba
     * «para no romper trazas viejas»; lo escribí cuando el hallazgo era el inverso —el
     * artefacto real llevaba ordinal y mi parser lo ignoraba—. Aquella tolerancia era
     * compatibilidad y hoy es la puerta que el CTO señala: sin ordinal no hay con qué parear,
     * así que no se puede decir de qué contexto salió. Se retira, y el motivo queda escrito
     * para que nadie lo lea como un descuido.
     *
     * Medido sobre trazas reales: `test.trace` **también** trae `context-options`, así que ese
     * evento por sí solo no discrimina. Lo que identifica la traza del navegador es el nombre
     * con ordinal Y que su contenido parsee y traiga `context-options`.
     */
    const entradasRed = [];
    const redesSinOrdinal = [];
    for (const e of entradas) {
      if (!e.endsWith('.network')) continue;
      const m = ES_RED_DE_NAVEGADOR.exec(e);
      if (m === null) {
        redesSinOrdinal.push(e);
        continue;
      }
      entradasRed.push({ nombre: e, ordinal: m[1] });
    }

    const entradasContexto = entradas.filter((e) => ES_TRAZA_DE_NAVEGADOR.test(e));
    /** ordinal → 'ACREDITADO' | 'CORRUPTO'. Un ordinal ausente es «no hay pareja». */
    const contextoPorOrdinal = new Map();
    let contextoCorrupto = false;
    for (const ec of entradasContexto) {
      const ordinal = ES_TRAZA_DE_NAVEGADOR.exec(ec)?.[1] ?? null;
      if (ordinal === null) continue;
      const buf = contenido[ec];
      if (buf === undefined) {
        contextoCorrupto = true;
        contextoPorOrdinal.set(ordinal, 'CORRUPTO');
        continue;
      }
      let textoContexto;
      try {
        textoContexto = decodificarUtf8Estricto(buf, `contexto ${ec} de ${zip}`);
      } catch {
        // Bytes que no son UTF-8 valido: la entrada no se pudo LEER. No se degrada a «la lei
        // y no vi contexto», que es otra afirmacion.
        contextoCorrupto = true;
        contextoPorOrdinal.set(ordinal, 'CORRUPTO');
        continue;
      }
      let vioContexto = false;
      for (const linea of textoContexto.split('\n')) {
        if (!linea.trim()) continue;
        try {
          if (JSON.parse(linea)?.type === 'context-options') vioContexto = true;
        } catch {
          contextoCorrupto = true;
        }
      }
      if (contextoPorOrdinal.get(ordinal) === 'CORRUPTO') continue;
      contextoPorOrdinal.set(ordinal, vioContexto ? 'ACREDITADO' : 'CORRUPTO');
    }

    // Redes cuyo ordinal no tiene contexto acreditado: no se puede decir de qué navegador
    // salieron, así que no acreditan tráfico de navegador.
    const redesSinParejaDeContexto = entradasRed
      .filter((r) => contextoPorOrdinal.get(r.ordinal) !== 'ACREDITADO')
      .map((r) => r.nombre);

    // Hay navegador si ALGÚN ordinal quedó acreditado. La decisión por traza usa además el
    // pareo: tener contexto en el ordinal 0 no acredita la red del ordinal 1.
    const hayContexto = [...contextoPorOrdinal.values()].includes('ACREDITADO');
    const urls = [];
    let lineas = 0;
    let ilegibles = 0;
    let inesperadas = 0;

    for (const { nombre: entradaRed } of entradasRed) {
      let textoRed;
      try {
        textoRed = decodificarUtf8Estricto(contenido[entradaRed], `red ${entradaRed} de ${zip}`);
      } catch {
        // La entrada de red entera queda contaminada: se cuenta ilegible, no se saltea.
        ilegibles += 1;
        continue;
      }
      for (const linea of textoRed.split('\n')) {
        if (!linea.trim()) continue;
        lineas += 1;
        let obj;
        try {
          obj = JSON.parse(linea);
        } catch {
          // 🔴 Fail-closed: no se saltea. Una línea ilegible contamina la traza entera,
          // porque podría ser exactamente la que traía el origen externo.
          ilegibles += 1;
          continue;
        }
        // 🔴 Y una línea que SÍ parsea pero no tiene la forma esperada tampoco se ignora.
        // Medido sobre 211 trazas reales: `trace.network` trae exclusivamente
        // `resource-snapshot`, 110 de 110 con `request.url` string. Cualquier otra forma
        // es un formato que este parser no entiende, y no entender no es aprobar.
        const url = obj?.snapshot?.request?.url;
        if (obj?.type !== 'resource-snapshot' || typeof url !== 'string') {
          inesperadas += 1;
          continue;
        }
        urls.push(url);
      }
    }

    const clas = clasificarOrigenes(urls, origenEsperado);
    urlsGlobales.push(...urls);

    let veredictoTraza;
    // 🔴 Una URL ilegible DENTRO de una linea bien formada tambien contamina la traza. Antes
    // `clasificarOrigenes` la marcaba NO_VERIFICABLE y el veredicto por traza lo ignoraba:
    // un .network valido con localhost + «no-es-una-url» daba traza OK, global LIMPIO y exit 0.
    if (contextoCorrupto) veredictoTraza = VEREDICTOS_DE_TRAZA.CONTEXTO_CORRUPTO;
    // 🔴 Ítem 4: una `.network` sin ordinal no se puede parear con ningún contexto, así que
    // no se sabe de qué navegador salió. Va ARRIBA de todo lo demás porque es «no verificable»,
    // no «verificado y vacío».
    else if (redesSinOrdinal.length > 0) veredictoTraza = VEREDICTOS_DE_TRAZA.RED_SIN_ORDINAL;
    // 🔴 Ítem 4: red con ordinal cuyo `N-trace.trace` falta o no acredita. Antes esto pasaba
    // porque el contexto se acreditaba GLOBAL: un contexto bueno en el chunk 0 acreditaba la
    // red del chunk 1, que podía venir de cualquier lado.
    else if (redesSinParejaDeContexto.length > 0) {
      veredictoTraza = VEREDICTOS_DE_TRAZA.RED_SIN_CONTEXTO_PAREADO;
    } else if (clas.urls_no_parseables.length > 0) veredictoTraza = VEREDICTOS_DE_TRAZA.ILEGIBLE;
    else if (ilegibles > 0) veredictoTraza = VEREDICTOS_DE_TRAZA.ILEGIBLE;
    else if (inesperadas > 0) veredictoTraza = VEREDICTOS_DE_TRAZA.INESPERADA;
    // 🔴 Sin contexto acreditado NO se sigue, exista o no `.network`: un `.network` sin
    // contexto es una combinacion contradictoria, no una traza sana.
    else if (!hayContexto) veredictoTraza = VEREDICTOS_DE_TRAZA.SIN_NAVEGADOR;
    else if (entradasRed.length === 0) veredictoTraza = VEREDICTOS_DE_TRAZA.SIN_NETWORK_EN_ZIP;
    else if (urls.length === 0) veredictoTraza = VEREDICTOS_DE_TRAZA.SIN_RED;
    else if (clas.origenes_no_loopback.length > 0) veredictoTraza = VEREDICTOS_DE_TRAZA.EXTERNOS;
    else veredictoTraza = VEREDICTOS_DE_TRAZA.OK;

    // El registro guarda paths relativos a la raiz del repo; `zip` es absoluto.
    const relAlRepo = raizDelRepo !== null ? relative(raizDelRepo, zip) : null;
    const registrado = relAlRepo !== null ? porPath.get(relAlRepo) ?? null : null;
    if (porPath.size > 0 && registrado === null) veredictoTraza = VEREDICTOS_DE_TRAZA.SIN_REGISTRO;

    trazas.push({
      zip: relative(dir, zip) || basename(zip),
      // 🔴 Se guarda TAMBIEN la ruta relativa a la raiz del repo, que es la base en la que
      // el reporter registra `trace_path_relativo`. Sin ella, la cardinalidad comparaba
      // `intrusa/trace.zip` contra `test-results/intrusa/trace.zip` y toda traza parecia
      // huerfana con otro nombre. Lo cazo el test de biyeccion, no una lectura.
      zip_relativo_al_repo: relAlRepo,
      veredicto: veredictoTraza,
      test: registrado === null ? null : {
        id: registrado.id,
        titulo: registrado.titulo,
        spec: registrado.spec,
        linea: registrado.linea,
      },
      union_por_identidad: porPath.size === 0 ? 'NO_SOLICITADA' : registrado === null ? 'SIN_REGISTRO' : 'EXACTA',
      entradas_del_zip: entradas.length,
      entradas_de_red: entradasRed.map((r) => r.nombre),
      hay_contexto_de_navegador: hayContexto,
      contexto_corrupto: contextoCorrupto,
      entradas_de_contexto: entradasContexto,
      // Ítem 4: el pareo queda publicado, no sólo su consecuencia. Un auditor tiene que poder
      // ver QUÉ ordinal quedó sin pareja sin volver a abrir el zip.
      contexto_por_ordinal: Object.fromEntries(contextoPorOrdinal),
      redes_sin_ordinal: redesSinOrdinal,
      redes_sin_contexto_pareado: redesSinParejaDeContexto,
      lineas_red: lineas,
      lineas_ilegibles: ilegibles,
      lineas_de_forma_inesperada: inesperadas,
      urls_extraidas: urls.length,
      origenes: clas.origenes,
      origenes_no_loopback: clas.origenes_no_loopback,
    });
  }

  const global = clasificarOrigenes(urlsGlobales, origenEsperado);
  const de = (v) => trazas.filter((t) => t.veredicto === v);
  /**
   * 🔴 EL PAREO ROTO TIENE SU PROPIO BALDE, y esto lo encontró un test al correr.
   *
   * La primera versión metía `RED_SIN_ORDINAL` y `RED_SIN_CONTEXTO_PAREADO` dentro de
   * `conIlegibles`. Bloqueaba —eso estaba bien— pero el informe salía diciendo
   * `NO_VERIFICABLE_LINEA_ILEGIBLE` y listando la traza bajo «LINEA ILEGIBLE», que es
   * **falso**: las líneas se leyeron perfectamente; lo que falta es de qué contexto salieron.
   *
   * Un gate que bloquea por la razón correcta y la REPORTA mal manda al auditor a buscar un
   * problema de parseo que no existe. Colapsar hallazgos distintos en un balde con nombre
   * ajeno es la misma clase que ya me costó caro: el veredicto se lee, el detalle no.
   */
  const conPareoRoto = [
    ...de(VEREDICTOS_DE_TRAZA.RED_SIN_ORDINAL),
    ...de(VEREDICTOS_DE_TRAZA.RED_SIN_CONTEXTO_PAREADO),
  ];
  const conIlegibles = [
    ...de(VEREDICTOS_DE_TRAZA.ILEGIBLE),
    ...de(VEREDICTOS_DE_TRAZA.INESPERADA),
    ...de(VEREDICTOS_DE_TRAZA.CONTEXTO_CORRUPTO),
  ];
  const sinRed = de(VEREDICTOS_DE_TRAZA.SIN_RED);
  const conExternos = de(VEREDICTOS_DE_TRAZA.EXTERNOS);
  const sinNetworkEnZip = de(VEREDICTOS_DE_TRAZA.SIN_NETWORK_EN_ZIP);
  // Una traza sin navegador sólo deja de ser hallazgo si está declarada con evidencia.
  const sinNavegador = de(VEREDICTOS_DE_TRAZA.SIN_NAVEGADOR);
  const sinRegistro = de(VEREDICTOS_DE_TRAZA.SIN_REGISTRO);
  /**
   * 🔴 Por IDENTIDAD DEL TEST, no por el slug del zip. El slug viene truncado y hasheado:
   * dos títulos parecidos colisionan, y un `includes` sobre él haría que un test nuevo herede
   * por accidente una declaración escrita para otro. Lo autoritativo es `spec:linea`, que el
   * reporter registró en `onTestEnd`.
   */
  const sinNavegadorNoDeclaradas = sinNavegador.filter((t) => !estaDeclaradaSinNavegador(t));

  /**
   * 🔴 BIYECCIÓN Y CARDINALIDAD registro ↔ ZIP.
   *
   * Hasta acá el gate sabía decir «esta traza no figura en el registro» (huérfana). Le
   * faltaba la dirección contraria y las degeneradas, que son las que dejan pasar un vacío
   * disfrazado de limpio:
   *
   *   · registro AUSENTE      → no se pidió unión; se declara, no se supone.
   *   · registro VACÍO        → hubo reporter y no declaró un solo test. `[]` no es «todo ok».
   *   · registro TODO NULL    → hay tests y ninguno declaró traza: nada que unir.
   *   · DUPLICADOS            → dos tests declarando el mismo path: la unión no es función.
   *   · HUÉRFANAS             → zip que ningún test declara.
   *   · FALTANTES             → test que declaró una traza que no está en el directorio.
   *   · SIN TRAZA DECLARADA   → tests que no produjeron traza (skips, Node-only). No es un
   *                             defecto por sí solo, pero se cuenta: si son TODOS, el gate
   *                             estaría midiendo cero sobre una corrida que sí ocurrió.
   *
   * La cardinalidad es lo que convierte «medí las trazas que encontré» en «medí TODAS las
   * que la corrida produjo». Sin ella, un directorio con la mitad de los artefactos sale
   * idéntico a uno completo.
   */
  /**
   * 🔴 CONTAINMENT CANÓNICO, NO PREFIJO TEXTUAL · ítem 12.
   *
   * Acá había `z.startsWith(raizDelRepo + '/')`. Comparar cadenas **no es** comparar rutas:
   * no normaliza symlinks, así que la misma ruta escrita de dos formas daba dos resultados, y
   * un hermano con prefijo común —`/repo-malicioso` bajo `/repo`— pasaba la comparación que
   * le sigue. `rutaPublicable` usa `realpath` de los dos lados y `path.relative`, y devuelve
   * una constante cuando la ruta no cae adentro: nunca una absoluta.
   */
  const rutaRelativa = (z) => rutaPublicable(z, raizDelRepo).publicado;
  const zipsRelativos = new Set(zips.map(rutaRelativa));
  const declarados = Array.isArray(registroDeTests) ? registroDeTests : null;
  const conTrazaDeclarada =
    declarados === null
      ? []
      : declarados.filter((t) => typeof t?.trace_path_relativo === 'string' && t.trace_path_relativo !== '');
  const vistos = new Map();
  const duplicados = [];
  for (const t of conTrazaDeclarada) {
    const k = t.trace_path_relativo;
    if (vistos.has(k)) duplicados.push(k);
    else vistos.set(k, t);
  }

  /**
   * 🔴 UN `trace_path_relativo` NULO EXIGE JUSTIFICACIÓN · ítem 5.
   *
   * Antes el nulo se contaba y se dejaba pasar: «este test no dejó traza» era una afirmación
   * que el gate aceptaba sin pedir el motivo. Pero un test que corrió y no dejó traza y uno
   * que se salteó **no son lo mismo**, y sólo el segundo es benigno: el primero significa que
   * el instrumento perdió un artefacto que debería existir.
   *
   * Ahora el nulo sólo vale con `estado` de salteo declarado por el reporter. Cualquier otra
   * combinación —`estado` ausente, de forma inesperada, o de un test que sí corrió— rompe la
   * biyección. Y `SIN_NAVEGADOR` **no se infiere del slug ni del stack**: se declara.
   */
  const ESTADOS_QUE_JUSTIFICAN_NULO = Object.freeze(['skipped', 'interrupted']);
  const nulosSinJustificar = [];
  const estadosDeFormaInesperada = [];
  if (declarados !== null) {
    for (const t of declarados) {
      const ruta = t?.trace_path_relativo;
      const estado = t?.estado;
      if (typeof ruta === 'string' && ruta !== '') continue;
      if (ruta !== null && ruta !== undefined) {
        // Ni string usable ni nulo explícito: es una forma que este gate no entiende.
        estadosDeFormaInesperada.push(String(t?.id ?? 'SIN_ID'));
        continue;
      }
      if (typeof estado !== 'string' || !ESTADOS_QUE_JUSTIFICAN_NULO.includes(estado)) {
        nulosSinJustificar.push(String(t?.id ?? 'SIN_ID'));
      }
    }
  }
  const faltantes = [...vistos.keys()].filter((k) => !zipsRelativos.has(k));
  // Se usa la MISMA base que `zipsRelativos`: la raiz del repo. Dos listas que se comparan
  // tienen que estar expresadas en la misma unidad, y eso no se deduce leyendo, se mide.
  const huerfanas = sinRegistro.map((t) => t.zip_relativo_al_repo ?? t.zip);

  const problemasDeBiyeccion = [];
  if (declarados !== null && declarados.length === 0) problemasDeBiyeccion.push('REGISTRO_VACIO');
  else if (declarados !== null && conTrazaDeclarada.length === 0)
    problemasDeBiyeccion.push('REGISTRO_SIN_NINGUNA_TRAZA_DECLARADA');
  if (duplicados.length > 0) problemasDeBiyeccion.push('PATHS_DUPLICADOS_EN_EL_REGISTRO');
  if (faltantes.length > 0) problemasDeBiyeccion.push('TESTS_CON_TRAZA_DECLARADA_QUE_NO_ESTA');
  if (huerfanas.length > 0) problemasDeBiyeccion.push('TRAZAS_HUERFANAS_SIN_TEST');
  if (nulosSinJustificar.length > 0) problemasDeBiyeccion.push('TRAZA_NULA_SIN_ESTADO_DE_SALTEO');
  if (estadosDeFormaInesperada.length > 0) problemasDeBiyeccion.push('TRACE_PATH_DE_FORMA_INESPERADA');

  /**
   * 🔴 «No se pidió la unión» y «se pidió y no cierra» son DISTINTAS, y confundirlas rompe en
   * las dos direcciones. Como acusación: el extractor corrido a mano sobre un directorio,
   * sin registro, saldría `NO_BIYECTIVA` — un defecto inventado. Como permiso: si
   * `NO_SOLICITADA` bastara para seguir, bastaría con no pasar el registro para saltearse la
   * comprobación entera.
   *
   * Se resuelve donde corresponde: acá se DECLARA cuál de las dos es, y `gate-origen.mjs`
   * —que es quien acredita— aborta con exit 7 si el reporter no dejó `tests`. La compuerta
   * vive en el que afirma, no en el que mide.
   */
  const biyeccion = {
    estado:
      declarados === null ? 'NO_SOLICITADA' : problemasDeBiyeccion.length === 0 ? 'BIYECTIVA' : 'NO_BIYECTIVA',
    problemas: problemasDeBiyeccion,
    cardinalidad: {
      zips_en_el_directorio: zipsRelativos.size,
      zips_hallados_sin_deduplicar: zips.length,
      tests_en_el_registro: declarados === null ? null : declarados.length,
      tests_con_traza_declarada: conTrazaDeclarada.length,
      tests_sin_traza_declarada: declarados === null ? null : declarados.length - conTrazaDeclarada.length,
      paths_declarados_distintos: vistos.size,
    },
    duplicados_en_el_registro: duplicados,
    tests_con_traza_faltante: faltantes,
    trazas_huerfanas: huerfanas,
    /** Ítem 5: ids de tests que declararon traza nula sin un estado de salteo que lo explique. */
    nulos_sin_estado_de_salteo: nulosSinJustificar,
    /** Ítem 5: `trace_path_relativo` que no es ni string usable ni nulo explícito. */
    trace_path_de_forma_inesperada: estadosDeFormaInesperada,
    estados_que_justifican_nulo: ESTADOS_QUE_JUSTIFICAN_NULO,
  };

  /**
   * El orden importa y es deliberado: primero «no pude leer», después «no pude ver»,
   * después «vi algo malo», y sólo al final «está limpio». Cada escalón de abajo es una
   * afirmación más fuerte que el de arriba, y ninguno se alcanza saltando los previos.
   */
  let veredicto;
  if (zips.length === 0) veredicto = VEREDICTOS.SIN_TRACES;
  else if (conPareoRoto.length > 0) veredicto = VEREDICTOS.PAREO_ROTO;
  else if (conIlegibles.length > 0) veredicto = VEREDICTOS.NO_VERIFICABLE;
  else if (global.urls_no_parseables.length > 0) veredicto = VEREDICTOS.NO_VERIFICABLE;
  else if (sinRegistro.length > 0) veredicto = VEREDICTOS.SIN_REGISTRO;
  else if (biyeccion.estado === 'NO_BIYECTIVA') veredicto = VEREDICTOS.BIYECCION_ROTA;
  else if (urlsGlobales.length === 0) veredicto = VEREDICTOS.SIN_URLS;
  else if (!global.control_positivo_ok) veredicto = VEREDICTOS.SIN_CONTROL;
  else if (conExternos.length > 0) veredicto = VEREDICTOS.EXTERNOS;
  else if (sinNetworkEnZip.length > 0) veredicto = VEREDICTOS.SIN_NETWORK_EN_ZIP;
  else if (sinNavegadorNoDeclaradas.length > 0) veredicto = VEREDICTOS.SIN_NAVEGADOR_NO_DECLARADO;
  else if (sinRed.length > 0) veredicto = VEREDICTOS.TRAZAS_SIN_RED;
  else veredicto = VEREDICTOS.LIMPIO;

  return {
    instrumento: 'scripts/extraer-origenes.mjs',
    acredita: 'TRAFICO_OBSERVADO_POR_EL_NAVEGADOR_SEGUN_LA_ENTRADA_DE_RED_DEL_TRACE',
    no_acredita: 'CONFIGURACION — para el baseURL efectivo ver el reporter e2e/_reporter-origen.ts',
    medido_utc: new Date().toISOString(),
    // 🔴 Ni la ruta analizada ni el origen esperado viajan crudos · ítem 6. Una ruta absoluta
    // publica usuario, forma del disco y nombre del proyecto; el origen esperado es un valor
    // de configuración y pasa por la misma política que el censo.
    directorio_analizado: rutaPublicable(dir, raizDelRepo).publicado,
    origen_esperado_control_positivo: origenPublicable(origenEsperado).publicado,
    veredicto,
    control_positivo_ok: global.control_positivo_ok,
    origenes: global.origenes,
    origenes_no_loopback: global.origenes_no_loopback,
    esquemas_sin_red: global.esquemas_sin_red,
    urls_no_parseables: global.urls_no_parseables,
    totales: {
      traces_hallados: zips.length,
      traces_con_entrada_de_red: trazas.filter((t) => t.entradas_de_red.length > 0).length,
      traces_ok: trazas.filter((t) => t.veredicto === VEREDICTOS_DE_TRAZA.OK).length,
      traces_sin_red: sinRed.length,
      traces_sin_navegador: sinNavegador.length,
      traces_sin_registro_en_el_reporter: sinRegistro.length,
      traces_sin_navegador_no_declaradas: sinNavegadorNoDeclaradas.length,
      traces_sin_network_en_zip: sinNetworkEnZip.length,
      traces_con_linea_ilegible: conIlegibles.length,
      traces_con_pareo_roto: conPareoRoto.length,
      traces_con_origen_externo: conExternos.length,
      urls_extraidas: urlsGlobales.length,
      origenes_distintos: global.origenes.length,
      origenes_externos: global.origenes_no_loopback.length,
      urls_no_parseables: global.urls_no_parseables.length,
    },
    trazas_sin_red_observable: sinRed.map((t) => t.zip),
    trazas_sin_navegador: sinNavegador.map((t) => t.zip),
    trazas_sin_registro: sinRegistro.map((t) => t.zip),
    union_por_identidad: porPath.size === 0 ? 'NO_SOLICITADA' : 'EXACTA_POR_PATH_DEL_ATTACHMENT',
    biyeccion,
    trazas_sin_network_en_zip: sinNetworkEnZip.map((t) => t.zip),
    trazas_con_linea_ilegible: conIlegibles.map((t) => t.zip),
    trazas_con_pareo_roto: conPareoRoto.map((t) => t.zip),
    detalle_por_trace: trazas,
  };
}

const invocadoDirectamente = process.argv[1] && process.argv[1].endsWith('extraer-origenes.mjs');
if (invocadoDirectamente) {
  const [dir, origenEsperado, salida, registroPath] = process.argv.slice(2);
  if (!dir || !origenEsperado) {
    process.stderr.write('uso: node scripts/extraer-origenes.mjs <dir-de-traces> <origen-esperado> [salida.json]\n');
    process.exit(2);
  }
  let registro = null;
  if (registroPath) {
    const { readFileSync } = await import('node:fs');
    registro = JSON.parse(readFileSync(registroPath, 'utf8')).tests ?? null;
  }
  const informe = await extraerDeDirectorio(dir, origenEsperado, registro);
  if (salida) writeFileSync(salida, `${JSON.stringify(informe, null, 2)}\n`, 'utf8');
  process.stdout.write(`veredicto: ${informe.veredicto}\n`);
  const t = informe.totales;
  process.stdout.write(
    `traces ${t.traces_hallados} (ok ${t.traces_ok} · sin navegador ${t.traces_sin_navegador} · sin network ${t.traces_sin_network_en_zip} · sin red ${t.traces_sin_red} · ilegibles ${t.traces_con_linea_ilegible} · pareo roto ${t.traces_con_pareo_roto} · con externo ${t.traces_con_origen_externo}) · urls ${t.urls_extraidas} · origenes ${t.origenes_distintos}\n`,
  );
  for (const o of informe.origenes) {
    process.stdout.write(`  ${o.loopback ? 'loopback' : 'EXTERNO '} ${o.origen} x${o.requests}\n`);
  }
  for (const z of informe.trazas_sin_red_observable) process.stdout.write(`  SIN RED OBSERVABLE: ${z}\n`);
  for (const z of informe.trazas_sin_navegador) process.stdout.write(`  SIN NAVEGADOR (no declarada): ${z}\n`);
  for (const z of informe.trazas_sin_registro ?? []) process.stdout.write(`  SIN REGISTRO EN EL REPORTER: ${z}\n`);
  for (const z of informe.trazas_sin_network_en_zip) process.stdout.write(`  SIN NETWORK EN EL ZIP: ${z}\n`);
  for (const z of informe.trazas_con_linea_ilegible) process.stdout.write(`  LINEA ILEGIBLE: ${z}\n`);
  for (const z of informe.trazas_con_pareo_roto) process.stdout.write(`  PAREO ORDINAL ROTO: ${z}\n`);
  process.exit(informe.veredicto === VEREDICTOS.LIMPIO ? 0 : 1);
}
