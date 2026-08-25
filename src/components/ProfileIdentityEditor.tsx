import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { api } from '../api';
import {
  AvatarObjectUrlLease,
  PROFILE_AVATAR_INPUT_MIMES,
  adoptProfileMutationUser,
  currentSamePrincipalSession,
  mergeProfileIdentityIntoCurrentUser,
  profileNameInput,
  validateAvatarInput,
} from '../api/profileIdentity';
import { isCurrentSession, loadSession, type StoredSession } from '../api/storage';
import type { User } from '../api/types';
import { extractApiError } from '../api/errors';
import { useIdioma } from '../i18n/idioma';
import { RequestEpoch } from '../utils/requestEpoch';
import { Icon } from './Icon';
import { Avatar, useToast } from './ui';

interface ProfileIdentityEditorProps {
  session: StoredSession;
  enabled: boolean;
  adoptUser(expectedSession: StoredSession, user: User): boolean;
}

export function ProfileIdentityEditor({
  session,
  enabled,
  adoptUser,
}: ProfileIdentityEditorProps) {
  const { t } = useIdioma();
  const toast = useToast();
  const user = session.user;
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [firstName, setFirstName] = useState(user?.first_name ?? '');
  const [lastName, setLastName] = useState(user?.last_name ?? '');
  const [busy, setBusy] = useState<'name' | 'avatar' | 'delete' | null>(null);
  const avatarLease = useRef<AvatarObjectUrlLease | null>(null);
  const avatarEpoch = useRef(new RequestEpoch());
  const profileEpoch = useRef(new RequestEpoch());
  const mutationEpoch = useRef(new RequestEpoch());
  const fileInput = useRef<HTMLInputElement | null>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  if (!avatarLease.current) avatarLease.current = new AvatarObjectUrlLease();

  const familyId = session.family_id;
  const principalId = session.principal_id;
  const avatarRevision = user?.avatar?.revision ?? null;
  const fullName = user ? `${user.first_name} ${user.last_name}` : t('PayMe');

  const refreshProfileAfterMutation = useCallback(async (
    origin: StoredSession,
    mutation: number,
  ): Promise<boolean> => {
    const current = currentSamePrincipalSession(origin, loadSession());
    if (!current || !mutationEpoch.current.isCurrent(mutation) || !isCurrentSession(current)) return false;
    const response = await api.getProfileIdentity(current);
    if (!mutationEpoch.current.isCurrent(mutation)) return false;
    return adoptProfileMutationUser(
      origin,
      (latest) => mergeProfileIdentityIntoCurrentUser(latest, response.user),
      { loadCurrent: loadSession, isCurrent: isCurrentSession, adoptUser },
    );
  }, [adoptUser]);

  useEffect(() => {
    if (editingName) return;
    setFirstName(user?.first_name ?? '');
    setLastName(user?.last_name ?? '');
  }, [editingName, user?.first_name, user?.last_name]);

  useEffect(() => {
    if (!enabled) return;
    const expected = sessionRef.current;
    const epoch = profileEpoch.current.next();
    api.getProfileIdentity(expected).then(({ user: fresh }) => {
      if (!profileEpoch.current.isCurrent(epoch)) return;
      adoptProfileMutationUser(
        expected,
        (current) => mergeProfileIdentityIntoCurrentUser(current, fresh),
        { loadCurrent: loadSession, isCurrent: isCurrentSession, adoptUser },
      );
    }).catch(() => undefined);
    return () => { profileEpoch.current.next(); };
  }, [enabled, familyId, principalId, adoptUser]);

  useEffect(() => {
    const lease = avatarLease.current;
    if (!lease) return;
    const epoch = avatarEpoch.current.next();
    lease.clear();
    setAvatarUrl(null);
    if (!enabled || !avatarRevision) return;
    const expected = sessionRef.current;
    api.getProfileAvatar(expected).then(({ blob }) => {
      const current = currentSamePrincipalSession(expected, loadSession());
      if (!avatarEpoch.current.isCurrent(epoch) || !current || !isCurrentSession(current)) return;
      setAvatarUrl(lease.replace(blob));
    }).catch(() => undefined);
    return () => { avatarEpoch.current.next(); };
  }, [enabled, avatarRevision, familyId, principalId]);

  useEffect(() => () => {
    profileEpoch.current.next();
    avatarEpoch.current.next();
    mutationEpoch.current.next();
    avatarLease.current?.dispose();
  }, []);

  const saveName = useCallback(async () => {
    if (!user || busy) return;
    let first: string;
    let last: string;
    try {
      first = profileNameInput(firstName);
      last = profileNameInput(lastName);
    } catch {
      toast(t('Revisa el nombre y el apellido.'));
      return;
    }
    const expected = session;
    const epoch = mutationEpoch.current.next();
    profileEpoch.current.next();
    setBusy('name');
    try {
      const response = await api.updateProfileIdentity({ first_name: first, last_name: last }, expected);
      if (!mutationEpoch.current.isCurrent(epoch) || !adoptProfileMutationUser(
        expected,
        (current) => mergeProfileIdentityIntoCurrentUser(current, response.user),
        { loadCurrent: loadSession, isCurrent: isCurrentSession, adoptUser },
      )) return;
      setEditingName(false);
      // Lo que se presenta sale de la respuesta normalizada del servidor.
      setFirstName(response.user.first_name);
      setLastName(response.user.last_name);
      toast(t('Nombre actualizado ✓'));
    } catch {
      const current = currentSamePrincipalSession(expected, loadSession());
      if (mutationEpoch.current.isCurrent(epoch) && current && isCurrentSession(current)) {
        toast(t('No pudimos actualizar tu nombre.'));
      }
    } finally {
      if (mutationEpoch.current.isCurrent(epoch)) setBusy(null);
    }
  }, [adoptUser, busy, firstName, lastName, session, t, toast, user]);

  const uploadAvatar = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const image = event.target.files?.[0];
    event.target.value = '';
    if (!image || !user || busy) return;
    try {
      validateAvatarInput(image);
    } catch {
      toast(t('Usa una imagen JPG, PNG o WebP de hasta 5 MB.'));
      return;
    }
    const expected = session;
    const expectedRevision = user.avatar?.revision ?? null;
    const epoch = mutationEpoch.current.next();
    profileEpoch.current.next();
    avatarEpoch.current.next();
    setBusy('avatar');
    try {
      const response = await api.putProfileAvatar(image, expectedRevision, expected);
      if (!mutationEpoch.current.isCurrent(epoch) || !adoptProfileMutationUser(
        expected,
        (current) => current.user ? { ...current.user, avatar: response.avatar } : null,
        { loadCurrent: loadSession, isCurrent: isCurrentSession, adoptUser },
      )) return;
      toast(t('Foto actualizada ✓'));
    } catch (error) {
      const current = currentSamePrincipalSession(expected, loadSession());
      if (mutationEpoch.current.isCurrent(epoch) && current && isCurrentSession(current)) {
        if (extractApiError(error).status === 409) {
          await refreshProfileAfterMutation(expected, epoch).catch(() => false);
          toast(t('Tu foto cambió en otra sesión. Reintenta.'));
        } else {
          toast(t('No pudimos actualizar tu foto.'));
        }
      }
    } finally {
      if (mutationEpoch.current.isCurrent(epoch)) setBusy(null);
    }
  }, [adoptUser, busy, refreshProfileAfterMutation, session, t, toast, user]);

  const deleteAvatar = useCallback(async () => {
    const revision = user?.avatar?.revision;
    if (!revision || busy) return;
    const expected = session;
    const epoch = mutationEpoch.current.next();
    profileEpoch.current.next();
    avatarEpoch.current.next();
    setBusy('delete');
    try {
      await api.deleteProfileAvatar(revision, expected);
      if (!mutationEpoch.current.isCurrent(epoch) || !adoptProfileMutationUser(
        expected,
        (current) => current.user ? { ...current.user, avatar: null } : null,
        { loadCurrent: loadSession, isCurrent: isCurrentSession, adoptUser },
      )) return;
      avatarLease.current?.clear();
      setAvatarUrl(null);
      toast(t('Foto eliminada ✓'));
    } catch (error) {
      const current = currentSamePrincipalSession(expected, loadSession());
      if (mutationEpoch.current.isCurrent(epoch) && current && isCurrentSession(current)) {
        if (extractApiError(error).status === 409) {
          await refreshProfileAfterMutation(expected, epoch).catch(() => false);
          toast(t('Tu foto cambió en otra sesión. Reintenta.'));
        } else {
          toast(t('No pudimos eliminar tu foto.'));
        }
      }
    } finally {
      if (mutationEpoch.current.isCurrent(epoch)) setBusy(null);
    }
  }, [adoptUser, busy, refreshProfileAfterMutation, session, t, toast, user]);

  const handleAvatarError = useCallback(() => {
    avatarLease.current?.clear();
    setAvatarUrl(null);
  }, []);

  return (
    <div className="config-profile">
      <div className="profile-avatar-wrap">
        {avatarUrl ? (
          <img
            className="profile-avatar-image"
            src={avatarUrl}
            alt={t('Foto de perfil')}
            onError={handleAvatarError}
          />
        ) : (
          <Avatar name={fullName} size={84} variant="marca" />
        )}
        {enabled && user && (
          <>
            <button
              type="button"
              className="profile-avatar-edit"
              onClick={() => fileInput.current?.click()}
              disabled={busy !== null}
              aria-label={t('Cambiar foto de perfil')}
            >
              <Icon name="camera" size={15} />
            </button>
            <input
              ref={fileInput}
              className="profile-file-input"
              type="file"
              accept={PROFILE_AVATAR_INPUT_MIMES.join(',')}
              onChange={uploadAvatar}
              tabIndex={-1}
            />
          </>
        )}
      </div>

      {editingName && enabled && user ? (
        <div className="profile-name-editor">
          <label>
            <span>{t('Nombre')}</span>
            <input value={firstName} onChange={(event) => setFirstName(event.target.value)} maxLength={200} />
          </label>
          <label>
            <span>{t('Apellido')}</span>
            <input value={lastName} onChange={(event) => setLastName(event.target.value)} maxLength={200} />
          </label>
          <div className="profile-name-actions">
            <button type="button" className="btn btn-ghost btn-fit" onClick={() => setEditingName(false)} disabled={busy !== null}>
              {t('Cancelar')}
            </button>
            <button type="button" className="btn btn-navy btn-fit" onClick={() => void saveName()} disabled={busy !== null}>
              {busy === 'name' ? t('Guardando…') : t('Guardar')}
            </button>
          </div>
        </div>
      ) : (
        <div className="profile-name-line">
          <div className="h2">{user ? fullName : t('Tu cuenta')}</div>
          {enabled && user && (
            <button type="button" className="profile-name-edit" onClick={() => setEditingName(true)} aria-label={t('Editar nombre')}>
              <Icon name="pencil" size={15} />
            </button>
          )}
        </div>
      )}

      {user && <div className="profile-payme-id">{user.payme_id}</div>}
      {enabled && user?.avatar && (
        <button type="button" className="profile-avatar-delete" onClick={() => void deleteAvatar()} disabled={busy !== null}>
          <Icon name="trash" size={14} /> {busy === 'delete' ? t('Eliminando…') : t('Eliminar foto')}
        </button>
      )}
    </div>
  );
}
