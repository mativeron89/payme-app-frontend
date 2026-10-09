import type { EstadoCapacidadViajes } from '../../api/viajes';
import { replaceRoute, type PageId } from '../../router';

/**
 * AF-VIAJES · sin la capacidad `features.viajes`, las rutas de Viajes no existen:
 * vuelven a Inicio sin dejar entrada en el historial (`replaceRoute`, igual que
 * las del riel wallet en `walletRouteGuard.ts`, y por lo mismo: una ruta a la
 * que no se puede entrar tampoco se puede volver).
 *
 * Mientras la capacidad está `pendiente` no se redirige: entrar directo a
 * `/viaje/…` no puede expulsar a Inicio por llegar antes que la config. La
 * pantalla tampoco se monta (`App.tsx` deja el lugar vacío un instante).
 *
 * Es un módulo y no dos líneas en el efecto de `App.tsx` para que un test pueda
 * verlo ejecutarse (sin librería de render los efectos no corren en la suite).
 */
export const PAGINAS_DE_VIAJES: ReadonlySet<PageId> = new Set<PageId>([
  'viajes', 'viaje-nuevo', 'viaje', 'viaje-ticket-nuevo', 'viaje-ticket', 'viaje-balance', 'viaje-cerrado', 'viaje-gasto',
]);

export function esPaginaDeViajes(page: PageId): boolean {
  return PAGINAS_DE_VIAJES.has(page);
}

export function enforceViajesRouteGuard(capacidad: EstadoCapacidadViajes, page: PageId): boolean {
  const bloqueada = capacidad === 'apagada' && esPaginaDeViajes(page);
  if (bloqueada) replaceRoute('home');
  return bloqueada;
}
