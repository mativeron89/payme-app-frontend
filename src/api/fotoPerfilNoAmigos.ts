import type { LegalTextResponse } from './types';

/** D457 · owner-first-v2, manifest 702105ad…; sin inferir permisos del alta/foto. */
export const FOTO_PURPOSE = 'foto_perfil_no_amigos';
export const FOTO_PATH = `/account/consents/${FOTO_PURPOSE}`;
export const FOTO_NOTICE = {
  version: '3.1.0',
  hash: '51f9c46f6c5874a0b62dad06e1ead77051cce010ed587de4d720b6add6b002bc',
} as const;

export interface CapacidadFoto {
  readonly supported: boolean;
  readonly enabled: boolean;
}
export interface PermisoFoto {
  readonly purpose_key: typeof FOTO_PURPOSE;
  readonly granted: boolean;
  readonly state: 'never' | 'granted' | 'revoked';
  readonly since: string | null;
  readonly notice_version: string | null;
  readonly notice_hash: string | null;
}

function record(v: unknown): v is Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  return Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null;
}
function keys(v: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(v).length === expected.length && expected.every((k) => Object.prototype.hasOwnProperty.call(v, k));
}

/** Ausente, apagada, malformada o por cuenta: nunca ofrece un grant. */
export function capacidadFoto(config: unknown): CapacidadFoto {
  const off = { supported: false, enabled: false };
  if (!record(config) || !record(config.features)) return off;
  const c = config.features[FOTO_PURPOSE];
  if (!record(c) || !keys(c, ['supported', 'enabled']) || c.supported !== true || typeof c.enabled !== 'boolean') return off;
  return { supported: true, enabled: c.enabled };
}

/** Sólo el endpoint de esta finalidad; no consume ni altera otros consentimientos. */
export function decodePermisoFoto(value: unknown): PermisoFoto {
  const invalid = () => new Error('foto_consent_response_malformed');
  if (!record(value) || !keys(value, ['consent']) || !record(value.consent)) throw invalid();
  const c = value.consent;
  if (!keys(c, ['purpose_key', 'granted', 'state', 'since', 'notice_version', 'notice_hash'])
      || c.purpose_key !== FOTO_PURPOSE || typeof c.granted !== 'boolean'
      || (c.state !== 'never' && c.state !== 'granted' && c.state !== 'revoked')) throw invalid();
  if (c.state === 'never') {
    if (c.granted || c.since !== null || c.notice_version !== null || c.notice_hash !== null) throw invalid();
    return { purpose_key: FOTO_PURPOSE, granted: false, state: 'never', since: null, notice_version: null, notice_hash: null };
  }
  // El estado conserva evidencia histórica; no exigir el Aviso actual para revocar.
  if (c.granted !== (c.state === 'granted')
      || typeof c.since !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(c.since)
      || !Number.isFinite(Date.parse(c.since))
      || typeof c.notice_version !== 'string' || !c.notice_version
      || typeof c.notice_hash !== 'string' || !/^[0-9a-f]{64}$(?![\s\S])/.test(c.notice_hash)) throw invalid();
  return { purpose_key: FOTO_PURPOSE, granted: c.granted, state: c.state,
    since: c.since, notice_version: c.notice_version, notice_hash: c.notice_hash };
}

/** El nuevo grant usa exactamente el Integral puesto a disposición, incluido su cuerpo. */
export async function verificarAvisoFoto(aviso: LegalTextResponse['legal_text']): Promise<boolean> {
  if (aviso.kind !== 'aviso_privacidad' || aviso.version !== FOTO_NOTICE.version || aviso.hash !== FOTO_NOTICE.hash) return false;
  try {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(aviso.body.trim()));
    return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('') === FOTO_NOTICE.hash;
  } catch { return false; }
}

export function confirmarMutacionFoto(value: unknown, granted: boolean): PermisoFoto {
  const c = decodePermisoFoto(value);
  if (c.granted !== granted || (granted && (c.notice_version !== FOTO_NOTICE.version || c.notice_hash !== FOTO_NOTICE.hash))) {
    throw new Error('foto_consent_change_unconfirmed');
  }
  return c;
}
