import type { LegalTextResponse } from './types';

export const FRIEND_AVATAR_NOTICE_VERSION = '2.5.5';
export const FRIEND_AVATAR_NOTICE_HASH = '5847ec0aff8247258d0763bc75ac6cd82ea553ae78b0ff06128ab43927085bd5';
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export interface FriendAvatarNoticeState {
  readonly noticeVersion: string;
  readonly noticeHash: string;
  readonly acknowledged: boolean;
  readonly acknowledgedAt: string | null;
}

export interface FriendAvatarNoticeAcknowledgement {
  readonly notice_version: string;
  readonly notice_hash: string;
}

function plainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function validUtc(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_UTC.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

/** Contrato cerrado de GET/POST /friends/avatar-notice. */
export function decodeFriendAvatarNotice(value: unknown): FriendAvatarNoticeState {
  if (!plainObject(value) || !exactKeys(value, [
    'notice_version', 'notice_hash', 'acknowledged', 'acknowledged_at',
  ])) throw new Error('friend_avatar_notice_response_malformed');

  const acknowledgedAt = value.acknowledged_at;
  if (value.notice_version !== FRIEND_AVATAR_NOTICE_VERSION
      || value.notice_hash !== FRIEND_AVATAR_NOTICE_HASH
      || typeof value.acknowledged !== 'boolean'
      || !(acknowledgedAt === null || validUtc(acknowledgedAt))
      || value.acknowledged !== (acknowledgedAt !== null)) {
    throw new Error('friend_avatar_notice_response_malformed');
  }

  return {
    noticeVersion: value.notice_version,
    noticeHash: value.notice_hash,
    acknowledged: value.acknowledged,
    acknowledgedAt,
  };
}

/**
 * El acuse sólo puede usar la versión/huella del texto que esta instancia
 * verificó y puso a disposición. El DTO de estado, por sí solo, no alcanza.
 */
export function acknowledgementForDisplayedNotice(
  state: FriendAvatarNoticeState,
  legal: LegalTextResponse,
): FriendAvatarNoticeAcknowledgement | null {
  const text = legal.legal_text;
  if (text.kind !== 'aviso_privacidad'
      || text.version !== state.noticeVersion
      || text.hash.toLowerCase() !== state.noticeHash.toLowerCase()) return null;
  return { notice_version: text.version, notice_hash: text.hash.toLowerCase() };
}
