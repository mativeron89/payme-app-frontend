import { useCallback, useEffect, useRef, useState } from 'react';
import { useIdioma } from '../i18n/idioma';
import { api } from '../api';
import { ordenDeCocinas, visitasDelMes, type TusRestaurantes, type Visita } from '../api/tusRestaurantes';
import { useAuth } from '../auth/AuthContext';
import { AppBottomBar } from '../components/AppBottomBar';
import { AppHeaderBack } from '../components/AppHeader';
import { Icon } from '../components/Icon';
import { goBack } from '../router';
import { colorDeFila } from '../utils/anillo';
import { partesDeFecha } from '../utils/fechaCorta';
import { formatMXN } from '../utils/format';
import { fullName } from '../utils/identity';
import { bpsLabel } from './mesaItemsView';
import { lugaresYVisitas, nombreDeCocina, visitasTexto } from '../utils/textosDeEstadisticas';
import { usePeriodoEstadisticas, type ClavePeriodo } from '../api/periodoEstadisticas';
import { SelectorDePeriodo } from './SelectorDePeriodo';
import { TicketDigitalDialog } from '../components/TicketDigitalDialog';

/**
 * **Tus restaurantes** — pantalla 2b del diseño de «Mis estadísticas» (AF-29,
 * Roadmap n165). `GET /api/account/stats/restaurants`, sólo el mes en curso.
 *
 * Tres niveles que se abren **de a uno**: restaurante → visita («Sáb 12/09» y
 * hora) → lo que consumiste en esa visita (plato, fracción si no es entero y
 * monto). El ancho dice de qué depende cada cosa: el restaurante ocupa la
 * tarjeta, la visita es una burbuja más angosta y lo consumido otra más.
 *
 * El rótulo sale de `basis`, como en 2a. En base `payments` la visita incluye la
 * propina y los platos no: se dice con una línea al pie, sólo en esa base.
 *
 * Estados: cargando, error con «Reintentar» (incluido 413
 * `stats_month_too_large`: el dueño nunca manda una lista recortada), vacío y
 * lista. A esta pantalla se llega desde el acceso de Mis estadísticas, que no
 * se dibuja con un backend anterior (404).
 */

type Estado =
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'error' }
  | { readonly tipo: 'lista'; readonly datos: TusRestaurantes };

export function TusRestaurantesScreen() {
  const { t } = useIdioma();
  const { session } = useAuth();
  const [estado, setEstado] = useState<Estado>({ tipo: 'cargando' });
  const [abierto, setAbierto] = useState<string | null>(null);
  const [visitaAbierta, setVisitaAbierta] = useState<string | null>(null);
  const [ticketCode, setTicketCode] = useState<string | null>(null);
  const ticketTriggerRef = useRef<HTMLButtonElement | null>(null);
  /** AF-31 · el período elegido en 2a, conservado al navegar. */
  const clave = usePeriodoEstadisticas();

  const cargar = useCallback(() => {
    setEstado({ tipo: 'cargando' });
    setAbierto(null);
    setVisitaAbierta(null);
    api
      .getStatsRestaurants(clave)
      .then((datos) => setEstado({ tipo: 'lista', datos }))
      // Todo error es el mismo cartel: 404, 413 o red. El dueño no manda datos
      // parciales, así que no hay nada a medias que mostrar.
      .catch(() => setEstado({ tipo: 'error' }));
  }, [clave]);

  useEffect(() => { cargar(); }, [cargar]);

  const dias = [t('Dom'), t('Lun'), t('Mar'), t('Mié'), t('Jue'), t('Vie'), t('Sáb')];
  const datos = estado.tipo === 'lista' ? estado.datos : null;
  const conDatos = datos !== null && datos.restaurants.length > 0;
  const orden = datos ? ordenDeCocinas(datos) : [];
  // Sólo si el dueño CONFIRMA el período pedido: un backend anterior lo ignora
  // y manda el mes en curso, que se rotula «Este mes» y no ofrece selector.
  const soportaPeriodo = datos !== null && datos.period?.key === clave;
  const efectiva: ClavePeriodo = soportaPeriodo ? clave : 'this_month';

  function abrirRestaurante(id: string) {
    setAbierto((a) => (a === id ? null : id));
    setVisitaAbierta(null);
  }

  const cerrarTicket = useCallback(() => setTicketCode(null), []);

  return (
    <div className="screen has-appbar">
      <AppHeaderBack userName={fullName(session) ?? undefined} onBack={() => goBack('estadisticas')} />
      {conDatos || soportaPeriodo ? (
        <div className="title-card stat-burbuja">
          <h1 className="stat-oculto">{t('Tus restaurantes')}</h1>
          <SelectorDePeriodo clave={efectiva} disponible={soportaPeriodo} inicio={soportaPeriodo ? datos.period?.start ?? null : null} />
          {conDatos && (
            <div className="stat-burbuja-dato">
              <div className="stat-burbuja-total">{formatMXN(datos.totalCents)}</div>
              <div className="stat-burbuja-contexto">
                {lugaresYVisitas(datos.restaurants.length, visitasDelMes(datos), t)}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="title-card">
          <h1 className="title-card-title">{t('Tus restaurantes')}</h1>
        </div>
      )}

      <div className="scroll" style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 16 }}>
        {estado.tipo === 'cargando' ? (
          <div aria-busy="true" aria-label={t('Cargando tus restaurantes')}>
            <div className="stat-hero sk">
              <span className="sk-line w40" />
              <span className="sk-line w70 tall" />
            </div>
          </div>
        ) : estado.tipo === 'error' ? (
          <div className="state-error">
            <div className="state-error-row">
              <Icon name="x-circle" size={22} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="state-error-title">{t('No pudimos cargar tus restaurantes')}</div>
                <p className="state-error-body">{t('Revisa la conexión y prueba de nuevo.')}</p>
              </div>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={cargar}>
              {t('Reintentar')}
            </button>
          </div>
        ) : !conDatos ? (
          <div className="mesa-empty">
            <div className="mesa-empty-title">
              {efectiva === 'this_month'
                ? t('Todavía no registramos consumos este mes.')
                : t('No registramos consumos en este período.')}
            </div>
          </div>
        ) : (
          <div className="rest-lista">
            {datos.restaurants.map((r) => {
              const abiertoR = abierto === r.id;
              const color = colorDeFila(Math.max(orden.indexOf(r.category), 0));
              return (
                <section key={r.id} className="rest-card" aria-label={r.name}>
                  <button
                    type="button"
                    className="rest-fila"
                    aria-expanded={abiertoR}
                    onClick={() => abrirRestaurante(r.id)}
                  >
                    <span className="stat-anillo-color" style={{ background: color }} aria-hidden="true" />
                    <span className="rest-texto">
                      <span className="rest-nombre">{r.name}</span>
                      <span className="rest-sub">
                        {nombreDeCocina(r.category, t) ?? t('Otra cocina')} · {visitasTexto(r.visits.length, t)}
                      </span>
                    </span>
                    <span className="rest-monto">{formatMXN(r.amountCents)}</span>
                    <Icon name="chevron-down" size={18} className={abiertoR ? 'rest-chev abierto' : 'rest-chev'} />
                  </button>
                  {abiertoR && (
                    <div className="rest-visitas">
                      {r.visits.map((v) => {
                        const clave = `${r.id}:${v.code}`;
                        const abiertaV = visitaAbierta === clave;
                        const f = partesDeFecha(v.createdAt);
                        return (
                          <div key={v.code} className="rest-visita">
                            <button
                              type="button"
                              className="rest-visita-fila"
                              aria-expanded={abiertaV}
                              aria-haspopup="dialog"
                              onClick={(event) => {
                                setVisitaAbierta(clave);
                                ticketTriggerRef.current = event.currentTarget;
                                setTicketCode(v.code);
                              }}
                            >
                              <span className="rest-visita-fecha">{f ? `${dias[f.diaSemana]} ${f.diaMes}` : '—'}</span>
                              <span className="rest-visita-hora">{f ? f.hora : ''}</span>
                              <span className="rest-visita-monto">{formatMXN(v.amountCents)}</span>
                              <Icon name="chevron-down" size={18} className={abiertaV ? 'rest-chev abierto' : 'rest-chev'} />
                            </button>
                            {abiertaV && <LoConsumido visita={v} />}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              );
            })}
            {datos.basis !== 'consumption' && (
              <p className="rest-pie">
                {t('Lo que pagaste, descontando reembolsos. Cada visita incluye la propina; los platos, no.')}
              </p>
            )}
          </div>
        )}
      </div>

      {ticketCode && (
        <TicketDigitalDialog code={ticketCode} onClose={cerrarTicket} returnFocusRef={ticketTriggerRef} />
      )}
      <AppBottomBar active={null} />
    </div>
  );
}

/** Lo que consumiste en una visita: plato, fracción si no es entero y monto. */
function LoConsumido({ visita }: { visita: Visita }) {
  const { t } = useIdioma();
  if (visita.items.length === 0) {
    // Modo «igual»: la visita es tu parte y no hay platos propios.
    return (
      <div className="rest-items">
        <div className="rest-item">
          <span className="rest-item-nombre">{t('Tu parte, en partes iguales')}</span>
        </div>
      </div>
    );
  }
  return (
    <ul className="rest-items">
      {visita.items.map((it, i) => (
        <li key={i} className="rest-item">
          <span className="rest-item-frac">{it.fractionBps < 10000 ? bpsLabel(it.fractionBps) : ''}</span>
          <span className="rest-item-nombre">{it.name}</span>
          <span className="rest-item-monto">{formatMXN(it.amountCents)}</span>
        </li>
      ))}
    </ul>
  );
}
