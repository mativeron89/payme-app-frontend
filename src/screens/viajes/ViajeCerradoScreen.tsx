import { useEffect, useState } from 'react';
import { api } from '../../api';
import { extractApiError } from '../../api/errors';
import { errorDeViaje, type ResumenDeViaje } from '../../api/viajes';
import { useAuth } from '../../auth/AuthContext';
import { AppBottomBar } from '../../components/AppBottomBar';
import { AppHeaderBack } from '../../components/AppHeader';
import { Icon } from '../../components/Icon';
import { useIdioma, type Idioma } from '../../i18n/idioma';
import { goBack, navigate, replaceRoute } from '../../router';
import { formatMXN } from '../../utils/format';
import { fullName } from '../../utils/identity';
import { etiquetaPorcion } from '../queConsumisteView';
import { anchoDeBarra, lineaDelViaje } from './listasView';
import { etiquetaTipoLugar, fechaCortaViaje, iconoTipoLugar, nombreDelLugar, type T } from './viajesView';
import './viajes.css';
import './listas.css';

/**
 * AF-VIAJES · D242 · el detalle de un viaje cerrado (1s): `GET …/resumen`.
 *
 * **Sólo lo propio (D240-17):** lo que consumiste, lo que pagaste, lo que te
 * transfirieron o transferiste, por tipo de lugar y lugar por lugar. Un renglón
 * abierto muestra sólo lo que elegiste tú. Nada de los demás: el dueño no lo
 * publica y la pantalla no lo pide.
 *
 * Si el viaje todavía no está cerrado (409 `viaje_not_closed`), la ruta pasa a
 * la del viaje abierto, que es donde vive. El 404 es uno solo (n325).
 */

export type CargaDeResumen =
  | { readonly estado: 'cargando' }
  | { readonly estado: 'error' }
  | { readonly estado: 'no_disponible' }
  | { readonly estado: 'listo'; readonly resumen: ResumenDeViaje };

/** Qué hace la pantalla cuando el dueño no devuelve el resumen. Puro. */
export function destinoDelError(err: unknown): 'abrir_viaje' | 'no_disponible' | 'reintentar' {
  const { status, code } = extractApiError(err);
  if (status === 409 && code === 'viaje_not_closed') return 'abrir_viaje';
  if (errorDeViaje(err).tipo === 'no_disponible') return 'no_disponible';
  return 'reintentar';
}

export function ViajeCerradoScreen({ viajeId }: { viajeId: string }) {
  const { t, idioma } = useIdioma();
  const { session } = useAuth();
  const [carga, setCarga] = useState<CargaDeResumen>({ estado: 'cargando' });
  const [intento, setIntento] = useState(0);
  const [abiertos, setAbiertos] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    let vivo = true;
    setCarga({ estado: 'cargando' });
    api.getResumenDeViaje(viajeId)
      .then((resumen) => { if (vivo) setCarga({ estado: 'listo', resumen }); })
      .catch((err: unknown) => {
        if (!vivo) return;
        const destino = destinoDelError(err);
        if (destino === 'abrir_viaje') replaceRoute('viaje', viajeId);
        else setCarga({ estado: destino === 'no_disponible' ? 'no_disponible' : 'error' });
      });
    return () => { vivo = false; };
  }, [viajeId, intento]);

  const alternar = (ticketId: string) => {
    setAbiertos((prev) => {
      const sig = new Set(prev);
      if (sig.has(ticketId)) sig.delete(ticketId);
      else sig.add(ticketId);
      return sig;
    });
  };

  return (
    <div className="screen has-appbar">
      <AppHeaderBack userName={fullName(session) ?? undefined} onBack={() => goBack('viajes', 'cerrados')} />
      <VistaDelViajeCerrado
        carga={carga}
        t={t}
        idioma={idioma}
        abiertos={abiertos}
        onAlternar={alternar}
        onReintentar={() => setIntento((n) => n + 1)}
        onVerViajes={() => navigate('viajes', 'abiertos')}
      />
      <AppBottomBar active={null} />
    </div>
  );
}

export interface VistaDelViajeCerradoProps {
  readonly carga: CargaDeResumen;
  readonly t: T;
  readonly idioma: Idioma;
  /** Los `ticket_id` de los renglones desplegados. */
  readonly abiertos: ReadonlySet<string>;
  readonly onAlternar: (ticketId: string) => void;
  readonly onReintentar: () => void;
  readonly onVerViajes: () => void;
}

/** La tarjeta de título y el contenido: pura, sin red ni efectos. */
export function VistaDelViajeCerrado({ carga, t, idioma, abiertos, onAlternar, onReintentar, onVerViajes }: VistaDelViajeCerradoProps) {
  if (carga.estado !== 'listo') {
    return (
      <>
        <div className="title-card">
          {carga.estado === 'cargando' ? (
            <div aria-hidden="true">
              <span className="sk-line tall w55" style={{ margin: '0 auto var(--sp-2)' }} />
              <span className="sk-line w70" style={{ margin: '0 auto' }} />
            </div>
          ) : (
            <h1 className="title-card-title">{t('Viajes cerrados')}</h1>
          )}
        </div>
        <div className="scroll vj-scroll">
          {carga.estado === 'cargando' ? (
            <div aria-busy="true" aria-label={t('Cargando…')}>
              <div className="vj-card">
                <span className="sk-line tall w100" />
                <span className="sk-line w70" />
                <span className="sk-line w55" />
              </div>
            </div>
          ) : carga.estado === 'no_disponible' ? (
            <div className="vj-card vjd-no-disponible">
              <p className="vjd-no-disponible-texto">{t('Este viaje ya no está disponible.')}</p>
              <button type="button" className="btn btn-navy" onClick={onVerViajes}>
                {t('Ver tus viajes')}
              </button>
            </div>
          ) : (
            <div className="state-error">
              <div className="state-error-row">
                <Icon name="x-circle" size={22} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="state-error-title">{t('No pudimos cargar el viaje')}</div>
                  <p className="state-error-body">{t('Revisa la conexión y prueba de nuevo.')}</p>
                </div>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={onReintentar}>
                {t('Reintentar')}
              </button>
            </div>
          )}
        </div>
      </>
    );
  }

  const r = carga.resumen;
  return (
    <>
      <div className="title-card">
        <h1 className="title-card-title">{r.nombre}</h1>
        <div className="title-card-sub">
          {lineaDelViaje(r, idioma, t)}
          {' · '}
          {t('Cerrado')}
        </div>
      </div>
      <div className="scroll vj-scroll">
        <dl className="vj-card vjd-resumen">
          <div className="vjd-fila vjd-fila--total">
            <dt>{t('Consumiste')}</dt>
            <dd>{formatMXN(r.consumiste_cents)}</dd>
          </div>
          <div className="vjd-fila">
            <dt>{t('Pagaste en tickets')}</dt>
            <dd>{formatMXN(r.pagaste_en_tickets_cents)}</dd>
          </div>
          {r.te_transfirieron_cents > 0 && (
            <div className="vjd-fila">
              <dt>{t('Te transfirieron')}</dt>
              <dd>{formatMXN(r.te_transfirieron_cents)}</dd>
            </div>
          )}
          {r.transferiste_cents > 0 && (
            <div className="vjd-fila">
              <dt>{t('Transferiste')}</dt>
              <dd>{formatMXN(r.transferiste_cents)}</dd>
            </div>
          )}
        </dl>

        {r.por_tipo_de_lugar.length > 0 && (
          <section className="vj-card vjd-tipos">
            <h2 className="vj-seccion">{t('Por tipo de lugar')}</h2>
            <ul className="vjd-tipos-lista">
              {r.por_tipo_de_lugar.map((p) => (
                <li key={p.tipo_lugar}>
                  <div className="vjd-tipo-fila">
                    <span className="vjd-tipo-nombre">{etiquetaTipoLugar(p.tipo_lugar, t, true)}</span>
                    <span className="vjd-tipo-monto">{formatMXN(p.monto_cents)}</span>
                  </div>
                  <span className="vjd-barra" aria-hidden="true">
                    <span className="vjd-barra-relleno" style={{ width: `${anchoDeBarra(p.monto_cents, r.por_tipo_de_lugar)}%` }} />
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {r.lugares.length > 0 && (
          <>
            <h2 className="vj-seccion">{t('Lugares visitados · {0}', r.lugares.length)}</h2>
            <ul className="vjd-lugares">
              {r.lugares.map((l) => (
                <RenglonDeLugar
                  key={l.ticket_id}
                  lugar={l}
                  t={t}
                  idioma={idioma}
                  abierto={abiertos.has(l.ticket_id)}
                  onAlternar={() => onAlternar(l.ticket_id)}
                />
              ))}
            </ul>
          </>
        )}
      </div>
    </>
  );
}

function RenglonDeLugar({ lugar: l, t, idioma, abierto, onAlternar }: {
  lugar: ResumenDeViaje['lugares'][number]; t: T; idioma: Idioma; abierto: boolean; onAlternar: () => void;
}) {
  const fecha = fechaCortaViaje(l.fecha_ticket, idioma);
  const desplegable = l.items.length > 0;
  const idItems = `vjd-items-${l.ticket_id}`;
  const contenido = (
    <>
      <span className="vjd-lugar-ico" aria-hidden="true">
        <Icon name={iconoTipoLugar(l.tipo_lugar)} size={20} />
      </span>
      <span className="vjd-lugar-cuerpo">
        <span className="vjd-lugar-nombre">{nombreDelLugar(l.lugar, l.tipo_lugar, t)}</span>
        {(fecha || l.pagaste_tu) && (
          <span className="vjd-lugar-sub">
            {fecha}
            {fecha && l.pagaste_tu && ' · '}
            {l.pagaste_tu && t('Pagaste tú')}
          </span>
        )}
      </span>
      <span className="vjd-lugar-monto">{formatMXN(l.mi_monto_cents)}</span>
      {desplegable ? (
        <span className="vjd-lugar-chevron" aria-hidden="true">
          <Icon name="chevron-down" size={18} />
        </span>
      ) : (
        <span className="vjd-lugar-chevron vjd-lugar-chevron--vacio" aria-hidden="true" />
      )}
    </>
  );
  return (
    <li className="vj-card vjd-lugar">
      {desplegable ? (
        <button type="button" className="vjd-lugar-cabeza" aria-expanded={abierto} aria-controls={idItems} onClick={onAlternar}>
          {contenido}
        </button>
      ) : (
        <div className="vjd-lugar-cabeza">{contenido}</div>
      )}
      {desplegable && (
        <ul id={idItems} className="vjd-items" hidden={!abierto}>
          {l.items.map((i, k) => (
            <li key={k} className="vjd-item">
              <span>
                {i.name}
                {i.fraction_bps < 10000 && ` · ${etiquetaPorcion(i.fraction_bps, t)}`}
              </span>
              <span className="vjd-item-monto">{formatMXN(i.amount_cents)}</span>
            </li>
          ))}
        </ul>
      )}
      {l.asignado_al_cierre_cents > 0 && (
        <p className="vjd-asignado">{t('Incluye {0} que se te asignó al cerrar.', formatMXN(l.asignado_al_cierre_cents))}</p>
      )}
    </li>
  );
}
