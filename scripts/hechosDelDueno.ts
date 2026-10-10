import { readFileSync } from 'node:fs';

/**
 * D268 · S-03 · los hechos del dueño, para las pruebas del front.
 *
 * El espejo público ya no copia el código del servidor. Lo que las pruebas
 * leían de él lo genera SÓLO EN LOCAL `generar-hechos-del-dueno.mjs`, con el
 * repo del dueño, y `verificar-mirror.mjs --integridad` (el CI) exige que cada
 * hecho sea de los archivos que declara el inventario.
 */
interface Hechos {
  readonly commit: string;
  readonly fuentes: Readonly<Record<string, string>>;
  readonly hechos: Readonly<Record<string, { readonly origen: string; readonly valor: unknown }>>;
}

export const HECHOS_DEL_DUENO = JSON.parse(
  readFileSync(new URL('./hechos-del-dueno.json', import.meta.url), 'utf8'),
) as Hechos;

/** El valor de un hecho, o un error que dice qué falta: nunca `undefined` que pase en vacío. */
export function hechoDelDueno<T>(clave: string): T {
  const h = HECHOS_DEL_DUENO.hechos[clave];
  if (!h) throw new Error(`no hay hecho del dueño «${clave}»: regenerarlo en local con scripts/generar-hechos-del-dueno.mjs`);
  return h.valor as T;
}
