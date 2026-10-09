import { useEffect, useState } from 'react';
import { api } from '../../api';
import type { ViajeEnLista } from '../../api/viajes';
import { useAuth } from '../../auth/AuthContext';
import { AppBottomBar } from '../../components/AppBottomBar';
import { AppHeaderBack } from '../../components/AppHeader';
import { Icon } from '../../components/Icon';
import { useIdioma, type Idioma } from '../../i18n/idioma';
import { goBack, navigate } from '../../router';
import { formatMXN } from '../../utils/format';
import { fullName } from '../../utils/identity';
import { agruparPorAnio, etiquetaDelViaje, lineaDelViaje, tonoDeBalance } from './listasView';
import { textoDeMiBalance, type T } from './viajesView';
import './viajes.css';
import './listas.css';

/**
 * AF-VIAJES · D242 · Abiertos (1c) y Cerrados (1r): `GET /api/viajes?estado=…`.
 *
 * Abiertos trae también los que esperan pagos: siguen acá hasta que todas las
 * transferencias estén pagadas. Cada tarjeta dice dónde estás parado con lo que
 * publica el dueño (`mi_balance_cents`, `transferencias_pendientes`); el front
 * no calcula nada. Cerrados va agrupado por año, en el orden del dueño, y el
 * monto es sólo lo que consumiste tú (D240-17).
 */

export type CargaDeViajes =
  | { readonly estado: 'cargando' }
  | { readonly estado: 'error' }
  | { readonly estado: 'lista'; readonly viajes: readonly ViajeEnLista[] };

export function ViajesScreen({ estado }: { estado: 'abiertos' | 'cerrados' }) {
  const { t, idioma } = useIdioma();
  const { session } = useAuth();
  const [carga, setCarga] = useState<CargaDeViajes>({ estado: 'cargando' });
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    let vivo = true;
    setCarga({ estado: 'cargando' });
    api.getViajes(estado)
      .then((r) => { if (vivo) setCarga({ estado: 'lista', viajes: r.viajes }); })
      .catch(() => { if (vivo) setCarga({ estado: 'error' }); });
    return () => { vivo = false; };
  }, [estado, intento]);

  return (
    <div className="screen has-appbar">
      <AppHeaderBack userName={fullName(session) ?? undefined} onBack={() => goBack('home')} />
      <VistaDeViajes
        estado={estado}
        carga={carga}
        t={t}
        idioma={idioma}
        onAbrir={(id) => (estado === 'cerrados' ? navigate('viaje-cerrado', id) : navigate('viaje', id))}
        onCrear={() => navigate('viaje-nuevo')}
        onReintentar={() => setIntento((n) => n + 1)}
      />
      {/* Ninguna de las cinco posiciones es «Viajes»: marcar una sería mentir sobre dónde está la persona. */}
      <AppBottomBar active={null} />
    </div>
  );
}

export interface VistaDeViajesProps {
  readonly estado: 'abiertos' | 'cerrados';
  readonly carga: CargaDeViajes;
  readonly t: T;
  readonly idioma: Idioma;
  readonly onAbrir: (id: string) => void;
  readonly onCrear: () => void;
  readonly onReintentar: () => void;
}

/** La tarjeta de título y la lista: pura, sin red ni efectos. */
export function VistaDeViajes({ estado, carga, t, idioma, onAbrir, onCrear, onReintentar }: VistaDeViajesProps) {
  return (
    <>
      <div className="title-card">
        <h1 className="title-card-title">{estado === 'cerrados' ? t('Viajes cerrados') : t('Viajes abiertos')}</h1>
      </div>
      <div className="scroll vj-scroll">
        {carga.estado === 'cargando' ? (
          <div className="vjl-lista" aria-busy="true" aria-label={t('Cargando…')}>
            {[0, 1].map((i) => (
              <div key={i} className="vj-card vjl-fila sk">
                <span className="vjl-ico" aria-hidden="true" />
                <span className="vjl-cuerpo">
                  <span className="sk-line w55" />
                  <span className="sk-line w40" />
                </span>
              </div>
            ))}
          </div>
        ) : carga.estado === 'error' ? (
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
        ) : estado === 'cerrados' ? (
          <ListaDeCerrados viajes={carga.viajes} t={t} idioma={idioma} onAbrir={onAbrir} />
        ) : (
          <ListaDeAbiertos viajes={carga.viajes} t={t} idioma={idioma} onAbrir={onAbrir} onCrear={onCrear} />
        )}
      </div>
    </>
  );
}

function Chevron() {
  return (
    <span className="vjl-chevron" aria-hidden="true">
      <Icon name="chevron-down" size={18} />
    </span>
  );
}

function ListaDeAbiertos({ viajes, t, idioma, onAbrir, onCrear }: {
  viajes: readonly ViajeEnLista[]; t: T; idioma: Idioma; onAbrir: (id: string) => void; onCrear: () => void;
}) {
  if (viajes.length === 0) {
    return (
      <div className="vj-card vjl-vacio">
        <span className="vjl-ico" aria-hidden="true">
          <Icon name="briefcase" size={22} />
        </span>
        <div className="vjl-vacio-titulo">{t('Todavía no tienes viajes')}</div>
        <p className="vjl-vacio-texto">
          {t('Crea uno, suma a tus amigos y escaneen los tickets del viaje. PayMe va calculando quién le debe a quién.')}
        </p>
        <button type="button" className="btn btn-navy" onClick={onCrear}>
          <Icon name="plus" size={20} />
          {t('Crear viaje')}
        </button>
      </div>
    );
  }
  return (
    <>
      <ul className="vjl-lista">
        {viajes.map((v) => {
          const etiqueta = etiquetaDelViaje(v);
          return (
            <li key={v.id}>
              <button type="button" className="vj-card vjl-fila" onClick={() => onAbrir(v.id)}>
                <span className="vjl-ico" aria-hidden="true">
                  <Icon name="briefcase" size={20} />
                </span>
                <span className="vjl-cuerpo">
                  <span className="vjl-nombre">{v.nombre}</span>
                  <span className="vjl-meta">{lineaDelViaje(v, idioma, t)}</span>
                  {etiqueta.tipo === 'esperando' ? (
                    <span className="vjl-chip vjl-chip--esperando">{t('Esperando pagos · faltan {0}', etiqueta.faltan)}</span>
                  ) : etiqueta.tipo === 'balance' ? (
                    <span className={`vjl-chip vjl-chip--${tonoDeBalance(etiqueta.cents)}`}>
                      {textoDeMiBalance(etiqueta.cents, t, formatMXN)}
                    </span>
                  ) : null}
                </span>
                <Chevron />
              </button>
            </li>
          );
        })}
      </ul>
      <button type="button" className="btn btn-ghost vjl-crear" onClick={onCrear}>
        <Icon name="plus" size={20} />
        {t('Crear viaje')}
      </button>
    </>
  );
}

function ListaDeCerrados({ viajes, t, idioma, onAbrir }: {
  viajes: readonly ViajeEnLista[]; t: T; idioma: Idioma; onAbrir: (id: string) => void;
}) {
  if (viajes.length === 0) {
    return (
      <div className="mesa-empty">
        <div className="mesa-empty-title">{t('Todavía no tienes viajes cerrados.')}</div>
      </div>
    );
  }
  return (
    <>
      {agruparPorAnio(viajes).map((g, i) => (
        <section key={`${g.anio ?? 'sin-anio'}-${i}`} className="vjl-grupo">
          {g.anio && <h2 className="vj-seccion">{g.anio}</h2>}
          <ul className="vjl-lista">
            {g.viajes.map((v) => (
              <li key={v.id}>
                <button type="button" className="vj-card vjl-fila" onClick={() => onAbrir(v.id)}>
                  <span className="vjl-ico" aria-hidden="true">
                    <Icon name="briefcase" size={20} />
                  </span>
                  <span className="vjl-cuerpo">
                    <span className="vjl-nombre">{v.nombre}</span>
                    <span className="vjl-meta">{lineaDelViaje(v, idioma, t)}</span>
                  </span>
                  {v.consumiste_cents !== null && (
                    <span className="vjl-gasto">
                      <span className="vjl-gasto-rotulo">{t('Gastaste')}</span>
                      <span className="vjl-gasto-monto">{formatMXN(v.consumiste_cents)}</span>
                    </span>
                  )}
                  <Chevron />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
