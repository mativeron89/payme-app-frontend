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
import { formatMXN } from '../utils/format';
import { fullName } from '../utils/identity';
import { platosDistintos, platosTexto, sufijoDePeriodo, vecesTexto, visitasTexto } from '../utils/textosDeEstadisticas';
import { SelectorDePeriodo } from './SelectorDePeriodo';
import { useTandaVigente } from './useTandaVigente';
import { nombreDePlato } from '../utils/nombreDePlato';
import { colorDeGrupo, colorDeMomento } from '../utils/coloresDeEstadisticas';
import { CabeceraDeEstadisticas, EsqueletoDeEstadisticas } from './CabeceraDeEstadisticas';

/**
 * **Qué comes** — pantalla 2c de «Mis estadísticas» (AF-31, Roadmap n166).
 * `GET /api/account/stats/dishes?period=&dishes_version=2`.
 *
 * Pestañas «Platos», «Ingredientes» (2d, AF-38) y «Momento» (2e, AF-32): cada
 * una aparece si su ruta existe en el dueño.
 *
 * D479/D482 · Claude Design 0.261 (1l, 1m, 1n): control segmentado, sin anillos.
 * - Platos: «Tus platos más pedidos» y una fila por plato con veces e importe;
 *   desplegada, dónde se pidió (AF-2: con `dishes_version=2` los platos vienen
 *   agrupados entre restaurantes, y el desplegable muestra cada uno). `times` son
 *   VISITAS: media porción cuenta 1.
 * - Ingredientes y Momento: cuadrito y barra con el color FIJO de cada clave,
 *   siempre con el nombre al lado. Los momentos en cero se muestran como los
 *   manda el dueño (D482).
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

/**
 * F-13 (auditoría Codex) · las pestañas usan el foco móvil (sólo la elegida está en el orden de Tab), y ese patrón
 * promete el resto: las flechas pasan a la de al lado (con vuelta), Inicio a la primera y Fin a la última. Sin esto,
 * «Ingrediente» y «Momento» no se alcanzaban con el teclado. Devuelve `null` con cualquier otra tecla.
 */
export function pestanaPorTecla(pestanas: readonly Pestana[], actual: Pestana, tecla: string): Pestana | null {
  const i = pestanas.indexOf(actual);
  if (i < 0 || pestanas.length === 0) return null;
  if (tecla === 'ArrowRight') return pestanas[(i + 1) % pestanas.length]!;
  if (tecla === 'ArrowLeft') return pestanas[(i - 1 + pestanas.length) % pestanas.length]!;
  if (tecla === 'Home') return pestanas[0]!;
  if (tecla === 'End') return pestanas[pestanas.length - 1]!;
  return null;
}

export function QueComesScreen() {
  const { t } = useIdioma();
  const { session } = useAuth();
  const clave = usePeriodoEstadisticas();
  const [estado, setEstado] = useState<Estado>({ tipo: 'cargando' });
  const [momentos, setMomentos] = useState<EstadoMomentos>({ tipo: 'cargando' });
  const [ingredientes, setIngredientes] = useState<EstadoIngredientes>({ tipo: 'cargando' });
  const [pestana, setPestana] = useState<Pestana>('platos');

  /** F-02 · las respuestas de un período anterior no pisan las del elegido. */
  const nuevaTanda = useTandaVigente();

  const cargar = useCallback(() => {
    const vigente = nuevaTanda();
    setEstado({ tipo: 'cargando' });
    setMomentos({ tipo: 'cargando' });
    setIngredientes({ tipo: 'cargando' });
    api
      .getStatsDishes(clave)
      .then((datos) => { if (vigente()) setEstado({ tipo: 'lista', datos }); })
      // 404, 413 `stats_range_too_large`, 500 o un rechazo del decodificador:
      // el mismo cartel. El dueño nunca manda datos parciales.
      .catch(() => { if (vigente()) setEstado({ tipo: 'error' }); });
    api
      .getStatsDayparts(clave)
      .then((datos) => { if (vigente()) setMomentos({ tipo: 'lista', datos }); })
      .catch((err) => { if (vigente()) setMomentos(extractApiError(err).status === 404 ? { tipo: 'no_disponible' } : { tipo: 'error' }); });
    api
      .getStatsIngredients(clave)
      .then((datos) => { if (vigente()) setIngredientes({ tipo: 'lista', datos }); })
      // 404 = backend anterior a v2.115.0: la pestaña no se dibuja. 413, 500 o un
      // rechazo del decodificador: error con «Reintentar».
      .catch((err) => { if (vigente()) setIngredientes(extractApiError(err).status === 404 ? { tipo: 'no_disponible' } : { tipo: 'error' }); });
  }, [clave, nuevaTanda]);

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
  const efectiva: ClavePeriodo = soportaPeriodo ? clave : 'this_month';
  const pestanaActiva: Pestana = verMomentos ? 'momento' : verIngredientes ? 'ingrediente' : 'platos';
  /** Las pestañas que se ven, en su orden (las mismas condiciones que las dibujan). */
  const visibles: readonly Pestana[] = [
    'platos',
    ...(conIngrediente ? ['ingrediente' as const] : []),
    ...(conMomento ? ['momento' as const] : []),
  ];
  function alTeclado(e: React.KeyboardEvent<HTMLDivElement>) {
    const otra = pestanaPorTecla(visibles, pestanaActiva, e.key);
    if (!otra) return;
    e.preventDefault();
    setPestana(otra);
    document.getElementById(`que-comes-tab-${otra}`)?.focus();
  }

  return (
    <div className="screen has-appbar">
      <AppHeaderBack userName={fullName(session) ?? undefined} onBack={() => goBack('estadisticas')} />
      <CabeceraDeEstadisticas icono="cubiertos" titulo={t('Qué comes')}>
        <SelectorDePeriodo
          clave={hayDatosDeLaVista ? efectiva : clave}
          disponible={soportaPeriodo}
          cargando={!verMomentos && !verIngredientes && estado.tipo === 'cargando'}
          inicio={soportaPeriodo ? periodoDeLaVista?.start ?? null : null}
        />
      </CabeceraDeEstadisticas>

      <div className="scroll est-scroll">
        {/* Las pestañas del diseño 2c, en su orden: «Platos», «Ingrediente» (AF-38)
            y «Momento» (AF-32). Cada una aparece si su ruta existe; sin ninguna
            (dos 404) no hay pestañas. */}
        <div className={conPestanas ? 'est-pestanas-caja' : undefined}>
          {conPestanas && (
            <div className="est-pestanas" role="tablist" aria-label={t('Qué comes')} onKeyDown={alTeclado}>
            <button
              type="button"
              id="que-comes-tab-platos"
              role="tab"
              aria-selected={!verMomentos && !verIngredientes}
              aria-controls="que-comes-panel"
              tabIndex={!verMomentos && !verIngredientes ? 0 : -1}
              className={!verMomentos && !verIngredientes ? 'est-pestana on' : 'est-pestana'}
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
                className={verIngredientes ? 'est-pestana on' : 'est-pestana'}
                onClick={() => setPestana('ingrediente')}
              >
                {t('Ingredientes')}
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
                className={verMomentos ? 'est-pestana on' : 'est-pestana'}
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
            className={conPestanas ? 'est-pestanas-panel' : undefined}
          >
            {verMomentos ? (
              <VistaDeMomentos estado={momentos} clave={efectiva} onReintentar={cargar} />
            ) : verIngredientes ? (
              <VistaDeIngredientes
                estado={ingredientes}
                clave={efectiva}
                onReintentar={cargar}
              />
            ) : estado.tipo === 'cargando' ? (
              <EsqueletoDeEstadisticas etiqueta={t('Cargando tus platos')} />
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
  const [abierto, setAbierto] = useState<number | null>(null);
  return (
    <section className="est-bloque" aria-labelledby="platos-titulo">
      <div className="est-panel est-titulo-panel">
        <h2 id="platos-titulo">{t('Tus platos más pedidos')}</h2>
        <p className="est-nota">{`${platosDistintos(datos.distinctDishes, t)} ${sufijoDePeriodo(clave, t)}`}</p>
      </div>
      <ul className="est-panel est-platos" role="list">
        {datos.dishes.map((d, i) => {
          const esteAbierto = abierto === i;
          return (
            <li key={`${i}:${d.name}`} className="est-plato">
              <button
                type="button"
                className="est-plato-fila"
                aria-expanded={esteAbierto}
                aria-controls={`est-plato-${i}`}
                onClick={() => setAbierto((a) => (a === i ? null : i))}
              >
                <span className="est-plato-nombre">{nombreDePlato(d.name)}</span>
                <span className="est-plato-veces">{vecesTexto(d.times, t)}</span>
                <span className="est-plato-monto">{formatMXN(d.amountCents)}</span>
                <Icon name="chevron-down" size={18} className={esteAbierto ? 'rest-chev abierto' : 'rest-chev'} />
              </button>
              {esteAbierto && (
                <ul id={`est-plato-${i}`} className="est-plato-lugares" role="list">
                  {d.restaurants.map((r) => (
                    <li key={r.id} className="est-plato-lugar">
                      <span className="est-plato-nombre">{r.name}</span>
                      <span className="est-plato-veces">{vecesTexto(r.times, t)}</span>
                      <span className="est-plato-monto">{formatMXN(r.amountCents)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
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
    return <EsqueletoDeEstadisticas etiqueta={t('Cargando tus momentos')} />;
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
  const maximo = Math.max(...datos.dayparts.map((d) => d.visits), 1);
  return (
    <section className="est-bloque" aria-labelledby="momentos-titulo">
      <div className="est-panel est-titulo-panel">
        <h2 id="momentos-titulo">{t('Por momento del día')}</h2>
        <p className="est-nota">{`${visitasTexto(datos.visits, t)} ${sufijoDePeriodo(clave, t)}`}</p>
      </div>
      <ul className="est-panel est-filas" role="list">
        {datos.dayparts.map((d) => {
          const rotulo = rotuloDeMomento(d.key, t);
          return (
            <li key={d.key} className="est-fila">
              <span className="est-fila-arriba">
                <span className="est-cuadrito" style={{ background: colorDeMomento(d.key) }} aria-hidden="true" />
                <span className="est-fila-nombre">{rotulo.nombre}</span>
                <span className="est-fila-monto">{formatMXN(d.amountCents)}</span>
              </span>
              <span className="est-fila-abajo con-cuadrito">
                <span>{rotulo.horario}</span>
                <span>{visitasTexto(d.visits, t)}</span>
              </span>
              <span className="est-barra" aria-hidden="true">
                <span style={{ width: `${(d.visits / maximo) * 100}%`, background: colorDeMomento(d.key) }} />
              </span>
            </li>
          );
        })}
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
 * AF-38 · «por ingrediente principal» (2d). n178: con `dish_count` (v2.125.0) el
 * anillo reparte PLATOS, al centro cuántos, y cada fila «N platos» y su monto,
 * como el diseño. Con un dueño anterior, el anillo reparte el DINERO sobre
 * `total_cents` con el total al centro, y cada fila sus visitas, monto y
 * porcentaje. «Otros» siempre al final. Debajo del anillo, la línea chica de
 * estimación cuando `estimated` (decisión de Mati).
 */
function VistaDeIngredientes({
  estado,
  clave,
  onReintentar,
}: {
  estado: EstadoIngredientes;
  clave: ClavePeriodo;
  onReintentar: () => void;
}) {
  const { t } = useIdioma();
  if (estado.tipo === 'cargando' || estado.tipo === 'no_disponible') {
    return <EsqueletoDeEstadisticas etiqueta={t('Cargando tus ingredientes')} />;
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
  /**
   * n178 · con `dish_count` (dueño v2.125.0; AF-2 con la clave agrupada de
   * `dishes_version=2`) cada fila dice «N platos»; con un dueño anterior, sus
   * visitas. La barra compara el importe con el del grupo más alto.
   */
  const conPlatos = grupos.every((g) => g.dishCount !== null);
  const maximo = Math.max(...grupos.map((g) => g.amountCents), 1);
  return (
    <section className="est-bloque" aria-labelledby="ingredientes-titulo">
      <div className="est-panel est-titulo-panel">
        <h2 id="ingredientes-titulo">{t('Por ingrediente principal')}</h2>
        {/* K4 (D482) · se conserva: el grupo es una estimación por el nombre del plato. */}
        {datos.estimated && <p className="est-nota">{t('Clasificado por el nombre del plato')}</p>}
      </div>
      <ul className="est-panel est-filas" role="list">
        {grupos.map((g) => (
          <li key={g.key} className="est-fila">
            <span className="est-fila-arriba">
              <span className="est-cuadrito" style={{ background: colorDeGrupo(g.key) }} aria-hidden="true" />
              <span className="est-fila-nombre">{rotuloDeGrupo(g.key, t)}</span>
              <span className="est-fila-monto">{formatMXN(g.amountCents)}</span>
            </span>
            <span className="est-fila-abajo con-cuadrito">
              <span />
              <span>{conPlatos ? platosTexto(g.dishCount as number, t) : g.times !== null ? visitasTexto(g.times, t) : ''}</span>
            </span>
            <span className="est-barra" aria-hidden="true">
              <span style={{ width: `${(g.amountCents / maximo) * 100}%`, background: colorDeGrupo(g.key) }} />
            </span>
          </li>
        ))}
      </ul>
      {datos.basis === 'payments' && (
        <p className="rest-pie">{t('Lo cobrado por cada plato, sin la propina.')}</p>
      )}
    </section>
  );
}
