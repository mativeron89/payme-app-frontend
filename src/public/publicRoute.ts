/**
 * APP-FE-META-PUBLIC-COMPLIANCE-01 · qué pathname es una superficie pública.
 *
 * Módulo **puro**: no toca `window`, ni red, ni storage. Recibe un string y
 * devuelve un veredicto. Se separa de `main.tsx` por dos motivos, y el segundo
 * es el que importa:
 *
 *   ① se puede probar sin navegador —esta suite no tiene jsdom, por
 *      ratificación de Mati—; y
 *   ② `main.tsx` tiene que decidir la superficie **antes** de cualquier
 *      bootstrap de sesión, recovery, invitación o callback de Facebook. Un
 *      parser que viviera adentro de `main.tsx` invitaría a resolverlo después,
 *      que es exactamente el STOP que la orden nombra.
 *
 * ## Por qué el código inválido NO cae a la app
 *
 * La tentación era devolver `null` ante un `confirmation_code` mal formado y
 * dejar que montara el shell autenticado. **Sería el peor destino posible**: el
 * código sigue en la URL, y el shell autenticado sí hace requests —config,
 * sesión— cuyo `Referer` arrastraría ese pathname a otro origen. Las cabeceras
 * `Referrer-Policy: no-referrer` de `vercel.json` están puestas sobre estas dos
 * rutas, no sobre la app entera.
 *
 * Por eso **todo** `/facebook-data-deletion/…` es superficie pública, y la
 * validez del código decide sólo si se consulta o no: `code: null` significa
 * «no se pregunta nada» y la página muestra *No encontrada* sin tocar la red.
 *
 * ⚠️ **No encontrada, y no «No verificable».** Un código que no puede existir no
 * es una consulta que falló: no hay nada que reintentar, y ofrecer un retry
 * sería mandar a la persona a golpear una puerta que no existe.
 *
 * ## El pathname NO se decodifica, a propósito
 *
 * Base64URL usa sólo `A-Z a-z 0-9 - _`, que son caracteres sin reservar: un
 * código legítimo llega literal en `location.pathname`. Decodificar sólo
 * agregaría formas equivalentes de escribir lo mismo —`%41` por `A`— y cada
 * forma equivalente es una manera más de que dos capas no coincidan. Un
 * porcentaje simplemente no matchea y cae del lado cerrado.
 */

export type RutaPublica =
  | { readonly tipo: 'privacidad' }
  /** `code: null` ⇒ el path no trae un código consultable. No se hace request. */
  | { readonly tipo: 'eliminacion'; readonly code: string | null };

/** El contrato Meta fija estos dos paths; no hay variantes ni alias. */
export const PATH_PRIVACIDAD = '/privacy';
export const PREFIJO_ELIMINACION = '/facebook-data-deletion/';

const FORMA_BASE64URL = /^[A-Za-z0-9_-]+$/;

/** El alfabeto Base64URL, en orden: el índice de un carácter ES su valor. */
const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * 🔴 CANONICIDAD DE VERDAD: LOS BITS DE RELLENO DEL ÚLTIMO CARÁCTER ESTÁN EN
 * CERO.
 *
 * La versión anterior sólo miraba `length % 4 !== 1`, y **eso no alcanza**. Es
 * cierto que un grupo final de UN carácter es imposible —no sobran 6 bits—,
 * pero los grupos de 2 y de 3 caracteres tienen bits que el codificador emite
 * en cero y que un tercero puede alterar **sin cambiar los bytes decodificados**:
 *
 *     16 bytes → 22 caracteres. El último aporta 6 bits de los que sólo se usan
 *     los 2 más altos: los 4 bajos deben ser 0.
 *     17 bytes → 23 caracteres. El último aporta 6 bits de los que sólo se usan
 *     los 4 más altos: los 2 bajos deben ser 0.
 *
 * O sea que `…AA` y `…AB` decodifican a los MISMOS bytes y sólo uno es la
 * codificación canónica. Aceptar los dos es aceptar dos escrituras del mismo
 * código, que es exactamente la clase de ambigüedad que no debe existir en un
 * identificador que después se compara contra el del emisor.
 *
 * Esto es equivalente a decodificar y volver a codificar, sin traer un
 * decodificador: la única condición que un round-trip agregaría sobre el
 * alfabeto y la longitud **es esta**.
 */
function bitsDeRellenoEnCero(code: string): boolean {
  const resto = code.length % 4;
  // Un grupo final de un solo carácter no lo produce ningún codificador.
  if (resto === 1) return false;
  if (resto === 0) return true;
  const valor = ALFABETO.indexOf(code[code.length - 1]!);
  if (valor < 0) return false;
  return resto === 2 ? (valor & 0b001111) === 0 : (valor & 0b000011) === 0;
}

/** Base64URL **canónico** de 20 a 200 caracteres. El rango sale de la orden. */
export function codigoValido(code: string): boolean {
  return (
    code.length >= 20
    && code.length <= 200
    && FORMA_BASE64URL.test(code)
    && bitsDeRellenoEnCero(code)
  );
}

/**
 * El veredicto para un `location.pathname`. `null` ⇒ no es superficie pública y
 * la app normal sigue su curso.
 */
export function resolverRutaPublica(pathname: string): RutaPublica | null {
  if (pathname === PATH_PRIVACIDAD) return { tipo: 'privacidad' };
  if (!pathname.startsWith(PREFIJO_ELIMINACION)) return null;
  const code = pathname.slice(PREFIJO_ELIMINACION.length);
  return { tipo: 'eliminacion', code: codigoValido(code) ? code : null };
}
