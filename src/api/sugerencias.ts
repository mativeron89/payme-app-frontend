import { useSyncExternalStore } from 'react';
import { MemoriaDeCuenta } from './memoriaDeCuenta';

/**
 * n420 · «dividir como siempre» (D396–D406, D411–D415, D426) · consumidor del dueño App Backend 2.197.0 (AB-2, D490),
 * publicado APAGADO. Contratos espejados: `contract/account-consents-v1.schema.json` (capacidades y consentimientos)
 * y `contract/sugerencias-dividir-v1.schema.json` (la sugerencia).
 *
 * Dos puertas, en este orden, y la segunda no se cruza sin la primera:
 * 1. la capacidad `features.<finalidad>` del `/config` que la app YA pide (se aplica en `getConfig`, como Viajes o
 *    las varias fotos): sin ella no hay fila en Configuración ni ningún pedido de consentimientos ni de sugerencias;
 * 2. el permiso de la persona (`GET /account/consents/sugerencias` granted). Sin él, ningún pedido de sugerencia.
 *
 * Con todo apagado, como hoy: cero pedidos nuevos y nada visible.
 */

export type FinalidadOpcional = 'sugerencias' | 'analisis_interno';
export const FINALIDADES_OPCIONALES: readonly FinalidadOpcional[] = ['sugerencias', 'analisis_interno'];

/** Literales, no interpolados: la guarda C-03 (`interpolacionesDeRuta.test.ts`). */
export const RUTA_CONSENTIMIENTO: Readonly<Record<FinalidadOpcional, string>> = {
  sugerencias: '/account/consents/sugerencias',
  analisis_interno: '/account/consents/analisis_interno',
};
export const RUTA_GRANT: Readonly<Record<FinalidadOpcional, string>> = {
  sugerencias: '/account/consents/sugerencias/grant',
  analisis_interno: '/account/consents/analisis_interno/grant',
};
export const RUTA_REVOKE: Readonly<Record<FinalidadOpcional, string>> = {
  sugerencias: '/account/consents/sugerencias/revoke',
  analisis_interno: '/account/consents/analisis_interno/revoke',
};
export const RUTA_SUGERENCIA = '/sugerencias/dividir';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function record(v: unknown): v is Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  return Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null;
}
function keys(v: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(v).length === expected.length && expected.every((k) => Object.prototype.hasOwnProperty.call(v, k));
}

// ─── Capacidades ──────────────────────────────────────────────────────────────

export interface CapacidadOpcional {
  readonly supported: true;
  /** Disponibilidad GLOBAL para otorgar (capacidad y Aviso/mínimo). No dice si la persona lo otorgó. */
  readonly enabled: boolean;
}
export type CapacidadesOpcionales = Readonly<Record<FinalidadOpcional, CapacidadOpcional | null>>;

const NINGUNA: CapacidadesOpcionales = { sugerencias: null, analisis_interno: null };

/** `features.<finalidad>` con exactamente `supported: true` y `enabled` booleano; cualquier otra cosa: `null`. */
export function decodeCapacidadOpcional(config: unknown, finalidad: FinalidadOpcional): CapacidadOpcional | null {
  if (!record(config) || !record(config.features)) return null;
  const c = config.features[finalidad];
  if (!record(c) || !keys(c, ['supported', 'enabled']) || c.supported !== true || typeof c.enabled !== 'boolean') return null;
  return { supported: true, enabled: c.enabled };
}

let actual: CapacidadesOpcionales = NINGUNA;
const huella = (c: CapacidadesOpcionales) => FINALIDADES_OPCIONALES.map((f) => (c[f] === null ? '-' : String(c[f]!.enabled))).join(',');
const oyentes = new Set<() => void>();

/** La fachada la llama con cada `/config` que llega: sin pedido propio. */
export function aplicarConfigSugerencias(config: unknown): void {
  const siguiente: CapacidadesOpcionales = {
    sugerencias: decodeCapacidadOpcional(config, 'sugerencias'),
    analisis_interno: decodeCapacidadOpcional(config, 'analisis_interno'),
  };
  if (huella(siguiente) === huella(actual)) return;
  actual = siguiente;
  if (!siguiente.sugerencias?.enabled) permisoDeSugerencias.olvidar();
  for (const oyente of [...oyentes]) oyente();
}

function suscribir(oyente: () => void): () => void {
  oyentes.add(oyente);
  return () => { oyentes.delete(oyente); };
}
const instantanea = (): CapacidadesOpcionales => actual;

export function useCapacidadesOpcionales(): CapacidadesOpcionales {
  return useSyncExternalStore(suscribir, instantanea, instantanea);
}

/** Para la fachada: la capacidad vigente al momento del gesto. */
export function capacidadOpcional(finalidad: FinalidadOpcional): CapacidadOpcional | null {
  return actual[finalidad];
}

export function reiniciarSugerenciasParaTests(): void {
  actual = NINGUNA;
  permisoDeSugerencias.olvidar();
  oyentes.clear();
}

// ─── Consentimientos ──────────────────────────────────────────────────────────

export interface EstadoDeConsentimiento {
  readonly purpose_key: FinalidadOpcional;
  readonly granted: boolean;
  readonly state: 'never' | 'granted' | 'revoked';
}

/** `{consent: state}` de claves exactas, de ESTA finalidad. Mal formado ⇒ error (el llamador lo trata como «no otorgado»). */
export function decodeConsentimiento(value: unknown, finalidad: FinalidadOpcional): EstadoDeConsentimiento {
  const invalido = () => new Error('consent_response_malformed');
  if (!record(value) || !keys(value, ['consent']) || !record(value.consent)) throw invalido();
  const c = value.consent;
  if (!keys(c, ['purpose_key', 'granted', 'state', 'since', 'notice_version', 'notice_hash'])
      || c.purpose_key !== finalidad || typeof c.granted !== 'boolean'
      || (c.state !== 'never' && c.state !== 'granted' && c.state !== 'revoked')) throw invalido();
  if (c.state === 'never') {
    if (c.granted || c.since !== null || c.notice_version !== null || c.notice_hash !== null) throw invalido();
  } else if (c.granted !== (c.state === 'granted')
      || typeof c.since !== 'string' || !Number.isFinite(Date.parse(c.since))
      || typeof c.notice_version !== 'string' || !c.notice_version
      || typeof c.notice_hash !== 'string' || !/^[0-9a-f]{64}$(?![\s\S])/.test(c.notice_hash)) {
    throw invalido();
  }
  return { purpose_key: finalidad, granted: c.granted, state: c.state };
}

/** El cambio pedido tiene que ser el que el servidor confirma; si no, error. */
export function confirmarConsentimiento(value: unknown, finalidad: FinalidadOpcional, granted: boolean): EstadoDeConsentimiento {
  const c = decodeConsentimiento(value, finalidad);
  if (c.granted !== granted) throw new Error('consent_change_unconfirmed');
  return c;
}

/**
 * El permiso de sugerencias de la cuenta, en memoria: se lee una vez por sesión y se borra al cambiarla. Sin storage:
 * el dato es del servidor. `null` = todavía no se leyó.
 */
export const permisoDeSugerencias = new MemoriaDeCuenta<boolean>();

/** Configuración lo actualiza al activar o revocar, para que «¿Cómo dividen?» no use un permiso viejo. */
export function recordarPermisoDeSugerencias(granted: boolean): void {
  permisoDeSugerencias.guardar(granted);
}

// ─── La sugerencia ────────────────────────────────────────────────────────────

export type SugerenciaDeDividir =
  | null
  | { readonly modo: 'consumo' }
  | { readonly modo: 'igual'; readonly personas: number };

/** El 200 de `GET /api/sugerencias/dividir`, de claves exactas en todos los niveles. Otra forma ⇒ error. */
export function decodeSugerenciaDeDividir(value: unknown): SugerenciaDeDividir {
  const invalido = () => new Error('sugerencia_response_malformed');
  if (!record(value) || !keys(value, ['sugerencia'])) throw invalido();
  const s = value.sugerencia;
  if (s === null) return null;
  if (!record(s) || !keys(s, ['division_mode', 'personas_esperadas'])) throw invalido();
  if (s.division_mode === 'consumo' && s.personas_esperadas === null) return { modo: 'consumo' };
  if (s.division_mode === 'igual' && typeof s.personas_esperadas === 'number'
      && Number.isInteger(s.personas_esperadas) && s.personas_esperadas >= 2 && s.personas_esperadas <= 50) {
    return { modo: 'igual', personas: s.personas_esperadas };
  }
  throw invalido();
}

/** La query, sólo con un UUID sintácticamente válido; si no, sin restaurante (el dueño cae al conjunto general). */
export function rutaDeSugerencia(restaurantId: string | null): string {
  return restaurantId !== null && UUID.test(restaurantId)
    ? `${RUTA_SUGERENCIA}?restaurant_id=${encodeURIComponent(restaurantId)}`
    : RUTA_SUGERENCIA;
}

type T = (s: string, ...a: unknown[]) => string;

/**
 * D411/D413 · el texto chico de la opción sugerida: «Como siempre», y «entre N» si es partes iguales. Nunca sugiere
 * «Pagar el total» (D406). Para otra opción, o sin sugerencia, `null`: la opción conserva su texto de siempre.
 */
export function textoDeSugerencia(sugerencia: SugerenciaDeDividir, opcion: 'consumo' | 'igual' | 'total', t: T): string | null {
  if (sugerencia === null || sugerencia.modo !== opcion) return null;
  return sugerencia.modo === 'igual' ? t('Como siempre · entre {0}', sugerencia.personas) : t('Como siempre');
}
