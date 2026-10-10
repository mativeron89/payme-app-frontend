import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import type { ListaDeViajes, ViajeEnLista } from '../../api/viajes';
import { RequestEpoch } from '../../utils/requestEpoch';
import { InsigniaDelViaje, useFotosDeViajes } from './InsigniaDelViaje';
import { Icon, type IconName } from '../../components/Icon';
import { useIdioma } from '../../i18n/idioma';
import { navigate } from '../../router';
import './viajes.css';
import './listas.css';
import './inicio.css';

/**
 * AF-VIAJES · D242 · la pestaña «Viajes» de Inicio (1a, 1b), que reemplaza a
 * «Asociadas» sólo con la capacidad encendida. Es un lanzador, como «Cuenta».
 *
 * D266 · Mati: «en vez de Abiertos y Cerrados dejas Cerrados pero cambias el de
 * Abiertos por Crear Viaje ya que ahora el viaje abierto va a estar
 * constantemente en display». Las dos burbujas son «Crear viaje» (el alta) y
 * «Cerrados», que muestra u oculta la lista de cerrados debajo. D274 · Mati:
 * «Quitar la cantidad de viajes cerrados, dejar únicamente Cerrados»: cada
 * burbuja lleva sólo su ícono y su palabra.
 * Los abiertos están en la pantalla principal (D265): la pestaña ya no los pide.
 * «Crear viaje» es uno solo: salieron la fila aparte y el vacío con su botón.
 */

export type ConteoDeViajes =
  | { readonly estado: 'cargando' }
  | { readonly estado: 'error' }
  | {
    readonly estado: 'listo';
    readonly counts: ListaDeViajes['counts'];
    /** D246 · D266 · los cerrados, del dueño. */
    readonly viajes: readonly ViajeEnLista[];
  };

/**
 * C-06 (auditoría Codex completa) · cada pedido de los cerrados, también el de
 * «Reintentar», saca su turno; sólo el ÚLTIMO publica. Salir de la pestaña o
 * desmontar invalida lo que esté en vuelo: un pedido tardío nunca pisa a uno
 * posterior.
 */
export class ConsultaDeViajes {
  private readonly epoca = new RequestEpoch();

  constructor(
    private readonly traer: () => Promise<ListaDeViajes>,
    private readonly publicar: (conteo: ConteoDeViajes) => void,
  ) {}

  pedir(): void {
    const mia = this.epoca.next();
    this.traer().then(
      (r) => { if (this.epoca.isCurrent(mia)) this.publicar({ estado: 'listo', counts: r.counts, viajes: r.viajes }); },
      () => { if (this.epoca.isCurrent(mia)) this.publicar({ estado: 'error' }); },
    );
  }

  /** Nada de lo que esté en vuelo publica. */
  invalidar(): void {
    this.epoca.next();
  }
}

/**
 * D266 · los cerrados y su conteo: se piden la primera vez que la pestaña se
 * abre y cada vez que se vuelve a abrir. La lista arranca oculta; «Cerrados» la
 * muestra o la oculta. Al salir de la pestaña, vuelve a ocultarse.
 */
export function useCerradosDeViajes(activa: boolean): {
  conteo: ConteoDeViajes;
  abierta: boolean;
  alternar: () => void;
  reintentar: () => void;
} {
  const [conteo, setConteo] = useState<ConteoDeViajes>({ estado: 'cargando' });
  const [abierta, setAbierta] = useState(false);
  const consulta = useRef<ConsultaDeViajes | null>(null);
  if (consulta.current === null) consulta.current = new ConsultaDeViajes(() => api.getViajes('cerrados'), setConteo);
  useEffect(() => {
    if (!activa) return undefined;
    const c = consulta.current!;
    c.pedir();
    return () => c.invalidar();
  }, [activa]);
  useEffect(() => { if (!activa) setAbierta(false); }, [activa]);
  const reintentar = useCallback(() => {
    setConteo({ estado: 'cargando' });
    consulta.current!.pedir();
  }, []);
  const alternar = useCallback(() => setAbierta((a) => !a), []);
  return { conteo, abierta, alternar, reintentar };
}

function Lanzador({ icon, label, onClick, elegido }: {
  icon: IconName; label: string; onClick: () => void;
  /** D246 · lo elegido se marca con borde 2px teal y `aria-pressed`, no sólo con color. Sin él, un botón común. */
  elegido?: boolean;
}) {
  return (
    <button
      type="button"
      className={`launch vj-lanzador ${elegido ? 'vj-lanzador--elegido' : ''}`}
      aria-pressed={elegido}
      onClick={onClick}
    >
      <span className="launch-ico" aria-hidden="true">
        <Icon name={icon} size={22} />
      </span>
      <span className="launch-label">{label}</span>
    </button>
  );
}

/** El contenido de la tarjeta montada bajo la pestaña: «Crear viaje» y «Cerrados». */
export function PanelViajes({ conteo, cerradosAbierta, onCerrados, onReintentar }: {
  conteo: ConteoDeViajes;
  cerradosAbierta: boolean;
  onCerrados: () => void;
  onReintentar: () => void;
}) {
  const { t } = useIdioma();
  if (conteo.estado === 'cargando') {
    return (
      <div className="launch-pair home-tab-panel" aria-busy="true" aria-label={t('Cargando…')}>
        <div className="launch sk"><span className="sk-line w40" /></div>
        <div className="launch sk"><span className="sk-line w40" /></div>
      </div>
    );
  }
  if (conteo.estado === 'error') {
    return (
      <div className="launch-stack home-tab-panel home-tab-panel-empty">
        <div className="state-error">
          <div className="state-error-row">
            <Icon name="x-circle" size={22} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="state-error-title">{t('No pudimos cargar tus viajes')}</div>
              <p className="state-error-body">{t('Revisa la conexión y prueba de nuevo.')}</p>
            </div>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onReintentar}>
            {t('Reintentar')}
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="launch-pair home-tab-panel vj-lanzadores">
      <Lanzador icon="plus" label={t('Crear viaje')} onClick={() => navigate('viaje-nuevo')} />
      <Lanzador icon="archive" label={t('Cerrados')} elegido={cerradosAbierta} onClick={onCerrados} />
    </div>
  );
}

export { inicialDelViaje } from './InsigniaDelViaje';

/**
 * D246 · D266 · los cerrados, en una burbuja debajo de la tarjeta. Tocar uno lo
 * abre. D255-6 · cada fila lleva sólo la inicial (o la foto) y el nombre del
 * viaje: el detalle está adentro.
 */
export function ListaDeCerrados({ conteo }: { conteo: ConteoDeViajes }) {
  const { fotoDe } = useFotosDeViajes(conteo.estado === 'listo' ? conteo.viajes : null);
  return <ListaDeCerradosVista conteo={conteo} fotoDe={fotoDe} />;
}

/** La vista pura de la lista (D255: la foto, si hay, sobre el color del viaje). */
export function ListaDeCerradosVista({ conteo, fotoDe = () => null }: {
  conteo: ConteoDeViajes;
  fotoDe?: (viajeId: string) => string | null;
}) {
  const { t } = useIdioma();
  if (conteo.estado !== 'listo') return null;
  if (conteo.viajes.length === 0) {
    return <div className="vj-card vj-inicio-lista vj-inicio-lista-vacia">{t('No tienes viajes cerrados')}</div>;
  }
  return (
    <ul className="vj-card vj-inicio-lista">
      {conteo.viajes.map((v) => (
        <li key={v.id}>
          <button type="button" className="vj-inicio-fila" onClick={() => navigate('viaje-cerrado', v.id)}>
            <InsigniaDelViaje nombre={v.nombre} color={v.color} foto={v.has_photo ? fotoDe(v.id) : null} />
            <span className="vj-inicio-nombre">{v.nombre}</span>
            <Icon name="chevron-down" size={18} className="vj-inicio-chev" />
          </button>
        </li>
      ))}
    </ul>
  );
}
