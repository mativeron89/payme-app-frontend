/**
 * D341 · las pantallas avisan a la guía que algo SE GUARDÓ, para que el final
 * aparezca sólo después de un guardado real y nunca por inferir la navegación.
 *
 * Sin red, sin persistencia y sin dependencias: un aviso síncrono en memoria que
 * sólo lleva ids (el código de la mesa, el id del viaje), nunca importes ni datos
 * de personas. Si la guía está cerrada nadie escucha y el aviso se pierde, que
 * es lo correcto. Un oyente que falla no afecta a quien avisa.
 */
export type SenalDeGuia =
  | { readonly tipo: 'mesa-guardada'; readonly mesa: string; readonly cerrada: boolean }
  | { readonly tipo: 'viaje-guardado'; readonly viaje: string };

type Oyente = (senal: SenalDeGuia) => void;
const oyentes = new Set<Oyente>();

export function avisarALaGuia(senal: SenalDeGuia): void {
  for (const oyente of [...oyentes]) {
    try { oyente(senal); } catch { /* la guía nunca altera el guardado */ }
  }
}

export function escucharSenalesDeGuia(oyente: Oyente): () => void {
  oyentes.add(oyente);
  return () => { oyentes.delete(oyente); };
}
