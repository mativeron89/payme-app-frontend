import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from 'react';
import { useIdioma } from '../i18n/idioma';
import { IS_MOCK } from '../api';
import { api } from '../api';
import { extractApiError } from '../api/errors';
import {
  prepareFacebookRedirect,
  simulateFacebookCallbackForMock,
} from '../api/facebookAuthFlow';
import {
  renderGoogleIdentityButton,
  type GoogleButtonHandle,
} from '../api/googleIdentity';
import { useSocialAuthCapability } from '../api/socialAuth';
import { captureSessionStateWitness } from '../api/storage';
import {
  clearSignupInvitation,
  signupInvitationSnapshot,
  subscribeSignupInvitation,
} from '../api/signupInvitation';
import type { LegalTextResponse } from '../api/types';
import { useAuth } from '../auth/AuthContext';

/**
 * Login / registro según el contrato (routes/auth.js):
 * login {email, password} · register {email, password, first_name, last_name,
 * invitation_token} con password 8–128 chars. El mock conserva la misma
 * compuerta de superficie, aunque sólo PostgreSQL acredita one-use/email/TTL.
 */

const ERROR_TEXT: Record<string, string> = {
  invalid_credentials: 'Email o contraseña incorrectos.',
  email_already_registered: 'Ese email ya está registrado.',
  user_suspended: 'Tu cuenta está suspendida. Escríbenos.',
  too_many_auth_attempts: 'Demasiados intentos. Espera un minuto.',
  validation_error: 'Revisa los datos: email válido y contraseña de al menos 8 caracteres.',
  registration_not_available: 'No pudimos verificar esta invitación. Actualiza en un momento.',
  registration_unavailable: 'Prueba de nuevo más tarde.',
  too_many_signup_attempts: 'Prueba de nuevo más tarde.',
  rate_limit_unavailable: 'Prueba de nuevo más tarde.',
};

export interface SocialActionEligibility {
  readonly mode: 'login' | 'register';
  readonly providerActionEnabled: boolean;
  readonly signupAvailable: boolean;
  readonly legalReady: boolean;
  readonly firstName: string;
  readonly lastName: string;
}

/** La alta social hereda invitación, legal y nombres; nunca email/password. */
export function socialActionEligible(input: SocialActionEligibility): boolean {
  if (!input.providerActionEnabled) return false;
  if (input.mode === 'login') return true;
  return input.signupAvailable
    && input.legalReady
    && input.firstName.trim().length > 0
    && input.lastName.trim().length > 0;
}

function errorMessage(err: unknown, t: (s: string, ...a: unknown[]) => string): string {
  const { code } = extractApiError(err);
  // 🔴 `ERROR_TEXT` es constante de MÓDULO: sus valores están en español y
  // se traducen ACÁ, que es donde `t` existe. Envolverlos arriba no compila.
  const crudo = ERROR_TEXT[code];
  return crudo ? t(crudo) : t('No pudimos conectar. Prueba de nuevo.');
}

type LegalState =
  | { status: 'idle' | 'loading' | 'error' }
  | { status: 'ready'; value: LegalTextResponse['legal_text'] };

type GoogleActionAuthority =
  | {
      readonly purpose: 'login';
      readonly clientId: string;
      readonly locale: 'es' | 'en';
    }
  | {
      readonly purpose: 'register';
      readonly clientId: string;
      readonly locale: 'es' | 'en';
      readonly invitationToken: string;
      readonly firstName: string;
      readonly lastName: string;
    };

export function modeAfterSignupSnapshot(
  current: 'login' | 'register',
  changed: boolean,
  signupAvailable: boolean,
): 'login' | 'register' {
  if (!changed) return current;
  return signupAvailable ? 'register' : 'login';
}

/**
 * `initialMode` existe para la entrada por link (SPEC_APP.md §1.2-A): esa
 * pantalla ofrece **dos** acciones —"Crear cuenta gratis" y "Ya tengo cuenta ·
 * Entrar"— y cada una tiene que abrir el formulario ya en su modo. Sin esto,
 * quien viene a registrarse aterriza en el login y tiene que buscar el toggle.
 * El alta en sí NO se rediseña acá: sigue siendo este formulario tal cual.
 */
export function LoginScreen({ initialMode }: { initialMode?: 'login' | 'register' } = {}) {
  const { t, idioma } = useIdioma();
  const {
    login,
    register,
    googleLogin,
    googleRegister,
    facebookCallbackPhase,
    completeFacebookCallback,
    clearFacebookCallbackError,
  } = useAuth();
  const social = useSocialAuthCapability();
  const signup = useSyncExternalStore(
    subscribeSignupInvitation,
    signupInvitationSnapshot,
    signupInvitationSnapshot,
  );
  const [mode, setMode] = useState<'login' | 'register'>(() =>
    initialMode === 'register' && signup.status !== 'available'
      ? 'login'
      : initialMode ?? (signup.status === 'available' ? 'register' : 'login'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [busy, setBusy] = useState(false);
  const [socialBusy, setSocialBusy] = useState(false);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryAccepted, setRecoveryAccepted] = useState(false);
  const [googleGeneration, setGoogleGeneration] = useState(0);
  const [googleLoadFailed, setGoogleLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [legal, setLegal] = useState<LegalState>({ status: 'idle' });
  const [legalAttempt, setLegalAttempt] = useState(0);
  const previousSignup = useRef(signup);
  const googleContainer = useRef<HTMLDivElement | null>(null);
  const googleHandle = useRef<GoogleButtonHandle | null>(null);
  const googleAuthorityRef = useRef<GoogleActionAuthority | null>(null);
  // React state no arbitra dos eventos en el mismo tick. Este lease sincrónico
  // cubre contraseña, Google y Facebook antes del primer await.
  const authActionActive = useRef(false);

  const signupAvailable = signup.status === 'available';
  const legalReady = legal.status === 'ready';
  const googleEligible = socialActionEligible({
    mode,
    providerActionEnabled: social.google.enabled
      && (mode === 'login' ? social.google.login : social.google.registration),
    signupAvailable,
    legalReady,
    firstName,
    lastName,
  }) && social.google.webClientId !== null;
  const facebookEligible = socialActionEligible({
    mode,
    providerActionEnabled: social.facebook.enabled
      && (mode === 'login' ? social.facebook.login : social.facebook.registration),
    signupAvailable,
    legalReady,
    firstName,
    lastName,
  });

  const googleAuthority = useMemo<GoogleActionAuthority | null>(() => {
    const clientId = social.google.webClientId;
    if (!googleEligible || clientId === null) return null;
    const locale = idioma === 'en' ? 'en' : 'es';
    if (mode === 'login') return { purpose: 'login', clientId, locale };
    if (signup.status !== 'available' || legal.status !== 'ready') return null;
    return {
      purpose: 'register',
      clientId,
      locale,
      invitationToken: signup.token,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
    };
  }, [
    firstName,
    googleEligible,
    idioma,
    lastName,
    legal.status,
    mode,
    signup,
    social.google.webClientId,
  ]);
  // Sólo un render COMMITTEADO puede mover autoridad. `useLayoutEffect` corre
  // antes de que el navegador entregue otro evento; un render concurrente
  // abortado no envenena el ref ni mata el botón que sigue visible.
  useLayoutEffect(() => {
    googleAuthorityRef.current = googleAuthority;
    return () => {
      if (googleAuthorityRef.current === googleAuthority) googleAuthorityRef.current = null;
    };
  }, [googleAuthority]);

  const tryAcquireAuthAction = () => {
    if (authActionActive.current) return false;
    authActionActive.current = true;
    return true;
  };
  const releaseAuthAction = () => { authActionActive.current = false; };

  useEffect(() => {
    googleHandle.current?.dispose();
    googleHandle.current = null;
    const container = googleContainer.current;
    const authority = googleAuthority;
    if (!authority || !container || googleLoadFailed) return;
    let active = true;
    let handle: GoogleButtonHandle;
    try {
      handle = renderGoogleIdentityButton({
        container,
        clientId: authority.clientId,
        locale: authority.locale,
        mockLabel: t('Continuar con Google'),
        onCredential: (credential) => {
          if (googleAuthorityRef.current !== authority) return;
          if (authority.purpose === 'register') {
            const currentInvitation = signupInvitationSnapshot();
            if (currentInvitation.status !== 'available'
                || currentInvitation.token !== authority.invitationToken) return;
          }
          if (!tryAcquireAuthAction()) {
            // El router global ya consumió el state antes del callback. Montar
            // una generación nueva evita dejar un iframe visible pero muerto.
            setGoogleGeneration((value) => value + 1);
            return;
          }
          setSocialBusy(true);
          setError(null);
          void (async () => {
            try {
              if (authority.purpose === 'login') {
                await googleLogin(credential);
              } else {
                await googleRegister({
                  id_token: credential,
                  invitation_token: authority.invitationToken,
                  first_name: authority.firstName,
                  last_name: authority.lastName,
                });
                clearSignupInvitation();
              }
            } catch {
              setError(t('No pudimos completar el ingreso. Prueba de nuevo.'));
              // El handle es one-use: un fallo requiere una generación nueva.
              setGoogleGeneration((value) => value + 1);
            } finally {
              setSocialBusy(false);
              releaseAuthAction();
            }
          })();
        },
      });
    } catch {
      setError(t('No pudimos completar el ingreso. Prueba de nuevo.'));
      setGoogleLoadFailed(true);
      return;
    }
    googleHandle.current = handle;
    void handle.ready.catch(() => {
      if (!active) return;
      setError(t('No pudimos completar el ingreso. Prueba de nuevo.'));
      setGoogleLoadFailed(true);
    });
    return () => {
      active = false;
      handle.dispose();
      if (googleHandle.current === handle) googleHandle.current = null;
    };
  }, [googleAuthority, googleGeneration, googleLoadFailed, googleLogin, googleRegister, t]);

  async function onFacebook() {
    if (!facebookEligible || !tryAcquireAuthAction()) return;
    let redirecting = false;
    setSocialBusy(true);
    setError(null);
    clearFacebookCallbackError();
    try {
      const sessionStateWitness = captureSessionStateWitness();
      const response = mode === 'login'
        ? await api.facebookLoginStart()
        : signup.status === 'available' && legal.status === 'ready'
          ? await api.facebookRegisterStart({
              invitation_token: signup.token,
              first_name: firstName.trim(),
              last_name: lastName.trim(),
            })
          : (() => { throw new Error('social_registration_prerequisite_changed'); })();
      const authorizationUrl = prepareFacebookRedirect(
        response,
        mode,
        social.facebook,
        sessionStateWitness,
      );
      if (IS_MOCK) {
        simulateFacebookCallbackForMock(response);
        await completeFacebookCallback();
      } else {
        window.location.assign(authorizationUrl);
        // `assign` ya fue aceptado. El unload libera toda la página; hacerlo
        // acá reabriría una ventana para otra auth antes de abandonar PayMe.
        redirecting = true;
      }
    } catch {
      setError(t('No pudimos completar el ingreso. Prueba de nuevo.'));
    } finally {
      if (!redirecting) {
        setSocialBusy(false);
        releaseAuthAction();
      }
    }
  }

  async function onRecoveryRequest() {
    if (mode !== 'login' || !social.recovery.enabled || recoveryBusy) return;
    setRecoveryBusy(true);
    setRecoveryAccepted(false);
    setError(null);
    try {
      await api.requestRecovery(email.trim());
      setRecoveryAccepted(true);
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setRecoveryBusy(false);
    }
  }

  // Un segundo link abierto en la misma pestaña cambia sólo el hash: React no
  // remonta el componente. La custodia debe reaccionar a esa navegación y no
  // seguir mandando la autoridad anterior.
  useEffect(() => {
    const previous = previousSignup.current;
    previousSignup.current = signup;
    // En el primer efecto ambos son el mismo snapshot: respetar initialMode y
    // el botón explícito “Ya tengo cuenta”. Sólo una NAVEGACIÓN posterior
    // cambia el modo por autoridad nueva/retirada.
    const next = modeAfterSignupSnapshot(mode, previous !== signup, signup.status === 'available');
    if (next !== mode) setMode(next);
    if (previous === signup) return;
    setError(null);
  }, [signup, mode]);

  useEffect(() => {
    if (mode !== 'register' || signup.status !== 'available') {
      setLegal({ status: 'idle' });
      return;
    }
    let alive = true;
    setLegal({ status: 'loading' });
    api.getPrivacyNotice()
      .then((response) => {
        if (alive) setLegal({ status: 'ready', value: response.legal_text });
      })
      .catch(() => {
        if (alive) setLegal({ status: 'error' });
      });
    return () => { alive = false; };
  }, [mode, signup, legalAttempt]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!tryAcquireAuthAction()) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') {
        await login(email, password);
      } else {
        if (signup.status !== 'available' || legal.status !== 'ready') {
          setError(t('No pudimos verificar esta invitación. Actualiza en un momento.'));
          return;
        }
        await register({
          email,
          password,
          first_name: firstName,
          last_name: lastName,
          invitation_token: signup.token,
        });
        // `register` retorna sólo después de que la sesión quedó persistida.
        // Un 403 opaco conserva el token: puede ser sólo un email mal escrito.
        clearSignupInvitation();
      }
    } catch (err) {
      const { code } = extractApiError(err);
      // Carrera GET→POST: el owner perdió integridad legal. El aviso cacheado
      // deja de acreditar el alta y sólo un GET nuevo puede reabrirla.
      if (code === 'registration_unavailable') setLegal({ status: 'error' });
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
      releaseAuthAction();
    }
  }

  return (
    <div className="login-screen">
      <div style={{ textAlign: 'center', marginBottom: 22 }}>
        <div className="logo" style={{ fontSize: 'var(--fs-legacy-3xl)' }}>
          Pay<span className="t">Me</span>
        </div>
        <div className="hero-sub" style={{ fontSize: 'var(--fs-legacy-base)' }}>
          {t('Divide y paga la cuenta desde la mesa')}
        </div>
      </div>

      <form className="login-card" onSubmit={onSubmit}>
        <div className="h2" style={{ marginBottom: 14 }}>
          {mode === 'login' ? t('Entra a tu cuenta') : t('Crea tu cuenta')}
        </div>
        {error && (
          <div id="login-error" className="form-error" role="alert">
            {error}
          </div>
        )}
        {!error && facebookCallbackPhase === 'error' && (
          <div id="login-error" className="form-error social-callback-error" role="alert">
            <div>{t('No pudimos completar el ingreso. Prueba de nuevo.')}</div>
            <button
              type="button"
              className="login-toggle"
              onClick={clearFacebookCallbackError}
            >
              {t('Continuar')}
            </button>
          </div>
        )}
        {mode === 'register' && (
          <>
            <input
              className="input"
              placeholder={t('Nombre')}
              aria-label={t('Nombre')}
              aria-invalid={!!error}
              aria-describedby={error ? 'login-error' : undefined}
              autoComplete="given-name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              disabled={busy || socialBusy}
              required
            />
            <input
              className="input"
              placeholder={t('Apellido')}
              aria-label={t('Apellido')}
              aria-invalid={!!error}
              aria-describedby={error ? 'login-error' : undefined}
              autoComplete="family-name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              disabled={busy || socialBusy}
              required
            />
          </>
        )}
        {mode === 'register' && legal.status === 'loading' && (
          <div className="legal-notice-state" role="status">{t('Cargando…')}</div>
        )}
        {mode === 'register' && legal.status === 'error' && (
          <div className="form-error" role="alert">
            <div>{t('No pudimos conectar. Prueba de nuevo.')}</div>
            <button
              type="button"
              className="login-toggle"
              onClick={() => setLegalAttempt((value) => value + 1)}
            >
              {t('Reintentar')}
            </button>
          </div>
        )}
        {mode === 'register' && legal.status === 'ready' && (
          <section className="legal-notice" aria-label="Aviso de privacidad">
            {idioma === 'en' && (
              <p className="legal-notice-language" lang="en">
                This document is only available in Spanish for now.
              </p>
            )}
            <pre lang="es">{legal.value.body}</pre>
            <div className="legal-notice-meta" lang="es">
              Versión {legal.value.version} · {legal.value.effective_from.slice(0, 10)}
            </div>
          </section>
        )}
        {(googleEligible || facebookEligible) && (
          <section className="social-auth-options" aria-busy={socialBusy}>
            {googleEligible && (
              <div className="social-provider-slot">
                <div
                  ref={googleContainer}
                  className="social-google-container"
                  role="group"
                  aria-label={t('Continuar con Google')}
                />
                {googleLoadFailed && (
                  <button
                    type="button"
                    className="login-toggle social-provider-retry"
                    onClick={() => {
                      setGoogleLoadFailed(false);
                      setGoogleGeneration((value) => value + 1);
                    }}
                  >
                    {t('Reintentar')}
                  </button>
                )}
              </div>
            )}
            {facebookEligible && (
              <button
                type="button"
                className="social-provider-button social-provider-facebook"
                onClick={() => { void onFacebook(); }}
                disabled={socialBusy}
              >
                {socialBusy ? t('Un segundo…') : t('Continuar con Facebook')}
              </button>
            )}
            <div className="social-auth-divider" aria-hidden="true">
              <span>{t('O usa tu correo y contraseña')}</span>
            </div>
          </section>
        )}
        <input
          className="input"
          type="email"
          placeholder={t('Email')}
          aria-label={t('Email')}
          aria-invalid={!!error}
          aria-describedby={error ? 'login-error' : undefined}
          autoComplete="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setRecoveryAccepted(false);
          }}
          disabled={busy || socialBusy || recoveryBusy}
          required
        />
        <input
          className="input"
          type="password"
          placeholder={t('Contraseña')}
          aria-label={t('Contraseña')}
          aria-invalid={!!error}
          aria-describedby={error ? 'login-error' : undefined}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy || socialBusy || recoveryBusy}
          required
        />
        {mode === 'login' && social.recovery.enabled && (
          <div className="recovery-request">
            <button
              type="button"
              className="login-toggle recovery-request-button"
              onClick={() => { void onRecoveryRequest(); }}
              disabled={busy || socialBusy || recoveryBusy || email.trim().length === 0}
            >
              {recoveryBusy ? t('Un segundo…') : t('¿Olvidaste tu contraseña?')}
            </button>
            {recoveryAccepted && (
              <div className="recovery-request-success" role="status">
                {t('Si existe una cuenta con ese correo, te enviaremos instrucciones.')}
              </div>
            )}
          </div>
        )}
        <button
          className="btn btn-primary"
          type="submit"
          disabled={busy || socialBusy || recoveryBusy
            || (mode === 'register' && legal.status !== 'ready')}
        >
          {busy ? t('Un segundo…') : mode === 'login' ? t('Entrar') : t('Registrarme')}
        </button>
        {(mode === 'register' || signup.status === 'available') && (
        <div style={{ textAlign: 'center', marginTop: 6 }}>
          <button
            type="button"
            className="login-toggle"
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setError(null);
              setRecoveryAccepted(false);
              clearFacebookCallbackError();
            }}
          >
            {mode === 'login' ? t('¿No tienes cuenta? Regístrate') : t('Ya tengo cuenta → entrar')}
          </button>
        </div>
        )}
      </form>

      {IS_MOCK && <div className="mock-hint">{t('Modo demo: entra con cualquier email y contraseña.')}</div>}
    </div>
  );
}
