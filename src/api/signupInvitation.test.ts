import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SIGNUP_INVITATION_STORAGE_KEY,
  bootstrapSignupInvitationCustody,
  captureSignupInvitation,
  clearSignupInvitation,
  currentSignupInvitation,
  readPendingSignupInvitation,
  signupInvitationFromLocation,
  signupInvitationSnapshot,
  subscribeSignupInvitation,
} from './signupInvitation';

const TOKEN_A = 'signup-token-aaaaaaaaaaaaaaaaaaaa';
const TOKEN_B = 'signup-token-bbbbbbbbbbbbbbbbbbbb';

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

function browserStub(search: string, hash: string) {
  const replaceState = vi.fn();
  vi.stubGlobal('window', {
    location: { pathname: '/', search, hash },
    history: { state: null, replaceState },
  });
  return replaceState;
}

beforeEach(() => {
  vi.stubGlobal('sessionStorage', memoryStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('D-FF-1 · la invitación de alta es una credencial separada', () => {
  it('lee una única autoridad sólo desde el fragmento, que no viaja al hosting', () => {
    expect(signupInvitationFromLocation('', `#/mesa/PA-2847?t=mesa&signup_invitation=${TOKEN_A}`))
      .toEqual({ status: 'valid', token: TOKEN_A });
    expect(signupInvitationFromLocation(`?signup_invitation=${TOKEN_A}`, '#/home'))
      .toEqual({ status: 'invalid' });
  });

  it('falla cerrado ante duplicados, conflicto o forma fuera del contrato', () => {
    for (const [search, hash] of [
      ['', `#/home?signup_invitation=${TOKEN_A}&signup_invitation=${TOKEN_A}`],
      [`?signup_invitation=${TOKEN_A}`, `#/home?signup_invitation=${TOKEN_B}`],
      ['', '#/home?signup_invitation=corto'],
      ['', '#/home?signup_invitation='],
    ]) {
      expect(signupInvitationFromLocation(search, hash)).toEqual({ status: 'invalid' });
    }
  });

  it('distingue ausencia de autoridad inválida para no revivir una vieja', () => {
    expect(signupInvitationFromLocation('?r=restaurante', '#/home')).toEqual({ status: 'absent' });
  });
});

describe('D-FF-1 · custodia durante el alta', () => {
  it('confirma round-trip y recién entonces retira sólo la invitación de alta', () => {
    const replaceState = browserStub(
      '?r=restaurante',
      `#/mesa/PA-2847?t=token-de-mesa&signup_invitation=${TOKEN_A}`,
    );

    expect(captureSignupInvitation()).toEqual({ status: 'available', token: TOKEN_A, custodied: true });
    expect(readPendingSignupInvitation()).toBe(TOKEN_A);
    expect(replaceState).toHaveBeenCalledWith(
      null,
      '',
      '/?r=restaurante#/mesa/PA-2847?t=token-de-mesa',
    );
  });

  it('si storage acepta pero olvida, conserva el token en la URL', () => {
    vi.stubGlobal('sessionStorage', {
      setItem() {},
      getItem: () => null,
      removeItem() {},
    } as unknown as Storage);
    const replaceState = browserStub('', `#/home?signup_invitation=${TOKEN_A}`);

    expect(captureSignupInvitation()).toEqual({ status: 'available', token: TOKEN_A, custodied: false });
    expect(replaceState).not.toHaveBeenCalled();
  });

  it('si storage está bloqueado, la URL sigue siendo la custodia primaria', () => {
    vi.stubGlobal('sessionStorage', {
      setItem() { throw new Error('SecurityError'); },
      getItem() { throw new Error('SecurityError'); },
      removeItem() { throw new Error('SecurityError'); },
    } as unknown as Storage);
    const replaceState = browserStub('', `#/home?signup_invitation=${TOKEN_A}`);

    expect(captureSignupInvitation()).toEqual({ status: 'available', token: TOKEN_A, custodied: false });
    expect(replaceState).not.toHaveBeenCalled();
  });

  it('una query inválida no cae al token guardado de otra navegación', () => {
    sessionStorage.setItem(SIGNUP_INVITATION_STORAGE_KEY, JSON.stringify({ v: 1, token: TOKEN_A }));
    browserStub('', '#/home?signup_invitation=corto');
    expect(captureSignupInvitation()).toEqual({ status: 'invalid' });
    expect(sessionStorage.getItem(SIGNUP_INVITATION_STORAGE_KEY)).toBeNull();
  });

  it('un token B en URL nunca cae al A si storage ignora la nueva escritura', () => {
    const values = new Map([[SIGNUP_INVITATION_STORAGE_KEY, JSON.stringify({ v: 1, token: TOKEN_A })]]);
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem() { /* acepta pero conserva el valor A */ },
      removeItem: (key: string) => { values.delete(key); },
    } as unknown as Storage);
    const replaceState = browserStub('', `#/home?signup_invitation=${TOKEN_B}`);

    expect(captureSignupInvitation()).toEqual({ status: 'available', token: TOKEN_B, custodied: false });
    expect(replaceState).not.toHaveBeenCalled();
    expect(values.has(SIGNUP_INVITATION_STORAGE_KEY)).toBe(false);
  });

  it('si escribir B lanza, también descarta A y conserva B sólo en la URL', () => {
    let stored: string | null = JSON.stringify({ v: 1, token: TOKEN_A });
    vi.stubGlobal('sessionStorage', {
      getItem: () => stored,
      setItem() { throw new Error('QuotaExceededError'); },
      removeItem: () => { stored = null; },
    } as unknown as Storage);
    const replaceState = browserStub('', `#/home?signup_invitation=${TOKEN_B}`);

    expect(captureSignupInvitation()).toEqual({ status: 'available', token: TOKEN_B, custodied: false });
    expect(stored).toBeNull();
    expect(replaceState).not.toHaveBeenCalled();
  });

  it('un respaldo corrupto se elimina físicamente', () => {
    sessionStorage.setItem(SIGNUP_INVITATION_STORAGE_KEY, JSON.stringify({ v: 2, token: TOKEN_A }));
    expect(readPendingSignupInvitation()).toBeNull();
    expect(sessionStorage.getItem(SIGNUP_INVITATION_STORAGE_KEY)).toBeNull();
  });

  it('una fila vacía también se elimina físicamente', () => {
    sessionStorage.setItem(SIGNUP_INVITATION_STORAGE_KEY, '');
    expect(readPendingSignupInvitation()).toBeNull();
    expect(sessionStorage.getItem(SIGNUP_INVITATION_STORAGE_KEY)).toBeNull();
  });

  it('el éxito del alta limpia sólo su credencial y deja intacta la de mesa', () => {
    sessionStorage.setItem(SIGNUP_INVITATION_STORAGE_KEY, JSON.stringify({ v: 1, token: TOKEN_A }));
    sessionStorage.setItem('payme_pending_invitation_link', 'credencial-de-mesa');
    const replaceState = browserStub('', `#/mesa/PA-2847?t=token-de-mesa&signup_invitation=${TOKEN_A}`);

    clearSignupInvitation();

    expect(sessionStorage.getItem(SIGNUP_INVITATION_STORAGE_KEY)).toBeNull();
    expect(sessionStorage.getItem('payme_pending_invitation_link')).toBe('credencial-de-mesa');
    expect(replaceState).toHaveBeenCalledWith(null, '', '/#/mesa/PA-2847?t=token-de-mesa');
  });
});

describe('navegación sin remonte', () => {
  it('URL válida gana, URL inválida no cae al storage y ausencia sí', () => {
    sessionStorage.setItem(SIGNUP_INVITATION_STORAGE_KEY, JSON.stringify({ v: 1, token: TOKEN_A }));
    const browser = browserStub('', `#/home?signup_invitation=${TOKEN_B}`);
    expect(currentSignupInvitation()).toBe(TOKEN_B);
    (window.location as unknown as { hash: string }).hash = '#/home?signup_invitation=corto';
    expect(currentSignupInvitation()).toBeNull();
    (window.location as unknown as { hash: string }).hash = '#/home';
    expect(currentSignupInvitation()).toBe(TOKEN_A);
    expect(browser).not.toHaveBeenCalled();
  });

  it('suscribe y desuscribe hashchange sin exponer el raw al callback', () => {
    const listeners = new Map<string, () => void>();
    vi.stubGlobal('window', {
      location: { pathname: '/', search: '', hash: '#/home' },
      history: { state: null, replaceState() {} },
      addEventListener: (event: string, listener: () => void) => listeners.set(event, listener),
      removeEventListener: (event: string, listener: () => void) => {
        if (listeners.get(event) === listener) listeners.delete(event);
      },
    });
    const onChange = vi.fn();
    const unsubscribeSnapshot = subscribeSignupInvitation(onChange);
    const stopCustody = bootstrapSignupInvitationCustody();
    (window.location as unknown as { hash: string }).hash = `#/home?signup_invitation=${TOKEN_B}`;
    listeners.get('hashchange')?.();
    expect(onChange).toHaveBeenCalledWith();
    expect(signupInvitationSnapshot()).toMatchObject({ status: 'available', token: TOKEN_B });
    stopCustody();
    expect(listeners.has('hashchange')).toBe(false);
    unsubscribeSnapshot();
  });
});
