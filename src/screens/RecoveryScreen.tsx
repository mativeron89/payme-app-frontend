import { useState, useSyncExternalStore, type FormEvent } from 'react';
import { api } from '../api';
import {
  completeRecoveryOnce,
  recoveryTokenSnapshot,
  subscribeRecoveryToken,
  type RecoveryTokenCapture,
} from '../api/recoveryFlow';
import { useIdioma } from '../i18n/idioma';
import { navigate } from '../router';

export type RecoveryScreenState = 'invalid' | 'form' | 'processing' | 'completed';

export function recoveryScreenState(capture: RecoveryTokenCapture): RecoveryScreenState {
  if (capture.status === 'ready') return 'form';
  if (capture.status === 'retryable') return 'form';
  if (capture.status === 'processing') return 'processing';
  if (capture.status === 'consumed') return 'completed';
  return 'invalid';
}

export type RecoveryPasswordValidation = 'valid' | 'length' | 'bytes' | 'mismatch';

/** Réplica de la frontera del owner; la autoridad final vuelve a validar en Backend. */
export function validateRecoveryPassword(
  password: string,
  confirmation: string,
): RecoveryPasswordValidation {
  if (password.length < 8 || password.length > 128) return 'length';
  if (new TextEncoder().encode(password).byteLength > 72) return 'bytes';
  if (password !== confirmation) return 'mismatch';
  return 'valid';
}

export function RecoveryScreen() {
  const { t } = useIdioma();
  const capture = useSyncExternalStore(
    subscribeRecoveryToken,
    recoveryTokenSnapshot,
    recoveryTokenSnapshot,
  );
  const state = recoveryScreenState(capture);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const validation = validateRecoveryPassword(password, confirmation);
    if (validation !== 'valid') {
      setError(validation === 'mismatch'
        ? t('Las contraseñas no coinciden.')
        : t('Usa entre 8 y 128 caracteres y un máximo de 72 bytes.'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await completeRecoveryOnce(password, api.completeRecovery);
      setPassword('');
      setConfirmation('');
    } catch {
      // El backend es deliberadamente opaco: la UI no distingue cuenta,
      // estado ni motivo del token.
      setError(t('No pudimos conectar. Prueba de nuevo.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-screen recovery-screen">
      <section className="login-card recovery-card" aria-labelledby="recovery-title">
        <h1 id="recovery-title" className="h2">{t('Crear una contraseña nueva')}</h1>

        {state === 'invalid' && (
          <>
            <div className="form-error" role="alert">
              {t('Este link ya no funciona')}
            </div>
            <button type="button" className="btn btn-primary" onClick={() => navigate('home')}>
              {t('Entrar')}
            </button>
          </>
        )}

        {state === 'completed' && (
          <>
            <div className="recovery-success" role="status">{t('Listo')}</div>
            <button type="button" className="btn btn-primary" onClick={() => navigate('home')}>
              {t('Entrar')}
            </button>
          </>
        )}

        {state === 'processing' && (
          <div className="legal-notice-state" role="status">{t('Un segundo…')}</div>
        )}

        {state === 'form' && (
          <form onSubmit={onSubmit}>
            {(error || capture.status === 'retryable') && (
              <div className="form-error" role="alert">
                {error ?? t('No pudimos conectar. Prueba de nuevo.')}
              </div>
            )}
            <label className="recovery-field">
              <span>{t('Contraseña')}</span>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={128}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={busy}
                required
              />
            </label>
            <label className="recovery-field">
              <span>{t('Confirmar contraseña')}</span>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={128}
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                disabled={busy}
                required
              />
            </label>
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? t('Un segundo…') : t('Continuar')}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
