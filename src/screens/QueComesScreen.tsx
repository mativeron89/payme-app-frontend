import { useCallback, useEffect, useState } from 'react';
import { useIdioma } from '../i18n/idioma';
import { api } from '../api';
import type { PlatosDelPeriodo } from '../api/platos';
import type { ClaveMomento, MomentosDelPeriodo } from '../api/momentos';
import { extractApiError } from '../api/errors';
import { usePeriodoEstadisticas, type ClavePeriodo } from '../api/periodoEstadisticas';
import { useAuth } from '../auth/AuthContext';
import { AppBottomBar } from '../components/AppBottomBar';
import { AppHeaderBack } from '../components/AppHeader';
import { Icon } from '../components/Icon';
import { goBack } from '../router';
import { colorDeFila, porcentajesEnteros, porcionesDelAnillo } from '../utils/anillo';
import { formatMXN } from '../utils/format';
import { fullName } from '../utils/identity';
import { platosDistintos, platosTexto, sufijoDePeriodo, vecesTexto, visitasTexto } from '../utils/textosDeEstadisticas';
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

/**
 * AF-32 · «por momento del día» (2e). `no_disponible` = 404 de un backend
 * anterior a v2.109.0 ⇒ la pestaña no se dibuja y 2c queda como estaba.
 */
type EstadoMomentos =
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'no_disponible' }
  | { readonly tipo: 'error' }
  | { readonly tipo: 'lista'; readonly datos: MomentosDelPeriodo };

export function QueComesScreen() {
  const { t } = useIdioma();
  const { session } = useAuth();
  const clave = usePeriodoEstadisticas();
  const [estado, setEstado] = useState<Estado>({ tipo: 'cargando' });
  const [momentos, setMomentos] = useState<EstadoMomentos>({ tipo: 'cargando' });
  const [pestana, setPestana] = useState<'platos' | 'momento'>('platos');

  const cargar = useCallback(() => {
    setEstado({ tipo: 'cargando' });
    setMomentos({ tipo: 'cargando' });
    api
      .getStatsDishes(clave)
      .then((datos) => setEstado({ tipo: 'lista', datos }))
      // 404, 413 `stats_range_too_large`, 500 o un rechazo del decodificador:
      // el mismo cartel. El dueño nunca manda datos parciales.
      .catch(() => setEstado({ tipo: 'error' }));
    api
      .getStatsDayparts(clave)
      .then((datos) => setMomentos({ tipo: 'lista', datos }))
      .catch((err) => setMomentos(extractApiError(err).status === 404 ? { tipo: 'no_disponible' } : { tipo: 'error' }));
  }, [clave]);

  useEffect(() => { cargar(); }, [cargar]);

  const datos = estado.tipo === 'lista' ? estado.datos : null;
  const conPestanas = momentos.tipo === 'lista' || momentos.tipo === 'error';
  const verMomentos = conPestanas && pestana === 'momento';
  const datosMomentos = momentos.tipo === 'lista' ? momentos.datos : null;
  const conDatos = verMomentos
    ? datosMomentos !== null && datosMomentos.visits > 0
    : datos !== null && datos.dishes.length > 0;
  // Sólo si el dueño CONFIRMA el período: si no, lo que llegó es el mes en curso.
  const periodoDeLaVista = verMomentos ? datosMomentos?.period : datos?.period;
  const soportaPeriodo = (verMomentos ? datosMomentos !== null : datos !== null) && periodoDeLaVista?.key === clave;
  const efectiva: ClavePeriodo = soportaPeriodo ? clave : 'this_month';

  return (
    <div className="screen has-appbar">
      <AppHeaderBack userName={fullName(session) ?? undefined} onBack={() => goBack('estadisticas')} />
      {conDatos || soportaPeriodo ? (
        <div className="title-card stat-burbuja">
          <h1 className="stat-oculto">{t('Qué comes')}</h1>
          <SelectorDePeriodo clave={efectiva} disponible={soportaPeriodo} inicio={soportaPeriodo ? periodoDeLaVista?.start ?? null : null} />
          {conDatos && (
            <div className="stat-burbuja-dato">
              {/* AF-36 · como el diseño 2c («15 platos» y el contexto debajo): en un
                  solo renglón de 26px «7 platos distintos» se partía en dos y la
                  burbuja quedaba más alta que las otras tres. */}
              <div className="stat-burbuja-total">
                {verMomentos && datosMomentos
                  ? visitasTexto(datosMomentos.visits, t)
                  : datos ? platosTexto(datos.distinctDishes, t) : null}
              </div>
              {!verMomentos && datos && (
                <div className="stat-burbuja-contexto">
                  {datos.distinctDishes === 1 ? t('distinto') : t('distintos')}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="title-card">
          <h1 className="title-card-title">{t('Qué comes')}</h1>
        </div>
      )}

      <div className="scroll" style={{ paddingLeft: 16, paddingRight: 16, paddingTop: 16 }}>
        {/* AF-32 · las pestañas del diseño 2c: «Platos» y «Momento». «Ingrediente»
            no se dibuja (el dato no existe), y sin momentos (404) no hay pestañas. */}
        {conPestanas && (
          <div className="seg stat-pestanas" role="tablist" aria-label={t('Qué comes')}>
            <button
              type="button"
              role="tab"
              aria-selected={pestana === 'platos'}
              className={`seg-btn ${pestana === 'platos' ? 'on' : ''}`}
              onClick={() => setPestana('platos')}
            >
              {t('Platos')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={pestana === 'momento'}
              className={`seg-btn ${pestana === 'momento' ? 'on' : ''}`}
              onClick={() => setPestana('momento')}
            >
              {t('Momento')}
            </button>
          </div>
        )}
        {verMomentos ? (
          <VistaDeMomentos estado={momentos} clave={efectiva} onReintentar={cargar} />
        ) : estado.tipo === 'cargando' ? (
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
        ) : !conDatos || datos === null ? (
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

/** AF-32 · los rótulos y horarios de Mati, en hora de México. */
function rotuloDeMomento(key: ClaveMomento, t: (s: string, ...a: unknown[]) => string): { nombre: string; horario: string } {
  if (key === 'breakfast') return { nombre: t('Desayuno'), horario: t('hasta las 12') };
  if (key === 'lunch') return { nombre: t('Comida'), horario: t('12 a 17') };
  if (key === 'afternoon') return { nombre: t('Tarde'), horario: t('17 a 19') };
  return { nombre: t('Cena'), horario: t('desde las 19') };
}

/**
 * AF-32 · «por momento del día» (2e). Anillo con las visitas al centro y lista
 * con cada momento, su horario escrito, visitas y monto: nunca el color solo.
 * Los cuatro momentos van siempre, también en cero.
 */
function VistaDeMomentos({
  estado,
  clave,
  onReintentar,
}: {
  estado: EstadoMomentos;
  clave: ClavePeriodo;
  onReintentar: () => void;
}) {
  const { t } = useIdioma();
  if (estado.tipo === 'cargando' || estado.tipo === 'no_disponible') {
    return (
      <div aria-busy="true" aria-label={t('Cargando tus momentos')}>
        <div className="stat-hero sk">
          <span className="sk-line w40" />
          <span className="sk-line w70 tall" />
        </div>
      </div>
    );
  }
  if (estado.tipo === 'error') {
    return (
      <div className="state-error">
        <div className="state-error-row">
          <Icon name="x-circle" size={22} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="state-error-title">{t('No pudimos cargar tus momentos')}</div>
            <p className="state-error-body">{t('Revisa la conexión y prueba de nuevo.')}</p>
          </div>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onReintentar}>
          {t('Reintentar')}
        </button>
      </div>
    );
  }
  const datos = estado.datos;
  if (datos.visits === 0) {
    return (
      <div className="mesa-empty">
        <div className="mesa-empty-title">
          {clave === 'this_month'
            ? t('Todavía no registramos visitas este mes.')
            : t('No registramos visitas en este período.')}
        </div>
      </div>
    );
  }
  const visitas = datos.dayparts.map((d) => d.visits);
  const pcts = porcentajesEnteros(visitas);
  const rotulos = datos.dayparts.map((d) => rotuloDeMomento(d.key, t));
  const resumen = rotulos.map((r, i) => `${r.nombre} ${pcts[i]}%`).join(', ');
  return (
    <section className="stat-anillo-card" aria-labelledby="momentos-titulo">
      <div>
        <h2 id="momentos-titulo" className="stat-anillo-titulo">{t('Por momento del día')}</h2>
        <div className="stat-anillo-sub">{t('De {0} {1}', visitasTexto(datos.visits, t), sufijoDePeriodo(clave, t))}</div>
      </div>
      <AnilloSvg
        porciones={porcionesDelAnillo(visitas)}
        etiqueta={t('Visitas por momento del día: {0}', resumen)}
        centro={
          <>
            <div className="stat-anillo-total">{datos.visits}</div>
            <div className="stat-anillo-unidad">{datos.visits === 1 ? t('visita') : t('visitas')}</div>
          </>
        }
      />
      <ul className="stat-anillo-lista">
        {datos.dayparts.map((d, i) => (
          <li key={d.key} className="stat-anillo-fila">
            <span className="stat-anillo-color" style={{ background: colorDeFila(i) }} aria-hidden="true" />
            <span className="plato-texto">
              <span className="stat-anillo-nombre">{rotulos[i].nombre}</span>
              <span className="plato-rest">{rotulos[i].horario}</span>
            </span>
            <span className="stat-anillo-visitas">{visitasTexto(d.visits, t)}</span>
            <span className="stat-anillo-monto">{formatMXN(d.amountCents)}</span>
          </li>
        ))}
      </ul>
      {datos.basis === 'payments' && (
        <p className="rest-pie">{t('Cada visita incluye la propina.')}</p>
      )}
    </section>
  );
}
