import type { StripeCardElement } from '@stripe/stripe-js';
import { useEffect, useState } from 'react';
import { api, IS_MOCK } from '../api';
import { confirmCardSetup } from '../api/stripe';
import { CardField, type CardFieldState } from '../components/CardField';
import type { BalanceResponse, PaymentMethod, StatsResponse, WalletTransaction } from '../api/types';
import { Icon } from '../components/Icon';
import { CardBrandChip, TopBar, useToast } from '../components/ui';
import { navigate } from '../router';
import { formatMXN } from '../utils/format';
import { walletTxIcon, walletTxLabel } from '../utils/labels';

/** s-account: saldo + tabs Historial / Tarjetas (GET balance, wallet-transactions, payment-methods). */

function txDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const diffDays = Math.floor((today.getTime() - d.getTime()) / (24 * 60 * 60_000));
  if (diffDays === 0) return 'Hoy';
  if (diffDays === 1) return 'Ayer';
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
}

export function CuentaScreen() {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [busyCard, setBusyCard] = useState(false);
  const [cardEl, setCardEl] = useState<StripeCardElement | null>(null);
  const [cardState, setCardState] = useState<CardFieldState>({
    complete: false,
    error: null,
    empty: true,
  });
  const [tab, setTab] = useState<'historial' | 'tarjetas'>('historial');
  const [balance, setBalance] = useState<BalanceResponse | null>(null);
  const [txs, setTxs] = useState<WalletTransaction[] | null>(null);
  const [pms, setPms] = useState<PaymentMethod[] | null>(null);
  const [stats, setStats] = useState<StatsResponse | null>(null);

  function loadPms() {
    api.getPaymentMethods().then((r) => setPms(r.payment_methods)).catch(() => setPms([]));
  }

  useEffect(() => {
    let alive = true;
    api.getBalance().then((b) => alive && setBalance(b)).catch(() => undefined);
    api.getWalletTransactions().then((r) => alive && setTxs(r.transactions)).catch(() => alive && setTxs([]));
    api.getStats().then((s) => alive && setStats(s)).catch(() => undefined);
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
    setBusyCard(true);
    try {
      const { client_secret } = await api.createSetupIntent();
      // Mock: id fresco por alta — con uno fijo, la dedupe del mock haría
      // no-op silencioso a partir de la segunda tarjeta (éxito falso).
      let pmId = `pm_mock_${Date.now().toString(36)}`;
      if (!IS_MOCK) {
        if (!cardEl) return;
        const res = await confirmCardSetup(client_secret, cardEl);
        if ('error' in res) {
          setCardState((s) => ({ ...s, error: res.error }));
          return;
        }
        pmId = res.paymentMethodId;
      }
      await api.attachPaymentMethod(pmId, pms?.length === 0);
      toast('Tarjeta guardada ✓');
      setAdding(false);
      setCardEl(null);
      setCardState({ complete: false, error: null, empty: true });
      loadPms();
    } catch {
      toast('No pudimos guardar la tarjeta');
    } finally {
      setBusyCard(false);
    }
  }

  return (
    <div className="screen">
      <TopBar title="Mi Cuenta" onBack={() => navigate('home')} />
      <div className="scroll" style={{ padding: 16 }}>
        <div style={{ background: 'linear-gradient(135deg,#071A33,#10264A)', borderRadius: 18, padding: '16px 18px 14px', marginBottom: 16 }}>
          {/* G-03: el contrato no expone held_balance_cents, así que no podemos
              afirmar "disponible" — con una garantía por saldo activa, parte de
              este monto está retenido. */}
          <div style={{ fontSize: 'var(--fs-2xs)', color: 'rgba(255,255,255,0.7)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1.3, fontWeight: 700 }}>
            Tu saldo PayMe
          </div>
          <div style={{ fontSize: 'var(--fs-2xl)', fontWeight: 800, color: '#fff', lineHeight: 1 }}>
            {balance ? formatMXN(balance.balance_cents) : '…'}
          </div>
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
        </div>

        <div className="tabs">
          <button className={`tab ${tab === 'historial' ? 'on' : ''}`} onClick={() => setTab('historial')}>
            Historial
          </button>
          <button className={`tab ${tab === 'tarjetas' ? 'on' : ''}`} onClick={() => setTab('tarjetas')}>
            Tarjetas
          </button>
        </div>

        {tab === 'historial' && (
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
                {stats.top_restaurants[0] && (
                  <div className="caption" style={{ marginTop: 10, textAlign: 'center' }}>
                    Tu favorito: <b style={{ color: 'var(--navy)' }}>{stats.top_restaurants[0].name}</b> ({stats.top_restaurants[0].visits} visitas)
                  </div>
                )}
              </div>
            )}
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
                {IS_MOCK ? (
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
                    disabled={busyCard || (!IS_MOCK && !cardState.complete)}
                  >
                    {busyCard ? 'Guardando…' : 'Guardar tarjeta'}
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
