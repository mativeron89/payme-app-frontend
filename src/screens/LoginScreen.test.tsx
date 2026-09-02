import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { autoridadDeAlta, socialActionEligible } from './LoginScreen';

const source = readFileSync(new URL('./LoginScreen.tsx', import.meta.url), 'utf8');

describe('LoginScreen · gates sociales owner-first', () => {
  it('login depende sólo de la acción exacta; registro exige autoridad, legal y nombres', () => {
    const base = {
      providerActionEnabled: true,
      autoridad: { tipo: 'invitacion', token: 'signup-token-aaaaaaaaaaaaaaaaaaaa' } as const,
      legalReady: true,
      firstName: 'Mati',
      lastName: 'Verón',
      email: '',
      requiereInvitacion: false,
    };
    expect(socialActionEligible({ ...base, mode: 'login' })).toBe(true);
    expect(socialActionEligible({ ...base, mode: 'login', providerActionEnabled: false })).toBe(false);
    expect(socialActionEligible({ ...base, mode: 'register' })).toBe(true);

    for (const blocked of [
      { autoridad: null },
      { legalReady: false },
      { firstName: '   ' },
      { lastName: '' },
      { providerActionEnabled: false },
    ]) {
      expect(socialActionEligible({ ...base, ...blocked, mode: 'register' })).toBe(false);
    }
  });

  /**
   * C2b · dos autoridades para crear una cuenta, y la invitación gana.
   *
   * No es una preferencia estética: si alguien llega con un token, el dueño lo
   * **valida y consume** (`signup_gate` del contrato). Ignorarlo porque el alta
   * esté abierta desperdiciaría una autoridad de un solo uso y cambiaría a qué
   * email queda ligada la cuenta.
   */
  it('la invitación gana sobre el alta pública, y sin ninguna de las dos no hay alta', () => {
    const conToken = { status: 'available', token: 'signup-token-aaaaaaaaaaaaaaaaaaaa', custodied: true } as const;
    expect(autoridadDeAlta(conToken, true)).toEqual({ tipo: 'invitacion', token: conToken.token });
    expect(autoridadDeAlta(conToken, false)).toEqual({ tipo: 'invitacion', token: conToken.token });
    expect(autoridadDeAlta({ status: 'absent' }, true)).toEqual({ tipo: 'publica' });
    expect(autoridadDeAlta({ status: 'invalid' }, true)).toEqual({ tipo: 'publica' });
    expect(autoridadDeAlta({ status: 'absent' }, false)).toBeNull();
    expect(autoridadDeAlta({ status: 'invalid' }, false)).toBeNull();
  });

  /**
   * D-R16 · sin invitación, el email que la persona escribe es la ÚNICA fuente
   * del email de la cuenta (`request_notes.email` del contrato). Por eso con
   * autoridad pública el botón de Google no puede habilitarse sin él, y con
   * invitación sí: ahí el email lo pone la invitación.
   */
  it('con alta pública el email es obligatorio para el alta social; con invitación no', () => {
    const base = {
      mode: 'register',
      providerActionEnabled: true,
      legalReady: true,
      firstName: 'Mati',
      lastName: 'Verón',
      requiereInvitacion: false,
    } as const;
    const publica = { tipo: 'publica' } as const;
    const invitacion = { tipo: 'invitacion', token: 'signup-token-aaaaaaaaaaaaaaaaaaaa' } as const;

    expect(socialActionEligible({ ...base, autoridad: publica, email: 'mati@payme.mx' })).toBe(true);
    expect(socialActionEligible({ ...base, autoridad: publica, email: '   ' })).toBe(false);
    expect(socialActionEligible({ ...base, autoridad: publica, email: '' })).toBe(false);
    // Con invitación el email no se exige: lo aporta la autoridad del dueño.
    expect(socialActionEligible({ ...base, autoridad: invitacion, email: '' })).toBe(true);
  });

  /**
   * 🔴 Facebook NO entra al alta pública, y esto es contrato, no criterio: su
   * `register/start` **conserva `invitation_token` obligatorio**
   * (`endpoints.facebook_register_start.request` y `signup_gate.facebook` del
   * contrato espejado). Sin esta guarda, abrir el alta habilitaría un botón que
   * mandaría un body que el dueño rechaza. Sigue dark, pero la puerta se cierra
   * igual: dark es configuración, esto es forma del contrato.
   */
  it('un proveedor que exige invitación no se habilita con autoridad pública', () => {
    const base = {
      mode: 'register',
      providerActionEnabled: true,
      legalReady: true,
      firstName: 'Mati',
      lastName: 'Verón',
      email: 'mati@payme.mx',
      requiereInvitacion: true,
    } as const;
    expect(socialActionEligible({ ...base, autoridad: { tipo: 'publica' } })).toBe(false);
    expect(socialActionEligible({
      ...base,
      autoridad: { tipo: 'invitacion', token: 'signup-token-aaaaaaaaaaaaaaaaaaaa' },
    })).toBe(true);
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

  it('Google captura propósito, invitación, nombres e idioma sin leer autoridad live', () => {
    expect(source).not.toContain('googleAction.current');
    expect(source).toContain("readonly purpose: 'login';");
    expect(source).toContain("readonly purpose: 'register';");
    expect(source).toContain("const locale = idioma === 'en' ? 'en' : 'es';");
    // C2b · la autoridad de la invitación ahora sale del resolutor
    // (`autoridadDeAlta`), no del snapshot leído en el memo. Lo que el centinela
    // vigila es lo mismo: que se CAPTURE en el memo y no se lea viva después.
    expect(source).toContain('invitationToken: autoridad.token');
    expect(source).toContain('firstName: firstName.trim()');
    expect(source).toContain('lastName: lastName.trim()');
    expect(source).toContain('locale: authority.locale');
    expect(source).toContain('googleAuthorityRef.current !== authority');
    expect(source).toContain('currentInvitation.token !== authority.alta.invitationToken');
    // Y el caso nuevo: con alta pública lo que se revalida es la capability.
    expect(source).toContain('!socialAuthSnapshot().publicRegistration');
    expect(source).toContain('useLayoutEffect(() => {');
    expect(source).toContain('googleAuthorityRef.current = googleAuthority;');
    expect(source).not.toContain('Se invalida durante render');
    expect(source).toContain('let handle: GoogleButtonHandle;');
    expect(source).toContain('setGoogleLoadFailed(true);');
    expect(source).toContain('El router global ya consumió el state antes del callback.');
  });

  it('contraseña, Google y Facebook toman el lease sincrónico antes del primer await', () => {
    expect(source).toContain('const authActionActive = useRef(false);');
    expect(source).toContain('if (authActionActive.current) return false;');

    const googleLease = source.indexOf('if (!tryAcquireAuthAction()) {', source.indexOf('onCredential:'));
    const googleAwait = source.indexOf('await googleLogin(credential);', googleLease);
    const facebookLease = source.indexOf('if (!facebookEligible || !tryAcquireAuthAction()) return;');
    const facebookAwait = source.indexOf('await api.facebookLoginStart()', facebookLease);
    const passwordLease = source.indexOf('if (!tryAcquireAuthAction()) return;', source.indexOf('async function onSubmit'));
    const passwordAwait = source.indexOf('await login(email, password);', passwordLease);

    expect(googleLease).toBeGreaterThan(-1);
    expect(googleLease).toBeLessThan(googleAwait);
    expect(facebookLease).toBeGreaterThan(-1);
    expect(facebookLease).toBeLessThan(facebookAwait);
    expect(passwordLease).toBeGreaterThan(-1);
    expect(passwordLease).toBeLessThan(passwordAwait);
  });

  it('el redirect real conserva el lease hasta unload y un assign fallido sí lo libera', () => {
    const redirecting = source.indexOf('let redirecting = false;');
    const assign = source.indexOf('window.location.assign(authorizationUrl);', redirecting);
    const retain = source.indexOf('redirecting = true;', assign);
    const conditionalRelease = source.indexOf('if (!redirecting) {', retain);
    const release = source.indexOf('releaseAuthAction();', conditionalRelease);
    expect(redirecting).toBeGreaterThan(-1);
    expect(redirecting).toBeLessThan(assign);
    expect(assign).toBeLessThan(retain);
    expect(retain).toBeLessThan(conditionalRelease);
    expect(conditionalRelease).toBeLessThan(release);
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
