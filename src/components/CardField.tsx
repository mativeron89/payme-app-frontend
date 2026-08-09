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
        /**
         * 🔴 FASE 3 · SE RETIRÓ EL `cssSrc` A GOOGLE, Y EL COSTO SE DECLARA.
         *
         * Acá se le pasaba a Elements una hoja de `fonts.googleapis.com`. Era
         * el TERCER egress de tipografías del repo —el que no se ve leyendo el
         * `index.html`— y ocurría **al montar el campo**, sin que la persona
         * tocara nada.
         *
         * 🔴 ESTO ES UN FALLBACK TEMPORAL, NO UN CIERRE. `D-FUENTES-1` está
         * cerrada para la webapp y la landing; **esta superficie sigue
         * ABIERTA** y su restauración es trabajo pendiente del Carril 7. Quien
         * lea "cerrada" en el CHANGELOG y no lea esto se lleva la idea
         * equivocada, así que queda dicho acá también.
         *
         * CONSECUENCIA, medida y acotada: el `fontFamily` de abajo pide
         * `'DM Sans'`, que dentro del iframe ya no está. **El texto que se
         * tipea en el campo —número, vencimiento, CVC y su placeholder— pasa a
         * verse con el sans del sistema.** El resto de la pantalla NO cambia:
         * esa tipografía la sirve nuestra propia página.
         *
         * POR QUÉ NO SE REEMPLAZA YA. El contrato de Stripe sí lo soporta
         * (`CustomFontSource` = `{family, src, weight}`, `elements-group.d.ts:1149`),
         * pero exige dos cosas que hoy no existen:
         *   1. una URL ABSOLUTA a un host propio — el iframe corre en
         *      `js.stripe.com` y una ruta relativa resuelve contra ÉL; y
         *      `app.paymemx.com` no tiene DNS ni TLS todavía;
         *   2. **CORS** en ese host para `js.stripe.com`, porque una fuente
         *      cross-origin lo exige. Es configuración de hosting **no
         *      ratificada**, y acá no se inventa configuración.
         *
         * Queda como requisito con nombre en el Carril 7. Hay una tercera vía
         * —embeber la fuente como `data:` URI en el `src`— que se MIDIÓ y se
         * descartó: son ~30–55 KB en base64 por peso para un campo de
         * formulario, es una decisión de arquitectura que nadie ratificó, y no
         * está verificado que la CSP de Stripe la acepte.
         */
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
