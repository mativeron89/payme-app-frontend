import type { FinalidadOpcional } from '../sugerencias';
import { MockApiError } from './mockApi';
import { recomendacionesEncendidas } from './mockAgente';

/**
 * n420 · el mock de «dividir como siempre» y de los dos permisos opcionales, con las formas del dueño
 * (`contract/account-consents-v1.schema.json`, `contract/sugerencias-dividir-v1.schema.json`).
 *
 * Por defecto el mock es el backend servido de hoy: NO anuncia las capacidades, así que la app no muestra nada ni
 * pide nada. Las costuras (sólo para la e2e y la demo):
 * - `payme.app.mock.sugerencias.v1` = `encendido`: anuncia `features.sugerencias` y `features.analisis_interno`
 *   encendidas; `apagado`: las anuncia con la forma de producción de hoy, `{supported: true, enabled: false}` (O2 de
 *   la auditoría de PR102): se leen y se revocan, pero no se otorgan;
 * - `payme.app.mock.consentimientos_otorgados.v1` = `sugerencias,analisis_interno` (cualquiera de las dos): la página
 *   arranca con ese permiso ya otorgado (O1: revocar con la capacidad apagada);
 * - `payme.app.mock.sugerencia_dividir.v1` = `consumo` | `igual-<N>`: lo que el dueño sugeriría con el permiso
 *   otorgado. Sin la costura, `sugerencia: null` (sin historial suficiente, D405).
 *
 * Los permisos viven en la memoria de la página: nacen en `never`.
 *
 * D554 · `recomendaciones` (el agente, `mockAgente.ts`) sigue la bandera del agente, no la de sugerencias: el dueño
 * 2.208.0 la tiene siempre (apagada), así que se lee y se revoca; se otorga sólo con `payme.app.mock.agente.v1`
 * encendida. También arranca otorgada con `consentimientos_otorgados` = `recomendaciones`.
 */

function costura(clave: string): string | null {
  try { return localStorage.getItem(`payme.app.mock.${clave}.v1`); } catch { return null; }
}

/** El `/config` del mock con las capacidades de la costura, sin tocar el resto. */
export function conCapacidadesDelMock(config: unknown): unknown {
  if (!anunciada()) return config;
  const enabled = encendida();
  const base = (config && typeof config === 'object' ? config : {}) as Record<string, unknown>;
  const features = (base.features && typeof base.features === 'object' ? base.features : {}) as Record<string, unknown>;
  return {
    ...base,
    features: {
      ...features,
      sugerencias: { supported: true, enabled },
      analisis_interno: { supported: true, enabled },
    },
  };
}

interface Registro { granted: boolean; state: 'never' | 'granted' | 'revoked'; since: string | null; notice_version: string | null; notice_hash: string | null }
const permisos = new Map<FinalidadOpcional, Registro>();
const NUNCA: Registro = { granted: false, state: 'never', since: null, notice_version: null, notice_hash: null };
const OTORGADO_DE_ARRANQUE: Registro = {
  granted: true, state: 'granted', since: '2026-10-27T00:00:00.000Z', notice_version: '3.1.0',
  notice_hash: '51f9c46f6c5874a0b62dad06e1ead77051cce010ed587de4d720b6add6b002bc',
};
let sembrado = false;

function sembrar(): void {
  if (sembrado) return;
  sembrado = true;
  for (const f of (costura('consentimientos_otorgados') ?? '').split(',')) {
    if ((f === 'sugerencias' || f === 'analisis_interno' || f === 'recomendaciones') && !permisos.has(f)) {
      permisos.set(f, OTORGADO_DE_ARRANQUE);
    }
  }
}

function forma(f: FinalidadOpcional): unknown {
  sembrar();
  return { consent: { purpose_key: f, ...(permisos.get(f) ?? NUNCA) } };
}

function encendida(f: FinalidadOpcional = 'sugerencias'): boolean {
  if (f === 'recomendaciones') return recomendacionesEncendidas();
  return costura('sugerencias') === 'encendido';
}

function anunciada(f: FinalidadOpcional = 'sugerencias'): boolean {
  // El dueño 2.208.0 la tiene siempre; uno anterior (la costura `agente = ausente`), no.
  if (f === 'recomendaciones') return costura('agente') !== 'ausente';
  return encendida() || costura('sugerencias') === 'apagado';
}

/** Para el mock del agente: ¿la persona otorgó esta finalidad? */
export function permisoOtorgadoEnMock(f: FinalidadOpcional): boolean {
  sembrar();
  return permisos.get(f)?.state === 'granted';
}

export async function mockGetConsentimiento(f: FinalidadOpcional): Promise<unknown> {
  // Como el dueño: el estado se lee con la capacidad anunciada aunque esté apagada (para revocar grants previos).
  if (!anunciada(f)) throw new MockApiError(404, 'unknown_purpose');
  return forma(f);
}

/** La lista, con la regla del dueño (`behavior.listing`): sólo lo que hoy se puede otorgar o lo que está otorgado. */
export async function mockGetConsentimientos(): Promise<unknown> {
  sembrar();
  const consents: Record<string, unknown> = {
    perfilado_campanas: { purpose_key: 'perfilado_campanas', ...NUNCA },
  };
  for (const f of ['sugerencias', 'analisis_interno', 'recomendaciones'] as const) {
    const r = permisos.get(f);
    if (encendida(f) || r?.state === 'granted') consents[f] = { purpose_key: f, ...(r ?? NUNCA) };
  }
  return { consents };
}

export async function mockGrantConsentimiento(f: FinalidadOpcional, aviso: { readonly version: string; readonly hash: string }): Promise<unknown> {
  if (!encendida(f)) throw new MockApiError(409, 'purpose_not_available');
  permisos.set(f, { granted: true, state: 'granted', since: new Date().toISOString(), notice_version: aviso.version, notice_hash: aviso.hash });
  return forma(f);
}

export async function mockRevokeConsentimiento(f: FinalidadOpcional): Promise<unknown> {
  if (!anunciada(f)) throw new MockApiError(404, 'unknown_purpose');
  sembrar();
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
  sembrado = false;
}
