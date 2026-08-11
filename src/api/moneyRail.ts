import type { AppConfig } from './types';

/**
 * MODO MONETARIO · `D-FF-2-BIS` (Mati, 2026-08-10).
 *
 * Espejado en `contract-mirror/services/moneyRail.js` desde el inventario del
 * dueño en `0ce21f4`. **El front LEE esto; no lo decide ni lo hardcodea.**
 *
 * ─── LAS DOS PREGUNTAS, QUE BAJO `sandbox` SE SEPARAN ───────────────────────
 *
 * ```
 * payments_enabled   ¿el flujo de pago está habilitado?   sandbox → sí
 * real_money         ¿se mueve dinero de verdad?          sandbox → NO
 * ```
 *
 * Con `disabled` las dos eran `false` y **nadie notaba que eran dos preguntas
 * distintas**. Por eso el emisor las publica como campos separados.
 *
 * 🔴 **`real_money` SE LEE, JAMÁS SE DEDUCE DE `mode`.** Un front que hardcodee
 * «sandbox y disabled son seguros» miente el día que aparezca un modo nuevo. Y
 * el emisor ya cometió y documentó la versión negativa de ese error: *«un
 * `!== 'disabled'` habilitaría cualquier basura»*.
 *
 * ─── 🔴 EL FAIL-CLOSED NO ES SOBRE EL CARTEL: ES SOBRE LA TARJETA ───────────
 *
 * La tentación es tratarlo como «mostrar o no mostrar el aviso de tarjeta de
 * prueba». Ahí está la trampa, porque **las dos salidas son malas**:
 *
 * ```
 * mostrar el cartel con real_money=true  → le decís a alguien con dinero real
 *                                          que use una tarjeta falsa; su pago falla
 * ocultarlo con real_money=false         → alguien tipea su tarjeta REAL
 * ```
 *
 * **Elegir entre esas dos es elegir cuál error cometer.** La salida es la misma
 * que usa `wallet_rail`: **si no se puede determinar el estado, NO SE HABILITA
 * LA SUPERFICIE.** Nadie tipea un número de tarjeta cuando no sabemos qué pasa
 * con él. *(Decisión del Bibliotecario, 2026-08-11.)*
 *
 * ```
 * real_money === false  LEÍDO   → flujo de tarjeta + cartel de prueba
 * real_money === true   LEÍDO   → flujo de tarjeta, sin cartel
 * cualquier otra cosa           → NO se ofrece cargar tarjeta, y se dice por qué
 * ```
 *
 * **Así el cartel deja de ser una decisión de riesgo: sólo aparece cuando
 * `real_money` es un `false` LEÍDO.** Nunca por default, nunca por deducción.
 *
 * ⚠️ **LO QUE ESTE MÓDULO NO PUEDE ACREDITAR, y conviene no confundirlo.** Lo
 * que hace seguro a `sandbox` **no es el modo: es que la clave de Stripe sea de
 * prueba.** El emisor lo dice y lo hace cumplir en el arranque
 * (`middleware/envValidation.js`): `sandbox` con una clave `sk_live_…` cobraría
 * de verdad, y el proceso no arranca. **Desde el front eso no se puede
 * verificar.** Leer `real_money: false` acredita lo que el backend DECLARA, no
 * la clave con la que corre.
 *
 * ✅ **No es un defecto: es la división correcta.** Lo que sí sería un defecto
 * es que alguien lea este `real_money: false` como si fuera una medición de
 * este repo.
 *
 * 🔴 **Y el corolario, que NO se resuelve acá y por eso se escribe** (aporte del
 * Bibliotecario, 2026-08-11): **si algún día el backend publicara `real_money`
 * sin ese acople en el arranque, este lector seguiría diciendo lo mismo y el
 * cartel seguiría apareciendo — sin nada que lo respalde.**
 *
 * **La declaración y la garantía viven en repos distintos y nada las ata.** No
 * hay guarda de este lado que pueda notarlo: desde acá los dos mundos se ven
 * IDÉNTICOS. Si alguna vez se quiere cerrar, se cierra del lado del emisor —
 * publicando algo que dependa del acople y no de una constante— y eso es orden
 * suya, no nuestra.
 */

export type MoneyRailStatus =
  /** Todavía no contestó el backend. Superficie de tarjeta CERRADA. */
  | 'pending'
  /** Contestó con la forma exacta del contrato. Manda él. */
  | 'authoritative'
  /** No hay clave `money_rail`: backend previo a `D-FF-2`. CERRADA. */
  | 'absent'
  /** Forma inesperada (tipo, claves de más o de menos). CERRADA. */
  | 'malformed';

export interface MoneyRailState {
  /**
   * 🔴 ¿Se puede ofrecer que alguien escriba una tarjeta? Fail-closed a `false`.
   *
   * Es lo único que la UI debe consultar para decidir si abre el formulario.
   * **No es `payments_enabled`**: aunque los pagos estén habilitados, si no
   * sabemos si el dinero es real no se pide una tarjeta.
   */
  readonly puedeCargarTarjeta: boolean;
  /**
   * ¿Mostrar el cartel de tarjeta de prueba? **Sólo con un `false` LEÍDO.**
   * Nunca por default: mostrarlo de más es tan malo como ocultarlo de menos.
   */
  readonly mostrarAvisoDePrueba: boolean;
  /** El modo crudo que declaró el emisor, para diagnóstico. Nunca para decidir. */
  readonly mode: string | null;
  readonly status: MoneyRailStatus;
  /** Claves fuera del conjunto cerrado, para el reporte. Vacío si no hay. */
  readonly offendingKeys: readonly string[];
}

/** Estado cerrado: no se ofrece tarjeta y no se muestra ningún cartel. */
const CERRADO: MoneyRailState = {
  puedeCargarTarjeta: false,
  mostrarAvisoDePrueba: false,
  mode: null,
  status: 'pending',
  offendingKeys: [],
};

export const MONEY_RAIL_CERRADO: MoneyRailState = CERRADO;

/** El conjunto CERRADO del contrato. Una clave de más es forma inesperada. */
const CLAVES = Object.freeze(['mode', 'payments_enabled', 'real_money']);

function esObjetoPlano(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Lee la capability de una respuesta de `GET /api/config` **sin confiar en el
 * tipo**: el backend desplegado puede ser de otra versión que la que este repo
 * espeja, y de hecho lo fue —`money_rail` estuvo vivo en producción tres días
 * antes de que el contrato lo declarara—.
 */
export function readMoneyRail(config: unknown): MoneyRailState {
  if (!esObjetoPlano(config)) return { ...CERRADO, status: 'malformed' };
  const features = (config as Partial<AppConfig>).features;
  if (!esObjetoPlano(features)) return { ...CERRADO, status: 'malformed' };

  const raw = features.money_rail;
  // Ausencia = backend previo a `D-FF-2`. Cae del lado seguro sin ambigüedad.
  if (raw === undefined) return { ...CERRADO, status: 'absent' };
  if (!esObjetoPlano(raw)) return { ...CERRADO, status: 'malformed' };

  const sobrantes = Object.keys(raw).filter((k) => !CLAVES.includes(k));
  if (sobrantes.length > 0) {
    // Una clave de más puede ser un campo nuevo inofensivo o un permiso por
    // principal. No se adivina: se cierra y se reporta.
    return { ...CERRADO, status: 'malformed', offendingKeys: sobrantes };
  }

  const { mode, payments_enabled: pagos, real_money: real } = raw;
  // 🔴 Los tres se exigen con su tipo EXACTO. `real === false` no alcanza si
  // `pagos` vino `undefined`: eso sería una respuesta a medias, y una respuesta
  // a medias no acredita nada sobre la otra mitad.
  if (typeof mode !== 'string' || typeof pagos !== 'boolean' || typeof real !== 'boolean') {
    return { ...CERRADO, status: 'malformed' };
  }

  return {
    // Se ofrece tarjeta sólo si los pagos están habilitados Y sabemos si el
    // dinero es real. Las dos condiciones son leídas, ninguna deducida.
    puedeCargarTarjeta: pagos,
    // 🔴 SÓLO con un `false` leído. `!real` sobre un valor no verificado sería
    // exactamente la deducción que este módulo existe para no hacer.
    mostrarAvisoDePrueba: pagos && real === false,
    mode,
    status: 'authoritative',
    offendingKeys: [],
  };
}

// ─── Estado compartido ──────────────────────────────────────────────────────
//
// Mismo molde que `walletRail.ts`: un store chico con `useSyncExternalStore`,
// la capability pedida UNA vez por carga, y el estado inicial `pending` — que
// acá significa **la superficie de tarjeta cerrada**. Nadie escribe un número
// mientras no sepamos qué pasa con él, ni siquiera durante el primer render.

import { useEffect, useSyncExternalStore } from 'react';
import { api } from './index';

let state: MoneyRailState = CERRADO;
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emitir(next: MoneyRailState): void {
  state = next;
  for (const l of [...listeners]) l();
}

export function applyMoneyRailConfig(config: unknown): void {
  emitir(readMoneyRail(config));
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

const getState = (): MoneyRailState => state;

/** Sólo para tests: vuelve al estado inicial, o sea la superficie CERRADA. */
export function resetMoneyRailForTests(): void {
  state = CERRADO;
  inFlight = null;
  for (const l of [...listeners]) l();
}

/**
 * Pide la capability una sola vez por carga. Idempotente.
 *
 * Un fallo de red **no** deja la promesa envenenada: se limpia para que el
 * próximo montaje reintente. Mientras tanto el estado sigue siendo `pending`,
 * **que acá NO es «todavía no sé, mostrá algo»: es «no se ofrece tarjeta»**.
 */
export function ensureMoneyRailCapability(): Promise<void> {
  if (state.status !== 'pending') return Promise.resolve();
  if (!inFlight) {
    inFlight = api
      .getConfig()
      .then((config) => { applyMoneyRailConfig(config); })
      .catch(() => {
        // Silencio deliberado: sin capability la superficie queda cerrada, que
        // es el estado correcto. Ruidear acá sería alarmar por el caso seguro.
      })
      .finally(() => { inFlight = null; });
  }
  return inFlight;
}

/**
 * El hook que usan las pantallas. Devuelve el estado completo y no un booleano
 * suelto, para que nadie tenga que acordarse de consultar el segundo campo —
 * que acá es la diferencia entre «mostrar el cartel» y «ofrecer la tarjeta».
 */
export function useMoneyRail(): MoneyRailState {
  useEffect(() => { void ensureMoneyRailCapability(); }, []);
  return useSyncExternalStore(subscribe, getState, getState);
}
