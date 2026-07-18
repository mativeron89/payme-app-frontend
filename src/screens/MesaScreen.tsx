import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, newIdempotencyKey } from '../api';
import { extractApiError } from '../api/errors';
import type { MesaDetail, PaymentMethod, PaymentType } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { TopBar, useToast } from '../components/ui';
import { navigate } from '../router';
import { countdownTo, formatMXN } from '../utils/format';

/**
 * Pantalla de mesa (T2/T3/T4): detalle + mis ítems con lock, pago con
 * propina al mozo, procesando → comprobante, y cierre con semántica A-2
 * ("tu garantía cubrió $X"). Sirve para organizador, participante e
 * INVITADO por link (#/mesa/:code?t=token, sin login).
 */

type View = 'detail' | 'pay' | 'processing' | 'confirm';

const TIP_OPTIONS = [0, 10, 15, 20];

interface PayResult {
  itemsAmount: number;
  tip: number;
  gross: number;
  methodLabel: string;
}

export function MesaScreen({ code, guestToken }: { code: string; guestToken?: string }) {
  const { session } = useAuth();
  const toast = useToast();
  const isGuest = !session && !!guestToken;
  const [mesa, setMesa] = useState<MesaDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [view, setView] = useState<View>('detail');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lockTokens, setLockTokens] = useState<string[]>([]);
  const [tipPct, setTipPct] = useState(15);
  const [staffId, setStaffId] = useState<string | null>(null);
  const [payType, setPayType] = useState<PaymentType>('card');
  const [pm, setPm] = useState<PaymentMethod | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PayResult | null>(null);
  const [procStep, setProcStep] = useState(0);
  const [, forceTick] = useState(0);

  const reload = useCallback(() => {
    api
      .getMesa(code, guestToken)
      .then((r) => setMesa(r.mesa))
      .catch(() => setNotFound(true));
  }, [code, guestToken]);

  useEffect(() => {
    reload();
    const tick = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(tick);
  }, [reload]);

  useEffect(() => {
    if (!isGuest) {
      api
        .getPaymentMethods()
        .then((r) => setPm(r.payment_methods.find((p) => p.is_default) ?? r.payment_methods[0] ?? null))
        .catch(() => setPm(null));
    }
  }, [isGuest]);

  const payable = mesa?.status === 'open' || mesa?.status === 'partially_paid';

  const itemsAmount = useMemo(() => {
    if (!mesa) return 0;
    if (mesa.division_mode === 'igual') {
      return mesa.division_slots?.find((s) => s.status === 'available')?.amount_cents ?? 0;
    }
    return mesa.items
      .filter((i) => selected.has(i.id))
      .reduce((s, i) => s + i.price_cents * i.quantity, 0);
  }, [mesa, selected]);

  const tipCents = Math.round((itemsAmount * tipPct) / 100);
  const gross = itemsAmount + tipCents;

  function toggleItem(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  async function goToPay() {
    if (!mesa) return;
    setError(null);
    if (mesa.division_mode === 'consumo') {
      if (selected.size === 0) return;
      setBusy(true);
      try {
        // Contrato: lock primero (POST /:code/items/lock), después pagar.
        const r = await api.lockItems(code, [...selected], guestToken);
        setLockTokens([r.lock_token]);
        setView('pay');
      } catch (err) {
        const { code: ec, extra } = extractApiError(err);
        if (ec === 'item_already_locked' || ec === 'item_already_paid') {
          toast('Alguien ya tomó uno de esos ítems');
          const itemId = typeof extra.item_id === 'string' ? extra.item_id : null;
          if (itemId) {
            const next = new Set(selected);
            next.delete(itemId);
            setSelected(next);
          }
          reload();
        } else {
          toast('No pudimos reservar tus ítems');
        }
      } finally {
        setBusy(false);
      }
    } else {
      setView('pay');
    }
  }

  async function doPay() {
    if (!mesa) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.payMesa(
        code,
        {
          payment_type: payType,
          item_ids: mesa.division_mode === 'consumo' ? [...selected] : [],
          ...(lockTokens.length > 0 && { lock_tokens: lockTokens }),
          tip_cents: tipCents,
          ...(staffId && { tip_to_staff_id: staffId }),
          ...(payType === 'card' && pm && { payment_method_id: pm.id }),
          ...(payType !== 'card' && payType !== 'wallet' && { stripe_payment_method_id: 'pm_mock_walletpay' }),
          idempotency_key: newIdempotencyKey(),
        },
        guestToken,
      );
      const methodLabel =
        payType === 'wallet'
          ? '👛 Saldo PayMe'
          : payType === 'apple_pay'
            ? '🍎 Apple Pay'
            : `💳 ${pm ? `${pm.brand === 'visa' ? 'Visa' : pm.brand} ··${pm.last_four}` : 'Tarjeta'}`;
      setResult({
        itemsAmount,
        tip: tipCents,
        gross: r.attempt.gross_amount_cents,
        methodLabel,
      });
      setView('processing');
      setProcStep(1);
    } catch (err) {
      const { code: ec, extra } = extractApiError(err);
      if (ec === 'insufficient_funds') {
        const available = typeof extra.available === 'number' ? extra.available : 0;
        setError(
          `Saldo insuficiente: tenés ${formatMXN(available)} disponibles y necesitás ${formatMXN(gross)}. Cargá saldo o pagá con tarjeta.`,
        );
      } else if (ec === 'wallet_requires_auth') {
        setError('Para pagar con saldo PayMe tenés que iniciar sesión.');
      } else if (ec === 'mesa_not_payable') {
        setError('La mesa ya cerró.');
        reload();
      } else if (ec === 'no_slots_available') {
        setError('Ya no quedan partes por pagar en esta mesa.');
        reload();
      } else {
        setError('No pudimos procesar el pago. Probá de nuevo.');
      }
      setBusy(false);
    }
  }

  // Animación de estados reales: pending → succeeded → processed.
  useEffect(() => {
    if (view !== 'processing') return;
    if (procStep >= 3) {
      const t = setTimeout(() => {
        setBusy(false);
        setView('confirm');
        reload();
      }, 700);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setProcStep((s) => s + 1), 1000);
    return () => clearTimeout(t);
  }, [view, procStep, reload]);

  // ─── Estados de carga / error ────────────────────────────
  if (notFound) {
    return (
      <div className="screen">
        <TopBar title="Mesa" onBack={() => navigate('home')} />
        <div className="empty">
          <div className="emoji">🔍</div>
          No encontramos esa mesa (o el link venció).
        </div>
      </div>
    );
  }
  if (!mesa) {
    return (
      <div className="screen">
        <TopBar title="Mesa" onBack={() => navigate('home')} />
        <div className="loading">Cargando mesa…</div>
      </div>
    );
  }

  const backHome = () => (isGuest ? undefined : navigate('home'));
  const guestHeader = isGuest && (
    <div style={{ background: 'var(--teal-l)', padding: '14px 16px', borderBottom: '1px solid var(--teal)' }}>
      <div style={{ fontSize: 12, color: 'var(--navy)', opacity: 0.7, fontFamily: 'var(--font-body)' }}>
        Te invitaron a
      </div>
      <div style={{ fontSize: 15, fontWeight: 700 }}>
        {mesa.code} · {mesa.restaurant.name}
      </div>
    </div>
  );

  // ─── Mesa cerrada (A-2) ──────────────────────────────────
  if (!payable && view === 'detail') {
    const shortfall = Math.max(0, mesa.total_cents - mesa.paid_amount_cents);
    const isOpener = mesa.my_role === 'opener';
    return (
      <div className="screen">
        <TopBar title={mesa.status === 'fully_paid' ? 'Mesa completa' : 'Mesa cerrada'} onBack={() => navigate(isGuest ? 'home' : 'mesas')} />
        {guestHeader}
        <div className="scroll" style={{ padding: '20px 16px' }}>
          <div style={{ textAlign: 'center', padding: '8px 0 18px' }}>
            <div style={{ fontSize: 44 }}>{shortfall > 0 ? '⌛' : '✅'}</div>
            <div className="h2" style={{ marginTop: 8 }}>
              {shortfall > 0 ? 'Se cerró por tiempo' : 'Quedó todo pago'}
            </div>
            <div className="body-text" style={{ marginTop: 6 }}>
              {mesa.restaurant.name} · Mesa {mesa.code}
            </div>
          </div>
          <div className="card card-p" style={{ marginBottom: 14 }}>
            <div className="receipt-row">
              <span className="lbl">Total mesa</span>
              <span className="val">{formatMXN(mesa.total_cents)}</span>
            </div>
            <div className="receipt-row">
              <span className="lbl">Pagado por los comensales</span>
              <span className="val" style={{ color: 'var(--green)' }}>
                {formatMXN(mesa.paid_amount_cents)}
              </span>
            </div>
            {shortfall > 0 && (
              <div className="receipt-row">
                <span className="lbl">{isOpener ? 'Cubrió tu garantía' : 'Cubrió la garantía'}</span>
                <span className="val" style={{ color: 'var(--orange)' }}>
                  {formatMXN(shortfall)}
                </span>
              </div>
            )}
            <div className="receipt-row">
              <span className="lbl" style={{ fontWeight: 700, color: 'var(--navy)' }}>
                Recibió el restaurante
              </span>
              <span className="val hl">{formatMXN(mesa.total_cents)}</span>
            </div>
          </div>
          {shortfall > 0 && isOpener && (
            <div className="note note-teal">
              <b>Tu garantía cubrió {formatMXN(shortfall)}.</b> El restaurante cobró el
              total; nadie quedó debiendo en la mesa. Podés pedirle esa parte a quien no
              llegó a pagar (Transferir → pedir plata la agregamos pronto).
            </div>
          )}
        </div>
        {!isGuest && (
          <div className="action-bar">
            <button className="btn btn-navy" onClick={() => navigate('home')}>
              🏠 Inicio
            </button>
          </div>
        )}
      </div>
    );
  }

  // ─── Procesando (estados reales del attempt) ─────────────
  if (view === 'processing' && result) {
    const steps = [
      { label: 'pending', desc: 'se crea el intento de pago' },
      { label: 'succeeded', desc: 'el cobro se confirmó' },
      { label: 'processed', desc: 'acreditado en la mesa' },
    ];
    return (
      <div className="screen">
        <div className="scroll" style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ textAlign: 'center', padding: '16px 0' }}>
            {procStep < 3 ? <div className="spinner" /> : <div className="success-circle">✓</div>}
            <div className="h2" style={{ marginTop: 18 }}>
              {procStep < 2 ? 'Cobrando…' : procStep < 3 ? 'Acreditando…' : 'Pago acreditado'}
            </div>
            <div className="body-text" style={{ marginTop: 6 }}>
              {formatMXN(result.gross)} · {result.methodLabel}
            </div>
          </div>
          <div className="card card-p" style={{ marginTop: 8 }}>
            {steps.map((s, idx) => (
              <div key={s.label} className="flow-step">
                <div className={`flow-dot ${procStep > idx + 1 ? 'done' : procStep === idx + 1 ? 'now' : ''}`}>
                  {procStep > idx + 1 ? '✓' : idx + 1}
                </div>
                <div className="flow-line">
                  <b>{s.label}</b> → {s.desc}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ─── Comprobante ─────────────────────────────────────────
  if (view === 'confirm' && result) {
    return (
      <div className="screen">
        <div className="scroll" style={{ padding: '24px 20px' }}>
          <div style={{ textAlign: 'center', padding: '16px 0 22px' }}>
            <div className="success-circle">✓</div>
            <div className="h1" style={{ marginTop: 14, marginBottom: 6 }}>
              ¡Listo!
            </div>
            <div className="body-text">
              Pagaste tu parte.{' '}
              {mesa.paid_amount_cents < mesa.total_cents
                ? 'La mesa sigue abierta para los demás.'
                : 'La mesa quedó completa. 🎉'}
            </div>
          </div>
          <div className="card card-p">
            <div className="h2" style={{ fontSize: 15, marginBottom: 12 }}>
              Comprobante
            </div>
            <div className="receipt-row">
              <span className="lbl">Restaurante</span>
              <span className="val">{mesa.restaurant.name}</span>
            </div>
            <div className="receipt-row">
              <span className="lbl">Mesa</span>
              <span className="val">{mesa.code}</span>
            </div>
            <div className="receipt-row">
              <span className="lbl">Método</span>
              <span className="val">{result.methodLabel}</span>
            </div>
            <div className="receipt-row">
              <span className="lbl">{mesa.division_mode === 'igual' ? 'Mi parte' : 'Mis ítems'}</span>
              <span className="val">{formatMXN(result.itemsAmount)}</span>
            </div>
            <div className="receipt-row">
              <span className="lbl">Propina (al mozo)</span>
              <span className="val">{formatMXN(result.tip)}</span>
            </div>
            <div className="receipt-row">
              <span className="lbl" style={{ fontWeight: 700, color: 'var(--navy)' }}>
                Total pagado
              </span>
              <span className="val hl">{formatMXN(result.gross)}</span>
            </div>
          </div>
          {isGuest && (
            <div className="note note-teal" style={{ marginTop: 14 }}>
              ¿Te gustó? Creá tu cuenta PayMe y la próxima dividís vos.
            </div>
          )}
        </div>
        <div className="action-bar">
          {isGuest ? (
            <button className="btn btn-navy" onClick={() => { setView('detail'); setSelected(new Set()); reload(); }}>
              Ver la mesa
            </button>
          ) : (
            <button className="btn btn-navy" onClick={() => navigate('home')}>
              🏠 Inicio
            </button>
          )}
        </div>
      </div>
    );
  }

  // ─── Pago (s-payment) ────────────────────────────────────
  if (view === 'pay') {
    return (
      <div className="screen">
        <TopBar title="Pagar mi parte" onBack={() => setView('detail')} right={<span style={{ fontSize: 18 }}>🔒</span>} />
        {guestHeader}
        <div className="scroll" style={{ padding: 16 }}>
          <div style={{ background: 'var(--navy)', borderRadius: 16, padding: '18px 20px', marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Pagás SOLO tu parte
            </div>
            <div style={{ fontSize: 32, fontWeight: 800, color: '#fff' }}>{formatMXN(gross)}</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 4, fontFamily: 'var(--font-body)' }}>
              {mesa.division_mode === 'igual' ? 'Tu parte' : 'Tus ítems'} {formatMXN(itemsAmount)} + propina {formatMXN(tipCents)}
            </div>
          </div>
          {error && <div className="form-error">{error}</div>}
          <div className="sectlabel">Propina al mozo</div>
          <div className="tip-row">
            {TIP_OPTIONS.map((pct) => (
              <button key={pct} className={`tip-pill ${tipPct === pct ? 'sel' : ''}`} onClick={() => setTipPct(pct)}>
                {pct}%
              </button>
            ))}
          </div>
          {tipPct > 0 && mesa.active_staff.length > 0 && (
            <>
              <div className="sectlabel">¿Para quién?</div>
              <div className="tip-row" style={{ flexWrap: 'wrap' }}>
                {mesa.active_staff.map((s) => (
                  <button
                    key={s.id}
                    className={`tip-pill ${staffId === s.id ? 'sel' : ''}`}
                    style={{ flex: 'none' }}
                    onClick={() => setStaffId(staffId === s.id ? null : s.id)}
                  >
                    {s.display_name}
                  </button>
                ))}
              </div>
            </>
          )}
          <div className="sectlabel">Método</div>
          {!isGuest && (
            <button className={`method-card ${payType === 'wallet' ? 'sel' : ''}`} onClick={() => setPayType('wallet')}>
              <div className="method-icon" style={{ background: 'var(--teal-l)' }}>
                👛
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>Saldo PayMe</div>
              </div>
              <div className="radio" />
            </button>
          )}
          {pm ? (
            <button className={`method-card ${payType === 'card' ? 'sel' : ''}`} onClick={() => setPayType('card')}>
              <div className="cc visa">VISA</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>
                  {pm.bank_name ?? pm.brand} ···· {pm.last_four}
                </div>
              </div>
              <div className="radio" />
            </button>
          ) : (
            <button className={`method-card ${payType === 'card' ? 'sel' : ''}`} onClick={() => setPayType('card')}>
              <div className="method-icon" style={{ background: 'var(--gray-l)' }}>
                💳
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>Tarjeta de crédito o débito</div>
                <div style={{ fontSize: 12, color: 'var(--gray-d)', fontFamily: 'var(--font-body)' }}>
                  La ingresás al confirmar (segura, vía Stripe)
                </div>
              </div>
              <div className="radio" />
            </button>
          )}
          <button className={`method-card ${payType === 'apple_pay' ? 'sel' : ''}`} onClick={() => setPayType('apple_pay')}>
            <div className="method-icon" style={{ background: '#000', color: '#fff' }}>
              🍎
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Apple Pay</div>
              <div style={{ fontSize: 12, color: 'var(--gray-d)', fontFamily: 'var(--font-body)' }}>vía Stripe</div>
            </div>
            <div className="radio" />
          </button>
          {isGuest && (
            <div className="note note-orange" style={{ marginTop: 6 }}>
              Sin iniciar sesión pagás con tarjeta o Apple Pay (el saldo PayMe pide cuenta).
            </div>
          )}
        </div>
        <div className="action-bar">
          <button className="btn btn-primary" onClick={doPay} disabled={busy || gross === 0}>
            {busy ? 'Procesando…' : `Pagar ${formatMXN(gross)}`}
          </button>
        </div>
      </div>
    );
  }

  // ─── Detalle + selección (s-ticket / s-myitems / s-guest) ─
  const cd = countdownTo(mesa.expires_at);
  const pct = mesa.total_cents > 0 ? Math.round((mesa.paid_amount_cents / mesa.total_cents) * 100) : 0;
  const availableSlots = mesa.division_slots?.filter((s) => s.status === 'available').length ?? 0;

  return (
    <div className="screen">
      <div className="top-bar" style={{ background: 'var(--navy)' }}>
        {!isGuest && (
          <button className="back-btn" onClick={backHome} aria-label="Volver" style={{ background: 'rgba(255,255,255,0.15)', color: '#fff' }}>
            ←
          </button>
        )}
        <div className="top-title" style={{ color: '#fff' }}>
          {mesa.restaurant.name}
        </div>
        {isGuest && <span className="badge badge-teal">Invitado</span>}
      </div>
      <div style={{ background: 'var(--navy)', padding: '0 20px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', fontFamily: 'var(--font-body)' }}>
            📍 Mesa {mesa.code} · {mesa.division_mode === 'igual' ? 'partes iguales' : 'cada uno lo suyo'}
          </div>
          <div style={{ background: 'var(--teal)', color: 'var(--navy)', padding: '4px 12px', borderRadius: 20, fontWeight: 800, fontSize: 13 }}>
            {formatMXN(mesa.total_cents)}
          </div>
        </div>
        <div style={{ marginTop: 10 }}>
          <div className="progress-bar" style={{ background: 'rgba(255,255,255,0.15)' }}>
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 11, color: 'rgba(255,255,255,0.55)', fontFamily: 'var(--font-body)' }}>
            <span>
              {formatMXN(mesa.paid_amount_cents)} pagado ({pct}%)
            </span>
            <span style={{ color: 'var(--orange)', fontWeight: 700 }}>{cd ? `⏳ ${cd}` : '⌛'}</span>
          </div>
        </div>
      </div>
      {guestHeader}
      {mesa.division_mode === 'consumo' ? (
        <>
          <div className="totalbar">
            <div>
              <div className="lbl">Mi parte</div>
              <div className="amt">{formatMXN(itemsAmount)}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>de {formatMXN(mesa.total_cents)}</div>
              <div style={{ fontSize: 12, color: 'var(--teal)', fontWeight: 700 }}>
                {mesa.total_cents > 0 ? Math.round((itemsAmount / mesa.total_cents) * 100) : 0}%
              </div>
            </div>
          </div>
          <div className="scroll" style={{ background: '#fff' }}>
            <div style={{ padding: '12px 16px 4px', fontSize: 12, color: 'var(--gray-d)', fontFamily: 'var(--font-body)' }}>
              Tocá tus consumos. Al elegirlos quedan <b>reservados</b> para vos.
            </div>
            {mesa.items.map((i) => {
              const paidByOther = i.status === 'paid';
              const lockedByOther = i.status === 'locked' && !i.locked_by_me;
              const sel = selected.has(i.id) || (i.status === 'locked' && i.locked_by_me);
              const blocked = paidByOther || lockedByOther;
              return (
                <button
                  key={i.id}
                  className={`item-row ${sel ? 'sel' : ''} ${paidByOther ? 'paid-other' : ''} ${lockedByOther ? 'locked-other' : ''}`}
                  onClick={() => !blocked && toggleItem(i.id)}
                  disabled={blocked}
                >
                  <div className={`checkbox ${sel ? 'on' : ''} ${blocked ? 'blocked' : ''}`}>
                    {blocked ? (paidByOther ? '✓' : '🔒') : '✓'}
                  </div>
                  <div className="item-name">
                    {i.name}
                    {i.quantity > 1 ? ` × ${i.quantity}` : ''}
                    {paidByOther && <span className="item-hint"> · ya pagado</span>}
                    {lockedByOther && <span className="item-hint"> · lo tomó otro</span>}
                  </div>
                  <div className="item-price">{formatMXN(i.price_cents * i.quantity)}</div>
                </button>
              );
            })}
          </div>
          <div className="action-bar">
            <div style={{ display: 'flex', gap: 8 }}>
              {!isGuest && mesa.my_role === 'opener' && (
                <button
                  className="btn btn-ghost"
                  style={{ flex: 'none', width: 'auto', padding: '16px 14px' }}
                  onClick={async () => {
                    try {
                      const inv = await api.createInvitation(code);
                      if (inv.link) {
                        await navigator.clipboard.writeText(inv.link);
                        toast('Link de invitación copiado 📋');
                      }
                    } catch {
                      toast('No se pudo generar el link');
                    }
                  }}
                >
                  🔗
                </button>
              )}
              <button className="btn btn-primary" onClick={goToPay} disabled={busy || selected.size === 0}>
                {busy ? 'Reservando…' : selected.size === 0 ? 'Elegí tus ítems' : `Pagar mi parte → ${formatMXN(itemsAmount)}`}
              </button>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="scroll" style={{ padding: 16 }}>
            <div className="sectlabel">Partes de la mesa</div>
            <div className="card" style={{ marginBottom: 12 }}>
              {mesa.division_slots?.map((s) => (
                <div key={s.slot_index} className="item-row" style={{ cursor: 'default' }}>
                  <div className={`checkbox ${s.status !== 'available' ? 'blocked' : ''}`}>{s.status !== 'available' ? '✓' : ''}</div>
                  <div className="item-name">
                    Parte {s.slot_index + 1}
                    {s.status !== 'available' && <span className="item-hint"> · pagada</span>}
                  </div>
                  <div className="item-price">{s.amount_display}</div>
                </div>
              ))}
            </div>
            <div className="note note-teal">
              La cuenta se dividió en {mesa.expected_participants} partes iguales. Cada pago
              toma la próxima parte libre — quedan <b>{availableSlots}</b>.
            </div>
          </div>
          <div className="action-bar">
            <div style={{ display: 'flex', gap: 8 }}>
              {!isGuest && mesa.my_role === 'opener' && (
                <button
                  className="btn btn-ghost"
                  style={{ flex: 'none', width: 'auto', padding: '16px 14px' }}
                  onClick={async () => {
                    try {
                      const inv = await api.createInvitation(code);
                      if (inv.link) {
                        await navigator.clipboard.writeText(inv.link);
                        toast('Link de invitación copiado 📋');
                      }
                    } catch {
                      toast('No se pudo generar el link');
                    }
                  }}
                >
                  🔗
                </button>
              )}
              <button className="btn btn-primary" onClick={goToPay} disabled={busy || availableSlots === 0}>
                {availableSlots === 0 ? 'No quedan partes' : `Pagar mi parte → ${formatMXN(itemsAmount)}`}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
