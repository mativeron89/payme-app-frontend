import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';
import type { ListaDeViajes, ViajeEnLista } from '../../api/viajes';
import { Icon, type IconName } from '../../components/Icon';
import { useIdioma } from '../../i18n/idioma';
import { navigate } from '../../router';
import { formatMXN } from '../../utils/format';
import { etiquetaDelViaje, lineaDelViaje, tonoDeBalance } from './listasView';
import { textoDeMiBalance } from './viajesView';
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
  const pedir = useCallback((lista: ListaElegida) => {
    let vivo = true;
    api.getViajes(lista)
      .then((r) => { if (vivo) setConteo({ estado: 'listo', counts: r.counts, viajes: r.viajes }); })
      .catch(() => { if (vivo) setConteo({ estado: 'error' }); });
    return () => { vivo = false; };
  }, []);
  useEffect(() => (activa ? pedir(elegida) : undefined), [activa, elegida, pedir]);
  useEffect(() => { if (!activa) setElegida('abiertos'); }, [activa]);
  const reintentar = useCallback(() => {
    setConteo({ estado: 'cargando' });
    pedir(elegida);
  }, [elegida, pedir]);
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
    <div className="launch-pair home-tab-panel">
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

/**
 * D246 · la lista elegida, en una burbuja debajo de «Crear viaje» (antes
 * Abiertos y Cerrados navegaban a otra pantalla). Tocar un viaje lo abre. En
 * Cerrados, «Gastaste» con lo que consumí (1r).
 */
export function ListaDeInicio({ conteo, elegida }: { conteo: ConteoDeViajes; elegida: ListaElegida }) {
  const { t, idioma } = useIdioma();
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
      {conteo.viajes.map((v) => {
        const etiqueta = etiquetaDelViaje(v);
        return (
          <li key={v.id}>
            <button type="button" className="vj-inicio-fila" onClick={() => navigate(v.estado === 'cerrado' ? 'viaje-cerrado' : 'viaje', v.id)}>
              <span className="vjl-cuerpo">
                <span className="vjl-nombre">{v.nombre}</span>
                <span className="vjl-meta">{lineaDelViaje(v, idioma, t)}</span>
                {etiqueta.tipo === 'esperando' ? (
                  <span className="vjl-chip vjl-chip--esperando">{t('Esperando pagos · faltan {0}', etiqueta.faltan)}</span>
                ) : etiqueta.tipo === 'balance' ? (
                  <span className={`vjl-chip vjl-chip--${tonoDeBalance(etiqueta.cents)}`}>{textoDeMiBalance(etiqueta.cents, t, formatMXN)}</span>
                ) : null}
              </span>
              {v.consumiste_cents !== null && (
                <span className="vjl-gasto">
                  <span className="vjl-gasto-rotulo">{t('Gastaste')}</span>
                  <span className="vjl-gasto-monto">{formatMXN(v.consumiste_cents)}</span>
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
