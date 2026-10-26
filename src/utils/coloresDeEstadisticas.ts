import type { ClaveMomento } from '../api/momentos';
import type { ClaveGrupo } from '../api/ingredientes';

/**
 * D479/D482 · AF-1 · los colores de «Mis estadísticas», FIJOS por clave (paquete
 * de Claude Design 0.261, LEEME §5). Antes eran por posición (`colorDeFila(i)`,
 * `colorEnPaleta(i, …)`): la misma cocina cambiaba de color según el orden en
 * cada pantalla. Ahora la Italiana es la misma en la principal, en Tus
 * restaurantes y en Evolución.
 *
 * El color nunca va solo: cada pantalla escribe el nombre al lado.
 */

/** Cocinas. Una cocina que el front no conoce toma el color de Otros. */
export const COLORES_DE_COCINA = {
  italian: '#12A5B4',
  japanese: '#101E3B',
  mexican: '#0A7B80',
  cafe: '#475569',
  other: '#7D8CA1',
} as const;

/** Grupos de ingrediente principal (`/stats/ingredients`). */
export const COLORES_DE_GRUPO: Readonly<Record<ClaveGrupo, string>> = {
  meat: '#B4462F',
  seafood: '#12A5B4',
  pasta: '#92620A',
  veggie: '#047857',
  dessert: '#0A6C85',
  drinks: '#0A7B80',
  alcohol: '#101E3B',
  other: '#7D8CA1',
};

/** Momentos del día (`/stats/dayparts`). */
export const COLORES_DE_MOMENTO: Readonly<Record<ClaveMomento, string>> = {
  breakfast: '#92620A',
  lunch: '#12A5B4',
  afternoon: '#C2410C',
  dinner: '#101E3B',
};

function propia<T extends object>(mapa: T, clave: string): clave is Extract<keyof T, string> {
  return Object.prototype.hasOwnProperty.call(mapa, clave);
}

export function colorDeCocina(category: string | null | undefined): string {
  return category && propia(COLORES_DE_COCINA, category) ? COLORES_DE_COCINA[category] : COLORES_DE_COCINA.other;
}

export function colorDeGrupo(key: string): string {
  return propia(COLORES_DE_GRUPO, key) ? COLORES_DE_GRUPO[key] : COLORES_DE_GRUPO.other;
}

export function colorDeMomento(key: string): string {
  return propia(COLORES_DE_MOMENTO, key) ? COLORES_DE_MOMENTO[key] : COLORES_DE_COCINA.other;
}
