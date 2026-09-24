import type { LegalTextResponse } from './types';

/**
 * Pares {versión, huella} del Aviso que este front acepta del dueño en
 * `/friends/avatar-notice`: **exactamente estos dos y ningún otro**. Un par
 * cruzado (versión de uno con huella del otro) o ajeno falla cerrado.
 *
 * Adenda a AF-LISTO-INICIO (decisiones 34/35, 2026-09-24) y regla del incidente
 * `dish_count`: el consumidor tolerante se publica ANTES que el dueño, para que
 * App Backend pueda pasar a 2.5.6 sin apagar este cartel.
 * - 2.5.5 · `5847ec0a…`: lo que sirve producción hoy (medido en `/ready`).
 * - 2.5.6 · `fb5b0d93…`: sha256 del cuerpo exacto del texto congelado
 *   (`hashBody` del dueño = sha256 del cuerpo servido; remedido acá sobre
 *   `aviso_privacidad_2.5.6.md`, cuerpo sin frontmatter ni blancos de borde).
 * El acuse se hace siempre con el par que devolvió el servidor, como hasta hoy.
 */
export const FRIEND_AVATAR_NOTICE_PAIRS: readonly { readonly version: string; readonly hash: string }[] = [
  { version: '2.5.5', hash: '5847ec0aff8247258d0763bc75ac6cd82ea553ae78b0ff06128ab43927085bd5' },
  { version: '2.5.6', hash: 'fb5b0d9301bacf9ad662cd20812bf57ef4745c46c49a412b76871a14f6574d0e' },
];

/** El par que sirve producción hoy; es el que presenta el riel mock. */
export const FRIEND_AVATAR_NOTICE_VERSION = FRIEND_AVATAR_NOTICE_PAIRS[0].version;
export const FRIEND_AVATAR_NOTICE_HASH = FRIEND_AVATAR_NOTICE_PAIRS[0].hash;

export function isAcceptedFriendAvatarNoticePair(version: unknown, hash: unknown): boolean {
  return FRIEND_AVATAR_NOTICE_PAIRS.some((pair) => pair.version === version && pair.hash === hash);
}
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
  const noticeVersion = value.notice_version;
  const noticeHash = value.notice_hash;
  if (typeof noticeVersion !== 'string' || typeof noticeHash !== 'string'
      || !isAcceptedFriendAvatarNoticePair(noticeVersion, noticeHash)
      || typeof value.acknowledged !== 'boolean'
      || !(acknowledgedAt === null || validUtc(acknowledgedAt))
      || value.acknowledged !== (acknowledgedAt !== null)) {
    throw new Error('friend_avatar_notice_response_malformed');
  }

  return {
    noticeVersion,
    noticeHash,
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
