import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import {
  acquireMonetaryIntent,
  completeMonetaryIntent,
  prepareMonetaryRequest,
  readMonetaryReference,
  rememberMonetaryReference,
  scopeForActor,
  shouldRotateOnError,
  useMoneyActor,
  type MonetaryIntentHandle,
} from '../api/idempotency';
import { extractApiError } from '../api/errors';
import { pollTopup, topupOutcome } from '../api/paymentStatus';
import { confirmCardPayment } from '../api/stripe';
import { loadSession, type StoredSession } from '../api/storage';
import type { ClabeResponse, PaymentMethod, TopupOxxoResponse } from '../api/types';
import { Icon } from '../components/Icon';
import { CardBrandChip, TopBar, useToast } from '../components/ui';
import { goBack, navigate } from '../router';
import { formatMXN } from '../utils/format';
import { stringToCents } from '../utils/money';
import { createInFlightMutex } from '../utils/inFlight';

/**
 * s-topup (T5 + A-3): tres vías reales del contrato — OXXO (voucher),
 * tarjeta (cobro inmediato) y SPEI (CLABE virtual, GET /api/wallet/clabe).
 * Límites del schema: $50.00 a $10,000.00 (5000–1000000 centavos).
 */

type Via = 'oxxo' | 'card' | 'spei';
type VoucherTopup = TopupOxxoResponse['topup'] & { voucher_reference: string; voucher_expires_at: string };
function hasVoucher(topup: TopupOxxoResponse['topup']): topup is VoucherTopup {
  return typeof topup.voucher_reference === 'string' && topup.voucher_reference.length > 0 &&
    typeof topup.voucher_expires_at === 'string' && topup.voucher_expires_at.length > 0;
}

export function TopupScreen() {
  const toast = useToast();
  const { actor, error: actorError } = useMoneyActor();
  const [via, setVia] = useState<Via>('oxxo');
  const [amountStr, setAmountStr] = useState('500');
  const [pm, setPm] = useState<PaymentMethod | null>(null);
  const [busy, setBusy] = useState(false);
  const topupInFlightRef = useRef(createInFlightMutex());
  const [error, setError] = useState<string | null>(null);
  const [voucher, setVoucher] = useState<VoucherTopup | null>(null);
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

  /**
   * B-06: con clave nueva por intento, un reintento de OXXO emite un SEGUNDO
   * voucher válido (dos referencias vivas; si se pagan las dos, se acredita
   * el doble) y uno de tarjeta cobra otra vez.
   */
  const topupScope = actor ? scopeForActor(actor, `topup:${via}:${amountCents}`) : '';

  function originCurrent(origin: StoredSession | undefined): boolean {
    const current = loadSession();
    return !!origin && !!current && current.principal_id === origin.principal_id && current.family_id === origin.family_id;
  }
  async function reconcileTopup(id: string, scope: string, intent: MonetaryIntentHandle, origin: StoredSession | undefined) {
    const reconciled = await pollTopup(() => api.getTopup(id, amountCents, 'card'), () => originCurrent(origin));
    if (!originCurrent(origin)) return;
    if (reconciled.outcome === 'success') {
      await completeMonetaryIntent(scope, 'topup_card', intent);
      toast(`Se acreditaron ${formatMXN(amountCents)} ✓`);
      navigate('cuenta');
    } else if (reconciled.outcome === 'definitive') {
      await completeMonetaryIntent(scope, 'topup_card', intent);
      setError('Ese cobro no prosperó. Puedes iniciar una nueva carga.');
    } else {
      setError('La carga sigue en confirmación. No inicies otra carga hasta que se resuelva.');
    }
  }

  useEffect(() => {
    if (!actor) return;
    const scope = scopeForActor(actor, 'topup:resume');
    let alive = true;
    void readMonetaryReference(scope, 'topup_card')
      .then((pending) => { if (pending && alive) setError('Hay una carga anterior en reconciliación; no se inició otra.'); })
      .catch(() => alive && setError('Hay una carga anterior en reconciliación; no se inició otra.'));
    return () => { alive = false; };
  }, [actor]);

  async function doTopup() {
    if (!topupInFlightRef.current.tryEnter()) return;
    if (!topupScope || !actor) {
      setError(actorError ? 'No pudimos verificar una identidad segura para esta carga.' : 'Preparando una identidad segura para esta carga…');
      topupInFlightRef.current.leave();
      return;
    }
    setBusy(true);
    setError(null);
    let intent: MonetaryIntentHandle | null = null;
    const operation = via === 'oxxo' ? 'topup_oxxo' : 'topup_card';
    try {
      if (via === 'oxxo') {
        intent = await acquireMonetaryIntent(topupScope, 'topup_oxxo');
        await prepareMonetaryRequest(topupScope, 'topup_oxxo', intent, { amount_cents: amountCents, idempotency_key: intent.key });
        const r = await api.topupOxxo(amountCents, intent);
        const outcome = topupOutcome(r.topup.status, false);
        if (outcome === 'success') {
          await completeMonetaryIntent(topupScope, 'topup_oxxo', intent);
          toast(`Se acreditaron ${formatMXN(amountCents)} ✓`);
          navigate('cuenta');
        } else if (outcome === 'definitive') {
          await completeMonetaryIntent(topupScope, 'topup_oxxo', intent);
          setError('Esa carga no prosperó. Puedes iniciar otra.');
        } else if (hasVoucher(r.topup)) {
          await completeMonetaryIntent(topupScope, 'topup_oxxo', intent);
          setVoucher(r.topup);
        } else {
          // Defensa redundante: la fachada contractual rechaza esta forma
          // dentro de withPreparedMonetaryRequest, antes de llegar a la UI.
          setError('La carga sigue en confirmación pero no podemos mostrar su referencia todavía. No inicies otra carga.');
        }
      } else if (via === 'card') {
        if (!pm) return;
        intent = await acquireMonetaryIntent(topupScope, 'topup_card');
        await prepareMonetaryRequest(topupScope, 'topup_card', intent, {
          amount_cents: amountCents,
          payment_method_id: pm.id,
          idempotency_key: intent.key,
        });
        const r = await api.topupCard(amountCents, pm.id, intent);
        // El banco puede pedir 3DS: sin confirmarlo, la plata no entra y el
        // toast anunciaba saldo inexistente.
        if (r.requires_action === true && r.client_secret) {
          await rememberMonetaryReference(topupScope, 'topup_card', intent, r.topup.id);
          const confirmed = await confirmCardPayment(r.client_secret);
          if (!confirmed.ok) {
            if (confirmed.definitive) await completeMonetaryIntent(topupScope, 'topup_card', intent);
            setError(confirmed.error);
            return;
          }
          await reconcileTopup(r.topup.id, topupScope, intent, actor.session);
          return;
        }
        if (topupOutcome(r.topup.status, r.requires_action === true, r.client_secret) === 'ambiguous') {
          // GET /topup/:id permite reconciliar id+método+monto+estado. Si no
          // alcanza un estado terminal, se conserva la misma intención.
          await rememberMonetaryReference(topupScope, 'topup_card', intent, r.topup.id);
          await reconcileTopup(r.topup.id, topupScope, intent, actor.session);
          return;
        }
        // B-06: un replay puede traer un topup FALLIDO (200 `idempotent:true`
        // con status 'failed'). Sin mirar el status, anunciábamos como
        // acreditado un cobro que nunca prosperó.
        if (topupOutcome(r.topup.status, r.requires_action === true, r.client_secret) === 'definitive') {
          await completeMonetaryIntent(topupScope, 'topup_card', intent);
          setError('Ese cobro no prosperó. Prueba de nuevo o con otra tarjeta.');
          return;
        }
        await completeMonetaryIntent(topupScope, 'topup_card', intent);
        toast(`Se acreditaron ${formatMXN(amountCents)} ✓`);
        navigate('cuenta');
      }
    } catch (err) {
      const { code, status } = extractApiError(err);
      if (intent && shouldRotateOnError(code, status)) await completeMonetaryIntent(topupScope, operation, intent);
      // En OXXO no hay saldo que revisar todavía: lo que puede haber quedado
      // vivo es una REFERENCIA. Decir "revisá tu saldo" mandaba a mirar donde
      // no hay nada.
      setError(
        via === 'oxxo'
          ? 'No pudimos confirmar la referencia. Reintenta: si ya se había generado, te devolvemos la misma (no una segunda).'
          : 'No pudimos confirmar la carga. Revisa tu saldo antes de reintentar: si el cobro salió, el reintento no cobra de nuevo.',
      );
    } finally {
      topupInFlightRef.current.leave();
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
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <Icon name="store" size={40} />
            </div>
            <div className="h2" style={{ marginTop: 8 }}>
              Paga en cualquier OXXO
            </div>
          </div>
          <div className="voucher">
            <div className="caption">Referencia OXXO</div>
            <div className="num">{voucher.voucher_reference}</div>
            <div style={{ fontSize: 'var(--fs-legacy-sm)', fontWeight: 700, marginBottom: 4 }}>{formatMXN(voucher.amount_cents)}</div>
            <div className="caption">
              Vence el {new Date(voucher.voucher_expires_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'long' })} ·
              muestra este número en caja
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
      <TopBar title="Cargar saldo" onBack={() => goBack('cuenta')} />
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
            <div className="caption" style={{ textAlign: 'center', margin: '4px 0 16px' }}>
              Monto a cargar (mín. $50, máx. $10,000)
            </div>
          </>
        )}
        <div className="seg">
          <button className={`seg-btn ${via === 'oxxo' ? 'on' : ''}`} onClick={() => setVia('oxxo')}>
            <Icon name="store" size={16} className="ico-inline" /> OXXO
          </button>
          <button className={`seg-btn ${via === 'card' ? 'on' : ''}`} onClick={() => setVia('card')}>
            <Icon name="card" size={16} className="ico-inline" /> Tarjeta
          </button>
          <button className={`seg-btn ${via === 'spei' ? 'on' : ''}`} onClick={() => setVia('spei')}>
            <Icon name="bank" size={16} className="ico-inline" /> SPEI
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
              <CardBrandChip brand={pm.brand} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 'var(--fs-legacy-base)' }}>
                  {pm.bank_name ?? pm.brand} ···· {pm.last_four}
                </div>
                <div className="caption">
                  Se acredita al instante
                </div>
              </div>
              <div className="radio" />
            </div>
          ) : (
            <div className="note note-orange">No tienes tarjetas guardadas todavía.</div>
          ))}

        {via === 'spei' && (
          <>
            {clabe ? (
              <div className="voucher spei">
                <div className="caption">
                  Tu CLABE PayMe ({clabe.banco})
                </div>
                <div className="num">{clabe.clabe}</div>
                <div className="caption">
                  Beneficiario: {clabe.beneficiario}
                </div>
                <button
                  className="btn btn-teal"
                  style={{ marginTop: 12, padding: 12, fontSize: 'var(--fs-legacy-sm)' }}
                  onClick={() => {
                    void navigator.clipboard.writeText(clabe.clabe).then(
                      () => toast('CLABE copiada ✓'),
                      () => toast('No se pudo copiar'),
                    );
                  }}
                >
                  <Icon name="copy" size={16} className="ico-inline" /> Copiar CLABE
                </button>
              </div>
            ) : (
              <div className="loading">Generando tu CLABE…</div>
            )}
            <div className="note note-teal" style={{ marginTop: 12 }}>
              {clabe?.instrucciones ??
                'Transfiere por SPEI a esta CLABE desde tu banco; el saldo se acredita solo.'}{' '}
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
