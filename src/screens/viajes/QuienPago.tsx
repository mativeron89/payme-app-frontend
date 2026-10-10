import { useId } from 'react';
import type { MiembroViaje } from '../../api/viajes';
import { useIdioma } from '../../i18n/idioma';
import { nombreCompleto, type T } from './viajesView';

/**
 * D255-6 · «¿Quién pagó?», en la carga manual y en el ticket escaneado. Mati:
 * «que permita seleccionar quién lo pagó (entonces yo escaneo pero pongo que lo
 * pagó otra persona)». Por defecto, «Lo pagaste tú»; si no, uno de los demás
 * miembros activos (App Backend 2.174.0: `pagado_por`, un miembro activo con la
 * cuenta viva). A quien queda como quien pagó le llega un aviso del dueño.
 */
export interface OpcionDeQuienPago {
  /** `null` = yo. */
  readonly id: string | null;
  readonly nombre: string;
}

export function opcionesDeQuienPago(miembros: readonly MiembroViaje[], t: T): readonly OpcionDeQuienPago[] {
  return [
    { id: null, nombre: t('Lo pagaste tú') },
    ...miembros.filter((m) => !m.es_yo && !m.eliminada).map((m) => ({ id: m.id, nombre: nombreCompleto(m, t) })),
  ];
}

/** Lo elegido, si todavía es uno de los demás miembros activos; si no (salió del viaje), yo. */
export function pagadorVigente(elegido: string | null, miembros: readonly MiembroViaje[]): string | null {
  return elegido !== null && miembros.some((m) => m.id === elegido && !m.es_yo && !m.eliminada) ? elegido : null;
}

/** `pagado_por` va sólo si pagó otro: sin él, el dueño entiende que pagó quien carga. */
export function conQuienPago<P extends object>(pedido: P, pagador: string | null): P & { readonly pagado_por?: string } {
  return pagador === null ? pedido : { ...pedido, pagado_por: pagador };
}

export function SelectorDeQuienPago({ miembros, valor, onCambio, deshabilitado = false }: {
  readonly miembros: readonly MiembroViaje[];
  readonly valor: string | null;
  readonly onCambio: (pagador: string | null) => void;
  readonly deshabilitado?: boolean;
}) {
  const { t } = useIdioma();
  const id = useId();
  const opciones = opcionesDeQuienPago(miembros, t);
  // El rótulo con `htmlFor`, no envolviendo: si envuelve, el nombre accesible suma todas las opciones.
  return (
    <div className="vjm-campo">
      <label className="vjm-rotulo" htmlFor={id}>{t('¿Quién pagó?')}</label>
      <select
        id={id}
        className="vjm-input vjm-select"
        value={pagadorVigente(valor, miembros) ?? ''}
        disabled={deshabilitado}
        onChange={(e) => onCambio(e.target.value === '' ? null : e.target.value)}
      >
        {opciones.map((o) => <option key={o.id ?? ''} value={o.id ?? ''}>{o.nombre}</option>)}
      </select>
    </div>
  );
}
