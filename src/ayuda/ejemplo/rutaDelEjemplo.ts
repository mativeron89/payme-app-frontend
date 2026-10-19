import { replaceRoute, type PageId } from '../../router';
import { esCodigoDeEjemplo } from './fixtureEjemplo';

/**
 * D363 · D367 · `#/mesa/PA-1224` sin el ejemplo activo (una recarga, el
 * historial, un link copiado) no monta nada y vuelve a Inicio, sin pedir nada.
 * Plan técnico §4.4: un guard como los del riel saldo (`walletRouteGuard.ts`).
 *
 * Es un módulo y no dos líneas dentro del efecto de `App.tsx` por lo mismo que
 * aquel: sin librería de render un efecto no corre en la suite, y una
 * redirección que ningún test ve ejecutarse no protege nada. La fachada envuelta
 * ya rechaza `PA-1224` sin salir a la red; esto evita además la pantalla de
 * «mesa no encontrada» y que la ruta quede en el historial.
 */
export function esRutaDelEjemploSinEjemplo(page: PageId, param: string | null, ejemploActivo: boolean): boolean {
  return page === 'mesa' && !ejemploActivo && esCodigoDeEjemplo(param);
}

export function enforceRutaDelEjemplo(page: PageId, param: string | null, ejemploActivo: boolean): boolean {
  const bloqueada = esRutaDelEjemploSinEjemplo(page, param, ejemploActivo);
  // `replaceRoute` y no `navigate`: una ruta a la que no se puede entrar tampoco se puede volver.
  if (bloqueada) replaceRoute('home');
  return bloqueada;
}
