import { useCallback, useEffect, useRef, useState } from 'react';
import { useIdioma } from '../i18n/idioma';
import { api } from '../api';
import { visitasDelMes, type TusRestaurantes, type Visita } from '../api/tusRestaurantes';
import { isCurrentSession, loadSession } from '../api/storage';
import { useAuth } from '../auth/AuthContext';
import { AppBottomBar } from '../components/AppBottomBar';
import { AppHeaderBack } from '../components/AppHeader';
import { Icon } from '../components/Icon';
import { goBack, navigate } from '../router';
import { partesDeFecha } from '../utils/fechaCorta';
import { formatMXN } from '../utils/format';
import { fullName } from '../utils/identity';
import { lugaresYVisitas, nombreDeCocina, visitasTexto } from '../utils/textosDeEstadisticas';
import { usePeriodoEstadisticas, type ClavePeriodo } from '../api/periodoEstadisticas';
import { SelectorDePeriodo } from './SelectorDePeriodo';
import { useRegion } from '../preferences/RegionProvider';
import { personalZoneCaption } from '../utils/personalDates';
import { parametroDeTicket } from './viajes/viajesView';
import { useTandaVigente } from './useTandaVigente';
import { nombreDePlato } from '../utils/nombreDePlato';
import { RequestEpoch } from '../utils/requestEpoch';
import { colorDeCocina } from '../utils/coloresDeEstadisticas';
import { CabeceraDeEstadisticas, EsqueletoDeEstadisticas } from './CabeceraDeEstadisticas';
import { filasDelTicket, prefijoDeLoMio, type FilaDelTicket } from './ticketDeLaVisita';

/**
 * **Tus restaurantes** — pantalla 2b del diseño de «Mis estadísticas» (AF-29,
 * Roadmap n165). `GET /api/account/stats/restaurants?stats_version=3`.
 *
 * Tres niveles que se abren **de a uno**: restaurante → visita («21/10 · 11:00»)
 * → lo que consumiste en esa visita.
 *
 * D479/D482 · AF-1 · Claude Design 0.261 (1j, 1k, 1p):
 * - el restaurante lleva el cuadrito del color FIJO de su cocina;
 * - la visita es la caja 2b (tarjeta blanca con borde; abierta, su fila en navy)
 *   y ya no dice el día de la semana ni la modalidad (K3, D482); dentro de una
 *   visita en partes iguales queda «Tu parte, en partes iguales»;
 * - lo tuyo va con el formato de ¿Qué consumiste? (círculo teal con tilde) y la
 *   porción o la cantidad delante del nombre («½ Tiramisú», «2 Agua mineral»,
 *   AF-2 con `quantity` de 2.195.0);
 * - «+ Ver todo el ticket» agrega en la misma tarjeta lo de los demás, en rosado
 *   con candado y «Lo eligió otro», sin nombres (`ticketDeLaVisita.ts`). Una
 *   visita que es un ticket de viaje (`viajeId`, D260) sigue abriendo el ticket
 *   del viaje: el recibo de una mesa no lo tiene.
 *
 * El rótulo sale de `basis`. En base `payments` la visita incluye la propina y los
 * platos no: se dice con una línea al pie, sólo en esa base.
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
  const { t, idioma } = useIdioma();
  const { presentationZone } = useRegion();
  // E173-1 · sin «Fechas mostradas en …»: sólo el aviso de navegador degradado.
  const zoneCaption = personalZoneCaption(presentationZone, t);
  const { session } = useAuth();
  const [estado, setEstado] = useState<Estado>({ tipo: 'cargando' });
  const [abierto, setAbierto] = useState<string | null>(null);
  const [visitaAbierta, setVisitaAbierta] = useState<string | null>(null);
  /** AF-31 · el período elegido en 2a, conservado al navegar. */
  const clave = usePeriodoEstadisticas();

  /** F-02 · la respuesta de un período anterior no pisa la del elegido. */
  const nuevaTanda = useTandaVigente();

  const cargar = useCallback(() => {
    const vigente = nuevaTanda();
    setEstado({ tipo: 'cargando' });
    setAbierto(null);
    setVisitaAbierta(null);
    api
      .getStatsRestaurants(clave)
      .then((datos) => { if (vigente()) setEstado({ tipo: 'lista', datos }); })
      // Todo error es el mismo cartel: 404, 413 o red. El dueño no manda datos
      // parciales, así que no hay nada a medias que mostrar.
      .catch(() => { if (vigente()) setEstado({ tipo: 'error' }); });
  }, [clave, nuevaTanda]);

  useEffect(() => { cargar(); }, [cargar]);

  const datos = estado.tipo === 'lista' ? estado.datos : null;
  const conDatos = datos !== null && datos.restaurants.length > 0;
  // Sólo si el dueño CONFIRMA el período pedido: un backend anterior lo ignora
  // y manda el mes en curso, que se rotula «Este mes» y no ofrece selector.
  const soportaPeriodo = datos !== null && datos.period?.key === clave;
  const efectiva: ClavePeriodo = soportaPeriodo ? clave : 'this_month';

  function abrirRestaurante(id: string) {
    setAbierto((a) => (a === id ? null : id));
    setVisitaAbierta(null);
  }

  return (
    <div className="screen has-appbar">
      <AppHeaderBack userName={fullName(session) ?? undefined} onBack={() => goBack('estadisticas')} />
      <CabeceraDeEstadisticas icono="tienda" titulo={t('Tus restaurantes')}>
        <SelectorDePeriodo
          clave={datos === null ? clave : efectiva}
          disponible={soportaPeriodo}
          cargando={estado.tipo === 'cargando'}
          inicio={soportaPeriodo ? datos.period?.start ?? null : null}
        />
      </CabeceraDeEstadisticas>

      <div className="scroll est-scroll">
        {zoneCaption && <p className="caption">{zoneCaption}</p>}
        {estado.tipo === 'cargando' ? (
          <EsqueletoDeEstadisticas etiqueta={t('Cargando tus restaurantes')} />
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
            <p className="est-contexto">{lugaresYVisitas(datos.restaurants.length, visitasDelMes(datos), t)}</p>
            {datos.restaurants.map((r) => {
              const abiertoR = abierto === r.id;
              return (
                <section key={r.id} className="rest-card" aria-label={r.name}>
                  <button
                    type="button"
                    className="rest-fila"
                    aria-expanded={abiertoR}
                    onClick={() => abrirRestaurante(r.id)}
                  >
                    <span className="est-cuadrito" style={{ background: colorDeCocina(r.category) }} aria-hidden="true" />
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
                        const claveV = `${r.id}:${v.code}`;
                        const abiertaV = visitaAbierta === claveV;
                        return (
                          <div key={v.code} className={abiertaV ? 'rest-visita abierta' : 'rest-visita'}>
                            <button
                              type="button"
                              className="rest-visita-fila"
                              aria-expanded={abiertaV}
                              onClick={() => setVisitaAbierta((a) => (a === claveV ? null : claveV))}
                            >
                              <span className="rest-visita-fecha">{fechaDeVisita(v.createdAt, presentationZone, idioma, t)}</span>
                              <span className="rest-visita-monto">{formatMXN(v.amountCents)}</span>
                              <Icon name="chevron-down" size={18} className={abiertaV ? 'rest-chev abierto' : 'rest-chev'} />
                            </button>
                            {abiertaV && <DentroDeLaVisita visita={v} />}
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

      <AppBottomBar active={null} />
    </div>
  );
}

/**
 * «21/10 · 11:00» en la zona de presentación vigente; en inglés, mes y día
 * («10/21 · 11:00»). Sin el día de la semana (Claude Design 0.261).
 */
function fechaDeVisita(
  iso: string,
  zona: string | null,
  idioma: 'es' | 'en',
  t: (s: string, ...a: unknown[]) => string,
): string {
  const f = partesDeFecha(iso, zona);
  if (!f) return t('Fecha no disponible');
  // Sin calendario legible, `partesDeFecha` devuelve el ISO neutral y sin hora: tal cual.
  if (f.hora === '') return f.diaMes;
  const [dia, mes] = f.diaMes.split('/');
  return `${idioma === 'en' ? `${mes}/${dia}` : `${dia}/${mes}`} · ${f.hora}`;
}

/**
 * Decisión 86 de Mati · la modalidad de cada visita, con el dato que el dueño ya
 * publica (`visits[].division_mode`). Un valor que no es ninguno de los dos no
 * se nombra: se omite el rótulo, nunca se adivina.
 *
 * D482 (K3) · la modalidad ya no se muestra en la lista de visitas; queda dentro
 * de la visita en partes iguales («Tu parte, en partes iguales»). La función se
 * conserva para quien la necesite.
 */
export function modalidadDeVisita(
  divisionMode: unknown,
  t: (s: string, ...a: unknown[]) => string,
): string | null {
  if (divisionMode === 'igual') return t('Partes iguales');
  if (divisionMode === 'consumo') return t('Por consumo');
  return null;
}

/** Lo tuyo en la visita y, debajo, el botón del ticket completo. */
function DentroDeLaVisita({ visita }: { visita: Visita }) {
  const { t } = useIdioma();
  return (
    <div className="rest-dentro">
      <ul className="est-consumos" role="list">
        {visita.items.length === 0 ? (
          // Modo «igual»: la visita es tu parte y no hay platos propios.
          <li className="est-consumo mio">
            <span className="est-consumo-marca" aria-hidden="true"><Icon name="check" size={16} /></span>
            <span className="est-consumo-nombre">{t('Tu parte, en partes iguales')}</span>
          </li>
        ) : visita.items.map((it, i) => {
          const prefijo = prefijoDeLoMio(it);
          return (
            <li key={i} className="est-consumo mio">
              <span className="est-consumo-marca" aria-hidden="true"><Icon name="check" size={16} /></span>
              <span className="est-consumo-nombre">
                {prefijo && <span className="est-consumo-prefijo">{prefijo}</span>}
                {nombreDePlato(it.name)}
              </span>
              <span className="est-consumo-monto">{formatMXN(it.amountCents)}</span>
            </li>
          );
        })}
      </ul>
      {visita.viajeId !== null ? (
        <button
          type="button"
          className="est-ticket-boton"
          onClick={() => navigate('viaje-ticket', parametroDeTicket(visita.viajeId!, visita.code))}
        >
          <span className="est-ticket-signo" aria-hidden="true"><Icon name="plus" size={16} /></span>
          {t('Ver todo el ticket')}
        </button>
      ) : (
        <TicketEnLaVisita code={visita.code} />
      )}
    </div>
  );
}

type EstadoDelTicket =
  | { readonly tipo: 'cerrado' }
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'error' }
  | { readonly tipo: 'lista'; readonly filas: readonly FilaDelTicket[] };

/**
 * «+ Ver todo el ticket · {n} más» / «− Solo lo mío». La mesa se pide al tocar
 * (no antes): el «{n} más» se conoce recién después de esa lectura. Cargando y
 * error van dentro de la tarjeta, con «Reintentar». Como `TicketDigitalDialog`,
 * una respuesta de otra sesión no se muestra.
 */
function TicketEnLaVisita({ code }: { code: string }) {
  const { t } = useIdioma();
  const { session } = useAuth();
  const [estado, setEstado] = useState<EstadoDelTicket>({ tipo: 'cerrado' });
  const [abierto, setAbierto] = useState(false);
  const epoca = useRef(new RequestEpoch());

  useEffect(() => () => { epoca.current.next(); }, []);

  const pedir = () => {
    const esperada = session;
    if (!esperada || !isCurrentSession(esperada)) {
      setEstado({ tipo: 'error' });
      return;
    }
    const e = epoca.current.next();
    setEstado({ tipo: 'cargando' });
    const mismaSesion = () => {
      const actual = loadSession();
      return !!actual && actual.family_id === esperada.family_id && actual.principal_id === esperada.principal_id;
    };
    void api.getMesa(code)
      .then(({ mesa }) => {
        if (!epoca.current.isCurrent(e) || !mismaSesion()) return;
        const filas = mesa.code === code ? filasDelTicket(mesa) : null;
        setEstado(filas ? { tipo: 'lista', filas } : { tipo: 'error' });
      })
      .catch(() => {
        if (!epoca.current.isCurrent(e) || !mismaSesion()) return;
        setEstado({ tipo: 'error' });
      });
  };

  const alTocar = () => {
    if (abierto) {
      setAbierto(false);
      return;
    }
    setAbierto(true);
    if (estado.tipo !== 'lista') pedir();
  };

  const n = estado.tipo === 'lista' ? estado.filas.length : null;
  const mostrar = abierto && estado.tipo === 'lista';
  return (
    <>
      {mostrar && estado.filas.length > 0 && (
        <ul className="est-consumos" role="list">
          {estado.filas.map((f, i) => (
            <li key={i} className={`est-consumo ${f.tipo}`}>
              <span className="est-consumo-marca" aria-hidden="true">
                {f.tipo === 'otro' && <Icon name="lock" size={14} />}
              </span>
              <span className="est-consumo-texto">
                <span className="est-consumo-nombre">
                  {f.prefijo && <span className="est-consumo-prefijo">{f.prefijo}</span>}
                  {nombreDePlato(f.name)}
                </span>
                {f.tipo === 'otro' && <span className="est-consumo-rotulo">{t('Lo eligió otro')}</span>}
              </span>
              <span className="est-consumo-monto">{formatMXN(f.amountCents)}</span>
            </li>
          ))}
        </ul>
      )}
      {abierto && estado.tipo === 'cargando' && (
        <p className="est-ticket-estado" role="status">{t('Cargando detalle…')}</p>
      )}
      {abierto && estado.tipo === 'error' && (
        <div className="est-ticket-estado est-ticket-error" role="alert">
          <span>{t('No pudimos cargar el detalle')}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={pedir}>{t('Reintentar')}</button>
        </div>
      )}
      <button type="button" className="est-ticket-boton" aria-expanded={mostrar} onClick={alTocar}>
        <span className="est-ticket-signo" aria-hidden="true"><Icon name={mostrar ? 'minus' : 'plus'} size={16} /></span>
        {mostrar ? t('Solo lo mío') : n !== null && n > 0 ? t('Ver todo el ticket · {0} más', n) : t('Ver todo el ticket')}
      </button>
    </>
  );
}
