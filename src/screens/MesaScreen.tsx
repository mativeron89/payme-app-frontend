import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, IS_MOCK, IS_DEMO, DEMO_PM_ID, newIdempotencyKey } from '../api';
import type { StripeCardElement } from '@stripe/stripe-js';
import { extractApiError } from '../api/errors';
import { confirmCardPayment, createCardPaymentMethod } from '../api/stripe';
import { CardField, type CardFieldState } from '../components/CardField';
import { Icon } from '../components/Icon';
import type { FractionRequest, MesaDetail, PaymentMethod, PaymentType } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { CardBrandChip, TopBar, TopLogo, useToast } from '../components/ui';
import { goBack, navigate } from '../router';
import { countdownTo, formatMXN } from '../utils/format';
import { fractionAmount, stringToCents, tipFromBps } from '../utils/money';

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
  // Si llega guestToken, App ya decidió que esta vista es la del invitado
  // (sin sesión siempre; con sesión solo en la demo, para poder mostrarla).
  const isGuest = !!guestToken;
  const previewingAsGuest = isGuest && !!session;
  const [mesa, setMesa] = useState<MesaDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [view, setView] = useState<View>('detail');
  // v2.18 (fracciones): selección = ítem → fracción elegida en bps.
  const [selected, setSelected] = useState<Map<string, number>>(new Map());
  const [lockTokens, setLockTokens] = useState<string[]>([]);
  const [tipPct, setTipPct] = useState(15);
  // D7: 'pct' manda tip_bps (computa el server); 'custom' manda tip_cents.
  const [tipMode, setTipMode] = useState<'pct' | 'custom'>('pct');
  const [customTipStr, setCustomTipStr] = useState('');
  const [staffId, setStaffId] = useState<string | null>(null);
  const [payType, setPayType] = useState<PaymentType>('card');
  // Feedback Mati: las tarjetas van en un desglosable, no sueltas en la lista.
  const [cardsOpen, setCardsOpen] = useState(false);
  // D4: tarjetas guardadas. `cardChoice` = pm_… elegido o 'new' (otra
  // tarjeta); `saveCard` = checkbox "guardar" (ratificado: prendido). El
  // invitado sin cuenta no tiene guardadas: siempre tarjeta nueva sin checkbox.
  const [cards, setCards] = useState<PaymentMethod[]>([]);
  const [cardChoice, setCardChoice] = useState<string>('new');
  const [saveCard, setSaveCard] = useState(true);
  const [cardEl, setCardEl] = useState<StripeCardElement | null>(null);
  const [cardState, setCardState] = useState<CardFieldState>({
    complete: false,
    error: null,
    empty: true,
  });
  // Espejo en ref: la carga async de tarjetas no debe pisar la selección si
  // el usuario ya está tipeando una nueva (ver useEffect de abajo).
  const cardStateRef = useRef(cardState);
  const handleCardChange = useCallback((s: CardFieldState) => {
    cardStateRef.current = s;
    setCardState(s);
  }, []);
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
        .then((r) => {
          // D4 (v2.16): las guardadas se reusan con su uuid (payment_method_id).
          setCards(r.payment_methods);
          const def = r.payment_methods.find((p) => p.is_default) ?? r.payment_methods[0];
          // No pisar la selección si el usuario ya está tipeando una nueva.
          if (def && cardStateRef.current.empty) setCardChoice(def.id);
        })
        .catch(() => setCards([]));
    }
  }, [isGuest]);

  const payable = mesa?.status === 'open' || mesa?.status === 'partially_paid';

  /** Valores del contrato (schemas.lockItems del espejo). */
  const FRACTIONS: Array<{ bps: number; label: string }> = [
    { bps: 10000, label: '1' },
    { bps: 5000, label: '½' },
    { bps: 3333, label: '⅓' },
    { bps: 2500, label: '¼' },
  ];

  function bpsLabel(bps: number): string {
    if (bps >= 10000) return 'entero';
    if (bps === 5000) return '½';
    if (bps === 3333 || bps === 3334) return '⅓';
    if (bps === 2500) return '¼';
    return `${Math.round(bps / 100)}%`;
  }

  /** Preview del monto de MI fracción (la completadora la ajusta el server). */
  function fractionPreview(priceCents: number, bps: number, remainingBps: number): number {
    if (bps >= remainingBps) {
      // Completa el ítem → paga lo que falta (aprox: nominal de lo tomado).
      return Math.max(0, priceCents - fractionAmount(priceCents, 10000 - remainingBps));
    }
    return fractionAmount(priceCents, bps);
  }

  const itemsAmount = useMemo(() => {
    if (!mesa) return 0;
    if (mesa.division_mode === 'igual') {
      return mesa.division_slots?.find((s) => s.status === 'available')?.amount_cents ?? 0;
    }
    return mesa.items
      .filter((i) => selected.has(i.id))
      .reduce(
        (s, i) => s + fractionPreview(i.price_cents * i.quantity, selected.get(i.id) ?? 10000, i.remaining_bps),
        0,
      );
  }, [mesa, selected]);

  // D7 (v2.17): la propina es % de tu parte IGUALITARIA (total ÷ N), no de tu
  // consumo. Preview con la réplica exacta de tipFromBps; el cobro real lo
  // computa el server y el comprobante usa SU tip_cents.
  const tipCents = (() => {
    if (!mesa) return 0;
    if (tipMode === 'custom') {
      try {
        return stringToCents(customTipStr || '0');
      } catch {
        return 0;
      }
    }
    return tipFromBps(mesa.total_cents, mesa.expected_participants || 1, tipPct * 100);
  })();
  const gross = itemsAmount + tipCents;

  function toggleItem(id: string) {
    const next = new Map(selected);
    if (next.has(id)) {
      next.delete(id);
    } else {
      const item = mesa?.items.find((i) => i.id === id);
      const remaining = item?.remaining_bps ?? 10000;
      const def = FRACTIONS.find((f) => f.bps <= remaining)?.bps ?? 10000;
      next.set(id, def);
    }
    setSelected(next);
  }

  function setFraction(id: string, bps: number) {
    const next = new Map(selected);
    next.set(id, bps);
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
        const requests: FractionRequest[] = [...selected.entries()].map(([item_id, fraction_bps]) => ({
          item_id,
          fraction_bps,
        }));
        const r = await api.lockItems(code, requests, guestToken);
        setLockTokens([r.lock_token]);
        setView('pay');
      } catch (err) {
        const { code: ec, extra } = extractApiError(err);
        if (ec === 'fraction_not_available') {
          const rem = typeof extra.remaining_bps === 'number' ? extra.remaining_bps : 0;
          toast(rem > 0 ? `De ese plato queda solo ${bpsLabel(rem)}` : 'Ese plato ya está completo');
          const itemId = typeof extra.item_id === 'string' ? extra.item_id : null;
          if (itemId) {
            const next = new Map(selected);
            next.delete(itemId);
            setSelected(next);
          }
          reload();
        } else if (ec === 'item_already_locked' || ec === 'item_already_paid') {
          toast('Alguien ya tomó uno de esos consumos');
          const itemId = typeof extra.item_id === 'string' ? extra.item_id : null;
          if (itemId) {
            const next = new Map(selected);
            next.delete(itemId);
            setSelected(next);
          }
          reload();
        } else {
          toast('No pudimos reservar lo que elegiste');
        }
      } finally {
        setBusy(false);
      }
    } else {
      // Partes iguales: el monto es la parte, pero marcar lo consumido es
      // obligatorio (info para el restaurante).
      if (selected.size === 0) return;
      setView('pay');
    }
  }

  /** Comprobante en texto plano para enviar/descargar (contabilidad). */
  function receiptText(): string {
    if (!mesa || !result) return '';
    return [
      'Comprobante PayMe',
      `Restaurante: ${mesa.restaurant.name}`,
      `Mesa: ${code}`,
      `Fecha: ${new Date().toLocaleString('es-MX')}`,
      `Método: ${result.methodLabel}`,
      `${mesa.division_mode === 'igual' ? 'Mi parte' : 'Mis consumos'}: ${formatMXN(result.itemsAmount)}`,
      `Propina (al mozo): ${formatMXN(result.tip)}`,
      `Total pagado: ${formatMXN(result.gross)}`,
    ].join('\n');
  }

  async function shareReceipt() {
    const text = receiptText();
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Comprobante PayMe', text });
        return;
      }
      await navigator.clipboard.writeText(text);
      toast('Comprobante copiado ✓');
    } catch {
      // el usuario canceló el share del sistema: no es un error
    }
  }

  function downloadReceipt() {
    const blob = new Blob([receiptText()], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `comprobante-payme-${code}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function doPay() {
    if (!mesa) return;
    setBusy(true);
    setError(null);
    try {
      // D4 (v2.16): tarjeta GUARDADA → `payment_method_id` (uuid); tarjeta
      // NUEVA → pm_ desde el Card Element como `stripe_payment_method_id`,
      // con `save_payment_method` según el checkbox.
      const savedCard = payType === 'card' ? (cards.find((c) => c.id === cardChoice) ?? null) : null;
      let stripePmId: string | null = null;
      let savedPmId: string | null = null;
      let savingNewCard = false;
      if (payType === 'card') {
        if (!IS_MOCK && IS_DEMO) {
          // Modo demo (?demo=1): PaymentMethod de test de Stripe, sin iframe.
          stripePmId = DEMO_PM_ID;
        } else if (savedCard) {
          savedPmId = savedCard.id;
        } else if (IS_MOCK) {
          stripePmId = `pm_mock_nueva_${Date.now().toString(36)}`;
          savingNewCard = !isGuest && saveCard;
        } else {
          if (!cardEl) {
            setError('Ingresá los datos de la tarjeta para continuar.');
            setBusy(false);
            return;
          }
          const res = await createCardPaymentMethod(cardEl);
          if ('error' in res) {
            setError(res.error);
            setBusy(false);
            return;
          }
          stripePmId = res.paymentMethodId;
          savingNewCard = !isGuest && saveCard;
        }
      }

      const r = await api.payMesa(
        code,
        {
          payment_type: payType,
          // IMPORTANTÍSIMO (Mati): también en partes iguales viaja QUÉ consumió
          // cada uno (v2.18.1 ya lo persiste — G-07 resuelto). En consumo van
          // las FRACCIONES (v2.18).
          ...(mesa.division_mode === 'consumo'
            ? {
                items: [...selected.entries()].map(([item_id, fraction_bps]) => ({
                  item_id,
                  fraction_bps,
                })),
              }
            : { item_ids: [...selected.keys()] }),
          ...(lockTokens.length > 0 && { lock_tokens: lockTokens }),
          ...(tipMode === 'custom' ? { tip_cents: tipCents } : { tip_bps: tipPct * 100 }),
          ...(staffId && { tip_to_staff_id: staffId }),
          ...(stripePmId && { stripe_payment_method_id: stripePmId }),
          ...(savedPmId && { payment_method_id: savedPmId }),
          ...(savingNewCard && { save_payment_method: true }),
          ...(payType !== 'card' && payType !== 'wallet' && { stripe_payment_method_id: 'pm_mock_walletpay' }),
          idempotency_key: newIdempotencyKey(),
        },
        guestToken,
      );
      // El pago con tarjeta puede volver en `requires_action`: ahí el banco
      // pide 3DS y hay que confirmarlo con Stripe.js antes de dar por hecho el
      // cobro. Sin esto el usuario vería "pagado" con el cobro sin confirmar.
      if (r.attempt.requires_action && r.attempt.client_secret) {
        const confirmed = await confirmCardPayment(r.attempt.client_secret);
        if (!confirmed.ok) {
          setError(confirmed.error);
          setBusy(false);
          reload();
          return;
        }
      }
      const methodLabel =
        payType === 'wallet'
          ? 'Saldo PayMe'
          : payType === 'apple_pay'
            ? 'Apple Pay'
            : payType === 'google_pay'
              ? 'Ⓖ Google Pay'
              : `${savedCard ? `${savedCard.brand === 'visa' ? 'Visa' : savedCard.brand} ··${savedCard.last_four}` : 'Tarjeta'}`;
      setResult({
        // Exacto del server: la fracción completadora puede ajustar ±1¢.
        itemsAmount: r.attempt.gross_amount_cents - (r.attempt.tip_cents ?? tipCents),
        tip: r.attempt.tip_cents ?? tipCents,
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
  // OJO: el invitado NO puede salir a 'home' — navigate() reescribe el hash sin
  // el token ?t= y perdería el acceso a la mesa (quedaría en el login).
  if (notFound) {
    return (
      <div className="screen">
        <TopBar title="Mesa" onBack={isGuest ? undefined : () => goBack('mesas')} />
        <div className="empty">
          <div className="emoji"><Icon name="search" size={40} /></div>
          No encontramos esta mesa. Puede que el link haya vencido o que ya se haya cerrado la
          cuenta.
          {isGuest && (
            <div style={{ marginTop: 16 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => window.location.reload()}>
                Reintentar
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }
  if (!mesa) {
    return (
      <div className="screen">
        <TopBar title="Mesa" onBack={isGuest ? undefined : () => goBack('mesas')} />
        <div className="loading" role="status" aria-live="polite">
          Cargando mesa…
        </div>
      </div>
    );
  }
  const guestHeader = isGuest && (
    <div style={{ background: 'var(--teal-l)', padding: '14px 16px', borderBottom: '1px solid var(--teal)' }}>
      <div className="caption" style={{ color: 'var(--navy)' }}>
        {previewingAsGuest ? 'Así lo ve quien recibe tu link' : 'Te invitaron a'}
      </div>
      <div style={{ fontSize: 'var(--fs-md)', fontWeight: 700 }}>
        {code} · {mesa.restaurant.name}
      </div>
      {previewingAsGuest && (
        <button
          className="login-toggle"
          style={{ padding: '6px 0 0' }}
          onClick={() => navigate('home')}
        >
          ← Salir de la vista de invitado
        </button>
      )}
    </div>
  );

  // ─── Mesa cerrada (A-2) ──────────────────────────────────
  if (!payable && view === 'detail') {
    const shortfall = Math.max(0, mesa.total_cents - mesa.paid_amount_cents);
    const isOpener = mesa.my_role === 'opener';
    return (
      <div className="screen">
        <TopBar
          title={mesa.status === 'fully_paid' ? 'Mesa completa' : 'Mesa cerrada'}
          onBack={isGuest ? undefined : () => navigate('mesas')}
        />
        {guestHeader}
        <div className="scroll" style={{ padding: '20px 16px' }}>
          <div style={{ textAlign: 'center', padding: '8px 0 18px' }}>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <Icon name={shortfall > 0 ? 'clock' : 'check-circle'} size={40} />
            </div>
            <div className="h2" style={{ marginTop: 8 }}>
              {shortfall > 0 ? 'Se cerró por tiempo' : 'Quedó todo pago'}
            </div>
            <div className="body-text" style={{ marginTop: 6 }}>
              {mesa.restaurant.name} · Mesa {code}
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
                <span className="val" style={{ color: 'var(--orange-txt)' }}>
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
              <b>Tu garantía cubrió {formatMXN(shortfall)}.</b> El restaurante cobró el total y
              nadie quedó debiendo en la mesa. Pronto vas a poder pedirle ese monto a quien no
              llegó a pagar.
            </div>
          )}
        </div>
        {/* La barra se muestra SIEMPRE: sin esto el invitado quedaba en una
            pantalla de solo lectura sin ninguna salida. */}
        <div className="action-bar">
          {isGuest ? (
            <button className="btn btn-navy" onClick={() => reload()}>
              Actualizar
            </button>
          ) : (
            <button className="btn btn-navy" onClick={() => navigate('home')}>
              <Icon name="home" size={16} className="ico-inline" /> Inicio
            </button>
          )}
        </div>
      </div>
    );
  }

  // ─── Procesando (estados reales del attempt) ─────────────
  if (view === 'processing' && result) {
    const steps = ['Confirmando el cobro', 'Acreditando en la mesa', 'Listo'];
    return (
      <div className="screen">
        <div className="scroll" style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ textAlign: 'center', padding: '16px 0' }} role="status" aria-live="polite">
            {procStep < 3 ? (
              <div className="spinner" aria-hidden="true" />
            ) : (
              <div className="success-circle" aria-hidden="true">
                ✓
              </div>
            )}
            <div className="h2" style={{ marginTop: 18 }}>
              {procStep < 2 ? 'Cobrando…' : procStep < 3 ? 'Acreditando…' : 'Pago acreditado'}
            </div>
            <div className="body-text" style={{ marginTop: 6 }}>
              {formatMXN(result.gross)} · {result.methodLabel}
            </div>
          </div>
          <div className="card card-p" style={{ marginTop: 8 }}>
            {steps.map((desc, idx) => (
              <div key={desc} className="flow-step">
                <div
                  className={`flow-dot ${procStep > idx + 1 ? 'done' : procStep === idx + 1 ? 'now' : ''}`}
                  aria-hidden="true"
                >
                  {procStep > idx + 1 ? '✓' : idx + 1}
                </div>
                <div className="flow-line">
                  <b>{desc}</b>
                  {procStep > idx + 1 ? ' ✓' : procStep === idx + 1 ? '…' : ''}
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
              {mesa.paid_amount_cents < mesa.total_cents ? (
                'La mesa sigue abierta para los demás.'
              ) : (
                <>
                  La mesa quedó completa. <Icon name="party" size={16} className="ico-inline" />
                </>
              )}
            </div>
          </div>
          <div className="card card-p">
            <div className="h2" style={{ fontSize: 'var(--fs-md)', marginBottom: 12 }}>
              Comprobante
            </div>
            <div className="receipt-row">
              <span className="lbl">Restaurante</span>
              <span className="val">{mesa.restaurant.name}</span>
            </div>
            <div className="receipt-row">
              <span className="lbl">Mesa</span>
              <span className="val">{code}</span>
            </div>
            <div className="receipt-row">
              <span className="lbl">Método</span>
              <span className="val">{result.methodLabel}</span>
            </div>
            <div className="receipt-row">
              <span className="lbl">{mesa.division_mode === 'igual' ? 'Mi parte' : 'Mis consumos'}</span>
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
              Con una cuenta PayMe podés abrir la mesa vos la próxima vez.
            </div>
          )}
        </div>
        <div className="action-bar">
          {/* Feedback Mati: el comprobante se puede enviar o descargar
              (contabilidad del comensal). */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <button className="btn btn-ghost" onClick={() => void shareReceipt()}>
              <Icon name="share" size={16} className="ico-inline" /> Enviar comprobante
            </button>
            <button className="btn btn-ghost" onClick={downloadReceipt}>
              <Icon name="download" size={16} className="ico-inline" /> Descargar
            </button>
          </div>
          {isGuest ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn btn-ghost"
                onClick={() => {
                  setView('detail');
                  setSelected(new Map());
                  reload();
                }}
              >
                Ver la mesa
              </button>
              <button className="btn btn-navy" onClick={() => navigate('home')}>
                Crear mi cuenta
              </button>
            </div>
          ) : (
            <button className="btn btn-navy" onClick={() => navigate('home')}>
              <Icon name="home" size={16} className="ico-inline" /> Inicio
            </button>
          )}
        </div>
      </div>
    );
  }

  // ─── Pago (s-payment) ────────────────────────────────────
  if (view === 'pay') {
    return (
      <div className="screen has-cta">
        <TopBar
          title="Pagar mi parte"
          onBack={() => setView('detail')}
          backLabel="Volver a la mesa"
          right={<Icon name="lock" size={18} />}
        />
        {guestHeader}
        <div className="scroll" style={{ padding: 16 }}>
          <div style={{ background: 'var(--navy)', borderRadius: 16, padding: '18px 20px', marginBottom: 16 }}>
            <div style={{ fontSize: 'var(--fs-xs)', color: 'rgba(255,255,255,0.75)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Pagás SOLO tu parte
            </div>
            <div style={{ fontSize: 'var(--fs-3xl)', fontWeight: 800, color: '#fff' }}>{formatMXN(gross)}</div>
            <div style={{ fontSize: 'var(--fs-xs)', color: 'rgba(255,255,255,0.75)', marginTop: 4, fontFamily: 'var(--font-body)' }}>
              {mesa.division_mode === 'igual' ? 'Tu parte' : 'Tus consumos'} {formatMXN(itemsAmount)} + propina {formatMXN(tipCents)}
            </div>
          </div>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <div className="sectlabel" id="lbl-propina">
            Propina al mozo
          </div>
          <div className="caption" style={{ margin: '0 2px 8px' }}>
            Tu base: {formatMXN(mesa.tip_base_cents)} (la cuenta ÷ {mesa.expected_participants || 1})
          </div>
          <div className="tip-row" role="radiogroup" aria-labelledby="lbl-propina">
            {TIP_OPTIONS.map((pct) => (
              <button
                key={pct}
                className={`tip-pill ${tipMode === 'pct' && tipPct === pct ? 'sel' : ''}`}
                onClick={() => {
                  setTipMode('pct');
                  setTipPct(pct);
                }}
                role="radio"
                aria-checked={tipMode === 'pct' && tipPct === pct}
              >
                {pct}%
              </button>
            ))}
            <button
              className={`tip-pill ${tipMode === 'custom' ? 'sel' : ''}`}
              onClick={() => setTipMode('custom')}
              role="radio"
              aria-checked={tipMode === 'custom'}
            >
              Otro
            </button>
          </div>
          {tipMode === 'custom' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '10px 2px 0' }}>
              <span style={{ fontWeight: 700 }}>$</span>
              <input
                className="input"
                style={{ flex: 1, padding: '10px 12px' }}
                inputMode="decimal"
                placeholder="0.00"
                value={customTipStr}
                onChange={(e) => setCustomTipStr(e.target.value.replace(/[^0-9.]/g, ''))}
                aria-label="Monto de propina a mano"
              />
            </div>
          )}
          {tipCents > 0 && mesa.active_staff.length > 0 && (
            <>
              <div className="sectlabel" id="lbl-mozo">
                ¿Para quién?
              </div>
              <div className="tip-row" style={{ flexWrap: 'wrap' }} role="group" aria-labelledby="lbl-mozo">
                {mesa.active_staff.map((s) => (
                  <button
                    key={s.id}
                    className={`tip-pill ${staffId === s.id ? 'sel' : ''}`}
                    style={{ flex: 'none' }}
                    onClick={() => setStaffId(staffId === s.id ? null : s.id)}
                    aria-pressed={staffId === s.id}
                  >
                    {s.display_name}
                  </button>
                ))}
              </div>
            </>
          )}
          <div className="sectlabel" id="lbl-metodo">
            Método
          </div>
          <div role="radiogroup" aria-labelledby="lbl-metodo">
            {!isGuest && (
              <button
                className={`method-card ${payType === 'wallet' ? 'sel' : ''}`}
                onClick={() => setPayType('wallet')}
                role="radio"
                aria-checked={payType === 'wallet'}
              >
                <div className="method-icon" style={{ background: 'var(--teal-l)' }} aria-hidden="true">
                  <Icon name="wallet" size={22} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 'var(--fs-base)' }}>Saldo PayMe</div>
                </div>
                <div className="radio" aria-hidden="true" />
              </button>
            )}
            <button
              className={`method-card ${payType === 'card' ? 'sel' : ''}`}
              onClick={() => {
                setPayType('card');
                if (cards.length > 0) setCardsOpen((v) => payType !== 'card' ? true : !v);
              }}
              role="radio"
              aria-checked={payType === 'card'}
              aria-expanded={cards.length > 0 ? cardsOpen : undefined}
            >
              <div className="method-icon" style={{ background: 'var(--gray-l)' }} aria-hidden="true">
                <Icon name="card" size={22} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 'var(--fs-base)' }}>Tarjeta de crédito o débito</div>
                <div className="caption">
                  {cards.length > 0
                    ? (cards.find((c) => c.id === cardChoice)
                        ? `${cards.find((c) => c.id === cardChoice)!.bank_name ?? cards.find((c) => c.id === cardChoice)!.brand} ···· ${cards.find((c) => c.id === cardChoice)!.last_four}`
                        : 'Elegí una guardada o usá otra')
                    : IS_MOCK
                      ? 'La ingresás al confirmar (segura, vía Stripe)'
                      : 'Ingresá los datos abajo (seguro, vía Stripe)'}
                </div>
              </div>
              {cards.length > 0 && (
                <span className="caption" aria-hidden="true" style={{ marginRight: 6 }}>
                  {cardsOpen ? '▴' : '▾'}
                </span>
              )}
              <div className="radio" aria-hidden="true" />
            </button>
            {/* D4 + feedback Mati: las guardadas viven en el desglosable, no
                sueltas en la lista principal. */}
            {!IS_DEMO && payType === 'card' && cards.length > 0 && cardsOpen && (
              <div role="radiogroup" aria-label="Tarjeta guardada" style={{ margin: '2px 0 4px' }}>
                {cards.map((c) => (
                  <button
                    key={c.id}
                    className={`method-card ${cardChoice === c.id ? 'sel' : ''}`}
                    onClick={() => setCardChoice(c.id)}
                    role="radio"
                    aria-checked={cardChoice === c.id}
                  >
                    <CardBrandChip brand={c.brand} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 'var(--fs-base)' }}>
                        {c.bank_name ?? c.brand} ···· {c.last_four}
                        {c.is_default && (
                          <span className="caption" style={{ marginLeft: 8 }}>
                            Principal
                          </span>
                        )}
                      </div>
                      <div className="caption">
                        Vence {String(c.exp_month).padStart(2, '0')}/{String(c.exp_year % 100).padStart(2, '0')}
                      </div>
                    </div>
                    <div className="radio" aria-hidden="true" />
                  </button>
                ))}
                <button
                  className={`method-card ${cardChoice === 'new' ? 'sel' : ''}`}
                  onClick={() => setCardChoice('new')}
                  role="radio"
                  aria-checked={cardChoice === 'new'}
                >
                  <div className="method-icon" style={{ background: 'var(--gray-l)' }} aria-hidden="true">
                    <Icon name="plus" size={22} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 'var(--fs-base)' }}>Usar otra tarjeta</div>
                  </div>
                  <div className="radio" aria-hidden="true" />
                </button>
              </div>
            )}
            {/* Tarjeta nueva: Elements en real; en mock no se pide número. */}
            {!IS_DEMO && payType === 'card' && (cards.length === 0 || (cardChoice === 'new' && cardsOpen)) && (
              <div style={{ margin: '2px 0 10px' }}>
                {!IS_MOCK && (
                  <>
                    <CardField onReady={setCardEl} onChange={handleCardChange} />
                    {cardState.error && (
                      <div className="caption" style={{ color: 'var(--red)' }} role="alert">
                        {cardState.error}
                      </div>
                    )}
                  </>
                )}
                {!isGuest && (
                  <label
                    className="caption"
                    style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}
                  >
                    <input
                      type="checkbox"
                      checked={saveCard}
                      onChange={(e) => setSaveCard(e.target.checked)}
                    />
                    Guardar esta tarjeta para la próxima
                  </label>
                )}
              </div>
            )}
            {/* Modo demo (?demo=1): tarjeta de test, sin iframe de Stripe. */}
            {!IS_MOCK && IS_DEMO && payType === 'card' && (
              <div className="caption" style={{ margin: '2px 0 10px' }}>
                <Icon name="card" size={16} className="ico-inline" /> Tarjeta de prueba ···· 4242 (demo)
              </div>
            )}
            <button
              className={`method-card ${payType === 'apple_pay' ? 'sel' : ''}`}
              onClick={() => setPayType('apple_pay')}
              role="radio"
              aria-checked={payType === 'apple_pay'}
            >
              <div className="method-icon" style={{ background: '#000', color: '#fff' }} aria-hidden="true">
                <Icon name="apple" size={22} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 'var(--fs-base)' }}>Apple Pay</div>
                <div className="caption">vía Stripe</div>
              </div>
              <div className="radio" aria-hidden="true" />
            </button>
            <button
              className={`method-card ${payType === 'google_pay' ? 'sel' : ''}`}
              onClick={() => setPayType('google_pay')}
              role="radio"
              aria-checked={payType === 'google_pay'}
            >
              <div
                className="method-icon"
                style={{ background: '#fff', border: '1.5px solid var(--gray-b)', fontWeight: 800, fontSize: 'var(--fs-md)' }}
                aria-hidden="true"
              >
                G
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 'var(--fs-base)' }}>Google Pay</div>
                <div className="caption">vía Stripe</div>
              </div>
              <div className="radio" aria-hidden="true" />
            </button>
          </div>
          {IS_MOCK && (
            <div className="note note-amber" style={{ marginTop: 6 }}>
              <b>Es una demo:</b> no se cobra nada de verdad y no hay ninguna tarjeta real
              conectada.
            </div>
          )}
          {isGuest && (
            <div className="note note-orange" style={{ marginTop: 6 }}>
              Sin iniciar sesión pagás con tarjeta o Apple Pay (el saldo PayMe pide cuenta).
            </div>
          )}
        </div>
        <button
          className="cta-float"
          onClick={doPay}
          disabled={
            busy ||
            gross === 0 ||
            (!IS_MOCK &&
              !IS_DEMO &&
              payType === 'card' &&
              (cards.length === 0 || cardChoice === 'new') &&
              !cardState.complete)
          }
        >
          {busy ? 'Procesando…' : `Pagar ${formatMXN(gross)}`}
        </button>
      </div>
    );
  }

  // ─── Detalle + selección (s-ticket / s-myitems / s-guest) ─
  const cd = countdownTo(mesa.expires_at);
  const pct = mesa.total_cents > 0 ? Math.round((mesa.paid_amount_cents / mesa.total_cents) * 100) : 0;
  const availableSlots = mesa.division_slots?.filter((s) => s.status === 'available').length ?? 0;
  // Si ya no queda NADA seleccionable, no tiene sentido pedir "elegí tus consumos".
  const nothingLeft =
    mesa.division_mode === 'consumo' &&
    mesa.items.length > 0 &&
    mesa.items.every((i) => i.status === 'paid' || (i.status === 'locked' && !i.locked_by_me));

  // Compartir link: mismo botón en las dos ramas de división (antes duplicado
  // e inaccesible — era solo el emoji 🔗 sin nombre).
  const shareButton = !isGuest && mesa.my_role === 'opener' && (
    <button
      className="back-btn"
      style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', flex: 'none' }}
      aria-label="Copiar link de invitación"
      onClick={async () => {
        try {
          const inv = await api.createInvitation(code);
          if (inv.link) {
            await navigator.clipboard.writeText(inv.link);
            toast('Link de invitación copiado ✓');
          }
        } catch {
          toast('No se pudo generar el link');
        }
      }}
    >
      <Icon name="link" size={18} />
    </button>
  );

  return (
    <div className="screen has-cta">
      <div className="top-bar" style={{ background: 'var(--navy)' }}>
        {!isGuest && (
          <button
            className="back-btn"
            onClick={() => goBack('mesas')}
            aria-label="Volver"
            style={{ background: 'rgba(255,255,255,0.15)', color: '#fff' }}
          >
            <span aria-hidden="true">←</span>
          </button>
        )}
        <TopLogo inv />
        <div style={{ flex: 1 }} />
        {shareButton}
        {isGuest && <span className="badge badge-teal">Invitado</span>}
      </div>
      <div style={{ background: 'var(--navy)', padding: '0 20px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 'var(--fs-sm)', color: 'rgba(255,255,255,0.75)', fontFamily: 'var(--font-body)', minWidth: 0 }}>
            {mesa.restaurant.name} · Mesa {code} ·{' '}
            {mesa.division_mode === 'igual' ? 'partes iguales' : 'cada uno lo suyo'}
          </div>
          <div style={{ background: 'var(--teal)', color: 'var(--navy)', padding: '4px 12px', borderRadius: 20, fontWeight: 800, fontSize: 'var(--fs-sm)', flexShrink: 0 }}>
            {formatMXN(mesa.total_cents)}
          </div>
        </div>
        <div style={{ marginTop: 10 }}>
          <div
            className="progress-bar"
            style={{ background: 'rgba(255,255,255,0.15)' }}
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Pagado ${pct}% de la mesa`}
          >
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 'var(--fs-xs)', color: 'rgba(255,255,255,0.75)', fontFamily: 'var(--font-body)' }}>
            <span>
              {formatMXN(mesa.paid_amount_cents)} pagado ({pct}%)
            </span>
            <span style={{ color: '#ffb59b', fontWeight: 700 }}>
              <Icon name="clock" size={14} className="ico-inline" /> {cd ?? 'venció'}
            </span>
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
              <div style={{ fontSize: 'var(--fs-xs)', color: 'rgba(255,255,255,0.75)' }}>de {formatMXN(mesa.total_cents)}</div>
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--teal)', fontWeight: 700 }}>
                {mesa.total_cents > 0 ? Math.round((itemsAmount / mesa.total_cents) * 100) : 0}%
              </div>
            </div>
          </div>
          <div className="scroll" style={{ background: '#fff' }}>
            <div style={{ padding: '12px 16px 4px' }} className="caption">
              Tocá lo que consumiste. Al elegirlo queda <b>reservado</b> para vos.
            </div>
            {nothingLeft && (
              <div className="note note-amber" style={{ margin: '8px 16px' }}>
                Los demás ya tomaron todo lo de esta mesa. No queda nada para que pagues.
              </div>
            )}
            {mesa.items.map((i) => {
              const fullPrice = i.price_cents * i.quantity;
              const paidFull = i.status === 'paid';
              // Bloqueado solo si NO queda nada y nada es mío.
              const blocked = (paidFull || i.remaining_bps <= 0) && i.my_bps === 0 && !selected.has(i.id);
              const sel = selected.has(i.id);
              const myBpsSel = selected.get(i.id) ?? 10000;
              const partial = i.remaining_bps > 0 && i.remaining_bps < 10000;
              const hint = paidFull
                ? ' · ya pagado'
                : blocked
                  ? ' · lo tomaron'
                  : partial
                    ? ` · queda ${bpsLabel(i.remaining_bps)}`
                    : '';
              return (
                <div
                  key={i.id}
                  className={`item-row ${sel ? 'sel' : ''} ${blocked ? 'paid-other' : ''}`}
                  style={{ flexWrap: 'wrap', rowGap: 4 }}
                >
                  <button
                    onClick={() => !blocked && toggleItem(i.id)}
                    disabled={blocked}
                    aria-pressed={blocked ? undefined : sel}
                    aria-label={`${i.name}, ${formatMXN(fullPrice)}${hint}`}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0, background: 'none', border: 'none', padding: 0, cursor: blocked ? 'default' : 'pointer', textAlign: 'left' }}
                  >
                    <div className={`checkbox ${sel ? 'on' : ''} ${blocked ? 'blocked' : ''}`} aria-hidden="true">
                      {blocked ? (paidFull ? '✓' : <Icon name="lock" size={13} />) : '✓'}
                    </div>
                    <div className="item-name" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {i.name}
                      {partial && !blocked && (
                        <span className="item-hint"> · queda {bpsLabel(i.remaining_bps)}</span>
                      )}
                      {(paidFull || blocked) && <span className="item-hint">{hint}</span>}
                    </div>
                  </button>
                  {/* v2.18: fracción en la MISMA línea (UX ratificada). */}
                  {sel && (
                    <div style={{ display: 'flex', gap: 4, flex: 'none' }} role="radiogroup" aria-label={`Fracción de ${i.name}`}>
                      {FRACTIONS.filter((f) => f.bps <= i.remaining_bps).map((f) => (
                        <button
                          key={f.bps}
                          className={`tip-pill ${myBpsSel === f.bps ? 'sel' : ''}`}
                          style={{ padding: '3px 9px', fontSize: 'var(--fs-sm)' }}
                          onClick={() => setFraction(i.id, f.bps)}
                          role="radio"
                          aria-checked={myBpsSel === f.bps}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="item-price" style={{ flex: 'none' }}>
                    {sel && myBpsSel < 10000
                      ? formatMXN(fractionPreview(fullPrice, myBpsSel, i.remaining_bps))
                      : formatMXN(fullPrice)}
                  </div>
                </div>
              );
            })}
          </div>
          <button className="cta-float" onClick={goToPay} disabled={busy || selected.size === 0}>
            {busy
              ? 'Reservando…'
              : nothingLeft
                ? 'No queda nada por pagar'
                : selected.size === 0
                  ? 'Elegí lo que consumiste'
                  : `Pagar mi parte → ${formatMXN(itemsAmount)}`}
          </button>
        </>
      ) : (
        <>
          <div className="scroll" style={{ padding: 16 }}>
            {/* IMPORTANTÍSIMO (Mati): aunque se pague en partes iguales, cada
                comensal marca QUÉ consumió — esa info sostiene el modelo.
                No cambia el monto (la parte es fija) ni reserva nada. */}
            <div className="sectlabel">¿Qué consumiste?</div>
            <div className="caption" style={{ margin: '0 2px 8px' }}>
              Marcalo para el restaurante — no cambia lo que pagás.
            </div>
            <div className="card" style={{ marginBottom: 14 }}>
              {mesa.items.map((i) => {
                const sel = selected.has(i.id);
                return (
                  <button
                    key={i.id}
                    className={`item-row ${sel ? 'sel' : ''}`}
                    onClick={() => toggleItem(i.id)}
                    aria-pressed={sel}
                    aria-label={`${i.name}${i.quantity > 1 ? ` por ${i.quantity}` : ''}`}
                  >
                    <div className={`checkbox ${sel ? 'on' : ''}`} aria-hidden="true">
                      ✓
                    </div>
                    <div className="item-name">
                      {i.name}
                      {i.quantity > 1 ? ` × ${i.quantity}` : ''}
                    </div>
                    {/* Feedback Mati: el precio de cada producto, visible. */}
                    <div className="item-price">{formatMXN(i.price_cents * i.quantity)}</div>
                  </button>
                );
              })}
            </div>
            <div className="note note-teal">
              La cuenta se dividió en {mesa.expected_participants} partes iguales de{' '}
              <b>{formatMXN(itemsAmount)}</b>. Quedan <b>{availableSlots}</b> por pagar.
            </div>
          </div>
          <button
            className="cta-float"
            onClick={goToPay}
            disabled={busy || availableSlots === 0 || selected.size === 0}
          >
            {availableSlots === 0
              ? 'No quedan partes'
              : selected.size === 0
                ? 'Marcá lo que consumiste'
                : `Pagar mi parte → ${formatMXN(itemsAmount)}`}
          </button>
        </>
      )}
    </div>
  );
}
