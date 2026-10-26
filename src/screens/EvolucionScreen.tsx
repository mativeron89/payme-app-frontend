import { useCallback, useEffect, useState } from 'react';
import { useIdioma } from '../i18n/idioma';
import { api } from '../api';
import { cocinasDeLaEvolucion, type Evolucion } from '../api/evolucion';
import { useAuth } from '../auth/AuthContext';
import { AppBottomBar } from '../components/AppBottomBar';
import { AppHeaderBack } from '../components/AppHeader';
import { Icon } from '../components/Icon';
import { goBack } from '../router';
import { porcentajesEnteros } from '../utils/anillo';
import { formatMXN } from '../utils/format';
import { fullName } from '../utils/identity';
import { mesCorto, pesosCortos } from '../utils/meses';
import { mesConMayuscula, mesYAnio, nombreDeCocina, rangoDeEvolucion } from '../utils/textosDeEstadisticas';
import { colorDeCocina } from '../utils/coloresDeEstadisticas';
import { CabeceraDeEstadisticas, EsqueletoDeEstadisticas } from './CabeceraDeEstadisticas';
import { IconoDeEstadisticas } from './IconosDeEstadisticas';

/**
 * **Evolución** — pantalla 2f de «Mis estadísticas» (AF-31, Roadmap n167).
 * `GET /api/account/stats/evolution`: siempre los últimos 6 meses de México, del
 * más viejo al actual, con los vacíos incluidos. **Sin selector de período**:
 * el rango es fijo, y la cabecera lo dice («Mayo a octubre · 6 meses»).
 *
 * D479/D482 · AF-1 · Claude Design 0.261 (1o):
 * - celdas «Total» y «Promedio por mes», con la explicación del promedio
 *   (D444/D449: el promedio divide entre seis meses, incluidos el mes en curso y
 *   los meses sin consumos);
 * - barras navy por mes, con el monto escrito arriba y el mes debajo;
 * - por cocina, una barra apilada por mes con los porcentajes escritos debajo
 *   («Italiana 54%»); un mes vacío dice «Sin consumos». Nunca el color solo.
 *
 * 🔴 K2 (D482) · se sacó «Octubre está $X arriba de septiembre»: comparaba el mes
 * en curso con uno cerrado, y D444 sólo compara meses completos.
 */

type Estado =
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'error' }
  | { readonly tipo: 'lista'; readonly datos: Evolucion };

/** Alto máximo de la barra del mes más alto, en px. */
const ALTO_BARRA = 120;

export function EvolucionScreen() {
  const { t, idioma } = useIdioma();
  const { session } = useAuth();
  const [estado, setEstado] = useState<Estado>({ tipo: 'cargando' });

  const cargar = useCallback(() => {
    setEstado({ tipo: 'cargando' });
    api
      .getStatsEvolution()
      .then((datos) => setEstado({ tipo: 'lista', datos }))
      // 404, 413 `stats_range_too_large`, 500 o un rechazo del decodificador.
      .catch(() => setEstado({ tipo: 'error' }));
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const datos = estado.tipo === 'lista' ? estado.datos : null;
  const conDatos = datos !== null && datos.totalCents > 0;
  const rango = datos ? `${rangoDeEvolucion(datos.months[0]!.monthStart, datos.months[5]!.monthStart, idioma)} · ${t('6 meses')}` : t('6 meses');

  return (
    <div className="screen has-appbar">
      <AppHeaderBack userName={fullName(session) ?? undefined} onBack={() => goBack('estadisticas')} />
      <CabeceraDeEstadisticas icono="tendencia" titulo={t('Evolución')}>
        <p className="est-rango">
          <IconoDeEstadisticas nombre="calendario" />
          <span>{rango}</span>
        </p>
      </CabeceraDeEstadisticas>

      <div className="scroll est-scroll">
        {estado.tipo === 'cargando' ? (
          <EsqueletoDeEstadisticas etiqueta={t('Cargando tu evolución')} />
        ) : estado.tipo === 'error' ? (
          <div className="state-error">
            <div className="state-error-row">
              <Icon name="x-circle" size={22} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="state-error-title">{t('No pudimos cargar tu evolución')}</div>
                <p className="state-error-body">{t('Revisa la conexión y prueba de nuevo.')}</p>
              </div>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={cargar}>
              {t('Reintentar')}
            </button>
          </div>
        ) : !conDatos ? (
          <div className="mesa-empty">
            <div className="mesa-empty-title">{t('Todavía no registramos consumos en los últimos 6 meses.')}</div>
          </div>
        ) : (
          <>
            <BarrasPorMes datos={datos} />
            <MezclaPorMes datos={datos} />
            {/* Sólo en base gasto: la diferencia con lo elegido se rotula (K4, D482). */}
            {datos.basis !== 'consumption' && (
              <p className="rest-pie">{t('Lo que pagaste, descontando reembolsos.')}</p>
            )}
          </>
        )}
      </div>

      <AppBottomBar active={null} />
    </div>
  );
}

function BarrasPorMes({ datos }: { datos: Evolucion }) {
  const { t, idioma } = useIdioma();
  const esConsumo = datos.basis === 'consumption';
  const max = Math.max(...datos.months.map((m) => m.totalCents), 1);
  return (
    <section className="est-panel evo-panel" aria-labelledby="evo-barras-titulo">
      <h2 id="evo-barras-titulo">{esConsumo ? t('Cuánto consumiste por mes') : t('Cuánto gastaste por mes')}</h2>
      <dl className="evo-celdas">
        <div><dt>{t('Total')}</dt><dd>{formatMXN(datos.totalCents)}</dd></div>
        <div><dt>{t('Promedio por mes')}</dt><dd>{formatMXN(datos.avgPerMonthCents)}</dd></div>
      </dl>
      <p className="est-nota">
        {t('El promedio divide el total entre seis meses, incluidos el mes en curso y los meses sin consumos.')}
      </p>
      <ul className="evo-barras" role="list">
        {datos.months.map((m) => (
          <li key={m.monthStart} className="evo-barra" aria-label={`${mesYAnio(m.monthStart, idioma)}: ${formatMXN(m.totalCents)}`}>
            <span className="evo-barra-monto" aria-hidden="true">{pesosCortos(m.totalCents)}</span>
            <span
              className="evo-barra-cuerpo"
              style={{ height: `${Math.round((m.totalCents / max) * ALTO_BARRA)}px` }}
              aria-hidden="true"
            />
            <span className="evo-barra-mes" aria-hidden="true">{mesCorto(m.monthStart, idioma)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function MezclaPorMes({ datos }: { datos: Evolucion }) {
  const { t, idioma } = useIdioma();
  const cocinas = cocinasDeLaEvolucion(datos);
  const nombre = (c: string) => nombreDeCocina(c, t) ?? t('Otra cocina');
  return (
    <section className="est-panel evo-panel" aria-labelledby="evo-mezcla-titulo">
      <h2 id="evo-mezcla-titulo">{t('Por tipo de cocina, mes a mes')}</h2>
      <ul className="est-filas" role="list">
        {datos.months.map((m) => {
          // Porcentajes enteros de cada cocina en el mes, en el orden fijo de `cocinas`.
          const pcts = porcentajesEnteros(cocinas.map((c) => m.categories.find((x) => x.category === c)?.amountCents ?? 0));
          const presentes = cocinas.map((c, i) => ({ c, pct: pcts[i]! })).filter((x) => x.pct > 0);
          return (
            <li key={m.monthStart} className="evo-mes">
              <h3>{mesConMayuscula(m.monthStart, idioma)}</h3>
              <span className="est-barra apilada" aria-hidden="true">
                {presentes.map(({ c, pct }) => (
                  <span key={c} style={{ width: `${pct}%`, background: colorDeCocina(c) }} />
                ))}
              </span>
              {m.totalCents > 0 ? (
                <ul className="evo-leyenda" role="list">
                  {presentes.map(({ c, pct }) => (
                    <li key={c}>
                      <span className="est-cuadrito chico" style={{ background: colorDeCocina(c) }} aria-hidden="true" />
                      {`${nombre(c)} ${pct}%`}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="evo-sin">{t('Sin consumos')}</p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
