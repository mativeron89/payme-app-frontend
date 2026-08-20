import { Component, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useIdioma } from '../i18n/idioma';
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
import { canUseCardRail, useMoneyRail } from '../api/moneyRail';
import { isDefinitiveMutationError, isServiceUnavailable } from '../api/mutationRetry';
import { mesaClosureView, mesaPaymentOutcome } from '../api/paymentStatus';
import { payableEqualSlotAmounts, type PayMesaExpectation } from '../api/moneyGuards';
import { confirmCardPayment, createCardPaymentMethod } from '../api/stripe';
import {
  CARD_RAIL_UNAVAILABLE_COPY,
  CardField,
  CardRailUnavailable,
  type CardFieldState,
} from '../components/CardField';
import { AppHeader, AppHeaderFlow } from '../components/AppHeader';
import { filaPropina } from './propinaRecibo';
import { AppBottomBar, AppBottomCta } from '../components/AppBottomBar';
import { Icon } from '../components/Icon';
import type {
  FractionRequest,
  MesaDetail,
  PayMesaRequest,
  PayMesaResponse,
  PaymentMethod,
  PaymentType,
} from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { CardBrandChip, TopBar, useToast } from '../components/ui';
import {
  payGate,
  puedeAtribuirTarjeta,
  paymentLanded,
  requiresReconciliation,
} from './freezeMachine';
import { MesaDetailView } from './MesaDetailView';
import { bpsLabel, fraccionInicial, itemsAmountFor } from './mesaItemsView';
import { goBack, navigate } from '../router';
import { formatMXN } from '../utils/format';
import { tipFromBps } from '../utils/money';
import { GUARDAR_TARJETA_DEFAULT } from './saveCardView';
import {
  NO_TIP_CHOSEN,
  TIP_OPTIONS,
  type TipChoice,
  propinaDesmedida,
  sanearMontoPropio,
  tipCentsFor,
  tipIsChosen,
  tipPayloadFor,
  tipScopeToken,
} from './tipSelectorView';
import { createInFlightMutex } from '../utils/inFlight';
import { RequestEpoch } from '../utils/requestEpoch';
import { writeClipboardText } from '../utils/clipboard';

/**
 * Pantalla de mesa (T2/T3/T4): detalle + mis ítems con lock, pago con
 * propina al mesero, procesando → comprobante, y cierre con semántica A-2
 * ("tu garantía cubrió $X"). Sirve para organizador, participante e
 * INVITADO por link (#/mesa/:code?t=token, sin login).
 */

type View = 'detail' | 'pay' | 'confirm';

/**
 * §1.5 bis · fallback: el selector de propina no se pudo MOSTRAR.
 *
 * No es el caso de "no eligió" —ése frena y se resuelve en un toque— sino el
 * que protege el acta: **un control roto no puede impedir un pago.** El cobro
 * continúa con propina 0 (ver `tipPayloadFor`), la nota es informativa y no
 * alarma, y el bloque de mesero no aparece por el gate de `tipCents > 0` que
 * ya existía.
 *
 * Es una clase porque los error boundaries no tienen equivalente en hooks.
 */
class TipSelectorBoundary extends Component<
  { onFail: () => void; fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    // La pantalla necesita SABERLO: con el selector caído el obligatorio no se
    // dispara, porque no habría dónde elegir.
    this.props.onFail();
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/**
 * El selector de propina — `SPEC_APP.md` §1.5 bis.
 *
 * 🔴 **Es un componente propio porque si no el boundary de arriba no sirve
 * para nada.** Medido: con este JSX inline en `MesaScreen`, un error acá
 * explota mientras la PANTALLA arma sus hijos, o sea fuera del subárbol que el
 * boundary observa — y se lleva la pantalla de pago entera, fallback o no.
 * Como hijo, el error queda adentro y el cobro puede continuar con propina 0,
 * que es lo que manda el acta.
 *
 * No tiene estado: la propina la sigue teniendo `MesaScreen`, que es la dueña
 * del pago. Esto sólo dibuja y avisa qué se tocó.
 */
function TipSelector({
  sectionRef,
  tip,
  onChoose,
  customTipStr,
  onCustomChange,
  baseCents,
  participants,
  disabled,
  pending,
  pulse,
  onPulseEnd,
}: {
  sectionRef: React.RefObject<HTMLDivElement>;
  tip: TipChoice;
  onChoose: (tip: TipChoice) => void;
  customTipStr: string;
  onCustomChange: (value: string) => void;
  baseCents: number;
  participants: number;
  disabled: boolean;
  pending: boolean;
  pulse: boolean;
  onPulseEnd: () => void;
}) {
  const { t } = useIdioma();
  return (
    /* 🔴 La distinción "no elegí" vs "elegí 0 %" vive en el MARCO, no en la
       píldora. Si viviera en la píldora, el 0 % necesitaría un estado visual
       propio y quedaría de segunda clase — justo lo que el acta prohíbe. */
    <div
      ref={sectionRef}
      className={`tip-block${pending ? ' tip-block--pending' : ''}${pulse ? ' tip-block--pulse' : ''}`}
      onAnimationEnd={onPulseEnd}
    >
      <div className="sectlabel tip-block-title" id="lbl-propina">
        {pending && <Icon name="warning" size={14} aria-hidden="true" />}
        {pending ? t('Elige tu propina') : t('Tu propina')}
      </div>
      <div className="caption" style={{ margin: '0 2px 8px' }}>
        {t('Tu base:')} {formatMXN(baseCents)} {t('(la cuenta ÷')} {participants})
      </div>
      <div className="tip-row tip-choices" role="radiogroup" aria-labelledby="lbl-propina">
        {TIP_OPTIONS.map((pct) => {
          const elegida = tip.mode === 'pct' && tip.pct === pct;
          return (
            <button
              key={pct}
              className={`tip-pill ${elegida ? 'sel' : ''}`}
              onClick={() => onChoose({ mode: 'pct', pct })}
              disabled={disabled}
              role="radio"
              aria-checked={elegida}
            >
              {pct}%
            </button>
          );
        })}
        <button
          className={`tip-pill tip-pill--otro ${tip.mode === 'custom' ? 'sel' : ''}`}
          onClick={() => onChoose({ mode: 'custom' })}
          disabled={disabled}
          role="radio"
          aria-checked={tip.mode === 'custom'}
        >
          {t('Otro')}
        </button>
      </div>
      {tip.mode === 'custom' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '10px 2px 0' }}>
          <span style={{ fontWeight: 700 }}>$</span>
          <input
            className="input"
            style={{ flex: 1, padding: '10px 12px' }}
            inputMode="decimal"
            placeholder="0.00"
            value={customTipStr}
            onChange={(e) => onCustomChange(sanearMontoPropio(e.target.value))}
            disabled={disabled}
            aria-label={t('Monto de propina a mano')}
          />
        </div>
      )}
    </div>
  );
}

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
  /**
   * Fidelidad tanda 4 · lo que hace falta para el rótulo de la propina, y se
   * captura al pagar porque `tip`/`staffId` se resetean al cerrar el intento.
   * `null` = monto libre (sin porcentaje) o sin destinatario elegido; los dos
   * son estados legítimos y **no se rellenan** (`propinaRecibo.ts`).
   */
  tipPct: number | null;
  tipToName: string | null;
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
  const { t } = useIdioma();
  const moneyRail = useMoneyRail();
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
  /**
   * §1.5 bis · 🔴 LA PROPINA NACE SIN ELEGIR.
   *
   * Acá había `useState(15)` con modo `'pct'`: quien no tocaba el selector
   * pagaba 15 % de su parte y el payload salía con `tip_bps: 1500` como si lo
   * hubiera elegido. **El sistema elegía por la persona, y con su plata.**
   *
   * `TipChoice` ya no puede representar eso: el porcentaje vive adentro de la
   * variante elegida (ver `tipSelectorView.ts`). D7 sigue igual — `'pct'` manda
   * `tip_bps` y lo computa el server; `'custom'` manda `tip_cents`.
   */
  const [tip, setTip] = useState<TipChoice>(NO_TIP_CHOSEN);
  const [customTipStr, setCustomTipStr] = useState('');
  /** El selector no se pudo mostrar: el cobro CONTINÚA con propina 0. */
  const [tipSelectorFailed, setTipSelectorFailed] = useState(false);
  /** El pulso de una sola vez del borde cuando se toca "Pagar" sin elegir. */
  const [tipPulse, setTipPulse] = useState(false);
  const tipSectionRef = useRef<HTMLDivElement | null>(null);
  /**
   * §1.5 bis (2026-08-06) · reconfirmación de propina desmedida (> 3× la
   * base). `tipConfirmedRef` = "esta propina ya fue reconfirmada": expira en
   * cuanto la propina CAMBIA — una confirmación no puede cubrir un monto
   * distinto del que se mostró en el diálogo.
   */
  const [showTipConfirm, setShowTipConfirm] = useState(false);
  const tipConfirmedRef = useRef(false);
  useEffect(() => {
    tipConfirmedRef.current = false;
    setShowTipConfirm(false);
  }, [tip, customTipStr]);
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
  // tarjeta); `saveCard` = checkbox "guardar" — nace DESMARCADO (Mati,
  // 2026-08-06; el porqué vive en `saveCardView.ts`). El invitado sin cuenta
  // no tenía guardadas: siempre tarjeta nueva sin checkbox.
  // (Rama inalcanzable desde v2.32.0 — ver el docblock de `isGuest`.)
  const [cards, setCards] = useState<PaymentMethod[]>([]);
  const [cardChoice, setCardChoice] = useState<string>('new');
  const [saveCard, setSaveCard] = useState(GUARDAR_TARJETA_DEFAULT);
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
    // La mesa nueva también nace sin elegir: acá estaba el segundo `15`.
    setTip(NO_TIP_CHOSEN); setCustomTipStr(''); setStaffId(null);
    setTipSelectorFailed(false); setTipPulse(false);
    setPayType('card'); setCardsOpen(false); setInviteOpen(false); setCards([]);
    shareInFlightRef.current = createInFlightMutex();
    // El reset por mesa vuelve AL DEFAULT, no a un literal propio: acá vivía
    // el segundo `true`, igual que el segundo `15` de la propina.
    setCardChoice('new'); setSaveCard(GUARDAR_TARJETA_DEFAULT); setCardEl(null);
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
          toast(t('La invitación anterior venció. Toca de nuevo para generar otra.'));
          return;
        }
        if (!invitation.link) {
          toast(t('La invitación pudo haberse creado, pero no recibimos el link. Reintenta la misma operación; no generes otra.'));
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
        toast(t('Link de invitación copiado ✓'));
      } catch {
        toast(t('El link ya se generó, pero no se pudo copiar. Toca de nuevo: no vamos a crear otro.'));
      }
    } catch (err) {
      const failure = extractApiError(err);
      const definitive = isDefinitiveMutationError(failure.code, failure.status);
      if (definitive) shareAttemptsRef.current.delete(code);
      toast(
        isServiceUnavailable(failure.status)
          ? t('El servicio no pudo confirmar el link. Reintenta esta misma operación; no generes otra.')
          : definitive
            ? t('No se pudo generar el link')
            : t('No pudimos confirmar el link. Reintenta la misma operación: vamos a reutilizarla.'),
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
          /**
           * 🔴 AF-05 DEL DICTAMEN (2026-08-20) · EN UN REPLAY CONGELADO NO SE
           * ATRIBUYE NINGUNA TARJETA.
           *
           * El cobro estaba bien —el replay reenvía `frozen.payload`, el cuerpo
           * original, y por eso no hay doble cobro—, **pero la pantalla
           * preseleccionaba la tarjeta por defecto**, que puede no ser la del
           * intento congelado. La persona leía «voy a pagar con esta» mientras
           * el reenvío usaba otra. **El dinero estaba bien y el relato no**, y
           * en una pantalla de cobro el relato también importa.
           *
           * Es la misma corrección que la ORDEN 1-B hizo en la garantía: no
           * afirmar una tarjeta que nadie eligió. Acá el matiz es más fino —
           * no es que nadie eligió, es que **eligió otra vez, antes, y no
           * sabemos cuál**.
           */
          const atribuible = puedeAtribuirTarjeta(frozenAttemptRef.current);
          if (def && cardStateRef.current.empty && !payStartedRef.current && atribuible) {
            setCardChoice(def.id);
          }
        })
        .catch(() => { if (alive && identityEpochRef.current.isCurrent(identityEpoch)) setCards([]); });
      return () => { alive = false; };
    }
    return undefined;
  }, [isGuest, guestToken, code]);

  const payable = mesa?.status === 'open' || mesa?.status === 'partially_paid';

  // `FRACTIONS`, `bpsLabel`, `fractionPreview` y esta cuenta viven ahora en
  // `mesaItemsView.ts`: son puras y estaban declaradas adentro del componente,
  // donde no había forma de ejercitarlas sin montar la pantalla entera.
  const itemsAmount = useMemo(() => itemsAmountFor(mesa, selected), [mesa, selected]);

  // D7 (v2.17): la propina es % de tu parte IGUALITARIA (total ÷ N), no de tu
  // consumo. Preview con la réplica exacta de tipFromBps; el cobro real lo
  // computa el server y el comprobante usa SU tip_cents. Sin elección es 0, y
  // por eso la pantalla puede mostrar la base sola en vez de un total inventado.
  const tipCents = mesa
    ? tipCentsFor(tip, {
        totalCents: mesa.total_cents,
        participants: mesa.expected_participants || 1,
        customStr: customTipStr,
      })
    : 0;
  const gross = itemsAmount + tipCents;
  const tipChosen = tipIsChosen(tip);

  function toggleItem(id: string) {
    // B-06: con un pago sin confirmar, cambiar la selección cambiaría el
    // payload de la clave congelada → 409 en el reintento (o, peor, un cobro
    // nuevo). Primero se resuelve ese pago.
    if (frozenRef.current) {
      toast(t('Tienes un pago sin confirmar: resuélvelo antes de cambiar tu selección'));
      return;
    }
    const next = new Map(selected);
    if (next.has(id)) {
      next.delete(id);
    } else {
      const item = mesa?.items.find((i) => i.id === id);
      // ORDEN 1A.3 · acá vivían DOS defaults fabricados —`?? 10000` dos
      // veces— que ante la ausencia del dato preseleccionaban EL PLATO
      // ENTERO: la opción más cara. Ahora, sin `remaining_bps` válido no se
      // selecciona nada; la fila ya se muestra bloqueada por `rowStateOf`.
      const def = fraccionInicial(item?.remaining_bps);
      if (def === null) {
        toast(t('No pudimos leer cuánto queda de ese ítem. Actualiza la mesa.'));
        return;
      }
      next.set(id, def);
    }
    setSelected(next);
  }

  function setFraction(id: string, bps: number) {
    if (frozenRef.current) {
      toast(t('Tienes un pago sin confirmar: resuélvelo antes de cambiar tu selección'));
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
          toast(rem > 0 ? t('De ese plato queda solo {0}', bpsLabel(rem)) : t('Ese plato ya está completo'));
          const itemId = typeof extra.item_id === 'string' ? extra.item_id : null;
          if (itemId) {
            const next = new Map(selected);
            next.delete(itemId);
            setSelected(next);
          }
          reload();
        } else if (ec === 'item_already_locked' || ec === 'item_already_paid') {
          toast(t('Alguien ya tomó uno de esos consumos'));
          const itemId = typeof extra.item_id === 'string' ? extra.item_id : null;
          if (itemId) {
            const next = new Map(selected);
            next.delete(itemId);
            setSelected(next);
          }
          reload();
        } else {
          toast(t('No pudimos reservar lo que elegiste'));
        }
      } finally {
        setBusy(false);
      }
    } else {
      // Partes iguales (H-14, auditoría 2026-08-06): marcar lo consumido es
      // INFORMACIÓN para el restaurante — la propia pantalla dice "no cambia
      // lo que pagás" — y por eso NO condiciona el pago. El guard viejo
      // (`selected.size === 0 → return`) era el mismo gate contradictorio que
      // el `disabled` de la barra, en su segundo lugar. El contrato acompaña:
      // `payMesa` acepta `item_ids: []` (schemas/index.js:233, default []).
      setView('pay');
    }
  }

  /** Comprobante en texto plano para enviar/descargar (contabilidad). */
  function receiptText(): string {
    if (!mesa || !result) return '';
    return [
      t('Comprobante PayMe'),
      t('Restaurante: {0}', mesa.restaurant.name),
      t('Mesa: {0}', code),
      t('Fecha: {0}', new Date().toLocaleString('es-MX')),
      t('Método: {0}', result.methodLabel),
      // Connect: con tarjeta el comercio es el restaurante (con saldo, PayMe).
      ...(result.chargedByRestaurant
        ? [
            t('Cobrado por: {0}', mesa.restaurant.name),
            ...(result.statementDescriptor
              ? [t('En tu resumen de tarjeta: {0}', result.statementDescriptor)]
              : []),
          ]
        : []),
      t('{0}: {1}', mesa.division_mode === 'igual' ? t('Mi parte') : t('Mis consumos'), formatMXN(result.itemsAmount)),
      // 🔴 BLOQUEANTE 2 DE CODEX (2026-08-20), y era mío: al arreglar la fila de
      // propina de la VISTA no miré las superficies vecinas del mismo dato.
      // Acá seguía saliendo `Propina (al mesero)` fijo — incluso sin mesero
      // atribuido y con propina CERO—, así que **la misma operación se contaba
      // distinto en pantalla que en el papel que la persona manda o guarda**.
      // Ahora las tres superficies usan LA MISMA función pura del rótulo y la
      // MISMA regla de omisión, y hay un caso que lo fija.
      ...(() => {
        const r = filaPropina(result.tip, { pct: result.tipPct, nombre: result.tipToName });
        return r ? [t('{0}: {1}', t(r.clave, ...r.args), formatMXN(result.tip))] : [];
      })(),
      t('Total pagado: {0}', formatMXN(result.gross)),
    ].join('\n');
  }

  async function shareReceipt() {
    const text = receiptText();
    try {
      if (navigator.share) {
        await navigator.share({ title: t('Comprobante PayMe'), text });
        return;
      }
      const copied = await writeClipboardText(text);
      toast(copied
        ? t('Comprobante copiado ✓')
        : t('No se pudo copiar: tu navegador no habilitó el portapapeles'));
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
    // §1.5 bis: el token sale del MISMO payload que se manda, no del estado de
    // la UI. Las formas `b<bps>` y `c<centavos>` no se mueven.
    const tipToken = tipScopeToken(tipPayloadFor(tip, tipCents));
    return `pay:${code}|${payType}|${cardChoice}|${sel}|${tipToken}|${staffId ?? '-'}`;
  }, [code, mesa?.division_mode, selected, tip, tipCents, payType, cardChoice, staffId]);
  const contentScope = actor ? scopeForActor(actor, rawContentScope) : '';

  /**
   * Intento sin confirmar (error ambiguo). Mientras exista, el pago queda
   * CONGELADO en ese scope: no se puede cambiar nada y el único camino es
   * reintentar el mismo pago, que el backend replaya en vez de re-cobrar.
   */
  const payArea = actor ? scopeForActor(actor, `pay:${code}`) : '';
  const [frozen, setFrozen] = useState<UnconfirmedAttempt | null>(null);
  /**
   * El INTENTO congelado, no su scope. `frozenRef` guarda el scope (un string)
   * y es otra cosa: usarla para decidir la atribución visual habría comparado
   * la cosa equivocada. Existe porque el efecto que carga tarjetas corre antes
   * de esta declaración y necesita el valor vigente, no el del primer render.
   */
  const frozenAttemptRef = useRef<UnconfirmedAttempt | null>(null);
  useEffect(() => { frozenAttemptRef.current = frozen; }, [frozen]);
  useEffect(() => {
    if (!payArea) return;
    let alive = true;
    const identityEpoch = identityEpochRef.current.capture();
    void readUnconfirmed(payArea, `mesa_pay:${code}`)
      .then((attempt) => {
        if (!alive || !identityEpochRef.current.isCurrent(identityEpoch)) return;
        setFrozen(attempt);
        if (attempt?.reconciliationRequired) {
          setError(t('Hay un pago de una sesión anterior. No vamos a reenviarlo ni iniciar otro hasta reconciliarlo.'));
        }
      })
      .catch(() => alive && identityEpochRef.current.isCurrent(identityEpoch) && setError(t('Hay un pago anterior que no podemos atribuir de forma segura. Espera la reconciliación antes de pagar.')));
    return () => { alive = false; };
  }, [payArea, code]);
  useEffect(() => { setFrozen(null); }, [guestToken, code]);
  const frozenScope = frozen?.scope ?? null;
  const cardRailAvailable = canUseCardRail(moneyRail, !!frozenScope);
  // La decisión vive en `freezeMachine.ts`, que sí tiene cobertura: acá sólo
  // se consume. Antes era lógica inline sin un solo test.
  const frozenRequiresReconciliation = requiresReconciliation(frozen);
  const payScope = frozenScope ?? contentScope;
  const frozenRef = useRef(frozenScope);
  frozenRef.current = frozenScope;

  /**
   * §1.5 bis · falta elegir la propina, y hay dónde hacerlo.
   *
   * 🔴 Las dos exclusiones no son detalles:
   * - **Selector caído** (`tipSelectorFailed`): el acta manda que el cobro
   *   continúe. Pedir una elección sin control dónde hacerla es encerrar a la
   *   persona con la tarjeta en la mano.
   * - **Pago congelado** (B-06): la propina ya viajó dentro de la clave de
   *   idempotencia de ese intento. Pedir que se elija de nuevo sería pedir
   *   cambiar algo que ya no se puede cambiar — el selector va `disabled`.
   */
  const tipPending = !tipChosen && !tipSelectorFailed && !frozenScope;

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
        toast(t('Ese pago ya está registrado ✓'));
      } else {
        // No se libera solo: el usuario tiene que decidirlo viendo el aviso.
        setReconcileVerdict('absent');
      }
    } catch {
      setError(t('No pudimos consultar el estado de la mesa. Prueba de nuevo en un momento.'));
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
      toast(t('Listo: puedes pagar de nuevo'));
    } catch {
      setError(t('No pudimos cerrar ese intento. Sigue bloqueado por seguridad.'));
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
    // Acá vivía `savingNewCard`, que sólo alimentaba el aviso de guardado
    // omitido — retirado con el cierre de G-11 (v2.46.0).
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
      setError(t('Ese pago se cobró y después te lo reembolsaron. No volvimos a cobrarte.'));
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
          setError(t('Se cortó la conexión mientras el banco confirmaba. No reintentes con otro método: toca "Reintentar el pago sin confirmar".'));
        }
        setBusy(false);
        reload();
        return;
      }
      // La aprobación de Stripe no acredita sola el pago en PayMe. Esperamos
      // el estado del backend y conservamos key/payload mientras tanto.
      freezePay(scope, intent, body);
      setError(t('Tu banco aprobó la operación; todavía estamos confirmando el pago. Reintenta esta misma confirmación, sin cambiar el método.'));
      setBusy(false);
      reload();
      return;
    }
    const outcome = mesaPaymentOutcome(at.status);
    if (outcome === 'definitive') {
      await completeMonetaryIntent(scope, `mesa_pay:${code}`, intent);
      unfreezePay(intent);
      setError(t('Ese pago no prosperó. Puedes iniciar uno nuevo.'));
      setBusy(false);
      reload();
      return;
    }
    if (outcome !== 'success') {
      // pending/requires_action/processing, shapes incompletos y estados
      // nuevos no son acreditación. Se conserva el intento para reconciliar.
      freezePay(scope, intent, body);
      setError(t('Estamos confirmando este pago. No inicies otro ni cambies el método hasta que se resuelva.'));
      setBusy(false);
      reload();
      return;
    }
    const methodLabel =
      payKind === 'wallet'
        ? 'Saldo PayMe'
        : payKind === 'apple_pay'
          ? t('Apple Pay')
          : payKind === 'google_pay'
            ? t('Ⓖ Google Pay')
            : `${savedCard ? t('{0} ··{1}', savedCard.brand === 'visa' ? t('Visa') : savedCard.brand, savedCard.last_four) : t('Tarjeta')}`;
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
      statementDescriptor: r.attempt.statement_descriptor ?? null,
      // 🔴 Se capturan ACÁ, no se leen al pintar el comprobante: `tip` y
      // `staffId` se resetean al cerrar el intento, así que leerlos después
      // daría un comprobante sin porcentaje ni nombre — y el comprobante es
      // el papel que la persona guarda.
      tipPct: tip.mode === 'pct' ? tip.pct : null,
      tipToName: mesa?.active_staff.find((x) => x.id === staffId)?.display_name ?? null,
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
      setError(actorError ? t('No pudimos verificar una identidad segura para este pago.') : t('Preparando una identidad segura para este pago…'));
      payInFlightRef.current.leave();
      return;
    }
    if (frozenRequiresReconciliation) {
      setError(t('Este pago no puede reenviarse desde la sesión actual. Sigue bloqueado hasta reconciliar su resultado.'));
      payInFlightRef.current.leave();
      return;
    }
    /**
     * §1.5 bis · el obligatorio. **No se envía nada** y no se deja a nadie
     * atrapado: el CTA sigue activo —un botón gris se lee como error del
     * sistema, no como "te falta un paso"— y acá se avisa, se lleva el ojo al
     * selector y el borde pulsa una vez. Elegir es un toque, y el 0 % está ahí.
     */
    if (tipPending) {
      toast(t('Elige tu propina para pagar'));
      // `scrollIntoView` es opcional a propósito: si el navegador no lo tiene,
      // el toast y el pulso siguen siendo la señal.
      tipSectionRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
      setTipPulse(true);
      payInFlightRef.current.leave();
      return;
    }
    /**
     * §1.5 bis (2026-08-06) · propina desmedida: > 3× la base del emisor.
     * Chequeo SECUENCIAL — corre después del de "sin elegir", no en su
     * lugar — y NO es el bloqueo que el acta prohíbe: el diálogo siempre
     * tiene "Sí, pagar". Quien quiere dejar una propina enorme a propósito,
     * puede — con un toque más.
     */
    if (mesa && !tipConfirmedRef.current && propinaDesmedida(tipCents, mesa.tip_base_cents)) {
      setShowTipConfirm(true);
      payInFlightRef.current.leave();
      return;
    }
    /**
     * 🔴 AF-04 DEL DICTAMEN (2026-08-20): `payGate` estaba **probado como
     * primitiva y no lo consumía nadie** — el flujo productivo recomponía las
     * guardas en línea. Dos definiciones de la misma regla, y sólo una
     * cubierta por tests: la que no corre.
     *
     * **La conversión PRESERVA la conducta, y eso se midió antes de tocar:**
     * `frozenView` tiene tres salidas y **todo congelado o pide reconciliación
     * o es replayable** (`freezeMachine.ts:26-30`), así que un intento
     * congelado nunca caía en la rama de confirmación — el `!frozen &&` de
     * antes daba el mismo resultado que el orden de ramas de `payGate`.
     *
     * Lo que SÍ agrega es defensa en profundidad: `no_actor` y
     * `frozen_reconcile` se verifican **acá también**, no sólo en el
     * `disabled` del botón. Un `disabled` es una afirmación sobre la UI; esto
     * es la puerta del cobro.
     */
    const puerta = payGate({
      hasActor: !!actor,
      frozen,
      acknowledged: crossActorAcknowledged,
      crossActorIntent: crossActor,
      mySlotsTaken,
    });
    if (!puerta.allowed) {
      if (puerta.reason === 'confirm_extra_part') {
        // N-08: no se emite una clave nueva sobre una mesa donde este
        // dispositivo (o esta identidad) ya tiene un pago, sin confirmación.
        setError(null);
        setShowExtraPartConfirm(true);
      } else if (puerta.reason === 'frozen_reconcile') {
        setError(t('Hay un pago anterior que no podemos atribuir de forma segura. Espera la reconciliación antes de pagar.'));
      } else {
        setError(t('No pudimos identificar tu sesión para pagar. Vuelve a entrar.'));
      }
      payInFlightRef.current.leave();
      return;
    }
    if (payType === 'card' && !cardRailAvailable) {
      setError(t(CARD_RAIL_UNAVAILABLE_COPY));
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
            setError(t('Ingresa los datos de la tarjeta para continuar.'));
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
          // §1.5 bis: el mismo payload del que sale el token del scope. Sin
          // elección sólo se llega acá por el fallback, y ahí va `tip_bps: 0`.
          ...tipPayloadFor(tip, tipCents),
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
        setError(t('El pago pertenece a una sesión anterior. No lo reenviamos ni iniciamos otro hasta reconciliarlo.'));
      } else if (ec === 'idempotency_key_terminal') {
        // El backend usa 409 tanto para conflicto VIVO como para intento
        // terminal. Este último sí murió: conservar su clave deja al usuario
        // reintentando el mismo 409 para siempre.
        if (intent) {
          await completeMonetaryIntent(scope, `mesa_pay:${code}`, intent);
          unfreezePay(intent);
        }
        setError(t('Ese intento de pago ya no sirve. Prueba de nuevo.'));
        reload();
      } else if (ec === 'monetary_generation_stale') {
        setError(t('Otra pestaña ya cerró este intento. Actualizamos la mesa antes de permitir una nueva acción.'));
        reload();
      } else if (ec === 'idempotency_conflict') {
        // Hay un intento VIVO con otro payload. Rotar acá sería el doble
        // cobro; se congela en el scope que el backend ya conoce.
        if (intent) freezePay(scope, intent, sentBody ?? frozen?.payload);
        setError(t('Tienes un pago sin confirmar en esta mesa. Reintenta ese mismo pago antes de cambiar nada.'));
        reload();
      } else if (ec === 'insufficient_funds') {
        const available = typeof extra.available === 'number' ? extra.available : 0;
        setError(
          // Sin riel saldo, "Cargá saldo" manda a #/cargar, que responde con la
          // pantalla de bloqueo: sería empujar a una ruta muerta.
          walletRailEnabled
            ? `Saldo insuficiente: tienes ${formatMXN(available)} disponibles y necesitas ${formatMXN(gross)}. Carga saldo o paga con tarjeta.`
            : `Saldo insuficiente: tienes ${formatMXN(available)} disponibles y necesitas ${formatMXN(gross)}. Paga con tarjeta.`,
        );
      } else if (ec === 'wallet_requires_auth') {
        setError(
          walletRailEnabled
            ? 'Para pagar con saldo PayMe tienes que iniciar sesión.'
            : t('Ese método de pago no está disponible. Paga con tarjeta.'),
        );
      } else if (ec === 'mesa_not_payable') {
        setError(t('La mesa ya cerró.'));
        reload();
      } else if (ec === 'no_slots_available') {
        setError(t('Ya no quedan partes por pagar en esta mesa.'));
        reload();
      } else if (definitivo) {
        // 4xx sin código propio: el backend dijo que NO y ya liberó lo tomado.
        // La clave se rotó arriba, así que reintentar arranca de cero.
        setError(t('No pudimos completar el pago. Revisa la mesa y prueba de nuevo.'));
        reload();
      } else {
        // Error ambiguo (5xx, red, timeout): puede que el cobro SÍ haya salido.
        // Se CONGELA el pago con esta clave: el reintento cae en el replay del
        // backend, y hasta resolverlo no se puede cambiar nada (cualquier
        // cambio generaría clave nueva y cobraría de nuevo). La mesa se
        // recarga solo para mostrar estado; ningún agregado cierra el intento.
        if (intent) freezePay(scope, intent, sentBody ?? frozen?.payload);
        setError(t('No pudimos confirmar el pago. Puede que se haya cobrado igual: reintenta ESTE mismo pago, no armes otro.'));
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
        <TopBar title={t('Mesa')} onBack={isGuest ? undefined : () => goBack('mesas')} />
        <div className="empty">
          <div className="emoji"><Icon name="search" size={40} /></div>
          {t('No encontramos esta mesa. Puede que el link haya vencido o que ya se haya cerrado la cuenta.')}
          {isGuest && (
            <div style={{ marginTop: 16 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => window.location.reload()}>
                {t('Reintentar')}
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
        <TopBar title={t('Mesa')} onBack={isGuest ? undefined : () => goBack('mesas')} />
        <div className="loading" role="status" aria-live="polite">
          {t('Cargando mesa…')}
        </div>
      </div>
    );
  }
  const guestHeader = isGuest && (
    <div style={{ background: 'var(--teal-l)', padding: '14px 16px', borderBottom: '1px solid var(--teal)' }}>
      <div className="caption" style={{ color: 'var(--navy)' }}>
        {t('Te invitaron a')}
      </div>
      <div style={{ fontSize: 'var(--fs-legacy-md)', fontWeight: 700 }}>
        {code} · {mesa.restaurant.name}
      </div>
      {previewingAsGuest && (
        <button
          className="login-toggle"
          style={{ padding: '6px 0 0' }}
          onClick={() => navigate('home')}
        >
          {t('← Volver a mi cuenta')}
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
          <div className="action-bar"><button className="btn btn-navy" onClick={() => reload()}>{t('Actualizar estado')}</button></div>
        </div>
      );
    }
    const shortfall = Math.max(0, mesa.total_cents - mesa.paid_amount_cents);
    const isOpener = mesa.my_role === 'opener';
    return (
      <div className="screen">
        <TopBar
          title={t('Cierre completado')}
          onBack={isGuest ? undefined : () => navigate('mesas')}
        />
        {guestHeader}
        <div className="scroll" style={{ padding: '20px 16px' }}>
          <div style={{ textAlign: 'center', padding: '8px 0 18px' }}>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <Icon name={shortfall > 0 ? 'clock' : 'check-circle'} size={40} />
            </div>
            <div className="h2" style={{ marginTop: 8 }}>
              {shortfall > 0 ? t('Se cerró por tiempo') : t('Quedó todo pago')}
            </div>
            <div className="body-text" style={{ marginTop: 6 }}>
              {mesa.restaurant.name} {t('· Mesa')} {code}
            </div>
          </div>
          <div className="card card-p" style={{ marginBottom: 14 }}>
            <div className="receipt-row">
              <span className="lbl">{t('Total mesa')}</span>
              <span className="val">{formatMXN(mesa.total_cents)}</span>
            </div>
            <div className="receipt-row">
              <span className="lbl">{t('Pagado por los comensales')}</span>
              <span className="val" style={{ color: 'var(--green)' }}>
                {formatMXN(mesa.paid_amount_cents)}
              </span>
            </div>
            {shortfall > 0 && (
              <div className="receipt-row">
                <span className="lbl">{isOpener ? t('Cubrió tu garantía') : t('Cubrió la garantía')}</span>
                <span className="val" style={{ color: 'var(--orange-txt)' }}>
                  {formatMXN(shortfall)}
                </span>
              </div>
            )}
            <div className="receipt-row">
              <span className="lbl" style={{ fontWeight: 700, color: 'var(--navy)' }}>
                {t('Recibió el restaurante')}
              </span>
              <span className="val hl">{formatMXN(mesa.total_cents)}</span>
            </div>
          </div>
          {shortfall > 0 && isOpener && (
            <div className="note note-teal">
              <b>{t('Tu garantía cubrió')} {formatMXN(shortfall)}.</b> {t('El restaurante cobró el total y nadie quedó debiendo en la mesa. Pronto vas a poder pedirle ese monto a quien no llegó a pagar.')}
            </div>
          )}
        </div>
        {/* La barra se muestra SIEMPRE: sin esto el invitado quedaba en una
            pantalla de solo lectura sin ninguna salida. */}
        <div className="action-bar">
          {isGuest ? (
            <button className="btn btn-navy" onClick={() => reload()}>
              {t('Actualizar')}
            </button>
          ) : (
            <button className="btn btn-navy" onClick={() => navigate('home')}>
              <Icon name="home" size={16} className="ico-inline" /> {t('Inicio')}
            </button>
          )}
        </div>
      </div>
    );
  }

  // ─── Comprobante ─────────────────────────────────────────
  if (view === 'confirm' && result) {
    return (
      <div className="screen has-appbar">
        {/* 🔴 FIDELIDAD tanda 4 (`724d6fe`) · ① la pantalla arrancaba en el
            vacío, sin cabecera. Va la navy de una fila, como Avisos (§1.8), y
            **sin «Volver»: acá no hay paso atrás al que volver, el pago ya
            pasó.** Un botón de volver sobre un pago hecho promete deshacerlo. */}
        <AppHeader paymeId={session?.user?.payme_id} />
        <div className="scroll" style={{ padding: '24px 20px' }}>
          {/* ② el tilde vivía SUELTO sobre el fondo, arriba de la tarjeta: era
              un cierre partido en dos. Entra a la tarjeta, con el título y el
              subtítulo — un solo bloque. */}
          <div className="recibo-cierre">
            <div className="success-circle">✓</div>
            <h1 className="recibo-cierre-tit">
              {t('¡Listo!')}
            </h1>
            <div className="body-text">
              {t('Pagaste tu parte.')}{' '}
              {mesa.paid_amount_cents < mesa.total_cents ? (
                t('La mesa sigue abierta para los demás.')
              ) : (
                <>
                  {t('La mesa quedó completa.')} <Icon name="party" size={16} className="ico-inline" />
                </>
              )}
            </div>
          </div>
          <div className="card card-p">
            <div className="h2" style={{ fontSize: 'var(--fs-legacy-md)', marginBottom: 12 }}>
              {t('Comprobante')}
            </div>
            <div className="receipt-row">
              <span className="lbl">{t('Restaurante')}</span>
              <span className="val">{mesa.restaurant.name}</span>
            </div>
            <div className="receipt-row">
              <span className="lbl">{t('Mesa')}</span>
              <span className="val">{code}</span>
            </div>
            <div className="receipt-row">
              <span className="lbl">{t('Método')}</span>
              <span className="val">{result.methodLabel}</span>
            </div>
            {/* Connect: con tarjeta el merchant of record es el RESTAURANTE. */}
            {result.chargedByRestaurant && (
              <div className="receipt-row">
                <span className="lbl">{t('Cobrado por')}</span>
                <span className="val">{mesa.restaurant.name}</span>
              </div>
            )}
            {result.chargedByRestaurant && result.statementDescriptor && (
              <div className="caption" style={{ marginTop: -4, marginBottom: 8 }}>
                {t('En tu resumen de tarjeta vas a ver')}{' '}
                <b style={{ color: 'var(--navy)', fontFamily: 'monospace' }}>
                  {result.statementDescriptor}
                </b>
              </div>
            )}
            {/* G-11 CERRADO (backend v2.46.0): acá vivía el aviso "en este
                restaurante la tarjeta no se guarda" — la advertencia posterior
                que nunca corrige una promesa previa. El guardado bajo direct
                charge es real desde 7e45db0 y el workaround se retiró. */}
            <div className="receipt-row">
              <span className="lbl">{mesa.division_mode === 'igual' ? t('Mi parte') : t('Mis consumos')}</span>
              <span className="val">{formatMXN(result.itemsAmount)}</span>
            </div>
            {/* ④ decía «Propina (al mesero)», genérico. Ahora trae el
                porcentaje y el nombre — **los que existan**: con monto libre
                no hay porcentaje y elegir destinatario es opcional. La regla
                vive en `propinaRecibo.ts`: lo que no se sabe, no se nombra.
                Y la fila **no aparece sin propina** (`tip > 0`), en vez de
                mostrar un $0.00 que nadie dejó. */}
            {(() => {
              const r = filaPropina(result.tip, { pct: result.tipPct, nombre: result.tipToName });
              if (!r) return null;
              return (
                <div className="receipt-row">
                  <span className="lbl">{t(r.clave, ...r.args)}</span>
                  <span className="val">{formatMXN(result.tip)}</span>
                </div>
              );
            })()}
            <div className="receipt-row">
              <span className="lbl" style={{ fontWeight: 700, color: 'var(--navy)' }}>
                Total pagado
              </span>
              {/* ③ estaba en `--action-2` sobre blanco: **2.6:1, ilegible**
                  para el número más importante de la pantalla. Va en navy y
                  más grande. */}
              <span className="val recibo-total">{formatMXN(result.gross)}</span>
            </div>
            <div className="recibo-acciones">
              <button type="button" className="linkbtn" onClick={() => void shareReceipt()}>
                <Icon name="share" size={16} className="ico-inline" /> {t('Enviar')}
              </button>
              <button type="button" className="linkbtn" onClick={downloadReceipt}>
                <Icon name="download" size={16} className="ico-inline" /> {t('Descargar')}
              </button>
            </div>
          </div>
          {isGuest && (
            <div className="note note-teal" style={{ marginTop: 14 }}>
              {t('Con una cuenta PayMe puedes abrir la mesa tú la próxima vez.')}
            </div>
          )}
        </div>
        {/* 🔴 ⑤ · UN SOLO PATRÓN EN EL PIE. Había TRES apilados: dos botones
            outline lado a lado y abajo uno navy de ancho completo — el mismo
            defecto que el paquete señala como el que existía ANTES del
            rediseño. «Enviar» y «Descargar» bajan a acciones `--link` al pie
            de la tarjeta del comprobante, **donde está el comprobante que
            accionan**, y el cierre queda en la barra reducida.
            ⚠️ La rama de invitado NO se toca: está durmiente desde v2.32.0 y
            mezclar su retiro con un cambio visual es cómo se cuelan errores. */}
        {isGuest ? (
        <div className="action-bar">
          {(
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn btn-ghost"
                onClick={() => { setView('detail'); setSelected(new Map()); reload(); }}
              >
                {t('Ver la mesa')}
              </button>
              <button className="btn btn-navy" onClick={() => navigate('home')}>
                {t('Crear mi cuenta')}
              </button>
            </div>
          )}
        </div>
        ) : (
          /* El círculo de casa CIERRA el flujo, no lo avanza: es el único
             lugar del paquete donde ese glifo significa terminar. */
          <AppBottomCta label={t('Ir a Inicio')} icon="home" onClick={() => navigate('home')} />
        )}
      </div>
    );
  }

  // ─── Pago (s-payment) ────────────────────────────────────
  if (view === 'pay') {
    return (
      <div className="screen has-appbar">
        {/* 🔴 FIDELIDAD VISUAL (2026-08-20 @ 1b99639 · defectos 1 a 5; el 6
            quedó FRENADO y declarado). Era la misma cabecera blanca de una
            fila que ya se corrigió en Garantía y 3DS. **Sin contador de
            paso:** esta pantalla no es un paso del armado, se vuelve a ella
            mientras la mesa siga abierta.
            🔴 **Y el candado sale**, textual del paquete: *«no es un control
            del sistema»* — un ícono que no hace nada en la pantalla donde se
            paga sugiere una garantía que nadie prometió. */}
        <AppHeaderFlow
          paymeId={session?.user?.payme_id}
          onBack={() => setView('detail')}
          backLabel={t('Volver a la mesa')}
        />
        {guestHeader}
        <div className="scroll" style={{ padding: 16 }}>
          {/* 🔴 Defecto 2: era la MISMA tarjeta navy inventada que ya se sacó
              de Garantía. Pasa a `--teal-l` con texto navy, como todo el
              flujo. Los estilos inline se van a clases: mientras vivían
              inline, ninguna guarda de color los veía. */}
          <div className="pay-title">
            {/* <h1> y no <div>: con la cabecera navy la pantalla se quedaba
                SIN encabezado accesible, que es peor que el defecto de color
                que vino a arreglarse. Mismo patrón que scan, Garantía y 3DS. */}
            <h1 className="pay-title-lbl">
              {frozenRequiresReconciliation ? t('Reconciliación necesaria') : frozenScope ? t('Pendiente de confirmar') : t('Pagas SOLO tu parte')}
            </h1>
            {/* Defecto 3: el contexto del restaurante vive acá, no en la fila
                de método. Es el dato que dice DÓNDE se está pagando. */}
            {mesa?.restaurant?.name && (
              <div className="pay-title-place">
                {mesa.restaurant.name}
                {mesa.restaurant.address ? ` · ${mesa.restaurant.address}` : ''}
              </div>
            )}
            {/* Con un intento congelado, el monto de la pantalla NO es el del
                pago que quedó en el aire (tras una recarga la selección
                arranca vacía). Mostrarlo sería mentir sobre lo que se reenvía. */}
            {frozenScope ? (
              <>
                <div style={{ fontSize: 'var(--fs-legacy-xl)', fontWeight: 800, color: 'var(--action)' }}>
                  {t('Pago sin confirmar')}
                </div>
                <div style={{ fontSize: 'var(--fs-legacy-xs)', color: 'var(--action)', opacity: 0.75, marginTop: 4, fontFamily: 'var(--font-body)' }}>
                  {frozenRequiresReconciliation
                    ? t('No podemos reenviar este pago desde la sesión actual. No iniciaremos otro hasta reconciliarlo.')
                    : t('Reinténtalo para saber si se cobró: mandamos el mismo pago, no uno nuevo.')}
                </div>
                {/* N-07: la salida. Antes este estado no tenía ninguna y el
                    área quedaba bloqueada para siempre. Se resuelve con la
                    evidencia del backend, nunca con un TTL. */}
                {frozenRequiresReconciliation && reconcileVerdict !== 'absent' && (
                  <button
                    className="btn btn-sm"
                    style={{ background: 'rgba(16,30,59,0.10)', color: 'var(--action)', marginTop: 12 }}
                    onClick={() => void checkReconciliation()}
                    disabled={reconciling}
                  >
                    {reconciling ? t('Consultando…') : t('Revisar si se cobró')}
                  </button>
                )}
                {frozenRequiresReconciliation && reconcileVerdict === 'absent' && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 'var(--fs-legacy-xs)', color: 'var(--action)', fontFamily: 'var(--font-body)' }}>
                      {t('No encontramos ese pago en la mesa: no llegó a tomar tu parte. Si continúas, el próximo intento es un')} <b>{t('cobro nuevo')}</b>.
                    </div>
                    <button
                      className="btn btn-sm btn-teal"
                      style={{ marginTop: 8 }}
                      onClick={() => void releaseAfterReconciliation()}
                      disabled={reconciling}
                    >
                      {reconciling ? t('Cerrando…') : t('Entiendo, desbloquear el pago')}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <>
                {/* §1.5 bis · antes de elegir se muestra LA BASE SOLA. Acá
                    salía base + 15 % adivinado: un número en pantalla que la
                    persona no eligió, que es el bug que esto cierra. */}
                <div style={{ fontSize: 'var(--fs-legacy-3xl)', fontWeight: 800, color: 'var(--action)' }}>
                  {formatMXN(tipPending ? itemsAmount : gross)}
                </div>
                <div style={{ fontSize: 'var(--fs-legacy-xs)', color: 'var(--action)', opacity: 0.75, marginTop: 4, fontFamily: 'var(--font-body)' }}>
                  {mesa.division_mode === 'igual' ? t('Tu parte') : t('Tus consumos')} {formatMXN(itemsAmount)}
                  {tipPending ? '' : ` + propina ${formatMXN(tipCents)}`}
                </div>
                {tipPending && (
                  <div style={{ fontSize: 'var(--fs-legacy-xs)', color: 'var(--action)', opacity: 0.75, fontFamily: 'var(--font-body)' }}>
                    {t('+ propina (elige abajo)')}
                  </div>
                )}
              </>
            )}
          </div>
          {/* N-08: este dispositivo ya pagó una parte de esta mesa, por esta
              identidad o por la otra puerta (invitado/autenticado). No se
              bloquea —pagar varias partes es legítimo— pero se confirma. */}
          {/* §1.5 bis · reconfirmación de propina desmedida. Monto exacto +
              comparación, nunca un "¿estás seguro?" genérico. La salida
              afirmativa existe SIEMPRE (el acta prohíbe bloquear); la de
              editar conserva el valor tipeado intacto. */}
          {showTipConfirm && mesa && (
            <div className="note note-orange" role="alertdialog" aria-label={t('Confirmar propina')}>
              <b>{t('Tu propina:')} {formatMXN(tipCents)}.</b> {t('Es más de 3 veces la base de')}{' '}
              {formatMXN(mesa.tip_base_cents)} {t('(la cuenta ÷')} {mesa.expected_participants}).
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <button
                  className="btn btn-sm btn-teal btn-fit"
                  onClick={() => {
                    setShowTipConfirm(false);
                    tipSectionRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
                  }}
                >
                  {t('Volver a editar')}
                </button>
                <button
                  className="btn btn-ghost btn-sm btn-fit"
                  onClick={() => {
                    tipConfirmedRef.current = true;
                    setShowTipConfirm(false);
                    void doPay();
                  }}
                >
                  {t('Sí, pagar')}
                </button>
              </div>
            </div>
          )}
          {showExtraPartConfirm && (
            <div className="note note-orange" role="alertdialog" aria-label={t('Confirmar parte adicional')}>
              <b>{t('Desde este teléfono ya se pagó una parte de esta mesa.')}</b>{' '}
              {mySlotsTaken > 0
                ? t('Tu parte ya figura pagada.')
                : t('Fue con otra sesión (link de invitado o tu cuenta).')}{' '}
              {t('Si continúas vas a pagar una parte')} <b>{t('adicional')}</b>{t(', y se cobra aparte.')}
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <button
                  className="btn btn-sm btn-teal btn-fit"
                  onClick={() => {
                    setCrossActorAcknowledged(true);
                    setShowExtraPartConfirm(false);
                  }}
                >
                  {t('Sí, pagar otra parte')}
                </button>
                <button
                  className="btn btn-ghost btn-sm btn-fit"
                  onClick={() => setShowExtraPartConfirm(false)}
                >
                  {t('Cancelar')}
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
                <><b>{t('Hay un pago que no podemos reenviar.')}</b> {t('Pertenece a una sesión anterior o se perdió su cuerpo exacto al recargar. Sigue bloqueado para evitar un segundo cobro.')}</>
              ) : (
                <><b>{t('Tienes un pago sin confirmar.')}</b> {t('Puede que ya se haya cobrado. Reinténtalo tal cual está: si ya salió, no te cobramos de nuevo. Hasta resolverlo no puedes cambiar propina, método ni consumos.')}</>
              )}
            </div>
          )}
          {refundedNotice && (
            <div className="note note-amber" role="status">
              {t('Ese pago se te')} <b>{t('reembolsó')}</b>{t('. No lo repetimos solos: si quieres pagar igual, toca el botón de abajo.')}
            </div>
          )}
          <TipSelectorBoundary
            onFail={() => setTipSelectorFailed(true)}
            fallback={
              <div
                className="caption"
                style={{ display: 'flex', gap: 6, alignItems: 'flex-start', margin: '0 2px 16px', color: 'var(--text-muted)' }}
                role="status"
              >
                <Icon name="info" size={16} aria-hidden="true" />
                <span>{t('No pudimos cargar las opciones de propina — tu pago sigue sin propina.')}</span>
              </div>
            }
          >
            <TipSelector
              sectionRef={tipSectionRef}
              tip={tip}
              onChoose={setTip}
              customTipStr={customTipStr}
              onCustomChange={setCustomTipStr}
              baseCents={mesa.tip_base_cents}
              participants={mesa.expected_participants || 1}
              disabled={!!frozenScope}
              pending={tipPending}
              pulse={tipPulse}
              onPulseEnd={() => setTipPulse(false)}
            />
          </TipSelectorBoundary>
          {tipCents > 0 && mesa.active_staff.length > 0 && (
            <>
              <div className="sectlabel" id="lbl-mesero">
                {t('¿Para quién?')}
              </div>
              <div className="tip-row" style={{ flexWrap: 'wrap' }} role="group" aria-labelledby="lbl-mesero">
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
            {t('Método')}
          </div>
          {/* Connect: quién cobra depende del riel, y el front NO lo sabe
              antes de pagar (G-11). Este texto es verdadero en los dos: el
              cobro es de la cuenta del restaurante y PayMe divide. El
              "Cobrado por" del comprobante sí lo afirma, ya con la respuesta. */}
          {payType !== 'wallet' && (
            <div className="caption" style={{ marginTop: -6, marginBottom: 10 }}>
              {t('Estás pagando tu parte en')}{' '}
              <b style={{ color: 'var(--navy)' }}>{mesa.restaurant.name}</b> {t('— PayMe divide la cuenta.')}
            </div>
          )}
          {payType === 'card' && !cardRailAvailable && <CardRailUnavailable />}
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
                  <div style={{ fontWeight: 700, fontSize: 'var(--fs-legacy-base)' }}>Saldo PayMe</div>
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
                <div style={{ fontWeight: 700, fontSize: 'var(--fs-legacy-base)' }}>{t('Tarjeta de crédito o débito')}</div>
                <div className="caption">
                  {cards.length > 0
                    ? (cards.find((c) => c.id === cardChoice)
                        ? t('{0} ···· {1}', cards.find((c) => c.id === cardChoice)!.bank_name ?? cards.find((c) => c.id === cardChoice)!.brand, cards.find((c) => c.id === cardChoice)!.last_four)
                        : t('Elige una guardada o usa otra'))
                    : IS_MOCK
                      ? t('La ingresas al confirmar (segura, vía Stripe)')
                      : t('Ingresa los datos abajo (seguro, vía Stripe)')}
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
              <div role="radiogroup" aria-label={t('Tarjeta guardada')} style={{ margin: '2px 0 4px' }}>
                {cards.map((c) => (
                  <button
                    key={c.id}
                    className={`method-card ${cardChoice === c.id ? 'sel' : ''}`}
                    onClick={() => setCardChoice(c.id)}
                    disabled={!!frozenScope || !cardRailAvailable}
                    role="radio"
                    aria-checked={cardChoice === c.id}
                  >
                    <CardBrandChip brand={c.brand} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 'var(--fs-legacy-base)' }}>
                        {c.bank_name ?? c.brand} ···· {c.last_four}
                        {c.is_default && (
                          <span className="caption" style={{ marginLeft: 8 }}>
                            {t('Principal')}
                          </span>
                        )}
                      </div>
                      <div className="caption">
                        {t('Vence')} {String(c.exp_month).padStart(2, '0')}/{String(c.exp_year % 100).padStart(2, '0')}
                      </div>
                    </div>
                    <div className="radio" aria-hidden="true" />
                  </button>
                ))}
                <button
                  className={`method-card ${cardChoice === 'new' ? 'sel' : ''}`}
                  onClick={() => setCardChoice('new')}
                  disabled={!!frozenScope || !cardRailAvailable}
                  role="radio"
                  aria-checked={cardChoice === 'new'}
                >
                  <div className="method-icon" style={{ background: 'var(--gray-l)' }} aria-hidden="true">
                    <Icon name="plus" size={22} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 'var(--fs-legacy-base)' }}>{t('Usar otra tarjeta')}</div>
                  </div>
                  <div className="radio" aria-hidden="true" />
                </button>
              </div>
            )}
            {/* Tarjeta nueva: Elements en real; en mock no se pide número. */}
            {payType === 'card' && (cards.length === 0 || (cardChoice === 'new' && cardsOpen)) && (
              <div style={{ margin: '2px 0 10px' }}>
                {!IS_MOCK && (cardRailAvailable ? (
                  <>
                    <CardField
                      onReady={setCardEl}
                      onChange={handleCardChange}
                      continuation={!!frozenScope}
                    />
                    {cardState.error && (
                      <div className="caption" style={{ color: 'var(--red)' }} role="alert">
                        {cardState.error}
                      </div>
                    )}
                  </>
                ) : null)}
                {!isGuest && (
                  <label
                    className="caption"
                    style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}
                  >
                    <input
                      type="checkbox"
                      checked={saveCard}
                      disabled={!!frozenScope || !cardRailAvailable}
                      onChange={(e) => setSaveCard(e.target.checked)}
                    />
                    {t('Guardar esta tarjeta para la próxima')}
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
                <div style={{ fontWeight: 700, fontSize: 'var(--fs-legacy-base)' }}>{t('Apple Pay')}</div>
                <div className="caption">{t('vía Stripe')}</div>
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
                style={{ background: '#fff', border: '1.5px solid var(--gray-b)', fontWeight: 800, fontSize: 'var(--fs-legacy-md)' }}
                aria-hidden="true"
              >
                G
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 'var(--fs-legacy-base)' }}>{t('Google Pay')}</div>
                <div className="caption">{t('vía Stripe')}</div>
              </div>
              <div className="radio" aria-hidden="true" />
            </button>
            )}
          </div>
          {/* 🔴 Defecto 4: acá había un segundo aviso de demo, en amarillo,
              que repetía la banda que ya está fija arriba de la app. Textual
              del paquete: *«El cuadro amarillo repetía la banda de arriba»*.
              Se retira EL AVISO duplicado; la banda —que es la que de verdad
              impide creer que se cobró— no se toca. */
          }
          {isGuest && (
            <div className="note note-orange" style={{ marginTop: 6 }}>
              {/* OLA 5C (c): esta nota se lee SIN sesión, por URL pública — es
                  la ruta de más tráfico. Con el riel apagado le anunciaba al
                  comensal un saldo PayMe que no existe. */}
              {t('Sin iniciar sesión pagas con tarjeta')}{WALLET_PAY_ENABLED ? ' o Apple Pay' : ''}
              {walletRailEnabled ? ' (el saldo PayMe pide cuenta)' : ''}.
            </div>
          )}
        </div>
        {/* 🔴 Defecto 5 · LA BARRA DE CINCO POSICIONES, con el círculo diciendo
            sólo «Pagar». El monto ya está arriba, en la tarjeta: repetirlo en
            el botón es el mismo dato dos veces.

            ⚠️ **Este bloque se escribió bajo un freno que YA SE LEVANTÓ, y se
            re-adjudicó en vez de darlo por bueno.** Cuando se escribió, el
            equivalente de 3DS estaba frenado porque la barra agregaba las
            primeras salidas de navegación a una pantalla que no tenía ninguna,
            y *«qué pasa si la persona sale con una autorización en curso»*
            era un hueco sin decidir. **Mati lo decidió** (acta
            `[PAYME]_ACTA_2026-08-19_3DS_ABANDONADO_RETOMAR_Y_BARRER.md`,
            «A+B»): salir queda declarado seguro **y con retome**.

            Acá, además, la salida **ya existía** —la cabecera siempre tuvo
            «Volver a la mesa»—, así que esta barra nunca habilitó un camino
            nuevo: cambia dónde vive el mismo botón. **Las dos razones apuntan
            igual, pero la que manda ahora es el acta, no mi comparación.**

            **El handler, el `disabled` y todos sus estados quedan EXACTAMENTE
            iguales.** Lo único que cambia es el envoltorio. */}
        <AppBottomBar
          active={null}
          center={{
            label: busy
              ? t('Procesando…')
              : frozenRequiresReconciliation
                ? t('Reconciliación necesaria')
                : frozenScope
                  ? t('Reintentar el pago sin confirmar')
                  : refundedNotice
                    ? t('Pagar de nuevo')
                    : t('Pagar'),
            icon: 'arrow-right',
            onClick: () => { void (async () => {
            // Reembolsado: volver a pagar es una decisión explícita del
            // usuario, nunca automática (rotar solo = re-cobrar un reembolso).
            if (refundedNotice) {
              setError(t('Ese intento reembolsado requiere reconciliación antes de iniciar otro pago.'));
              return;
            }
            await doPay();
          })();
          },
            disabled:
            busy ||
            frozenRequiresReconciliation ||
            (!frozenScope && gross === 0) ||
            (!frozenScope && payType === 'card' && !cardRailAvailable) ||
            (!frozenScope &&
              !IS_MOCK &&
              payType === 'card' &&
              (cards.length === 0 || cardChoice === 'new') &&
              !cardState.complete),
          }}
        />
      </div>
    );
  }

  // ─── Detalle + selección (s-myitems) ─────────────────────
  // El JSX vive en `MesaDetailView`: es la pantalla que §1.5 rediseña, y tenerla
  // en el mismo archivo que el pago hacía que un cambio visual rozara dinero.
  // Acá queda el cableado — estado adentro, intenciones afuera.
  return (
    <MesaDetailView
      mesa={mesa}
      code={code}
      paymeId={session?.user?.payme_id}
      isGuest={isGuest}
      guestHeader={guestHeader}
      selected={selected}
      itemsAmount={itemsAmount}
      mySlotsTaken={mySlotsTaken}
      frozenScope={frozenScope}
      busy={busy}
      inviteOpen={inviteOpen}
      onToggleItem={toggleItem}
      onSetFraction={setFraction}
      onGoToPay={goToPay}
      onRetryFrozenPay={() => setView('pay')}
      onOpenInvite={() => setInviteOpen(true)}
      onCopyInvitationLink={() => void copyInvitationLink()}
      onBack={() => goBack('mesas')}
    />
  );
}
