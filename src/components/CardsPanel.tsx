import type { StripeCardElement } from '@stripe/stripe-js';
import { useIdioma } from '../i18n/idioma';
import { useEffect, useRef, useState } from 'react';
import { api, IS_MOCK, newIdempotencyKey } from '../api';
import {
  CardSetupAttemptError,
  clearCardSetupAttempt,
  readCardSetupAttempt,
  writeCardSetupAttempt,
  type CardSetupAttemptState,
} from '../api/cardSetupAttempt';
import { extractApiError } from '../api/errors';
import { isDefinitiveMutationError, isServiceUnavailable } from '../api/mutationRetry';
import { loadSession, type StoredSession } from '../api/storage';
import { confirmCardSetup } from '../api/stripe';
import type { PaymentMethod } from '../api/types';
import { createInFlightMutex } from '../utils/inFlight';
import { CardField, type CardFieldState } from './CardField';
import { Icon } from './Icon';
import { CardBrandChip, useToast } from './ui';

/**
 * Tarjetas guardadas + alta de tarjeta. **Una sola implementación.**
 *
 * Salió de `CuentaScreen` cuando §1.11 mandó que la pestaña Cuenta lanzara a
 * una pantalla propia (`TarjetasScreen`). Se MOVIÓ, no se copió, y eso no es
 * prolijidad: acá adentro vive la máquina de idempotencia del alta —
 * `cardSetupAttempt` durable antes de la red, `pm_` persistido entre setup y
 * attach, rechazo definitivo vs. reintentable—. **Dos copias de esto es cómo
 * nace una tarjeta duplicada o un cobro de más.** Si mañana hay que tocarlo,
 * se toca en un solo lugar.
 *
 * Mientras `CuentaScreen` siga siendo alcanzable desde la barra vieja, monta
 * este mismo componente. Cuando §1.9 la retire, se queda sólo el de la pantalla.
 */

interface CardSetupAttempt extends CardSetupAttemptState {
  clientSecret?: string;
}

type CardRetryStage = 'none' | 'setup' | 'attach';

function currentCardSetupSession(origin: StoredSession): StoredSession | null {
  const current = loadSession();
  return current &&
    current.principal_id === origin.principal_id &&
    current.family_id === origin.family_id
    ? current
    : null;
}

function assertCardSetupOrigin(origin: StoredSession): StoredSession {
  const current = currentCardSetupSession(origin);
  if (!current) throw new CardSetupAttemptError('card_setup_actor_changed');
  return current;
}

function initialCardAttempt(t: (s: string, ...a: unknown[]) => string): { attempt: CardSetupAttempt | null; error: string | null } {
  try {
    return { attempt: readCardSetupAttempt(), error: null };
  } catch {
    return { attempt: null, error: t('No podemos verificar el alta anterior de tarjeta. No vamos a crear otra hasta recuperar el estado local.') };
  }
}

/** "12/28" — el vencimiento que §1.11 pide en la fila, en `--fs-sm` muted. */
function vencimiento(pm: PaymentMethod): string | null {
  if (!pm.exp_month || !pm.exp_year) return null;
  return `${String(pm.exp_month).padStart(2, '0')}/${String(pm.exp_year).slice(-2)}`;
}

export function CardsPanel() {
  const { t } = useIdioma();
  const toast = useToast();
  const initialAttempt = useRef(initialCardAttempt(t)).current;
  const [adding, setAdding] = useState(!!initialAttempt.attempt || !!initialAttempt.error);
  const [busyCard, setBusyCard] = useState(false);
  const addCardInFlightRef = useRef(createInFlightMutex());
  const cardAttemptRef = useRef<CardSetupAttempt | null>(initialAttempt.attempt);
  const [cardRetryStage, setCardRetryStage] = useState<CardRetryStage>(initialAttempt.attempt?.stage ?? 'none');
  const [cardSetupBlocked, setCardSetupBlocked] = useState<string | null>(initialAttempt.error);
  const [cardEl, setCardEl] = useState<StripeCardElement | null>(null);
  const [cardState, setCardState] = useState<CardFieldState>({
    complete: false,
    error: null,
    empty: true,
  });
  const [pms, setPms] = useState<PaymentMethod[] | null>(null);

  function loadPms() {
    api.getPaymentMethods().then((r) => setPms(r.payment_methods)).catch(() => setPms([]));
  }

  // Tarjetas: card-only puro, no depende de ninguna capability.
  useEffect(() => {
    loadPms();
  }, []);

  async function setDefault(id: string) {
    try {
      await api.setDefaultPaymentMethod(id);
      loadPms();
    } catch {
      toast(t('No se pudo actualizar'));
    }
  }

  async function removePm(pm: PaymentMethod) {
    if (!window.confirm(t('¿Quitar la tarjeta terminada en {0}?', pm.last_four))) return;
    try {
      await api.removePaymentMethod(pm.id);
      toast(t('Tarjeta eliminada'));
      loadPms();
    } catch {
      toast(t('No se pudo eliminar la tarjeta'));
    }
  }

  /**
   * Alta de tarjeta: SetupIntent en el backend → Stripe confirma y devuelve el
   * `pm_…` → se registra. La tarjeta nunca pasa por PayMe.
   */
  async function addCard() {
    if (!addCardInFlightRef.current.tryEnter()) return;
    if (cardSetupBlocked) {
      toast(cardSetupBlocked);
      addCardInFlightRef.current.leave();
      return;
    }
    const origin = loadSession();
    if (!origin) {
      toast(t('Tu sesión ya no está disponible. Vuelve a ingresar antes de guardar una tarjeta.'));
      addCardInFlightRef.current.leave();
      return;
    }
    setBusyCard(true);
    try {
      assertCardSetupOrigin(origin);
      let attempt = cardAttemptRef.current;
      if (!attempt) {
        attempt = {
          setupKey: newIdempotencyKey(),
          setAsDefault: pms?.length === 0,
          stage: 'setup',
        };
        // Durable ANTES de red: un reload reusa el mismo SetupIntent.
        writeCardSetupAttempt(attempt, origin);
        cardAttemptRef.current = attempt;
        setCardRetryStage('setup');
      }

      if (!attempt.clientSecret && !attempt.paymentMethodId) {
        const setup = await api.createSetupIntent(attempt.setupKey, assertCardSetupOrigin(origin));
        assertCardSetupOrigin(origin);
        attempt = { ...attempt, clientSecret: setup.client_secret };
        cardAttemptRef.current = attempt;
      }

      if (!attempt.paymentMethodId) {
        // En mock el id deriva de la key, para que incluso una excepción entre
        // materialización y attach vuelva a la MISMA tarjeta.
        let pmId = `pm_mock_${attempt.setupKey.replace(/[^a-zA-Z0-9]/g, '')}`;
        if (!IS_MOCK) {
          if (!cardEl || !attempt.clientSecret) {
            setCardState((s) => ({ ...s, error: t('Carga los datos de la tarjeta para continuar.') }));
            setCardRetryStage('setup');
            return;
          }
          assertCardSetupOrigin(origin);
          const res = await confirmCardSetup(attempt.clientSecret, cardEl);
          assertCardSetupOrigin(origin);
          if ('error' in res) {
            if (res.definitive) {
              try {
                clearCardSetupAttempt(attempt.setupKey, origin);
                cardAttemptRef.current = null;
                setCardRetryStage('none');
              } catch {
                setCardSetupBlocked(t('El banco rechazó la tarjeta, pero no pudimos limpiar el intento local. No vamos a reenviarlo.'));
              }
            } else {
              setCardRetryStage('setup');
            }
            setCardState((s) => ({ ...s, error: res.error }));
            return;
          }
          pmId = res.paymentMethodId;
        }
        attempt = { ...attempt, stage: 'attach', paymentMethodId: pmId };
        cardAttemptRef.current = attempt;
        // El pm_ no es secreto; persistirlo permite que reload reintente el
        // attach derivado/idempotente sin crear otro SetupIntent ni tarjeta.
        writeCardSetupAttempt(attempt, origin);
        setCardRetryStage('attach');
      }

      const paymentMethodId = attempt.paymentMethodId;
      if (!paymentMethodId) throw new Error('payment_method_materialization_ambiguous');
      assertCardSetupOrigin(origin);
      await api.attachPaymentMethod(
        paymentMethodId,
        attempt.setAsDefault,
        assertCardSetupOrigin(origin),
      );
      assertCardSetupOrigin(origin);
      // Fresh 201 y replay 200 son el mismo éxito contractual: recién acá
      // se rota la key de setup y se olvida el pm_ materializado.
      clearCardSetupAttempt(attempt.setupKey, origin);
      cardAttemptRef.current = null;
      setCardRetryStage('none');
      setCardSetupBlocked(null);
      toast(t('Tarjeta guardada ✓'));
      setAdding(false);
      setCardEl(null);
      setCardState({ complete: false, error: null, empty: true });
      loadPms();
    } catch (err) {
      if (err instanceof CardSetupAttemptError) {
        if (err.message === 'card_setup_actor_changed') return;
        const message = t('No pudimos guardar de forma segura el estado de esta alta. No vamos a enviar otra operación.');
        setCardSetupBlocked(message);
        toast(message);
        return;
      }
      const failure = extractApiError(err);
      const definitive = isDefinitiveMutationError(failure.code, failure.status);
      if (definitive) {
        const setupKey = cardAttemptRef.current?.setupKey;
        try {
          if (setupKey) clearCardSetupAttempt(setupKey, origin);
          cardAttemptRef.current = null;
          setCardRetryStage('none');
        } catch {
          setCardSetupBlocked(t('El rechazo fue definitivo, pero no pudimos limpiar el intento local. No vamos a reenviarlo.'));
        }
      } else {
        setCardRetryStage(cardAttemptRef.current?.paymentMethodId ? 'attach' : 'setup');
      }
      toast(
        isServiceUnavailable(failure.status)
          ? t('El servicio no pudo confirmar la tarjeta. Reintenta esta misma operación; no agregues otra.')
          : definitive
            ? t('No pudimos guardar la tarjeta. Revisa los datos y prueba de nuevo.')
            : t('No pudimos confirmar si la tarjeta se guardó. Reintenta la misma operación: no vamos a crear otra.'),
      );
    } finally {
      addCardInFlightRef.current.leave();
      setBusyCard(false);
    }
  }

  return (
    <>
      {pms === null && <div className="loading">{t('Cargando tarjetas…')}</div>}

      {/* Vacío REAL: sin borde, y con su acción. Es el único estado del sistema
          que no lleva borde. */}
      {pms?.length === 0 && !adding && (
        <div className="mesa-empty">
          <div className="mesa-empty-title">{t('Todavía no guardaste ninguna tarjeta.')}</div>
          <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => setAdding(true)}>
            {t('Agregar tarjeta')}
          </button>
        </div>
      )}

      {pms?.map((pm) => {
        const vto = vencimiento(pm);
        return (
          <div key={pm.id} className="pm-row">
            <CardBrandChip brand={pm.brand} />
            <div className="pm-main">
              {/**
               * El banco trunca; **los últimos cuatro NUNCA**. Es lo único que
               * distingue una tarjeta de otra, y con las dos cosas en un mismo
               * texto la elipsis se comía los dígitos: "Santander ···· 4…".
               * Visto en pantalla a 375px.
               */}
              <div className="pm-name">
                <span className="pm-bank">{pm.bank_name ?? pm.brand}</span>
                <span className="pm-last">···· {pm.last_four}</span>
              </div>
              <div className="pm-meta">
                {pm.type === 'credit' ? t('Crédito') : t('Débito')}
                {vto ? t('· Vence {0}', vto) : ''}
              </div>
              {/* Badge y acción van DEBAJO, no al costado, y los dos en el
                  mismo lugar: al costado le robaban el ancho al dato que
                  identifica la tarjeta y "Crédito · Vence 08/28" se partía en
                  dos renglones. Que los dos estados ocupen la misma posición
                  además evita que la fila salte de alto al hacer principal. */}
              <div className="pm-state">
                {pm.is_default ? (
                  <span className="badge badge-teal">{t('Principal')}</span>
                ) : (
                  <button type="button" className="pm-default" onClick={() => setDefault(pm.id)}>
                    {t('Hacer principal')}
                  </button>
                )}
              </div>
            </div>
            <button
              className="back-btn"
              style={{ width: 30, height: 30, fontSize: 'var(--fs-legacy-base)' }}
              aria-label={t('Quitar tarjeta {0}', pm.last_four)}
              onClick={() => removePm(pm)}
            >
              ✕
            </button>
          </div>
        );
      })}

      {adding ? (
        <div className="card card-p" style={{ marginTop: 6 }}>
          <div className="sectlabel">{t('Nueva tarjeta')}</div>
          {cardRetryStage !== 'none' && (
            <div className="note note-orange" style={{ marginBottom: 12 }} role="status">
              {cardRetryStage === 'attach'
                ? t('Esta tarjeta quedó sin confirmar. Reintenta la misma operación: conservamos el mismo registro y no vamos a generar otra.')
                : t('Esta alta quedó sin confirmar. Reintenta la misma operación: conservamos su clave.')}
            </div>
          )}
          {cardSetupBlocked && (
            <div className="form-error" role="alert" style={{ marginBottom: 12 }}>
              {cardSetupBlocked}
            </div>
          )}
          {cardRetryStage === 'attach' ? (
            <div className="caption" style={{ marginBottom: 12 }}>
              {t('La tarjeta ya fue materializada por Stripe. Solo reintentaremos registrar esa misma referencia.')}
            </div>
          ) : IS_MOCK ? (
            <div className="note note-teal" style={{ marginBottom: 12 }}>
              {t('En la demo no pedimos datos reales: se agrega una tarjeta de ejemplo.')}
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
                {t('Los datos van directo a Stripe: PayMe nunca ve el número completo.')}
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
              {t('Cancelar')}
            </button>
            <button
              className="btn btn-primary btn-sm"
              onClick={addCard}
              disabled={!!cardSetupBlocked || busyCard || (!IS_MOCK && cardRetryStage !== 'attach' && !cardState.complete)}
            >
              {busyCard
                ? t('Guardando…')
                : cardRetryStage === 'attach'
                  ? t('Reintentar la misma tarjeta')
                  : t('Guardar tarjeta')}
            </button>
          </div>
        </div>
      ) : (
        pms !== null &&
        pms.length > 0 && (
          /* Fila punteada con `+` y texto, al final de la lista. Es la ÚNICA
             fila punteada de la app que no significa "dato oculto" — por eso
             lleva el `+` y la palabra, nunca un ícono solo. */
          <button type="button" className="pm-add" onClick={() => setAdding(true)}>
            <Icon name="plus" size={18} />
            {t('Agregar tarjeta')}
          </button>
        )
      )}
    </>
  );
}
