import type { StripeCardElement } from '@stripe/stripe-js';
import { canUseCardRail, useMoneyRail } from '../api/moneyRail';
import { useIdioma } from '../i18n/idioma';
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
  /** Hay una intención durable previa: continuarla no inicia otra operación. */
  continuation?: boolean;
  /**
   * 🔴 P23-AF-01 · CIERRA EL CAMPO DE STRIPE DURANTE LA VENTANA.
   *
   * La pantalla de pago deshabilita sus nueve controles mientras el journal no
   * dijo si hay un replay pendiente. **Este campo se quedaba afuera, y no por
   * olvido: no es un control HTML.** Vive en un iframe de otro origen, así que
   * `disabled={...}` no lo toca y **una enumeración de controles del DOM no lo
   * ve** — que es exactamente cómo se me escapó.
   *
   * El gate va por la API del SDK: `element.update({ disabled })`.
   */
  disabled?: boolean;
}

export const CARD_RAIL_UNAVAILABLE_COPY = 'Todavía no está disponible';

export function CardRailUnavailable() {
  const { t } = useIdioma();
  return (
    <div className="note" role="status">
      <b>{t('Tarjeta de crédito o débito')}</b> · {t(CARD_RAIL_UNAVAILABLE_COPY)}
    </div>
  );
}

export function CardField({ onReady, onChange, continuation = false, disabled = false }: Props) {
  const { t } = useIdioma();
  const moneyRail = useMoneyRail();
  const { mostrarAvisoDePrueba, puedeCargarTarjeta } = moneyRail;
  const cardRailAvailable = canUseCardRail({ puedeCargarTarjeta }, continuation);
  const holder = useRef<HTMLDivElement | null>(null);
  /**
   * El elemento montado y el `disabled` vigente, en refs: el efecto de montaje
   * corre una sola vez y no puede leer props posteriores, y **re-montar el
   * campo por un cambio de `disabled` perdería lo que la persona tipeó**.
   */
  const cardRef = useRef<StripeCardElement | null>(null);
  const disabledRef = useRef(disabled);
  useEffect(() => {
    disabledRef.current = disabled;
    // `update` es idempotente y no toca el contenido: sólo la interacción.
    cardRef.current?.update({ disabled });
  }, [disabled]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!cardRailAvailable) {
      setLoading(false);
      setLoadError(null);
      cardRef.current = null;
      onReady(null);
      onChange?.({ complete: false, error: null, empty: true });
      return;
    }
    let cancelled = false;
    let card: StripeCardElement | null = null;

    setLoading(true);
    setLoadError(null);

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
         *      `js.stripe.com` y una ruta relativa resuelve contra ÉL.
         *      🔴 ACTUALIZADO el 2026-08-10: acá decía «`app.paymemx.com` no
         *      tiene DNS ni TLS todavía». **Lo tiene**, y sirve la webapp. Este
         *      requisito ya NO bloquea; queda el 2;
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
              // Hex literal y no `var(--action)`: Stripe Elements corre en un
              // iframe de otro origen y no ve las variables de este documento.
              // Migrado con D-EJE-8 (navy nuevo): acá NADA lo hubiera avisado.
              color: '#101e3b',
              fontFamily: "'DM Sans', sans-serif",
              '::placeholder': { color: '#64748b' },
            },
            invalid: { color: '#dc2626', iconColor: '#dc2626' },
          },
        });
        card.on('change', (e) => {
          onChange?.({ complete: e.complete, error: e.error?.message ?? null, empty: e.empty });
        });
        // El estado inicial también se aplica: si el campo se monta DENTRO de
        // la ventana, nace deshabilitado en vez de habilitarse un instante.
        card.update({ disabled: disabledRef.current });
        card.mount(holder.current);
        cardRef.current = card;
        setLoading(false);
        onReady(card);
      } catch {
        if (!cancelled) {
          setLoading(false);
          setLoadError(t('No pudimos cargar el formulario de pago. Revisa tu conexión.'));
        }
      }
    })();

    return () => {
      cancelled = true;
      cardRef.current = null;
      onReady(null);
      // Al desmontar, el estado del padre debe volver a "vacío": si quedara
      // `complete: true` colgado, el botón de pagar/garantizar seguiría
      // habilitado con un iframe nuevo VACÍO (gate bypasseado).
      onChange?.({ complete: false, error: null, empty: true });
      card?.destroy();
    };
    // onReady/onChange se asumen estables (useCallback en el padre).
  }, [cardRailAvailable, onReady, onChange]);

  if (!cardRailAvailable) return <CardRailUnavailable />;

  if (loadError) {
    return (
      <div className="form-error" role="alert">
        {loadError}
      </div>
    );
  }

  return (
    <div>
      {/* 🔴 EL CARTEL DE TARJETA DE PRUEBA VA ACÁ, Y ACÁ ES LA DECISIÓN.
          `D-FF-2-BIS` · copy ratificada por Mati el 2026-08-11.

          Va DENTRO de `CardField` y no en las pantallas que lo usan, por dos
          motivos que se refuerzan:

          1. **Es donde se ESCRIBE el número.** Un aviso leído tres pantallas
             antes no está presente cuando la persona tipea. Requisito explícito
             del Bibliotecario.
          2. **Lo usan TRES pantallas** —garantía en `CreateMesaFlow`, pago en
             `MesaScreen`, alta en `CardsPanel`— y mañana puede usarlo una
             cuarta. Ponerlo acá lo cubre **por construcción**; ponerlo en cada
             call site sería una lista escrita a mano que envejece en el primer
             lugar nuevo que nadie recuerde.

          ⚠️ Y lo que este cartel NO acredita, dicho donde se escribe: **lo que
          hace seguro al modo prueba no es el modo, es que la clave de Stripe
          sea de prueba** — el backend lo impone en su arranque
          (`middleware/envValidation.js`). Desde acá se lee lo que el backend
          DECLARA, no la clave con la que corre. */}
      {mostrarAvisoDePrueba && (
        <div className="note note-teal" style={{ marginBottom: 12 }} role="note">
          {t('Esto es una prueba. Usa una tarjeta de prueba — no hace falta la tuya, y no la queremos.')}
        </div>
      )}
      <div
        ref={holder}
        className="input"
        style={{ padding: '15px 14px', marginBottom: loading ? 4 : 12 }}
      />
      {loading && <div className="caption">{t('Cargando el formulario seguro…')}</div>}
    </div>
  );
}
