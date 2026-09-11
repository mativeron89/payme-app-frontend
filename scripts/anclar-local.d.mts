/**
 * Tipos de `anclar-local.mjs` — resolución local anclada y containment por `path.relative`.
 *
 * Es un `.mjs` porque lo consumen el gate y la config de Playwright desde `node`, sin pasar
 * por el bundler. Sus tipos se declaran acá en vez de usar `as any` en el test, que el
 * gobierno del repo prohíbe — misma convención que `leer-zip.d.mts` y `extraer-origenes.d.mts`.
 */

/**
 * `realpathSync` que tolera rutas inexistentes: normaliza el ancestro más profundo que
 * exista y reanexa el resto. Hace falta para anclar un directorio antes de crearlo.
 */
export function realpathTolerante(p: string): string;

/**
 * 🔴 ¿Este texto relativo ESCAPA de su raíz? El límite canónico y **único** del repo:
 * `'..'` exacto, `'..'` seguido del separador, o una ruta absoluta.
 *
 * No es `startsWith('..')`. La diferencia no es teórica: un directorio llamado `..foo` es un
 * hijo legítimo y `startsWith` lo declara afuera. Falla del lado cerrado, así que no era un
 * agujero — era **incorrecto**, y un gate que rechaza rutas válidas por una razón inventada
 * es un gate en el que nadie confía la próxima vez que rechaza algo de verdad. Hallado por el
 * CTO en la reauditoría estática de P3.
 *
 * `redactar.mjs` lo **re-exporta** en lugar de redefinirlo: tenerlo dos veces sería cometer
 * el defecto del ítem 12 mientras se lo arregla.
 */
export function relativoEscapa(rel: string): boolean;

/**
 * ¿`candidato` cae dentro de `raiz`? Compara rutas con `path.relative` —nunca `startsWith`,
 * que aprobaría `/repo-malicioso` bajo `/repo`— y normaliza symlinks de AMBOS lados.
 *
 * `permitirIgual` decide si la raíz cuenta como contenida en sí misma. Por defecto `false`:
 * en una guarda de borrado, «el candidato es la raíz entera» es el caso a frenar.
 */
export function rutaContenida(
  raiz: string,
  candidato: string,
  opciones?: { permitirIgual?: boolean },
): boolean;

/** Igual que `rutaContenida` pero lanza `ANCLA_FUERA_DEL_ARBOL`. Devuelve la ruta real. */
export function exigirContenida(
  raiz: string,
  candidato: string,
  queEs: string,
  opciones?: { permitirIgual?: boolean },
): string;

/**
 * Versión que `package-lock.json` declara para el paquete. Lanza —nunca devuelve `null`—
 * ante lock ausente, ilegible, de formato desconocido o sin esa entrada: «no encontré la
 * entrada» y «este lock no es el que sé leer» son afirmaciones distintas.
 */
export function versionEnLock(raiz: string, paquete: string): string;

export interface PaqueteAnclado {
  /** Directorio real del paquete, ya verificado dentro del árbol. */
  readonly dir: string;
  /** Versión de su `package.json` instalado. */
  readonly version: string;
  /** Versión que declara el lock. Iguales por construcción: si difieren, se lanzó. */
  readonly versionEnLock: string;
  readonly packageJson: string;
}

/**
 * Resuelve un paquete dentro de ESTE árbol (`createRequire` contra `desde`) y exige que la
 * versión instalada sea exactamente la del lock.
 *
 * ⚠️ Acredita que el árbol instalado **no derivó del lock**. NO acredita integridad de
 * contenido: para eso haría falta verificar el `integrity` sobre el tarball, que es otra
 * comprobación y no se afirma acá.
 */
export function resolverPaqueteLocal(opciones: {
  raiz: string;
  desde: string;
  paquete: string;
}): PaqueteAnclado;

/** Entrypoint concreto del paquete, anclado por realpath, containment y versión. */
export function entrypointLocal(opciones: {
  raiz: string;
  desde: string;
  paquete: string;
  subruta: string;
}): { ruta: string; version: string };

/**
 * Variables de entorno que `envSaneado` RETIRA: cada una puede inyectar código en el proceso
 * lanzado (`NODE_OPTIONS`, `BASH_ENV`, el transform de Playwright) o redirigir su tráfico
 * (los proxies). Lista cerrada.
 */
export const ENV_RETIRADAS: readonly string[];

/**
 * Variables que NO se retiran y sólo se DECLARAN si están presentes.
 *
 * ⚠️ Limitación declarada, no excepción de conveniencia: retirarlas cambiaría qué navegador o
 * qué caché usa la corrida y **ese cambio no se puede probar** mientras el E2E esté prohibido
 * sin egress-deny previo. Quedan visibles en la evidencia; cerrarlas es de la unidad que
 * pueda correr el E2E.
 */
export const ENV_DECLARADAS: readonly string[];

export interface EnvSaneado {
  /** Copia del entorno sin las variables retiradas. El original no se muta. */
  readonly env: Record<string, string | undefined>;
  /** NOMBRES retirados que estaban presentes. Nunca sus valores: un proxy trae credenciales. */
  readonly retiradas: readonly string[];
  /** NOMBRES de `ENV_DECLARADAS` presentes, para que el auditor las vea. */
  readonly declaradas_presentes: readonly string[];
}

export function envSaneado(entorno: Record<string, string | undefined>): EnvSaneado;

export interface EntradaCensada {
  readonly rel: string;
  readonly bytes: number;
  readonly symlink?: boolean;
}

export interface CensoDeDirectorio {
  readonly existe: boolean;
  readonly cantidad: number;
  readonly bytes: number;
  /** `true` si hay más entradas que el tope: `cantidad` sigue siendo el total real. */
  readonly truncado: boolean;
  readonly archivos: readonly EntradaCensada[];
}

/**
 * Censo recursivo para mirar QUÉ se va a destruir antes de destruirlo. No sigue symlinks: un
 * enlace hacia afuera haría que el censo describa bytes de otro árbol.
 *
 * Existe por INC-08. El orden —limpiar al final— ya estaba arreglado; lo que faltaba es que
 * `rmSync` dejara de borrar **sin mirar**.
 */
export function censarDirectorio(dir: string, opciones?: { tope?: number }): CensoDeDirectorio;
