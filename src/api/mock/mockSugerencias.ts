import type { FinalidadOpcional } from '../sugerencias';
import { MockApiError } from './mockApi';

/**
 * n420 · el mock de «dividir como siempre» y de los dos permisos opcionales, con las formas del dueño
 * (`contract/account-consents-v1.schema.json`, `contract/sugerencias-dividir-v1.schema.json`).
 *
 * Por defecto el mock es el backend servido de hoy: NO anuncia las capacidades, así que la app no muestra nada ni
 * pide nada. Las costuras (sólo para la e2e y la demo):
 * - `payme.app.mock.sugerencias.v1` = `encendido`: anuncia `features.sugerencias` y `features.analisis_interno`
 *   encendidas;
 * - `payme.app.mock.sugerencia_dividir.v1` = `consumo` | `igual-<N>`: lo que el dueño sugeriría con el permiso
 *   otorgado. Sin la costura, `sugerencia: null` (sin historial suficiente, D405).
 *
 * Los permisos viven en la memoria de la página: nacen en `never`.
 */

function costura(clave: string): string | null {
  try { return localStorage.getItem(`payme.app.mock.${clave}.v1`); } catch { return null; }
}

/** El `/config` del mock con las capacidades de la costura, sin tocar el resto. */
export function conCapacidadesDelMock(config: unknown): unknown {
  if (costura('sugerencias') !== 'encendido') return config;
  const base = (config && typeof config === 'object' ? config : {}) as Record<string, unknown>;
  const features = (base.features && typeof base.features === 'object' ? base.features : {}) as Record<string, unknown>;
  return {
    ...base,
    features: {
      ...features,
      sugerencias: { supported: true, enabled: true },
      analisis_interno: { supported: true, enabled: true },
    },
  };
}

interface Registro { granted: boolean; state: 'never' | 'granted' | 'revoked'; since: string | null; notice_version: string | null; notice_hash: string | null }
const permisos = new Map<FinalidadOpcional, Registro>();
const NUNCA: Registro = { granted: false, state: 'never', since: null, notice_version: null, notice_hash: null };

function forma(f: FinalidadOpcional): unknown {
  return { consent: { purpose_key: f, ...(permisos.get(f) ?? NUNCA) } };
}

function encendida(): boolean {
  return costura('sugerencias') === 'encendido';
}

export async function mockGetConsentimiento(f: FinalidadOpcional): Promise<unknown> {
  if (!encendida()) throw new MockApiError(404, 'unknown_purpose');
  return forma(f);
}

export async function mockGrantConsentimiento(f: FinalidadOpcional, aviso: { readonly version: string; readonly hash: string }): Promise<unknown> {
  if (!encendida()) throw new MockApiError(409, 'purpose_not_available');
  permisos.set(f, { granted: true, state: 'granted', since: new Date().toISOString(), notice_version: aviso.version, notice_hash: aviso.hash });
  return forma(f);
}

export async function mockRevokeConsentimiento(f: FinalidadOpcional): Promise<unknown> {
  const previo = permisos.get(f);
  // Revocar nunca se bloquea; `never` o `revoked` no agrega nada.
  if (previo?.state === 'granted') permisos.set(f, { ...previo, granted: false, state: 'revoked', since: new Date().toISOString() });
  return forma(f);
}

export async function mockGetSugerenciaDividir(_restaurantId: string | null): Promise<unknown> {
  if (!encendida()) throw new MockApiError(404, 'not_found');
  if (permisos.get('sugerencias')?.state !== 'granted') throw new MockApiError(403, 'permiso_requerido');
  const s = costura('sugerencia_dividir');
  if (s === 'consumo') return { sugerencia: { division_mode: 'consumo', personas_esperadas: null } };
  const igual = s === null ? null : /^igual-(\d+)$/.exec(s);
  if (igual) return { sugerencia: { division_mode: 'igual', personas_esperadas: Number(igual[1]) } };
  return { sugerencia: null };
}

/** Sólo para tests. */
export function reiniciarMockSugerencias(): void {
  permisos.clear();
}
