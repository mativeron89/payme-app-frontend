import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { socialActionEligible } from './LoginScreen';

const source = readFileSync(new URL('./LoginScreen.tsx', import.meta.url), 'utf8');

describe('LoginScreen · gates sociales owner-first', () => {
  it('login depende sólo de la acción exacta; registro exige invitación, legal y nombres', () => {
    const base = {
      providerActionEnabled: true,
      signupAvailable: true,
      legalReady: true,
      firstName: 'Mati',
      lastName: 'Verón',
    };
    expect(socialActionEligible({ ...base, mode: 'login' })).toBe(true);
    expect(socialActionEligible({ ...base, mode: 'login', providerActionEnabled: false })).toBe(false);
    expect(socialActionEligible({ ...base, mode: 'register' })).toBe(true);

    for (const blocked of [
      { signupAvailable: false },
      { legalReady: false },
      { firstName: '   ' },
      { lastName: '' },
      { providerActionEnabled: false },
    ]) {
      expect(socialActionEligible({ ...base, ...blocked, mode: 'register' })).toBe(false);
    }
  });

  it('password permanece en el formulario y recovery/social nacen capability-gated', () => {
    expect(source).toContain('type="password"');
    expect(source).toContain("mode === 'login' && social.recovery.enabled");
    expect(source).toContain('social.google.enabled');
    expect(source).toContain('social.facebook.enabled');
    expect(source).not.toMatch(/if \(!social\.[^)]+\) return null/);
  });

  it('Facebook liga sesión antes de /start, valida antes de navegar y el mock no abre Meta', () => {
    const witness = source.indexOf('const sessionStateWitness = captureSessionStateWitness();');
    const start = source.indexOf('await api.facebookLoginStart()');
    const prepare = source.indexOf('const authorizationUrl = prepareFacebookRedirect(');
    const simulate = source.indexOf('simulateFacebookCallbackForMock(response);');
    const complete = source.indexOf('await completeFacebookCallback();');
    const navigate = source.indexOf('window.location.assign(authorizationUrl);');
    expect(witness).toBeGreaterThan(-1);
    expect(witness).toBeLessThan(start);
    expect(start).toBeLessThan(prepare);
    expect(prepare).toBeLessThan(simulate);
    expect(simulate).toBeLessThan(complete);
    expect(complete).toBeLessThan(navigate);
    expect(source).not.toContain('fetch(');
  });

  it('alta Google consume la invitación sólo después de persistir la sesión', () => {
    const register = source.indexOf('await googleRegister({');
    const clear = source.indexOf('clearSignupInvitation();', register);
    expect(register).toBeGreaterThan(-1);
    expect(clear).toBeGreaterThan(register);
  });

  it('conserva el copy ES-MX exacto de la orden y el aviso recovery no-oracular', () => {
    for (const text of [
      'Continuar con Google',
      'Continuar con Facebook',
      'O usa tu correo y contraseña',
      '¿Olvidaste tu contraseña?',
      'Si existe una cuenta con ese correo, te enviaremos instrucciones.',
    ]) expect(source).toContain(text);
  });
});
