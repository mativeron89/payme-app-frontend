import { createElement, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from '../../src/api';
import {
  loadSession,
  replaceCurrentSession,
  saveSession,
  subscribeSession,
  type StoredSession,
} from '../../src/api/storage';
import type { ProfileIdentityResponse, User } from '../../src/api/types';
import { ProfileIdentityEditor } from '../../src/components/ProfileIdentityEditor';

const PRINCIPAL = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OLD_AVATAR = {
  revision: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  width: 256,
  height: 256,
  updated_at: '2026-08-25T01:02:03.004Z',
};
const NEW_AVATAR = {
  revision: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  width: 320,
  height: 320,
  updated_at: '2026-08-25T02:03:04.005Z',
};
const OLD_RESPONSE: ProfileIdentityResponse = {
  user: {
    id: PRINCIPAL,
    payme_id: 'payme_mx_a1b2',
    email: 'owner@laparolaccia.mx',
    first_name: 'Sofía',
    last_name: 'Fernández',
    phone: null,
    birth_date: null,
    created_at: '2026-08-24T01:02:03.004Z',
    birth_date_set: false,
    is_adult: null,
    avatar: OLD_AVATAR,
  },
};
const NEW_RESPONSE: ProfileIdentityResponse = {
  user: {
    ...OLD_RESPONSE.user,
    first_name: 'Renata',
    last_name: 'Nueva',
    avatar: NEW_AVATAR,
  },
};
const ORIGIN: StoredSession = {
  access_token: 'a1',
  refresh_token: 'r1',
  family_id: 'family-profile-refresh',
  principal_id: PRINCIPAL,
  user: {
    id: PRINCIPAL,
    payme_id: OLD_RESPONSE.user.payme_id,
    email: OLD_RESPONSE.user.email,
    first_name: OLD_RESPONSE.user.first_name,
    last_name: OLD_RESPONSE.user.last_name,
    avatar: OLD_AVATAR,
  },
};

interface ProfileRefreshStats {
  profileGets: number;
  avatarGets: number;
  mutations: number;
  firstName: string | null;
  lastName: string | null;
  avatarRevision: string | null;
}

type HarnessWindow = Window & {
  __profileRefreshResolveOldGets?: () => void;
  __profileRefreshStats?: () => ProfileRefreshStats;
  __profileRefreshUnmount?: () => void;
};

function CurrentSessionProfile() {
  const [session, setSession] = useState<StoredSession>(() => loadSession() ?? ORIGIN);
  useEffect(() => subscribeSession(() => {
    const current = loadSession();
    if (current) setSession(current);
  }), []);
  const adoptUser = useCallback((expected: StoredSession, user: User) => (
    replaceCurrentSession(expected, { ...expected, user })
  ), []);
  return createElement(ProfileIdentityEditor, { session, enabled: true, adoptUser });
}

/** Harness de navegador: reproduce refresh dentro de PATCH sin entrar al bundle. */
export function mountProfileRefreshHarness(): void {
  saveSession(ORIGIN);
  const host = document.createElement('div');
  host.id = 'profile-refresh-harness';
  document.body.replaceChildren(host);

  let profileGets = 0;
  let avatarGets = 0;
  let mutations = 0;
  const pendingProfileGets: Array<(value: ProfileIdentityResponse) => void> = [];
  const original = {
    getProfileIdentity: api.getProfileIdentity,
    getProfileAvatar: api.getProfileAvatar,
    updateProfileIdentity: api.updateProfileIdentity,
  };
  api.getProfileIdentity = async () => {
    profileGets += 1;
    return new Promise<ProfileIdentityResponse>((resolve) => pendingProfileGets.push(resolve));
  };
  api.getProfileAvatar = async () => {
    avatarGets += 1;
    return { blob: new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }) };
  };
  api.updateProfileIdentity = async (_body, expectedSession) => {
    mutations += 1;
    const rotated = { ...expectedSession, access_token: 'a2', refresh_token: 'r2' };
    if (!replaceCurrentSession(expectedSession, rotated)) throw new Error('refresh_fixture_cas_failed');
    // Equivale al 401→refresh del transporte y deja que React observe a2/r2.
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return NEW_RESPONSE;
  };

  const root = createRoot(host);
  root.render(createElement(CurrentSessionProfile));
  const target = window as HarnessWindow;
  target.__profileRefreshResolveOldGets = () => {
    pendingProfileGets.splice(0).forEach((resolve) => resolve(OLD_RESPONSE));
  };
  target.__profileRefreshStats = () => {
    const current = loadSession();
    return {
      profileGets,
      avatarGets,
      mutations,
      firstName: current?.user?.first_name ?? null,
      lastName: current?.user?.last_name ?? null,
      avatarRevision: current?.user?.avatar?.revision ?? null,
    };
  };
  target.__profileRefreshUnmount = () => {
    root.unmount();
    api.getProfileIdentity = original.getProfileIdentity;
    api.getProfileAvatar = original.getProfileAvatar;
    api.updateProfileIdentity = original.updateProfileIdentity;
    delete target.__profileRefreshResolveOldGets;
    delete target.__profileRefreshStats;
    delete target.__profileRefreshUnmount;
  };
}
