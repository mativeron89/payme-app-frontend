/**
 * REDACTAR · el ÚNICO criterio de «cómo se publica un valor» en la evidencia de origen.
 *
 * ## Por qué existe como módulo y no como dos funciones parecidas
 *
 * Hasta P3 había **dos** criterios en dos archivos: `e2e/_reporter-origen.ts` redactaba los
 * valores de configuración a su manera y `scripts/extraer-origenes.mjs` los orígenes medidos
 * a la suya. Dos implementaciones de la misma decisión se desalinean calladas, y acá ya pasó
 * en su forma más cara: la regla «no se hashea el crudo» quedó escrita en el reporter y **no
 * aplicada** en el extractor la misma noche, con un test que encima imponía la violación.
 *
 * Una sola implementación, importada por los dos. Si alguien la cambia, cambia para ambos.
 *
 * ## El criterio, y por qué cada rama
 *
 *   · **loopback → literal.** `127.0.0.1`, `localhost` y `::1` son constantes del protocolo,
 *     no datos de nadie. Redactarlas costaría el objeto del instrumento —el gate dejaría de
 *     poder afirmar «sólo loopback»— sin proteger nada.
 *   · **tercero declarado → su eTLD+1 de la allowlist, sin subdominio.** Un tercero que el
 *     repo integra no es un secreto, y taparlo dejaría un hallazgo sin sujeto: «habló con
 *     algo externo» no es accionable.
 *   · **cualquier otro host → seudónimo estructural**, con esquema y largo. El subdominio es
 *     donde viajan tenant, token e id de cuenta.
 *   · **rutas → relativas a la raíz, nunca absolutas.** Una ruta absoluta publica el nombre
 *     de usuario, la forma del disco y a menudo el nombre del proyecto.
 *
 * 🔴 **Y lo que NO se hace, que es una decisión y no un olvido: no se hashea ningún valor
 * crudo.** Una versión anterior guardaba el sha256 del crudo «para comparar sin republicar».
 * Un sha256 no se revierte, pero un secreto de baja entropía se recupera por diccionario
 * contra el hash: eso es publicar un oráculo del secreto. Se hashea la ESTRUCTURA ya
 * sanitizada, y por eso dos valores con la misma forma comparten hash **a propósito**.
 *
 * ⚠️ **Una lectura que tomé y dejo visible para que se pueda corregir.** La adjudicación del
 * 2026-09-11 dice que los valores de CONFIGURACIÓN van «a estructura, sin host», y que el
 * CENSO conserva el loopback literal. Aplicar dos políticas distintas volvería a ser lo que
 * este módulo viene a evitar, y además rompería al gate: `gate-origen.mjs` **deriva** el
 * origen esperado del informe del reporter, así que un `baseURL` redactado a secas dejaría al
 * control positivo sin con qué comparar. Tomo **una** política —la del censo— para los dos
 * lados. Consecuencia que no escondo: si el `baseURL` fuera externo, quedaría seudonimizado y
 * el control positivo **fallaría**. Me parece la conducta correcta —un `baseURL` externo no
 * debería pasar en silencio— pero es un cambio de comportamiento, no sólo de redacción.
 */

import { createHash } from 'node:crypto';
import { relative, resolve } from 'node:path';

import { relativoEscapa, rutaContenida } from './anclar-local.mjs';

/**
 * Se RE-EXPORTA, no se redefine. El límite canónico de containment vive en `anclar-local.mjs`
 * junto al resto de las comparaciones de rutas; tenerlo dos veces sería exactamente el
 * defecto que el ítem 12 señala, cometido mientras se lo arregla.
 */
export { relativoEscapa };

/** Hosts que son constantes del protocolo, no datos. */
export const HOSTS_LOOPBACK = Object.freeze(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * 🔴 `0.0.0.0` ESTABA ACÁ ARRIBA Y SALIÓ · hallazgo P2 de la auditoría, medido el 2026-09-12.
 *
 * La cadena completa era: esta lista → `esLoopback` → `extraer-origenes.mjs` marca
 * `loopback: true` → ese origen no entra en `origenes_no_loopback` → **el veredicto puede
 * salir `LIMPIO` con tráfico a `0.0.0.0` adentro.** El instrumento existe para acreditar que
 * la corrida no habló con afuera, y estaba dando por acreditado un host que nunca midió.
 *
 * ⚠️ El contraargumento, que es real y por eso va escrito: en la práctica, `connect()` a
 * `0.0.0.0` termina en la máquina local en casi todos los stacks, así que sacarlo de loopback
 * parece un falso positivo. **No lo es, y la diferencia está en qué afirma el instrumento.**
 * `0.0.0.0` es la dirección NO ESPECIFICADA —el comodín de «todas las interfaces»—, no una de
 * loopback: cuando aparece como destino, lo que se sabe es que no se sabe. Un gate que
 * certifica «sólo loopback» y mete el comodín en esa bolsa afirma más de lo que midió, y ése
 * es exactamente el defecto que este archivo persigue en todos lados.
 *
 * **Se le da clase propia en vez de retirarlo a secas**, porque los dos consumidores necesitan
 * cosas distintas y hay que preguntarles por separado:
 *   · el VEREDICTO necesita que NO cuente como loopback  → `esLoopback` ya no lo incluye;
 *   · la REDACCIÓN necesita seguir publicando el literal → es una constante del protocolo, no
 *     el dato de nadie. Mandarlo a `EXTERNO_NO_ALLOWLISTADO` escondería CUÁL fue el origen
 *     no-loopback justo en el caso en que alguien va a querer saberlo.
 *
 * La CLASE, no sólo la instancia: en IPv6 la dirección no especificada es `::` (y `[::]` con
 * la forma entre corchetes que usa una URL). Medido: ninguna de las dos estaba en
 * `HOSTS_LOOPBACK`, así que por el lado del veredicto no había hueco que cerrar; entran acá
 * por el lado de la redacción, para que se publiquen literales igual que `0.0.0.0` en vez de
 * quedar seudonimizadas.
 */
const HOSTS_NO_ESPECIFICADOS = Object.freeze(['0.0.0.0', '::', '[::]']);

function esNoEspecificado(host) {
  return HOSTS_NO_ESPECIFICADOS.includes(host);
}

/**
 * Terceros que el repo integra, con el motivo de cada entrada. El match es por **sufijo con
 * frontera de punto** (`host === E` o `host.endsWith('.' + E)`), no por extracción de eTLD+1:
 * sin la Public Suffix List, «las dos últimas etiquetas» se equivoca con `co.uk` y similares.
 * Comparar contra una lista cerrada evita el problema en vez de aproximarlo.
 */
export const TERCEROS_CONOCIDOS = Object.freeze([
  'stripe.com',      // dependencia ratificada: Stripe.js/Elements
  'stripe.network',
  'paymemx.com',     // dominios propios del producto
  'googleapis.com',  // alta con Google, ratificada
  'gstatic.com',
  'google.com',
  'facebook.com',    // alta con Facebook, ratificada (dark hasta aprobación Meta)
  'amazonaws.com',   // OCR AWS Textract, ratificado
  'vercel.app',      // hosting de publicación
  'vercel.com',
]);

export const REDACTADO = 'REDACTADO';
export const EXTERNO_NO_ALLOWLISTADO = 'EXTERNO_NO_ALLOWLISTADO';
export const RUTA_FUERA_DEL_ARBOL = 'RUTA_FUERA_DEL_ARBOL';

/** sha256 de una ESTRUCTURA ya sanitizada. Nunca de un valor crudo. Ver el encabezado. */
export function huellaDeEstructura(partes) {
  return createHash('sha256').update(partes.join('|')).digest('hex');
}

export function esLoopback(host) {
  return HOSTS_LOOPBACK.includes(host);
}

export function terceroDeclarado(host) {
  return TERCEROS_CONOCIDOS.find((e) => host === e || host.endsWith(`.${e}`));
}

/**
 * Cómo se publica un ORIGEN, sea medido o de configuración. Una sola política para los dos.
 *
 * Devuelve siempre `clase`, y el campo crudo **no viaja** cuando la clase no es `LOOPBACK`:
 * un campo bien redactado no sirve si el valor original quedó en el de al lado.
 */
export function origenPublicable(origen) {
  if (typeof origen !== 'string' || origen === '') {
    return { publicado: 'AUSENTE', clase: 'AUSENTE' };
  }
  let u;
  try {
    u = new URL(origen);
  } catch {
    // No se puede decidir si es loopback: se falla del lado que no publica.
    return { publicado: EXTERNO_NO_ALLOWLISTADO, clase: 'NO_PARSEABLE', largo: origen.length };
  }
  const host = u.hostname;
  if (esLoopback(host)) return { publicado: `${u.protocol}//${u.host}`, clase: 'LOOPBACK' };
  // El literal SE PUBLICA —constante del protocolo, no dato de nadie— pero la clase es otra, y
  // `esLoopback` no lo incluye: quien decide el veredicto lo cuenta como NO loopback.
  if (esNoEspecificado(host)) {
    return { publicado: `${u.protocol}//${u.host}`, clase: 'NO_ESPECIFICADA' };
  }
  const tercero = terceroDeclarado(host);
  if (tercero !== undefined) {
    return { publicado: `${u.protocol}//${tercero}`, clase: 'EXTERNO_ALLOWLISTADO', tercero };
  }
  return {
    publicado: EXTERNO_NO_ALLOWLISTADO,
    clase: 'EXTERNO_NO_ALLOWLISTADO',
    esquema: u.protocol,
    largo_del_host: host.length,
  };
}

/**
 * Cómo se publica una URL de CONFIGURACIÓN: el origen por la política de arriba, más las
 * banderas de qué traía. Las banderas no filtran: dicen que había query, no cuál.
 */
export function urlPublicable(valor) {
  if (typeof valor !== 'string' || valor === '') {
    return { origen: 'AUSENTE', estado: 'AUSENTE', clase: 'AUSENTE', tiene_userinfo: false, tiene_path: false, tiene_query: false, tiene_fragmento: false, sha256_de_la_estructura: huellaDeEstructura(['AUSENTE']) };
  }
  let u;
  try {
    u = new URL(valor);
  } catch {
    return {
      origen: REDACTADO,
      estado: 'NO_VERIFICABLE',
      clase: 'NO_PARSEABLE',
      tiene_userinfo: false,
      tiene_path: false,
      tiene_query: false,
      tiene_fragmento: false,
      sha256_de_la_estructura: huellaDeEstructura(['NO_VERIFICABLE', String(valor.length)]),
    };
  }
  const o = origenPublicable(u.origin === 'null' ? `${u.protocol}//${u.host}` : u.origin);
  const banderas = [
    u.username !== '' || u.password !== '',
    u.pathname !== '' && u.pathname !== '/',
    u.search !== '',
    u.hash !== '',
  ];
  return {
    origen: o.publicado,
    estado: 'OK',
    clase: o.clase,
    ...(o.tercero === undefined ? {} : { tercero: o.tercero }),
    ...(o.esquema === undefined ? {} : { esquema: o.esquema }),
    ...(o.largo_del_host === undefined ? {} : { largo_del_host: o.largo_del_host }),
    tiene_userinfo: banderas[0],
    tiene_path: banderas[1],
    tiene_query: banderas[2],
    tiene_fragmento: banderas[3],
    sha256_de_la_estructura: huellaDeEstructura([o.publicado, ...banderas.map(String)]),
  };
}

/**
 * Cómo se publica una RUTA. **Nunca absoluta**, y el rechazo es uniforme: dé lo mismo que la
 * absoluta caiga adentro o afuera del árbol, lo que se publica es la forma relativa o la
 * constante — jamás `/Users/<alguien>/…`, que filtra usuario, disco y proyecto.
 *
 * El containment lo decide `rutaContenida` de `anclar-local.mjs`, que compara RUTAS con
 * `path.relative` sobre `realpath` de los dos lados. Acá no se reimplementa: reimplementarlo
 * es exactamente el ítem 12.
 */
export function rutaPublicable(ruta, raiz) {
  if (typeof ruta !== 'string' || ruta === '') return { publicado: 'AUSENTE', clase: 'AUSENTE' };
  if (typeof raiz !== 'string' || raiz === '') return { publicado: RUTA_FUERA_DEL_ARBOL, clase: 'SIN_RAIZ' };
  if (!rutaContenida(raiz, ruta, { permitirIgual: true })) {
    // No se publica ni el largo del prefijo: un largo de ruta ya insinúa el nombre de usuario.
    return { publicado: RUTA_FUERA_DEL_ARBOL, clase: 'FUERA_DEL_ARBOL' };
  }
  const rel = relative(resolve(raiz), resolve(ruta));
  return { publicado: rel === '' ? '.' : rel, clase: 'RELATIVA_AL_ARBOL' };
}

/** Ejecutables cuyo basename se puede publicar. Fail-closed: lo no declarado se redacta. */
export const EJECUTABLES_PUBLICABLES = Object.freeze(['node', 'npm', 'npx', 'vite', 'playwright', 'sh', 'bash', 'sandbox-exec']);

/**
 * Cómo se publica un COMANDO. Se publica el basename del ejecutable si está declarado, y
 * nada más: ni flags, ni valores, ni la línea.
 *
 * 🔴 Dos formas de colar un secreto en el PRIMER token, y las dos se redactan:
 * `TOKEN=x cmd` es una asignación inline válida del shell, y una URI trae credenciales en el
 * userinfo. Ninguna de las dos «parece» un ejecutable, y por eso hay que nombrarlas.
 */
export function comandoPublicable(linea) {
  if (typeof linea !== 'string' || linea === '') return { ejecutable: 'AUSENTE', clase: 'AUSENTE' };
  const tokens = linea.split(/\s+/).filter((t) => t !== '');
  const primero = tokens[0] ?? '';
  const base = {
    cantidad_de_tokens: tokens.length,
    sha256_de_la_estructura: huellaDeEstructura(['comando', String(tokens.length)]),
  };
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(primero)) {
    return { ejecutable: REDACTADO, motivo_de_la_redaccion: 'PRIMER_TOKEN_ES_ASIGNACION_INLINE', ...base };
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(primero)) {
    return { ejecutable: REDACTADO, motivo_de_la_redaccion: 'PRIMER_TOKEN_ES_URI', ...base };
  }
  const nombre = primero.split('/').pop() ?? '';
  if (!EJECUTABLES_PUBLICABLES.includes(nombre)) {
    return { ejecutable: REDACTADO, motivo_de_la_redaccion: 'EJECUTABLE_FUERA_DE_LA_ALLOWLIST', ...base };
  }
  return { ejecutable: nombre, ...base };
}
