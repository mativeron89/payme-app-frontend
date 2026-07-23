import type { StripeCardElement } from '@stripe/stripe-js';
import { useEffect, useRef, useState } from 'react';
import { getStripe } from '../api/stripe';

/**
 * Campo de tarjeta de Stripe Elements montado a mano (sin @stripe/react-stripe-js:
 * la regla del repo permite UNA sola dependencia nueva).
 *
 * Stripe renderiza el input dentro de un iframe propio — los datos de la tarjeta
 * NUNCA pasan por nuestro código ni por el backend de PayMe. Solo se puede
 * estilar vía la opción `style`, por eso los valores van acá y no en el CSS.
 */

/** Estado del campo: `empty` permite saber si el usuario ya empezó a tipear. */
export interface CardFieldState {
  complete: boolean;
  error: string | null;
  empty: boolean;
}

interface Props {
  /** Se llama con el elemento montado (o null al desmontar). */
  onReady(card: StripeCardElement | null): void;
  /** Se llama cuando cambia el estado del campo (y se RESETEA al desmontar). */
  onChange?(state: CardFieldState): void;
}

export function CardField({ onReady, onChange }: Props) {
  const holder = useRef<HTMLDivElement | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let card: StripeCardElement | null = null;

    (async () => {
      try {
        const stripe = await getStripe();
        if (cancelled || !stripe || !holder.current) return;
        const elements = stripe.elements();
        card = elements.create('card', {
          hidePostalCode: true,
          style: {
            base: {
              fontSize: '16px', // ≥16px: evita el zoom automático de iOS
              color: '#0f1f3d',
              fontFamily: "'DM Sans', sans-serif",
              '::placeholder': { color: '#64748b' },
            },
            invalid: { color: '#dc2626', iconColor: '#dc2626' },
          },
        });
        card.on('change', (e) => {
          onChange?.({ complete: e.complete, error: e.error?.message ?? null, empty: e.empty });
        });
        card.mount(holder.current);
        setLoading(false);
        onReady(card);
      } catch {
        if (!cancelled) {
          setLoading(false);
          setLoadError('No pudimos cargar el formulario de pago. Revisá tu conexión.');
        }
      }
    })();

    return () => {
      cancelled = true;
      onReady(null);
      // Al desmontar, el estado del padre debe volver a "vacío": si quedara
      // `complete: true` colgado, el botón de pagar/garantizar seguiría
      // habilitado con un iframe nuevo VACÍO (gate bypasseado).
      onChange?.({ complete: false, error: null, empty: true });
      card?.destroy();
    };
    // onReady/onChange se asumen estables (useCallback en el padre).
  }, [onReady, onChange]);

  if (loadError) {
    return (
      <div className="form-error" role="alert">
        {loadError}
      </div>
    );
  }

  return (
    <div>
      <div
        ref={holder}
        className="input"
        style={{ padding: '15px 14px', marginBottom: loading ? 4 : 12 }}
      />
      {loading && <div className="caption">Cargando el formulario seguro…</div>}
    </div>
  );
}
