import { useCallback, useEffect, useState } from 'react';
import { useIdioma } from '../i18n/idioma';
import { api } from '../api';
import type { PlatosDelPeriodo } from '../api/platos';
import { usePeriodoEstadisticas, type ClavePeriodo } from '../api/periodoEstadisticas';
import { useAuth } from '../auth/AuthContext';
import { AppBottomBar } from '../components/AppBottomBar';
import { AppHeaderBack } from '../components/AppHeader';
import { Icon } from '../components/Icon';
import { goBack } from '../router';
import { colorDeFila, porcentajesEnteros, porcionesDelAnillo } from '../utils/anillo';
import { formatMXN } from '../utils/format';
import { fullName } from '../utils/identity';
import { platosDistintos, sufijoDePeriodo, vecesTexto } from '../utils/textosDeEstadisticas';
import { AnilloSvg } from './AnilloSvg';
import { SelectorDePeriodo } from './SelectorDePeriodo';

/**
 * **Qué comes** — pantalla 2c de «Mis estadísticas», sólo la vista por PLATOS
 * (AF-31, Roadmap n166). `GET /api/account/stats/dishes?period=`.
 *
 * Las pestañas «Ingrediente» y «Momento» del diseño NO se dibujan: esos datos
 * no existen todavía (2d y 2e quedan afuera por decisión de Mati).
 *
 * El anillo reparte los cinco platos por **veces** (el dato del dueño son
 * VISITAS: media porción cuenta 1) y lleva en el centro cuántos platos
 * distintos hubo. Los porcentajes del `aria-label` son sobre esos cinco, no
 * sobre todo lo que comiste. La lista dice plato, restaurante, veces y monto;
 * nunca el color solo.
 */

type Estado =
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'error' }
  | { readonly tipo: 'lista'; readonly datos: PlatosDelPeriodo };

export function QueComesScreen() {
  const { t } = useIdioma();
  const { session } = useAuth();
  const clave = usePeriodoEstadisticas();
  const [estado, setEstado] = useState<Estado>({ tipo: 'cargando' });

  const cargar = useCallback(() => {
    setEstado({ tipo: 'cargando' });
    api
      .getStatsDishes(clave)
      .then((datos) => setEstado({ tipo: 'lista', datos }))
      // 404, 413 `stats_range_too_large`, 500 o un rechazo del decodificador:
      // el mismo cartel. El dueño nunca manda datos parciales.
      .catch(() => setEstado({ tipo: 'error' }));
  }, [clave]);

  useEffect(() => { cargar(); }, [cargar]);

  const datos = estado.tipo === 'lista' ? estado.datos : null;
  const conDatos = datos !== null && datos.dishes.length > 0;
  // Sólo si el dueño CONFIRMA el período: si no, lo que llegó es el mes en curso.
  const soportaPeriodo = datos !== null && datos.period?.key === clave;
  const efectiva: ClavePeriodo = soportaPeriodo ? clave : 'this_month';

  return (
    <div className="screen has-appbar">
      <AppHeaderBack userName={fullName(session) ?? undefined} onBack={() => goBack('estadisticas')} />
      {conDatos || soportaPeriodo ? (
        <div className="title-card stat-burbuja">
          <h1 className="stat-oculto">{t('Qué comes')}</h1>
          <SelectorDePeriodo clave={efectiva} disponible={soportaPeriodo} />
          {conDatos && (
            <div className="stat-burbuja-dato">
              <div className="stat-burbuja-total">{platosDistintos(datos.distinctDishes, t)}</div>
            </div>
          )}
        </div>
      ) : (
        <div className="title-card">
          <h1 className="title-card-title">{t('Qué comes')}</h1>
        </div>
      )}

      <div className="scroll" style={{ paddingLeft: 16, paddingRight: 16, paddingTop: 16 }}>
        {estado.tipo === 'cargando' ? (
          <div aria-busy="true" aria-label={t('Cargando tus platos')}>
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
                <div className="state-error-title">{t('No pudimos cargar tus platos')}</div>
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
                ? t('Todavía no registramos platos este mes.')
                : t('No registramos platos en este período.')}
            </div>
          </div>
        ) : (
          <TusPlatos datos={datos} clave={efectiva} />
        )}
      </div>

      <AppBottomBar active={null} />
    </div>
  );
}

function TusPlatos({ datos, clave }: { datos: PlatosDelPeriodo; clave: ClavePeriodo }) {
  const { t } = useIdioma();
  const veces = datos.dishes.map((d) => d.times);
  const pcts = porcentajesEnteros(veces);
  const resumen = datos.dishes.map((d, i) => `${d.name} ${pcts[i]}%`).join(', ');
  return (
    <section className="stat-anillo-card" aria-labelledby="platos-titulo">
      <div>
        <h2 id="platos-titulo" className="stat-anillo-titulo">
          {datos.dishes.length === 5 ? t('Tus cinco platos') : t('Tus platos')}
        </h2>
        <div className="stat-anillo-sub">
          {t('De {0} {1}', platosDistintos(datos.distinctDishes, t), sufijoDePeriodo(clave, t))}
        </div>
      </div>
      <AnilloSvg
        porciones={porcionesDelAnillo(veces)}
        etiqueta={t('Platos más pedidos: {0}', resumen)}
        centro={
          <>
            <div className="stat-anillo-total">{datos.distinctDishes}</div>
            <div className="stat-anillo-unidad">
              {datos.distinctDishes === 1 ? t('plato distinto') : t('platos distintos')}
            </div>
          </>
        }
      />
      <ul className="stat-anillo-lista">
        {datos.dishes.map((d, i) => (
          <li key={`${d.restaurant.id}:${d.name}`} className="stat-anillo-fila">
            <span className="stat-anillo-color" style={{ background: colorDeFila(i) }} aria-hidden="true" />
            <span className="plato-texto">
              <span className="stat-anillo-nombre">{d.name}</span>
              <span className="plato-rest">{d.restaurant.name}</span>
            </span>
            <span className="stat-anillo-visitas">{vecesTexto(d.times, t)}</span>
            <span className="stat-anillo-monto">{formatMXN(d.amountCents)}</span>
          </li>
        ))}
      </ul>
      {datos.basis === 'payments' && (
        <p className="rest-pie">{t('Lo cobrado por cada plato, sin la propina.')}</p>
      )}
    </section>
  );
}
