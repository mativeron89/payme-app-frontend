import { afterEach, describe, expect, it } from 'vitest';
import { api } from './index';
import {
  applyPrivateFeatureConfig,
  assertProfileIdentityEnabled,
  assertShortfallDetailEnabled,
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
  mergeProfileIdentityIntoCurrentUser,
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
  notice_version: '2.4.1',
  activation_blocker: null,
};

/**
 * 🔴 **2.3.0 sigue presentada y tiene fixture propio, porque el dueño la sigue
 * publicando.** No es un caso histórico: `services/shortfallDetails.js` está en
 * 2.3.0 HOY, mientras `profileIdentity.js` está en 2.4.1. Y sirve además de
 * guarda de rollback: si el dueño volviera atrás, el perfil no se apaga.
 */
const PROFILE_ANTERIOR = {
  ...PROFILE_ON,
  notice_version: '2.3.0',
};

/** Una versión FUTURA no hereda la decisión: se presenta o apaga. */
const PROFILE_FUTURA = {
  ...PROFILE_ON,
  notice_version: '2.5.0',
};

const PROFILE_SUPERSEDED = {
  ...PROFILE_ON,
  notice_version: '2.2.0',
};

const PROFILE_TEST_ONLY = {
  ...PROFILE_ON,
  notice_version: 'test-only',
};

const SHORTFALL_ON = {
  supported: true,
  enabled: true,
  version: 1,
  owner_only: true,
  includes_tip: false,
  // Se queda en 2.3.0 A PROPÓSITO: es lo que el dueño publica para esta
  // capability. El mock reproduce la asimetría en vez de unificarla.
  notice_version: '2.3.0',
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
    expect(readProfileIdentityCapability(config(PROFILE_ON)))
      .toEqual({ enabled: true, status: 'authoritative', noticeVersion: '2.4.1' });
    // 2.3.0 NO se apagó al presentarse 2.4.1: las dos conviven.
    expect(readProfileIdentityCapability(config(PROFILE_ANTERIOR)))
      .toEqual({ enabled: true, status: 'authoritative', noticeVersion: '2.3.0' });
    // …y una versión FUTURA sigue apagando.
    expect(readProfileIdentityCapability(config(PROFILE_FUTURA)))
      .toEqual({ enabled: false, status: 'notice_unavailable', noticeVersion: '2.5.0' });
    expect(readProfileIdentityCapability(config(PROFILE_SUPERSEDED)))
      .toEqual({ enabled: false, status: 'notice_unavailable', noticeVersion: '2.2.0' });
    expect(readProfileIdentityCapability(config(PROFILE_TEST_ONLY)))
      .toEqual({ enabled: false, status: 'notice_unavailable', noticeVersion: 'test-only' });
    expect(readProfileIdentityCapability(config(PROFILE_TEST_ONLY), TEST_PRESENTABLE_NOTICES))
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

  /**
   * 🔴 **El lector de shortfall tiene `it` propio, y sin esto NO estaba
   * vigilado — es la SEGUNDA vez que hace falta escribirlo.**
   *
   * Los dos lectores consultan el MISMO `presentableVersions`
   * (`privateFeatures.ts:96` y `:138`), así que un solo mutante —sacar una
   * versión de la Set— los rompe a los dos. Pero mientras sus aserciones vivían
   * en el mismo `it`, vitest cortaba en la PRIMERA, y la primera era siempre la
   * de perfil: **el lector de `settlement_shortfall_detail` no se observaba
   * nunca.** Se midió con el mutante plantado.
   *
   * ⚠️ Ya se había corregido, en el candidato del aviso 2.4.0 — **y ese objeto
   * se descartó por owner-first, así que el hueco volvió con él.** Un arreglo
   * que vive en un commit rechazado no protege nada.
   */
  it('el detalle de faltante lee la MISMA allowlist, y se rompe por su cuenta', () => {
    expect(readShortfallDetailCapability(config(PROFILE_ON, SHORTFALL_ON)))
      .toEqual({ enabled: true, status: 'authoritative', noticeVersion: '2.3.0' });
    expect(readShortfallDetailCapability(config(PROFILE_ON, {
      ...SHORTFALL_ON, notice_version: '2.4.1',
    }))).toEqual({ enabled: true, status: 'authoritative', noticeVersion: '2.4.1' });
    expect(readShortfallDetailCapability(config(PROFILE_ON, {
      ...SHORTFALL_ON, notice_version: '2.2.0',
    }))).toEqual({ enabled: false, status: 'notice_unavailable', noticeVersion: '2.2.0' });
    expect(readShortfallDetailCapability(config(PROFILE_ON, {
      ...SHORTFALL_ON, notice_version: '2.5.0',
    }))).toEqual({ enabled: false, status: 'notice_unavailable', noticeVersion: '2.5.0' });
  });

  /**
   * 🔴 **El caso que describe la producción de HOY: las dos capabilities
   * habilitadas AL MISMO TIEMPO con versiones distintas.**
   *
   * Medido en el dueño (`9c5a7b14`, contenido `940cc49e`): `profileIdentity.js`
   * publica `'2.4.1'` y `shortfallDetails.js` `'2.3.0'`. Ninguno de los dos
   * casos de arriba, por separado, prueba que ESA combinación funcione — y es
   * la única que existe en producción. Un mutante que reemplace en vez de
   * agregar apaga exactamente una de las dos, y este caso lo ve.
   */
  it('🔴 las dos capabilities habilitadas a la vez, con versiones distintas', () => {
    const cfg = config(PROFILE_ON, SHORTFALL_ON);
    expect(readProfileIdentityCapability(cfg))
      .toEqual({ enabled: true, status: 'authoritative', noticeVersion: '2.4.1' });
    expect(readShortfallDetailCapability(cfg))
      .toEqual({ enabled: true, status: 'authoritative', noticeVersion: '2.3.0' });
  });

  it('ausencia y forma inesperada nunca habilitan', () => {
    expect(readProfileIdentityCapability({ features: {} })).toEqual({ enabled: false, status: 'absent', noticeVersion: null });
    expect(readShortfallDetailCapability({ features: { settlement_shortfall_detail: 'on' } }))
      .toEqual({ enabled: false, status: 'malformed', noticeVersion: null });
  });

  it('OFF/ausente sigue cerrando la fachada aunque el mock distribuible ya soporte 2.4.1', async () => {
    applyPrivateFeatureConfig(config(PROFILE_OFF, {
      ...SHORTFALL_ON,
      enabled: false,
      notice_version: null,
      activation_blocker: 'privacy_notice_and_legacy_identity_inventory_pending',
    }));
    expect(() => assertProfileIdentityEnabled()).toThrow('profile_identity_unavailable');
    expect(() => assertShortfallDetailEnabled()).toThrow('settlement_shortfall_detail_unavailable');
    await expect(api.getProfileIdentity(SESSION)).rejects.toThrow('profile_identity_unavailable');
    await expect(api.getShortfallDetail('PA-12345', 21000, SESSION))
      .rejects.toThrow('settlement_shortfall_detail_unavailable');
    await expect(mock.mockProfileIdentity()).resolves.toMatchObject({
      user: { first_name: expect.any(String), last_name: expect.any(String) },
    });
    await expect(mock.mockShortfallDetail('PA-1099')).resolves.toMatchObject({
      detail_available: true,
      shortfall_cents: 21000,
    });
  });

  it('el config mock publicado replica ON 2.4.1 y conserva payme_id/avatar privados', async () => {
    expect(readProfileIdentityCapability(await mock.mockGetConfig()))
      .toEqual({ enabled: true, status: 'authoritative', noticeVersion: '2.4.1' });
  });

  /**
   * Mismo motivo que el `it` de arriba: por lector, nunca de a dos. Y acredita
   * que el mock **reproduce la asimetría del dueño** en vez de unificarla: si
   * alguien pusiera 2.4.1 en las dos, esto se pone rojo.
   */
  it('el mock publica 2.3.0 para el detalle de faltante · la asimetría del dueño', async () => {
    expect(readShortfallDetailCapability(await mock.mockGetConfig()))
      .toEqual({ enabled: true, status: 'authoritative', noticeVersion: '2.3.0' });
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
    const persian = 'می‌خواهم';
    expect(profileNameInput(astral100)).toBe(astral100);
    expect(profileNameInput(devanagari)).toBe(devanagari);
    expect(profileNameInput(persian)).toBe(persian);
    expect(decodeProfileIdentityResponse({ user: { ...VALID_USER, first_name: astral100, last_name: devanagari } }).user.first_name)
      .toBe(astral100);
    expect(() => profileNameInput('🫀'.repeat(101))).toThrow('profile_name_invalid');
    expect(() => profileNameInput('Ana\u202Eadmin')).toThrow('profile_name_invalid');
    expect(() => profileNameInput('Ana\u200BMaría')).toThrow('profile_name_invalid');
    expect(() => profileNameInput('Ana\u00ADMaría')).toThrow('profile_name_invalid');
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
    const rotated = { ...SESSION, access_token: 'a2', refresh_token: 'r2' };
    expect(currentSamePrincipalSession(SESSION, rotated)).toBe(rotated);
    expect(currentSamePrincipalSession(SESSION, { ...rotated, family_id: 'otra-familia' })).toBeNull();
    expect(currentSamePrincipalSession(SESSION, { ...rotated, principal_id: 'otro-principal' })).toBeNull();
    expect(currentSamePrincipalSession(SESSION, null)).toBeNull();
  });

  it('CAS de mutación adopta con tokens rotados y nunca cruza familia/principal', () => {
    const rotated = {
      ...SESSION,
      access_token: 'a2',
      refresh_token: 'r2',
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

  it('adopta sólo nombre/avatar sin incorporar PII adicional del DTO privado', () => {
    const currentUser = {
      ...VALID_USER,
      payme_id: 'payme_mx_z9y8',
      email: 'baseline@example.test',
      phone: null,
      birth_date: null,
      birth_date_set: false,
      is_adult: null,
    };
    const current = { ...SESSION, user: currentUser };
    const remote = {
      ...VALID_USER,
      first_name: 'Nombre servidor',
      last_name: 'Normalizado',
      payme_id: 'payme_mx_a1b2',
      email: 'private@example.test',
      phone: '+525500000000',
      birth_date: '1988-03-14',
      birth_date_set: true,
      is_adult: true,
    };

    expect(mergeProfileIdentityIntoCurrentUser(current, remote)).toEqual({
      ...currentUser,
      first_name: 'Nombre servidor',
      last_name: 'Normalizado',
      avatar: remote.avatar,
    });
    expect(mergeProfileIdentityIntoCurrentUser(
      current,
      { ...remote, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
    )).toBeNull();
    expect(mergeProfileIdentityIntoCurrentUser({ ...current, user: undefined }, remote)).toBeNull();
  });

  it('avatar PUT/DELETE no reconstruyen perfil si la sesión actual no tiene usuario', () => {
    const rotatedWithoutUser = {
      ...SESSION,
      user: undefined,
      access_token: 'a2',
      refresh_token: 'r2',
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

  it('el mock acepta una foto de teléfono mayor al límite JPEG de salida del backend', async () => {
    const userWithoutAvatar = { ...VALID_USER, avatar: null };
    const restore = mock.installPrivateFeatureMockFixtureForTests({
      profile: { user: userWithoutAvatar },
      avatar: null,
      shortfallByMesa: {},
    });
    const phonePhoto = new Blob(
      [new Uint8Array(300 * 1024)],
      { type: 'image/png' },
    );
    try {
      await expect(mock.mockPutProfileAvatar(phonePhoto, null)).resolves.toMatchObject({
        avatar: { revision: expect.any(String) },
      });
      await expect(mock.mockProfileAvatar()).resolves.toMatchObject({
        blob: expect.objectContaining({ size: phonePhoto.size, type: 'image/png' }),
      });
    } finally {
      restore();
    }
  });
});
