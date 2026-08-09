import { useCallback, useEffect, useState } from 'react';
import { api, IS_MOCK } from '../api';
import type { BalanceResponse, OpenMesasResponse, WalletTransaction } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { navigate } from '../router';
import { useWalletRail } from '../api/walletRail';
import { countdownLong, formatMXN } from '../utils/format';
import { fullName } from '../utils/identity';
import { mesaStatusLabel, walletTxIcon, walletTxLabel } from '../utils/labels';
import { etiquetaMasMesas, ordenarPorUrgencia } from './homeMesasView';
import { demoSeedIrrecuperable, resetDemo } from '../api/mock/store';
import { Icon } from '../components/Icon';
import { AppBottomBar } from '../components/AppBottomBar';
import {
  AppHeader, BubbleTabs, Launcher, MountedCard, type BubbleTab,
} from '../components/AppHeader';

/**
 * §1.1 · Inicio — y §1.11, que **es la misma pantalla**: las tres pestañas SON
 * Inicio. Ratificadas con Mati el 2026-08-03 mirando pantallas.
 *
 * El problema que resolvía: con el riel de saldo durmiente esta pantalla queda
 * literalmente vacía en el build real —la tarjeta de saldo era el único objeto
 * con peso visual y ya no está—. Ahora la estructura es la de §5 bis: banda
 * navy de borde curvo, pestañas en burbuja enganchadas a la tarjeta montada, la
 * mesa **debajo** de los accesos (decisión de Mati: ahí pega más que
 * encabezando), y la barra de cinco posiciones.
 *
 * Dato de producto CADUCO, corregido el 2026-08-05 (§1.1 del spec, variante
 * B): "nunca hay más de UNA mesa abierta" era cierto cuando lo confirmó Mati
 * (2026-08-03) y lo invalidó G-28 — `/mesas/open` ahora trae también las
 * mesas donde sos PARTICIPANTE, sin límite. La burbuja protagonista se queda
 * (jerarquía aprobada pantalla por pantalla); cuando hay más de una, una
 * tercera fila "+N mesas abiertas más" abre la hoja con las demás — porque
 * desde §1.10 "Mesas" es historial de CERRADAS y una abierta que no entra acá
 * no existe en ninguna otra superficie. El criterio de cuál es la
 * protagonista vive en `homeMesasView.ts`.
 *
 * El banner de invitación pendiente que vivía acá arriba **se fue a Avisos**
 * (decisión de Mati del 2026-08-05, §5 del spec). No se duplica: se saca. Con
 * él se fue `getPendingInvitations()` de esta pantalla — Avisos ya lo pide.
 */

/** Las tres de §1.11. `asociadas` existe y no tiene interior: ver abajo. */
type TabId = 'cuenta' | 'estadisticas' | 'asociadas';

const TABS: BubbleTab[] = [
  { id: 'cuenta', label: 'Cuenta' },
  { id: 'estadisticas', label: 'Estadísticas' },
  { id: 'asociadas', label: 'Asociadas' },
];

function txDate(iso: string): string {
  const d = new Date(iso);
  const diffDays = Math.floor((Date.now() - d.getTime()) / (24 * 60 * 60_000));
  if (diffDays === 0) return 'Hoy';
  if (diffDays === 1) return 'Ayer';
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
}

export function HomeScreen() {
  const { session } = useAuth();
  // OLA 5D · saldo y movimientos son riel saldo: los habilita el BACKEND.
  // Arranca apagado, así que ni siquiera se PIDEN mientras la capability viaja.
  const { walletRailEnabled } = useWalletRail();
  const [tab, setTab] = useState<TabId>('cuenta');
  const [hojaAbierta, setHojaAbierta] = useState(false);
  const [balance, setBalance] = useState<BalanceResponse | null>(null);
  const [showBalance, setShowBalance] = useState(false);
  const [openMesas, setOpenMesas] = useState<OpenMesasResponse | null>(null);
  const [mesasFallaron, setMesasFallaron] = useState(false);
  const [txs, setTxs] = useState<WalletTransaction[] | null>(null);
  const [unread, setUnread] = useState(0);

  /**
   * La mesa se pide aparte del resto porque es lo único que puede fallar
   * VISIBLEMENTE: §1.1 pide que un error de red pinte el estado de error con
   * **Reintentar** dentro de la burbuja, y que las pestañas sigan funcionando.
   * Tragarse el error como hacía el `.catch(() => undefined)` anterior dejaba
   * la pantalla diciendo "No tenés mesas abiertas" cuando lo cierto era que no
   * habíamos podido preguntar — vacío real y falla de red son cosas distintas.
   */
  const cargarMesas = useCallback(() => {
    setMesasFallaron(false);
    setOpenMesas(null);
    return api
      .getOpenMesas()
      .then(setOpenMesas)
      .catch(() => setMesasFallaron(true));
  }, []);

  // Card-only: no depende del riel y se pide una sola vez.
  useEffect(() => {
    void cargarMesas();
  }, [cargarMesas]);

  useEffect(() => {
    let alive = true;
    api.getUnreadCount().then((r) => alive && setUnread(r.unread_count)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  /**
   * ⚠️ EL RIEL VA EN SU PROPIO EFECTO, Y LA DEPENDENCIA NO ES OPCIONAL.
   *
   * `walletRailEnabled` no es una constante: llega DESPUÉS del primer render.
   * Con estas llamadas dentro del efecto card-only —que corre una sola vez,
   * cuando la capability todavía vale `false` por fail-closed— nunca se
   * pedirían: si el backend encendiera el riel, la tarjeta de saldo quedaría en
   * "…" para siempre y los movimientos no aparecerían nunca.
   *
   * Es el gemelo del bug de la pestaña de Cuenta: **un valor que pasó de
   * constante a asíncrono rompe todo lo que lo leyó una sola vez.**
   */
  useEffect(() => {
    if (!walletRailEnabled) return;
    let alive = true;
    api.getBalance().then((b) => alive && setBalance(b)).catch(() => undefined);
    api
      .getWalletTransactions()
      .then((r) => alive && setTxs(r.transactions.slice(0, 4)))
      .catch(() => alive && setTxs([]));
    return () => {
      alive = false;
    };
  }, [walletRailEnabled]);

  // §5 bis · A pide el nombre COMPLETO, no el saludo. Si falta, va sin nombre:
  // "Hola, undefined" es peor que el logo solo.
  const nombre = fullName(session);
  // §1.1 (2026-08-05): la protagonista es la de vencimiento MÁS PRÓXIMO, no
  // la primera del payload; las demás viven en la hoja de "+N más".
  const porUrgencia = openMesas ? ordenarPorUrgencia(openMesas.mesas) : [];
  const mesa = porUrgencia[0] ?? null;
  const otras = porUrgencia.slice(1);
  const cuenta = mesa ? countdownLong(mesa.expires_at) : null;
  // Sólo se pregunta cuando no hay nada vivo, y sólo en mock: el build real
  // no tiene seed que vencer. `IS_MOCK` es constante, así que el bundler
  // puede podar la rama entera.
  const demoVencida = IS_MOCK && openMesas !== null && mesa === null && demoSeedIrrecuperable();
  const masked = '$ ••••';

  return (
    <div className="screen has-appbar">
      <AppHeader
        userName={nombre ?? undefined}
        unread={unread}
        onBell={() => navigate('avisos')}
        tabs={<BubbleTabs tabs={TABS} active={tab} onSelect={(id) => setTab(id as TabId)} />}
      />

      <div className="scroll">
        {/* La tarjeta va CUADRADA arriba a la izquierda sólo cuando la pestaña
            activa es la primera: así burbuja y tarjeta leen como una sola
            pieza. Si la activa está al medio o al final, las cuatro esquinas
            van redondeadas y el enganche se da por contacto (§5 bis · B). */}
        <MountedCard flush={tab === TABS[0]!.id}>
          {tab === 'cuenta' && (
            <div className="launch-pair">
              <Launcher icon="card" label="Ver tarjetas" onClick={() => navigate('tarjetas')} />
              <Launcher icon="receipt" label="Ver pagos" onClick={() => navigate('pagos')} />
            </div>
          )}

          {tab === 'estadisticas' && (
            <div className="launch-stack">
              {/* La frase es de Mati, textual, y va como invitación arriba. */}
              <p className="launch-invite">¿Quieres ver qué consumes, cuánto y dónde?</p>
              <Launcher
                icon="chart"
                label="Ver mis estadísticas"
                onClick={() => navigate('estadisticas')}
              />
            </div>
          )}

          {/**
           * ⛔ SIN DISEÑO INTERIOR, y es a propósito.
           *
           * "Asociadas" son cuentas de hijos y/o pareja: la parte de hijos es
           * **Cuentas Junior**, que la constitución del workspace lista como
           * stop condition —no se diseña ni implementa antes de un acta propia
           * ratificada—, y compartir tarjeta con la pareja es un instrumento de
           * pago compartido que toca los rieles de dinero de App Backend.
           *
           * Lo único permitido es que la pestaña EXISTA con un estado honesto.
           * Nada de filas, avatares, importes ni copy que describa la relación:
           * *"una pantalla que ya existe es mucho más difícil de discutir que
           * una que todavía no"*.
           */}
          {tab === 'asociadas' && (
            <div className="launch-stack">
              <div className="state-unknown">
                <Icon name="info" size={20} />
                <div>
                  <div className="state-unknown-title">Todavía no está disponible</div>
                  <p className="state-unknown-body">
                    Asociar la cuenta de otra persona toca cómo se autoriza un pago, así que no la
                    abrimos hasta tenerlo resuelto.
                  </p>
                </div>
              </div>
            </div>
          )}
        </MountedCard>

        {/* ─── La burbuja de la mesa. Va DEBAJO de los accesos, no arriba. ─── */}
        <section className="home-mesa" aria-label="Tu mesa abierta">
          {mesasFallaron ? (
            /* Error de red: borde SÓLIDO --danger + nube tachada + Reintentar.
               Las pestañas de arriba siguen funcionando (§1.1). */
            <div className="state-error">
              <div className="state-error-row">
                <Icon name="x-circle" size={22} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="state-error-title">No pudimos cargar tu mesa</div>
                  <p className="state-error-body">Revisa la conexión y prueba de nuevo.</p>
                </div>
              </div>
              {/* La salida es OBLIGATORIA: un estado que congela sin acción
                  visible es un defecto de diseño, no una medida de seguridad. */}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void cargarMesas()}>
                Reintentar
              </button>
            </div>
          ) : openMesas === null ? (
            /* Cargando: esqueleto con la SILUETA de la burbuja, nunca un spinner
               centrado (§5 · Estados honestos). */
            <div className="mesa-card sk" aria-busy="true" aria-label="Cargando tu mesa">
              <span className="sk-line w40" />
              <span className="sk-line w70 tall" />
              <span className="sk-line w55" />
              <span className="sk-line w100 bar" />
            </div>
          ) : mesa ? (
            /* Con UNA sola mesa —el caso mayoritario— la tarjeta va SOLA,
               exactamente como siempre: la condición de Diseño es cero cambio
               visual. La fila "+N más" y su grupo existen únicamente cuando
               hay más de una (§1.1, variante B). */
            (() => {
              const tarjeta = (
                <button type="button" className="mesa-card" onClick={() => navigate('mesa', mesa.code)}>
                  <div className="mesa-top">
                    <span className="mesa-kicker">Tu mesa abierta</span>
                    {/* Teal siempre: el naranja tiene una lista cerrada de cuatro
                        usos permitidos y un badge de estado no es ninguno. */}
                    <span className="badge badge-teal">{mesaStatusLabel(mesa.status)}</span>
                  </div>
                  <div className="mesa-name">{mesa.restaurant.name}</div>
                  {/* G-27: el spec pide "· 4 personas" y `GET /mesas/open` no trae
                      el número de comensales. No se infiere ni se inventa. */}
                  <div className="mesa-meta">Mesa {mesa.code}</div>

                  {/* La jerarquía dice "cuánto falta", no "cuánto es": lo pagado en
                      --fs-h1 tabular, el total en --fs-body muted. */}
                  <div className="mesa-money">
                    <span className="mesa-paid">{formatMXN(mesa.paid_amount_cents)}</span>
                    <span className="mesa-total">de {formatMXN(mesa.total_cents)}</span>
                  </div>
                  {/* La barra NUNCA va sola: los dos importes de arriba son el dato,
                      esto es el refuerzo. Por eso es aria-hidden. */}
                  <div className="mesa-bar" aria-hidden="true">
                    <span style={{ width: `${Math.min(100, Math.max(0, mesa.pct_paid))}%` }} />
                  </div>

                  <div className="mesa-foot">
                    {cuenta && (
                      <span className={`mesa-cd ${cuenta.urgent ? 'urgent' : ''}`}>
                        <Icon name="clock" size={15} className="ico-inline" /> Vence en {cuenta.text}
                      </span>
                    )}
                    <span className="mesa-go">Ver mesa →</span>
                  </div>
                </button>
              );
              return otras.length === 0 ? (
                tarjeta
              ) : (
                <div className="mesa-card-group">
                  {tarjeta}
                  <button type="button" className="mesa-more" onClick={() => setHojaAbierta(true)}>
                    {etiquetaMasMesas(otras.length)} <span aria-hidden="true">›</span>
                  </button>
                </div>
              );
            })()
          ) : (
            /* Vacío REAL: sin borde —es el único estado que no lo lleva— y sin
               botón propio. La acción ya está en el círculo naranja de la barra,
               a un centímetro: duplicarla sería competirle. */
            <div className="mesa-empty">
              <div className="mesa-empty-title">No tienes mesas abiertas</div>
              <p className="mesa-empty-body">Toca el + para abrir una</p>
              {/* G-36 · la mitad honesta del rescate (ORDEN 1-C·B): lo que no
                  se puede acreditar intacto NO se relanza — se conserva. Pero
                  entonces la demo puede quedar sin nada vivo y sin que nada lo
                  explique, que fue exactamente el problema original. Acá se
                  dice qué pasó y se ofrece la salida que ya existía en `Más`.
                  Sólo en mock: en el build real no existe. */}
              {IS_MOCK && demoVencida && (
                <div className="demo-reset">
                  <p className="mesa-empty-body">
                    Los datos de ejemplo de esta demo ya vencieron.
                  </p>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm btn-fit"
                    onClick={() => {
                      resetDemo();
                      window.location.reload();
                    }}
                  >
                    <Icon name="refresh" size={16} className="ico-inline" /> Reiniciar la demo
                  </button>
                </div>
              )}
            </div>
          )}
        </section>

        {/* ══════════════════════════════════════════════════════════════════
            RIEL DE SALDO · DURMIENTE. Los DOS bloques de abajo están gateados
            por la capability del BACKEND y hoy no renderizan nada.

            Se conservan a propósito, y el rediseño no los tocó: el gate cumple
            "cero UI" y el código durmiente cumple "no se borra". Reactivar el
            riel exige gate IFPE, auditoría y ratificación nueva — una orden,
            jamás una variable de entorno. Quien reescriba esta pantalla otra
            vez: son dos, no uno.
            ══════════════════════════════════════════════════════════════════ */}
        {walletRailEnabled && (
          <div className="saldo-card">
            <div className="lbl">Tu saldo PayMe</div>
            <div className="saldo-row">
              {/* G-03 (v2.21): tras el ojito se muestra el DISPONIBLE real. */}
              <div className="saldo-amt">
                {showBalance ? (balance ? formatMXN(balance.available_cents) : '…') : masked}
              </div>
              <button
                className="eye-btn"
                onClick={() => setShowBalance((v) => !v)}
                aria-label={showBalance ? 'Ocultar saldo' : 'Mostrar saldo'}
                aria-pressed={showBalance}
              >
                <Icon name={showBalance ? 'eye-off' : 'eye'} size={18} className="ico-inline" />
              </button>
              <button className="saldo-arrow" onClick={() => navigate('cuenta')} aria-label="Ir a Cuenta">
                →
              </button>
            </div>
            <div className="saldo-actions">
              <button className="btn btn-teal btn-sm" onClick={() => navigate('cargar')}>
                <Icon name="plus" size={16} className="ico-inline" /> Cargar
              </button>
              <button
                className="btn btn-sm"
                style={{ background: 'rgba(255,255,255,0.18)', color: '#fff' }}
                onClick={() => navigate('transferir')}
              >
                <Icon name="arrow-up-right" size={16} className="ico-inline" /> Transferir
              </button>
            </div>
          </div>
        )}

        {walletRailEnabled && txs && txs.length > 0 && (
          <>
            <div className="sect-row">
              <div className="sect-title">Últimos movimientos</div>
              <button className="vermas" onClick={() => navigate('cuenta')}>
                Ver más
              </button>
            </div>
            <div className="card" style={{ padding: '2px 16px' }}>
              {txs.map((t, idx) => (
                <div
                  key={t.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '11px 0',
                    borderBottom: idx < txs.length - 1 ? '1px solid var(--gray-l)' : 'none',
                  }}
                >
                  <span style={{ color: 'var(--gray-txt)' }} aria-hidden="true">
                    <Icon name={walletTxIcon(t.type)} size={20} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 'var(--fs-legacy-base)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {t.description ?? walletTxLabel(t.type)}
                    </div>
                    <div className="caption">{txDate(t.date)}</div>
                  </div>
                  {/* El monto respeta el mismo ojito que el saldo. */}
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: 'var(--fs-legacy-base)',
                      fontVariantNumeric: 'tabular-nums',
                      color: showBalance ? (t.sign === 'credit' ? 'var(--green)' : 'var(--red)') : 'var(--gray-txt)',
                    }}
                  >
                    {showBalance
                      ? `${t.sign === 'credit' ? '+' : '−'}${formatMXN(Math.abs(t.amount_cents))}`
                      : masked}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <AppBottomBar active="home" />

      {/* ─── Hoja inferior de "+N mesas abiertas más" (§1.1, variante B) ───
          Una fila por mesa: restaurante, código, la misma barra de progreso y
          el vencimiento. Mismo orden que la protagonista: vencimiento más
          próximo primero. Tocar una fila entra a esa mesa. */}
      {hojaAbierta && otras.length > 0 && (
        <div className="sheet-overlay" onClick={() => setHojaAbierta(false)}>
          <div
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Mesas abiertas"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sheet-head">
              <span className="sheet-title">Tus otras mesas abiertas</span>
              <button
                type="button"
                className="sheet-close"
                aria-label="Cerrar"
                onClick={() => setHojaAbierta(false)}
              >
                ✕
              </button>
            </div>
            {otras.map((m) => {
              const cd = countdownLong(m.expires_at);
              return (
                <button
                  key={m.code}
                  type="button"
                  className="sheet-mesa"
                  onClick={() => navigate('mesa', m.code)}
                >
                  <div className="sheet-mesa-top">
                    <span className="sheet-mesa-name">{m.restaurant.name}</span>
                    <span className="mesa-meta">Mesa {m.code}</span>
                  </div>
                  <div className="mesa-bar" aria-hidden="true">
                    <span style={{ width: `${Math.min(100, Math.max(0, m.pct_paid))}%` }} />
                  </div>
                  <div className="sheet-mesa-foot">
                    <span className="mesa-total">
                      {formatMXN(m.paid_amount_cents)} de {formatMXN(m.total_cents)}
                    </span>
                    {cd && (
                      <span className={`mesa-cd ${cd.urgent ? 'urgent' : ''}`}>
                        <Icon name="clock" size={14} className="ico-inline" /> Vence en {cd.text}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
