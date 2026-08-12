import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readPendingInvitationLink } from './invitationLink';
import {
  SIGNUP_INVITATION_STORAGE_KEY,
  captureSignupInvitation,
  clearSignupInvitation,
  readPendingSignupInvitation,
} from './signupInvitation';
import { closeInvitationCustody, openInvitationCustody } from '../screens/invitationCustody';

const SIGNUP = 'signup-token-aaaaaaaaaaaaaaaaaaaa';
const MESA = 'mesa-token-bbbbbbbbbbbbbbbbbbbbb';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  } as unknown as Storage;
}

function mutableBrowser(initialHash: string) {
  const location = { pathname: '/', search: '?r=restaurante', hash: initialHash };
  const replaceState = vi.fn((_state: unknown, _title: string, next: string) => {
    const parsed = new URL(next, 'https://app.paymemx.com');
    location.pathname = parsed.pathname;
    location.search = parsed.search;
    location.hash = parsed.hash;
  });
  vi.stubGlobal('window', {
    location,
    history: { state: null, replaceState },
    addEventListener() {},
    removeEventListener() {},
  });
  return { location, replaceState };
}

beforeEach(() => vi.stubGlobal('sessionStorage', memoryStorage()));
afterEach(() => vi.unstubAllGlobals());

describe('las dos autoridades conviven sin cruzarse', () => {
  it.each(['mesa→signup', 'signup→mesa'])('%s conserva ambas hasta sus éxitos propios', (order) => {
    const browser = mutableBrowser(`#/mesa/PA-2847?t=${MESA}&signup_invitation=${SIGNUP}`);

    if (order === 'mesa→signup') {
      expect(openInvitationCustody('PA-2847', MESA)).toBe(true);
      expect(captureSignupInvitation()).toMatchObject({ status: 'available', token: SIGNUP });
    } else {
      expect(captureSignupInvitation()).toMatchObject({ status: 'available', token: SIGNUP });
      expect(openInvitationCustody('PA-2847', MESA)).toBe(true);
    }

    expect(readPendingInvitationLink()).toMatchObject({ code: 'PA-2847', token: MESA });
    expect(readPendingSignupInvitation()).toBe(SIGNUP);
    expect(browser.location.search).toBe('?r=restaurante');
    expect(browser.location.hash).toBe('#/mesa/PA-2847');

    clearSignupInvitation();
    expect(sessionStorage.getItem(SIGNUP_INVITATION_STORAGE_KEY)).toBeNull();
    expect(readPendingInvitationLink()?.token).toBe(MESA);

    closeInvitationCustody();
    expect(readPendingInvitationLink()).toBeNull();
  });
});
