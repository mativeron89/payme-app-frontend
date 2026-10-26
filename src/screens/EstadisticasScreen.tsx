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
import type { PlatosDelPeriodo } from '../api/platos';
import type { Evolucion } from '../api/evolucion';
import {
  lugaresYVisitas,
  mesEnFrase,
  mesYAnio,
  nombreDeCocina,
  platosDistintos,
  rotuloDeLaBase,
  sufijoDePeriodo,
  visitasTexto,
} from '../utils/textosDeEstadisticas';
import { confirmaPeriodo, usePeriodoEstadisticas, type ClavePeriodo } from '../api/periodoEstadisticas';
import { SelectorDePeriodo } from './SelectorDePeriodo';
import { porcentajesEnteros } from '../utils/anillo';
import { colorDeCocina } from '../utils/coloresDeEstadisticas';
import { compararMesesCompletos, enteroConSigno, promedioDelResumen } from '../utils/resumenEstadisticas';
import { useTandaVigente } from './useTandaVigente';
import { CabeceraDeEstadisticas, EsqueletoDeEstadisticas } from './CabeceraDeEstadisticas';
import { IconoDeEstadisticas } from './IconosDeEstadisticas';
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
      <AppHeaderBack userName={fullName(session) ?? undefined} onBack={() => goBack('home')} />
      {/* D479/D482 · AF-1 · la misma tarjeta en cargando, error, vacío y lista.
          Hasta que el dueño confirme el período, el período elegido quieto. */}
      <CabeceraDeEstadisticas icono="barras" titulo={t('Mis estadísticas')}>
        <SelectorDePeriodo
          clave={stats === null ? clave : efectiva}
          disponible={soportaPeriodo}
          cargando={stats === null && !fallo}
          inicio={inicio}
        />
      </CabeceraDeEstadisticas>

      <div className="scroll est-scroll">
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
          <EsqueletoDeEstadisticas etiqueta={t('Cargando tus estadísticas')} />
        ) : disenoE173 ? (
          <>
            <ResumenDelPeriodo consumo={consumo} clave={efectiva} />
            <TarjetaPorCocina consumo={consumo} />
            <ListaDeAccesos
              restaurantes={accesoVisible ? restaurantes : null}
              platos={platos.estado === 'listo' || platos.estado === 'sin_resumen' ? platos : null}
              evolucion={evolucion.estado === 'listo' || evolucion.estado === 'sin_resumen' ? evolucion : null}
              clave={efectiva}
            />
            <ComparacionDeMeses acceso={evolucion} base={consumo.basis} />
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
            <ListaDeAccesos
              restaurantes={accesoVisible ? restaurantes : null}
              platos={platos.estado === 'listo' || platos.estado === 'sin_resumen' ? platos : null}
              evolucion={evolucion.estado === 'listo' || evolucion.estado === 'sin_resumen' ? evolucion : null}
              clave={efectiva}
            />
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

function ResumenDelPeriodo({ consumo, clave }: { consumo: ConsumoDelMes; clave: ClavePeriodo }) {
  const { t } = useIdioma();
  const promedio = promedioDelResumen(consumo);
  const esConsumo = consumo.basis === 'consumption';
  // 1g · el vacío es una frase, nunca un $0 grande: no tener datos no es gastar cero.
  const vacio = consumo.totalCents === 0;
  return (
    <section className="est-resumen est-panel" aria-labelledby="est-resumen-titulo">
      <h2 id="est-resumen-titulo">{esConsumo ? t('Tu consumo registrado') : t('Tu gasto registrado')}</h2>
      {vacio ? (
        <p className="est-vacio">
          {esConsumo
            ? t('Todavía no registramos consumos {0}.', sufijoDePeriodo(clave, t))
            : t('Todavía no registramos pagos {0}.', sufijoDePeriodo(clave, t))}
        </p>
      ) : (
        <div className="est-total">{formatMXN(consumo.totalCents)}</div>
      )}
      <dl className="est-resumen-datos">
        <div><dt>{t('Visitas')}</dt><dd>{consumo.visits}</dd></div>
        <div><dt>{t('Promedio por visita')}</dt><dd className={promedio === null ? 'est-no-disponible' : undefined}>{promedio === null ? t('No disponible') : formatMXN(promedio)}</dd></div>
      </dl>
    </section>
  );
}

/** Una diferencia con flecha y signo: «↑ +$640 (+94.1%)». En cero, sin flecha. */
function Diferencia({ signo, texto }: { signo: number; texto: string }) {
  return (
    <dd>
      {signo > 0 && <IconoDeEstadisticas nombre="flecha-arriba" tamano={16} />}
      {signo < 0 && <IconoDeEstadisticas nombre="flecha-abajo" tamano={16} />}
      <span>{texto}</span>
    </dd>
  );
}

/**
 * Meses completos, al final de la principal: los dos últimos meses CERRADOS de
 * Evolución (`[3]` y `[4]`), nunca el mes en curso. «No cambia con el período».
 * El cálculo es `compararMesesCompletos`, sin cambios.
 */
function ComparacionDeMeses({ acceso, base }: { acceso: Sondeo<Evolucion>; base: ConsumoDelMes['basis'] }) {
  const { t, idioma } = useIdioma();
  const comparacion = compararMesesCompletos(acceso.estado === 'listo' ? acceso.datos : null, base, new Date());
  const numero = new Intl.NumberFormat(idioma === 'en' ? 'en-US' : 'es-MX', { maximumFractionDigits: 1 });
  const importeConSigno = (centavos: number) => `${centavos > 0 ? '+' : centavos < 0 ? '−' : ''}${formatMXN(Math.abs(centavos))}`;
  const porcentaje = comparacion?.porcentaje;
  const porcentajeTexto = porcentaje === null || porcentaje === undefined ? null
    : `${porcentaje > 0 ? '+' : porcentaje < 0 ? '−' : ''}${numero.format(Math.abs(porcentaje))}%`;
  const sub = comparacion
    ? t('{0} frente a {1}. No cambia con el período.',
      mesEnFraseInicial(comparacion.reciente.monthStart, idioma), mesEnFrase(comparacion.anterior.monthStart, idioma))
    : t('No cambia con el período.');
  return (
    <section className="est-comparacion est-panel" aria-labelledby="est-comparacion-titulo" aria-busy={acceso.estado === 'cargando'}>
      <h2 id="est-comparacion-titulo">{t('Meses completos')}</h2>
      <p className="est-nota">{sub}</p>
      {comparacion ? (
        <>
          <div className="est-meses">
            {[{ datos: comparacion.anterior, promedio: comparacion.promedioAnterior }, { datos: comparacion.reciente, promedio: comparacion.promedioReciente }].map(({ datos, promedio }) => (
              <div className="est-mes" key={datos.monthStart}>
                <h3>{mesYAnio(datos.monthStart, idioma)}</h3>
                <strong>{formatMXN(datos.totalCents)}</strong>
                <span>
                  {promedio === null
                    ? t('{0} · promedio no disponible', visitasTexto(datos.visits, t))
                    : t('{0} · {1} por visita', visitasTexto(datos.visits, t), formatMXN(promedio))}
                </span>
              </div>
            ))}
          </div>
          <dl className="est-diferencias">
            <div>
              <dt>{rotuloDeLaBase(base, idioma)}</dt>
              <Diferencia signo={comparacion.diferenciaCents} texto={`${importeConSigno(comparacion.diferenciaCents)}${porcentajeTexto !== null ? ` (${porcentajeTexto})` : ''}`} />
            </div>
            <div>
              <dt>{t('Visitas')}</dt>
              <Diferencia signo={comparacion.diferenciaVisitas} texto={enteroConSigno(comparacion.diferenciaVisitas)} />
            </div>
            <div>
              <dt>{t('Promedio por visita')}</dt>
              {comparacion.diferenciaPromedioCents === null
                ? <dd className="est-no-disponible">{t('No disponible')}</dd>
                : <Diferencia signo={comparacion.diferenciaPromedioCents} texto={importeConSigno(comparacion.diferenciaPromedioCents)} />}
            </div>
          </dl>
          {porcentajeTexto === null && (
            <p className="est-nota">{t('Sin porcentaje: {0} está en $0.', mesEnFrase(comparacion.anterior.monthStart, idioma))}</p>
          )}
        </>
      ) : <p className="est-sin-comparacion">{acceso.estado === 'cargando' ? t('Cargando comparación…')
        : acceso.estado === 'sin_resumen' ? t('No pudimos cargar la comparación. Intenta de nuevo más tarde.')
          : t('No hay datos comparables para estos dos meses completos.')}</p>}
    </section>
  );
}

/** El mes al principio de una frase: «Septiembre frente a agosto». */
function mesEnFraseInicial(monthStart: string, idioma: 'es' | 'en'): string {
  const m = mesEnFrase(monthStart, idioma);
  return m.charAt(0).toUpperCase() + m.slice(1);
}

/**
 * Por tipo de cocina: un bloque por cocina con su cuadrito de color FIJO, nombre,
 * importe, visitas, porcentaje y barra. Nunca el color solo. En el vacío no se
 * muestra: la frase del resumen ya lo dice.
 */
function TarjetaPorCocina({ consumo }: { consumo: ConsumoDelMes }) {
  const { t } = useIdioma();
  // `decodeConsumoDelMes` exige que las cocinas sumen el total y que ninguna
  // venga en 0: sin cocinas es lo mismo que total 0.
  if (consumo.categories.length === 0) return null;
  const pcts = porcentajesEnteros(consumo.categories.map((c) => c.amountCents));
  return (
    <section className="est-panel est-cocinas" aria-labelledby="est-cocinas-titulo">
      <h2 id="est-cocinas-titulo">{t('Por tipo de cocina')}</h2>
      <ul className="est-filas" role="list">
        {consumo.categories.map((c, i) => (
          <li key={c.category} className="est-fila">
            <span className="est-fila-arriba">
              <span className="est-cuadrito" style={{ background: colorDeCocina(c.category) }} aria-hidden="true" />
              {/* Una cocina que el front no conoce se rotula igual: el dueño pasa la categoría tal cual. */}
              <span className="est-fila-nombre">{nombreDeCocina(c.category, t) ?? t('Otra cocina')}</span>
              <span className="est-fila-monto">{formatMXN(c.amountCents)}</span>
            </span>
            <span className="est-fila-abajo">
              <span>{visitasTexto(c.visits, t)}</span>
              <span>{pcts[i]}%</span>
            </span>
            <span className="est-barra" aria-hidden="true">
              <span style={{ width: `${(c.amountCents / consumo.totalCents) * 100}%`, background: colorDeCocina(c.category) }} />
            </span>
          </li>
        ))}
      </ul>
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
 * La fila de acceso: ícono, título, un subtítulo si lo hay y la flecha. Se dibuja
 * sólo si su pantalla existe (404 ⇒ backend anterior ⇒ no se dibuja).
 */
function FilaDeAcceso({ icono, titulo, sub, destino }: {
  icono: 'tienda' | 'cubiertos' | 'tendencia';
  titulo: string;
  sub: string | null;
  destino: 'restaurantes' | 'platos' | 'evolucion';
}) {
  return (
    <li>
      <button type="button" className="est-acceso" onClick={() => navigate(destino)}>
        <IconoDeEstadisticas nombre={icono} tamano={22} />
        <span className="est-acceso-texto">
          <span className="est-acceso-titulo">{titulo}</span>
          {sub && <span className="est-acceso-sub">{sub}</span>}
        </span>
        <Icon name="chevron-right" size={18} className="est-acceso-flecha" />
      </button>
    </li>
  );
}

/**
 * Los tres accesos en una sola tarjeta-lista (1a): «3 lugares · 6 visitas»,
 * «7 platos distintos» y «Últimos 6 meses». Vacíos: «Sin visitas este mes» /
 * «Sin platos este mes». `null` = ese acceso no se dibuja.
 */
function ListaDeAccesos({ restaurantes, platos, evolucion, clave }: {
  restaurantes: AccesoRestaurantes | null;
  platos: Sondeo<PlatosDelPeriodo> | null;
  evolucion: Sondeo<Evolucion> | null;
  clave: ClavePeriodo;
}) {
  const { t } = useIdioma();
  if (!restaurantes && !platos && !evolucion) return null;
  const enElPeriodo = sufijoDePeriodo(clave, t);
  const datosR = restaurantes?.estado === 'listo' ? restaurantes.datos : null;
  const datosP = platos?.estado === 'listo' ? platos.datos : null;
  const subR = datosR === null ? null
    : datosR.restaurants.length > 0 ? lugaresYVisitas(datosR.restaurants.length, visitasDelMes(datosR), t)
      : t('Sin visitas {0}', enElPeriodo);
  const subP = datosP === null ? null
    : datosP.dishes.length > 0 ? platosDistintos(datosP.distinctDishes, t)
      : t('Sin platos {0}', enElPeriodo);
  return (
    <nav className="est-panel est-accesos" aria-label={t('Mis estadísticas')}>
      <ul role="list">
        {restaurantes && <FilaDeAcceso icono="tienda" titulo={t('Tus restaurantes')} sub={subR} destino="restaurantes" />}
        {platos && <FilaDeAcceso icono="cubiertos" titulo={t('Qué comes')} sub={subP} destino="platos" />}
        {evolucion && <FilaDeAcceso icono="tendencia" titulo={t('Evolución')} sub={t('Últimos 6 meses')} destino="evolucion" />}
      </ul>
    </nav>
  );
}
