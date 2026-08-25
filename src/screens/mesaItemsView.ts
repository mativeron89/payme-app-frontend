import type { MesaDetail } from '../api/types';
import { fractionAmount } from '../utils/money';

/**
 * Lógica PURA de la selección de ítems de una mesa — SPEC_APP.md §1.5.
 *
 * Sale de `MesaScreen.tsx` sin un cambio de comportamiento: son las mismas
 * funciones y las mismas cuentas, movidas. Estaban declaradas adentro del
 * componente, así que se recreaban en cada render y **no había forma de
 * ejercitarlas** sin montar una pantalla de 1900 líneas que mueve dinero.
 *
 * Nada de acá toca red, estado ni React. `MesaScreen` sigue siendo el dueño de
 * la selección y del pago; este módulo sólo responde preguntas sobre ellos.
 */

/** Valores del contrato (`schemas.lockItems` del espejo). No inventar otros. */
export const FRACTIONS: ReadonlyArray<{ bps: number; label: string }> = [
  { bps: 10000, label: '1' },
  { bps: 7500, label: '¾' },
  { bps: 6667, label: '⅔' },
  { bps: 5000, label: '½' },
  { bps: 3333, label: '⅓' },
  { bps: 2500, label: '¼' },
];

/**
 * ORDEN 1A.3 · `remaining_bps` ES DATO DEL CONTRATO Y SE VALIDA COMO TAL.
 *
 * `GET /mesas/:code` no pasa por ningún decoder: la respuesta se castea a
 * `MesaDetailResponse` y las pantallas leen el campo como si fuera número.
 * Con `undefined`, las dos comparaciones de `rowStateOf` daban `false`
 * (`undefined <= 0` y `undefined > 0`), así que un ítem 100 % tomado por otro
 * se pintaba DISPONIBLE — sin candado, sin "Lo eligió otro" y con el precio
 * entero. La persona tocaba el plato de otro y el `POST /items/lock` rebotaba:
 * el backend salva la plata, pero la pantalla ya invitó a un camino muerto.
 *
 * 🔴 Y el default fabricado era el MÁXIMO: `item?.remaining_bps ?? 10000` más
 * `FRACTIONS.find(...)?.bps ?? 10000` preseleccionaban **el plato entero** —
 * la opción más cara y la que más consume del ítem— cuando el dato faltaba.
 * Es la lección de `tipSelectorView` ("el sistema elegía por la persona, y
 * elegía con su plata") en otra pantalla: ante la duda no se elige el máximo,
 * no se elige nada.
 *
 * Válido = entero entre 0 y 10000 inclusive. Cualquier otra cosa —ausente,
 * `null`, string, `NaN`, negativo, > 10000, fraccionario— es respuesta
 * inválida, y el ítem queda NO SELECCIONABLE. Esto es contrato y UX: no
 * inventa ni mueve un centavo.
 */
export function bpsValido(valor: unknown): valor is number {
  return typeof valor === 'number' && Number.isInteger(valor) && valor >= 0 && valor <= 10000;
}

/**
 * La fracción con la que se PRESELECCIONA un ítem recién tildado: la mayor que
 * entra en lo que queda. `null` cuando el dato no es válido o cuando no entra
 * ninguna — y `null` significa "no se selecciona", nunca "tomá el entero".
 */
export function fraccionInicial(remainingBps: unknown): number | null {
  if (!bpsValido(remainingBps)) return null;
  return FRACTIONS.find((f) => f.bps <= remainingBps)?.bps ?? null;
}

export function bpsLabel(bps: number): string {
  if (bps >= 10000) return 'entero';
  if (bps === 5000) return '½';
  if (bps === 6667 || bps === 6666) return '⅔';
  if (bps === 3333 || bps === 3334) return '⅓';
  if (bps === 7500) return '¾';
  if (bps === 2500) return '¼';
  return `${Math.round(bps / 100)}%`;
}

/**
 * Preview del monto de MI fracción. La fracción COMPLETADORA —la que cierra el
 * ítem— la ajusta el servidor: acá se aproxima con el nominal de lo tomado, y
 * por eso el comprobante usa el `gross_amount_cents` del backend y no esto.
 */
export function fractionPreview(priceCents: number, bps: number, remainingBps: number): number {
  if (bps >= remainingBps) {
    return Math.max(0, priceCents - fractionAmount(priceCents, 10000 - remainingBps));
  }
  return fractionAmount(priceCents, bps);
}

/**
 * Lo que voy a pagar de ítems, sin propina.
 *
 * En división IGUAL no depende de la selección: es el monto del primer
 * casillero libre. Marcar consumos ahí es información para el restaurante y no
 * mueve un centavo (pedido explícito de Mati).
 */
export function itemsAmountFor(mesa: MesaDetail | null, selected: Map<string, number>): number {
  if (!mesa) return 0;
  if (mesa.division_mode === 'igual') {
    return mesa.division_slots?.find((s) => s.status === 'available')?.amount_cents ?? 0;
  }
  return mesa.items
    .filter((i) => selected.has(i.id))
    .reduce(
      (s, i) => s + fractionPreview(i.price_cents * i.quantity, selected.get(i.id) ?? 10000, i.remaining_bps),
      0,
    );
}

/**
 * No queda NADA seleccionable: sin esto la pantalla seguía diciendo "elegí tus
 * consumos" sobre una lista donde ya no había nada elegible.
 *
 * Un ítem `locked` que es MÍO no cuenta como tomado — es justamente lo que
 * estoy por pagar.
 */
export function nothingLeftFor(mesa: MesaDetail): boolean {
  return (
    mesa.division_mode === 'consumo' &&
    mesa.items.length > 0 &&
    mesa.items.every((i) => i.status === 'paid' || (i.status === 'locked' && !i.locked_by_me))
  );
}

export function availableSlotsOf(mesa: MesaDetail): number {
  return mesa.division_slots?.filter((s) => s.status === 'available').length ?? 0;
}

/**
 * §1.5 · el countdown se pinta en `--brand-ink` cuando falta menos de UNA hora.
 *
 * Recibe la salida de `countdownTo`, que es `"MM:SS"` con los minutos SIN topar
 * en 60 —una mesa de 90 minutos da `"90:00"`—, así que la pregunta se responde
 * leyendo los minutos. `null` es "ya venció": urgente no aplica, porque no
 * queda nada que apurar.
 */
export function countdownIsUrgent(countdown: string | null): boolean {
  if (!countdown) return false;
  const minutes = Number(countdown.split(':')[0]);
  return Number.isFinite(minutes) && minutes < 60;
}
