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
 * «Asociadas» sólo con la capacidad encendida. Es un lanzador, como «Cuenta»:
 * Abiertos y Cerrados lado a lado, con cuántos hay, y debajo la fila «Crear
 * viaje». Sin viajes, la tarjeta de la pestaña es el estado vacío (1b).
 *
 * Los conteos son los del dueño (`counts` de `GET /api/viajes`): Abiertos
 * incluye los que esperan pagos.
 */

export type ListaElegida = 'abiertos' | 'cerrados';

export type ConteoDeViajes =
  | { readonly estado: 'cargando' }
  | { readonly estado: 'error' }
  | {
    readonly estado: 'listo';
    readonly counts: ListaDeViajes['counts'];
    /** D246 · la lista elegida (Abiertos o Cerrados), del dueño. */
    readonly viajes: readonly ViajeEnLista[];
  };

/**
 * C-06 (auditoría Codex completa) · cada pedido de la lista, también el de
 * «Reintentar», saca su turno; sólo el ÚLTIMO publica. Cambiar de Abiertos a
 * Cerrados, salir de la pestaña o desmontar invalida lo que esté en vuelo. Antes
 * el reintento perdía su limpieza y un Abiertos tardío pisaba la lista de
 * Cerrados.
 */
export class ConsultaDeViajes {
  private readonly epoca = new RequestEpoch();

  constructor(
    private readonly traer: (lista: ListaElegida) => Promise<ListaDeViajes>,
    private readonly publicar: (conteo: ConteoDeViajes) => void,
  ) {}

  pedir(lista: ListaElegida): void {
    const mia = this.epoca.next();
    this.traer(lista).then(
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
 * Los conteos y la lista elegida: se piden la primera vez que la pestaña se
 * abre, cada vez que se vuelve a abrir y al cambiar de Abiertos a Cerrados
 * (D246). Al entrar, Abiertos.
 */
export function useConteoDeViajes(activa: boolean): {
  conteo: ConteoDeViajes;
  elegida: ListaElegida;
  elegir: (l: ListaElegida) => void;
  reintentar: () => void;
} {
  const [conteo, setConteo] = useState<ConteoDeViajes>({ estado: 'cargando' });
  const [elegida, setElegida] = useState<ListaElegida>('abiertos');
  const consulta = useRef<ConsultaDeViajes | null>(null);
  if (consulta.current === null) consulta.current = new ConsultaDeViajes((lista) => api.getViajes(lista), setConteo);
  useEffect(() => {
    if (!activa) return undefined;
    const c = consulta.current!;
    c.pedir(elegida);
    return () => c.invalidar();
  }, [activa, elegida]);
  useEffect(() => { if (!activa) setElegida('abiertos'); }, [activa]);
  const reintentar = useCallback(() => {
    setConteo({ estado: 'cargando' });
    consulta.current!.pedir(elegida);
  }, [elegida]);
  return { conteo, elegida, elegir: setElegida, reintentar };
}

function LanzadorConConteo({ icon, label, sub, onClick, elegido }: {
  icon: IconName; label: string; sub: string; onClick: () => void; elegido: boolean;
}) {
  // D246 · lo elegido se marca con borde 2px teal y `aria-pressed`, no sólo con color.
  return (
    <button type="button" className={`launch vj-lanzador ${elegido ? 'vj-lanzador--elegido' : ''}`} aria-pressed={elegido} onClick={onClick}>
      <span className="launch-ico" aria-hidden="true">
        <Icon name={icon} size={22} />
      </span>
      <span className="launch-label">{label}</span>
      <span className="launch-sub">{sub}</span>
    </button>
  );
}

/** El contenido de la tarjeta montada bajo la pestaña. */
export function PanelViajes({ conteo, elegida, onElegir, onReintentar }: {
  conteo: ConteoDeViajes;
  elegida: ListaElegida;
  onElegir: (l: ListaElegida) => void;
  onReintentar: () => void;
}) {
  const { t } = useIdioma();
  const cuantos = (n: number) => (n === 1 ? t('{0} viaje', n) : t('{0} viajes', n));
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
  const { abiertos, cerrados } = conteo.counts;
  if (abiertos + cerrados === 0) {
    return (
      <div className="home-tab-panel vj-inicio-vacio">
        <span className="vj-inicio-vacio-ico" aria-hidden="true">
          <Icon name="briefcase" size={22} />
        </span>
        <div className="vj-inicio-vacio-titulo">{t('Todavía no tienes viajes')}</div>
        <p className="vj-inicio-vacio-texto">
          {t('Crea uno, suma a tus amigos y escaneen los tickets del viaje. PayMe va calculando quién le debe a quién.')}
        </p>
        <button type="button" className="btn btn-navy" onClick={() => navigate('viaje-nuevo')}>
          <Icon name="plus" size={20} />
          {t('Crear viaje')}
        </button>
      </div>
    );
  }
  return (
    <div className="launch-pair home-tab-panel vj-lanzadores">
      <LanzadorConConteo icon="briefcase" label={t('Abiertos')} sub={cuantos(abiertos)} elegido={elegida === 'abiertos'} onClick={() => onElegir('abiertos')} />
      <LanzadorConConteo icon="archive" label={t('Cerrados')} sub={cuantos(cerrados)} elegido={elegida === 'cerrados'} onClick={() => onElegir('cerrados')} />
    </div>
  );
}

/** La fila «Crear viaje» debajo de la tarjeta (1a). Sólo con algún viaje: sin viajes ya está en el vacío. */
export function FilaCrearViaje({ conteo }: { conteo: ConteoDeViajes }) {
  const { t } = useIdioma();
  if (conteo.estado !== 'listo' || conteo.counts.abiertos + conteo.counts.cerrados === 0) return null;
  return (
    <button type="button" className="vj-crear-fila" onClick={() => navigate('viaje-nuevo')}>
      <span className="vj-crear-fila-ico" aria-hidden="true">
        <Icon name="plus" size={22} />
      </span>
      <span className="vj-crear-fila-texto">
        <span className="vj-crear-fila-titulo">{t('Crear viaje')}</span>
        <span className="vj-crear-fila-sub">{t('Ponle nombre y suma a tus amigos')}</span>
      </span>
      <span className="vj-crear-fila-chev" aria-hidden="true">
        <Icon name="chevron-down" size={18} />
      </span>
    </button>
  );
}

export { inicialDelViaje } from './InsigniaDelViaje';

/**
 * D246 · la lista elegida, en una burbuja debajo de «Crear viaje» (antes
 * Abiertos y Cerrados navegaban a otra pantalla). Tocar un viaje lo abre.
 * D255-6 · cada fila lleva sólo la inicial y el nombre del viaje (Mati: «no hace
 * falta poner toda la descripción»): sin fechas, personas, balance, «Esperando
 * pagos» ni «Gastaste». El detalle está adentro del viaje.
 */
export function ListaDeInicio({ conteo, elegida }: { conteo: ConteoDeViajes; elegida: ListaElegida }) {
  const { fotoDe } = useFotosDeViajes(conteo.estado === 'listo' ? conteo.viajes : null);
  return <ListaDeInicioVista conteo={conteo} elegida={elegida} fotoDe={fotoDe} />;
}

/** La vista pura de la lista (D255: la foto, si hay, sobre el color del viaje). */
export function ListaDeInicioVista({ conteo, elegida, fotoDe = () => null }: {
  conteo: ConteoDeViajes;
  elegida: ListaElegida;
  fotoDe?: (viajeId: string) => string | null;
}) {
  const { t } = useIdioma();
  if (conteo.estado !== 'listo' || conteo.counts.abiertos + conteo.counts.cerrados === 0) return null;
  if (conteo.viajes.length === 0) {
    return (
      <div className="vj-card vj-inicio-lista vj-inicio-lista-vacia">
        {elegida === 'abiertos' ? t('No tienes viajes abiertos') : t('No tienes viajes cerrados')}
      </div>
    );
  }
  return (
    <ul className="vj-card vj-inicio-lista">
      {conteo.viajes.map((v) => (
        <li key={v.id}>
          <button type="button" className="vj-inicio-fila" onClick={() => navigate(v.estado === 'cerrado' ? 'viaje-cerrado' : 'viaje', v.id)}>
            <InsigniaDelViaje nombre={v.nombre} color={v.color} foto={v.has_photo ? fotoDe(v.id) : null} />
            <span className="vj-inicio-nombre">{v.nombre}</span>
            <Icon name="chevron-down" size={18} className="vj-inicio-chev" />
          </button>
        </li>
      ))}
    </ul>
  );
}
