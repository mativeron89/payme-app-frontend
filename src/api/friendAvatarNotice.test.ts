import { describe, expect, it } from 'vitest';
import {
  acknowledgementForDisplayedNotice,
  decodeFriendAvatarNotice,
} from './friendAvatarNotice';

const HASH = '5847ec0aff8247258d0763bc75ac6cd82ea553ae78b0ff06128ab43927085bd5';
const state = {
  notice_version: '2.5.5',
  notice_hash: HASH,
  acknowledged: false,
  acknowledged_at: null,
};

const legal = {
  legal_text: {
    kind: 'aviso_privacidad' as const,
    version: '2.5.5',
    hash: HASH,
    effective_from: '2026-09-20T00:00:00.000Z',
    body: 'Texto vigente',
  },
};

describe('U05 · acuse del Aviso para foto entre amigos', () => {
  it('decodifica exactamente el estado no acusado y el acusado', () => {
    expect(decodeFriendAvatarNotice(state)).toEqual({
      noticeVersion: '2.5.5', noticeHash: HASH, acknowledged: false, acknowledgedAt: null,
    });
    expect(decodeFriendAvatarNotice({
      ...state, acknowledged: true, acknowledged_at: '2026-09-20T12:34:56.000Z',
    }).acknowledgedAt).toBe('2026-09-20T12:34:56.000Z');
  });

  it.each([
    [{ ...state, extra: true }, 'clave extra'],
    [{ ...state, notice_hash: 'a'.repeat(64) }, 'hash distinto'],
    [{ ...state, acknowledged: true }, 'acusado sin fecha'],
    [{ ...state, acknowledged_at: '2026-09-20' }, 'fecha sin acuse'],
  ])('falla cerrado ante %s (%s)', (value, _label) => {
    expect(() => decodeFriendAvatarNotice(value)).toThrow('friend_avatar_notice_response_malformed');
  });

  it('crea body sólo desde el texto cuya versión y hash coinciden', () => {
    const decoded = decodeFriendAvatarNotice(state);
    expect(acknowledgementForDisplayedNotice(decoded, legal)).toEqual({
      notice_version: '2.5.5', notice_hash: HASH,
    });
    expect(acknowledgementForDisplayedNotice(decoded, {
      legal_text: { ...legal.legal_text, hash: 'b'.repeat(64) },
    })).toBeNull();
    expect(acknowledgementForDisplayedNotice(decoded, {
      legal_text: { ...legal.legal_text, version: '2.5.6' },
    })).toBeNull();
  });
});
