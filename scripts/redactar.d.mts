/**
 * Tipos de `redactar.mjs` — el ÚNICO criterio de publicación de la evidencia de origen.
 *
 * Lo importan `e2e/_reporter-origen.ts` (TypeScript) y `scripts/extraer-origenes.mjs`. Los
 * tipos se declaran acá en vez de usar `as any`, que el gobierno del repo prohíbe — misma
 * convención que `anclar-local.d.mts` y `leer-zip.d.mts`.
 */

export const HOSTS_LOOPBACK: readonly string[];
export const TERCEROS_CONOCIDOS: readonly string[];
export const EJECUTABLES_PUBLICABLES: readonly string[];
export const REDACTADO: 'REDACTADO';
export const EXTERNO_NO_ALLOWLISTADO: 'EXTERNO_NO_ALLOWLISTADO';
export const RUTA_FUERA_DEL_ARBOL: 'RUTA_FUERA_DEL_ARBOL';

/**
 * sha256 de una ESTRUCTURA ya sanitizada. **Nunca de un valor crudo**: un sha256 no se
 * revierte, pero un secreto de baja entropía se recupera por diccionario contra el hash, así
 * que publicar el hash del crudo es publicar un oráculo del crudo. Dos valores con la misma
 * forma comparten huella **a propósito**.
 */
export function huellaDeEstructura(partes: readonly string[]): string;

export function esLoopback(host: string): boolean;
export function terceroDeclarado(host: string): string | undefined;

/** Re-exportado de `anclar-local.mjs`: el límite canónico `'..'` / `'..' + sep` / absoluta. */
export function relativoEscapa(rel: string): boolean;

/**
 * 🔴 **FUENTE DE VERDAD DE ESTA UNIÓN.** `extraer-origenes.d.mts` la re-exporta desde acá en
 * vez de escribirla de nuevo: la tuvo duplicada y **divergió** —quedó en tres miembros contra
 * cinco— sin que nada se pusiera rojo, porque ningún test tipa contra ella.
 *
 * ⚠️ `NO_ESPECIFICADA` faltaba. La emite `origenPublicable` desde que `0.0.0.0` dejó de contar
 * como loopback (AF-1), y esta declaración se quedó en la versión anterior. Lo encontró la
 * auditoría independiente de Qwen (P2-04 → OBS-AF-01), no el typecheck: un tipo que nadie
 * ejercita no falla el día que se rompe, falla el día que alguien lo usa.
 *
 * 📌 **Y la otra taxonomía NO entra acá**: `RutaPublicable.clase` —`RELATIVA_AL_ARBOL`,
 * `FUERA_DEL_ARBOL`, `SIN_RAIZ`— clasifica RUTAS, no orígenes. Comparten el nombre del campo y
 * no el significado; meterlas en esta unión habría «arreglado» el hallazgo ampliando el tipo
 * equivocado. `scripts/clase-de-origen-union.test.ts` fija la correspondencia contra el módulo.
 */
export type ClaseDeOrigen =
  | 'LOOPBACK'
  | 'EXTERNO_ALLOWLISTADO'
  | 'EXTERNO_NO_ALLOWLISTADO'
  | 'NO_ESPECIFICADA'
  | 'NO_PARSEABLE'
  | 'AUSENTE';

export interface OrigenPublicable {
  /** Loopback: literal. Tercero declarado: su eTLD+1 sin subdominio. Resto: la constante. */
  readonly publicado: string;
  readonly clase: ClaseDeOrigen;
  readonly tercero?: string;
  readonly esquema?: string;
  readonly largo_del_host?: number;
  readonly largo?: number;
}

/** Una sola política de origen para configuración y censo. Ver el encabezado del módulo. */
export function origenPublicable(origen: string | undefined): OrigenPublicable;

export interface UrlPublicable {
  readonly origen: string;
  readonly estado: 'OK' | 'AUSENTE' | 'NO_VERIFICABLE';
  readonly clase: ClaseDeOrigen;
  readonly tercero?: string;
  readonly esquema?: string;
  readonly largo_del_host?: number;
  /** Las banderas dicen que HABÍA query, nunca cuál. No filtran. */
  readonly tiene_userinfo: boolean;
  readonly tiene_path: boolean;
  readonly tiene_query: boolean;
  readonly tiene_fragmento: boolean;
  readonly sha256_de_la_estructura: string;
}

export function urlPublicable(valor: string | undefined): UrlPublicable;

export interface RutaPublicable {
  /** Relativa a la raíz, o una constante. **Jamás una ruta absoluta.** */
  readonly publicado: string;
  readonly clase: 'RELATIVA_AL_ARBOL' | 'FUERA_DEL_ARBOL' | 'SIN_RAIZ' | 'AUSENTE';
}

/**
 * Publica una ruta relativa a `raiz`. El rechazo de absolutas es **uniforme**: caiga adentro
 * o afuera, no se publica `/Users/<alguien>/…`, que filtra usuario, disco y proyecto. El
 * containment lo decide `rutaContenida` de `anclar-local.mjs`; acá no se reimplementa.
 */
export function rutaPublicable(ruta: string | undefined, raiz: string | undefined): RutaPublicable;

export interface ComandoPublicable {
  /** Basename si está en la allowlist; `REDACTADO` o `AUSENTE` si no. Nunca la línea. */
  readonly ejecutable: string;
  readonly motivo_de_la_redaccion?:
    | 'PRIMER_TOKEN_ES_ASIGNACION_INLINE'
    | 'PRIMER_TOKEN_ES_URI'
    | 'EJECUTABLE_FUERA_DE_LA_ALLOWLIST';
  readonly clase?: 'AUSENTE';
  readonly cantidad_de_tokens?: number;
  readonly sha256_de_la_estructura?: string;
}

/**
 * Publica sólo el ejecutable. `TOKEN=x cmd` es una asignación inline válida del shell y una
 * URI trae credenciales en el userinfo: ninguna «parece» un ejecutable, y las dos se redactan.
 */
export function comandoPublicable(linea: string | undefined): ComandoPublicable;
