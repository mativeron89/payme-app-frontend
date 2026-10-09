import type { Idioma } from '../../i18n/idioma';
import type { ResumenDeViaje, ViajeEnLista } from '../../api/viajes';
import { rangoDeFechas, type T } from './viajesView';

/**
 * AF-VIAJES · lo puro de Abiertos / Cerrados (1c, 1r) y del detalle cerrado
 * (1s). Sin React ni red. El front no calcula balances ni consumos: elige la
 * frase y el tono según lo que publica el dueño, y arma las líneas.
 */

/** «1 persona» / «4 personas» (claves de `en.ts`). */
export function textoDePersonas(n: number, t: T): string {
  return n === 1 ? t('1 persona') : t('{0} personas', n);
}

/**
 * «5–11 oct · 4 personas». Las fechas son opcionales (D242-5): sin ninguna,
 * sólo las personas. El separador es un símbolo, igual en los dos idiomas.
 */
export function lineaDelViaje(
  v: { readonly fecha_desde: string | null; readonly fecha_hasta: string | null; readonly personas: number },
  idioma: Idioma,
  t: T,
): string {
  const fechas = rangoDeFechas(v.fecha_desde, v.fecha_hasta, idioma);
  const personas = textoDePersonas(v.personas, t);
  return fechas ? `${fechas} · ${personas}` : personas;
}

/** Qué dice la tarjeta de un viaje abierto (1c), a la derecha del nombre. */
export type EtiquetaDeViaje =
  | { readonly tipo: 'esperando'; readonly faltan: number }
  | { readonly tipo: 'balance'; readonly cents: number }
  | { readonly tipo: 'ninguna' };

/**
 * Esperando pagos manda sobre el balance: el viaje ya se cerró y lo que importa
 * es cuántas transferencias faltan (`transferencias_pendientes`, del dueño).
 */
export function etiquetaDelViaje(v: ViajeEnLista): EtiquetaDeViaje {
  if (v.estado === 'esperando_pagos') return { tipo: 'esperando', faltan: v.transferencias_pendientes ?? 0 };
  if (v.mi_balance_cents !== null) return { tipo: 'balance', cents: v.mi_balance_cents };
  return { tipo: 'ninguna' };
}

/** El tono del chip del balance propio. Positivo = te deben (contrato). El texto lo dice siempre: el color sólo acompaña. */
export function tonoDeBalance(cents: number): 'debes' | 'te-deben' | 'a-mano' {
  if (cents < 0) return 'debes';
  if (cents > 0) return 'te-deben';
  return 'a-mano';
}

/**
 * El año con que se agrupa un viaje cerrado (1r): el de `fecha_desde` y, sin
 * fechas, el de `terminado_en`. Es el mismo criterio con que el dueño los
 * ordena (`fecha_desde || terminado_en`, descendente). `terminado_en` es un
 * instante en UTC: se toma su año impreso, como hace el dueño al ordenar.
 */
export function anioDelViaje(v: Pick<ViajeEnLista, 'fecha_desde' | 'terminado_en'>): string | null {
  const fecha = v.fecha_desde ?? v.terminado_en;
  const m = fecha ? /^(\d{4})-/.exec(fecha) : null;
  return m ? m[1]! : null;
}

export interface GrupoPorAnio {
  readonly anio: string | null;
  readonly viajes: readonly ViajeEnLista[];
}

/**
 * Agrupa por año **en el orden en que llegan** (no reordena nada): un rótulo
 * nuevo cada vez que cambia el año. Con el orden del dueño, cada año queda en
 * un solo grupo. Un viaje sin año va en un grupo sin rótulo.
 */
export function agruparPorAnio(viajes: readonly ViajeEnLista[]): GrupoPorAnio[] {
  const grupos: Array<{ anio: string | null; viajes: ViajeEnLista[] }> = [];
  for (const v of viajes) {
    const anio = anioDelViaje(v);
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.anio === anio) ultimo.viajes.push(v);
    else grupos.push({ anio, viajes: [v] });
  }
  return grupos;
}

/**
 * El largo de la barra de «Por tipo de lugar» (1s), en porcentaje entero de la
 * suma de los montos que publicó el dueño. Es sólo dibujo: el monto va escrito
 * al lado. Nunca pasa de 100 ni es negativo; sin montos, 0.
 */
export function anchoDeBarra(monto: number, porTipo: ResumenDeViaje['por_tipo_de_lugar']): number {
  const suma = porTipo.reduce((s, p) => s + p.monto_cents, 0);
  if (suma <= 0 || monto <= 0) return 0;
  return Math.min(100, Math.round((monto * 100) / suma));
}
