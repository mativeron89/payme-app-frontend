import { useEffect, useState } from 'react';
import { api, newIdempotencyKey } from '../api';
import type { ClabeResponse, PaymentMethod, TopupOxxoResponse } from '../api/types';
import { TopBar, useToast } from '../components/ui';
import { navigate } from '../router';
import { formatMXN } from '../utils/format';
import { stringToCents } from '../utils/money';

/**
 * s-topup (T5 + A-3): tres vías reales del contrato — OXXO (voucher),
 * tarjeta (cobro inmediato) y SPEI (CLABE virtual, GET /api/wallet/clabe).
 * Límites del schema: $50.00 a $10,000.00 (5000–1000000 centavos).
 */

type Via = 'oxxo' | 'card' | 'spei';

export function TopupScreen() {
  const toast = useToast();
  const [via, setVia] = useState<Via>('oxxo');
  const [amountStr, setAmountStr] = useState('500');
  const [pm, setPm] = useState<PaymentMethod | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voucher, setVoucher] = useState<TopupOxxoResponse['topup'] | null>(null);
  const [clabe, setClabe] = useState<ClabeResponse | null>(null);

  useEffect(() => {
    api
      .getPaymentMethods()
      .then((r) => setPm(r.payment_methods.find((p) => p.is_default) ?? r.payment_methods[0] ?? null))
      .catch(() => setPm(null));
  }, []);

  useEffect(() => {
    if (via === 'spei' && !clabe) {
      api.getClabe().then(setClabe).catch(() => undefined);
    }
  }, [via, clabe]);

  let amountCents = 0;
  try {
    amountCents = stringToCents(amountStr || '0');
  } catch {
    amountCents = 0;
  }
  const amountOk = amountCents >= 5000 && amountCents <= 1_000_000;

  async function doTopup() {
    setBusy(true);
    setError(null);
    try {
      if (via === 'oxxo') {
        const r = await api.topupOxxo(amountCents, newIdempotencyKey());
        setVoucher(r.topup);
      } else if (via === 'card') {
        if (!pm) return;
        await api.topupCard(amountCents, pm.id, newIdempotencyKey());
        toast(`Se acreditaron ${formatMXN(amountCents)} ✓`);
        navigate('cuenta');
      }
    } catch {
      setError('No pudimos iniciar la carga. Probá de nuevo.');
    } finally {
      setBusy(false);
    }
  }

  // Voucher OXXO generado
  if (voucher) {
    return (
      <div className="screen">
        <TopBar title="Cargar saldo" onBack={() => navigate('cuenta')} />
        <div className="scroll" style={{ padding: 16 }}>
          <div style={{ textAlign: 'center', padding: '10px 0 16px' }}>
            <div style={{ fontSize: 40 }}>🏪</div>
            <div className="h2" style={{ marginTop: 8 }}>
              Pagá en cualquier OXXO
            </div>
          </div>
          <div className="voucher">
            <div style={{ fontSize: 12, color: 'var(--gray-d)', fontFamily: 'var(--font-body)' }}>Referencia OXXO</div>
            <div className="num">{voucher.voucher_reference}</div>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>{formatMXN(voucher.amount_cents)}</div>
            <div style={{ fontSize: 11, color: 'var(--gray-d)', fontFamily: 'var(--font-body)' }}>
              Vence el {new Date(voucher.voucher_expires_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'long' })} ·
              mostrá este número en caja
            </div>
          </div>
          <div className="note note-teal" style={{ marginTop: 12 }}>
            El saldo se acredita solo cuando pagues en la tienda. Te avisamos con una
            notificación.
          </div>
        </div>
        <div className="action-bar">
          <button className="btn btn-navy" onClick={() => navigate('cuenta')}>
            Listo
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <TopBar title="Cargar saldo" onBack={() => navigate('home')} />
      <div className="scroll" style={{ padding: 16 }}>
        {via !== 'spei' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '8px 0 0' }}>
              <span className="amt-display" style={{ marginRight: 2 }}>
                $
              </span>
              <input
                className="amt-input"
                style={{ width: `${Math.max(2, amountStr.length)}ch` }}
                inputMode="decimal"
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value.replace(/[^0-9.]/g, ''))}
                aria-label="Monto a cargar"
              />
            </div>
            <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--gray-d)', margin: '4px 0 16px', fontFamily: 'var(--font-body)' }}>
              Monto a cargar (mín. $50, máx. $10,000)
            </div>
          </>
        )}
        <div className="seg">
          <button className={`seg-btn ${via === 'oxxo' ? 'on' : ''}`} onClick={() => setVia('oxxo')}>
            🏪 OXXO
          </button>
          <button className={`seg-btn ${via === 'card' ? 'on' : ''}`} onClick={() => setVia('card')}>
            💳 Tarjeta
          </button>
          <button className={`seg-btn ${via === 'spei' ? 'on' : ''}`} onClick={() => setVia('spei')}>
            🏦 SPEI
          </button>
        </div>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}

        {via === 'oxxo' && (
          <div className="note note-teal">
            Te damos una referencia para pagar en efectivo en cualquier OXXO. El saldo se
            acredita al pagar en la tienda (tarda unos minutos).
          </div>
        )}

        {via === 'card' &&
          (pm ? (
            <div className="method-card sel" style={{ cursor: 'default' }}>
              <div className="cc visa">VISA</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>
                  {pm.bank_name ?? pm.brand} ···· {pm.last_four}
                </div>
                <div style={{ fontSize: 12, color: 'var(--gray-d)', fontFamily: 'var(--font-body)' }}>
                  Se acredita al instante
                </div>
              </div>
              <div className="radio" />
            </div>
          ) : (
            <div className="note note-orange">No tenés tarjetas guardadas todavía.</div>
          ))}

        {via === 'spei' && (
          <>
            {clabe ? (
              <div className="voucher spei">
                <div style={{ fontSize: 12, color: 'var(--gray-d)', fontFamily: 'var(--font-body)' }}>
                  Tu CLABE PayMe ({clabe.banco})
                </div>
                <div className="num">{clabe.clabe}</div>
                <div style={{ fontSize: 11, color: 'var(--gray-d)', fontFamily: 'var(--font-body)' }}>
                  Beneficiario: {clabe.beneficiario}
                </div>
                <button
                  className="btn btn-teal"
                  style={{ marginTop: 12, padding: 12, fontSize: 13 }}
                  onClick={() => {
                    void navigator.clipboard.writeText(clabe.clabe).then(
                      () => toast('CLABE copiada 📋'),
                      () => toast('No se pudo copiar'),
                    );
                  }}
                >
                  📋 Copiar CLABE
                </button>
              </div>
            ) : (
              <div className="loading">Generando tu CLABE…</div>
            )}
            <div className="note note-teal" style={{ marginTop: 12 }}>
              {clabe?.instrucciones ??
                'Transferí por SPEI a esta CLABE desde tu banco; el saldo se acredita solo.'}{' '}
              Sin monto mínimo, disponible 24/7.
            </div>
          </>
        )}
      </div>
      {via !== 'spei' && (
        <div className="action-bar">
          <button className="btn btn-primary" onClick={doTopup} disabled={busy || !amountOk || (via === 'card' && !pm)}>
            {busy ? 'Procesando…' : `Cargar ${amountOk ? formatMXN(amountCents) : '—'}`}
          </button>
        </div>
      )}
    </div>
  );
}
