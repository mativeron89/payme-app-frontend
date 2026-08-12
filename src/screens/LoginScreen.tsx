import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { useIdioma } from '../i18n/idioma';
import { IS_MOCK } from '../api';
import { api } from '../api';
import { extractApiError } from '../api/errors';
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
  const { login, register } = useAuth();
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
  const [error, setError] = useState<string | null>(null);
  const [legal, setLegal] = useState<LegalState>({ status: 'idle' });
  const [legalAttempt, setLegalAttempt] = useState(0);
  const previousSignup = useRef(signup);

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
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        {mode === 'register' && (
          <>
            <input
              className="input"
              placeholder={t('Nombre')}
              autoComplete="given-name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
            />
            <input
              className="input"
              placeholder={t('Apellido')}
              autoComplete="family-name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              required
            />
          </>
        )}
        <input
          className="input"
          type="email"
          placeholder={t('Email')}
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          className="input"
          type="password"
          placeholder={t('Contraseña')}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
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
        <button
          className="btn btn-primary"
          type="submit"
          disabled={busy || (mode === 'register' && legal.status !== 'ready')}
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
