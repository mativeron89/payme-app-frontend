/**
 * D363 · D367 · el ticket de la mesa de ejemplo del tutorial nuevo.
 *
 * Los datos son los de la ficha de Claude Design (`PANTALLA-tutorial-tu-turno.md`,
 * zip `0d97650b…`): «Restaurante Ejemplo», tres platos de cantidad 1 y $600 de
 * total, mesa `PA-1224`. **Son inventados**: no salen de ninguna cuenta.
 *
 * 🔴 **Nada se apoya en que el código no exista en el servidor.** La fachada
 * envuelta (`apiEjemplo.ts`) y el guard de `App.tsx` comparan contra ESTA
 * constante y rechazan el código sin salir a la red, con el ejemplo apagado o
 * encendido (enmienda 1 de `d363_front`, punto 4). Que el servidor numere con
 * cinco cifras es una INFERENCIA: `joinRequests.ts` (`/^PA-\d{5}$/`) es el
 * decodificador del front, no el generador del dueño, que no está en este repo.
 * El mock numera con cuatro y excluye `PA-1224` (`codigoDeMesaDelMock`,
 * enmienda 6).
 */

export const CODIGO_EJEMPLO = 'PA-1224';

/** ¿Es el código de la mesa de ejemplo? Sin distinguir mayúsculas ni espacios de los bordes. */
export function esCodigoDeEjemplo(code: unknown): boolean {
  return typeof code === 'string' && code.trim().toUpperCase() === CODIGO_EJEMPLO;
}

export interface PlatoDeEjemplo {
  readonly id: string;
  readonly name: string;
  readonly price_cents: number;
}

/**
 * Los ids tienen forma de uuid v4 porque la selección informativa del dueño
 * exige uuid en cada `item_id` (`informativeSelectionResponse`). El prefijo
 * `e0e0e0e0-1224` los hace reconocibles en un volcado.
 */
export const PLATOS_DE_EJEMPLO: readonly PlatoDeEjemplo[] = [
  { id: 'e0e0e0e0-1224-4000-8000-000000000001', name: 'Tagliatelle Bolognese', price_cents: 19500 },
  { id: 'e0e0e0e0-1224-4000-8000-000000000002', name: 'Risotto ai Funghi', price_cents: 22000 },
  { id: 'e0e0e0e0-1224-4000-8000-000000000003', name: 'Pizza Margherita', price_cents: 18500 },
];

/** $600: la suma de los platos, que es también el total impreso del ticket de ejemplo. */
export const TOTAL_DE_EJEMPLO_CENTS = PLATOS_DE_EJEMPLO.reduce((suma, plato) => suma + plato.price_cents, 0);

export const RESTAURANTE_DE_EJEMPLO = {
  id: 'e0e0e0e0-1224-4000-8000-0000000000aa',
  name: 'Restaurante Ejemplo',
  category: 'italian',
  address: null,
} as const;

export const ID_MESA_DE_EJEMPLO = 'e0e0e0e0-1224-4000-8000-0000000000bb';

/** La mesa sin garantía vive cinco horas (C3), como la de verdad. */
export const VIDA_DE_LA_MESA_DE_EJEMPLO_MS = 5 * 60 * 60_000;
