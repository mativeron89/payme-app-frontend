import { useState, type FormEvent } from 'react';
import { IS_MOCK } from '../api';
import { HttpError } from '../api/http';
import { useAuth } from '../auth/AuthContext';

/**
 * Login / registro según el contrato (routes/auth.js):
 * login {email, password} · register {email, phone?, password, first_name,
 * last_name} con password 8–128 chars. En mock cualquier credencial entra.
 */

const ERROR_TEXT: Record<string, string> = {
  invalid_credentials: 'Email o contraseña incorrectos.',
  email_already_registered: 'Ese email ya está registrado.',
  user_suspended: 'Tu cuenta está suspendida. Escribinos.',
  too_many_auth_attempts: 'Demasiados intentos. Espera un minuto.',
  validation_error: 'Revisa los datos: email válido y contraseña de al menos 8 caracteres.',
};

function errorMessage(err: unknown): string {
  if (err instanceof HttpError) {
    return ERROR_TEXT[err.message] ?? 'No pudimos conectar. Prueba de nuevo.';
  }
  return 'No pudimos conectar. Prueba de nuevo.';
}

/**
 * `initialMode` existe para la entrada por link (SPEC_APP.md §1.2-A): esa
 * pantalla ofrece **dos** acciones —"Crear cuenta gratis" y "Ya tengo cuenta ·
 * Entrar"— y cada una tiene que abrir el formulario ya en su modo. Sin esto,
 * quien viene a registrarse aterriza en el login y tiene que buscar el toggle.
 * El alta en sí NO se rediseña acá: sigue siendo este formulario tal cual.
 */
export function LoginScreen({ initialMode = 'login' }: { initialMode?: 'login' | 'register' } = {}) {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') {
        await login(email, password);
      } else {
        await register({ email, password, first_name: firstName, last_name: lastName });
      }
    } catch (err) {
      setError(errorMessage(err));
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
          Divide y paga la cuenta desde la mesa
        </div>
      </div>

      <form className="login-card" onSubmit={onSubmit}>
        <div className="h2" style={{ marginBottom: 14 }}>
          {mode === 'login' ? 'Entra a tu cuenta' : 'Crea tu cuenta'}
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
              placeholder="Nombre"
              autoComplete="given-name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
            />
            <input
              className="input"
              placeholder="Apellido"
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
          placeholder="Email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          className="input"
          type="password"
          placeholder="Contraseña"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Un segundo…' : mode === 'login' ? 'Entrar' : 'Registrarme'}
        </button>
        <div style={{ textAlign: 'center', marginTop: 6 }}>
          <button
            type="button"
            className="login-toggle"
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setError(null);
            }}
          >
            {mode === 'login' ? '¿No tienes cuenta? Regístrate' : 'Ya tengo cuenta → entrar'}
          </button>
        </div>
      </form>

      {IS_MOCK && <div className="mock-hint">Modo demo: entra con cualquier email y contraseña.</div>}
    </div>
  );
}
