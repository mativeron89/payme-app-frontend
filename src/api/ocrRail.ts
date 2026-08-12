import type { AppConfig } from './types';

/**
 * FORMATOS QUE EL LECTOR DE TICKETS ACEPTA · leídos del DUEÑO del contrato.
 *
 * Espejado en `contract-mirror/services/ocrRail.js` (inventario del dueño en
 * `a8611ec`). **El emisor lo publicó exactamente para esto** — su comentario lo
 * dice: *«para que el front construya su `accept` desde el DUEÑO del contrato y
 * no de una lista escrita a mano que ya se desincronizó una vez»*.
 *
 * ─── EL DEFECTO QUE CIERRA ──────────────────────────────────────────────────
 *
 * `CreateMesaFlow` tenía `accept="image/jpeg,image/png,image/webp,image/heic"`
 * **hardcodeado**. Amazon Textract procesa **jpeg y png, nada más**. O sea que
 * un HEIC —**el formato por defecto del iPhone**— se elegía, se subía entero,
 * pasaba la validación de magic bytes y **recién moría en el proveedor**.
 *
 * ⚠️ **Esto NO resuelve el problema, y conviene no venderlo así.** `accept` es
 * una SUGERENCIA al selector de archivos, no un gate: el iPhone puede entregar
 * un HEIC igual. **Deja de invitarlo, que es distinto de impedirlo.** Convertir
 * en el servidor es otra orden y necesita ratificación.
 *
 * ─── 🔴 POR QUÉ NO ALCANZA CON `provider_mime_types` ────────────────────────
 *
 * La orden decía «usá `provider_mime_types` como `accept`». **Mide de menos, y
 * el propio emisor explica por qué:**
 *
 * > *«En modo MOCK se siguen aceptando los cuatro, A PROPÓSITO: apretar el mock
 * > antes de que exista la decisión rompería la demo para todos los iPhone, que
 * > es justo la prueba que está por abrirse.»*
 *
 * **En mock nada llega a Textract, así que el HEIC funciona de punta a punta.**
 * Poner `provider_mime_types` sin mirar el modo **le angostaría el selector a
 * los iPhone en la demo** — exactamente la decisión que el backend tomó y
 * descartó de su lado.
 *
 * ```
 * mode 'real'  → provider_mime_types   no invitar lo que va a dar 415
 * mode 'mock'  → accepted_mime_types   los cuatro; nada llega al proveedor
 * ```
 *
 * ─── 🔴 EL FALLBACK, Y EL CRITERIO DETRÁS ───────────────────────────────────
 *
 * Si la capability no viene —backend previo, forma inesperada, red caída— no
 * hay listas que leer y el fallback es una constante. **Va la INTERSECCIÓN**:
 *
 * ```
 * FALLBACK = image/jpeg, image/jpg, image/png
 * ```
 *
 * **Es el único conjunto correcto en los DOS mundos.** El razonamiento es la
 * asimetría del error, no la permisividad:
 *
 * ```
 * estricto y era mock   el selector no ofrece HEIC · falla TEMPRANO y a la vista
 * permisivo y era real  se elige, se sube, se espera → 415 DESPUÉS del esfuerzo
 * ```
 *
 * **Fallar tarde es peor que fallar temprano**, y el 415 además hoy cae en el
 * manejo de error genérico del front. Y como `accept` no es un gate, el
 * fallback estricto **no bloquea a nadie**: deja de invitar.
 *
 * ⚠️ **El costo, declarado: contra un backend viejo en mock, un iPhone ve el
 * selector angostado sin necesidad.** Es real y es menor que una subida que
 * falla después de elegir la foto. **No afirmo que iOS convierta solo el HEIC
 * cuando el `accept` lo excluye** — es conducta de plataforma que no medí.
 */

export type OcrRailStatus = 'pending' | 'authoritative' | 'absent' | 'malformed';

export interface OcrRailState {
  /** Lo que va al `accept` del input. Nunca vacío. */
  readonly accept: string;
  /** El modo que declaró el emisor. Para diagnóstico, no para deducir formatos. */
  readonly mode: string | null;
  readonly status: OcrRailStatus;
}

/**
 * 🔴 La intersección, y la única lista hardcodeada que queda en el front.
 *
 * `image/jpg` va incluido porque el emisor lo normaliza a `image/jpeg`
 * (`proveedorSoporta`), así que ofrecerlo no invita nada que el proveedor
 * rechace.
 */
const FALLBACK = 'image/jpeg,image/jpg,image/png';

const CERRADO: OcrRailState = { accept: FALLBACK, mode: null, status: 'pending' };

export const OCR_RAIL_FALLBACK: OcrRailState = CERRADO;

function esObjetoPlano(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Una lista de MIME utilizable: array no vacío de strings con forma `tipo/sub`. */
function listaMime(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  const out = v.filter((x): x is string => typeof x === 'string' && /^[a-z]+\/[a-z0-9.+-]+$/i.test(x));
  return out.length === v.length ? out : null;
}

/**
 * Lee la capability sin confiar en el tipo: el backend desplegado puede ser de
 * otra versión que la que este repo espeja — y lo fue dos veces esta semana.
 */
export function readOcrRail(config: unknown): OcrRailState {
  if (!esObjetoPlano(config)) return { ...CERRADO, status: 'malformed' };
  const features = (config as Partial<AppConfig>).features;
  if (!esObjetoPlano(features)) return { ...CERRADO, status: 'malformed' };

  const raw = features.ocr;
  if (raw === undefined) return { ...CERRADO, status: 'absent' };
  if (!esObjetoPlano(raw)) return { ...CERRADO, status: 'malformed' };

  const provider = listaMime(raw.provider_mime_types);
  const aceptados = listaMime(raw.accepted_mime_types);
  const mode = typeof raw.mode === 'string' ? raw.mode : null;

  // Sin la lista del PROVEEDOR no hay nada que este módulo pueda mejorar sobre
  // el fallback: es la única que dice qué se procesa de verdad.
  if (!provider) return { ...CERRADO, mode, status: 'malformed' };

  // 🔴 `mock` es el ÚNICO caso que ensancha, y se exige LEÍDO. Un modo
  // desconocido —o ausente— no se interpreta como permisivo: se trata como el
  // mundo estricto, igual que `real_money` no se deduce de `mode`.
  const ensancha = mode === 'mock' && aceptados !== null;
  return {
    accept: (ensancha ? aceptados : provider).join(','),
    mode,
    status: 'authoritative',
  };
}

// ─── Estado compartido ──────────────────────────────────────────────────────
//
// Mismo molde que `moneyRail.ts` y `walletRail.ts`. El estado inicial es el
// FALLBACK, no un vacío: el input necesita un `accept` desde el primer render y
// «todavía no sé» no puede significar «ofrecé cualquier cosa».

import { useEffect, useSyncExternalStore } from 'react';
import { api } from './index';

let state: OcrRailState = CERRADO;
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

export function applyOcrRailConfig(config: unknown): void {
  state = readOcrRail(config);
  for (const l of [...listeners]) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

const getState = (): OcrRailState => state;

/** Sólo para tests: vuelve al fallback, que es el estado inicial. */
export function resetOcrRailForTests(): void {
  state = CERRADO;
  inFlight = null;
  for (const l of [...listeners]) l();
}

export function ensureOcrRailCapability(): Promise<void> {
  if (state.status !== 'pending') return Promise.resolve();
  if (!inFlight) {
    inFlight = api
      .getConfig()
      .then((config) => { applyOcrRailConfig(config); })
      .catch(() => {
        // Silencio deliberado: sin capability queda el fallback estricto, que es
        // el estado correcto. Ruidear acá sería alarmar por el caso seguro.
      })
      .finally(() => { inFlight = null; });
  }
  return inFlight;
}

/** Devuelve el estado completo: el `accept` y de dónde salió. */
export function useOcrRail(): OcrRailState {
  useEffect(() => { void ensureOcrRailCapability(); }, []);
  return useSyncExternalStore(subscribe, getState, getState);
}
