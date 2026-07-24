import type { StripeCardElement } from '@stripe/stripe-js';
import { useCallback, useRef, useState } from 'react';
import { api, IS_MOCK, IS_DEMO, DEMO_PM_ID } from '../api';
import { HttpError } from '../api/http';
import { MockApiError } from '../api/mock/mockApi';
import { MOCK_RESTAURANTS } from '../api/mock/seedData';
import { createCardPaymentMethod } from '../api/stripe';
import type { CreateMesaResponse, PaymentMethod } from '../api/types';
import { CardField, type CardFieldState } from '../components/CardField';
import { Icon } from '../components/Icon';
import { CardBrandChip, TopBar, TopLogo, useToast } from '../components/ui';
import { navigate } from '../router';
import { formatMXN } from '../utils/format';
import { centsToString, splitEqual, stringToCents } from '../utils/money';

/**
 * Wizard del organizador (T2): scan → ticket → división → GARANTÍA (A-1,
 * pantalla que la maqueta no tenía) → compartir. La mesa recién existe
 * cuando la garantía queda autorizada: sin garantía no hay mesa (D1).
 */

type Step = 'scan' | 'ticket' | 'division' | 'garantia' | 'threeds' | 'share';

/**
 * D5: fila EDITABLE del ticket. El precio vive como string en pesos mientras
 * se tipea; a centavos enteros recién al calcular (sin floats).
 */
interface EditItem {
  name: string;
  priceStr: string;
  quantity: number;
  category?: string;
}

function priceCentsOf(it: EditItem): number {
  try {
    return stringToCents(it.priceStr || '0');
  } catch {
    return 0;
  }
}

function extractError(err: unknown): { code: string; extra: Record<string, unknown> } {
  if (err instanceof MockApiError) return { code: err.message, extra: err.extra };
  if (err instanceof HttpError) return { code: err.message, extra: err.body ?? {} };
  return { code: 'unknown', extra: {} };
}

/**
 * Modo demo (`?demo=1`): imagen mínima válida para saltear la cámara. El OCR
 * real valida los magic bytes pero ignora el contenido y devuelve el ticket de
 * ejemplo de siempre, así que un JPEG de 8×8 alcanza. No es una feature nueva:
 * reemplaza la foto por bytes válidos para reusar el MISMO endpoint y resultado.
 */
function makeDemoImage(): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 8;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 8, 8);
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('demo_image_failed'))),
      'image/jpeg',
      0.8,
    );
  });
}

export function CreateMesaFlow() {
  const toast = useToast();
  const [step, setStep] = useState<Step>('scan');
  const [scanning, setScanning] = useState(false);
  const [editItems, setEditItems] = useState<EditItem[]>([]);
  const [scanFailed, setScanFailed] = useState(false);
  const [division, setDivision] = useState<'consumo' | 'igual'>('consumo');
  const [participants, setParticipants] = useState(4);
  const [method, setMethod] = useState<'card' | 'wallet'>('card');
  // D4: tarjetas guardadas. `cardChoice` es el pm_… elegido o 'new' (otra
  // tarjeta); `saveCard` = checkbox "guardar" (ratificado: prendido).
  const [cards, setCards] = useState<PaymentMethod[]>([]);
  const [cardChoice, setCardChoice] = useState<string>('new');
  const [saveCard, setSaveCard] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreateMesaResponse | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [cardEl, setCardEl] = useState<StripeCardElement | null>(null);
  const [cardState, setCardState] = useState<CardFieldState>({
    complete: false,
    error: null,
    empty: true,
  });
  // Espejo en ref para que loadCards (async) lea el estado ACTUAL del campo y
  // no pise la selección si el usuario ya empezó a tipear (race de red lenta).
  const cardStateRef = useRef(cardState);
  const handleCardChange = useCallback((s: CardFieldState) => {
    cardStateRef.current = s;
    setCardState(s);
  }, []);

  /**
   * G-01: el contrato NO tiene endpoint para listar/buscar restaurantes, pero
   * `POST /mesas` exige un `restaurant_id` que exista y esté activo. Mientras
   * el gap siga abierto, con backend real el id se toma de configuración
   * (VITE_RESTAURANT_ID, apuntando a una fila sembrada en la base).
   */
  const restaurant = IS_MOCK
    ? MOCK_RESTAURANTS[0]
    : {
        id: (import.meta.env.VITE_RESTAURANT_ID as string | undefined) ?? '',
        name: (import.meta.env.VITE_RESTAURANT_NAME as string | undefined) ?? 'Restaurante',
        category: 'other',
        address: '',
      };
  // D5: el total SIEMPRE sale de lo que el usuario ve/editó — guardarraíl:
  // si el total está mal, la división está mal.
  const total = editItems.reduce((s, i) => s + priceCentsOf(i) * i.quantity, 0);
  const ticketValid =
    editItems.length > 0 &&
    editItems.every((i) => i.name.trim().length > 0 && priceCentsOf(i) > 0 && i.quantity >= 1);
  const ticketInvalidReason =
    editItems.length === 0
      ? 'Agregá al menos un consumo.'
      : 'Completá nombre y precio (mayor a cero) de cada consumo.';

  function updateItem(idx: number, patch: Partial<EditItem>) {
    setEditItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }
  function removeItem(idx: number) {
    setEditItems((prev) => prev.filter((_, i) => i !== idx));
  }
  function addItem() {
    setEditItems((prev) => [...prev, { name: '', priceStr: '', quantity: 1 }]);
  }

  /**
   * Demo: el mock devuelve el ticket de ejemplo sin foto.
   * Real: `POST /api/ocr` es multipart y valida los magic bytes de la imagen,
   * así que hay que mandar una foto de verdad → se abre la cámara del teléfono.
   */
  function doScan() {
    if (IS_MOCK) {
      void runScan();
      return;
    }
    fileInput.current?.click();
  }

  /**
   * Modo demo (`?demo=1`): saltea la cámara. Genera una imagen mínima válida y
   * la manda al MISMO `POST /api/ocr`, que responde el ticket de ejemplo de
   * siempre → avanza a "ticket" y de ahí a dividir. Sin cámara ni diálogo de
   * archivo (lo que trababa la grabación en el navegador automatizado).
   */
  async function runDemoScan() {
    try {
      const image = await makeDemoImage();
      await runScan(image);
    } catch {
      toast('No pudimos preparar el ticket de ejemplo. Reintentá.');
    }
  }

  async function runScan(image?: Blob) {
    setScanning(true);
    setError(null);
    try {
      const r = await api.scanTicket(image);
      setEditItems(
        r.items.map((i) => ({
          name: i.name,
          priceStr: centsToString(i.price_cents),
          quantity: i.quantity,
          ...(i.category && { category: i.category }),
        })),
      );
      setScanFailed(false);
      setStep('ticket');
    } catch {
      setScanFailed(true);
      toast('No pudimos leer el ticket. Probá sacar la foto de nuevo.');
    } finally {
      setScanning(false);
    }
  }

  async function loadCards() {
    if (cards.length > 0) return;
    try {
      const r = await api.getPaymentMethods();
      // D4 (v2.16): las guardadas se reusan con su uuid (payment_method_id).
      setCards(r.payment_methods);
      const def = r.payment_methods.find((p) => p.is_default) ?? r.payment_methods[0];
      // Si la respuesta llegó tarde y el usuario YA está tipeando una tarjeta
      // nueva, no le pisamos la selección (destruiría lo tipeado).
      if (def && cardStateRef.current.empty) setCardChoice(def.id);
    } catch {
      setCards([]);
    }
  }

  async function createMesa() {
    if (!ticketValid) return;
    setBusy(true);
    setError(null);
    try {
      // Garantía con tarjeta (D4 v2.16): una GUARDADA viaja como
      // `payment_method_id` (uuid, sin Elements); una NUEVA se crea desde el
      // Card Element y viaja como `stripe_payment_method_id` (pm_…), con
      // `save_payment_method` según el checkbox.
      let stripePmId: string | null = null;
      let savedPmId: string | null = null;
      let savingNewCard = false;
      const savedCard = cards.find((c) => c.id === cardChoice) ?? null;
      if (method === 'card') {
        if (!IS_MOCK && IS_DEMO) {
          // Modo demo (?demo=1): PaymentMethod de test de Stripe, sin tipear
          // en el iframe de Elements (para grabar en navegador automatizado).
          // Desde v2.16 el cliente Stripe se crea solo: sin bootstrap previo.
          stripePmId = DEMO_PM_ID;
        } else if (savedCard) {
          savedPmId = savedCard.id;
        } else if (IS_MOCK) {
          stripePmId = `pm_mock_nueva_${Date.now().toString(36)}`;
          savingNewCard = saveCard;
        } else {
          // v2.16: el backend crea el cliente Stripe lazy en la propia
          // garantía — el bootstrap de setup-intent (v2.14) ya no hace falta.
          if (!cardEl) {
            setError('Cargá los datos de la tarjeta para continuar.');
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
          savingNewCard = saveCard;
        }
      }

      if (!restaurant.id) {
        setError(
          'Falta configurar el restaurante de la mesa (VITE_RESTAURANT_ID). Es el gap G-01: el backend todavía no expone la lista de restaurantes.',
        );
        setBusy(false);
        return;
      }

      const r = await api.createMesa({
        restaurant_id: restaurant.id,
        total_cents: total,
        division_mode: division,
        expected_participants: division === 'igual' ? participants : Math.max(1, participants),
        guarantee_method: method,
        ...(stripePmId && { stripe_payment_method_id: stripePmId }),
        ...(savedPmId && { payment_method_id: savedPmId }),
        ...(savingNewCard && { save_payment_method: true }),
        // Cantidades EXPANDIDAS en unidades: "Tiramisú ×2" viaja como dos
        // ítems de $70 → cada unidad se elige/reserva por separado (pedido de
        // Mati). El total no cambia y el contrato ya lo acepta (quantity 1).
        items: editItems.flatMap((i) =>
          Array.from({ length: i.quantity }, () => ({
            name: i.name.trim(),
            price_cents: priceCentsOf(i),
            quantity: 1,
            ...(i.category && { category: i.category }),
          })),
        ),
      });
      setCreated(r);
      if (r.guarantee.status === 'requires_action') {
        setStep('threeds');
      } else {
        await makeLink(r.mesa.code);
      }
    } catch (err) {
      const { code, extra } = extractError(err);
      if (code === 'guarantee_failed') {
        const available = typeof extra.available === 'number' ? extra.available : null;
        setError(
          available !== null
            ? `Saldo insuficiente para garantizar: tenés ${formatMXN(available)} disponibles y la mesa necesita ${formatMXN(total)}. Cargá saldo o garantizá con tarjeta.`
            : 'No pudimos autorizar la garantía. Probá con otro método.',
        );
      } else {
        setError('No pudimos crear la mesa. Probá de nuevo.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function confirm3ds() {
    if (!created) return;
    setBusy(true);
    setError(null);
    try {
      await api.confirmGuarantee3ds(created.mesa.code, created.guarantee.client_secret ?? '');
      await makeLink(created.mesa.code);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'guarantee_pending_webhook') {
        // El banco autorizó pero el aviso todavía no llegó al backend: no es un
        // rechazo, así que no mandamos al usuario a elegir otra garantía.
        setError(
          'Tu banco autorizó la retención, pero todavía la estamos confirmando. Esperá unos segundos y volvé a intentar.',
        );
      } else {
        setError(msg || 'El banco no autorizó la retención. Probá con otra tarjeta.');
        setStep('garantia');
      }
    } finally {
      setBusy(false);
    }
  }

  async function makeLink(code: string) {
    try {
      const inv = await api.createInvitation(code);
      setLink(inv.link ?? null);
    } catch {
      setLink(null);
    }
    setStep('share');
  }

  function back() {
    if (step === 'scan') return navigate('home');
    if (step === 'ticket') return setStep('scan');
    if (step === 'division') return setStep('ticket');
    if (step === 'garantia') return setStep('division');
    // threeds/share: la mesa ya existe (o está autorizándose); no se vuelve.
    return navigate('home');
  }

  // ─── Paso 1: scan ────────────────────────────────────────
  if (step === 'scan') {
    return (
      <div className="screen" style={{ background: 'var(--navy)' }}>
        <div className="top-bar" style={{ background: 'var(--navy)' }}>
          <button
            className="back-btn"
            onClick={back}
            aria-label="Volver"
            style={{ background: 'rgba(255,255,255,0.15)', color: '#fff' }}
          >
            <span aria-hidden="true">←</span>
          </button>
          <TopLogo inv />
          <h1 className="top-title" style={{ color: 'rgba(255,255,255,0.7)', fontSize: 'var(--fs-base)', fontFamily: 'var(--font-body)', fontWeight: 600 }}>
            Escanear ticket
          </h1>
        </div>
        <div className="scroll" style={{ background: 'var(--navy)', padding: '20px 16px' }}>
          <div className="scan-frame">
            <div className="scan-corner tl" />
            <div className="scan-corner tr" />
            <div className="scan-corner bl" />
            <div className="scan-corner br" />
            {scanning && <div className="scan-line" />}
            <div style={{ opacity: 0.3, color: '#fff' }} aria-hidden="true">
              <Icon name="receipt" size={40} />
            </div>
          </div>
          <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.75)', fontSize: 'var(--fs-sm)', margin: '16px 0', fontFamily: 'var(--font-body)' }}>
            Encuadrá el ticket dentro del marco
          </div>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          {/* En modo demo el cartel se oculta: delataría la maqueta en cámara. */}
          {!IS_DEMO && (
            <div className="note note-amber">
              <b>{IS_MOCK ? 'Modo demo:' : 'Ojo:'}</b>{' '}
              {IS_MOCK
                ? 'todavía no leemos la foto. Usamos un ticket de ejemplo para que puedas probar el resto del flujo.'
                : 'todavía no leemos la foto de verdad — sacala igual y vas a recibir un ticket de ejemplo para continuar.'}
            </div>
          )}
          {/* Real: abre la cámara del teléfono. POST /api/ocr es multipart y
              valida los magic bytes, así que necesita una imagen de verdad. */}
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic"
            capture="environment"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void runScan(file);
            }}
          />
          <button
            className="btn btn-teal"
            style={{ marginTop: 14 }}
            onClick={IS_DEMO ? () => void runDemoScan() : doScan}
            disabled={scanning}
          >
            {scanning ? (
              'Leyendo ticket…'
            ) : IS_DEMO ? (
              <>
                <Icon name="receipt" size={16} className="ico-inline" /> Usar ticket de ejemplo
              </>
            ) : (
              <>
                <Icon name="camera" size={16} className="ico-inline" /> Capturar
              </>
            )}
          </button>
          {scanFailed && (
            <div className="note note-orange" style={{ marginTop: 12 }}>
              No pudimos leer la foto. Probá de nuevo con más luz.
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── Paso 2: ticket ──────────────────────────────────────
  if (step === 'ticket') {
    return (
      <div className="screen has-cta">
        <div className="top-bar" style={{ background: 'var(--navy)' }}>
          <button className="back-btn" onClick={back} aria-label="Volver" style={{ background: 'rgba(255,255,255,0.15)', color: '#fff' }}>
            ←
          </button>
          <TopLogo inv />
          <div className="top-title" style={{ color: 'rgba(255,255,255,0.7)', fontSize: 'var(--fs-base)', fontFamily: 'var(--font-body)', fontWeight: 600 }}>
            Ticket de la mesa
          </div>
        </div>
        <div style={{ background: 'var(--navy)', padding: '0 20px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 800, color: '#fff' }}>{restaurant.name}</div>
            <div style={{ fontSize: 'var(--fs-sm)', color: 'rgba(255,255,255,0.55)', marginTop: 2, fontFamily: 'var(--font-body)' }}>
              <Icon name="pin" size={14} className="ico-inline" /> {restaurant.address}
            </div>
          </div>
          <div style={{ background: 'var(--teal)', color: 'var(--navy)', padding: '6px 14px', borderRadius: 20, fontWeight: 800, fontSize: 'var(--fs-base)' }}>
            {formatMXN(total)}
          </div>
        </div>
        <div className="scroll">
          <div className="card" style={{ margin: 12 }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--gray-l)' }}>
              <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 700 }}>Detalle</div>
              <div className="caption" style={{ marginTop: 2 }}>
                {editItems.length} consumo{editItems.length === 1 ? '' : 's'} · {formatMXN(total)} ·
                corregí lo que haga falta antes de dividir
              </div>
            </div>
            {/* D5: cada consumo es editable — nombre, precio, cantidad, quitar. */}
            {editItems.map((it, idx) => (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  gap: 5,
                  alignItems: 'center',
                  padding: '4px 12px',
                  borderBottom: '1px solid var(--gray-l)',
                }}
              >
                <input
                  className="input"
                  style={{ flex: 1, minWidth: 0, padding: '6px 8px', fontSize: 'var(--fs-base)' }}
                  value={it.name}
                  placeholder="Consumo"
                  onChange={(e) => updateItem(idx, { name: e.target.value })}
                  aria-label={`Nombre del consumo ${idx + 1}`}
                />
                <span style={{ fontWeight: 700, fontSize: 'var(--fs-sm)', flex: 'none' }}>$</span>
                <input
                  className="input"
                  style={{ width: 60, padding: '6px 6px', fontSize: 'var(--fs-base)', flex: 'none', textAlign: 'right' }}
                  inputMode="decimal"
                  value={it.priceStr}
                  placeholder="0"
                  onChange={(e) => updateItem(idx, { priceStr: e.target.value.replace(/[^0-9.]/g, '') })}
                  aria-label={`Precio del consumo ${idx + 1}`}
                />
                <button
                  className="back-btn"
                  style={{ width: 22, height: 22, fontSize: 'var(--fs-sm)', flex: 'none' }}
                  onClick={() => updateItem(idx, { quantity: Math.max(1, it.quantity - 1) })}
                  aria-label={`Menos cantidad de ${it.name || `consumo ${idx + 1}`}`}
                >
                  −
                </button>
                <span
                  style={{ minWidth: 14, textAlign: 'center', fontWeight: 700, fontSize: 'var(--fs-sm)', flex: 'none' }}
                >
                  {it.quantity}
                </span>
                <button
                  className="back-btn"
                  style={{ width: 22, height: 22, fontSize: 'var(--fs-sm)', flex: 'none' }}
                  onClick={() => updateItem(idx, { quantity: it.quantity + 1 })}
                  aria-label={`Más cantidad de ${it.name || `consumo ${idx + 1}`}`}
                >
                  ＋
                </button>
                <button
                  className="back-btn"
                  style={{ width: 22, height: 22, fontSize: 'var(--fs-xs)', flex: 'none' }}
                  onClick={() => removeItem(idx)}
                  aria-label={`Quitar ${it.name || `consumo ${idx + 1}`}`}
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              className="btn btn-ghost"
              style={{ margin: '8px 16px 10px', width: 'auto', fontSize: 'var(--fs-sm)', padding: '9px 14px' }}
              onClick={addItem}
            >
              <Icon name="plus" size={16} className="ico-inline" /> Agregar consumo
            </button>
          </div>
        </div>
        {!ticketValid && (
          <div
            className="caption"
            style={{ position: 'fixed', bottom: 78, left: 0, right: 0, textAlign: 'center', zIndex: 20 }}
          >
            {ticketInvalidReason}
          </div>
        )}
        <button className="cta-float" onClick={() => setStep('division')} disabled={!ticketValid}>
          Continuar → dividir
        </button>
      </div>
    );
  }

  // ─── Paso 3: división ────────────────────────────────────
  if (step === 'division') {
    // splitEqual, igual que el backend: la suma de las partes da el total exacto
    // (el primer comensal absorbe los centavos sobrantes).
    const perSlot = participants > 0 ? splitEqual(total, participants)[0] : total;
    return (
      <div className="screen has-cta">
        <TopBar title="Dividir cuenta" onBack={back} />
        <div className="scroll" style={{ padding: '18px 16px' }}>
          <div style={{ padding: '4px 2px 16px' }}>
            <div className="h1" style={{ fontSize: 'var(--fs-2xl)' }}>
              ¿Cómo pagan?
            </div>
          </div>
          <button className={`div-card ${division === 'consumo' ? 'sel' : ''}`} onClick={() => setDivision('consumo')}>
            <div className="div-radio" />
            <div className="div-ico">
              <Icon name="users" size={22} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="div-title">Cada uno lo suyo</div>
              <div className="div-sub">Cada quien elige y paga lo que consumió.</div>
            </div>
          </button>
          <button className={`div-card ${division === 'igual' ? 'sel' : ''}`} onClick={() => setDivision('igual')}>
            <div className="div-radio" />
            <div className="div-ico">÷</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="div-title">Partes iguales</div>
              <div className="div-sub">La cuenta se divide en partes iguales; cada pago toma una.</div>
            </div>
            {division === 'igual' && (
              <div className="pill-amt">
                {formatMXN(perSlot)}
                <br />
                ×parte
              </div>
            )}
          </button>
          {division === 'igual' && (
            <div className="card card-p" style={{ marginBottom: 12 }}>
              <div className="sectlabel">¿Cuántos son?</div>
              <div className="stepper" role="group" aria-label="Cantidad de comensales">
                <button
                  onClick={() => setParticipants(Math.max(2, participants - 1))}
                  aria-label="Un comensal menos"
                >
                  −
                </button>
                <div className="val" aria-live="polite">
                  {participants}
                </div>
                <button
                  onClick={() => setParticipants(Math.min(20, participants + 1))}
                  aria-label="Un comensal más"
                >
                  +
                </button>
              </div>
            </div>
          )}
        </div>
        <button
          className="cta-float"
          onClick={() => {
            void loadCards();
            setStep('garantia');
          }}
        >
          Continuar → garantizar
        </button>
      </div>
    );
  }

  // ─── Paso 4: GARANTÍA (A-1, pantalla nueva) ──────────────
  if (step === 'garantia') {
    return (
      <div className="screen has-cta">
        <TopBar title="Garantizá la mesa" onBack={back} />
        <div className="scroll" style={{ padding: 16 }}>
          <div style={{ background: 'var(--navy)', borderRadius: 16, padding: '18px 20px', marginBottom: 14 }}>
            <div style={{ fontSize: 'var(--fs-xs)', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Garantía de la mesa
            </div>
            <div style={{ fontSize: 'var(--fs-3xl)', fontWeight: 800, color: '#fff' }}>{formatMXN(total)}</div>
            <div style={{ fontSize: 'var(--fs-xs)', color: 'rgba(255,255,255,0.45)', marginTop: 4, fontFamily: 'var(--font-body)' }}>
              Se retiene, no se cobra. Si todos pagan, se libera completa.
            </div>
          </div>
          <div className="note note-teal" style={{ marginBottom: 16 }}>
            Para abrir la mesa, PayMe retiene el total como garantía: el restaurante cobra
            sí o sí. Cuando todos pagan su parte, la retención se libera. Si alguien no
            paga, tu garantía cubre solo ese faltante.
          </div>
          {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
          <div className="sectlabel" id="lbl-garantia">
            ¿Con qué garantizás?
          </div>
          <div role="radiogroup" aria-labelledby="lbl-garantia">
          {/* Sin opción "Tarjeta" padre (redundante — feedback de Mati): las
              tarjetas guardadas SON las opciones. Elegir una = garantizar con
              esa (D4, sin Elements; 3DS igual). */}
          {IS_DEMO && (
            <button
              className={`method-card ${method === 'card' ? 'sel' : ''}`}
              onClick={() => setMethod('card')}
              role="radio"
              aria-checked={method === 'card'}
            >
              <div className="cc visa" aria-hidden="true">
                VISA
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 'var(--fs-base)' }}>Tarjeta</div>
                <div className="caption">Tarjeta de prueba ···· 4242 (demo)</div>
              </div>
              <div className="radio" aria-hidden="true" />
            </button>
          )}
          {!IS_DEMO &&
            cards.map((c) => (
              <button
                key={c.id}
                className={`method-card ${method === 'card' && cardChoice === c.id ? 'sel' : ''}`}
                onClick={() => {
                  setMethod('card');
                  setCardChoice(c.id);
                }}
                role="radio"
                aria-checked={method === 'card' && cardChoice === c.id}
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
          {!IS_DEMO && (
            <button
              className={`method-card ${method === 'card' && cardChoice === 'new' ? 'sel' : ''}`}
              onClick={() => {
                setMethod('card');
                setCardChoice('new');
              }}
              role="radio"
              aria-checked={method === 'card' && cardChoice === 'new'}
            >
              <div className="method-icon" style={{ background: 'var(--gray-l)' }} aria-hidden="true">
                <Icon name="plus" size={22} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 'var(--fs-base)' }}>
                  {cards.length > 0 ? 'Usar otra tarjeta' : 'Tarjeta'}
                </div>
                <div className="caption">Retención en la tarjeta (puede pedir confirmación del banco)</div>
              </div>
              <div className="radio" aria-hidden="true" />
            </button>
          )}
          {/* Tarjeta nueva: Elements en real; en mock no se pide número. */}
          {!IS_DEMO && method === 'card' && (cards.length === 0 || cardChoice === 'new') && (
            <div style={{ margin: '4px 0 12px' }}>
              {IS_MOCK ? (
                <div className="caption">La ingresás al confirmar (segura, vía Stripe).</div>
              ) : (
                <>
                  <CardField onReady={setCardEl} onChange={handleCardChange} />
                  {cardState.error && (
                    <div className="caption" style={{ color: 'var(--red)' }} role="alert">
                      {cardState.error}
                    </div>
                  )}
                  <div className="caption">
                    Los datos van directo a Stripe: PayMe nunca ve el número completo.
                  </div>
                </>
              )}
              <label className="caption" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                <input
                  type="checkbox"
                  checked={saveCard}
                  onChange={(e) => setSaveCard(e.target.checked)}
                />
                Guardar esta tarjeta para la próxima
              </label>
            </div>
          )}
          {/* Modo demo (?demo=1): tarjeta de test, sin iframe de Stripe. */}
          {!IS_MOCK && IS_DEMO && method === 'card' && (
            <div className="caption" style={{ margin: '4px 0 12px' }}>
              <Icon name="card" size={14} className="ico-inline" /> Tarjeta de prueba ···· 4242 (demo)
            </div>
          )}
          <button
            className={`method-card ${method === 'wallet' ? 'sel' : ''}`}
            onClick={() => setMethod('wallet')}
            role="radio"
            aria-checked={method === 'wallet'}
          >
            <div className="method-icon" style={{ background: 'var(--teal-l)' }} aria-hidden="true">
              <Icon name="wallet" size={22} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 'var(--fs-base)' }}>Saldo PayMe</div>
              <div className="caption">
                Congela {formatMXN(total)} de tu saldo hasta que la mesa cierre
              </div>
            </div>
            <div className="radio" aria-hidden="true" />
          </button>
          </div>
        </div>
        <button
          className="cta-float"
          onClick={createMesa}
          disabled={
            busy ||
            (!IS_MOCK &&
              !IS_DEMO &&
              method === 'card' &&
              (cards.length === 0 || cardChoice === 'new') &&
              !cardState.complete)
          }
        >
          {busy ? (
            'Autorizando…'
          ) : (
            <>
              <Icon name="lock" size={16} className="ico-inline" /> Garantizar {formatMXN(total)} y
              abrir mesa
            </>
          )}
        </button>
      </div>
    );
  }

  // ─── Paso 4b: 3DS (requires_action) ──────────────────────
  if (step === 'threeds') {
    return (
      <div className="screen">
        {/* Antes este paso no tenía ninguna salida: la mesa quedaba sin
            garantizar y el usuario atrapado en la pantalla. */}
        <TopBar
          title="Confirmá con tu banco"
          onBack={() => setStep('garantia')}
          backLabel="Volver a elegir la garantía"
        />
        <div className="scroll" style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ textAlign: 'center', padding: '16px 0' }} role="status" aria-live="polite">
            <div className="spinner" aria-hidden="true" />
            <div className="h2" style={{ marginTop: 18 }}>
              Tu banco pide confirmar
            </div>
            <div className="body-text" style={{ marginTop: 6 }}>
              La retención de {formatMXN(total)} necesita que la confirmes con tu banco.
            </div>
          </div>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <div className="note note-teal" style={{ marginTop: 12 }}>
            En la versión final, acá se abre la verificación de tu banco.
          </div>
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={confirm3ds} disabled={busy}>
            {busy ? 'Confirmando…' : 'Confirmar autorización'}
          </button>
          <button
            className="btn btn-ghost btn-sm"
            style={{ marginTop: 10 }}
            onClick={() => setStep('garantia')}
            disabled={busy}
          >
            Cancelar y elegir otra garantía
          </button>
        </div>
      </div>
    );
  }

  // ─── Paso 5: compartir ───────────────────────────────────
  if (step === 'share' && created) {
    const code = created.mesa.code;
    return (
      <div className="screen">
        <TopBar title="Invitar a la mesa" onBack={() => navigate('mesa', code)} />
        <div className="scroll" style={{ padding: 16 }}>
          <div style={{ textAlign: 'center', padding: '8px 0 12px' }}>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <Icon name="pasta" size={34} />
            </div>
            <div className="h2" style={{ marginTop: 6 }}>
              Mesa {code}
            </div>
            <span className="badge badge-teal" style={{ marginTop: 6 }}>
              Garantizada ✓
            </span>
          </div>
          <div className="note note-teal" style={{ marginBottom: 14 }}>
            La mesa quedó <b>abierta y garantizada</b> con {method === 'card' ? 'tu tarjeta' : 'tu saldo'}.
            Ahora invitá al resto: cada uno entra con el link y paga su parte.
          </div>
          <div className="sectlabel">Link de invitación</div>
          {link ? (
            <>
              <div style={{ background: 'var(--gray-l)', border: '1.5px dashed var(--teal)', borderRadius: 10, padding: 14, fontFamily: 'monospace', fontSize: 'var(--fs-xs)', color: '#0a7b80', wordBreak: 'break-all', marginBottom: 10 }}>
                {link}
              </div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <button
                  className="btn btn-teal"
                  style={{ fontSize: 'var(--fs-sm)', padding: 13 }}
                  onClick={() => {
                    void navigator.clipboard.writeText(link).then(
                      () => toast('Link copiado ✓'),
                      () => toast('No se pudo copiar'),
                    );
                  }}
                >
                  <Icon name="copy" size={16} className="ico-inline" /> Copiar
                </button>
                <a
                  className="btn"
                  style={{ background: '#25D366', color: '#fff', fontSize: 'var(--fs-sm)', padding: 13, textDecoration: 'none' }}
                  href={`https://wa.me/?text=${encodeURIComponent(`Sumate a la mesa ${code} en PayMe: ${link}`)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Icon name="message" size={16} className="ico-inline" /> WhatsApp
                </a>
              </div>
              <div className="note note-orange">
                Guardá el link: por seguridad se muestra <b>una sola vez</b> (después podés
                generar otro desde la mesa).
              </div>
            </>
          ) : (
            <div className="loading">Generando link…</div>
          )}
        </div>
        <button className="cta-float" onClick={() => navigate('mesa', code)}>
          Ir a la mesa → elegir lo mío
        </button>
      </div>
    );
  }

  return null;
}
