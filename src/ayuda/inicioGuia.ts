import type { PageId } from '../router';

/** Memoria del documento: un refresh de tokens, remount de una puerta o navegación
 * no inicia otra aparición. Una nueva carga o familia de login sí tiene su turno. */
export class EntradasGuia {
  private readonly usadas = new Set<string>();
  usada(entrada: string) { return this.usadas.has(entrada); }
  consumir(entrada: string) { this.usadas.add(entrada); }
}
export const entradasGuia = new EntradasGuia();
export function puedeIniciarGuia(o: { usada: boolean; noMostrar: boolean | null; habilitada: boolean; prioridad: boolean; objetivo: boolean }) {
  return !o.usada && o.noMostrar === false && o.habilitada && !o.prioridad && o.objetivo;
}
/** Selectores descriptivos; jamás se invoca click, cámara ni navegación. */
export function objetivoDeInicio(pagina: PageId): string | null {
  const objetivos: Partial<Record<PageId, string>> = {
    // D341 · arranca en la parte del recorrido donde está la persona: por el link de una mesa, en sus platos.
    home: 'camara', mas: 'nav-home', scan: 'foto,camara-controles,usar-foto,revisar-ticket,reparto',
    mesa: 'consumos,plato,porcion,mi-parte,ver-avisos',
    viaje: 'camara,agregar-gasto,mi-balance', 'viaje-gasto': 'descripcion-gasto', 'viaje-ticket-nuevo': 'quien-pago,reparto',
    'viaje-ticket': 'elegir-consumo,porcion,mi-parte', 'viaje-balance': 'tab-consumos',
  };
  return objetivos[pagina]?.split(',').map((id) => `[data-guia="${id}"]`).join(',') ?? null;
}
