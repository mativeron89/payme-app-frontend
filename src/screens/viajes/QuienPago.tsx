import { useId } from 'react';
import type { MiembroViaje, PagadorPedido } from '../../api/viajes';
import { useIdioma } from '../../i18n/idioma';
import { formatMXN } from '../../utils/format';
import { stringToCents } from '../../utils/money';
import { nombreCompleto, type T } from './viajesView';
import './viaje.css';
import './ticket.css';

/**
 * «¿Quién pagó?», en la carga manual y en el ticket escaneado.
 * - D255-6 · Mati: «que permita seleccionar quién lo pagó (entonces yo escaneo pero pongo que lo pagó otra persona)».
 * - D263 · Mati: «que "quién pagó" permita multisección», con «Partes iguales, y se puede ajustar» y «En los dos».
 *
 * Por defecto, quien carga («Tú»). Se marcan uno o varios miembros activos con la cuenta viva (el último marcado no se
 * desmarca). Con dos o más, cada uno paga su parte igual —el reparto del dueño: el piso y el centavo de más a los
 * primeros, en el orden de la lista— o, con «Ajustar montos», lo que se escribe para cada uno, que tiene que sumar el
 * total. A quien queda como quien pagó le llega un aviso del dueño.
 */
export interface OpcionDeQuienPago {
  readonly id: string;
  readonly nombre: string;
  readonly es_yo: boolean;
}

/** Yo primero («Tú») y los demás miembros activos en su orden, sin una cuenta eliminada. */
export function opcionesDeQuienPago(miembros: readonly MiembroViaje[], t: T): readonly OpcionDeQuienPago[] {
  const vivos = miembros.filter((m) => !m.eliminada);
  return [...vivos.filter((m) => m.es_yo), ...vivos.filter((m) => !m.es_yo)]
    .map((m) => ({ id: m.id, nombre: m.es_yo ? t('Tú') : nombreCompleto(m, t), es_yo: m.es_yo }));
}

/** Lo elegido por quien carga: los marcados (por id de miembro) y, si se ajustó, lo escrito para cada uno. */
export interface QuienPagoElegido {
  /** `null` = lo de siempre: sólo yo. */
  readonly marcados: ReadonlySet<string> | null;
  /** `null` = partes iguales. */
  readonly montos: ReadonlyMap<string, string> | null;
}

export const QUIEN_PAGO_INICIAL: QuienPagoElegido = { marcados: null, montos: null };

/**
 * Los que pagaron, en el orden de la lista: los marcados que siguen siendo opciones. Si ninguno sigue (salieron del
 * viaje), vuelve a lo de siempre: yo.
 */
export function pagadoresVigentes(elegido: QuienPagoElegido, opciones: readonly OpcionDeQuienPago[]): readonly OpcionDeQuienPago[] {
  const marcados = elegido.marcados;
  const vigentes = marcados ? opciones.filter((o) => marcados.has(o.id)) : [];
  return vigentes.length > 0 ? vigentes : opciones.filter((o) => o.es_yo);
}

/** Marca o desmarca a uno. El último marcado no se desmarca. Cambiar quiénes vuelve a partes iguales. */
export function alternarPagador(elegido: QuienPagoElegido, id: string, opciones: readonly OpcionDeQuienPago[]): QuienPagoElegido {
  const actuales = new Set(pagadoresVigentes(elegido, opciones).map((o) => o.id));
  if (actuales.has(id)) {
    if (actuales.size <= 1) return elegido;
    actuales.delete(id);
  } else {
    actuales.add(id);
  }
  return { marcados: actuales, montos: null };
}

/** Partes iguales, como el dueño: a cada uno el piso y el centavo de más a los primeros. */
export function partesIguales(total: number, cuantos: number): number[] {
  const base = Math.floor(total / cuantos);
  const resto = total - base * cuantos;
  return Array.from({ length: cuantos }, (_, i) => base + (i < resto ? 1 : 0));
}

/** Centavos a lo que se escribe en el campo: «333.34», «50». */
export function montoParaEscribir(cents: number): string {
  const pesos = Math.floor(cents / 100);
  const resto = cents % 100;
  return resto === 0 ? String(pesos) : `${pesos}.${String(resto).padStart(2, '0')}`;
}

/** Lo escrito para un pagador, en centavos enteros mayores que cero, o `null`. */
export function montoEscrito(texto: string): number | null {
  const limpio = texto.trim().replace(/[$,\s]/g, '');
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(limpio)) return null;
  try {
    const c = stringToCents(limpio);
    return Number.isSafeInteger(c) && c > 0 ? c : null;
  } catch {
    return null;
  }
}

/** «Ajustar montos»: cada uno empieza con su parte igual. */
export function ajustarMontos(elegido: QuienPagoElegido, opciones: readonly OpcionDeQuienPago[], total: number): QuienPagoElegido {
  const pagadores = pagadoresVigentes(elegido, opciones);
  const partes = partesIguales(total, pagadores.length);
  return { marcados: new Set(pagadores.map((o) => o.id)), montos: new Map(pagadores.map((o, i) => [o.id, montoParaEscribir(partes[i]!)])) };
}

export interface RepartoDeQuienPago {
  readonly pagadores: readonly OpcionDeQuienPago[];
  /** La parte de cada uno, en el orden de `pagadores`; `null` si todavía no se sabe (sin total, o lo escrito no vale). */
  readonly partes: readonly (number | null)[];
  /** Con «Ajustar montos». */
  readonly ajustado: boolean;
  /** Lo que suma lo escrito (`null` si algo no vale). */
  readonly suma: number | null;
  /** Se puede mandar: uno solo, o varios con partes iguales o con montos que suman el total. */
  readonly valido: boolean;
}

export function repartoDeQuienPago(elegido: QuienPagoElegido, opciones: readonly OpcionDeQuienPago[], total: number | null): RepartoDeQuienPago {
  const pagadores = pagadoresVigentes(elegido, opciones);
  const montos = elegido.montos;
  if (pagadores.length < 2 || !montos) {
    const partes = total === null || pagadores.length < 2 ? pagadores.map(() => null) : partesIguales(total, pagadores.length);
    return { pagadores, partes, ajustado: false, suma: null, valido: true };
  }
  const partes = pagadores.map((o) => montoEscrito(montos.get(o.id) ?? ''));
  const suma = partes.every((p) => p !== null) ? partes.reduce<number>((s, p) => s + p!, 0) : null;
  return { pagadores, partes, ajustado: true, suma, valido: total !== null && suma === total };
}

/**
 * El aviso junto al botón que queda apagado (D263: «la suma tiene que dar el total»), o `null` si se puede mandar o
 * si todavía no hay total.
 */
export function avisoDeQuienPago(reparto: RepartoDeQuienPago, total: number | null, t: T): string | null {
  if (reparto.valido || !reparto.ajustado || total === null) return null;
  return reparto.suma === null
    ? t('Escribe cuánto pagó cada uno. Tienen que sumar {0}.', formatMXN(total))
    : t('Los montos tienen que sumar {0}. Ahora suman {1}.', formatMXN(total), formatMXN(reparto.suma));
}

/**
 * El pedido con quién pagó, como lo espera el dueño:
 * - sólo yo: nada (el dueño entiende que pagó quien carga);
 * - otro: `pagado_por`;
 * - varios: `pagadores` en el orden de la lista, con `monto_cents` sólo si se ajustaron.
 */
export function conQuienPago<P extends object>(pedido: P, reparto: RepartoDeQuienPago):
  P & { readonly pagado_por?: string; readonly pagadores?: readonly PagadorPedido[] } {
  const { pagadores, partes, ajustado } = reparto;
  if (pagadores.length === 1) return pagadores[0]!.es_yo ? pedido : { ...pedido, pagado_por: pagadores[0]!.id };
  return {
    ...pedido,
    pagadores: pagadores.map((o, i) => (ajustado ? { miembro_id: o.id, monto_cents: partes[i]! } : { miembro_id: o.id })),
  };
}

export function SelectorDeQuienPago({ opciones, elegido, total, onCambio, deshabilitado = false }: {
  readonly opciones: readonly OpcionDeQuienPago[];
  readonly elegido: QuienPagoElegido;
  /** El total a repartir; `null` mientras no se escribió. */
  readonly total: number | null;
  readonly onCambio: (elegido: QuienPagoElegido) => void;
  readonly deshabilitado?: boolean;
}) {
  const { t } = useIdioma();
  const id = useId();
  const reparto = repartoDeQuienPago(elegido, opciones, total);
  const marcados = new Set(reparto.pagadores.map((o) => o.id));
  const parteDe = new Map(reparto.pagadores.map((o, i) => [o.id, reparto.partes[i]]));
  const varios = reparto.pagadores.length > 1;
  return (
    // El grupo es todo el bloque: las casillas, el reparto, «Ajustar montos» y los montos.
    <div className="vjq" role="group" aria-labelledby={`${id}-rotulo`}>
      <h2 id={`${id}-rotulo`} className="vjm-rotulo">{t('¿Quién pagó?')}</h2>
      <div className="vjt-opciones">
        {opciones.map((o) => {
          const marcado = marcados.has(o.id);
          const ultimo = marcado && marcados.size <= 1;
          const parte = parteDe.get(o.id);
          return (
            <button
              key={o.id}
              type="button"
              role="checkbox"
              aria-checked={marcado}
              aria-disabled={ultimo || undefined}
              disabled={deshabilitado}
              className="vjt-opcion vjq-opcion"
              onClick={() => { if (!ultimo) onCambio(alternarPagador(elegido, o.id, opciones)); }}
            >
              <span className="vjt-radio" aria-hidden="true" />
              <span className="vjt-crece vjt-opcion-titulo">{o.nombre}</span>
              {varios && marcado && !reparto.ajustado && typeof parte === 'number' && (
                <span className="vjq-parte">{formatMXN(parte)}</span>
              )}
            </button>
          );
        })}
      </div>
      {varios && !reparto.ajustado && total !== null && (
        <div className="vjq-pie">
          <p className="vjq-texto">{t('En partes iguales')}</p>
          <button type="button" className="vjq-ajustar" disabled={deshabilitado} onClick={() => onCambio(ajustarMontos(elegido, opciones, total))}>
            {t('Ajustar montos')}
          </button>
        </div>
      )}
      {reparto.ajustado && (
        <div className="vjq-montos">
          {reparto.pagadores.map((o) => (
            <label key={o.id} className="vjq-monto">
              <span className="vjt-crece vjq-monto-nombre">{o.nombre}</span>
              <input
                className="vjm-input vjm-monto vjq-monto-input"
                inputMode="decimal"
                aria-label={o.es_yo ? t('Cuánto pagaste tú') : t('Cuánto pagó {0}', o.nombre)}
                value={elegido.montos?.get(o.id) ?? ''}
                disabled={deshabilitado}
                onChange={(e) => {
                  const montos = new Map(elegido.montos ?? []);
                  montos.set(o.id, e.target.value.replace(/[^0-9.,$]/g, ''));
                  onCambio({ marcados: new Set(marcados), montos });
                }}
              />
            </label>
          ))}
          {/* Lo que suman, mientras se escribe. Si no da el total, el aviso va junto al botón (`avisoDeQuienPago`). */}
          <div className="vjq-pie">
            {reparto.suma !== null && total !== null && (
              <p className="vjq-texto">{t('Suman {0} de {1}', formatMXN(reparto.suma), formatMXN(total))}</p>
            )}
            <button type="button" className="vjq-ajustar" disabled={deshabilitado} onClick={() => onCambio({ marcados: new Set(marcados), montos: null })}>
              {t('Volver a partes iguales')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
