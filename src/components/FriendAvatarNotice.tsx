import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import {
  acknowledgementForDisplayedNotice,
  type FriendAvatarNoticeAcknowledgement,
} from '../api/friendAvatarNotice';
import { extractApiError } from '../api/errors';
import { isCurrentSession, type StoredSession } from '../api/storage';
import { useAuth } from '../auth/AuthContext';
import { useIdioma } from '../i18n/idioma';
import { RequestEpoch } from '../utils/requestEpoch';
import { Icon } from './Icon';

interface ReadyNotice {
  readonly acknowledgement: FriendAvatarNoticeAcknowledgement;
  readonly version: string;
}

let deferredFor: Pick<StoredSession, 'family_id' | 'principal_id'> | null = null;

function deferred(session: StoredSession): boolean {
  return deferredFor?.family_id === session.family_id
    && deferredFor.principal_id === session.principal_id;
}

/** Seam unitario; no toca storage porque «Ahora no» sólo vive en memoria. */
export function resetFriendAvatarNoticeDeferralForTests(): void {
  deferredFor = null;
}

export function FriendAvatarNoticeView({
  version,
  busy,
  error,
  onAcknowledge,
  onDefer,
}: {
  version: string;
  busy: boolean;
  error: boolean;
  onAcknowledge: () => void;
  onDefer: () => void;
}) {
  const { t } = useIdioma();
  return (
    <aside className="friend-avatar-notice" aria-label={t('Actualización del Aviso de Privacidad')}>
      <div className="friend-avatar-notice-icon" aria-hidden="true">
        <Icon name="users" size={21} />
      </div>
      <div className="friend-avatar-notice-content">
        <div className="friend-avatar-notice-title">{t('Tu foto entre amigos')}</div>
        <p>
          {t('Actualizamos el Aviso para explicar que tus amigos aceptados pueden ver tu foto de perfil. Las personas bloqueadas siguen usando el avatar genérico.')}
        </p>
        <a href="/privacy" target="_blank" rel="noopener noreferrer">
          {t('Ver Aviso de Privacidad')} · {version}
        </a>
        {error && (
          <div className="friend-avatar-notice-error" role="alert">
            {t('No pudimos guardar tu confirmación. Puedes intentar de nuevo o elegir Ahora no.')}
          </div>
        )}
        <div className="friend-avatar-notice-actions">
          <button type="button" className="btn btn-primary btn-fit" disabled={busy} onClick={onAcknowledge}>
            {busy ? t('Guardando…') : t('Entendido')}
          </button>
          <button type="button" className="btn btn-ghost btn-fit" disabled={busy} onClick={onDefer}>
            {t('Ahora no')}
          </button>
        </div>
      </div>
    </aside>
  );
}

/**
 * Presentación no bloqueante del cambio U05. Sólo el botón «Entendido» hace
 * POST; abrir el enlace, navegar, iniciar sesión o elegir «Ahora no» no acusan.
 */
export function FriendAvatarNotice() {
  const { session } = useAuth();
  const [ready, setReady] = useState<ReadyNotice | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const epoch = useRef(new RequestEpoch());

  const load = useCallback((expected: StoredSession) => {
    const request = epoch.current.next();
    setReady(null);
    setError(false);
    if (deferred(expected) || !isCurrentSession(expected)) return;
    void Promise.all([api.getFriendAvatarNotice(expected), api.getPrivacyNotice()])
      .then(([state, legal]) => {
        if (!epoch.current.isCurrent(request) || !isCurrentSession(expected)) return;
        if (state.acknowledged) return;
        const acknowledgement = acknowledgementForDisplayedNotice(state, legal);
        if (!acknowledgement) return;
        setReady({ acknowledgement, version: state.noticeVersion });
      })
      .catch(() => { /* backend anterior, texto inconsistente o red: no se acusa ni se habilita */ });
  }, []);

  useEffect(() => {
    if (!session) {
      epoch.current.next();
      setReady(null);
      return;
    }
    load(session);
    return () => { epoch.current.next(); };
  }, [session, reload, load]);

  if (!session || !ready) return null;

  const acknowledge = async () => {
    const expected = session;
    const shown = ready.acknowledgement;
    setBusy(true);
    setError(false);
    try {
      const result = await api.acknowledgeFriendAvatarNotice(shown, expected);
      if (!isCurrentSession(expected)) return;
      if (!result.acknowledged
          || result.noticeVersion !== shown.notice_version
          || result.noticeHash !== shown.notice_hash) throw new Error('friend_avatar_notice_not_acknowledged');
      setReady(null);
    } catch (cause) {
      if (!isCurrentSession(expected)) return;
      if (extractApiError(cause).status === 409) {
        // El texto cambió: volver a mostrar el NUEVO contenido. Nunca rePOSTear
        // silenciosamente lo que la persona no vio.
        setReload((value) => value + 1);
      } else {
        setError(true);
      }
    } finally {
      if (isCurrentSession(expected)) setBusy(false);
    }
  };

  return (
    <FriendAvatarNoticeView
      version={ready.version}
      busy={busy}
      error={error}
      onAcknowledge={() => void acknowledge()}
      onDefer={() => {
        deferredFor = { family_id: session.family_id, principal_id: session.principal_id };
        setReady(null);
      }}
    />
  );
}
