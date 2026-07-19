import type { Stripe, StripeCardElement } from '@stripe/stripe-js';
import type { AppConfig } from './types';

/**
 * Integración con Stripe.js (@stripe/stripe-js 9.10.0 — única dependencia
 * nueva del proyecto, alcance ratificado por Mati el 2026-07-19):
 *   1. Crear el PaymentMethod (`pm_…`) de la garantía de mesa (A-1).
 *   2. Confirmar el 3DS cuando el backend devuelve `requires_action`.
 *   3. Guardar tarjetas nuevas vía SetupIntent.
 *
 * La clave PUBLICABLE se pide al propio backend (`GET /api/config`), que ya la
 * expone: así no se duplica configuración ni se hardcodea nada. La clave
 * SECRETA vive solo en el backend y este código jamás la ve.
 *
 * En modo demo (VITE_MOCK=1) este módulo no carga Stripe: la demo no debe
 * depender de la red ni de credenciales.
 */

const BASE_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
// Se lee directo del entorno (y no de api/index) para no crear un ciclo de
// imports: index importa este módulo para el 3DS.
const IS_MOCK: boolean = import.meta.env.VITE_MOCK === '1';

let stripePromise: Promise<Stripe | null> | null = null;

export class StripeUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StripeUnavailableError';
  }
}

/**
 * Carga Stripe.js una sola vez, con la publishable key del backend.
 * El `import()` es dinámico a propósito: así la librería queda en un chunk
 * aparte y la demo (VITE_MOCK=1) no la descarga nunca.
 */
export function getStripe(): Promise<Stripe | null> {
  if (IS_MOCK) return Promise.resolve(null);
  if (!stripePromise) {
    stripePromise = (async () => {
      const res = await fetch(`${BASE_URL}/api/config`);
      if (!res.ok) throw new StripeUnavailableError('no_config');
      const config = (await res.json()) as AppConfig;
      const key = config.stripe_publishable_key;
      if (!key) throw new StripeUnavailableError('no_publishable_key');
      const { loadStripe } = await import('@stripe/stripe-js');
      return loadStripe(key);
    })();
  }
  return stripePromise;
}

async function requireStripe(): Promise<Stripe> {
  const stripe = await getStripe();
  if (!stripe) throw new StripeUnavailableError('stripe_not_loaded');
  return stripe;
}

/**
 * Crea un PaymentMethod a partir del Card Element.
 * Devuelve el `pm_…` que `POST /api/mesas` exige para la garantía con tarjeta.
 */
export async function createCardPaymentMethod(
  card: StripeCardElement,
): Promise<{ paymentMethodId: string } | { error: string }> {
  const stripe = await requireStripe();
  const { paymentMethod, error } = await stripe.createPaymentMethod({
    type: 'card',
    card,
  });
  if (error || !paymentMethod) {
    return { error: error?.message ?? 'No pudimos leer la tarjeta.' };
  }
  return { paymentMethodId: paymentMethod.id };
}

/**
 * Confirma un pago que quedó en `requires_action` (3-D Secure).
 * El backend nos dio el `client_secret`; acá se abre el desafío del banco.
 */
export async function confirmCardPayment(
  clientSecret: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const stripe = await requireStripe();
  const { error } = await stripe.confirmCardPayment(clientSecret);
  if (error) {
    return { ok: false, error: error.message ?? 'Tu banco no autorizó la operación.' };
  }
  return { ok: true };
}

/**
 * Guarda una tarjeta nueva: confirma el SetupIntent que crea el backend
 * (`POST /api/payment-methods/setup-intent`) y devuelve el `pm_…` resultante,
 * que después se registra con `POST /api/payment-methods`.
 */
export async function confirmCardSetup(
  clientSecret: string,
  card: StripeCardElement,
): Promise<{ paymentMethodId: string } | { error: string }> {
  const stripe = await requireStripe();
  const { setupIntent, error } = await stripe.confirmCardSetup(clientSecret, {
    payment_method: { card },
  });
  if (error || !setupIntent?.payment_method) {
    return { error: error?.message ?? 'No pudimos guardar la tarjeta.' };
  }
  const pm = setupIntent.payment_method;
  return { paymentMethodId: typeof pm === 'string' ? pm : pm.id };
}
