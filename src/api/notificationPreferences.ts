import {
  NOTIFICATION_PREFERENCE_GROUPS,
  NOTIFICATION_PREFERENCE_TYPES,
  type NotificationEmailPreference,
  type NotificationPreferenceItem,
  type NotificationPreferenceType,
  type NotificationPreferencesResponse,
} from './types';

/**
 * AF2 · decodificador ESTRICTO de `payme.app.notification-preferences/v1`
 * (E1, `contract-mirror/contract/notification-preferences-v1.schema.json`).
 *
 * Claves exactas en cada nivel y enums cerrados: una clave de más, un `mode`
 * desconocido o `channels` distinto de `['email']` es contrato roto. Un `type`
 * que este front no conoce NO rompe la pantalla: se descarta y se muestra sólo
 * lo que se conoce (lección `dish_count`: el dueño puede sumar un tipo antes de
 * que el front lo traduzca). Un tipo repetido sí se rechaza.
 */
export class NotificationPreferencesError extends Error {
  constructor() { super('notification_preferences_response_malformed'); }
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

const TYPES: ReadonlySet<string> = new Set(NOTIFICATION_PREFERENCE_TYPES);
const GROUPS: ReadonlySet<string> = new Set(NOTIFICATION_PREFERENCE_GROUPS);

function decodeEmail(value: unknown): NotificationEmailPreference | null {
  if (!plainObject(value)) return null;
  if (value.mode === 'editable') {
    if (!exactKeys(value, ['mode', 'value', 'default'])
        || typeof value.value !== 'boolean' || typeof value.default !== 'boolean') return null;
    return { mode: 'editable', value: value.value, default: value.default };
  }
  if (value.mode === 'fixed_on') {
    return exactKeys(value, ['mode']) ? { mode: 'fixed_on' } : null;
  }
  if (value.mode === 'unavailable') {
    if (!exactKeys(value, ['mode', 'reason'])
        || (value.reason !== 'payments_disabled' && value.reason !== 'notice_pending')) return null;
    return { mode: 'unavailable', reason: value.reason };
  }
  return null;
}

export function decodeNotificationPreferences(value: unknown): NotificationPreferencesResponse {
  if (!plainObject(value) || !exactKeys(value, ['notice_version', 'channels', 'items'])
      || typeof value.notice_version !== 'string' || value.notice_version.length === 0 || value.notice_version.length > 30
      || !Array.isArray(value.channels) || value.channels.length !== 1 || value.channels[0] !== 'email'
      || !Array.isArray(value.items)) throw new NotificationPreferencesError();
  const items: NotificationPreferenceItem[] = [];
  const seen = new Set<string>();
  for (const raw of value.items) {
    if (!plainObject(raw) || !exactKeys(raw, ['type', 'group', 'email'])
        || typeof raw.type !== 'string' || typeof raw.group !== 'string') throw new NotificationPreferencesError();
    const email = decodeEmail(raw.email);
    if (!email || !GROUPS.has(raw.group)) throw new NotificationPreferencesError();
    if (seen.has(raw.type)) throw new NotificationPreferencesError();
    seen.add(raw.type);
    // Tipo desconocido: se descarta, no rompe.
    if (!TYPES.has(raw.type)) continue;
    items.push({
      type: raw.type as NotificationPreferenceType,
      group: raw.group as NotificationPreferenceItem['group'],
      email,
    });
  }
  return { notice_version: value.notice_version, channels: ['email'], items };
}
