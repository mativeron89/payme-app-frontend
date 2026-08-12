import { describe, expect, it } from 'vitest';
import { modeAfterSignupSnapshot } from '../screens/LoginScreen';

const SOURCES = import.meta.glob(['/src/**/*.ts', '/src/**/*.tsx'], {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

function source(path: string): string {
  const value = SOURCES[`/src/${path}`];
  if (typeof value !== 'string') throw new Error(`fuente no encontrada: ${path}`);
  return value;
}

describe('D-FF-1 · cableado owner→formulario', () => {
  const login = source('screens/LoginScreen.tsx');
  const join = source('screens/JoinMesaScreen.tsx');
  const main = source('main.tsx');
  const api = source('api/index.ts');
  const mock = source('api/mock/mockApi.ts');

  it('la custodia corre antes de React y ambas superficies leen el mismo snapshot', () => {
    expect(main).toContain('bootstrapSignupInvitationCustody();');
    expect(main.indexOf('bootstrapSignupInvitationCustody();'))
      .toBeLessThan(main.indexOf('createRoot(el).render('));
    expect(login).toContain('useSyncExternalStore(');
    expect(join).toContain('useSyncExternalStore(');
    expect(login).not.toMatch(/key=\{[^}]*signup\.token/);
    expect(login).not.toMatch(/console\.[a-z]+\([^)]*signup\.token/);
    expect(login).not.toMatch(/>\s*\{signup\.token\}\s*</);
  });

  it('el primer snapshot no pisa “Ya tengo cuenta”; una navegación posterior sí reacciona', () => {
    expect(modeAfterSignupSnapshot('login', false, true)).toBe('login');
    expect(modeAfterSignupSnapshot('register', false, false)).toBe('register');
    expect(modeAfterSignupSnapshot('login', true, true)).toBe('register');
    expect(modeAfterSignupSnapshot('register', true, false)).toBe('login');
  });

  it('manda la autoridad y la limpia sólo después de que register confirmó sesión', () => {
    const send = login.indexOf('await register({');
    const token = login.indexOf('invitation_token: signup.token', send);
    const clear = login.indexOf('clearSignupInvitation()', token);
    expect(send).toBeGreaterThan(-1);
    expect(token).toBeGreaterThan(send);
    expect(clear).toBeGreaterThan(token);
    expect(login.match(/clearSignupInvitation\(\)/g)).toHaveLength(1);
  });

  it('un 403 opaco no se interpreta ni suelta la credencial', () => {
    const mapping = login.slice(
      login.indexOf('registration_not_available:'),
      login.indexOf('registration_unavailable:'),
    );
    expect(mapping).toContain('No pudimos verificar esta invitación');
    expect(mapping).not.toMatch(/expired|used|email_mismatch|already_registered/i);
  });

  it('si el aviso pierde integridad entre GET y POST, vuelve a cerrar el alta', () => {
    expect(login).toContain("code === 'registration_unavailable'");
    expect(login).toContain("setLegal({ status: 'error' })");
    expect(login).toContain("legal.status !== 'ready'");
  });

  it('la invitación de mesa no crea autoridad de alta', () => {
    expect(join).toContain('signupInvitationSnapshot');
    expect(join).toContain('{signupAvailable && (');
    expect(join).not.toContain('invitation_token: token');
  });

  it('real y mock pasan por el aviso/decoder y el mock tampoco ofrece alta abierta', () => {
    expect(api).toContain("'/legal/aviso_privacidad'");
    expect(api.match(/legalTextResponse/g)?.length).toBeGreaterThanOrEqual(3);
    expect(mock).toContain("throw new MockApiError(403, 'registration_not_available')");
  });
});
