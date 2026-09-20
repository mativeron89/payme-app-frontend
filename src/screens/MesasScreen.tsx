import { useCallback, useEffect, useState } from 'react';
import { useIdioma } from '../i18n/idioma';
import { api } from '../api';
import type { HistoryEntry, MovementDetailResponse } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { goBack, navigate } from '../router';
import { formatMXN } from '../utils/format';
import { fullName } from '../utils/identity';
import { AppBottomBar } from '../components/AppBottomBar';
import { AppHeaderBack } from '../components/AppHeader';
import { Icon, type IconName } from '../components/Icon';
import { bpsLabel } from './mesaItemsView';
import type { TuMesa } from '../api/misMesas';
import { estadoDeTuMesa, tuMesaEnCurso, type EstadoTuMesa } from '../utils/labels';
import {
  agruparPorMes,
  FRANJA_LABEL,
  franjaDe,
  mesasCerradas,
  traerDetallesMovimientos,
  traerHistorialCompleto,
  type Franja,
} from './historialView';

const CATEGORY_EMOJI: Record<string, IconName> = {
  italian: 'pasta',
  japanese: 'sushi',
  mexican: 'taco',
  cafe: 'coffee',
  other: 'dining',
};

/** El ícono ACOMPAÑA a la palabra, nunca la reemplaza (§1.10). */
const FRANJA_ICON: Record<Franja, IconName> = {
  manana: 'sun-rise',
  mediodia: 'sun-high',
  tarde: 'sun-low',
  noche: 'moon',
};

function fechaDeFila(iso: string, locale: string, t: (s: string, ...a: unknown[]) => string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diffDays = Math.floor((Date.now() - d.getTime()) / (24 * 60 * 60_000));
  if (diffDays === 0) return t('Hoy');
  if (diffDays === 1) return t('Ayer');
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
}

/**
 * **Mesas ES el historial** — `SPEC_APP.md` §1.10, definido por Mati: *"una
 * forma más rápida de ir al histórico de mesas"*. Como nunca hay más de una
 * mesa abierta y ya se ve en Inicio, esta entrada de la barra lista las
 * CERRADAS; el título de la pantalla dice **Historial** aunque la etiqueta de
 * la barra diga "Mesas" por espacio.
 *
 * La mesa abierta NO se repite acá. Antes de `mesa_status` (v2.42.0) esta
 * pantalla no podía cumplirlo: el organizador que pagaba su parte veía su mesa
 * viva bajo un encabezado de mes, como si hubiera terminado. Y la sección
 * "Abiertas ahora" que vivía arriba se retiró con G-28 cerrado: el invitado ya
 * ve su mesa en Inicio, donde corresponde, no acá.
 *
 * El acordeón carga cada uno de MIS pagos con el endpoint owner-only
 * `GET /account/movements/:id`. Una mesa puede contener varios intentos
 * propios —pagar varias partes está ratificado—, por eso se consultan TODOS
 * los IDs agrupados y nunca se inventa un detalle a partir del total visible.
 */
/** AF-24 · el texto de cómo terminó cada mesa, con un `t('…')` literal por caso. */
function textoEstadoTuMesa(e: EstadoTuMesa, t: (s: string, ...a: unknown[]) => string): string {
  switch (e) {
    case 'sin_cobro': return t('Cerró sin cobro');
    case 'pagada': return t('Pagada');
    case 'vencio': return t('Venció');
    case 'cancelada': return t('Cancelada');
    case 'cerrada': return t('Cerrada');
  }
}

/**
 * AF-24 · «Elegiste N ítems · $X». Es lo que eligió ESTA cuenta, no lo que se
 * cobró: por eso va en el texto y no en la columna de monto, que en los pagos de
 * abajo es lo cobrado. En `igual` se eligen PARTES, y así se dice.
 */
function textoEleccion(m: TuMesa, t: (s: string, ...a: unknown[]) => string): string | null {
  if (m.itemsCount === null) return null;
  if (m.itemsCount === 0) return t('No elegiste ítems');
  const partes = m.divisionMode === 'igual';
  const que = m.itemsCount === 1
    ? (partes ? t('Elegiste 1 parte') : t('Elegiste 1 ítem'))
    : (partes ? t('Elegiste {0} partes', m.itemsCount) : t('Elegiste {0} ítems', m.itemsCount));
  return m.amountCents === null ? que : `${que} · ${formatMXN(m.amountCents)}`;
}

export function MesasScreen() {
  const { t, locale } = useIdioma();
  const { session } = useAuth();
  const [pagos, setPagos] = useState<HistoryEntry[] | null>(null);
  const [fallo, setFallo] = useState(false);
  const [unread, setUnread] = useState(0);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [mesaPropiaAbierta, setMesaPropiaAbierta] = useState<string | null>(null);
  const [detalles, setDetalles] = useState<Record<string, MovementDetailResponse[] | 'loading' | 'error'>>({});
  /**
   * AF-24 · «Tus mesas», de `GET /api/mesas/mine`. Con los pagos apagados, el
   * historial de PAGOS de abajo queda vacío aunque la persona haya estado en
   * varias mesas; esta lista es la única que las muestra. Se carga aparte y
   * falla aparte: un error acá no tapa los pagos, ni al revés.
   */
  const [misMesas, setMisMesas] = useState<TuMesa[] | null>(null);
  const [cursorMesas, setCursorMesas] = useState<string | null>(null);
  const [falloMesas, setFalloMesas] = useState(false);
  const [cargandoMasMesas, setCargandoMasMesas] = useState(false);

  const cargarMisMesas = useCallback(() => {
    setFalloMesas(false);
    setMisMesas(null);
    api.getMyMesas({ detail: 'items' })
      .then((r) => { setMisMesas([...r.mesas]); setCursorMesas(r.nextCursor); })
      .catch(() => setFalloMesas(true));
  }, []);

  const cargarMasMesas = useCallback(() => {
    if (!cursorMesas || cargandoMasMesas) return;
    setCargandoMasMesas(true);
    api.getMyMesas({ cursor: cursorMesas, detail: 'items' })
      .then((r) => {
        setMisMesas((actual) => [...(actual ?? []), ...r.mesas]);
        setCursorMesas(r.nextCursor);
      })
      .catch(() => setFalloMesas(true))
      .finally(() => setCargandoMasMesas(false));
  }, [cursorMesas, cargandoMasMesas]);

  useEffect(() => {
    cargarMisMesas();
  }, [cargarMisMesas]);

  const cargarDetalle = useCallback((mesaCode: string, paymentIds: readonly string[]) => {
    setDetalles((actual) => ({ ...actual, [mesaCode]: 'loading' }));
    traerDetallesMovimientos(paymentIds, (id) => api.getMovement(id))
      .then((movements) => setDetalles((actual) => ({ ...actual, [mesaCode]: movements })))
      .catch(() => setDetalles((actual) => ({ ...actual, [mesaCode]: 'error' })));
  }, []);

  const abrirDetalle = useCallback((mesaCode: string, paymentIds: readonly string[]) => {
    if (abierta === mesaCode) {
      setAbierta(null);
      return;
    }
    setAbierta(mesaCode);
    if (detalles[mesaCode]) return;
    cargarDetalle(mesaCode, paymentIds);
  }, [abierta, cargarDetalle, detalles]);

  /**
   * TODO el historial antes de agrupar, sin "Cargar más": una página parcial
   * dejaría a una mesa partida en el borde con su total SUBCONTADO en
   * pantalla. O está todo, o es el estado de error — la falla a mitad de
   * carga propaga a propósito (ver `traerHistorialCompleto`).
   */
  const cargarHistorial = useCallback(() => {
    setFallo(false);
    setPagos(null);
    traerHistorialCompleto((limit, offset) =>
      api.getHistory({ limit, offset }).then((r) => r.history),
    )
      .then(setPagos)
      .catch(() => setFallo(true));
  }, []);

  useEffect(() => {
    cargarHistorial();
  }, [cargarHistorial]);

  useEffect(() => {
    let alive = true;
    api.getUnreadCount().then((r) => alive && setUnread(r.unread_count)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const cerradas = pagos ? mesasCerradas(pagos) : null;
  const grupos = cerradas ? agruparPorMes(cerradas, locale) : [];
  const tusMesas = misMesas ? misMesas.filter((m) => !tuMesaEnCurso(m.status)) : null;
  /** El vacío «Todavía no cerraste…» sólo si NINGUNA de las dos listas tiene nada. */
  const sinTusMesas = tusMesas !== null && tusMesas.length === 0 && !falloMesas && cursorMesas === null;

  const seccionTusMesas = falloMesas ? (
    <div className="state-error" role="alert">
      <div className="state-error-row">
        <Icon name="x-circle" size={22} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="state-error-title">{t('No pudimos cargar tus mesas')}</div>
          <p className="state-error-body">{t('Revisa la conexión y prueba de nuevo.')}</p>
        </div>
      </div>
      <button type="button" className="btn btn-ghost btn-sm" onClick={cargarMisMesas}>
        {t('Reintentar')}
      </button>
    </div>
  ) : tusMesas === null ? (
    <div aria-busy="true" aria-label={t('Cargando tus mesas')}>
      <div className="pago-row sk">
        <span className="sk-line w55" />
        <span className="sk-line w40" />
      </div>
    </div>
  ) : tusMesas.length > 0 || cursorMesas ? (
    <section className="tus-mesas" aria-label={t('Tus mesas')}>
      {tusMesas.map((m) => {
        const eleccion = textoEleccion(m, t);
        const conDetalle = m.divisionMode === 'consumo' && m.items !== null && m.items.length > 0;
        const detalleAbierto = conDetalle && mesaPropiaAbierta === m.code;
        const fila = (
          <>
            <span aria-hidden="true">
              <Icon name={CATEGORY_EMOJI[m.categoria ?? ''] ?? 'dining'} size={22} />
            </span>
            <div className="hist-main">
              <div className="hist-rest">{m.restaurante ?? t('Mesa {0}', m.code)}</div>
              <div className="hist-meta">
                {m.createdAt && <>{fechaDeFila(m.createdAt, locale, t)}{' · '}</>}
                {textoEstadoTuMesa(estadoDeTuMesa(m), t)}
              </div>
              {eleccion && <div className="hist-meta">{eleccion}</div>}
            </div>
            {conDetalle && (
              <span className={`hist-chevron ${detalleAbierto ? 'on' : ''}`} aria-hidden="true">
                <Icon name="chevron-down" size={20} />
              </span>
            )}
          </>
        );
        return (
          <div key={m.id} className={`hist-item tu-mesa ${detalleAbierto ? 'on' : ''}`}>
            {conDetalle ? (
              <button
                type="button"
                className="hist-row"
                aria-expanded={detalleAbierto}
                onClick={() => setMesaPropiaAbierta((actual) => actual === m.code ? null : m.code)}
              >
                {fila}
              </button>
            ) : (
              <div className="hist-row">{fila}</div>
            )}
            {detalleAbierto && m.items && (
              <div className="hist-detail" aria-label={t('Lo que elegiste')}>
                {m.items.map((item) => (
                  <div key={item.itemId} className="hist-detail-row">
                    <span className="hist-detail-name">
                      <span>{item.name}{item.quantity > 1 ? ` × ${item.quantity}` : ''}</span>
                      {item.fractionBps < 10000 && (
                        <span className="hist-detail-declared">{bpsLabel(item.fractionBps)}</span>
                      )}
                    </span>
                    <span className="hist-detail-amount">{formatMXN(item.amountCents)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {cursorMesas && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={cargarMasMesas} disabled={cargandoMasMesas}>
          {cargandoMasMesas ? t('Cargando…') : t('Ver más mesas')}
        </button>
      )}
    </section>
  ) : null;

  return (
    <div className="screen has-appbar">
      <AppHeaderBack
        userName={fullName(session) ?? undefined}
        onBack={() => goBack('home')}
        unread={unread}
        onBell={() => navigate('avisos')}
      />
      <div className="title-card">
        <h1 className="title-card-title">{t('Historial')}</h1>
      </div>

      <div className="scroll" style={{ paddingLeft: 16, paddingRight: 16 }}>

        {seccionTusMesas}

        {fallo && !pagos ? (
          <div className="state-error">
            <div className="state-error-row">
              <Icon name="x-circle" size={22} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="state-error-title">{t('No pudimos cargar tu historial')}</div>
                <p className="state-error-body">{t('Revisa la conexión y prueba de nuevo.')}</p>
              </div>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={cargarHistorial}>
              {t('Reintentar')}
            </button>
          </div>
        ) : cerradas === null ? (
          <div aria-busy="true" aria-label={t('Cargando tu historial')}>
            {[0, 1, 2].map((i) => (
              <div key={i} className="pago-row sk">
                <span className="sk-line w55" />
                <span className="sk-line w40" />
              </div>
            ))}
          </div>
        ) : cerradas.length === 0 ? (
          /* Vacío REAL: sin borde, único estado del sistema que no lo lleva.
             AF-24 · y sólo si tampoco hay «Tus mesas»: con los pagos apagados,
             no tener pagos no es no haber estado en ninguna mesa. */
          sinTusMesas ? (
            <div className="mesa-empty">
              <div className="mesa-empty-title">{t('Todavía no cerraste ninguna mesa.')}</div>
            </div>
          ) : null
        ) : (
          <>
            {grupos.map((g) => (
              <section key={g.key} aria-label={g.label}>
                <h2 className="mes-sticky">{g.label}</h2>
                {g.mesas.map((m) => {
                  const franja = franjaDe(m.date);
                  const on = abierta === m.mesa_code;
                  const detalle = detalles[m.mesa_code];
                  return (
                    <div key={m.mesa_code} className={`hist-item ${on ? 'on' : ''}`}>
                      <button
                        type="button"
                        className="hist-row"
                        aria-expanded={on}
                        onClick={() => abrirDetalle(m.mesa_code, m.payment_ids)}
                      >
                        <span aria-hidden="true">
                          <Icon name={CATEGORY_EMOJI[m.category] ?? 'dining'} size={22} />
                        </span>
                        <div className="hist-main">
                          <div className="hist-rest">{m.restaurant}</div>
                          <div className="hist-meta">
                            {fechaDeFila(m.date, locale, t)}
                            {franja && (
                              <>
                                {' · '}
                                {t(FRANJA_LABEL[franja])}{' '}
                                <Icon
                                  name={FRANJA_ICON[franja]}
                                  size={14}
                                  className="ico-inline"
                                />
                              </>
                            )}
                          </div>
                        </div>
                        <div className="hist-amt">{formatMXN(m.amount_cents)}</div>
                        <span className={`hist-chevron ${on ? 'on' : ''}`} aria-hidden="true">
                          <Icon name="chevron-down" size={20} />
                        </span>
                      </button>
                      {on && (
                        <div className="hist-detail" aria-live="polite">
                          {detalle === 'loading' && (
                            <div className="loading">{t('Cargando detalle…')}</div>
                          )}
                          {detalle === 'error' && (
                            <div className="state-error hist-detail-error" role="alert">
                              <div className="state-error-title">{t('No pudimos cargar el detalle')}</div>
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                onClick={() => cargarDetalle(m.mesa_code, m.payment_ids)}
                              >
                                {t('Reintentar')}
                              </button>
                            </div>
                          )}
                          {Array.isArray(detalle) && detalle.map((movement, paymentIndex) => (
                            <section key={movement.id} className="hist-payment" aria-label={t('Pago {0}', paymentIndex + 1)}>
                              {movement.items.length > 0 ? movement.items.map((item, itemIndex) => (
                                <div key={`${movement.id}:${itemIndex}`} className="hist-detail-row">
                                  <span className="hist-detail-name">
                                    <span>{item.name}{item.quantity > 1 ? ` × ${item.quantity}` : ''}</span>
                                    {item.declared_fraction_bps != null && (
                                      <span className="hist-detail-declared">
                                        {t('Declaraste {0}', bpsLabel(item.declared_fraction_bps))}
                                      </span>
                                    )}
                                  </span>
                                  {item.amount_cents != null && (
                                    <span className="hist-detail-amount">{formatMXN(item.amount_cents)}</span>
                                  )}
                                </div>
                              )) : (
                                <p className="hist-detail-empty">{t('Este pago no declaró consumos.')}</p>
                              )}
                              {movement.tip_amount_cents > 0 && (
                                <div className="hist-detail-row hist-detail-tip">
                                  <span>{t('Propina')}</span>
                                  <span className="hist-detail-amount">{formatMXN(movement.tip_amount_cents)}</span>
                                </div>
                              )}
                            </section>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </section>
            ))}

          </>
        )}

      </div>

      <AppBottomBar active="mesas" />
    </div>
  );
}
