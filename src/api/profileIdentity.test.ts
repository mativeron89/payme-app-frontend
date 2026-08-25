import { afterEach, describe, expect, it } from 'vitest';
import { api } from './index';
import {
  applyPrivateFeatureConfig,
  assertProfileIdentityEnabled,
  readProfileIdentityCapability,
  readShortfallDetailCapability,
  resetPrivateFeaturesForTests,
  TEST_PRESENTABLE_NOTICES,
} from './privateFeatures';
import {
  AvatarObjectUrlLease,
  adoptProfileMutationUser,
  currentSamePrincipalSession,
  decodeProfileAvatarResponse,
  decodeProfileIdentityResponse,
  profileNameInput,
  validatePrivateAvatarBlob,
} from './profileIdentity';
import * as mock from './mock/mockApi';
import type { StoredSession } from './storage';

const PROFILE_OFF = {
  supported: true,
  enabled: false,
  notice_version: null,
  notice_required: true,
  activation_blocker: 'privacy_notice_and_legacy_identity_inventory_pending',
  payme_id_mutable: false,
  avatar_public_url: false,
};

const PROFILE_ON = {
  ...PROFILE_OFF,
  enabled: true,
  notice_version: 'test-only',
  activation_blocker: null,
};

const SHORTFALL_ON = {
  supported: true,
  enabled: true,
  version: 1,
  owner_only: true,
  includes_tip: false,
  notice_version: 'test-only',
  notice_required: true,
  activation_blocker: null,
};

const config = (profile: unknown = PROFILE_ON, shortfall: unknown = SHORTFALL_ON) => ({
  features: { profile_identity: profile, settlement_shortfall_detail: shortfall },
});

const VALID_USER = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  payme_id: 'payme_mx_a1b2',
  email: 'owner@laparolaccia.mx',
  first_name: 'Sofía',
  last_name: 'Fernández',
  phone: null,
  birth_date: '1988-03-14',
  created_at: '2026-08-25T01:02:03.004Z',
  birth_date_set: true,
  is_adult: true,
  avatar: {
    revision: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    width: 128,
    height: 128,
    updated_at: '2026-08-25T02:03:04.005Z',
  },
};

const SESSION: StoredSession = {
  access_token: 'access',
  refresh_token: 'refresh',
  family_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  principal_id: VALID_USER.id,
  user: VALID_USER,
};

afterEach(() => resetPrivateFeaturesForTests());

describe('capabilities privadas · forma y lógica cerradas', () => {
  it('acepta OFF autoritativo y ON sólo con aviso vigente y sin blocker', () => {
    expect(readProfileIdentityCapability(config(PROFILE_OFF))).toEqual({ enabled: false, status: 'authoritative', noticeVersion: null });
    expect(readProfileIdentityCapability(config(PROFILE_ON))).toEqual({ enabled: false, status: 'notice_unavailable', noticeVersion: 'test-only' });
    expect(readProfileIdentityCapability(config(PROFILE_ON), TEST_PRESENTABLE_NOTICES))
      .toEqual({ enabled: true, status: 'authoritative', noticeVersion: 'test-only' });
    expect(readShortfallDetailCapability(config(PROFILE_ON, SHORTFALL_ON), TEST_PRESENTABLE_NOTICES))
      .toEqual({ enabled: true, status: 'authoritative', noticeVersion: 'test-only' });
  });

  it.each([
    ['notice ausente', { ...PROFILE_ON, notice_version: null }],
    ['notice vacío', { ...PROFILE_ON, notice_version: '' }],
    ['blocker contradictorio', { ...PROFILE_ON, activation_blocker: 'pending' }],
    ['notice no requerido', { ...PROFILE_ON, notice_required: false }],
    ['support apagado', { ...PROFILE_ON, supported: false }],
    ['payme_id mutable', { ...PROFILE_ON, payme_id_mutable: true }],
    ['URL pública', { ...PROFILE_ON, avatar_public_url: true }],
    ['campo extra', { ...PROFILE_ON, future: true }],
  ])('profile ON mutante: %s falla cerrado', (_label, value) => {
    expect(readProfileIdentityCapability(config(value))).toEqual({ enabled: false, status: 'malformed', noticeVersion: null });
  });

  it.each([
    ['notice ausente', { ...SHORTFALL_ON, notice_version: null }],
    ['blocker contradictorio', { ...SHORTFALL_ON, activation_blocker: 'pending' }],
    ['notice no requerido', { ...SHORTFALL_ON, notice_required: false }],
    ['owner_only falso', { ...SHORTFALL_ON, owner_only: false }],
    ['incluye propina', { ...SHORTFALL_ON, includes_tip: true }],
    ['versión futura', { ...SHORTFALL_ON, version: 2 }],
    ['campo extra', { ...SHORTFALL_ON, future: true }],
  ])('shortfall ON mutante: %s falla cerrado', (_label, value) => {
    expect(readShortfallDetailCapability(config(PROFILE_ON, value))).toEqual({ enabled: false, status: 'malformed', noticeVersion: null });
  });

  it('ausencia y forma inesperada nunca habilitan', () => {
    expect(readProfileIdentityCapability({ features: {} })).toEqual({ enabled: false, status: 'absent', noticeVersion: null });
    expect(readShortfallDetailCapability({ features: { settlement_shortfall_detail: 'on' } }))
      .toEqual({ enabled: false, status: 'malformed', noticeVersion: null });
  });

  it('rutas directas real y mock permanecen OFF por defecto', async () => {
    applyPrivateFeatureConfig(config(PROFILE_OFF, {
      ...SHORTFALL_ON,
      enabled: false,
      notice_version: null,
      activation_blocker: 'privacy_notice_and_legacy_identity_inventory_pending',
    }));
    expect(() => assertProfileIdentityEnabled()).toThrow('profile_identity_unavailable');
    await expect(api.getProfileIdentity(SESSION)).rejects.toThrow('profile_identity_unavailable');
    await expect(mock.mockProfileIdentity()).rejects.toMatchObject({ status: 503 });
  });
});

describe('DTO de identidad propio · exacto y owner-first', () => {
  it('decodifica GET/PATCH y metadata UUID sin aceptar extras', () => {
    expect(decodeProfileIdentityResponse({ user: VALID_USER }).user.avatar?.revision)
      .toBe('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    expect(decodeProfileAvatarResponse({ avatar: VALID_USER.avatar })).toEqual({ avatar: VALID_USER.avatar });
    expect(() => decodeProfileIdentityResponse({ user: { ...VALID_USER, role: 'owner' } }))
      .toThrow('profile_identity_response_malformed');
    expect(() => decodeProfileAvatarResponse({ avatar: { ...VALID_USER.avatar, url: 'https://x' } }))
      .toThrow('profile_avatar_response_malformed');
  });

  it.each([
    ['payme_id con underscore extra', { ...VALID_USER, payme_id: 'payme_mx_owner' }],
    ['payme_id uppercase', { ...VALID_USER, payme_id: 'PAYME_mx_a1b2' }],
    ['timestamp RFC', { ...VALID_USER, created_at: 'Tue, 25 Aug 2026 01:02:03 GMT' }],
    ['timestamp sin milisegundos', { ...VALID_USER, created_at: '2026-08-25T01:02:03Z' }],
    ['timestamp imposible', { ...VALID_USER, created_at: '2026-02-30T01:02:03.000Z' }],
    ['revision no UUID', { ...VALID_USER, avatar: { ...VALID_USER.avatar, revision: 'latest' } }],
    ['birth flag inconsistente', { ...VALID_USER, birth_date_set: false }],
  ])('rechaza %s', (_label, user) => {
    expect(() => decodeProfileIdentityResponse({ user })).toThrow('profile_identity_response_malformed');
  });

  it('cuenta code points como el owner y conserva ZWJ/ZWNJ', () => {
    const astral100 = '🫀'.repeat(100);
    const devanagari = 'नाम‍देव';
    expect(profileNameInput(astral100)).toBe(astral100);
    expect(profileNameInput(devanagari)).toBe(devanagari);
    expect(decodeProfileIdentityResponse({ user: { ...VALID_USER, first_name: astral100, last_name: devanagari } }).user.first_name)
      .toBe(astral100);
    expect(() => profileNameInput('🫀'.repeat(101))).toThrow('profile_name_invalid');
    expect(() => profileNameInput('Ana\u202Eadmin')).toThrow('profile_name_invalid');
    expect(() => profileNameInput('Ana\u200BMaría')).toThrow('profile_name_invalid');
  });
});

describe('avatar privado · bytes y ObjectURL efímeros', () => {
  it('acepta sólo JPEG sellado de 1..256 KiB', () => {
    expect(validatePrivateAvatarBlob(new Blob(['jpeg'], { type: 'image/jpeg' })).blob.size).toBe(4);
    expect(() => validatePrivateAvatarBlob(new Blob(['png'], { type: 'image/png' }))).toThrow('avatar_response_media_type_invalid');
    expect(() => validatePrivateAvatarBlob(new Blob([], { type: 'image/jpeg' }))).toThrow('avatar_response_size_invalid');
    expect(() => validatePrivateAvatarBlob(new Blob([new Uint8Array(256 * 1024 + 1)], { type: 'image/jpeg' })))
      .toThrow('avatar_response_size_invalid');
  });

  it('revoca en reemplazo, clear y dispose sin doble revocación', () => {
    const revoked: string[] = [];
    let id = 0;
    const lease = new AvatarObjectUrlLease(() => `blob:${++id}`, (url) => revoked.push(url));
    expect(lease.replace(new Blob(['a']))).toBe('blob:1');
    expect(lease.replace(new Blob(['b']))).toBe('blob:2');
    expect(revoked).toEqual(['blob:1']);
    lease.clear();
    lease.dispose();
    expect(revoked).toEqual(['blob:1', 'blob:2']);
  });

  it('acepta refresh de tokens de la misma familia y rechaza relogin/principal stale', () => {
    const rotated = { ...SESSION, access_token: 'rotated-a', refresh_token: 'rotated-r' };
    expect(currentSamePrincipalSession(SESSION, rotated)).toBe(rotated);
    expect(currentSamePrincipalSession(SESSION, { ...rotated, family_id: 'otra-familia' })).toBeNull();
    expect(currentSamePrincipalSession(SESSION, { ...rotated, principal_id: 'otro-principal' })).toBeNull();
    expect(currentSamePrincipalSession(SESSION, null)).toBeNull();
  });

  it('CAS de mutación adopta con tokens rotados y nunca cruza familia/principal', () => {
    const rotated = {
      ...SESSION,
      access_token: 'rotated-a',
      refresh_token: 'rotated-r',
    };
    const adopted: Array<{ session: StoredSession; user: typeof VALID_USER }> = [];
    expect(adoptProfileMutationUser(SESSION, () => VALID_USER, {
      loadCurrent: () => rotated,
      isCurrent: (candidate) => candidate === rotated,
      adoptUser: (session, user) => {
        adopted.push({ session, user: user as typeof VALID_USER });
        return true;
      },
    })).toBe(true);
    expect(adopted).toEqual([{ session: rotated, user: VALID_USER }]);

    const relogin = { ...rotated, family_id: 'otra-familia' };
    expect(adoptProfileMutationUser(SESSION, () => VALID_USER, {
      loadCurrent: () => relogin,
      isCurrent: () => true,
      adoptUser: () => { throw new Error('no debe adoptar'); },
    })).toBe(false);
    expect(adoptProfileMutationUser(SESSION, () => VALID_USER, {
      loadCurrent: () => rotated,
      isCurrent: () => false,
      adoptUser: () => { throw new Error('CAS stale'); },
    })).toBe(false);
  });

  it('avatar PUT/DELETE no reconstruyen perfil si la sesión actual no tiene usuario', () => {
    const rotatedWithoutUser = {
      ...SESSION,
      user: undefined,
      access_token: 'rotated-a',
      refresh_token: 'rotated-r',
    };
    expect(adoptProfileMutationUser(
      SESSION,
      (current) => current.user ? { ...current.user, avatar: null } : null,
      {
        loadCurrent: () => rotatedWithoutUser,
        isCurrent: () => true,
        adoptUser: () => { throw new Error('no debe adoptar'); },
      },
    )).toBe(false);
  });

  it('un conflicto remoto no reintenta la mutación y permite releer la revisión vigente', async () => {
    const restore = mock.installPrivateFeatureMockFixtureForTests({
      profile: { user: VALID_USER },
      avatar: new Blob(['jpeg'], { type: 'image/jpeg' }),
      shortfallByMesa: {},
    });
    try {
      await expect(mock.mockPutProfileAvatar(
        new Blob(['new'], { type: 'image/jpeg' }),
        'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      )).rejects.toMatchObject({ status: 409, message: 'avatar_revision_conflict' });
      await expect(mock.mockProfileIdentity()).resolves.toMatchObject({
        user: { avatar: { revision: VALID_USER.avatar.revision } },
      });
    } finally {
      restore();
    }
  });
});
