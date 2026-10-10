import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
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
import { UnirmeConCodigo } from '../components/UnirmeConCodigo';
import { FilaDeslizable } from '../components/FilaDeslizable';
import { useHojaModal } from '../components/useHojaModal';
import { useToast } from '../components/ui';
import { extractApiError } from '../api/errors';
import { resultadoDeOcultar, sePuedeOcultar, useCapacidadOcultar } from '../api/ocultar';
import { bpsLabel } from './mesaItemsView';
import { agruparDelPago, agruparPropios, nombreConCantidad } from './agruparIguales';
import type { TuMesa } from '../api/misMesas';
import { olvidarLoDeMesas, ultimoVisto, useEsperaVisible } from '../api/ultimoVisto';
import { useSinLeer } from '../components/useSinLeer';
import { estadoDeTuMesa, tuMesaEnCurso, type EstadoTuMesa } from '../utils/labels';
import { useRegion } from '../preferences/RegionProvider';
import { personalDateLabel, personalZoneCaption } from '../utils/personalDates';
import {
  agruparPorMes,
  FRANJA_LABEL,
  franjaDe,
  mesasCerradas,
  traerDetallesMovimientos,
  traerHistorialCompleto,
  type Franja,
  type HistorialMesa,
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

function fechaDeFila(iso: string, locale: string, t: (s: string, ...a: unknown[]) => string, zone: string | null): string {
  return personalDateLabel(iso, locale, zone, t);
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
  // En «igual» se eligen PARTES; con la selección informativa (F-3), PLATOS.
  const partes = m.divisionMode === 'igual' && !m.eleccionInformativa;
  const que = m.itemsCount === 1
    ? (partes ? t('Elegiste 1 parte') : t('Elegiste 1 ítem'))
    : (partes ? t('Elegiste {0} partes', m.itemsCount) : t('Elegiste {0} ítems', m.itemsCount));
  return m.amountCents === null ? que : `${que} · ${formatMXN(m.amountCents)}`;
}

/** D237 · lo que se guarda de «Tus mesas»: la primera página y su cursor. */
interface PrimeraPaginaDeTusMesas {
  readonly mesas: TuMesa[];
  readonly nextCursor: string | null;
}

export function MesasScreen() {
  const { presentationZone } = useRegion();
  const { t, locale } = useIdioma();
  // E173-1 · sin «Fechas mostradas en …»: sólo el aviso de navegador degradado.
  const zoneCaption = personalZoneCaption(presentationZone, t);
  const { session } = useAuth();
  // D237 · lo último visto de esta cuenta: al volver a Mesas, las listas están
  // desde el primer cuadro y se actualizan por detrás.
  const [pagos, setPagos] = useState<HistoryEntry[] | null>(() => ultimoVisto.leer<HistoryEntry[]>('mesas.historial') ?? null);
  const [fallo, setFallo] = useState(false);
  const unread = useSinLeer();
  const [abierta, setAbierta] = useState<string | null>(null);
  const [mesaPropiaAbierta, setMesaPropiaAbierta] = useState<string | null>(null);
  const [detalles, setDetalles] = useState<Record<string, MovementDetailResponse[] | 'loading' | 'error'>>({});
  /**
   * AF-24 · «Tus mesas», de `GET /api/mesas/mine`. Con los pagos apagados, el
   * historial de PAGOS de abajo queda vacío aunque la persona haya estado en
   * varias mesas; esta lista es la única que las muestra. Se carga aparte y
   * falla aparte: un error acá no tapa los pagos, ni al revés.
   */
  const [misMesas, setMisMesas] = useState<TuMesa[] | null>(
    () => ultimoVisto.leer<PrimeraPaginaDeTusMesas>('mesas.tusMesas')?.mesas ?? null,
  );
  const [cursorMesas, setCursorMesas] = useState<string | null>(
    () => ultimoVisto.leer<PrimeraPaginaDeTusMesas>('mesas.tusMesas')?.nextCursor ?? null,
  );
  const [falloMesas, setFalloMesas] = useState(false);
  const [cargandoMasMesas, setCargandoMasMesas] = useState(false);

  const cargarMisMesas = useCallback((desdeCero: boolean) => {
    setFalloMesas(false);
    // D237 · con lo último visto en pantalla se pide por detrás; «Reintentar»
    // empieza de cero.
    if (desdeCero) setMisMesas(null);
    // T-01 · la cuenta se toma AL PEDIR.
    const turno = ultimoVisto.turno();
    api.getMyMesas({ detail: 'items' })
      .then((r) => {
        // Sólo la primera página: «Ver más mesas» no se guarda.
        const g = ultimoVisto.guardar<PrimeraPaginaDeTusMesas>(turno, 'mesas.tusMesas', {
          mesas: [...r.mesas],
          nextCursor: r.nextCursor,
        });
        if (!g) return;
        setMisMesas(g.valor.mesas);
        setCursorMesas(g.valor.nextCursor);
      })
      .catch(() => {
        if (!ultimoVisto.esDeAhora(turno)) return;
        ultimoVisto.olvidar('mesas.tusMesas');
        setMisMesas(null);
        setFalloMesas(true);
      });
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
    cargarMisMesas(false);
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
  const cargarHistorial = useCallback((desdeCero: boolean) => {
    setFallo(false);
    if (desdeCero) setPagos(null);
    // T-01 · la cuenta se toma AL PEDIR.
    const turno = ultimoVisto.turno();
    traerHistorialCompleto((limit, offset) =>
      api.getHistory({ limit, offset }).then((r) => r.history),
    )
      .then((h) => {
        const g = ultimoVisto.guardar(turno, 'mesas.historial', h);
        if (g) setPagos(g.valor);
      })
      .catch(() => {
        if (!ultimoVisto.esDeAhora(turno)) return;
        // O está todo o es el error (ver arriba): lo guardado tampoco se muestra.
        ultimoVisto.olvidar('mesas.historial');
        setPagos(null);
        setFallo(true);
      });
  }, []);

  useEffect(() => {
    cargarHistorial(false);
  }, [cargarHistorial]);

  // ─── AF-BORRAR-MESAS · D238/D239 · borrar de la app ──────────────────────
  // Es ocultar por persona: el servidor conserva todo. Sin la capacidad del
  // dueño no hay gesto.
  const capacidad = useCapacidadOcultar();
  const toast = useToast();
  /** La única tarjeta con «Eliminar» a la vista: de qué lista y qué mesa. */
  const [deslizada, setDeslizada] = useState<TarjetaDeslizada | null>(null);
  /** La mesa que espera la respuesta a «¿Borrar también su historial?». */
  const [preguntaMesa, setPreguntaMesa] = useState<TuMesa | null>(null);
  /** El aviso con «Deshacer»: el gesto se puede disparar sin querer. */
  const [aviso, setAviso] = useState<{ texto: string; deshacer: () => void } | null>(null);
  useEffect(() => {
    if (!aviso) return undefined;
    const reloj = window.setTimeout(() => setAviso(null), AVISO_DESHACER_MS);
    return () => window.clearTimeout(reloj);
  }, [aviso]);

  /**
   * Después de borrar o deshacer: lo guardado de las mesas (Tus mesas, el
   * historial, Inicio) y la campana se olvidan —el aviso de una mesa borrada
   * también sale—, y las listas se vuelven a pedir: el dueño ya las filtra.
   */
  const olvidarYRecargar = useCallback(() => {
    olvidarLoDeMesas();
    ultimoVisto.olvidar('sinLeer');
    cargarMisMesas(false);
    cargarHistorial(false);
  }, [cargarMisMesas, cargarHistorial]);

  const cerrarDeslizada = useCallback((tarjeta: TarjetaDeslizada) => {
    setDeslizada((actual) => (mismaTarjeta(actual, tarjeta) ? null : actual));
  }, []);

  const fallaAlBorrar = useCallback((err: unknown, que: 'mesa' | 'pago') => {
    const { status, code } = extractApiError(err);
    const r = resultadoDeOcultar(status, code);
    toast(r === 'en_curso'
      ? t('Esta mesa volvió a estar en curso: todavía no se puede borrar.')
      : r === 'no_esta'
        ? (que === 'mesa' ? t('Esa mesa ya no está disponible.') : t('Ese pago ya no está disponible.'))
        : t('No pudimos borrarlo. Prueba de nuevo.'));
    olvidarYRecargar();
  }, [olvidarYRecargar, t, toast]);

  const deshacer = useCallback((texto: string, accion: () => Promise<unknown>) => {
    setAviso(null);
    accion()
      .then(() => { olvidarYRecargar(); toast(t('Volvió a tu app.')); })
      // Si falla, el aviso vuelve con su «Deshacer» para reintentar.
      .catch(() => setAviso({ texto: t('No pudimos deshacerlo.'), deshacer: () => deshacer(texto, accion) }));
  }, [olvidarYRecargar, t, toast]);

  const borrarMesa = useCallback((m: TuMesa, incluirHistorial: boolean) => {
    setPreguntaMesa(null);
    setDeslizada(null);
    // Se saca de la vista enseguida; la lista que vuelve del dueño manda.
    setMisMesas((actual) => actual?.filter((x) => x.code !== m.code) ?? actual);
    if (incluirHistorial) setPagos((actual) => actual?.filter((p) => p.mesa_code !== m.code) ?? actual);
    api.ocultarMesa(m.code, incluirHistorial)
      .then(() => {
        olvidarYRecargar();
        const texto = t('Borraste la mesa de tu app.');
        setAviso({ texto, deshacer: () => deshacer(texto, () => api.mostrarMesa(m.code)) });
      })
      .catch((err: unknown) => fallaAlBorrar(err, 'mesa'));
  }, [deshacer, fallaAlBorrar, olvidarYRecargar, t]);

  /** Un pago del historial: la tarjeta junta los pagos propios de esa mesa; se borran todos. */
  const borrarPagos = useCallback((h: HistorialMesa) => {
    setDeslizada(null);
    const ids = [...h.payment_ids];
    setPagos((actual) => actual?.filter((p) => !ids.includes(p.id)) ?? actual);
    Promise.all(ids.map((id) => api.ocultarPago(id)))
      .then(() => {
        olvidarYRecargar();
        const texto = ids.length > 1 ? t('Borraste los pagos de tu app.') : t('Borraste el pago de tu app.');
        setAviso({ texto, deshacer: () => deshacer(texto, () => Promise.all(ids.map((id) => api.mostrarPago(id)))) });
      })
      .catch((err: unknown) => fallaAlBorrar(err, 'pago'));
  }, [deshacer, fallaAlBorrar, olvidarYRecargar, t]);

  // D237 · la primera carga muestra sus esqueletos sólo si tarda más de 300 ms.
  const esperaTusMesasVisible = useEsperaVisible(misMesas === null && !falloMesas);
  const esperaHistorialVisible = useEsperaVisible(pagos === null && !fallo);

  const cerradas = pagos ? mesasCerradas(pagos) : null;
  const grupos = cerradas ? agruparPorMes(cerradas, locale, presentationZone) : [];
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
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => cargarMisMesas(true)}>
        {t('Reintentar')}
      </button>
    </div>
  ) : tusMesas === null ? (
    esperaTusMesasVisible ? (
      <div aria-busy="true" aria-label={t('Cargando tus mesas')}>
        <div className="pago-row sk">
          <span className="sk-line w55" />
          <span className="sk-line w40" />
        </div>
      </div>
    ) : null
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
                {m.createdAt && <>{fechaDeFila(m.createdAt, locale, t, presentationZone)}{' · '}</>}
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
        const claveGesto = tarjetaDeTusMesas(m.code);
        return (
          <div key={m.id} className={`hist-item tu-mesa ${detalleAbierto ? 'on' : ''}`}>
            <ConGesto
              activo={sePuedeOcultar(capacidad, m.status)}
              abierta={mismaTarjeta(deslizada, claveGesto)}
              onAbrir={() => setDeslizada(claveGesto)}
              onCerrar={() => cerrarDeslizada(claveGesto)}
              nombre={m.restaurante ?? t('Mesa {0}', m.code)}
              onEliminar={() => setPreguntaMesa(m)}
            >
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
            {/* Decisión 100 de Mati: plato, porción y monto en UNA línea, en
                columnas, con el criterio de Tus restaurantes (AF-STATS-BURBUJA):
                la columna del «½» sólo ocupa lugar si alguna línea la tiene. */}
            {detalleAbierto && m.items && (
              <div
                className={m.items.some((item) => item.fractionBps < 10000)
                  ? 'hist-detail hist-detail--con-porcion'
                  : 'hist-detail'}
                aria-label={t('Lo que elegiste')}
              >
                {/* D240 punto 16 · los iguales juntos, con la cantidad antes. */}
                {agruparPropios(m.items).map((g) => (
                  <div key={g.key} className="hist-detail-row">
                    <span className="hist-detail-frac">{g.primero.fractionBps < 10000 ? bpsLabel(g.primero.fractionBps) : ''}</span>
                    <span className="hist-detail-name">{nombreConCantidad(g.cantidad, g.primero.name)}</span>
                    <span className="hist-detail-amount">{formatMXN(g.montoCents ?? g.primero.amountCents)}</span>
                  </div>
                ))}
              </div>
            )}
            </ConGesto>
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
      {/* D223 · turno 2 · 2.1: la burbuja dice «Mesas» (antes «Historial»,
          §1.10), porque arriba del historial vive ahora «Unirme con código». */}
      <div className="title-card">
        <h1 className="title-card-title">{t('Mesas')}</h1>
      </div>

      <div className="scroll history-scroll">
        {/* D219 · D223-3 · «Unirme con código», sólo acá: una fila que se abre
            en el lugar, arriba del historial. */}
        <UnirmeConCodigo />
        {zoneCaption && <p className="caption">{zoneCaption}</p>}

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
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => cargarHistorial(true)}>
              {t('Reintentar')}
            </button>
          </div>
        ) : cerradas === null ? (
          /* D237 · Mati, en su video: 4 filas esqueleto (1 + estas 3) y después
             eran 2 mesas, y saltaba el alto. Una fila neutra por sección, y sólo
             si la primera carga tarda más de 300 ms. */
          esperaHistorialVisible ? (
            <div aria-busy="true" aria-label={t('Cargando tu historial')}>
              <div className="pago-row sk">
                <span className="sk-line w55" />
                <span className="sk-line w40" />
              </div>
            </div>
          ) : null
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
              <section key={g.key} aria-label={g.label === 'Sin fecha' ? t('Sin fecha') : g.label}>
                <h2 className="mes-sticky">{g.label === 'Sin fecha' ? t('Sin fecha') : g.label}</h2>
                {g.mesas.map((m) => {
                  const franja = franjaDe(m.date, presentationZone);
                  const on = abierta === m.mesa_code;
                  const detalle = detalles[m.mesa_code];
                  const claveGesto = tarjetaDelHistorial(m.mesa_code);
                  return (
                    <div key={m.mesa_code} className={`hist-item ${on ? 'on' : ''}`}>
                      <ConGesto
                        activo={sePuedeOcultar(capacidad, m.mesa_status)}
                        abierta={mismaTarjeta(deslizada, claveGesto)}
                        onAbrir={() => setDeslizada(claveGesto)}
                        onCerrar={() => cerrarDeslizada(claveGesto)}
                        nombre={m.restaurant}
                        onEliminar={() => borrarPagos(m)}
                      >
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
                            {fechaDeFila(m.date, locale, t, presentationZone)}
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
                              {/* D240 punto 16 · los iguales de este pago, juntos. */}
                              {movement.items.length > 0 ? agruparDelPago(movement.id, movement.items).map((g) => (
                                <div key={g.key} className="hist-detail-row">
                                  <span className="hist-detail-name">
                                    <span>{nombreConCantidad(g.cantidad, g.primero.name)}</span>
                                    {g.primero.declared_fraction_bps != null && (
                                      <span className="hist-detail-declared">
                                        {t('Declaraste {0}', bpsLabel(g.primero.declared_fraction_bps))}
                                      </span>
                                    )}
                                  </span>
                                  {g.montoCents != null && (
                                    <span className="hist-detail-amount">{formatMXN(g.montoCents)}</span>
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
                      </ConGesto>
                    </div>
                  );
                })}
              </section>
            ))}

          </>
        )}

      </div>

      {preguntaMesa && (
        <HojaBorrarMesa
          onSi={() => borrarMesa(preguntaMesa, true)}
          onNo={() => borrarMesa(preguntaMesa, false)}
          onCancelar={() => { setPreguntaMesa(null); setDeslizada(null); }}
        />
      )}
      {aviso && (
        <div className="aviso-deshacer" role="status">
          <span>{aviso.texto}</span>
          <button type="button" className="aviso-deshacer-boton" onClick={aviso.deshacer}>{t('Deshacer')}</button>
        </div>
      )}
      <AppBottomBar active="mesas" />
    </div>
  );
}

/** AF-BORRAR-MESAS · qué tarjeta tiene «Eliminar» a la vista (una sola a la vez). */
interface TarjetaDeslizada {
  readonly lista: 'tusMesas' | 'historial';
  readonly code: string;
}

const tarjetaDeTusMesas = (code: string): TarjetaDeslizada => ({ lista: 'tusMesas', code });
const tarjetaDelHistorial = (code: string): TarjetaDeslizada => ({ lista: 'historial', code });

function mismaTarjeta(a: TarjetaDeslizada | null, b: TarjetaDeslizada): boolean {
  return a !== null && a.lista === b.lista && a.code === b.code;
}

/** AF-BORRAR-MESAS · lo que dura a la vista el aviso con «Deshacer». */
const AVISO_DESHACER_MS = 8000;

/** El gesto sólo donde se puede borrar; si no, la tarjeta de siempre. */
function ConGesto({
  activo,
  children,
  ...props
}: {
  activo: boolean;
  abierta: boolean;
  onAbrir: () => void;
  onCerrar: () => void;
  nombre: string;
  onEliminar: () => void;
  children: ReactNode;
}) {
  return activo ? <FilaDeslizable {...props}>{children}</FilaDeslizable> : <>{children}</>;
}

/**
 * AF-BORRAR-MESAS · D238 · al borrar una mesa, la pregunta por su historial. El
 * texto dice «de tu app» y que PayMe conserva el registro: nunca que PayMe
 * borró el dato. El foco entra en «No, sólo la mesa», la que borra menos; el ✕,
 * Escape y el velo no borran nada.
 */
function HojaBorrarMesa({ onSi, onNo, onCancelar }: { onSi: () => void; onNo: () => void; onCancelar: () => void }) {
  const { t } = useIdioma();
  const hoja = useRef<HTMLDivElement | null>(null);
  const no = useRef<HTMLButtonElement | null>(null);
  useHojaModal(hoja, no, onCancelar);
  return createPortal(
    <div className="sheet-overlay" onClick={onCancelar}>
      <div
        ref={hoja}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t('¿Borrar también su historial?')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-head">
          <span className="sheet-title">{t('¿Borrar también su historial?')}</span>
          <button type="button" className="sheet-close" aria-label={t('Cerrar')} onClick={onCancelar}>✕</button>
        </div>
        <p className="ocultar-mesa-texto">
          {t('La mesa se borra de tu app; PayMe conserva el registro. Su historial son tus pagos de esa mesa.')}
        </p>
        <div className="ocultar-mesa-acciones">
          <button type="button" className="btn btn-navy" onClick={onSi}>{t('Sí, también el historial')}</button>
          <button ref={no} type="button" className="btn btn-ghost" onClick={onNo}>{t('No, sólo la mesa')}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
