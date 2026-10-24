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
import type { TusRestaurantes } from '../api/tusRestaurantes';
import type { PlatosDelPeriodo } from '../api/platos';
import type { Evolucion } from '../api/evolucion';
import {
  cocinasTexto,
  lugaresDistintos,
  nombreDeCocina,
  periodoEnFrase,
  platosTexto,
  visitasTexto,
} from '../utils/textosDeEstadisticas';
import { confirmaPeriodo, usePeriodoEstadisticas, type ClavePeriodo } from '../api/periodoEstadisticas';
import { SelectorDePeriodo } from './SelectorDePeriodo';
import { colorEnPaleta, GEOMETRIA_E173, porcentajesEnteros } from '../utils/anillo';
import { compararMesesCompletos, enteroConSigno, promedioDelResumen } from '../utils/resumenEstadisticas';
import { nombreDelPeriodo } from '../utils/meses';
import { useTandaVigente } from './useTandaVigente';
import { CuadroDeTarjeta, FilaDeTitulo } from '../components/TarjetaDeTitulo';
import { nombreDePlato } from '../utils/nombreDePlato';

/**
 * D444/D449 · presentación de los contratos vigentes de estadísticas.
 * El resumen usa consumption_month confirmado; la comparación usa dos meses
 * completos de evolución, con la misma base y MXN. Sin datos no se inventan
 * ceros. El fallback anterior y la protección de tandas se conservan.
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
  /** AF-31 · el acceso a «Qué comes» (2c), con la misma regla que el de 2b. */
  const [platos, setPlatos] = useState<Sondeo<PlatosDelPeriodo>>({ estado: 'cargando' });
  /** AF-31 · el acceso a «Evolución» (2f). No depende del período: son 6 meses fijos. */
  const [evolucion, setEvolucion] = useState<Sondeo<Evolucion>>({ estado: 'cargando' });

  /** F-02 · las respuestas de un período anterior no pisan las del elegido (las cuatro de la tanda). */
  const nuevaTanda = useTandaVigente();

  const cargar = useCallback(() => {
    const vigente = nuevaTanda();
    setFallo(false);
    setStats(null);
    setRestaurantes({ estado: 'cargando' });
    setPlatos({ estado: 'cargando' });
    setEvolucion({ estado: 'cargando' });
    api
      .getStats(clave)
      .then((s) => { if (vigente()) setStats(s); })
      .catch(() => { if (vigente()) setFallo(true); });
    api
      .getStatsRestaurants(clave)
      .then((datos) => { if (vigente()) setRestaurantes({ estado: 'listo', datos }); })
      .catch((err) => {
        if (vigente()) setRestaurantes(extractApiError(err).status === 404 ? { estado: 'no_disponible' } : { estado: 'sin_resumen' });
      });
    api
      .getStatsDishes(clave)
      .then((datos) => { if (vigente()) setPlatos({ estado: 'listo', datos }); })
      .catch((err) => {
        if (vigente()) setPlatos(extractApiError(err).status === 404 ? { estado: 'no_disponible' } : { estado: 'sin_resumen' });
      });
    api
      .getStatsEvolution()
      .then((datos) => { if (vigente()) setEvolucion({ estado: 'listo', datos }); })
      .catch((err) => {
        if (vigente()) setEvolucion(extractApiError(err).status === 404 ? { estado: 'no_disponible' } : { estado: 'sin_resumen' });
      });
  }, [clave, nuevaTanda]);

  useEffect(() => {
    if (!vista.showAccountActivity) return;
    cargar();
  }, [vista.showAccountActivity, cargar]);

  const cocina = nombreDeCocina(stats?.favorite_category, t);
  // Actividad del mes: sin visitas Y sin gasto es vacío real. Se miran los dos
  // porque "0 visitas con gasto" sería un dato incoherente del emisor, y ante
  // incoherencia preferimos mostrar los números y no tragarlos.
  const sinActividad = !!stats && !stats.month.visits && !stats.month.spent_cents;
  /**
   * AF-26 · etapa 1 del diseño 2a. Sólo con `consumption_month` VÁLIDO y con
   * algo en el mes: ausente (backend anterior), inválido o en cero ⇒ la
   * pantalla de siempre, con su vacío real.
   */
  const consumo = stats ? decodeConsumoDelMes(stats.consumption_month) : null;
  const conAnillo = consumo !== null && consumo.totalCents > 0;
  /**
   * E173-4 · decisión 173 · la pantalla de Claude Design: con `consumption_month`
   * válido, aunque el mes venga en cero. Ahí la burbuja dice $0.00 y el anillo
   * queda vacío con «Sin consumo». Sin el bloque (backend anterior o inválido)
   * sigue la pantalla de siempre.
   */
  const disenoE173 = consumo !== null;
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
  const inicio = soportaPeriodo ? confirmaPeriodo(clave, stats.period)?.start ?? null : null;

  return (
    <div className="screen has-appbar">
      {/* El diseño 2a pone el nombre de la pantalla a la derecha de «Volver», en
          13px apagado. Eso es el estilo de la cabecera COMPARTIDA (`.hdr-title`,
          hoy sin uso y con otro tamaño) y queda fuera de esta orden: se declara,
          no se improvisa acá. El nombre sigue siendo el <h1> de la burbuja. */}
      <AppHeaderBack userName={fullName(session) ?? undefined} onBack={() => goBack('home')} />
      {disenoE173 ? (
        <BurbujaDelPeriodo
          clave={efectiva}
          selector={soportaPeriodo}
          inicio={inicio}
        />
      ) : (
        <div className="title-card">
          <FilaDeTitulo icono="barras">
            <h1 className="title-card-title">{t('Mis estadísticas')}</h1>
          </FilaDeTitulo>
        </div>
      )}

      <div
        className={disenoE173 ? 'scroll est-scroll' : 'scroll'}
        style={disenoE173 ? undefined : { paddingLeft: 16, paddingRight: 16, paddingTop: 16 }}
      >
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
        ) : disenoE173 ? (
          <>
            <ResumenDelPeriodo consumo={consumo} />
            <ComparacionDeMeses acceso={evolucion} base={consumo.basis} />
            {accesoVisible && <AccesoTusRestaurantes acceso={restaurantes} clave={efectiva} inicio={inicio} />}
            {(platos.estado === 'listo' || platos.estado === 'sin_resumen') && (
              <AccesoQueComes acceso={platos} clave={efectiva} inicio={inicio} />
            )}
            {(evolucion.estado === 'listo' || evolucion.estado === 'sin_resumen') && <AccesoEvolucion acceso={evolucion} />}
            <TarjetaPorCocina consumo={consumo} clave={efectiva} />
            {/* Con un dueño anterior que no tiene la pantalla de un acceso, queda la
                sección vieja de ese dato, como antes: cada dato una vez y ninguno se
                pierde. Son datos del mes, así que sólo con este mes. */}
            {!otroPeriodo && !accesoVisible && restaurantes.estado !== 'cargando' && stats.top_restaurants.length > 0 && (
              <RestaurantesDelMes stats={stats} />
            )}
            {!otroPeriodo && platos.estado === 'no_disponible' && stats.top_dish && <PlatoMasPedido plato={stats.top_dish} />}
          </>
        ) : (
          <>
            {accesoVisible && <AccesoTusRestaurantes acceso={restaurantes} clave={efectiva} inicio={inicio} />}
            {(platos.estado === 'listo' || platos.estado === 'sin_resumen') && (
              <AccesoQueComes acceso={platos} clave={efectiva} inicio={inicio} />
            )}
            {(evolucion.estado === 'listo' || evolucion.estado === 'sin_resumen') && <AccesoEvolucion acceso={evolucion} />}
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
                  <RestaurantesDelMes stats={stats} />
                )}

                {/* `null` → la tarjeta NO se pinta. Un "plato más pedido: —"
                    ocuparía lugar para no decir nada. */}
                {stats.top_dish && <PlatoMasPedido plato={stats.top_dish} />}

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
 * La sección vieja de «Tus restaurantes»: barras por pagos del mes. La barra se
 * normaliza contra el más visitado, no contra el total: es una comparación entre
 * restaurantes, no un porcentaje del gasto.
 */
function RestaurantesDelMes({ stats }: { stats: StatsResponse }) {
  const { t } = useIdioma();
  const topVisitas = stats.top_restaurants[0]?.visits ?? 0;
  return (
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
  );
}

function PlatoMasPedido({ plato }: { plato: NonNullable<StatsResponse['top_dish']> }) {
  const { t } = useIdioma();
  return (
    <>
      <h2 className="stat-sect">{t('Plato más pedido')}</h2>
      <div className="card card-p">
        <div className="stat-dish">{nombreDePlato(plato.name)}</div>
        <div className="stat-lbl">
          {entero(plato.times)} {plato.times === 1 ? t('vez') : t('veces')}
        </div>
      </div>
    </>
  );
}

/** El total vive una sola vez en el resumen; la cabecera conserva el selector. */
function BurbujaDelPeriodo({ clave, selector, inicio }: {
  clave: ClavePeriodo;
  selector: boolean;
  inicio: string | null;
}) {
  const { t } = useIdioma();
  return (
    <div className="title-card stat-burbuja est-burbuja">
      <h1 className="stat-oculto">{t('Mis estadísticas')}</h1>
      <CuadroDeTarjeta icono="barras" />
      <SelectorDePeriodo clave={clave} disponible={selector} inicio={inicio} />
      <span className="est-periodo-estado">{clave === 'last_month' ? t('Mes completo') : t('En curso')}</span>
    </div>
  );
}

function ResumenDelPeriodo({ consumo }: { consumo: ConsumoDelMes }) {
  const { t } = useIdioma();
  const promedio = promedioDelResumen(consumo);
  return (
    <section className="est-resumen est-panel" aria-labelledby="est-resumen-titulo">
      <h2 id="est-resumen-titulo">{consumo.basis === 'consumption' ? t('Tu consumo registrado') : t('Tu gasto registrado')}</h2>
      <div className="est-total">{formatMXN(consumo.totalCents)}</div>
      <p className="est-nota">{t('MXN · Período elegido')}</p>
      <dl className="est-resumen-datos">
        <div><dt>{t('Visitas')}</dt><dd>{consumo.visits}</dd></div>
        <div><dt>{t('Promedio por visita')}</dt><dd>{promedio === null ? t('No disponible') : formatMXN(promedio)}</dd></div>
      </dl>
    </section>
  );
}

function ComparacionDeMeses({ acceso, base }: { acceso: Sondeo<Evolucion>; base: ConsumoDelMes['basis'] }) {
  const { t, idioma } = useIdioma();
  const comparacion = compararMesesCompletos(acceso.estado === 'listo' ? acceso.datos : null, base, new Date());
  const mes = (inicio: string) => new Intl.DateTimeFormat(idioma === 'en' ? 'en-US' : 'es-MX', {
    month: 'long', year: 'numeric', timeZone: 'America/Mexico_City',
  }).format(new Date(inicio));
  const importeConSigno = (centavos: number) => `${centavos > 0 ? '+' : centavos < 0 ? '−' : ''}${formatMXN(Math.abs(centavos))}`;
  const porcentaje = comparacion?.porcentaje;
  const porcentajeTexto = porcentaje === null || porcentaje === undefined ? null
    : `${porcentaje > 0 ? '+' : porcentaje < 0 ? '−' : ''}${new Intl.NumberFormat(idioma === 'en' ? 'en-US' : 'es-MX', { maximumFractionDigits: 1 }).format(Math.abs(porcentaje))}%`;
  return (
    <section className="est-comparacion est-panel" aria-labelledby="est-comparacion-titulo" aria-busy={acceso.estado === 'cargando'}>
      <h2 id="est-comparacion-titulo">{t('Meses completos')}</h2>
      <p className="est-nota">{t('Últimos dos meses completos, independientemente del período elegido.')}</p>
      {comparacion ? (
        <>
          <p className="est-comparacion-base">{base === 'consumption' ? t('Consumo registrado · MXN') : t('Gasto pagado neto de reembolsos · MXN')}</p>
          <div className="est-meses">
            {[{ datos: comparacion.anterior, promedio: comparacion.promedioAnterior }, { datos: comparacion.reciente, promedio: comparacion.promedioReciente }].map(({ datos, promedio }) => (
              <div className="est-mes" key={datos.monthStart}>
                <h3>{mes(datos.monthStart)}</h3>
                <strong>{formatMXN(datos.totalCents)}</strong>
                <span>{visitasTexto(datos.visits, t)}</span>
                <span>{t('Promedio por visita')}: {promedio === null ? t('No disponible') : formatMXN(promedio)}</span>
              </div>
            ))}
          </div>
          <p className="est-nota">{t('Cambio de {0} respecto a {1}', mes(comparacion.reciente.monthStart), mes(comparacion.anterior.monthStart))}</p>
          <dl className="est-diferencias">
            <div><dt>{base === 'consumption' ? t('Consumo registrado') : t('Gasto registrado')}</dt><dd>{importeConSigno(comparacion.diferenciaCents)}{porcentajeTexto !== null && <span> ({porcentajeTexto})</span>}</dd></div>
            <div><dt>{t('Visitas')}</dt><dd>{enteroConSigno(comparacion.diferenciaVisitas)}</dd></div>
            <div><dt>{t('Promedio por visita')}</dt><dd>{comparacion.diferenciaPromedioCents === null ? t('No disponible') : importeConSigno(comparacion.diferenciaPromedioCents)}</dd></div>
          </dl>
          {porcentajeTexto === null && <p className="est-nota">{t('Sin porcentaje de cambio: el mes de referencia tiene importe cero.')}</p>}
        </>
      ) : <p className="est-nota">{acceso.estado === 'cargando' ? t('Cargando comparación…')
        : acceso.estado === 'sin_resumen' ? t('No pudimos cargar la comparación. Intenta de nuevo más tarde.')
          : t('No hay datos comparables para estos dos meses completos.')}</p>}
    </section>
  );
}

/** Cada cocina conserva nombre, importe, visitas y porcentaje además de su barra. */
function TarjetaPorCocina({ consumo, clave }: { consumo: ConsumoDelMes; clave: ClavePeriodo }) {
  const { t } = useIdioma();
  const [abierto, setAbierto] = useState(true);
  const esConsumo = consumo.basis === 'consumption';
  // `decodeConsumoDelMes` exige que las cocinas sumen el total y que ninguna
  // venga en 0: sin cocinas es lo mismo que total 0. Una sola condición.
  const vacio = consumo.categories.length === 0;
  const montos = consumo.categories.map((c) => c.amountCents);
  const pcts = porcentajesEnteros(montos);
  // Una cocina que el front no conoce se rotula igual: el dueño pasa la
  // categoría del restaurante tal cual (ver `consumoDelMes.ts`).
  const nombres = consumo.categories.map((c) => nombreDeCocina(c.category, t) ?? t('Otra cocina'));
  const titulo = esConsumo ? t('Tu consumo por tipo de cocina') : t('Tu gasto por tipo de cocina');
  return (
    <section className="est-cocinas" aria-labelledby="est-cocinas-titulo">
      <div className="est-cocinas-cabeza">
        <h2 id="est-cocinas-titulo" className="est-cocinas-titulo">{titulo}</h2>
        <div className="est-cocinas-sub">
          {esConsumo
            ? t('Importe de lo que elegiste, agrupado por tipo de cocina del restaurante.')
            : t('Importe pagado, descontando reembolsos y agrupado por tipo de cocina del restaurante.')}
        </div>
      </div>
      <div className="est-cocinas-cantidad">
        <span className="est-cocinas-num">{vacio ? '—' : consumo.categories.length}</span>
        <span className="est-cocinas-txt">{vacio ? t('Sin consumo') : cocinasTexto(consumo.categories.length, t)}</span>
      </div>
      {vacio ? (
        <p className="est-cocinas-vacio">
          {clave === 'this_month' ? t('Todavía no registramos consumos este mes') : t('No registramos consumos en este período.')}
        </p>
      ) : (
        <>
          <button
            type="button"
            className="est-detalle"
            aria-expanded={abierto}
            aria-controls="est-detalle-lista"
            onClick={() => setAbierto((v) => !v)}
          >
            <span>{t('Detalle por cocina')}</span>
            <Icon name="chevron-down" size={18} className={`rest-chev${abierto ? ' abierto' : ''}`} />
          </button>
          {abierto && (
            <ul id="est-detalle-lista" className="est-detalle-lista" role="list" aria-label={t('Detalle por cocina')}>
              {consumo.categories.map((c, i) => (
                <li key={c.category} className="est-detalle-fila">
                  <span className="est-detalle-izq">
                    <span className="est-detalle-nombre">{nombres[i]}</span>
                    <span className="est-detalle-visitas">{visitasTexto(c.visits, t)}</span>
                  </span>
                  <span className="est-detalle-der">
                    <span className="est-detalle-monto">{formatMXN(c.amountCents)}</span>
                    <span className="est-detalle-pct">{pcts[i]}%</span>
                  </span>
                  <span className="est-cocina-barra" aria-hidden="true"><span style={{ width: `${(c.amountCents / consumo.totalCents) * 100}%`, background: colorEnPaleta(i, GEOMETRIA_E173.colores) }} /></span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

/**
 * El sondeo de una pantalla hija: 404 ⇒ backend anterior ⇒ el acceso no se
 * dibuja. Cualquier otro resultado lo dibuja (la hija sabe mostrar su error).
 */
type Sondeo<D> =
  | { readonly estado: 'cargando' }
  | { readonly estado: 'no_disponible' }
  | { readonly estado: 'sin_resumen' }
  | { readonly estado: 'listo'; readonly datos: D };

type AccesoRestaurantes = Sondeo<TusRestaurantes>;

/**
 * La fila de acceso: título, un subtítulo si lo hay (en dos líneas si hace
 * falta, nunca cortado) y la flecha. Se dibuja sólo si su pantalla existe.
 */
function FilaDeAcceso({ titulo, sub, destino }: { titulo: string; sub: string | null; destino: 'restaurantes' | 'platos' | 'evolucion' }) {
  return (
    <button type="button" className="stat-acceso" onClick={() => navigate(destino)}>
      <span className="stat-acceso-texto">
        <span className="stat-acceso-titulo">{titulo}</span>
        {sub && <span className="stat-acceso-sub">{sub}</span>}
      </span>
      <Icon name="chevron-down" size={18} className="rest-chev derecha" />
    </button>
  );
}

/** El período dentro de una frase: «octubre», «los últimos 3 meses». */
function useFraseDelPeriodo(clave: ClavePeriodo, inicio: string | null): string {
  const { t, idioma } = useIdioma();
  return periodoEnFrase(clave, nombreDelPeriodo(clave, inicio, idioma, new Date()), idioma, t);
}

/** E173-4 · «Promedio mensual de los últimos 6 meses: $1,161.66». No depende del período. */
function AccesoEvolucion({ acceso }: { acceso: Sondeo<Evolucion> }) {
  const { t } = useIdioma();
  const datos = acceso.estado === 'listo' ? acceso.datos : null;
  const sub = datos && datos.totalCents > 0
    ? t('Promedio mensual de los últimos 6 meses: {0}', formatMXN(datos.avgPerMonthCents))
    : null;
  return (
    <>
      <FilaDeAcceso titulo={t('Evolución')} sub={sub} destino="evolucion" />
      {sub && <p className="est-evolucion-nota">{t('El promedio mensual divide el total entre seis meses calendario, incluido el mes en curso y los meses sin actividad.')}</p>}
    </>
  );
}

/**
 * E173-4 · «Risotto ai Funghi es lo más elegido · 48 platos». Los platos son
 * `distinctDishes`, platos DISTINTOS (antes: «y 47 platos más» = distintos − 1).
 * Sin platos en el período: «Sin platos en octubre».
 */
function AccesoQueComes({ acceso, clave, inicio }: { acceso: Sondeo<PlatosDelPeriodo>; clave: ClavePeriodo; inicio: string | null }) {
  const { t } = useIdioma();
  const enElPeriodo = useFraseDelPeriodo(clave, inicio);
  const datos = acceso.estado === 'listo' ? acceso.datos : null;
  const primero = datos?.dishes[0];
  let sub: string | null = null;
  if (datos && primero) sub = `${t('{0} es lo más elegido', nombreDePlato(primero.name))} · ${platosTexto(datos.distinctDishes, t)}`;
  else if (datos) sub = t('Sin platos en {0}', enElPeriodo);
  return <FilaDeAcceso titulo={t('Qué comes')} sub={sub} destino="platos" />;
}

/**
 * E173-4 · «20 lugares distintos»: sólo los lugares, sin visitas ni el sufijo
 * del período (que decía «el mes pasado» con el período actual). Sin visitas:
 * «Sin visitas en octubre».
 */
function AccesoTusRestaurantes({ acceso, clave, inicio }: { acceso: AccesoRestaurantes; clave: ClavePeriodo; inicio: string | null }) {
  const { t } = useIdioma();
  const enElPeriodo = useFraseDelPeriodo(clave, inicio);
  const datos = acceso.estado === 'listo' ? acceso.datos : null;
  const sub = datos === null
    ? null
    : datos.restaurants.length > 0
      ? lugaresDistintos(datos.restaurants.length, t)
      : t('Sin visitas en {0}', enElPeriodo);
  return <FilaDeAcceso titulo={t('Tus restaurantes')} sub={sub} destino="restaurantes" />;
}
