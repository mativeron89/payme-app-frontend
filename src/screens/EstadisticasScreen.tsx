import { useCallback, useEffect, useState } from 'react';
import { useIdioma } from '../i18n/idioma';
import { api } from '../api';
import type { StatsResponse } from '../api/types';
import { accountRailView } from '../api/releaseGates';
import { useWalletRail } from '../api/walletRail';
import { AppBottomBar } from '../components/AppBottomBar';
import { AppHeaderBack } from '../components/AppHeader';
import { Icon } from '../components/Icon';
import { goBack } from '../router';
import { formatMXN } from '../utils/format';
import { categoryLabel } from '../utils/labels';

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
 * Lo que el contrato NO tiene se **declara al pie**, con el estado *desconocido*
 * del sistema (punteado + interrogación), en vez de omitirse. Se hace así para
 * que el faltante quede visible y nadie lo implemente creyendo que hay datos
 * detrás. El detalle de cada uno está en §5.1 del spec y en `GAPS.md`.
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
  const { walletRailEnabled, accountActivity } = useWalletRail();
  const vista = accountRailView(walletRailEnabled, accountActivity);

  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [fallo, setFallo] = useState(false);

  const cargar = useCallback(() => {
    setFallo(false);
    setStats(null);
    api
      .getStats()
      .then(setStats)
      .catch(() => setFallo(true));
  }, []);

  useEffect(() => {
    if (!vista.showAccountActivity) return;
    cargar();
  }, [vista.showAccountActivity, cargar]);

  // `labels.ts` es constante de MÓDULO: devuelve español y se traduce acá.
  const crudoCocina = categoryLabel(stats?.favorite_category);
  const cocina = crudoCocina === null ? null : t(crudoCocina);
  // Actividad del mes: sin visitas Y sin gasto es vacío real. Se miran los dos
  // porque "0 visitas con gasto" sería un dato incoherente del emisor, y ante
  // incoherencia preferimos mostrar los números y no tragarlos.
  const sinActividad = !!stats && !stats.month.visits && !stats.month.spent_cents;
  // La barra de proporción se normaliza contra el más visitado, no contra el
  // total: es una comparación entre restaurantes, no un porcentaje del gasto.
  const topVisitas = stats?.top_restaurants[0]?.visits ?? 0;

  return (
    <div className="screen has-appbar">
      <AppHeaderBack title={t('Mis estadísticas')} onBack={() => goBack('home')} />

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
            {sinActividad ? (
              /* Vacío REAL, sin borde. NO se pinta "$0.00 gastado": no gastar
                 nada y no tener datos son cosas distintas. */
              <div className="mesa-empty">
                <div className="mesa-empty-title">{t('Todavía no registramos consumos este mes.')}</div>
              </div>
            ) : (
              <>
                {/* El ancla de la pantalla. */}
                <div className="stat-hero">
                  <div className="stat-hero-lbl">{t('Este mes')}</div>
                  <div className="stat-hero-amt">{pesos(stats.month.spent_cents)}</div>
                </div>

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

                {stats.top_restaurants.length > 0 && (
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

            {/**
             * Lo que falta se DECLARA, no se omite. Punteado + interrogación es
             * el estado *desconocido* del sistema: si hay borde, hay algo que
             * no estás viendo. Omitirlo dejaría que alguien lo implemente
             * creyendo que hay datos detrás.
             */}
            <div className="state-unknown" style={{ marginLeft: 0, marginRight: 0 }}>
              <Icon name="info" size={20} />
              <div>
                <div className="state-unknown-title">{t('Todavía no existe en el contrato')}</div>
                <p className="state-unknown-body">
                  {t('Comparación con el mes anterior · propinas acumuladas · ranking por tipología de plato.')}
                </p>
              </div>
            </div>
          </>
        )}
      </div>

      <AppBottomBar active={null} />
    </div>
  );
}
