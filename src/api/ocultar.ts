import { useSyncExternalStore } from 'react';

/**
 * AF-BORRAR-MESAS · decisiones 238 y 239 de Mati · n334 · App Backend v2.169.0,
 * contrato `contract-mirror/contract/ocultamientos-v1.json`.
 *
 * «Borrar de la app» una mesa terminada o un pago es OCULTAR por persona: el
 * servidor conserva todo (los demás participantes, el agente, OPS, la
 * contabilidad, la garantía). Por eso el texto de la app dice «de tu app» y
 * nunca que PayMe eliminó el dato (D238).
 *
 * El front no infiere qué mesa se puede borrar: usa `hideable_mesa_statuses` de
 * la capacidad. Sin la capacidad (ausente, mal formada, `supported` o `enabled`
 * en `false`) no hay gesto.
 */

export interface CapacidadOcultar {
  readonly habilitada: boolean;
  /** Los estados de mesa que se pueden ocultar, tal como los publica el dueño. */
  readonly estados: ReadonlySet<string>;
}

export const OCULTAR_APAGADO: CapacidadOcultar = Object.freeze({ habilitada: false, estados: new Set<string>() });

function plainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function clavesExactas(value: Record<string, unknown>, esperadas: readonly string[]): boolean {
  const claves = Object.keys(value).sort();
  const quiero = [...esperadas].sort();
  return claves.length === quiero.length && claves.every((c, i) => c === quiero[i]);
}

/** Un estado de mesa con forma de estado: letras minúsculas y guiones bajos. */
const ESTADO = /^[a-z_]{1,40}$/;

/**
 * `features.hide_from_app` → `{ supported, enabled, hideable_mesa_statuses }`,
 * claves EXACTAS. Una clave de más, un tipo que no es, o una lista con algo que
 * no tiene forma de estado apagan la superficie: puede ser otra semántica.
 */
export function decodeCapacidadOcultar(config: unknown): CapacidadOcultar {
  if (!plainObject(config) || !plainObject(config.features)) return OCULTAR_APAGADO;
  const raw = config.features.hide_from_app;
  if (!plainObject(raw) || !clavesExactas(raw, ['supported', 'enabled', 'hideable_mesa_statuses'])) return OCULTAR_APAGADO;
  const lista = raw.hideable_mesa_statuses;
  if (raw.supported !== true || raw.enabled !== true || !Array.isArray(lista) || lista.length === 0
      || !lista.every((s) => typeof s === 'string' && ESTADO.test(s))) {
    return OCULTAR_APAGADO;
  }
  return { habilitada: true, estados: new Set(lista as string[]) };
}

/** ¿Esta mesa se puede borrar de la app? Con la capacidad y un estado que el dueño publica. */
export function sePuedeOcultar(capacidad: CapacidadOcultar, mesaStatus: unknown): boolean {
  return capacidad.habilitada && typeof mesaStatus === 'string' && capacidad.estados.has(mesaStatus);
}

// ─── Store de la capacidad ────────────────────────────────────────────────

/**
 * Sin request propia: lo alimenta la fachada (`api.getConfig`) con cada config
 * que llega, como `username`. El shell ya pide una al arrancar.
 */
let estado: CapacidadOcultar = OCULTAR_APAGADO;
const oyentes = new Set<() => void>();

function claveDe(c: CapacidadOcultar): string {
  return c.habilitada ? [...c.estados].sort().join(',') : '';
}

export function aplicarConfigOcultar(config: unknown): CapacidadOcultar {
  const siguiente = decodeCapacidadOcultar(config);
  if (claveDe(siguiente) !== claveDe(estado)) {
    estado = siguiente;
    for (const oyente of [...oyentes]) oyente();
  }
  return estado;
}

function suscribir(oyente: () => void): () => void {
  oyentes.add(oyente);
  return () => { oyentes.delete(oyente); };
}

function instantanea(): CapacidadOcultar {
  return estado;
}

export function useCapacidadOcultar(): CapacidadOcultar {
  return useSyncExternalStore(suscribir, instantanea, instantanea);
}

export function reiniciarOcultarParaTests(): void {
  estado = OCULTAR_APAGADO;
  for (const oyente of [...oyentes]) oyente();
}

// ─── Las respuestas (claves exactas) ──────────────────────────────────────

export interface MesaOcultada {
  readonly mesaCode: string;
  readonly hidden: boolean;
  readonly includeHistory: boolean;
}

/** `PUT`/`DELETE /api/mesas/:code/hidden` → `{ mesa_code, hidden, include_history }`. */
export function decodeMesaOcultada(raw: unknown, esperado: { code: string; hidden: boolean }): MesaOcultada {
  if (!plainObject(raw) || !clavesExactas(raw, ['mesa_code', 'hidden', 'include_history'])
      || raw.mesa_code !== esperado.code || raw.hidden !== esperado.hidden
      || typeof raw.include_history !== 'boolean'
      || (!esperado.hidden && raw.include_history !== false)) {
    throw new Error('hide_mesa_response_malformed');
  }
  return { mesaCode: raw.mesa_code, hidden: raw.hidden, includeHistory: raw.include_history };
}

/** `PUT`/`DELETE /api/account/movements/:id/hidden` → `{ id, hidden }`. */
export function decodePagoOcultado(raw: unknown, esperado: { id: string; hidden: boolean }): { id: string; hidden: boolean } {
  if (!plainObject(raw) || !clavesExactas(raw, ['id', 'hidden'])
      || raw.id !== esperado.id || raw.hidden !== esperado.hidden) {
    throw new Error('hide_movement_response_malformed');
  }
  return { id: raw.id, hidden: raw.hidden };
}

/**
 * Qué dice la pantalla cuando el dueño no oculta. Pura: `status` y `code` salen
 * de `extractApiError`.
 * - `en_curso`: 409 `mesa_not_finished` / `movement_not_hideable` (la mesa
 *   revivió, por ejemplo por un reembolso);
 * - `no_esta`: 404 (no existe o no es tuya; el mismo 404 en los dos casos);
 * - `reintentar`: cualquier otra cosa (red, 5xx, respuesta mal formada).
 * En los dos primeros se vuelve a pedir la lista.
 */
export type ResultadoDeOcultar = 'en_curso' | 'no_esta' | 'reintentar';

export function resultadoDeOcultar(status: number | null, code: string): ResultadoDeOcultar {
  if (status === 409 && (code === 'mesa_not_finished' || code === 'movement_not_hideable')) return 'en_curso';
  if (status === 404) return 'no_esta';
  return 'reintentar';
}
