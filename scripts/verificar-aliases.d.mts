/**
 * Tipos del gate `verificar-aliases.mjs` (P88).
 *
 * El gate es un `.mjs` a propósito —se invoca con `node` desde el workflow, sin
 * pasar por un alias npm—, así que sus tipos se declaran acá en vez de usar
 * `as any` en el test, que el gobierno del repo prohíbe.
 */

/**
 * Fallas de adjudicación de los aliases npm que el CI ejecuta.
 *
 * @param scripts      el mapa `scripts` de `package.json`
 * @param existeConfig predicado de existencia de config versionada (`.npmrc`)
 * @param entorno      variables que podrían cambiar el ejecutor
 */
export function fallasDeAliases(
  scripts: Readonly<Record<string, string>>,
  existeConfig: (archivo: string) => boolean,
  entorno?: Readonly<Record<string, string | undefined>>,
): string[];

/** Archivos que existen en disco y el runner NO recolecta. */
export function faltantesDeColeccion(
  enDisco: readonly string[],
  recolectados: readonly string[],
): string[];

/**
 * Fuentes `.ts/.tsx` que existen en disco y ningún proyecto de `typecheck`
 * compila. Encontrado al enumerar la clase del P88: el alias puede ser el
 * exacto y aun así verificar casi nada, porque la población la decide el
 * `tsconfig`.
 */
export function fuentesSinProyecto(
  enDisco: readonly string[],
  cubiertos: readonly string[],
): string[];
