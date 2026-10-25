import { useSyncExternalStore } from 'react';

/**
 * D464 · D465 · D466 · la foto del ticket (App Backend 2.193.0, PR72, sin
 * publicar), contrato `contract-mirror/contract/ticket-image-v1.json`.
 *
 * Mati eligió guardar la foto completa 90 días más una miniatura (D465) y, para
 * mostrarla, «Vamos por AE» (D466): la miniatura en la fila de Mesas (A) y el
 * visor a pantalla completa (E).
 *
 * 🔴 APAGADO. El Aviso de Privacidad 3.1.0 vigente dice que las imágenes de los
 * tickets no se conservan: nada se enciende hasta el Aviso nuevo de la abogada,
 * su publicación y la reaceptación. El dueño tiene su propia constante en
 * `false`; este módulo es la puerta del front:
 *
 * - **Sin la capacidad** (`features.ticket_image` ausente —el backend de hoy—,
 *   mal formada o con `enabled: false`) la app queda exactamente como antes: no
 *   negocia `ticket_image_version=1` en ningún pedido, no pide fotos y no
 *   muestra nada nuevo.
 * - **Con la capacidad**, y sólo entonces, los pedidos que muestran fotos la
 *   negocian, y las pantallas leen `ticket_image: { thumb, full }`.
 *
 * Las fotos viven sólo en memoria (`fotosDeTicketsEnMemoria`), nunca en el
 * almacenamiento del navegador. En el mock, la capacidad la enciende el seam
 * `payme.app.mock.ticket_image.v1 = encendido` (`apagado` publica el bloque del
 * dueño con la constante en `false`; sin el seam, el bloque no existe).
 */

export const CONTRATO_FOTO_DEL_TICKET = 'payme.app.ticket_image/v1';

/** La negociación exacta del dueño (`negotiation_param` = `negotiation_value`). */
export const PARAMETRO_FOTO_DEL_TICKET = 'ticket_image_version';
export const VALOR_FOTO_DEL_TICKET = '1';

export const MODOS_FOTO_DEL_TICKET = ['off', 'thumb', 'full', 'full_retained'] as const;
export type ModoFotoDelTicket = (typeof MODOS_FOTO_DEL_TICKET)[number];

/** Las claves exactas de `features.ticket_image` (`capacidad.claves` del contrato). */
export const CLAVES_CAPACIDAD_FOTO_DEL_TICKET = [
  'supported', 'enabled', 'mode', 'stores_thumb', 'stores_full', 'full_retention_days',
  'negotiation_param', 'negotiation_value', 'accepted_mime_types', 'thumb_max_side_px', 'full_max_side_px',
] as const;

/** Lo que trae cada mesa o ticket con la negociación: `{ thumb, full }`, dos booleanos. */
export interface FotoDelTicket {
  readonly thumb: boolean;
  readonly full: boolean;
}

function objetoPlano(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function clavesExactas(v: Record<string, unknown>, esperadas: readonly string[]): boolean {
  const claves = Object.keys(v).sort();
  const quiero = [...esperadas].sort();
  return claves.length === quiero.length && claves.every((c, i) => c === quiero[i]);
}

/**
 * `ticket_image` de una fila → `{ thumb, full }`, claves EXACTAS y booleanos.
 * Cualquier otra forma (o la ausencia) es «sin foto»: se ve el ícono de siempre.
 */
export function decodeFotoDelTicket(raw: unknown): FotoDelTicket | null {
  if (!objetoPlano(raw) || !clavesExactas(raw, ['thumb', 'full'])) return null;
  if (typeof raw.thumb !== 'boolean' || typeof raw.full !== 'boolean') return null;
  return { thumb: raw.thumb, full: raw.full };
}

/** ¿Hay algo que mostrar? Sin miniatura no hay foto en la fila (la completa sola no se anuncia). */
export function tieneFoto(foto: FotoDelTicket | null | undefined): foto is FotoDelTicket {
  return foto != null && foto.thumb;
}

// ─── La capacidad ─────────────────────────────────────────────────────────

export interface CapacidadFotoDelTicket {
  readonly modo: Exclude<ModoFotoDelTicket, 'off'>;
  readonly guardaCompleta: boolean;
  /** `full_retained`: a los cuántos días se borra la completa. `null` en los otros modos. */
  readonly diasDeLaCompleta: number | null;
}

/**
 * `features.ticket_image` → encendida sólo con la forma exacta del dueño:
 * las once claves, `supported` y `enabled` en `true`, un modo que guarda la
 * miniatura y la negociación `ticket_image_version=1`. Cualquier otra cosa la
 * apaga: puede ser otra semántica.
 */
export function decodeCapacidadFotoDelTicket(config: unknown): CapacidadFotoDelTicket | null {
  if (!objetoPlano(config) || !objetoPlano(config.features)) return null;
  const raw = config.features.ticket_image;
  if (!objetoPlano(raw) || !clavesExactas(raw, CLAVES_CAPACIDAD_FOTO_DEL_TICKET)) return null;
  if (raw.supported !== true || raw.enabled !== true) return null;
  if (raw.negotiation_param !== PARAMETRO_FOTO_DEL_TICKET || raw.negotiation_value !== VALOR_FOTO_DEL_TICKET) return null;
  const modo = raw.mode;
  if (modo !== 'thumb' && modo !== 'full' && modo !== 'full_retained') return null;
  if (raw.stores_thumb !== true || typeof raw.stores_full !== 'boolean') return null;
  if (raw.stores_full !== (modo !== 'thumb')) return null;
  const dias = raw.full_retention_days;
  if (modo === 'full_retained') {
    if (typeof dias !== 'number' || !Number.isSafeInteger(dias) || dias < 1) return null;
  } else if (dias !== null) {
    return null;
  }
  return { modo, guardaCompleta: raw.stores_full, diasDeLaCompleta: modo === 'full_retained' ? dias as number : null };
}

/**
 * Sin request propia: la alimenta `api.getConfig`, como Viajes. `pendiente`
 * hasta la primera config, y ahí la app se comporta como apagada.
 */
export type EstadoCapacidadFotoDelTicket =
  | { readonly estado: 'pendiente' }
  | { readonly estado: 'apagada' }
  | { readonly estado: 'encendida'; readonly capacidad: CapacidadFotoDelTicket };

const PENDIENTE: EstadoCapacidadFotoDelTicket = { estado: 'pendiente' };
const APAGADA: EstadoCapacidadFotoDelTicket = { estado: 'apagada' };
let actual: EstadoCapacidadFotoDelTicket = PENDIENTE;
const oyentes = new Set<() => void>();

function mismaCapacidad(a: EstadoCapacidadFotoDelTicket, b: EstadoCapacidadFotoDelTicket): boolean {
  if (a.estado !== b.estado) return false;
  if (a.estado !== 'encendida' || b.estado !== 'encendida') return true;
  return a.capacidad.modo === b.capacidad.modo && a.capacidad.guardaCompleta === b.capacidad.guardaCompleta
    && a.capacidad.diasDeLaCompleta === b.capacidad.diasDeLaCompleta;
}

export function aplicarConfigFotoDelTicket(config: unknown): boolean {
  const capacidad = decodeCapacidadFotoDelTicket(config);
  const siguiente: EstadoCapacidadFotoDelTicket = capacidad ? { estado: 'encendida', capacidad } : APAGADA;
  if (!mismaCapacidad(siguiente, actual)) {
    actual = siguiente;
    for (const oyente of [...oyentes]) oyente();
  }
  return actual.estado === 'encendida';
}

function suscribir(oyente: () => void): () => void {
  oyentes.add(oyente);
  return () => { oyentes.delete(oyente); };
}
const instantanea = (): EstadoCapacidadFotoDelTicket => actual;

/** La capacidad encendida, o `null` (apagada o todavía sin config). */
export function useCapacidadFotoDelTicket(): CapacidadFotoDelTicket | null {
  const e = useSyncExternalStore(suscribir, instantanea, instantanea);
  return e.estado === 'encendida' ? e.capacidad : null;
}

/** Para la fachada: ¿se negocia `ticket_image_version=1` en este pedido? */
export function fotoDelTicketHabilitada(): boolean {
  return actual.estado === 'encendida';
}

export function capacidadFotoDelTicket(): CapacidadFotoDelTicket | null {
  return actual.estado === 'encendida' ? actual.capacidad : null;
}

/** La segunda capa: con la capacidad apagada (o sin saber), no se pide ninguna foto. */
export function assertFotoDelTicketHabilitada(): void {
  if (actual.estado !== 'encendida') throw new Error('ticket_image_not_available');
}

export function reiniciarFotoDelTicketParaTests(): void {
  actual = PENDIENTE;
  for (const oyente of [...oyentes]) oyente();
}

// ─── El seam del mock ─────────────────────────────────────────────────────

export const CLAVE_FOTO_DEL_TICKET_MOCK = 'payme.app.mock.ticket_image.v1';

function leerLocal(clave: string): string | null {
  try { return localStorage.getItem(clave); } catch { return null; }
}

/** `encendido` exacto: la foto completa por 90 días y la miniatura (D465). */
export function fotoDelTicketMockEncendida(): boolean {
  return leerLocal(CLAVE_FOTO_DEL_TICKET_MOCK) === 'encendido';
}

/**
 * El bloque que publica la config del mock, como el dueño:
 * - sin seam: no existe (el backend de hoy);
 * - `apagado`: el `valor_apagado` del contrato (la constante del dueño en `false`);
 * - `encendido`: `full_retained` con 90 días (D465).
 */
export function capacidadFotoDelTicketMock(): Record<string, unknown> | undefined {
  const seam = leerLocal(CLAVE_FOTO_DEL_TICKET_MOCK);
  if (seam !== 'encendido' && seam !== 'apagado') return undefined;
  const encendida = seam === 'encendido';
  return {
    supported: true,
    enabled: encendida,
    mode: encendida ? 'full_retained' : 'off',
    stores_thumb: encendida,
    stores_full: encendida,
    full_retention_days: encendida ? 90 : null,
    negotiation_param: PARAMETRO_FOTO_DEL_TICKET,
    negotiation_value: VALOR_FOTO_DEL_TICKET,
    accepted_mime_types: ['image/jpeg', 'image/png', 'image/webp'],
    thumb_max_side_px: 320,
    full_max_side_px: 1600,
  };
}

// ─── Lo que devuelve el escaneo ───────────────────────────────────────────

/** `POST /api/ocr` con la negociación: si la foto quedó guardada (pendiente de la mesa) o por qué no. */
export type FotoDelEscaneo =
  | { readonly stored: true; readonly thumb: true; readonly full: boolean }
  | { readonly stored: false; readonly reason: MotivoSinFoto };

export const MOTIVOS_SIN_FOTO = [
  'no_receipt', 'pending_limit', 'unsupported_format', 'invalid_image', 'too_large', 'busy', 'storage_unavailable',
] as const;
export type MotivoSinFoto = (typeof MOTIVOS_SIN_FOTO)[number];

/** `ticket_image` de `/api/ocr`, claves exactas por rama (`captura.respuesta_extra`). `null` = no es la forma del dueño. */
export function decodeFotoDelEscaneo(raw: unknown): FotoDelEscaneo | null {
  if (!objetoPlano(raw)) return null;
  if (raw.stored === true && clavesExactas(raw, ['stored', 'thumb', 'full'])) {
    return raw.thumb === true && typeof raw.full === 'boolean' ? { stored: true, thumb: true, full: raw.full } : null;
  }
  if (raw.stored === false && clavesExactas(raw, ['stored', 'reason'])) {
    return (MOTIVOS_SIN_FOTO as readonly unknown[]).includes(raw.reason)
      ? { stored: false, reason: raw.reason as MotivoSinFoto }
      : null;
  }
  return null;
}
