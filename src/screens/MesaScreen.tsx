import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, IS_MOCK, WALLET_PAY_ENABLED, newIdempotencyKey } from '../api';
import { useWalletRail } from '../api/walletRail';
import type { MonetaryIntentHandle, UnconfirmedAttempt } from '../api/idempotency';
import {
  acquireMonetaryIntent,
  clearUnconfirmed,
  completeMonetaryIntent,
  markUnconfirmed,
  prepareMonetaryRequest,
  crossActorIntentExists,
  readUnconfirmed,
  reconcileMonetaryIntent,
  recallPaymentMethod,
  rememberPaymentMethod,
  scopeForActor,
  shouldRotateOnError,
  useMoneyActor,
} from '../api/idempotency';
import type { StripeCardElement } from '@stripe/stripe-js';
import { extractApiError } from '../api/errors';
import { isDefinitiveMutationError, isServiceUnavailable } from '../api/mutationRetry';
import { mesaClosureView, mesaPaymentOutcome } from '../api/paymentStatus';
import { payableEqualSlotAmounts, type PayMesaExpectation } from '../api/moneyGuards';
import { confirmCardPayment, createCardPaymentMethod } from '../api/stripe';
import { CardField, type CardFieldState } from '../components/CardField';
import { Icon } from '../components/Icon';
import { InviteFriends } from '../components/InviteFriends';
import type {
  FractionRequest,
  MesaDetail,
  PayMesaRequest,
  PayMesaResponse,
  PaymentMethod,
  PaymentType,
} from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { CardBrandChip, TopBar, TopLogo, useToast } from '../components/ui';
import {
  needsExtraPartConfirmation as needsExtraPartConfirmationOf,
  paymentLanded,
  requiresReconciliation,
} from './freezeMachine';
import { goBack, navigate } from '../router';
import { countdownTo, formatMXN } from '../utils/format';
import { fractionAmount, stringToCents, tipFromBps } from '../utils/money';
import { createInFlightMutex } from '../utils/inFlight';
import { RequestEpoch } from '../utils/requestEpoch';
import { writeClipboardText } from '../utils/clipboard';

/**
 * Pantalla de mesa (T2/T3/T4): detalle + mis ítems con lock, pago con
 * propina al mozo, procesando → comprobante, y cierre con semántica A-2
 * ("tu garantía cubrió $X"). Sirve para organizador, participante e
 * INVITADO por link (#/mesa/:code?t=token, sin login).
 */

type View = 'detail' | 'pay' | 'confirm';

const TIP_OPTIONS = [0, 10, 15, 20];

interface PayResult {
  itemsAmount: number;
  tip: number;
  gross: number;
  methodLabel: string;
  /**
   * Pivote a Stripe Connect (2026-07-24): con TARJETA (incl. Apple/Google
   * Pay) el comercio es el RESTAURANTE, no PayMe. Con saldo no aplica: ese
   * riel sigue siendo de PayMe.
   */
  chargedByRestaurant: boolean;
  /** G-10: descriptor del resumen de tarjeta. Ausente hasta que el contrato lo exponga. */
  statementDescriptor: string | null;
  /** v2.24: se pidió guardar la tarjeta pero el riel directo la ignora (G-11). */
  saveOmitidoPorConnect: boolean;
}

/**
 * Binding contractual de la respuesta. Los montos de preview no intervienen:
 * consumo se acredita con el recibo de ítems; igualdad, con un monto de slot
 * que efectivamente pertenece a la mesa.
 */
function payExpectationFor(mesa: MesaDetail, body: PayMesaRequest): PayMesaExpectation {
  const expectedTip = body.tip_cents ?? tipFromBps(
    mesa.total_cents,
    mesa.expected_participants || 1,
    body.tip_bps ?? 0,
  );
  if (mesa.division_mode === 'consumo') {
    return {
      divisionMode: 'consumo',
      tipCents: expectedTip,
    };
  }
  return {
    divisionMode: 'igual',
    possibleItemsAmountCents: payableEqualSlotAmounts(mesa.division_slots),
    tipCents: expectedTip,
  };
}

export function MesaScreen({ code, guestToken }: { code: string; guestToken?: string }) {
  // OLA 5D · método de pago con saldo y copy asociada: los declara el BACKEND.
  const { walletRailEnabled } = useWalletRail();
  const { session } = useAuth();
  const { actor, error: actorError } = useMoneyActor(guestToken);
  const toast = useToast();
  /**
   * ⚠️ OBSOLETO PERO NO BORRADO · `guestToken` no puede llegar nunca.
   *
   * El comentario anterior decía que App decidía acá la vista de invitado "sin
   * sesión siempre; con sesión solo en la demo". **Las dos mitades están
   * vencidas**: el modo demo se eliminó el 2026-08-03, y desde el cierre del
   * pago sin cuenta (backend v2.32.0) App monta esta pantalla en UN solo lugar
   * y **sin el prop**. `isGuest` es `false` siempre.
   *
   * Todo lo que cuelga de `isGuest` queda inalcanzable e INTACTO, igual que las
   * ramas `req.isGuest` que el emisor dejó en pie: mezclar borrado de código con
   * un cambio de autorización sobre rutas de dinero es cómo se cuelan errores.
   * Un test impide que alguien vuelva a montar esta pantalla con un token.
   */
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
  // T-F1: invitador in-app desplegable en la mesa (el paso compartir es one-shot).
  const [inviteOpen, setInviteOpen] = useState(false);
  const shareAttemptsRef = useRef<Map<string, string>>(new Map());
  const shareLinksRef = useRef<Map<string, string>>(new Map());
  const shareInFlightRef = useRef(createInFlightMutex());
  // D4: tarjetas guardadas. `cardChoice` = pm_… elegido o 'new' (otra
  // tarjeta); `saveCard` = checkbox "guardar" (ratificado: prendido). El
  // invitado sin cuenta no tenía guardadas: siempre tarjeta nueva sin checkbox.
  // (Rama inalcanzable desde v2.32.0 — ver el docblock de `isGuest`.)
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
  /**
   * B-06: una vez que el usuario apretó "Pagar", ninguna respuesta de red
   * puede cambiarle el método de pago por su cuenta. Cambiarlo mueve el scope
   * de la clave, y si el pago quedó en el aire, el reintento cobraría de nuevo.
   */
  const payStartedRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const payInFlightRef = useRef(createInFlightMutex());
  const [error, setError] = useState<string | null>(null);
  /** El replay trajo un pago ya reembolsado: volver a pagar se decide a mano. */
  const [refundedNotice, setRefundedNotice] = useState(false);
  const [result, setResult] = useState<PayResult | null>(null);
  const [, forceTick] = useState(0);
  // Toda lectura de esta instancia captura el epoch. Cambiar token/código
  // invalida antes de renderizar la identidad siguiente y un resolve tardío
  // de A no puede escribir mesa, error, tarjetas ni notFound de B.
  const identityEpochRef = useRef(new RequestEpoch());
  const mesaReadEpochRef = useRef(new RequestEpoch());

  // Un token guest nuevo para el mismo código es otra identidad: ningún
  // estado visual o lock de A puede sobrevivir para B.
  useEffect(() => {
    identityEpochRef.current.next();
    mesaReadEpochRef.current.next();
    setMesa(null); setNotFound(false); setSelected(new Map()); setLockTokens([]);
    setTipPct(15); setTipMode('pct'); setCustomTipStr(''); setStaffId(null);
    setPayType('card'); setCardsOpen(false); setInviteOpen(false); setCards([]);
    shareInFlightRef.current = createInFlightMutex();
    setCardChoice('new'); setSaveCard(true); setCardEl(null);
    const emptyCard: CardFieldState = { complete: false, error: null, empty: true };
    cardStateRef.current = emptyCard; setCardState(emptyCard);
    payStartedRef.current = false; payInFlightRef.current = createInFlightMutex();
    setRefundedNotice(false); setResult(null); setError(null); setBusy(false); setView('detail');
  }, [guestToken, code]);

  async function copyInvitationLink() {
    if (!shareInFlightRef.current.tryEnter()) return;
    try {
      let link = shareLinksRef.current.get(code) ?? null;
      if (!link) {
        const key = shareAttemptsRef.current.get(code) ?? newIdempotencyKey();
        shareAttemptsRef.current.set(code, key);
        const invitation = await api.createInvitation(code, key);
        if (invitation.invitation.status === 'expired') {
          shareAttemptsRef.current.delete(code);
          toast('La invitación anterior venció. Tocá de nuevo para generar otra.');
          return;
        }
        if (!invitation.link) {
          toast('La invitación pudo haberse creado, pero no recibimos el link. Reintentá la misma operación; no generes otra.');
          return;
        }
        // La mutación terminó. Si falla el clipboard, se conserva SOLO el
        // link ya generado para volver a copiarlo sin hacer otro POST.
        shareAttemptsRef.current.delete(code);
        link = invitation.link;
        shareLinksRef.current.set(code, link);
      }
      try {
        const copied = await writeClipboardText(link);
        if (!copied) throw new Error('clipboard_unavailable');
        shareLinksRef.current.delete(code);
        toast('Link de invitación copiado ✓');
      } catch {
        toast('El link ya se generó, pero no se pudo copiar. Tocá de nuevo: no vamos a crear otro.');
      }
    } catch (err) {
      const failure = extractApiError(err);
      const definitive = isDefinitiveMutationError(failure.code, failure.status);
      if (definitive) shareAttemptsRef.current.delete(code);
      toast(
        isServiceUnavailable(failure.status)
          ? 'El servicio no pudo confirmar el link. Reintentá esta misma operación; no generes otra.'
          : definitive
            ? 'No se pudo generar el link'
            : 'No pudimos confirmar el link. Reintentá la misma operación: vamos a reutilizarla.',
      );
    } finally {
      shareInFlightRef.current.leave();
    }
  }

  const reload = useCallback(() => {
    const requestEpoch = mesaReadEpochRef.current.next();
    const identityEpoch = identityEpochRef.current.capture();
    api
      .getMesa(code, guestToken)
      .then((r) => {
        if (mesaReadEpochRef.current.isCurrent(requestEpoch) && identityEpochRef.current.isCurrent(identityEpoch)) {
          setMesa(r.mesa); setNotFound(false);
        }
      })
      .catch(() => {
        if (mesaReadEpochRef.current.isCurrent(requestEpoch) && identityEpochRef.current.isCurrent(identityEpoch)) setNotFound(true);
      });
  }, [code, guestToken]);

  useEffect(() => {
    reload();
    const tick = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(tick);
  }, [reload]);

  useEffect(() => {
    if (!isGuest) {
      const identityEpoch = identityEpochRef.current.capture();
      let alive = true;
      api
        .getPaymentMethods()
        .then((r) => {
          if (!alive || !identityEpochRef.current.isCurrent(identityEpoch)) return;
          // D4 (v2.16): las guardadas se reusan con su uuid (payment_method_id).
          setCards(r.payment_methods);
          const def = r.payment_methods.find((p) => p.is_default) ?? r.payment_methods[0];
          // No pisar la selección si el usuario ya está tipeando una nueva —
          // ni si ya hay un pago en curso (B-06: movería la clave).
          if (def && cardStateRef.current.empty && !payStartedRef.current) setCardChoice(def.id);
        })
        .catch(() => { if (alive && identityEpochRef.current.isCurrent(identityEpoch)) setCards([]); });
      return () => { alive = false; };
    }
    return undefined;
  }, [isGuest, guestToken, code]);

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
    // B-06: con un pago sin confirmar, cambiar la selección cambiaría el
    // payload de la clave congelada → 409 en el reintento (o, peor, un cobro
    // nuevo). Primero se resuelve ese pago.
    if (frozenRef.current) {
      toast('Tenés un pago sin confirmar: resolvelo antes de cambiar tu selección');
      return;
    }
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
    if (frozenRef.current) {
      toast('Tenés un pago sin confirmar: resolvelo antes de cambiar tu selección');
      return;
    }
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
      // Connect: con tarjeta el comercio es el restaurante (con saldo, PayMe).
      ...(result.chargedByRestaurant
        ? [
            `Cobrado por: ${mesa.restaurant.name}`,
            ...(result.statementDescriptor
              ? [`En tu resumen de tarjeta: ${result.statementDescriptor}`]
              : []),
          ]
        : []),
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
      const copied = await writeClipboardText(text);
      toast(copied
        ? 'Comprobante copiado ✓'
        : 'No se pudo copiar: tu navegador no habilitó el portapapeles');
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

  /**
   * B-06: el scope se DERIVA DEL CONTENIDO del pago, con los mismos campos que
   * el backend hashea (`PAYLOAD_KEYS.mesa_pay`). Mismo payload = misma clave =
   * el reintento cae en el replay, aunque el usuario haya recargado o salido
   * de la mesa y vuelto. Payload distinto = clave distinta, sin rotar nada.
   *
   * Va `cardChoice` y NO el `pm_`: el pm_ de una tarjeta tipeada se genera
   * dentro de doPay y se cachea BAJO este scope, así que el reintento recupera
   * el mismo y el hash del backend no se mueve. Meterlo acá sería circular.
   *
   * `lock_tokens` queda afuera a propósito: el backend lo excluye del hash.
   */
  const rawContentScope = useMemo(() => {
    const sel =
      mesa?.division_mode === 'consumo'
        ? [...selected.entries()].map(([id, bps]) => `${id}:${bps}`).sort().join(',')
        : [...selected.keys()].sort().join(',');
    const tip = tipMode === 'custom' ? `c${tipCents}` : `b${tipPct * 100}`;
    return `pay:${code}|${payType}|${cardChoice}|${sel}|${tip}|${staffId ?? '-'}`;
  }, [code, mesa?.division_mode, selected, tipMode, tipCents, tipPct, payType, cardChoice, staffId]);
  const contentScope = actor ? scopeForActor(actor, rawContentScope) : '';

  /**
   * Intento sin confirmar (error ambiguo). Mientras exista, el pago queda
   * CONGELADO en ese scope: no se puede cambiar nada y el único camino es
   * reintentar el mismo pago, que el backend replaya en vez de re-cobrar.
   */
  const payArea = actor ? scopeForActor(actor, `pay:${code}`) : '';
  const [frozen, setFrozen] = useState<UnconfirmedAttempt | null>(null);
  useEffect(() => {
    if (!payArea) return;
    let alive = true;
    const identityEpoch = identityEpochRef.current.capture();
    void readUnconfirmed(payArea, `mesa_pay:${code}`)
      .then((attempt) => {
        if (!alive || !identityEpochRef.current.isCurrent(identityEpoch)) return;
        setFrozen(attempt);
        if (attempt?.reconciliationRequired) {
          setError('Hay un pago de una sesión anterior. No vamos a reenviarlo ni iniciar otro hasta reconciliarlo.');
        }
      })
      .catch(() => alive && identityEpochRef.current.isCurrent(identityEpoch) && setError('Hay un pago anterior que no podemos atribuir de forma segura. Esperá la reconciliación antes de pagar.'));
    return () => { alive = false; };
  }, [payArea, code]);
  useEffect(() => { setFrozen(null); }, [guestToken, code]);
  const frozenScope = frozen?.scope ?? null;
  // La decisión vive en `freezeMachine.ts`, que sí tiene cobertura: acá sólo
  // se consume. Antes era lógica inline sin un solo test.
  const frozenRequiresReconciliation = requiresReconciliation(frozen);
  const payScope = frozenScope ?? contentScope;
  const frozenRef = useRef(frozenScope);
  frozenRef.current = frozenScope;

  /** Agregado informativo del principal; nunca prueba qué intento concreto llegó. */
  const mySlotsTaken = mesa?.division_slots?.filter((s) => s.claimed_by_me).length ?? 0;

  /**
   * N-08 · cruce invitado↔autenticado. La misma persona en la misma mesa por
   * las dos puertas obtenía journal virgen y key nueva; en división igual eso
   * es un segundo casillero, o sea doble cobro.
   *
   * `claimed_by_me` no lo detecta: el backend lo computa por identidad (hash
   * del token de invitado vs `user_id`), así que también ve dos personas. La
   * evidencia posible sin cambiar contrato es local a este dispositivo.
   *
   * NO bloquea —pagar varias partes es legítimo y el guard
   * un-usuario-un-casillero está vetado por acta—: exige una confirmación
   * explícita para que sea una decisión y no un accidente.
   */
  const [crossActor, setCrossActor] = useState(false);
  const [crossActorAcknowledged, setCrossActorAcknowledged] = useState(false);
  const [showExtraPartConfirm, setShowExtraPartConfirm] = useState(false);
  useEffect(() => {
    if (!payArea) return;
    let alive = true;
    void crossActorIntentExists(payArea, `mesa_pay:${code}`)
      .then((exists) => alive && setCrossActor(exists))
      .catch(() => alive && setCrossActor(true));
    return () => { alive = false; };
  }, [payArea, code]);
  useEffect(() => { setCrossActorAcknowledged(false); setShowExtraPartConfirm(false); }, [guestToken, code]);
  /** Se pide confirmación por evidencia del backend (mi casillero) o del dispositivo. */
  const needsExtraPartConfirmation = needsExtraPartConfirmationOf({
    acknowledged: crossActorAcknowledged,
    crossActorIntent: crossActor,
    mySlotsTaken,
  });

  const freezePay = useCallback(
    (scope: string, handle: MonetaryIntentHandle, payload?: unknown) => {
      if (!payArea) throw new Error('money_actor_unavailable');
      try {
        markUnconfirmed(payArea, scope, handle, payload);
        setFrozen({ actor: scope.split('::')[0], scope, handle, ...(payload !== undefined && { payload }) });
      } catch (error) {
        if (extractApiError(error).code !== 'monetary_family_reconciliation_required') throw error;
        setFrozen({ actor: scope.split('::')[0], scope, handle, reconciliationRequired: true });
      }
    },
    [payArea],
  );
  const unfreezePay = useCallback((handle: MonetaryIntentHandle) => {
    if (!payArea) return;
    clearUnconfirmed(payArea, handle);
    setFrozen((current) => current && current.handle.key === handle.key && current.handle.generation === handle.generation ? null : current);
  }, [payArea]);

  /**
   * N-07 · SALIDA del intento congelado. Antes no existía ninguna: sin payload
   * en memoria —tras un reload o el back del navegador— el pago quedaba
   * bloqueado para siempre.
   *
   * No hay TTL ni desbloqueo automático. Se consulta la EVIDENCIA AUTORITATIVA
   * del backend (`claimed_by_me` sobre los casilleros, o mis ítems pagados) y
   * recién con eso se cierra el intento:
   *  - si el pago llegó, se informa y se cierra sin cobrar nada;
   *  - si no llegó, se pide una confirmación explícita antes de liberar, porque
   *    el intento siguiente será un cobro nuevo.
   */
  const [reconciling, setReconciling] = useState(false);
  const [reconcileVerdict, setReconcileVerdict] = useState<'landed' | 'absent' | null>(null);

  const checkReconciliation = useCallback(async () => {
    if (!frozen || !payArea) return;
    setReconciling(true);
    setError(null);
    try {
      const fresh = await api.getMesa(code, guestToken);
      setMesa(fresh.mesa);
      const landed = paymentLanded(fresh.mesa);
      if (landed) {
        await reconcileMonetaryIntent(frozen.scope, `mesa_pay:${code}`, frozen.handle);
        setFrozen(null);
        setReconcileVerdict(null);
        toast('Ese pago ya está registrado ✓');
      } else {
        // No se libera solo: el usuario tiene que decidirlo viendo el aviso.
        setReconcileVerdict('absent');
      }
    } catch {
      setError('No pudimos consultar el estado de la mesa. Probá de nuevo en un momento.');
    } finally {
      setReconciling(false);
    }
  }, [frozen, payArea, code, guestToken, toast]);

  const releaseAfterReconciliation = useCallback(async () => {
    if (!frozen) return;
    setReconciling(true);
    try {
      await reconcileMonetaryIntent(frozen.scope, `mesa_pay:${code}`, frozen.handle);
      setFrozen(null);
      setReconcileVerdict(null);
      setError(null);
      toast('Listo: podés pagar de nuevo');
    } catch {
      setError('No pudimos cerrar ese intento. Sigue bloqueado por seguridad.');
    } finally {
      setReconciling(false);
    }
  }, [frozen, code, toast]);

  // `claimed_by_me` es un agregado del principal, no identifica qué intento
  // pagó. Otro dispositivo puede aumentarlo mientras ESTE POST sigue ambiguo;
  // por eso nunca terminaliza ni descongela el journal local.

  /**
   * Respuesta del pago (nueva o REPLAY idempotente): 3DS, reembolsado y
   * comprobante. Vive aparte porque el reintento congelado la comparte, y los
   * datos del comprobante salen del CUERPO que se mandó, no del estado de la
   * pantalla — tras una recarga ese estado ya no existe.
   */
  async function handlePayResponse(r: PayMesaResponse, scope: string, intent: MonetaryIntentHandle, body: PayMesaRequest) {
    const payKind = body.payment_type;
    const savedCard = body.payment_method_id
      ? (cards.find((c) => c.id === body.payment_method_id) ?? null)
      : null;
    const savingNewCard = !!body.save_payment_method;
    // El pago con tarjeta puede volver en `requires_action`: ahí el banco
    // pide 3DS y hay que confirmarlo con Stripe.js antes de dar por hecho el
    // cobro. Sin esto el usuario vería "pagado" con el cobro sin confirmar.
    // El REPLAY idempotente devuelve la fila cruda del attempt: el secreto
    // se llama `stripe_client_secret` y no trae `requires_action` (se deriva
    // del status). Sin tolerar ese shape, un replay en 3DS saltaba el
    // desafío del banco y pintaba "pagado" con el cobro sin confirmar.
    const at = r.attempt;
    const clientSecret = at.client_secret ?? at.stripe_client_secret;
    const needsAction = at.requires_action ?? at.status === 'requires_action';
    // B-06: un replay puede traer un pago YA REEMBOLSADO. El backend
    // devuelve 200 con status 'refunded' a propósito (un 409 nos haría
    // rotar la clave y RE-COBRAR el reembolso). Se trata por el status.
    if (at.status === 'refunded') {
      // El intento quedó resuelto (se cobró y se devolvió). Marcar terminal
      // no emite red: solo permite que una acción posterior y explícita del
      // usuario adquiera otra generación con una clave distinta.
      await completeMonetaryIntent(scope, `mesa_pay:${code}`, intent);
      unfreezePay(intent);
      setRefundedNotice(true);
      setError('Ese pago se cobró y después te lo reembolsaron. No volvimos a cobrarte.');
      setBusy(false);
      reload();
      return;
    }
    if (needsAction && clientSecret) {
      // v2.24 (Connect · direct charge): si el intent vive en la cuenta del
      // restaurante, Stripe.js DEBE inicializarse con esa cuenta o el 3DS es
      // inconfirmable. Ausente = cargo de plataforma, como siempre.
      const confirmed = await confirmCardPayment(clientSecret, at.connected_account_id);
      if (!confirmed.ok) {
        if (confirmed.definitive) {
          // El banco rechazó: el intento murió y el backend liberó lo tomado.
          await completeMonetaryIntent(scope, `mesa_pay:${code}`, intent);
          unfreezePay(intent);
          setError(confirmed.error);
        } else {
          // Se cayó la red durante el 3DS: el banco pudo haber autorizado
          // igual. Se congela; el reintento replaya en vez de re-cobrar.
          freezePay(scope, intent, body);
          setError('Se cortó la conexión mientras el banco confirmaba. No reintentes con otro método: tocá "Reintentar el pago sin confirmar".');
        }
        setBusy(false);
        reload();
        return;
      }
      // La aprobación de Stripe no acredita sola el pago en PayMe. Esperamos
      // el estado del backend y conservamos key/payload mientras tanto.
      freezePay(scope, intent, body);
      setError('Tu banco aprobó la operación; todavía estamos confirmando el pago. Reintentá esta misma confirmación, sin cambiar el método.');
      setBusy(false);
      reload();
      return;
    }
    const outcome = mesaPaymentOutcome(at.status);
    if (outcome === 'definitive') {
      await completeMonetaryIntent(scope, `mesa_pay:${code}`, intent);
      unfreezePay(intent);
      setError('Ese pago no prosperó. Podés iniciar uno nuevo.');
      setBusy(false);
      reload();
      return;
    }
    if (outcome !== 'success') {
      // pending/requires_action/processing, shapes incompletos y estados
      // nuevos no son acreditación. Se conserva el intento para reconciliar.
      freezePay(scope, intent, body);
      setError('Estamos confirmando este pago. No inicies otro ni cambies el método hasta que se resuelva.');
      setBusy(false);
      reload();
      return;
    }
    const methodLabel =
      payKind === 'wallet'
        ? 'Saldo PayMe'
        : payKind === 'apple_pay'
          ? 'Apple Pay'
          : payKind === 'google_pay'
            ? 'Ⓖ Google Pay'
            : `${savedCard ? `${savedCard.brand === 'visa' ? 'Visa' : savedCard.brand} ··${savedCard.last_four}` : 'Tarjeta'}`;
    setResult({
      // Exacto del server: la fracción completadora puede ajustar ±1¢.
      itemsAmount: r.attempt.gross_amount_cents - (r.attempt.tip_cents ?? body.tip_cents ?? tipCents),
      tip: r.attempt.tip_cents ?? body.tip_cents ?? tipCents,
      gross: r.attempt.gross_amount_cents,
      methodLabel,
      // v2.24: "Cobrado por el restaurante" es cierto SOLO en el riel
      // DIRECTO. En el de plataforma cobra PayMe — afirmarlo siempre era
      // mentirle al comensal en el 99% de los pagos de hoy.
      chargedByRestaurant: payKind !== 'wallet' && !!r.attempt.connected_account_id,
      saveOmitidoPorConnect: savingNewCard && !!r.attempt.connected_account_id,
      statementDescriptor: r.attempt.statement_descriptor ?? null,
    });
    // Intento completado: el próximo pago de esta mesa (otra parte, otro
    // plato) es una intención NUEVA y necesita clave nueva.
    await completeMonetaryIntent(scope, `mesa_pay:${code}`, intent);
    unfreezePay(intent);
    setView('confirm');
    setBusy(false);
  }

  async function doPay() {
    if (!mesa) return;
    if (!payInFlightRef.current.tryEnter()) return;
    // B-06: el scope se CONGELA acá. Si algo lo mueve mientras el pago vuela
    // (una respuesta tardía de /payment-methods, un re-render), la clave que
    // se conserva para el reintento sigue siendo la de ESTE intento.
    const scope = payScope;
    if (!scope || !actor) {
      setError(actorError ? 'No pudimos verificar una identidad segura para este pago.' : 'Preparando una identidad segura para este pago…');
      payInFlightRef.current.leave();
      return;
    }
    if (frozenRequiresReconciliation) {
      setError('Este pago no puede reenviarse desde la sesión actual. Sigue bloqueado hasta reconciliar su resultado.');
      payInFlightRef.current.leave();
      return;
    }
    // N-08: no se emite una clave nueva sobre una mesa donde este dispositivo
    // (o esta identidad) ya tiene un pago, sin que el usuario lo confirme.
    if (!frozen && needsExtraPartConfirmation) {
      setError(null);
      setShowExtraPartConfirm(true);
      payInFlightRef.current.leave();
      return;
    }
    payStartedRef.current = true;
    setBusy(true);
    setError(null);
    // El cuerpo EXACTO que salió, para poder congelarlo si la respuesta se
    // pierde: el reintento tiene que reenviar esto, no reconstruirlo.
    let sentBody: PayMesaRequest | null = null;
    let intent: MonetaryIntentHandle | null = frozen?.handle ?? null;
    try {
      /**
       * B-06: reintento de un intento CONGELADO. Se manda el MISMO cuerpo que
       * se mandó la primera vez, no uno reconstruido: tras una recarga el
       * estado de la pantalla arranca vacío, y reconstruirlo mandaría otro
       * payload con la misma clave → 409 en bucle, sin salida.
       */
      if (frozen?.payload) {
        const body = frozen.payload as PayMesaRequest;
        intent = frozen.handle;
        sentBody = body;
        await prepareMonetaryRequest(scope, `mesa_pay:${code}`, intent, body);
        const r = await api.payMesa(code, body, guestToken, payExpectationFor(mesa, body), intent);
        await handlePayResponse(r, scope, intent, body);
        return;
      }
      // D4 (v2.16): tarjeta GUARDADA → `payment_method_id` (uuid); tarjeta
      // NUEVA → pm_ desde el Card Element como `stripe_payment_method_id`,
      // con `save_payment_method` según el checkbox.
      const savedCard = payType === 'card' ? (cards.find((c) => c.id === cardChoice) ?? null) : null;
      intent = intent ?? await acquireMonetaryIntent(scope, `mesa_pay:${code}`);
      const idempotencyKey = intent.key;
      let stripePmId: string | null = null;
      let savedPmId: string | null = null;
      let savingNewCard = false;
      if (payType === 'card') {
        if (savedCard) {
          savedPmId = savedCard.id;
        } else if (IS_MOCK) {
          stripePmId = recallPaymentMethod(scope, intent) ?? `pm_mock_nueva_${Date.now().toString(36)}`;
          await rememberPaymentMethod(scope, intent, stripePmId);
          savingNewCard = !isGuest && saveCard;
        } else {
          if (!cardEl) {
            setError('Ingresá los datos de la tarjeta para continuar.');
            setBusy(false);
            return;
          }
          // B-06: en el REINTENTO se reusa el pm_ ya tokenizado. Stripe.js
          // devuelve uno distinto por invocación y el backend lo hashea: sin
          // esto, la clave estable daría 409 idempotency_conflict en bucle.
          const cached = recallPaymentMethod(scope, intent);
          if (cached) {
            stripePmId = cached;
          } else {
            const res = await createCardPaymentMethod(cardEl);
            if ('error' in res) {
              setError(res.error);
              setBusy(false);
              return;
            }
            stripePmId = res.paymentMethodId;
            await rememberPaymentMethod(scope, intent, stripePmId);
          }
          savingNewCard = !isGuest && saveCard;
        }
      }

      const body: PayMesaRequest = {
          payment_type: payType,
          // IMPORTANTÍSIMO (Mati): también en partes iguales viaja QUÉ consumió
          // cada uno (v2.18.1 ya lo persiste — G-07 resuelto). En consumo van
          // las FRACCIONES (v2.18).
          // Ordenados por item_id: el backend v2.25 ya no rompe por orden,
          // pero mandarlos estables nos deja a salvo de una versión vieja.
          ...(mesa.division_mode === 'consumo'
            ? {
                items: [...selected.entries()]
                  .map(([item_id, fraction_bps]) => ({ item_id, fraction_bps }))
                  .sort((a, b) => a.item_id.localeCompare(b.item_id)),
              }
            : { item_ids: [...selected.keys()].sort() }),
          ...(lockTokens.length > 0 && { lock_tokens: lockTokens }),
          ...(tipMode === 'custom' ? { tip_cents: tipCents } : { tip_bps: tipPct * 100 }),
          ...(staffId && { tip_to_staff_id: staffId }),
          ...(stripePmId && { stripe_payment_method_id: stripePmId }),
          ...(savedPmId && { payment_method_id: savedPmId }),
          ...(savingNewCard && { save_payment_method: true }),
          // El pm_ de utilería de Apple/Google Pay es SOLO del mock: contra el
          // backend real haría fallar el clonado a la cuenta conectada (alarma
          // connect_pm_clone_failed) y degradaría el pivote en silencio.
          ...(IS_MOCK &&
            payType !== 'card' &&
            payType !== 'wallet' && { stripe_payment_method_id: 'pm_mock_walletpay' }),
          idempotency_key: idempotencyKey,
      };
      sentBody = body;
      await prepareMonetaryRequest(scope, `mesa_pay:${code}`, intent, body);
      const r = await api.payMesa(code, body, guestToken, payExpectationFor(mesa, body), intent);
      await handlePayResponse(r, scope, intent, body);
    } catch (err) {
      const { code: ec, extra, status } = extractApiError(err);
      // B-06, la decisión central: si el intento MURIÓ (el backend ya liberó
      // el casillero o el ítem), se rota y el reintento arranca de cero. Si
      // el error es AMBIGUO —red caída, respuesta perdida, timeout— se
      // CONSERVA la clave Y se CONGELA el pago: el reintento cae en el replay
      // del backend en vez de cobrar de nuevo, y hasta entonces no se puede
      // cambiar nada (cambiar algo generaría clave nueva = doble cobro).
      const definitivo = shouldRotateOnError(ec, status);
      if (intent && definitivo) {
        await completeMonetaryIntent(scope, `mesa_pay:${code}`, intent);
        unfreezePay(intent);
      }
      if (ec === 'monetary_family_reconciliation_required') {
        setError('El pago pertenece a una sesión anterior. No lo reenviamos ni iniciamos otro hasta reconciliarlo.');
      } else if (ec === 'idempotency_key_terminal') {
        // El backend usa 409 tanto para conflicto VIVO como para intento
        // terminal. Este último sí murió: conservar su clave deja al usuario
        // reintentando el mismo 409 para siempre.
        if (intent) {
          await completeMonetaryIntent(scope, `mesa_pay:${code}`, intent);
          unfreezePay(intent);
        }
        setError('Ese intento de pago ya no sirve. Probá de nuevo.');
        reload();
      } else if (ec === 'monetary_generation_stale') {
        setError('Otra pestaña ya cerró este intento. Actualizamos la mesa antes de permitir una nueva acción.');
        reload();
      } else if (ec === 'idempotency_conflict') {
        // Hay un intento VIVO con otro payload. Rotar acá sería el doble
        // cobro; se congela en el scope que el backend ya conoce.
        if (intent) freezePay(scope, intent, sentBody ?? frozen?.payload);
        setError('Tenés un pago sin confirmar en esta mesa. Reintentá ese mismo pago antes de cambiar nada.');
        reload();
      } else if (ec === 'insufficient_funds') {
        const available = typeof extra.available === 'number' ? extra.available : 0;
        setError(
          // Sin riel saldo, "Cargá saldo" manda a #/cargar, que responde con la
          // pantalla de bloqueo: sería empujar a una ruta muerta.
          walletRailEnabled
            ? `Saldo insuficiente: tenés ${formatMXN(available)} disponibles y necesitás ${formatMXN(gross)}. Cargá saldo o pagá con tarjeta.`
            : `Saldo insuficiente: tenés ${formatMXN(available)} disponibles y necesitás ${formatMXN(gross)}. Pagá con tarjeta.`,
        );
      } else if (ec === 'wallet_requires_auth') {
        setError(
          walletRailEnabled
            ? 'Para pagar con saldo PayMe tenés que iniciar sesión.'
            : 'Ese método de pago no está disponible. Pagá con tarjeta.',
        );
      } else if (ec === 'mesa_not_payable') {
        setError('La mesa ya cerró.');
        reload();
      } else if (ec === 'no_slots_available') {
        setError('Ya no quedan partes por pagar en esta mesa.');
        reload();
      } else if (definitivo) {
        // 4xx sin código propio: el backend dijo que NO y ya liberó lo tomado.
        // La clave se rotó arriba, así que reintentar arranca de cero.
        setError('No pudimos completar el pago. Revisá la mesa y probá de nuevo.');
        reload();
      } else {
        // Error ambiguo (5xx, red, timeout): puede que el cobro SÍ haya salido.
        // Se CONGELA el pago con esta clave: el reintento cae en el replay del
        // backend, y hasta resolverlo no se puede cambiar nada (cualquier
        // cambio generaría clave nueva y cobraría de nuevo). La mesa se
        // recarga solo para mostrar estado; ningún agregado cierra el intento.
        if (intent) freezePay(scope, intent, sentBody ?? frozen?.payload);
        setError('No pudimos confirmar el pago. Puede que se haya cobrado igual: reintentá ESTE mismo pago, no armes otro.');
        reload();
      }
      setBusy(false);
    } finally {
      payInFlightRef.current.leave();
    }
  }

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
        {'Te invitaron a'}
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
          ← Volver a mi cuenta
        </button>
      )}
    </div>
  );

  // ─── Mesa cerrada (A-2) ──────────────────────────────────
  if (!payable && view === 'detail') {
    const closure = mesaClosureView(mesa.status);
    // Solo `completed` acredita cierre/dispersión. fully_paid y settled son
    // avances reales, pero no prueban qué recibió el restaurante.
    if (!closure.completed) {
      return (
        <div className="screen">
          <TopBar title={closure.title} onBack={isGuest ? undefined : () => navigate('mesas')} />
          {guestHeader}
          <div className="empty">{closure.detail}</div>
          <div className="action-bar"><button className="btn btn-navy" onClick={() => reload()}>Actualizar estado</button></div>
        </div>
      );
    }
    const shortfall = Math.max(0, mesa.total_cents - mesa.paid_amount_cents);
    const isOpener = mesa.my_role === 'opener';
    return (
      <div className="screen">
        <TopBar
          title="Cierre completado"
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
            {/* Connect: con tarjeta el merchant of record es el RESTAURANTE. */}
            {result.chargedByRestaurant && (
              <div className="receipt-row">
                <span className="lbl">Cobrado por</span>
                <span className="val">{mesa.restaurant.name}</span>
              </div>
            )}
            {result.chargedByRestaurant && result.statementDescriptor && (
              <div className="caption" style={{ marginTop: -4, marginBottom: 8 }}>
                En tu resumen de tarjeta vas a ver{' '}
                <b style={{ color: 'var(--navy)', fontFamily: 'monospace' }}>
                  {result.statementDescriptor}
                </b>
              </div>
            )}
            {/* G-11: el aviso vive ACÁ y no en un toast — el toast se pisaba
                con la animación de "Cobrando…" y se apagaba antes de que el
                comensal llegara al comprobante. */}
            {result.saveOmitidoPorConnect && (
              <div className="caption" style={{ marginTop: -4, marginBottom: 8 }}>
                En este restaurante la tarjeta no se guarda. Podés guardarla desde{' '}
                <b style={{ color: 'var(--navy)' }}>Cuenta</b>.
              </div>
            )}
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
                onClick={() => { setView('detail'); setSelected(new Map()); reload(); }}
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
              {frozenRequiresReconciliation ? 'Reconciliación necesaria' : frozenScope ? 'Pendiente de confirmar' : 'Pagás SOLO tu parte'}
            </div>
            {/* Con un intento congelado, el monto de la pantalla NO es el del
                pago que quedó en el aire (tras una recarga la selección
                arranca vacía). Mostrarlo sería mentir sobre lo que se reenvía. */}
            {frozenScope ? (
              <>
                <div style={{ fontSize: 'var(--fs-xl)', fontWeight: 800, color: '#fff' }}>
                  Pago sin confirmar
                </div>
                <div style={{ fontSize: 'var(--fs-xs)', color: 'rgba(255,255,255,0.75)', marginTop: 4, fontFamily: 'var(--font-body)' }}>
                  {frozenRequiresReconciliation
                    ? 'No podemos reenviar este pago desde la sesión actual. No iniciaremos otro hasta reconciliarlo.'
                    : 'Reintentalo para saber si se cobró: mandamos el mismo pago, no uno nuevo.'}
                </div>
                {/* N-07: la salida. Antes este estado no tenía ninguna y el
                    área quedaba bloqueada para siempre. Se resuelve con la
                    evidencia del backend, nunca con un TTL. */}
                {frozenRequiresReconciliation && reconcileVerdict !== 'absent' && (
                  <button
                    className="btn btn-sm"
                    style={{ background: 'rgba(255,255,255,0.18)', color: '#fff', marginTop: 12 }}
                    onClick={() => void checkReconciliation()}
                    disabled={reconciling}
                  >
                    {reconciling ? 'Consultando…' : 'Revisar si se cobró'}
                  </button>
                )}
                {frozenRequiresReconciliation && reconcileVerdict === 'absent' && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 'var(--fs-xs)', color: '#fff', fontFamily: 'var(--font-body)' }}>
                      No encontramos ese pago en la mesa: no llegó a tomar tu parte. Si continuás,
                      el próximo intento es un <b>cobro nuevo</b>.
                    </div>
                    <button
                      className="btn btn-sm btn-teal"
                      style={{ marginTop: 8 }}
                      onClick={() => void releaseAfterReconciliation()}
                      disabled={reconciling}
                    >
                      {reconciling ? 'Cerrando…' : 'Entiendo, desbloquear el pago'}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <>
                <div style={{ fontSize: 'var(--fs-3xl)', fontWeight: 800, color: '#fff' }}>{formatMXN(gross)}</div>
                <div style={{ fontSize: 'var(--fs-xs)', color: 'rgba(255,255,255,0.75)', marginTop: 4, fontFamily: 'var(--font-body)' }}>
                  {mesa.division_mode === 'igual' ? 'Tu parte' : 'Tus consumos'} {formatMXN(itemsAmount)} + propina {formatMXN(tipCents)}
                </div>
              </>
            )}
          </div>
          {/* N-08: este dispositivo ya pagó una parte de esta mesa, por esta
              identidad o por la otra puerta (invitado/autenticado). No se
              bloquea —pagar varias partes es legítimo— pero se confirma. */}
          {showExtraPartConfirm && (
            <div className="note note-orange" role="alertdialog" aria-label="Confirmar parte adicional">
              <b>Desde este teléfono ya se pagó una parte de esta mesa.</b>{' '}
              {mySlotsTaken > 0
                ? 'Tu parte ya figura pagada.'
                : 'Fue con otra sesión (link de invitado o tu cuenta).'}{' '}
              Si continuás vas a pagar una parte <b>adicional</b>, y se cobra aparte.
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <button
                  className="btn btn-sm btn-teal btn-fit"
                  onClick={() => {
                    setCrossActorAcknowledged(true);
                    setShowExtraPartConfirm(false);
                  }}
                >
                  Sí, pagar otra parte
                </button>
                <button
                  className="btn btn-ghost btn-sm btn-fit"
                  onClick={() => setShowExtraPartConfirm(false)}
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          {/* B-06: pago sin confirmar. Se bloquea todo lo que cambiaría el
              payload — con la clave congelada, cambiar algo es cobrar de
              nuevo. El único camino es reintentar ESTE pago. */}
          {frozenScope && (
            <div className="note note-orange" role="status">
              {frozenRequiresReconciliation ? (
                <><b>Hay un pago que no podemos reenviar.</b> Pertenece a una sesión anterior o se perdió su cuerpo exacto al recargar. Sigue bloqueado para evitar un segundo cobro.</>
              ) : (
                <><b>Tenés un pago sin confirmar.</b> Puede que ya se haya cobrado. Reintentalo tal cual está: si ya salió, no te cobramos de nuevo. Hasta resolverlo no podés cambiar propina, método ni consumos.</>
              )}
            </div>
          )}
          {refundedNotice && (
            <div className="note note-amber" role="status">
              Ese pago se te <b>reembolsó</b>. No lo repetimos solos: si querés pagar igual, tocá
              el botón de abajo.
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
                disabled={!!frozenScope}
                role="radio"
                aria-checked={tipMode === 'pct' && tipPct === pct}
              >
                {pct}%
              </button>
            ))}
            <button
              className={`tip-pill ${tipMode === 'custom' ? 'sel' : ''}`}
              onClick={() => setTipMode('custom')}
              disabled={!!frozenScope}
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
                disabled={!!frozenScope}
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
                    disabled={!!frozenScope}
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
          {/* Connect: quién cobra depende del riel, y el front NO lo sabe
              antes de pagar (G-11). Este texto es verdadero en los dos: el
              cobro es de la cuenta del restaurante y PayMe divide. El
              "Cobrado por" del comprobante sí lo afirma, ya con la respuesta. */}
          {payType !== 'wallet' && (
            <div className="caption" style={{ marginTop: -6, marginBottom: 10 }}>
              Estás pagando tu parte en{' '}
              <b style={{ color: 'var(--navy)' }}>{mesa.restaurant.name}</b> — PayMe divide la
              cuenta.
            </div>
          )}
          <div role="radiogroup" aria-labelledby="lbl-metodo">
            {!isGuest && walletRailEnabled && (
              <button
                className={`method-card ${payType === 'wallet' ? 'sel' : ''}`}
                onClick={() => setPayType('wallet')}
                disabled={!!frozenScope}
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
              disabled={!!frozenScope}
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
            {payType === 'card' && cards.length > 0 && cardsOpen && (
              <div role="radiogroup" aria-label="Tarjeta guardada" style={{ margin: '2px 0 4px' }}>
                {cards.map((c) => (
                  <button
                    key={c.id}
                    className={`method-card ${cardChoice === c.id ? 'sel' : ''}`}
                    onClick={() => setCardChoice(c.id)}
                    disabled={!!frozenScope}
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
                  disabled={!!frozenScope}
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
            {payType === 'card' && (cards.length === 0 || (cardChoice === 'new' && cardsOpen)) && (
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
                      disabled={!!frozenScope}
                      onChange={(e) => setSaveCard(e.target.checked)}
                    />
                    Guardar esta tarjeta para la próxima
                  </label>
                )}
              </div>
            )}
            {/* Apple/Google Pay: apagados hasta que exista la integración con
                la Payment Request API y su prueba física. No se borran: se
                apagan por dato (`WALLET_PAY_ENABLED` en api/index.ts). */}
            {WALLET_PAY_ENABLED && (
            <button
              className={`method-card ${payType === 'apple_pay' ? 'sel' : ''}`}
              onClick={() => setPayType('apple_pay')}
              disabled={!!frozenScope}
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
            )}
            {WALLET_PAY_ENABLED && (
            <button
              className={`method-card ${payType === 'google_pay' ? 'sel' : ''}`}
              onClick={() => setPayType('google_pay')}
              disabled={!!frozenScope}
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
            )}
          </div>
          {IS_MOCK && (
            <div className="note note-amber" style={{ marginTop: 6 }}>
              <b>Es una demo:</b> no se cobra nada de verdad y no hay ninguna tarjeta real
              conectada.
            </div>
          )}
          {isGuest && (
            <div className="note note-orange" style={{ marginTop: 6 }}>
              {/* OLA 5C (c): esta nota se lee SIN sesión, por URL pública — es
                  la ruta de más tráfico. Con el riel apagado le anunciaba al
                  comensal un saldo PayMe que no existe. */}
              Sin iniciar sesión pagás con tarjeta{WALLET_PAY_ENABLED ? ' o Apple Pay' : ''}
              {walletRailEnabled ? ' (el saldo PayMe pide cuenta)' : ''}.
            </div>
          )}
        </div>
        <button
          className="cta-float"
          onClick={() => { void (async () => {
            // Reembolsado: volver a pagar es una decisión explícita del
            // usuario, nunca automática (rotar solo = re-cobrar un reembolso).
            if (refundedNotice) {
              setError('Ese intento reembolsado requiere reconciliación antes de iniciar otro pago.');
              return;
            }
            await doPay();
          })();
          }}
          disabled={
            busy ||
            frozenRequiresReconciliation ||
            (!frozenScope && gross === 0) ||
            (!frozenScope &&
              !IS_MOCK &&
              payType === 'card' &&
              (cards.length === 0 || cardChoice === 'new') &&
              !cardState.complete)
          }
        >
          {busy
            ? 'Procesando…'
            : frozenRequiresReconciliation
              ? 'Reconciliación necesaria'
              : frozenScope
              ? 'Reintentar el pago sin confirmar'
              : refundedNotice
                ? `Pagar de nuevo ${formatMXN(gross)}`
                : `Pagar ${formatMXN(gross)}`}
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
      onClick={() => void copyInvitationLink()}
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
          {/* B-06: el pago quedó sin confirmar. Un toast al tocar un ítem se
              pierde; acá queda a la vista, con el camino de vuelta. */}
          {frozenScope && (
            <div style={{ padding: '12px 16px 0' }}>
              <div className="note note-orange" role="status">
                <b>Tenés un pago sin confirmar.</b> Puede que ya se haya cobrado. Reintentalo tal
                cual antes de cambiar tu selección.
                <button
                  className="btn btn-ghost btn-sm btn-fit"
                  style={{ marginTop: 8 }}
                  onClick={() => setView('pay')}
                >
                  Reintentar ese pago
                </button>
              </div>
            </div>
          )}
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
          {/* T-F1: el organizador puede invitar amigos in-app también acá —
              la pantalla de compartir post-crear se ve UNA sola vez. */}
          {!isGuest && mesa.my_role === 'opener' && (mesa.status === 'open' || mesa.status === 'partially_paid') && (
            <div style={{ padding: '4px 16px 0' }}>
              {inviteOpen ? (
                <InviteFriends code={code} />
              ) : (
                <button className="btn btn-ghost btn-sm btn-fit" onClick={() => setInviteOpen(true)}>
                  <Icon name="users" size={16} className="ico-inline" /> Invitar amigos de PayMe
                </button>
              )}
            </div>
          )}
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
            {/* B-06: el pago quedó sin confirmar. Un toast al tocar un ítem se
                pierde; acá queda a la vista, con el camino de vuelta. */}
              {frozenScope && (
              <div style={{ padding: '12px 16px 0' }}>
                <div className="note note-orange" role="status">
                  <b>Tenés un pago sin confirmar.</b> Puede que ya se haya cobrado. Reintentalo tal
                  cual antes de cambiar tu selección.
                  <button
                    className="btn btn-ghost btn-sm btn-fit"
                    style={{ marginTop: 8 }}
                    onClick={() => setView('pay')}
                  >
                    Reintentar ese pago
                  </button>
                </div>
              </div>
            )}
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
            {/* v2.25 §4.3 (B-06): `claimed_by_me` es lo único que le permite al
                comensal ver que su parte YA está tomada. Sin esto volvía, veía
                casilleros libres y pagaba de nuevo — llevándose el de otro.
                No se bloquea: pagar más de una parte es legítimo (acta
                2026-07-25), pero tiene que ser una decisión, no un accidente. */}
            {mySlotsTaken > 0 && (
              <div className="note note-teal" style={{ marginTop: 8 }}>
                <b>Ya pagaste {mySlotsTaken === 1 ? 'tu parte' : `${mySlotsTaken} partes`} ✓</b>
                {availableSlots > 0 && ' Si tocás pagar de nuevo, cubrís la parte de otro comensal.'}
              </div>
            )}
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
                : mySlotsTaken > 0
                  ? `Pagar otra parte → ${formatMXN(itemsAmount)}`
                  : `Pagar mi parte → ${formatMXN(itemsAmount)}`}
          </button>
        </>
      )}
    </div>
  );
}
