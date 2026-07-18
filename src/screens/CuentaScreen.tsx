import { useEffect, useState } from 'react';
import { api } from '../api';
import type { BalanceResponse, PaymentMethod, WalletTransaction } from '../api/types';
import { TopBar } from '../components/ui';
import { navigate } from '../router';
import { formatMXN } from '../utils/format';

/** s-account: saldo + tabs Historial / Tarjetas (GET balance, wallet-transactions, payment-methods). */

const TX_META: Record<string, { emoji: string; label: string }> = {
  topup_oxxo: { emoji: '🏪', label: 'Carga OXXO' },
  topup_card: { emoji: '💳', label: 'Carga con tarjeta' },
  topup_spei: { emoji: '🏦', label: 'Abono SPEI' },
  transfer_in: { emoji: '↘️', label: 'Transferencia recibida' },
  transfer_out: { emoji: '↗️', label: 'Transferencia enviada' },
  payment_mesa: { emoji: '🍝', label: 'Pago de mesa' },
  refund_mesa: { emoji: '↩️', label: 'Reembolso de mesa' },
  tip_received: { emoji: '💰', label: 'Propina recibida' },
  tip_payout: { emoji: '💸', label: 'Propina pagada' },
  adjustment_credit: { emoji: '➕', label: 'Ajuste a favor' },
  adjustment_debit: { emoji: '➖', label: 'Ajuste en contra' },
};

function txDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const diffDays = Math.floor((today.getTime() - d.getTime()) / (24 * 60 * 60_000));
  if (diffDays === 0) return 'Hoy';
  if (diffDays === 1) return 'Ayer';
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
}

export function CuentaScreen() {
  const [tab, setTab] = useState<'historial' | 'tarjetas'>('historial');
  const [balance, setBalance] = useState<BalanceResponse | null>(null);
  const [txs, setTxs] = useState<WalletTransaction[] | null>(null);
  const [pms, setPms] = useState<PaymentMethod[] | null>(null);

  useEffect(() => {
    let alive = true;
    api.getBalance().then((b) => alive && setBalance(b)).catch(() => undefined);
    api.getWalletTransactions().then((r) => alive && setTxs(r.transactions)).catch(() => alive && setTxs([]));
    api.getPaymentMethods().then((r) => alive && setPms(r.payment_methods)).catch(() => alive && setPms([]));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="screen">
      <TopBar title="Mi Cuenta" onBack={() => navigate('home')} />
      <div className="scroll" style={{ padding: 16 }}>
        <div style={{ background: 'linear-gradient(135deg,#071A33,#10264A)', borderRadius: 18, padding: '16px 18px 14px', marginBottom: 16 }}>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.58)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1.3, fontWeight: 700 }}>
            Saldo disponible
          </div>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#fff', lineHeight: 1 }}>
            {balance ? formatMXN(balance.balance_cents) : '…'}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn btn-teal" style={{ padding: 9, fontSize: 12 }} onClick={() => navigate('cargar')}>
              ➕ Cargar
            </button>
            <button className="btn" style={{ padding: 9, fontSize: 12, background: 'rgba(255,255,255,0.12)', color: '#fff' }} onClick={() => navigate('transferir')}>
              ↗️ Transferir
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
            <div className="sectlabel">Movimientos</div>
            {txs === null && <div className="loading">Cargando movimientos…</div>}
            {txs?.length === 0 && (
              <div className="empty">
                <div className="emoji">🧾</div>
                Todavía no hay movimientos.
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {txs?.map((t) => {
                const meta = TX_META[t.type] ?? { emoji: '·', label: t.type };
                return (
                  <div key={t.id} className="card card-p" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ fontSize: 18 }}>{meta.emoji}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{t.description ?? meta.label}</div>
                      <div style={{ fontSize: 11, color: 'var(--gray-d)', fontFamily: 'var(--font-body)' }}>
                        {txDate(t.date)} · {t.type}
                      </div>
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: t.sign === 'credit' ? 'var(--green)' : 'var(--red)' }}>
                      {t.sign === 'credit' ? '+' : '-'}
                      {formatMXN(Math.abs(t.amount_cents))}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {tab === 'tarjetas' && (
          <>
            <div className="sectlabel">Tarjetas guardadas</div>
            {pms === null && <div className="loading">Cargando tarjetas…</div>}
            {pms?.map((pm) => (
              <div key={pm.id} className="card card-p" style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 12 }}>
                <div className="cc visa">{pm.brand === 'visa' ? 'VISA' : pm.brand.toUpperCase().slice(0, 4)}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{pm.bank_name ?? pm.brand}</div>
                  <div style={{ fontSize: 11, color: 'var(--gray-d)', fontFamily: 'monospace' }}>
                    ···· {pm.last_four} · {pm.type === 'credit' ? 'Crédito' : 'Débito'}
                  </div>
                </div>
                {pm.is_default && <span className="badge badge-teal">Principal</span>}
              </div>
            ))}
            <div className="note note-teal" style={{ marginTop: 6 }}>
              Agregar tarjetas nuevas llega con la conexión al backend real (usa Stripe para
              guardarlas de forma segura — PayMe nunca ve el número completo).
            </div>
          </>
        )}
      </div>
    </div>
  );
}
