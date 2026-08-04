import { useEffect, useSyncExternalStore } from 'react';
import { api } from './index';

/**
 * OLA 5D · el riel saldo lo apaga el BACKEND, y este módulo lo LEE.
 *
 * ## Qué defecto corrige
 *
 * Hasta acá `WALLET_RAIL_ENABLED` era una **constante propia de este repo**. El
 * apagado funcionaba, estaba verificado y era sólido — pero su autoridad estaba
 * en el lugar equivocado: wallet estaba apagado **porque el front decidió
 * apagarlo**, no porque el sistema lo declarara apagado. Un deploy de este front
 * con otro valor lo reencendía sin que el backend se enterara.
 *
 * La constitución manda lo contrario: *"la capability es global y autoritativa
 * del backend; el frontend no la decide ni la hardcodea"*. Desde v2.31.0 esa
 * capability existe (`GET /api/config` → `features.wallet_rail`, espejada en
 * `contract-mirror/routes/config.js:43-46`), así que el front deja de decidir.
 *
 * ## 🔴 CORRECCIÓN · leer la capability NO es el gate de dinero
 *
 * **Afirmación previa de este repo, REFUTADA (ORDEN 3A):** que con la
 * capability publicada el riel quedaba apagado y la autoridad, resuelta.
 *
 * **Publicar una capability hace autoritativa la DECLARACIÓN, no la EJECUCIÓN.**
 * Entre `9d874c4` (v2.31.0) y `679161d` (v2.33.0) el backend **seguía
 * aceptando** topups, transferencias, emisión de CLABE, garantía wallet y pago
 * wallet, y el alta seguía acuñando una fila de dinero electrónico por usuario
 * nuevo. La capability decía "apagado" mientras los endpoints funcionaban.
 *
 * Desde v2.33.0 el gate existe de verdad en `services/walletRail.js`, y siete
 * entrypoints devuelven `410 { error: 'feature_removed' }`.
 *
 * **Qué significa este módulo entonces, con precisión:** es la capa que impide
 * OFRECER lo que no existe. No impide, ni impidió nunca, una obligación wallet
 * nueva — eso lo hace el backend. Las dos capas son necesarias y **ninguna
 * sustituye a la otra**: sin ésta la UI ofrece un riel muerto; sin la del
 * backend, cualquier cliente lo usa igual.
 *
 * ## Fail-closed, y en qué dirección para cada campo
 *
 * Los dos campos fallan hacia el lado seguro, **y el lado seguro no es el mismo
 * para los dos**. Esto no es una inconsistencia: es la misma regla —conservar lo
 * ratificado— aplicada a dos superficies distintas.
 *
 * - `enabled` (riel saldo) falla a **false**. Si la capability no viene, viene
 *   mal formada, o la red se cae, wallet queda APAGADO. Nunca al revés. Incluso
 *   antes de que el backend conteste el estado inicial es `false`, así que no
 *   existe una ventana en la que la UI de saldo aparezca y después desaparezca.
 * - `account_activity` (historial y estadísticas propias) falla a **true**.
 *   Esas rutas leen `payment_attempts`, **no** tablas de wallet, y la
 *   ratificación manda conservarlas. Apagarlas ante un fallo de red sería
 *   repetir exactamente `07f0ba2`, que escondió superficie card-only ratificada
 *   por fundir los dos gates. Fallar "cerrado" ahí significa **no ocultar**.
 *
 * ## Conjunto CERRADO de claves
 *
 * El emisor compara `Object.keys(wallet_rail).sort()` contra
 * `['account_activity', 'enabled']` y su suite se rompe si aparece un campo
 * nuevo. Este consumidor aplica **el mismo conjunto cerrado**, porque un backend
 * distinto del espejado no es una hipótesis: es el caso normal de un deploy
 * desincronizado, y el espejo no puede impedirlo.
 *
 * Una lista de prohibidos sólo defiende contra lo que ya se te ocurrió; el
 * conjunto cerrado atrapa el campo que nadie previó — por ejemplo un
 * `enabled_for_restaurant`, que es justo el permiso por cuenta que la
 * ratificación prohíbe. Cuando el campo extra tiene forma de permiso por
 * principal, el estado se marca `principal_scoped` para que sea un STOP
 * reportable y no un `malformed` más entre otros.
 *
 * **Ningún permiso por cuenta, rol, usuario, restaurante ni sucursal reenciende
 * el riel desde acá**: no hay rama que lo permita. Un payload con esa forma
 * apaga wallet *y* se denuncia.
 *
 * ## Nada se borra
 *
 * `TopupScreen`, `TransferScreen`, los ocho métodos del riel en la fachada y
 * `payment_type: 'wallet'` en los decoders siguen en el árbol, durmientes. Lo
 * único que cambió es **quién decide** si se pueden alcanzar.
 */

/** El juego COMPLETO de claves que el contrato publica. Cerrado a propósito. */
export const WALLET_RAIL_KEYS: readonly string[] = ['account_activity', 'enabled'];

/**
 * Formas de clave que delatan un permiso por principal. La ratificación es
 * explícita: *"no existe permiso por cuenta, rol, usuario ni restaurante que
 * pueda reactivar wallet durante el MVP"*. Si una aparece, no alcanza con
 * ignorarla: hay que poder reportarla.
 */
const PRINCIPAL_SCOPED = /user|account|role|restaurant|branch|sucursal|principal|customer|merchant|tenant|per_|_for_/i;

export type WalletRailStatus =
  /** Todavía no contestó el backend. Riel APAGADO — es el estado inicial. */
  | 'pending'
  /** El backend contestó con la forma exacta del contrato. Manda él. */
  | 'authoritative'
  /** No hay clave `wallet_rail`: backend previo a OLA 5. Riel APAGADO. */
  | 'absent'
  /** Forma inesperada (tipo, claves de más o de menos). Riel APAGADO. */
  | 'malformed'
  /** Trae algo con forma de permiso por principal. Riel APAGADO **y STOP**. */
  | 'principal_scoped';

export interface WalletRailState {
  /** Única fuente del riel saldo en la UI. Fail-closed a `false`. */
  readonly walletRailEnabled: boolean;
  /** Historial y estadísticas propias (card-only). Fail-**open** a `true`. */
  readonly accountActivity: boolean;
  readonly status: WalletRailStatus;
  /** Claves fuera del conjunto cerrado, para el reporte. Vacío si no hay. */
  readonly offendingKeys: readonly string[];
}

const CLOSED: WalletRailState = {
  walletRailEnabled: false,
  accountActivity: true,
  status: 'pending',
  offendingKeys: [],
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Lee la capability de una respuesta de `GET /api/config` **sin confiar en
 * nada**: el argumento es `unknown` porque puede venir de un backend de otra
 * versión, de un proxy que reescribe, o de una respuesta cortada.
 *
 * Es una función pura y es donde vive toda la decisión: el store de abajo sólo
 * la envuelve. Así el comportamiento se puede fijar con tests sin librería de
 * render, que este repo no tiene.
 */
export function readWalletRail(config: unknown): WalletRailState {
  if (!isPlainObject(config)) return { ...CLOSED, status: 'malformed' };
  const features = config.features;
  if (!isPlainObject(features)) return { ...CLOSED, status: 'malformed' };

  const raw = features.wallet_rail;
  // Ausencia = backend previo a OLA 5. El emisor lo declara explícitamente y
  // por eso no hay booleano `supported` como en `account_birth_date`: acá el
  // fail-closed ya cae del lado seguro.
  if (raw === undefined) return { ...CLOSED, status: 'absent' };
  if (!isPlainObject(raw)) return { ...CLOSED, status: 'malformed' };

  const keys = Object.keys(raw).sort();
  const extras = keys.filter((k) => !WALLET_RAIL_KEYS.includes(k));
  const faltantes = WALLET_RAIL_KEYS.filter((k) => !keys.includes(k));
  if (extras.length > 0) {
    const scoped = extras.filter((k) => PRINCIPAL_SCOPED.test(k));
    return {
      ...CLOSED,
      status: scoped.length > 0 ? 'principal_scoped' : 'malformed',
      offendingKeys: extras,
    };
  }
  if (faltantes.length > 0) return { ...CLOSED, status: 'malformed', offendingKeys: [] };

  // Booleanos, no strings: un `"false"` es verdadero en JS y reencendería el
  // riel por una coerción. El emisor testea el tipo; acá se vuelve a exigir.
  if (typeof raw.enabled !== 'boolean' || typeof raw.account_activity !== 'boolean') {
    return { ...CLOSED, status: 'malformed' };
  }

  return {
    walletRailEnabled: raw.enabled,
    accountActivity: raw.account_activity,
    status: 'authoritative',
    offendingKeys: [],
  };
}

// ─── Store ────────────────────────────────────────────────────────────────────
// Un store mínimo con `useSyncExternalStore` en vez de un Provider: la
// capability es global por definición del contrato, y un contexto invitaría a
// alguien a pasarle un valor distinto por subárbol — que es exactamente el
// permiso por cuenta que la ratificación prohíbe. No hay dónde inyectarlo.

let state: WalletRailState = CLOSED;
const listeners = new Set<() => void>();

export function getWalletRailState(): WalletRailState {
  return state;
}

export function subscribeWalletRail(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Aplica una respuesta de config al store. Exportada para los tests y para el
 * loader; no la llama ninguna pantalla.
 */
export function applyWalletRailConfig(config: unknown): WalletRailState {
  const next = readWalletRail(config);
  if (next.status === 'principal_scoped') {
    // No hay a quién escalar desde el navegador, pero un apagado silencioso
    // haría indistinguible "el backend está bien" de "el backend intentó
    // reactivar wallet por cuenta". Se apaga Y se denuncia.
    console.error(
      '[payme] STOP · GET /api/config trajo wallet_rail con forma de permiso por principal: ' +
        `${next.offendingKeys.join(', ')}. El riel queda APAGADO. Reportar al Bibliotecario-Auditor.`,
    );
  }
  state = next;
  for (const listener of [...listeners]) listener();
  return next;
}

let inFlight: Promise<void> | null = null;

/** Sólo para tests: devuelve el store al estado inicial (riel apagado). */
export function resetWalletRailForTests(): void {
  state = CLOSED;
  inFlight = null;
  for (const listener of [...listeners]) listener();
}

/**
 * Pide la capability una sola vez por carga. Idempotente: la llaman todas las
 * pantallas que usan el hook, sin coordinarse.
 *
 * Un fallo de red **no** deja la promesa envenenada (mismo criterio que
 * `stripe.ts:53`): se limpia para que el próximo montaje reintente. Mientras
 * tanto el estado sigue siendo el inicial, o sea el riel apagado.
 */
export function ensureWalletRailCapability(): Promise<void> {
  if (state.status !== 'pending') return Promise.resolve();
  if (!inFlight) {
    inFlight = api
      .getConfig()
      .then((config) => {
        applyWalletRailConfig(config);
      })
      .catch(() => {
        // Silencio deliberado: sin capability el riel queda apagado, que es el
        // estado correcto. Ruidear acá sería alarmar por el caso seguro.
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

/**
 * El hook que usan las pantallas. Devuelve el estado completo, no un booleano
 * suelto, para que nadie tenga que acordarse de pedir el segundo campo.
 */
export function useWalletRail(): WalletRailState {
  useEffect(() => {
    void ensureWalletRailCapability();
  }, []);
  return useSyncExternalStore(subscribeWalletRail, getWalletRailState, getWalletRailState);
}
