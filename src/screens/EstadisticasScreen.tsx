import { useCallback, useEffect, useState } from 'react';
import { useIdioma } from '../i18n/idioma';
import { api } from '../api';
import type { StatsResponse } from '../api/types';
import { accountRailView } from '../api/releaseGates';
import { useWalletRail } from '../api/walletRail';
import { useAuth } from '../auth/AuthContext';
import { AppBottomBar } from '../components/AppBottomBar';
import { AppHeaderBack } from '../components/AppHeader';
import { Icon } from '../components/Icon';
import { goBack, navigate } from '../router';
import { formatMXN } from '../utils/format';
import { fullName } from '../utils/identity';
import { decodeConsumoDelMes, type ConsumoDelMes } from '../api/consumoDelMes';
import { extractApiError } from '../api/errors';
import { visitasDelMes, type TusRestaurantes } from '../api/tusRestaurantes';
import { lugaresYVisitas, nombreDeCocina, sufijoDePeriodo, visitasTexto } from '../utils/textosDeEstadisticas';
import { confirmaPeriodo, usePeriodoEstadisticas, type ClavePeriodo } from '../api/periodoEstadisticas';
import { SelectorDePeriodo } from './SelectorDePeriodo';
import { colorDeFila, porcentajesEnteros, porcionesDelAnillo, RADIO_ANILLO, GROSOR_ANILLO } from '../utils/anillo';

/**
 * **Estadísticas** — la pantalla real que lanza la pestaña del mismo nombre
 * (`SPEC_APP.md` §1.11, pestaña 2). Card-only ratificado: cuelga de
 * `showAccountActivity`, nunca del gate del riel saldo.
 *
 * ## La regla que gobierna toda esta pantalla
 *
 * **Sólo lo que `GET /account/stats` acredita hoy.** Nada se infiere, nada se
 * mockea y no se dibuja un número de ejemplo. Un campo `null` o ausente muestra
 * un guion —que significa *"no disponible"*, nunca *"cero"*— y un mes sin
 * actividad es **vacío real**, no cero pesos gastados: son cosas distintas y el
 * sistema las distingue.
 *
 * AF-26 (2026-09-19) · etapa 1 del diseño 2a: con `consumption_month` válido,
 * la burbuja del mes y el anillo por tipo de cocina encabezan la pantalla, y
 * las secciones de siempre siguen debajo. Se retiró el cartel «Todavía no existe
 * en el contrato»: por orden del Bibliotecario, lo que falta ahora va por
 * etapas del diseño (2b–2f), no como aviso al pie. Los cuatro accesos de 2a no
 * se dibujan: ninguno tiene todavía una pantalla a la que llevar.
 */

/** Guion, no cero. Un `—` dice "no disponible"; un `0` afirma un valor. */
const NO_DISPONIBLE = '—';

function pesos(cents: number | null | undefined): string {
  return typeof cents === 'number' && Number.isFinite(cents) ? formatMXN(cents) : NO_DISPONIBLE;
}

function entero(n: number | null | undefined): string {
  return typeof n === 'number' && Number.isFinite(n) ? String(n) : NO_DISPONIBLE;
}

export function EstadisticasScreen() {
  const { t } = useIdioma();
  const { session } = useAuth();
  const { walletRailEnabled, accountActivity } = useWalletRail();
  const vista = accountRailView(walletRailEnabled, accountActivity);

  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [fallo, setFallo] = useState(false);

  /**
   * AF-29 · el acceso a «Tus restaurantes» (2b) depende de que el dueño tenga la
   * ruta: 404 ⇒ backend anterior ⇒ el acceso NO se dibuja y queda la sección
   * vieja de barras. Cualquier otro resultado (datos, vacío, 413 o red) dibuja el
   * acceso: la pantalla 2b sabe mostrar su error con «Reintentar».
   */
  const [restaurantes, setRestaurantes] = useState<AccesoRestaurantes>({ estado: 'cargando' });
  /** AF-31 · el período elegido, compartido con 2b y 2c. */
  const clave = usePeriodoEstadisticas();

  const cargar = useCallback(() => {
    setFallo(false);
    setStats(null);
    setRestaurantes({ estado: 'cargando' });
    api
      .getStats(clave)
      .then(setStats)
      .catch(() => setFallo(true));
    api
      .getStatsRestaurants(clave)
      .then((datos) => setRestaurantes({ estado: 'listo', datos }))
      .catch((err) => {
        setRestaurantes(extractApiError(err).status === 404 ? { estado: 'no_disponible' } : { estado: 'sin_resumen' });
      });
  }, [clave]);

  useEffect(() => {
    if (!vista.showAccountActivity) return;
    cargar();
  }, [vista.showAccountActivity, cargar]);

  const cocina = nombreDeCocina(stats?.favorite_category, t);
  // Actividad del mes: sin visitas Y sin gasto es vacío real. Se miran los dos
  // porque "0 visitas con gasto" sería un dato incoherente del emisor, y ante
  // incoherencia preferimos mostrar los números y no tragarlos.
  const sinActividad = !!stats && !stats.month.visits && !stats.month.spent_cents;
  // La barra de proporción se normaliza contra el más visitado, no contra el
  // total: es una comparación entre restaurantes, no un porcentaje del gasto.
  const topVisitas = stats?.top_restaurants[0]?.visits ?? 0;
  /**
   * AF-26 · etapa 1 del diseño 2a. Sólo con `consumption_month` VÁLIDO y con
   * algo en el mes: ausente (backend anterior), inválido o en cero ⇒ la
   * pantalla de siempre, con su vacío real.
   */
  const consumo = stats ? decodeConsumoDelMes(stats.consumption_month) : null;
  const conAnillo = consumo !== null && consumo.totalCents > 0;
  /**
   * AF-31 · el período sólo vale si el dueño lo CONFIRMA (`period.key` igual al
   * pedido). Un backend anterior ignora `?period=` y manda el mes en curso: ahí
   * no hay selector y todo se rotula «Este mes».
   *
   * 🔴 **El período mueve SÓLO `consumption_month`** (handoff v2.106.0). «Plato
   * más pedido», «Tipo de cocina favorito» y las barras viejas salen de pagos y
   * no tienen filtro de fecha, así que con otro período se ocultan: mostrarlos
   * al lado del anillo mezclaría números de períodos distintos.
   */
  // El período sólo mueve `consumption_month`: sin ese bloque válido (ausente o
  // inválido) no hay nada que el selector cambie, y queda la pantalla de siempre.
  const soportaPeriodo = stats !== null && consumo !== null && confirmaPeriodo(clave, stats.period) !== null;
  const efectiva: ClavePeriodo = soportaPeriodo ? clave : 'this_month';
  const otroPeriodo = efectiva !== 'this_month';
  const accesoVisible = restaurantes.estado === 'listo' || restaurantes.estado === 'sin_resumen';

  return (
    <div className="screen has-appbar">
      {/* El diseño 2a pone el nombre de la pantalla a la derecha de «Volver», en
          13px apagado. Eso es el estilo de la cabecera COMPARTIDA (`.hdr-title`,
          hoy sin uso y con otro tamaño) y queda fuera de esta orden: se declara,
          no se improvisa acá. El nombre sigue siendo el <h1> de la burbuja. */}
      <AppHeaderBack userName={fullName(session) ?? undefined} onBack={() => goBack('home')} />
      {conAnillo || soportaPeriodo ? (
        <BurbujaDelMes consumo={conAnillo ? consumo : null} clave={efectiva} selector={soportaPeriodo} />
      ) : (
        <div className="title-card">
          <h1 className="title-card-title">{t('Mis estadísticas')}</h1>
        </div>
      )}

      <div className="scroll" style={{ paddingLeft: 16, paddingRight: 16, paddingTop: 16 }}>
        {!vista.showAccountActivity ? (
          <div className="state-unknown">
            <Icon name="info" size={20} />
            <div>
              <div className="state-unknown-title">{t('No podemos mostrar tus estadísticas ahora')}</div>
              <p className="state-unknown-body">{t('Prueba de nuevo más tarde.')}</p>
            </div>
          </div>
        ) : fallo ? (
          <div className="state-error">
            <div className="state-error-row">
              <Icon name="x-circle" size={22} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="state-error-title">{t('No pudimos cargar tus estadísticas')}</div>
                <p className="state-error-body">{t('Revisa la conexión y prueba de nuevo.')}</p>
              </div>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={cargar}>
              {t('Reintentar')}
            </button>
          </div>
        ) : stats === null ? (
          <div aria-busy="true" aria-label={t('Cargando tus estadísticas')}>
            <div className="stat-hero sk">
              <span className="sk-line w40" />
              <span className="sk-line w70 tall" />
            </div>
          </div>
        ) : (
          <>
            {accesoVisible && <AccesoTusRestaurantes acceso={restaurantes} clave={clave} />}
            {conAnillo && <AnilloPorCocina consumo={consumo} clave={efectiva} />}
            {!conAnillo && otroPeriodo ? (
              <div className="mesa-empty">
                <div className="mesa-empty-title">{t('No registramos consumos en este período.')}</div>
              </div>
            ) : otroPeriodo ? null : !conAnillo && sinActividad ? (
              /* Vacío REAL, sin borde. NO se pinta "$0.00 gastado": no gastar
                 nada y no tener datos son cosas distintas. */
              <div className="mesa-empty">
                <div className="mesa-empty-title">{t('Todavía no registramos consumos este mes.')}</div>
              </div>
            ) : (
              <>
                {/* El ancla de la pantalla. Con el anillo, el ancla es la burbuja. */}
                {!conAnillo && (
                <div className="stat-hero">
                  <div className="stat-hero-lbl">{t('Este mes')}</div>
                  <div className="stat-hero-amt">{pesos(stats.month.spent_cents)}</div>
                </div>

                )}

                {!conAnillo && (
                <div className="stat-pair">
                  <div className="stat-cell">
                    <div className="stat-num">{entero(stats.month.visits)}</div>
                    <div className="stat-lbl">{t('Visitas')}</div>
                  </div>
                  <div className="stat-cell">
                    <div className="stat-num tabular">{pesos(stats.month.avg_per_visit_cents)}</div>
                    <div className="stat-lbl">{t('Promedio por visita')}</div>
                  </div>
                </div>
                )}

                {/* La sección vieja (barras por pagos) queda SÓLO si el acceso nuevo
                    no está: con él, «Tus restaurantes» es la pantalla 2b. */}
                {!accesoVisible && restaurantes.estado !== 'cargando' && stats.top_restaurants.length > 0 && (
                  <>
                    <h2 className="stat-sect">{t('Tus restaurantes')}</h2>
                    <div className="card card-p">
                      {stats.top_restaurants.map((r) => (
                        <div key={r.name} className="stat-rest">
                          <div className="stat-rest-top">
                            <span className="stat-rest-name">{r.name}</span>
                            {/* La barra NUNCA va sola: el número de visitas
                                siempre en texto, al lado. */}
                            <span className="stat-rest-visits">
                              {entero(r.visits)} {r.visits === 1 ? t('visita') : t('visitas')}
                            </span>
                          </div>
                          <div className="mesa-bar" aria-hidden="true">
                            <span
                              style={{
                                width: `${topVisitas > 0 ? Math.round((r.visits / topVisitas) * 100) : 0}%`,
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {/* `null` → la tarjeta NO se pinta. Un "plato más pedido: —"
                    ocuparía lugar para no decir nada. */}
                {stats.top_dish && (
                  <>
                    <h2 className="stat-sect">{t('Plato más pedido')}</h2>
                    <div className="card card-p">
                      <div className="stat-dish">{stats.top_dish.name}</div>
                      <div className="stat-lbl">
                        {entero(stats.top_dish.times)}{' '}
                        {stats.top_dish.times === 1 ? t('vez') : t('veces')}
                      </div>
                    </div>
                  </>
                )}

                {cocina && (
                  <>
                    <h2 className="stat-sect">{t('Tipo de cocina favorito')}</h2>
                    <span className="chip">{cocina}</span>
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>

      <AppBottomBar active={null} />
    </div>
  );
}

/**
 * AF-26 · burbuja de 2a: el período a la izquierda —«Este mes», SIN flecha ni
 * selector, porque todavía no hay otros períodos— y el total a la derecha con
 * visitas y promedio debajo. El `<h1>` de la pantalla sigue siendo «Mis
 * estadísticas», sólo para lectores de pantalla: a la vista va en la cabecera.
 */
function BurbujaDelMes({
  consumo,
  clave,
  selector,
}: {
  consumo: ConsumoDelMes | null;
  clave: ClavePeriodo;
  selector: boolean;
}) {
  const { t } = useIdioma();
  return (
    <div className="title-card stat-burbuja">
      <h1 className="stat-oculto">{t('Mis estadísticas')}</h1>
      {/* AF-31 · el período con su flecha, sólo si el dueño lo confirmó. Un
          período sin consumo conserva la burbuja: si no, el selector se iría y
          no habría cómo volver. */}
      <SelectorDePeriodo clave={clave} disponible={selector} />
      {consumo && (
        <div className="stat-burbuja-dato">
          <div className="stat-burbuja-total">{formatMXN(consumo.totalCents)}</div>
          <div className="stat-burbuja-contexto">
            {visitasTexto(consumo.visits, t)} · {t('{0} promedio', formatMXN(consumo.avgPerVisitCents))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * AF-26 · el anillo por tipo de cocina (2a) y su lista. El rótulo sale de
 * `basis` —«consumo» con los pagos apagados, «gasto» con pagos—: el front no
 * adivina. **Nunca el color solo**: cada porción está escrita abajo con nombre,
 * visitas, monto y porcentaje, y el anillo lleva todo eso en su `aria-label`.
 */
function AnilloPorCocina({ consumo, clave }: { consumo: ConsumoDelMes; clave: ClavePeriodo }) {
  const { t } = useIdioma();
  const esConsumo = consumo.basis === 'consumption';
  const montos = consumo.categories.map((c) => c.amountCents);
  const pcts = porcentajesEnteros(montos);
  const porciones = porcionesDelAnillo(montos);
  // Una cocina que el front no conoce se rotula igual: el dueño pasa la
  // categoría del restaurante tal cual (ver `consumoDelMes.ts`).
  const nombres = consumo.categories.map((c) => nombreDeCocina(c.category, t) ?? t('Otra cocina'));
  const resumen = nombres.map((n, i) => `${n} ${pcts[i]}%`).join(', ');
  const centro = 70;
  return (
    <section className="stat-anillo-card" aria-labelledby="stat-anillo-titulo">
      <div>
        <h2 id="stat-anillo-titulo" className="stat-anillo-titulo">
          {clave === 'this_month'
            ? (esConsumo ? t('Tu consumo del mes') : t('Tu gasto del mes'))
            : (esConsumo ? t('Tu consumo en el período') : t('Tu gasto en el período'))}
        </h2>
        <div className="stat-anillo-sub">
          {esConsumo ? t('Lo que elegiste en tus mesas') : t('Lo que pagaste, descontando reembolsos')}
        </div>
      </div>
      <div className="stat-anillo">
        <svg
          width="188"
          height="188"
          viewBox="0 0 140 140"
          role="img"
          aria-label={esConsumo ? t('Consumo por tipo de cocina: {0}', resumen) : t('Gasto por tipo de cocina: {0}', resumen)}
        >
          <g transform={`rotate(-90 ${centro} ${centro})`} fill="none" strokeWidth={GROSOR_ANILLO} strokeLinecap="butt">
            {porciones.map((p, i) => (
              <circle
                key={i}
                cx={centro}
                cy={centro}
                r={RADIO_ANILLO}
                stroke={p.color}
                strokeDasharray={`${p.trazo.toFixed(1)} ${p.hueco.toFixed(1)}`}
                strokeDashoffset={p.desde.toFixed(1)}
              />
            ))}
          </g>
        </svg>
        <div className="stat-anillo-centro" aria-hidden="true">
          <div className="stat-anillo-total">{formatMXN(consumo.totalCents)}</div>
          <div className="stat-anillo-unidad">{esConsumo ? t('de consumo') : t('de gasto')}</div>
        </div>
      </div>
      <ul className="stat-anillo-lista">
        {consumo.categories.map((c, i) => (
          <li key={c.category} className="stat-anillo-fila">
            <span className="stat-anillo-color" style={{ background: colorDeFila(i) }} aria-hidden="true" />
            <span className="stat-anillo-nombre">{nombres[i]}</span>
            <span className="stat-anillo-visitas">{visitasTexto(c.visits, t)}</span>
            <span className="stat-anillo-monto">{formatMXN(c.amountCents)}</span>
            <span className="stat-anillo-pct">{pcts[i]}%</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

type AccesoRestaurantes =
  | { readonly estado: 'cargando' }
  | { readonly estado: 'no_disponible' }
  | { readonly estado: 'sin_resumen' }
  | { readonly estado: 'listo'; readonly datos: TusRestaurantes };

/**
 * AF-29 · el acceso de 2a a «Tus restaurantes». Es el único de los cuatro del
 * diseño que se dibuja: los otros (Qué comés, Evolución) todavía no tienen
 * pantalla. Con datos dice cuántos lugares y visitas; sin ellos, sólo el título.
 */
function AccesoTusRestaurantes({ acceso, clave }: { acceso: AccesoRestaurantes; clave: ClavePeriodo }) {
  const { t } = useIdioma();
  const datos = acceso.estado === 'listo' ? acceso.datos : null;
  return (
    <button type="button" className="stat-acceso" onClick={() => navigate('restaurantes')}>
      <span className="stat-acceso-texto">
        <span className="stat-acceso-titulo">{t('Tus restaurantes')}</span>
        {datos && datos.restaurants.length > 0 && (
          <span className="stat-acceso-sub">
            {lugaresYVisitas(datos.restaurants.length, visitasDelMes(datos), t)}{' '}
            {/* Sólo si el dueño confirmó el período: si no, lo que llegó es el mes en curso. */}
            {sufijoDePeriodo(datos.period?.key === clave ? clave : 'this_month', t)}
          </span>
        )}
      </span>
      <Icon name="chevron-down" size={20} className="rest-chev derecha" />
    </button>
  );
}
