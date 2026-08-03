import type { StripeCardElement } from '@stripe/stripe-js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, IS_MOCK, WALLET_RAIL_ENABLED, newIdempotencyKey } from '../api';
import {
  CardSetupAttemptError,
  clearCardSetupAttempt,
  readCardSetupAttempt,
  writeCardSetupAttempt,
  type CardSetupAttemptState,
} from '../api/cardSetupAttempt';
import { extractApiError } from '../api/errors';
import { isDefinitiveMutationError, isServiceUnavailable } from '../api/mutationRetry';
import { loadSession, type StoredSession } from '../api/storage';
import { confirmCardSetup } from '../api/stripe';
import { CardField, type CardFieldState } from '../components/CardField';
import type { BalanceResponse, HistoryEntry, PaymentMethod, StatsResponse, WalletTransaction } from '../api/types';
import { Icon } from '../components/Icon';
import { CardBrandChip, TopBar, useToast } from '../components/ui';
import { navigate } from '../router';
import { formatMXN } from '../utils/format';
import { walletTxIcon, walletTxLabel } from '../utils/labels';
import { createInFlightMutex } from '../utils/inFlight';
import { accountRailView } from '../api/releaseGates';

/** s-account: saldo + tabs Historial / Tarjetas (GET balance, wallet-transactions, payment-methods). */

interface CardSetupAttempt extends CardSetupAttemptState {
  clientSecret?: string;
}

type CardRetryStage = 'none' | 'setup' | 'attach';

function currentCardSetupSession(origin: StoredSession): StoredSession | null {
  const current = loadSession();
  return current &&
    current.principal_id === origin.principal_id &&
    current.family_id === origin.family_id
    ? current
    : null;
}

function assertCardSetupOrigin(origin: StoredSession): StoredSession {
  const current = currentCardSetupSession(origin);
  if (!current) throw new CardSetupAttemptError('card_setup_actor_changed');
  return current;
}

function initialCardAttempt(): { attempt: CardSetupAttempt | null; error: string | null } {
  try {
    return { attempt: readCardSetupAttempt(), error: null };
  } catch {
    return { attempt: null, error: 'No podemos verificar el alta anterior de tarjeta. No vamos a crear otra hasta recuperar el estado local.' };
  }
}

function txDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const diffDays = Math.floor((today.getTime() - d.getTime()) / (24 * 60 * 60_000));
  if (diffDays === 0) return 'Hoy';
  if (diffDays === 1) return 'Ayer';
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
}

/**
 * Torta de gastos por categoría (T-F1, feedback del hermano): computada en el
 * front desde GET /account/history (cada pago trae `category` — sin pedirle
 * nada nuevo al backend). Las categorías son las del contrato; "bar" no
 * existe hoy en el enum del backend (anotado con Mati).
 */
const CAT_LABEL: Record<string, string> = {
  italian: 'Italiana',
  japanese: 'Japonesa',
  mexican: 'Mexicana',
  cafe: 'Café',
  bar: 'Bar',
  other: 'Otros',
};
const CAT_COLORS = ['var(--navy)', 'var(--teal)', 'var(--orange)', '#8FA6C0', '#C9D4E3'];

function CategoryPie({ slices }: { slices: Array<[string, number]> }) {
  const total = slices.reduce((s, [, v]) => s + v, 0);
  if (total <= 0) return null;
  // Donut por stroke-dasharray sobre circunferencia normalizada a 100.
  const R = 15.9155;
  let offset = 25; // arranca a las 12
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 12 }}>
      <svg width="96" height="96" viewBox="0 0 42 42" aria-hidden="true" style={{ flexShrink: 0 }}>
        {slices.map(([cat, v], i) => {
          const pct = (v / total) * 100;
          const el = (
            <circle
              key={cat}
              cx="21"
              cy="21"
              r={R}
              fill="none"
              stroke={CAT_COLORS[i % CAT_COLORS.length]}
              strokeWidth="7"
              strokeDasharray={`${pct} ${100 - pct}`}
              strokeDashoffset={offset}
            />
          );
          offset -= pct;
          return el;
        })}
      </svg>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
        {slices.map(([cat, v], i) => (
          <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{ width: 10, height: 10, borderRadius: 3, background: CAT_COLORS[i % CAT_COLORS.length], flexShrink: 0 }}
              aria-hidden="true"
            />
            <span style={{ flex: 1, fontSize: 'var(--fs-sm)', fontFamily: 'var(--font-body)' }}>
              {CAT_LABEL[cat] ?? 'Otros'}
            </span>
            <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
              {formatMXN(v)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function CuentaScreen() {
  const toast = useToast();
  const initialAttempt = useRef(initialCardAttempt()).current;
  const [adding, setAdding] = useState(!!initialAttempt.attempt || !!initialAttempt.error);
  const [busyCard, setBusyCard] = useState(false);
  const addCardInFlightRef = useRef(createInFlightMutex());
  const cardAttemptRef = useRef<CardSetupAttempt | null>(initialAttempt.attempt);
  const [cardRetryStage, setCardRetryStage] = useState<CardRetryStage>(initialAttempt.attempt?.stage ?? 'none');
  const [cardSetupBlocked, setCardSetupBlocked] = useState<string | null>(initialAttempt.error);
  const [cardEl, setCardEl] = useState<StripeCardElement | null>(null);
  const [cardState, setCardState] = useState<CardFieldState>({
    complete: false,
    error: null,
    empty: true,
  });
  const accountView = accountRailView(WALLET_RAIL_ENABLED);
  const [tab, setTab] = useState<'historial' | 'tarjetas'>(accountView.showAccountActivity ? 'historial' : 'tarjetas');
  const [balance, setBalance] = useState<BalanceResponse | null>(null);
  const [txs, setTxs] = useState<WalletTransaction[] | null>(null);
  const [pms, setPms] = useState<PaymentMethod[] | null>(null);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  // Gastos del mes por categoría, ordenados de mayor a menor (para la torta).
  // Mes en UTC: espeja el date_trunc('month', NOW()) del backend (server en
  // UTC) para que la torta cierre contra el "gastado" de stats de al lado.
  const monthCats = useMemo(() => {
    const now = new Date();
    const sums = new Map<string, number>();
    for (const h of history) {
      const d = new Date(h.date);
      if (d.getUTCMonth() !== now.getUTCMonth() || d.getUTCFullYear() !== now.getUTCFullYear()) continue;
      sums.set(h.category, (sums.get(h.category) ?? 0) + h.amount_cents);
    }
    return [...sums.entries()].sort((a, b) => b[1] - a[1]);
  }, [history]);

  function loadPms() {
    api.getPaymentMethods().then((r) => setPms(r.payment_methods)).catch(() => setPms([]));
  }

  useEffect(() => {
    let alive = true;
    if (WALLET_RAIL_ENABLED) {
      api.getBalance().then((b) => alive && setBalance(b)).catch(() => undefined);
      api.getWalletTransactions().then((r) => alive && setTxs(r.transactions)).catch(() => alive && setTxs([]));
    }
    if (accountView.showAccountActivity) {
      api.getStats().then((s) => alive && setStats(s)).catch(() => undefined);
      // El mes COMPLETO para la torta: sin params el backend da solo la primera
      // página (20) y con >20 pagos los montos no cerrarían contra stats.
      const now = new Date();
      const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
      api.getHistory({ from, limit: 100 }).then((r) => alive && setHistory(r.history)).catch(() => undefined);
    }
    loadPms();
    return () => {
      alive = false;
    };
  }, []);

  async function setDefault(id: string) {
    try {
      await api.setDefaultPaymentMethod(id);
      loadPms();
    } catch {
      toast('No se pudo actualizar');
    }
  }

  async function removePm(pm: PaymentMethod) {
    if (!window.confirm(`¿Quitar la tarjeta terminada en ${pm.last_four}?`)) return;
    try {
      await api.removePaymentMethod(pm.id);
      toast('Tarjeta eliminada');
      loadPms();
    } catch {
      toast('No se pudo eliminar');
    }
  }

  /**
   * Alta de tarjeta: SetupIntent en el backend → Stripe confirma y devuelve el
   * `pm_…` → se registra. La tarjeta nunca pasa por PayMe.
   */
  async function addCard() {
    if (!addCardInFlightRef.current.tryEnter()) return;
    if (cardSetupBlocked) {
      toast(cardSetupBlocked);
      addCardInFlightRef.current.leave();
      return;
    }
    const origin = loadSession();
    if (!origin) {
      toast('Tu sesión ya no está disponible. Volvé a ingresar antes de guardar una tarjeta.');
      addCardInFlightRef.current.leave();
      return;
    }
    setBusyCard(true);
    try {
      assertCardSetupOrigin(origin);
      let attempt = cardAttemptRef.current;
      if (!attempt) {
        attempt = {
          setupKey: newIdempotencyKey(),
          setAsDefault: pms?.length === 0,
          stage: 'setup',
        };
        // Durable ANTES de red: un reload reusa el mismo SetupIntent.
        writeCardSetupAttempt(attempt, origin);
        cardAttemptRef.current = attempt;
        setCardRetryStage('setup');
      }

      if (!attempt.clientSecret && !attempt.paymentMethodId) {
        const setup = await api.createSetupIntent(attempt.setupKey, assertCardSetupOrigin(origin));
        assertCardSetupOrigin(origin);
        attempt = { ...attempt, clientSecret: setup.client_secret };
        cardAttemptRef.current = attempt;
      }

      if (!attempt.paymentMethodId) {
        // En mock el id deriva de la key, para que incluso una excepción entre
        // materialización y attach vuelva a la MISMA tarjeta.
        let pmId = `pm_mock_${attempt.setupKey.replace(/[^a-zA-Z0-9]/g, '')}`;
        if (!IS_MOCK) {
          if (!cardEl || !attempt.clientSecret) {
            setCardState((s) => ({ ...s, error: 'Cargá los datos de la tarjeta para continuar.' }));
            setCardRetryStage('setup');
            return;
          }
          assertCardSetupOrigin(origin);
          const res = await confirmCardSetup(attempt.clientSecret, cardEl);
          assertCardSetupOrigin(origin);
          if ('error' in res) {
            if (res.definitive) {
              try {
                clearCardSetupAttempt(attempt.setupKey, origin);
                cardAttemptRef.current = null;
                setCardRetryStage('none');
              } catch {
                setCardSetupBlocked('El banco rechazó la tarjeta, pero no pudimos limpiar el intento local. No vamos a reenviarlo.');
              }
            } else {
              setCardRetryStage('setup');
            }
            setCardState((s) => ({ ...s, error: res.error }));
            return;
          }
          pmId = res.paymentMethodId;
        }
        attempt = { ...attempt, stage: 'attach', paymentMethodId: pmId };
        cardAttemptRef.current = attempt;
        // El pm_ no es secreto; persistirlo permite que reload reintente el
        // attach derivado/idempotente sin crear otro SetupIntent ni tarjeta.
        writeCardSetupAttempt(attempt, origin);
        setCardRetryStage('attach');
      }

      const paymentMethodId = attempt.paymentMethodId;
      if (!paymentMethodId) throw new Error('payment_method_materialization_ambiguous');
      assertCardSetupOrigin(origin);
      await api.attachPaymentMethod(
        paymentMethodId,
        attempt.setAsDefault,
        assertCardSetupOrigin(origin),
      );
      assertCardSetupOrigin(origin);
      // Fresh 201 y replay 200 son el mismo éxito contractual: recién acá
      // se rota la key de setup y se olvida el pm_ materializado.
      clearCardSetupAttempt(attempt.setupKey, origin);
      cardAttemptRef.current = null;
      setCardRetryStage('none');
      setCardSetupBlocked(null);
      toast('Tarjeta guardada ✓');
      setAdding(false);
      setCardEl(null);
      setCardState({ complete: false, error: null, empty: true });
      loadPms();
    } catch (err) {
      if (err instanceof CardSetupAttemptError) {
        if (err.message === 'card_setup_actor_changed') return;
        const message = 'No pudimos guardar de forma segura el estado de esta alta. No vamos a enviar otra operación.';
        setCardSetupBlocked(message);
        toast(message);
        return;
      }
      const failure = extractApiError(err);
      const definitive = isDefinitiveMutationError(failure.code, failure.status);
      if (definitive) {
        const setupKey = cardAttemptRef.current?.setupKey;
        try {
          if (setupKey) clearCardSetupAttempt(setupKey, origin);
          cardAttemptRef.current = null;
          setCardRetryStage('none');
        } catch {
          setCardSetupBlocked('El rechazo fue definitivo, pero no pudimos limpiar el intento local. No vamos a reenviarlo.');
        }
      } else {
        setCardRetryStage(cardAttemptRef.current?.paymentMethodId ? 'attach' : 'setup');
      }
      toast(
        isServiceUnavailable(failure.status)
          ? 'El servicio no pudo confirmar la tarjeta. Reintentá esta misma operación; no agregues otra.'
          : definitive
            ? 'No pudimos guardar la tarjeta. Revisá los datos y probá de nuevo.'
            : 'No pudimos confirmar si la tarjeta se guardó. Reintentá la misma operación: no vamos a crear otra.',
      );
    } finally {
      addCardInFlightRef.current.leave();
      setBusyCard(false);
    }
  }

  return (
    // T-F1: Cuenta es pestaña de la nav — sin flecha atrás, con aire para la barra.
    <div className="screen has-nav">
      <TopBar title="Mi Cuenta" />
      <div className="scroll" style={{ padding: 16 }}>
        {accountView.showBalance && <div style={{ background: 'linear-gradient(135deg,#071A33,#10264A)', borderRadius: 18, padding: '16px 18px 14px', marginBottom: 16 }}>
          {/* G-03 RESUELTO (v2.21): el monto grande es el DISPONIBLE real
              (balance − retenido, computado por el backend). */}
          <div style={{ fontSize: 'var(--fs-2xs)', color: 'rgba(255,255,255,0.7)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1.3, fontWeight: 700 }}>
            Disponible
          </div>
          <div style={{ fontSize: 'var(--fs-2xl)', fontWeight: 800, color: '#fff', lineHeight: 1 }}>
            {balance ? formatMXN(balance.available_cents) : '…'}
          </div>
          {balance && balance.held_balance_cents > 0 && (
            <div style={{ fontSize: 'var(--fs-sm)', color: 'rgba(255,255,255,0.75)', marginTop: 7, fontFamily: 'var(--font-body)' }}>
              <Icon name="lock" size={14} className="ico-inline" /> Retenido en garantías:{' '}
              {formatMXN(balance.held_balance_cents)}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
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
        </div>}

        {accountView.showAccountActivity && <div className="tabs">
          <button className={`tab ${tab === 'historial' ? 'on' : ''}`} onClick={() => setTab('historial')}>
            Historial
          </button>
          <button className={`tab ${tab === 'tarjetas' ? 'on' : ''}`} onClick={() => setTab('tarjetas')}>
            Tarjetas
          </button>
        </div>}

        {accountView.showAccountActivity && tab === 'historial' && (
          <>
            {stats && stats.month.visits > 0 && (
              <div className="card card-p" style={{ marginBottom: 14 }}>
                <div className="sectlabel">Este mes</div>
                <div style={{ display: 'flex', gap: 8, textAlign: 'center' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 800 }}>{formatMXN(stats.month.spent_cents)}</div>
                    <div className="caption">gastado</div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 800 }}>{stats.month.visits}</div>
                    <div className="caption">salidas</div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 800 }}>{formatMXN(stats.month.avg_per_visit_cents)}</div>
                    <div className="caption">promedio</div>
                  </div>
                </div>
                <CategoryPie slices={monthCats} />
                {stats.top_restaurants[0] && (
                  <div className="caption" style={{ marginTop: 10, textAlign: 'center' }}>
                    Tu favorito: <b style={{ color: 'var(--navy)' }}>{stats.top_restaurants[0].name}</b> ({stats.top_restaurants[0].visits} visitas)
                  </div>
                )}
              </div>
            )}
            {/* N-10: los pagos propios salen de GET /account/history (card-only) y
                se muestran SIEMPRE. La lista de wallet_transactions de abajo es
                riel saldo y sigue su flag. Sin el riel, esta es la única lista,
                así que el historial de la cuenta no desaparece del build real. */}
            {!accountView.showWalletMovements && (
              <>
                <div className="sectlabel">Mis pagos</div>
                {history.length === 0 && (
                  <div className="empty">
                    <div className="emoji"><Icon name="receipt" size={40} /></div>
                    Todavía no pagaste ninguna mesa.
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
                  {history.map((h) => (
                    <div key={h.id} className="card card-p" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ color: 'var(--gray-txt)' }} aria-hidden="true">
                        <Icon name="receipt" size={20} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 'var(--fs-base)' }}>{h.restaurant}</div>
                        <div className="caption">
                          {txDate(h.date)} · Mesa {h.mesa_code}
                        </div>
                      </div>
                      <div style={{ fontWeight: 700, fontSize: 'var(--fs-base)' }}>
                        {formatMXN(h.amount_cents)}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
            {accountView.showWalletMovements && (
              <>
            <div className="sectlabel">Movimientos</div>
            {txs === null && <div className="loading">Cargando movimientos…</div>}
            {txs?.length === 0 && (
              <div className="empty">
                <div className="emoji"><Icon name="receipt" size={40} /></div>
                Todavía no hay movimientos.
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {txs?.map((t) => (
                <div key={t.id} className="card card-p" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ color: 'var(--gray-txt)' }} aria-hidden="true">
                    <Icon name={walletTxIcon(t.type)} size={20} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 'var(--fs-base)' }}>
                      {t.description ?? walletTxLabel(t.type)}
                    </div>
                    <div className="caption">
                      {txDate(t.date)} · {walletTxLabel(t.type)}
                    </div>
                  </div>
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: 'var(--fs-base)',
                      color: t.sign === 'credit' ? 'var(--green)' : 'var(--red)',
                    }}
                  >
                    {t.sign === 'credit' ? '+' : '−'}
                    {formatMXN(Math.abs(t.amount_cents))}
                  </div>
                </div>
              ))}
            </div>
              </>
            )}
          </>
        )}

        {tab === 'tarjetas' && (
          <>
            <div className="sectlabel">Tarjetas guardadas</div>
            {pms === null && <div className="loading">Cargando tarjetas…</div>}
            {pms?.length === 0 && (
              <div className="empty">
                <div className="emoji"><Icon name="card" size={40} /></div>
                No tenés tarjetas guardadas.
              </div>
            )}
            {pms?.map((pm) => (
              <div key={pm.id} className="card card-p" style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 12 }}>
                <CardBrandChip brand={pm.brand} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 'var(--fs-base)' }}>{pm.bank_name ?? pm.brand}</div>
                  <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--gray-txt)', fontFamily: 'monospace' }}>
                    ···· {pm.last_four} · {pm.type === 'credit' ? 'Crédito' : 'Débito'}
                  </div>
                </div>
                {pm.is_default ? (
                  <span className="badge badge-teal">Principal</span>
                ) : (
                  <button className="login-toggle" style={{ padding: 4 }} onClick={() => setDefault(pm.id)}>
                    Hacer principal
                  </button>
                )}
                <button
                  className="back-btn"
                  style={{ width: 30, height: 30, fontSize: 'var(--fs-base)' }}
                  aria-label={`Quitar tarjeta ${pm.last_four}`}
                  onClick={() => removePm(pm)}
                >
                  ✕
                </button>
              </div>
            ))}
            {adding ? (
              <div className="card card-p" style={{ marginTop: 6 }}>
                <div className="sectlabel">Nueva tarjeta</div>
                {cardRetryStage !== 'none' && (
                  <div className="note note-orange" style={{ marginBottom: 12 }} role="status">
                    {cardRetryStage === 'attach'
                      ? 'Esta tarjeta quedó sin confirmar. Reintentá la misma operación: conservamos el mismo registro y no vamos a generar otra.'
                      : 'Esta alta quedó sin confirmar. Reintentá la misma operación: conservamos su clave.'}
                  </div>
                )}
                {cardSetupBlocked && (
                  <div className="form-error" role="alert" style={{ marginBottom: 12 }}>
                    {cardSetupBlocked}
                  </div>
                )}
                {cardRetryStage === 'attach' ? (
                  <div className="caption" style={{ marginBottom: 12 }}>
                    La tarjeta ya fue materializada por Stripe. Solo reintentaremos registrar esa misma referencia.
                  </div>
                ) : IS_MOCK ? (
                  <div className="note note-teal" style={{ marginBottom: 12 }}>
                    En la demo no pedimos datos reales: se agrega una tarjeta de ejemplo.
                  </div>
                ) : (
                  <>
                    <CardField onReady={setCardEl} onChange={setCardState} />
                    {cardState.error && (
                      <div className="caption" style={{ color: 'var(--red)' }} role="alert">
                        {cardState.error}
                      </div>
                    )}
                    <div className="caption" style={{ marginBottom: 12 }}>
                      Los datos van directo a Stripe: PayMe nunca ve el número completo.
                    </div>
                  </>
                )}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setAdding(false);
                      setCardEl(null);
                    }}
                  >
                    Cancelar
                  </button>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={addCard}
                    disabled={!!cardSetupBlocked || busyCard || (!IS_MOCK && cardRetryStage !== 'attach' && !cardState.complete)}
                  >
                    {busyCard
                      ? 'Guardando…'
                      : cardRetryStage === 'attach'
                        ? 'Reintentar la misma tarjeta'
                        : 'Guardar tarjeta'}
                  </button>
                </div>
              </div>
            ) : (
              <button className="btn btn-ghost" style={{ marginTop: 6 }} onClick={() => setAdding(true)}>
                + Agregar tarjeta
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
