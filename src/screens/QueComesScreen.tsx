import { useCallback, useEffect, useState } from 'react';
import { useIdioma } from '../i18n/idioma';
import { api } from '../api';
import type { PlatosDelPeriodo } from '../api/platos';
import type { ClaveMomento, MomentosDelPeriodo } from '../api/momentos';
import { agruparIngredientes, type ClaveGrupo, type IngredientesDelPeriodo } from '../api/ingredientes';
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
 * Pestañas «Platos», «Ingrediente» (2d, AF-38) y «Momento» (2e, AF-32): cada
 * una aparece si su ruta existe en el dueño.
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

/** AF-38 · «por ingrediente» (2d). `no_disponible` = 404 ⇒ la pestaña no se dibuja. */
type EstadoIngredientes =
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'no_disponible' }
  | { readonly tipo: 'error' }
  | { readonly tipo: 'lista'; readonly datos: IngredientesDelPeriodo };

type Pestana = 'platos' | 'ingrediente' | 'momento';

export function QueComesScreen() {
  const { t } = useIdioma();
  const { session } = useAuth();
  const clave = usePeriodoEstadisticas();
  const [estado, setEstado] = useState<Estado>({ tipo: 'cargando' });
  const [momentos, setMomentos] = useState<EstadoMomentos>({ tipo: 'cargando' });
  const [ingredientes, setIngredientes] = useState<EstadoIngredientes>({ tipo: 'cargando' });
  const [pestana, setPestana] = useState<Pestana>('platos');

  const cargar = useCallback(() => {
    setEstado({ tipo: 'cargando' });
    setMomentos({ tipo: 'cargando' });
    setIngredientes({ tipo: 'cargando' });
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
    api
      .getStatsIngredients(clave)
      .then((datos) => setIngredientes({ tipo: 'lista', datos }))
      // 404 = backend anterior a v2.115.0: la pestaña no se dibuja. 413, 500 o un
      // rechazo del decodificador: error con «Reintentar».
      .catch((err) => setIngredientes(extractApiError(err).status === 404 ? { tipo: 'no_disponible' } : { tipo: 'error' }));
  }, [clave]);

  useEffect(() => { cargar(); }, [cargar]);

  const datos = estado.tipo === 'lista' ? estado.datos : null;
  // Una pestaña se dibuja cuando su ruta respondió (datos o error); un 404 la saca.
  const conMomento = momentos.tipo === 'lista' || momentos.tipo === 'error';
  const conIngrediente = ingredientes.tipo === 'lista' || ingredientes.tipo === 'error';
  const conPestanas = conMomento || conIngrediente;
  const verMomentos = conMomento && pestana === 'momento';
  const verIngredientes = conIngrediente && pestana === 'ingrediente';
  const datosMomentos = momentos.tipo === 'lista' ? momentos.datos : null;
  const datosIngredientes = ingredientes.tipo === 'lista' ? ingredientes.datos : null;
  const conDatos = verMomentos
    ? datosMomentos !== null && datosMomentos.visits > 0
    : verIngredientes
      ? datosIngredientes !== null && datosIngredientes.groups.length > 0
      : datos !== null && datos.dishes.length > 0;
  // Sólo si el dueño CONFIRMA el período: si no, lo que llegó es el mes en curso.
  const periodoDeLaVista = verMomentos ? datosMomentos?.period : verIngredientes ? datosIngredientes?.period : datos?.period;
  const hayDatosDeLaVista = verMomentos ? datosMomentos !== null : verIngredientes ? datosIngredientes !== null : datos !== null;
  const soportaPeriodo = hayDatosDeLaVista && periodoDeLaVista?.key === clave;
  // AF-38 · en «Ingrediente» la burbuja es la de «Platos», como el diseño 2d: los
  // mismos platos, agrupados. Sólo si los platos son del MISMO período confirmado.
  const platosDelMismoPeriodo = datos !== null && datos.period?.key === periodoDeLaVista?.key ? datos : null;
  const efectiva: ClavePeriodo = soportaPeriodo ? clave : 'this_month';
  const pestanaActiva: Pestana = verMomentos ? 'momento' : verIngredientes ? 'ingrediente' : 'platos';

  return (
    <div className="screen has-appbar">
      <AppHeaderBack userName={fullName(session) ?? undefined} onBack={() => goBack('estadisticas')} />
      {conDatos || soportaPeriodo ? (
        <div className="title-card stat-burbuja">
          <h1 className="stat-oculto">{verIngredientes ? t('Qué comes · ingrediente') : t('Qué comes')}</h1>
          <SelectorDePeriodo clave={efectiva} disponible={soportaPeriodo} inicio={soportaPeriodo ? periodoDeLaVista?.start ?? null : null} />
          {conDatos && (
            <div className="stat-burbuja-dato">
              {/* AF-36 · como el diseño 2c («15 platos» y el contexto debajo): en un
                  solo renglón de 26px «7 platos distintos» se partía en dos y la
                  burbuja quedaba más alta que las otras tres. */}
              <div className="stat-burbuja-total">
                {verMomentos && datosMomentos
                  ? visitasTexto(datosMomentos.visits, t)
                  : verIngredientes
                    ? platosDelMismoPeriodo
                      ? platosTexto(platosDelMismoPeriodo.distinctDishes, t)
                      : datosIngredientes ? formatMXN(datosIngredientes.totalCents) : null
                    : datos ? platosTexto(datos.distinctDishes, t) : null}
              </div>
              {!verMomentos && (verIngredientes ? platosDelMismoPeriodo : datos) && (
                <div className="stat-burbuja-contexto">
                  {(verIngredientes ? platosDelMismoPeriodo : datos)?.distinctDishes === 1 ? t('distinto') : t('distintos')}
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
        {/* Las pestañas del diseño 2c, en su orden: «Platos», «Ingrediente» (AF-38)
            y «Momento» (AF-32). Cada una aparece si su ruta existe; sin ninguna
            (dos 404) no hay pestañas. */}
        <div className={conPestanas ? 'stat-tabs-shell' : undefined}>
          {conPestanas && (
            <div className="seg stat-pestanas" role="tablist" aria-label={t('Qué comes')}>
            <button
              type="button"
              id="que-comes-tab-platos"
              role="tab"
              aria-selected={!verMomentos && !verIngredientes}
              aria-controls="que-comes-panel"
              tabIndex={!verMomentos && !verIngredientes ? 0 : -1}
              className={`seg-btn ${!verMomentos && !verIngredientes ? 'on' : ''}`}
              onClick={() => setPestana('platos')}
            >
              {t('Platos')}
            </button>
            {conIngrediente && (
              <button
                type="button"
                id="que-comes-tab-ingrediente"
                role="tab"
                aria-selected={verIngredientes}
                aria-controls="que-comes-panel"
                tabIndex={verIngredientes ? 0 : -1}
                className={`seg-btn ${verIngredientes ? 'on' : ''}`}
                onClick={() => setPestana('ingrediente')}
              >
                {t('Ingrediente')}
              </button>
            )}
            {conMomento && (
              <button
                type="button"
                id="que-comes-tab-momento"
                role="tab"
                aria-selected={verMomentos}
                aria-controls="que-comes-panel"
                tabIndex={verMomentos ? 0 : -1}
                className={`seg-btn ${verMomentos ? 'on' : ''}`}
                onClick={() => setPestana('momento')}
              >
                {t('Momento')}
              </button>
            )}
            </div>
          )}
          <div
            id={conPestanas ? 'que-comes-panel' : undefined}
            role={conPestanas ? 'tabpanel' : undefined}
            aria-labelledby={conPestanas ? `que-comes-tab-${pestanaActiva}` : undefined}
            className={conPestanas ? 'stat-tabs-panel' : undefined}
          >
            {verMomentos ? (
              <VistaDeMomentos estado={momentos} clave={efectiva} onReintentar={cargar} />
            ) : verIngredientes ? (
              <VistaDeIngredientes
                estado={ingredientes}
                clave={efectiva}
                platosDistintos={platosDelMismoPeriodo?.distinctDishes ?? null}
                onReintentar={cargar}
              />
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
        </div>
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

/** AF-38 · los rótulos sugeridos por el dueño (handoff v2.115.0), en tuteo. */
function rotuloDeGrupo(key: ClaveGrupo, t: (s: string, ...a: unknown[]) => string): string {
  if (key === 'meat') return t('Carnes');
  if (key === 'seafood') return t('Pescados y mariscos');
  if (key === 'pasta') return t('Pastas y pizzas');
  if (key === 'veggie') return t('Verduras y ensaladas');
  if (key === 'dessert') return t('Postres');
  if (key === 'drinks') return t('Bebidas');
  if (key === 'alcohol') return t('Bebidas con alcohol');
  return t('Otros');
}

/**
 * AF-38 · «por ingrediente principal» (2d). El anillo reparte el DINERO de cada
 * grupo sobre `total_cents` (el dueño no trae platos por grupo: el «5 platos» del
 * diseño no se puede decir sin inventarlo). Al centro, el total; en la lista,
 * cada grupo con sus visitas y su monto, «Otros» al final. Debajo del anillo, la
 * línea chica de estimación cuando `estimated` (decisión de Mati).
 */
function VistaDeIngredientes({
  estado,
  clave,
  platosDistintos: distintos,
  onReintentar,
}: {
  estado: EstadoIngredientes;
  clave: ClavePeriodo;
  /** Platos distintos del MISMO período (de «Platos»), o `null` si no están. */
  platosDistintos: number | null;
  onReintentar: () => void;
}) {
  const { t } = useIdioma();
  if (estado.tipo === 'cargando' || estado.tipo === 'no_disponible') {
    return (
      <div aria-busy="true" aria-label={t('Cargando tus ingredientes')}>
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
            <div className="state-error-title">{t('No pudimos cargar tus ingredientes')}</div>
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
  const grupos = agruparIngredientes(datos.groups);
  if (grupos.length === 0) {
    return (
      <div className="mesa-empty">
        <div className="mesa-empty-title">
          {clave === 'this_month'
            ? t('Todavía no registramos platos este mes.')
            : t('No registramos platos en este período.')}
        </div>
      </div>
    );
  }
  const montos = grupos.map((g) => g.amountCents);
  const pcts = porcentajesEnteros(montos);
  const nombres = grupos.map((g) => rotuloDeGrupo(g.key, t));
  const resumen = nombres.map((n, i) => `${n} ${pcts[i]}%`).join(', ');
  return (
    <section className="stat-anillo-card" aria-labelledby="ingredientes-titulo">
      <div>
        <h2 id="ingredientes-titulo" className="stat-anillo-titulo">{t('Por ingrediente principal')}</h2>
        <div className="stat-anillo-sub">
          {distintos !== null && distintos > 1
            ? t('Los mismos {0} platos, agrupados por lo que llevan', distintos)
            : t('Tus platos, agrupados por lo que llevan')}
        </div>
      </div>
      <AnilloSvg
        porciones={porcionesDelAnillo(montos)}
        etiqueta={t('Por ingrediente principal: {0}', resumen)}
        centro={
          <>
            <div className="stat-anillo-total">{formatMXN(datos.totalCents)}</div>
            <div className="stat-anillo-unidad">{datos.basis === 'payments' ? t('de gasto') : t('de consumo')}</div>
          </>
        }
      />
      {datos.estimated && <p className="stat-estimacion">{t('Clasificado por el nombre del plato')}</p>}
      <ul className="stat-anillo-lista">
        {grupos.map((g, i) => (
          <li key={g.key} className="stat-anillo-fila">
            <span className="stat-anillo-color" style={{ background: colorDeFila(i) }} aria-hidden="true" />
            <span className="stat-anillo-nombre">{nombres[i]}</span>
            <span className="stat-anillo-visitas">{g.times !== null ? visitasTexto(g.times, t) : ''}</span>
            <span className="stat-anillo-monto">{formatMXN(g.amountCents)}</span>
            <span className="stat-anillo-pct">{pcts[i]}%</span>
          </li>
        ))}
      </ul>
      {datos.basis === 'payments' && (
        <p className="rest-pie">{t('Lo cobrado por cada plato, sin la propina.')}</p>
      )}
    </section>
  );
}
