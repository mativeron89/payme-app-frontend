import { useCallback, useEffect, useState } from 'react';
import { useIdioma } from '../i18n/idioma';
import { api } from '../api';
import { cocinasDeLaEvolucion, type Evolucion } from '../api/evolucion';
import { useAuth } from '../auth/AuthContext';
import { AppBottomBar } from '../components/AppBottomBar';
import { AppHeaderBack } from '../components/AppHeader';
import { Icon } from '../components/Icon';
import { goBack } from '../router';
import { colorDeFila, porcentajesEnteros } from '../utils/anillo';
import { formatMXN } from '../utils/format';
import { fullName } from '../utils/identity';
import { mesCorto, mesLargo, pesosCortos } from '../utils/meses';
import { nombreDeCocina } from '../utils/textosDeEstadisticas';

/**
 * **Evolución** — pantalla 2f de «Mis estadísticas» (AF-31, Roadmap n167).
 * `GET /api/account/stats/evolution`: siempre los últimos 6 meses de México, del
 * más viejo al actual, con los vacíos incluidos. **Sin selector de período**:
 * el rango es fijo (orden).
 *
 * - Barras verticales por mes, en CSS: el actual en el cian del diseño
 *   (`#0FB5C9`, `--teal` en esta app) y el resto apagado. Cada barra lleva su
 *   monto y su mes escritos.
 * - Columnas apiladas al 100 % con la mezcla de cocinas: cada una con su
 *   `aria-label` y una leyenda escrita que compara el primer mes con hoy. Nunca
 *   el color solo.
 *
 * 🔴 **El diseño dice «septiembre en `--brand`»**, pero en esta app `--brand` es
 * el naranja (`#ff6b35`) y el archivo del diseño pinta la barra en `#0FB5C9`. Se
 * sigue al píxel del diseño; declarado en la entrega.
 */

type Estado =
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'error' }
  | { readonly tipo: 'lista'; readonly datos: Evolucion };

/** Alto máximo de la barra del mes más alto, en px (el diseño: 126 para el mayor). */
const ALTO_BARRA = 126;

export function EvolucionScreen() {
  const { t } = useIdioma();
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

  return (
    <div className="screen has-appbar">
      <AppHeaderBack userName={fullName(session) ?? undefined} onBack={() => goBack('estadisticas')} />
      <div className="title-card stat-burbuja">
        <h1 className="stat-oculto">{t('Evolución')}</h1>
        <div className="stat-burbuja-periodo">{t('6 meses')}</div>
        {conDatos && (
          <div className="stat-burbuja-dato">
            <div className="stat-burbuja-total">{formatMXN(datos.totalCents)}</div>
            <div className="stat-burbuja-contexto">{t('{0} promedio por mes', formatMXN(datos.avgPerMonthCents))}</div>
          </div>
        )}
      </div>

      <div className="scroll" style={{ paddingLeft: 16, paddingRight: 16, paddingTop: 16 }}>
        {estado.tipo === 'cargando' ? (
          <div aria-busy="true" aria-label={t('Cargando tu evolución')}>
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
            <p className="rest-pie">
              {datos.basis === 'consumption'
                ? t('Lo que elegiste en tus mesas.')
                : t('Lo que pagaste, descontando reembolsos.')}
            </p>
          </>
        )}
      </div>

      <AppBottomBar active={null} />
    </div>
  );
}

function capitalizar(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function BarrasPorMes({ datos }: { datos: Evolucion }) {
  const { t, idioma } = useIdioma();
  const esConsumo = datos.basis === 'consumption';
  const max = Math.max(...datos.months.map((m) => m.totalCents), 1);
  const actual = datos.months[5];
  const anterior = datos.months[4];
  const diferencia = actual.totalCents - anterior.totalCents;
  const nombreActual = capitalizar(mesLargo(actual.monthStart, idioma));
  const nombreAnterior = mesLargo(anterior.monthStart, idioma);
  const comparacion = diferencia < 0
    ? t('{0} está {1} abajo de {2}', nombreActual, formatMXN(-diferencia), nombreAnterior)
    : diferencia > 0
      ? t('{0} está {1} arriba de {2}', nombreActual, formatMXN(diferencia), nombreAnterior)
      : t('{0} está igual que {1}', nombreActual, nombreAnterior);
  return (
    <section className="stat-anillo-card evo-card" aria-labelledby="evo-barras-titulo">
      <div>
        <h2 id="evo-barras-titulo" className="stat-anillo-titulo">
          {esConsumo ? t('Cuánto consumiste por mes') : t('Cuánto gastaste por mes')}
        </h2>
        <div className="stat-anillo-sub">{comparacion}</div>
      </div>
      <ul className="evo-barras">
        {datos.months.map((m, i) => (
          <li key={m.monthStart} className={`evo-barra ${i === 5 ? 'actual' : ''}`}>
            <span className="evo-barra-monto">{pesosCortos(m.totalCents)}</span>
            <span
              className="evo-barra-cuerpo"
              style={{ height: `${Math.round((m.totalCents / max) * ALTO_BARRA)}px` }}
              aria-hidden="true"
            />
            <span className="evo-barra-mes">{mesCorto(m.monthStart, idioma)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function MezclaPorMes({ datos }: { datos: Evolucion }) {
  const { t, idioma } = useIdioma();
  const esConsumo = datos.basis === 'consumption';
  const cocinas = cocinasDeLaEvolucion(datos);
  const nombre = (c: string) => nombreDeCocina(c, t) ?? t('Otra cocina');
  /** Porcentajes enteros de cada cocina en cada mes, en el orden fijo de `cocinas`. */
  const pctsPorMes = datos.months.map((m) =>
    porcentajesEnteros(cocinas.map((c) => m.categories.find((x) => x.category === c)?.amountCents ?? 0)));
  const primero = datos.months[0];
  const pctTexto = (mes: number, i: number) => (datos.months[mes].totalCents > 0 ? `${pctsPorMes[mes][i]}%` : '—');
  return (
    <section className="stat-anillo-card evo-card" aria-labelledby="evo-mezcla-titulo">
      <div>
        <h2 id="evo-mezcla-titulo" className="stat-anillo-titulo">
          {esConsumo ? t('Cómo cambió tu consumo') : t('Cómo cambió tu gasto')}
        </h2>
        <div className="stat-anillo-sub">{t('Participación de cada tipo de cocina, mes a mes')}</div>
      </div>
      <ul className="evo-columnas">
        {datos.months.map((m, mes) => {
          const etiqueta = m.totalCents > 0
            ? `${capitalizar(mesLargo(m.monthStart, idioma))}: ${cocinas
              .map((c, i) => (pctsPorMes[mes][i] > 0 ? `${nombre(c)} ${pctsPorMes[mes][i]}%` : null))
              .filter(Boolean)
              .join(', ')}`
            : t('{0}: sin consumos', capitalizar(mesLargo(m.monthStart, idioma)));
          return (
            <li key={m.monthStart} className="evo-columna">
              <span className={`evo-columna-cuerpo ${m.totalCents > 0 ? '' : 'vacia'}`} role="img" aria-label={etiqueta}>
                {cocinas.map((c, i) => (pctsPorMes[mes][i] > 0 ? (
                  <span key={c} style={{ height: `${pctsPorMes[mes][i]}%`, background: colorDeFila(i) }} />
                ) : null))}
              </span>
              <span className="evo-barra-mes">{mesCorto(m.monthStart, idioma)}</span>
            </li>
          );
        })}
      </ul>
      <ul className="stat-anillo-lista">
        {cocinas.map((c, i) => (
          <li key={c} className="stat-anillo-fila">
            <span className="stat-anillo-color" style={{ background: colorDeFila(i) }} aria-hidden="true" />
            <span className="stat-anillo-nombre">{nombre(c)}</span>
            <span className="stat-anillo-visitas">{mesLargo(primero.monthStart, idioma)} {pctTexto(0, i)}</span>
            <span className="stat-anillo-pct evo-hoy">{t('hoy {0}', pctTexto(5, i))}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
