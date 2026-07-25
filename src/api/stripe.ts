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

/**
 * Una instancia de Stripe.js POR CUENTA (v2.24 · Stripe Connect): la de la
 * plataforma (clave '') y una por cada cuenta conectada. Un PaymentIntent que
 * vive en la cuenta del restaurante SOLO se puede confirmar con una instancia
 * inicializada con `{ stripeAccount }` — con la publishable key sola, Stripe
 * no encuentra el intent. Se cachean para no recargar la librería por pago.
 */
const stripeByAccount = new Map<string, Promise<Stripe | null>>();
let configPromise: Promise<AppConfig> | null = null;

export class StripeUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StripeUnavailableError';
  }
}

/** La publishable key es la MISMA para plataforma y cuentas conectadas. */
function getConfig(): Promise<AppConfig> {
  if (!configPromise) {
    configPromise = (async () => {
      const res = await fetch(`${BASE_URL}/api/config`);
      if (!res.ok) throw new StripeUnavailableError('no_config');
      return (await res.json()) as AppConfig;
    })().catch((err) => {
      // Un fallo de red no debe dejar la config envenenada para siempre.
      configPromise = null;
      throw err;
    });
  }
  return configPromise;
}

/**
 * Carga Stripe.js (una vez por cuenta), con la publishable key del backend.
 * El `import()` es dinámico a propósito: así la librería queda en un chunk
 * aparte y la demo (VITE_MOCK=1) no la descarga nunca.
 *
 * @param connectedAccountId `acct_…` del restaurante cuando el cargo es
 *   DIRECTO (lo manda el backend en `connected_account_id`). Sin él, es un
 *   cargo de plataforma y todo funciona como siempre.
 */
export function getStripe(connectedAccountId?: string | null): Promise<Stripe | null> {
  if (IS_MOCK) return Promise.resolve(null);
  const key = connectedAccountId ?? '';
  let cached = stripeByAccount.get(key);
  if (!cached) {
    cached = (async () => {
      const config = await getConfig();
      const pk = config.stripe_publishable_key;
      if (!pk) throw new StripeUnavailableError('no_publishable_key');
      const { loadStripe } = await import('@stripe/stripe-js');
      return connectedAccountId
        ? loadStripe(pk, { stripeAccount: connectedAccountId })
        : loadStripe(pk);
    })().catch((err) => {
      stripeByAccount.delete(key);
      throw err;
    });
    stripeByAccount.set(key, cached);
  }
  return cached;
}

async function requireStripe(connectedAccountId?: string | null): Promise<Stripe> {
  const stripe = await getStripe(connectedAccountId);
  if (!stripe) throw new StripeUnavailableError('stripe_not_loaded');
  return stripe;
}

/**
 * Crea un PaymentMethod a partir del Card Element.
 * Devuelve el `pm_…` que `POST /api/mesas` exige para la garantía con tarjeta.
 *
 * Connect (v2.24): SIEMPRE se crea en la PLATAFORMA, aunque el cargo termine
 * siendo directo. El backend lo clona a la cuenta del restaurante cuando hace
 * falta (`clonePaymentMethodToAccount`), así que el front no necesita saber el
 * riel al momento de leer la tarjeta — y no lo sabe todavía.
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
 *
 * @param connectedAccountId presente cuando el intent vive en la cuenta del
 *   restaurante (direct charge): sin inicializar Stripe.js con esa cuenta, el
 *   3DS es inconfirmable. Ausente = cargo de plataforma, como siempre.
 */
export async function confirmCardPayment(
  clientSecret: string,
  connectedAccountId?: string | null,
): Promise<{ ok: true } | { ok: false; error: string; definitive: boolean }> {
  const stripe = await requireStripe(connectedAccountId);
  const { error } = await stripe.confirmCardPayment(clientSecret);
  if (error) {
    // B-06: un rechazo del banco (`card_error`) mata el intento y ahí sí
    // corresponde clave nueva. Un `api_connection_error` NO dice nada: el 3DS
    // pudo haberse confirmado igual, y rotar la clave sería cobrar dos veces.
    const definitive = error.type === 'card_error' || error.type === 'validation_error';
    return {
      ok: false,
      error: error.message ?? 'Tu banco no autorizó la operación.',
      definitive,
    };
  }
  return { ok: true };
}

/**
 * Guarda una tarjeta nueva: confirma el SetupIntent que crea el backend
 * (`POST /api/payment-methods/setup-intent`) y devuelve el `pm_…` resultante,
 * que después se registra con `POST /api/payment-methods`.
 *
 * Connect: SIEMPRE plataforma. Las tarjetas guardadas viven en la bóveda de
 * PayMe, no en la del restaurante (por eso el riel directo ignora
 * `save_payment_method`); guardar desde Cuenta sigue siendo de plataforma.
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
