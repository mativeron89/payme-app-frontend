import { useEffect, useState } from 'react';
import { api } from '../api';
import type { BalanceResponse, PaymentMethod, StatsResponse, WalletTransaction } from '../api/types';
import { TopBar, useToast } from '../components/ui';
import { navigate } from '../router';
import { formatMXN } from '../utils/format';
import { walletTxEmoji, walletTxLabel } from '../utils/labels';

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

  return (
    <div className="screen">
      <TopBar title="Mi Cuenta" onBack={() => navigate('home')} />
      <div className="scroll" style={{ padding: 16 }}>
        <div style={{ background: 'linear-gradient(135deg,#071A33,#10264A)', borderRadius: 18, padding: '16px 18px 14px', marginBottom: 16 }}>
          {/* G-03: el contrato no expone held_balance_cents, así que no podemos
              afirmar "disponible" — con una garantía por saldo activa, parte de
              este monto está retenido. */}
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1.3, fontWeight: 700 }}>
            Tu saldo PayMe
          </div>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#fff', lineHeight: 1 }}>
            {balance ? formatMXN(balance.balance_cents) : '…'}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn btn-teal btn-sm" onClick={() => navigate('cargar')}>
              <span aria-hidden="true">➕</span> Cargar
            </button>
            <button
              className="btn btn-sm"
              style={{ background: 'rgba(255,255,255,0.18)', color: '#fff' }}
              onClick={() => navigate('transferir')}
            >
              <span aria-hidden="true">↗️</span> Transferir
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
                    <div style={{ fontSize: 17, fontWeight: 800 }}>{formatMXN(stats.month.spent_cents)}</div>
                    <div style={{ fontSize: 10.5, color: 'var(--gray-d)', fontFamily: 'var(--font-body)' }}>gastado</div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 17, fontWeight: 800 }}>{stats.month.visits}</div>
                    <div style={{ fontSize: 10.5, color: 'var(--gray-d)', fontFamily: 'var(--font-body)' }}>salidas</div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 17, fontWeight: 800 }}>{formatMXN(stats.month.avg_per_visit_cents)}</div>
                    <div style={{ fontSize: 10.5, color: 'var(--gray-d)', fontFamily: 'var(--font-body)' }}>promedio</div>
                  </div>
                </div>
                {stats.top_restaurants[0] && (
                  <div style={{ fontSize: 11.5, color: 'var(--gray-d)', marginTop: 10, fontFamily: 'var(--font-body)', textAlign: 'center' }}>
                    Tu favorito: <b style={{ color: 'var(--navy)' }}>{stats.top_restaurants[0].name}</b> ({stats.top_restaurants[0].visits} visitas)
                  </div>
                )}
              </div>
            )}
            <div className="sectlabel">Movimientos</div>
            {txs === null && <div className="loading">Cargando movimientos…</div>}
            {txs?.length === 0 && (
              <div className="empty">
                <div className="emoji">🧾</div>
                Todavía no hay movimientos.
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {txs?.map((t) => (
                <div key={t.id} className="card card-p" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ fontSize: 18 }} aria-hidden="true">
                    {walletTxEmoji(t.type)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>
                      {t.description ?? walletTxLabel(t.type)}
                    </div>
                    <div className="caption">
                      {txDate(t.date)} · {walletTxLabel(t.type)}
                    </div>
                  </div>
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: 14,
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
                <div className="emoji">💳</div>
                No tenés tarjetas guardadas.
              </div>
            )}
            {pms?.map((pm) => (
              <div key={pm.id} className="card card-p" style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 12 }}>
                <div className="cc visa">{pm.brand === 'visa' ? 'VISA' : pm.brand.toUpperCase().slice(0, 4)}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{pm.bank_name ?? pm.brand}</div>
                  <div style={{ fontSize: 11, color: 'var(--gray-d)', fontFamily: 'monospace' }}>
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
                  style={{ width: 30, height: 30, fontSize: 14 }}
                  aria-label={`Quitar tarjeta ${pm.last_four}`}
                  onClick={() => removePm(pm)}
                >
                  ✕
                </button>
              </div>
            ))}
            <div className="note note-teal" style={{ marginTop: 6 }}>
              Pronto vas a poder agregar tarjetas nuevas. Las guarda Stripe de forma segura:
              PayMe nunca ve el número completo.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
