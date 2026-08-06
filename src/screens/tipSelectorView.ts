import { stringToCents, tipFromBps } from '../utils/money';

/**
 * Lógica PURA del selector de propina — `SPEC_APP.md` §1.5 bis, ratificado el
 * 2026-08-05.
 *
 * Existe por UN defecto concreto, medido en `MesaScreen.tsx`: el estado
 * arrancaba en `useState(15)` con modo `'pct'`, y volvía a 15 en cada mesa
 * nueva. **Quien nunca tocaba el selector pagaba 15 % de su parte, y el payload
 * salía con `tip_bps: 1500` como si lo hubiera elegido.** El sistema elegía por
 * la persona, y elegía con su plata.
 *
 * Lo que este módulo aporta no es una cuenta nueva —las cuentas son las mismas,
 * `tipFromBps` y `stringToCents` de siempre— sino que **"todavía no elegí" sea
 * un estado que existe**: `TipChoice` no puede representar un porcentaje que
 * nadie tocó, así que el default de 15 no se puede volver a escribir sin
 * inventar un caso nuevo del tipo. El compilador es parte del arreglo.
 *
 * Nada de acá toca red, estado ni React: la pantalla sigue siendo la dueña del
 * pago; este módulo sólo responde preguntas sobre la propina.
 */

/**
 * El estado de la propina. `'unset'` es el tercer valor que pide el spec, y
 * **no es una tercera pestaña**: no se muestra como opción, es la ausencia de
 * elección. Notar que `pct` sólo existe DENTRO de la variante elegida.
 */
export type TipChoice =
  | { readonly mode: 'unset' }
  | { readonly mode: 'pct'; readonly pct: number }
  | { readonly mode: 'custom' };

/**
 * El estado inicial, y el de cada mesa nueva. **No hay otro punto de partida.**
 * Cualquier valor distinto acá es el defecto original con otro número.
 */
export const NO_TIP_CHOSEN: TipChoice = { mode: 'unset' };

/**
 * Presets del spec §1.5 bis: `[0, 5, 10, 15, 20]` más "Otro".
 *
 * 🔴 El 5 % entra **con** el retiro del default y no antes: agregarlo mientras
 * el selector arrancaba en 15 dejaba cinco píldoras con una pre-elegida, o sea
 * más superficie para el mismo defecto.
 *
 * El 0 % es una opción de primera clase y va PRIMERO, como cualquier otra: no
 * tiene tratamiento visual propio ni vive fuera de la lista.
 */
export const TIP_OPTIONS: readonly number[] = [0, 5, 10, 15, 20];

/** ¿La persona eligió algo? El 0 % elegido cuenta como elección. */
export function tipIsChosen(tip: TipChoice): boolean {
  return tip.mode !== 'unset';
}

/**
 * D7 (v2.17): la propina es % de tu parte IGUALITARIA (total ÷ N), no de tu
 * consumo. Réplica exacta de `tipFromBps`; el cobro real lo computa el server y
 * el comprobante usa SU `tip_cents`.
 *
 * Sin elección devuelve **0**, que es lo único cierto en ese momento: la
 * pantalla muestra la base sola y nunca un total con un porcentaje adivinado.
 */
export function tipCentsFor(
  tip: TipChoice,
  base: { totalCents: number; participants: number; customStr: string },
): number {
  if (tip.mode === 'unset') return 0;
  if (tip.mode === 'custom') {
    try {
      return stringToCents(base.customStr || '0');
    } catch {
      return 0;
    }
  }
  return tipFromBps(base.totalCents, base.participants || 1, tip.pct * 100);
}

/** Los dos campos EXCLUYENTES del contrato (`tip_cents` y `tip_bps` juntos → 400). */
export type TipPayload = { readonly tip_bps: number } | { readonly tip_cents: number };

/**
 * Lo que efectivamente viaja en el `POST /mesas/:code/pay`.
 *
 * 🔴 `'unset'` llega acá por UN solo camino: el fallback del spec, cuando el
 * selector no se pudo mostrar. Ahí sale **`tip_bps: 0`, nunca 1500**. Cobrar
 * una propina que nadie eligió es peor que no cobrar ninguna: es plata de la
 * persona movida por un default. Por el otro camino —el selector visible y sin
 * elegir— no se paga: la pantalla frena antes.
 *
 * El 0 viaja EXPLÍCITO, no por omisión: el contrato acepta `0` (`safeInt.min(0)`).
 */
export function tipPayloadFor(tip: TipChoice, tipCents: number): TipPayload {
  if (tip.mode === 'custom') return { tip_cents: tipCents };
  return { tip_bps: tip.mode === 'pct' ? tip.pct * 100 : 0 };
}

/**
 * Token de la propina dentro de la clave de idempotencia (B-06).
 *
 * 🔴 Se deriva **del payload**, no del estado de la UI, y eso es a propósito:
 * el scope promete ser el CONTENIDO del pago, con los mismos campos que hashea
 * el backend. Si el token dijera "no elegí" y el cuerpo dijera `tip_bps: 0`,
 * dos scopes locales distintos taparían un mismo cobro.
 */
export function tipScopeToken(payload: TipPayload): string {
  return 'tip_cents' in payload ? `c${payload.tip_cents}` : `b${payload.tip_bps}`;
}
