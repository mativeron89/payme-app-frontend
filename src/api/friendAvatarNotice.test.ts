import { describe, expect, it } from 'vitest';
import {
  FRIEND_AVATAR_NOTICE_PAIRS,
  acknowledgementForDisplayedNotice,
  decodeFriendAvatarNotice,
} from './friendAvatarNotice';

const HASH = '5847ec0aff8247258d0763bc75ac6cd82ea553ae78b0ff06128ab43927085bd5';
const HASH_256 = 'fb5b0d9301bacf9ad662cd20812bf57ef4745c46c49a412b76871a14f6574d0e';
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
    // Pin tolerante (adenda 2026-09-24): sólo los DOS pares exactos.
    [{ ...state, notice_version: '2.5.6' }, '2.5.6 con la huella de 2.5.5 (par cruzado)'],
    [{ ...state, notice_hash: HASH_256 }, '2.5.5 con la huella de 2.5.6 (par cruzado)'],
    [{ ...state, notice_version: '2.5.7', notice_hash: 'c'.repeat(64) }, 'par ajeno'],
    [{ ...state, notice_version: '2.5.6', notice_hash: HASH_256.toUpperCase() }, 'huella en mayúsculas'],
  ])('falla cerrado ante %s (%s)', (value, _label) => {
    expect(() => decodeFriendAvatarNotice(value)).toThrow('friend_avatar_notice_response_malformed');
  });

  /**
   * Adenda a AF-LISTO-INICIO (2026-09-24): el front acepta 2.5.5 y 2.5.6 con
   * sus huellas exactas, para que el dueño publique 2.5.6 sin apagar el cartel.
   * Rojo contra 0.190.1 en el par 2.5.6.
   */
  it('acepta exactamente los dos pares publicados y acusa con el par que devolvió el servidor', () => {
    const PARES = [
      { version: '2.5.5', hash: HASH },
      { version: '2.5.6', hash: HASH_256 },
    ] as const;
    // Primero la CONDUCTA (rojo contra 0.190.1: 2.5.6 tiraba `malformed`)…
    for (const pair of PARES) {
      const decoded = decodeFriendAvatarNotice({
        ...state, notice_version: pair.version, notice_hash: pair.hash,
      });
      expect(decoded).toEqual({
        noticeVersion: pair.version, noticeHash: pair.hash, acknowledged: false, acknowledgedAt: null,
      });
      expect(acknowledgementForDisplayedNotice(decoded, {
        legal_text: { ...legal.legal_text, version: pair.version, hash: pair.hash },
      })).toEqual({ notice_version: pair.version, notice_hash: pair.hash });
      // El texto mostrado debe ser el MISMO par que el estado: el otro par válido no sirve.
      const otro = PARES.find((candidate) => candidate !== pair)!;
      expect(acknowledgementForDisplayedNotice(decoded, {
        legal_text: { ...legal.legal_text, version: otro.version, hash: otro.hash },
      })).toBeNull();
    }
    // …y después la lista publicada, que es la que lee el mock: ni uno más.
    expect(FRIEND_AVATAR_NOTICE_PAIRS).toEqual(PARES);
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
