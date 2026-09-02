import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { autoridadDeAlta } from '../screens/LoginScreen';
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

/**
 * C2b · **la coexistencia que el dueño exige, del lado del consumidor.**
 *
 * El cierre del corte dice, textual, que abrir el alta pública materializa el
 * «cuando estemos listos» de D-FF-1 **sin borrar el mecanismo de invitación**.
 * Acá se fija que abrir la puerta no desactiva la llave: con las dos presentes,
 * la invitación manda; y sin invitación, la puerta alcanza.
 */
describe('C2b · el alta pública NO retira la invitación', () => {
  it('con las dos autoridades presentes gana la invitación, y su token es el que viaja', () => {
    const conToken = { status: 'available', token: SIGNUP, custodied: true } as const;
    expect(autoridadDeAlta(conToken, true)).toEqual({ tipo: 'invitacion', token: SIGNUP });
  });

  it('sin invitación, el alta abierta alcanza; cerrada, no hay alta', () => {
    expect(autoridadDeAlta({ status: 'absent' }, true)).toEqual({ tipo: 'publica' });
    expect(autoridadDeAlta({ status: 'absent' }, false)).toBeNull();
  });

  it('una invitación rota no bloquea el alta pública: cae a la puerta abierta', () => {
    // Un token corrupto en la URL no puede dejar sin registrarse a alguien
    // cuando el dueño abrió el alta. El owner igual valida lo que reciba.
    expect(autoridadDeAlta({ status: 'invalid' }, true)).toEqual({ tipo: 'publica' });
    expect(autoridadDeAlta({ status: 'invalid' }, false)).toBeNull();
  });

  /**
   * 🔴 El seam del mock **no puede tocar el camino real**, y esto lo fija.
   *
   * `mockApi` viaja en el bundle real porque su import es estático, así que la
   * garantía no puede ser «ese código no existe en producción»: es que **el
   * lector de la capability real jamás consulta `localStorage`**. Su única
   * fuente es `GET /api/config`.
   */
  it('el lector real de la capability no consulta storage: su única fuente es el config del dueño', () => {
    const fuente = readFileSync(new URL('./socialAuth.ts', import.meta.url), 'utf8');
    expect(fuente).not.toMatch(/localStorage|sessionStorage/);
    expect(fuente).toContain('features.signup');
    // Y la clave del mock es del mock: sólo aparece en su módulo.
    const mock = readFileSync(new URL('./mock/mockApi.ts', import.meta.url), 'utf8');
    expect(mock).toContain('payme.app.mock.public_signup.v1');
    expect(fuente).not.toContain('public_signup');
  });
});
