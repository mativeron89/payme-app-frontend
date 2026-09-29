import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import {
  AvatarObjectUrlLease,
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
import { ArrobaEnConfiguracion, useArrobaDeConfiguracion } from './ArrobaEnConfiguracion';
import { EditarPerfil, type ResultadoParte } from './EditarPerfil';
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
  /** AF-LAPIZ-UNICO · decisión 110 · «Editar perfil» abierto (el único lápiz). */
  const [editando, setEditando] = useState(false);
  const arroba = useArrobaDeConfiguracion(session);
  /**
   * M03 · hasta 0.192.0 acá vivía el campo «Fecha de nacimiento», una sola vez.
   * LEGAL-3.0.0 (AF2, decisión 39) lo retiró: la mayoría de edad se declara al
   * aceptar el paquete legal y el dueño deja de leer la fecha. La edad nunca se
   * calculó acá y sigue sin calcularse.
   */
  const avatarLease = useRef<AvatarObjectUrlLease | null>(null);
  const avatarEpoch = useRef(new RequestEpoch());
  const profileEpoch = useRef(new RequestEpoch());
  const mutationEpoch = useRef(new RequestEpoch());
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
    if (!enabled) return;
    // Tokens no forman parte de la identidad del recurso: esta closure queda
    // viva durante un refresh y la adopción usa la sesión corriente vía CAS.
    const expected = session;
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
    const expected = session;
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

  /**
   * AF-LAPIZ-UNICO · decisión 110 · los tres guardados de «Editar perfil» que son
   * de esta pantalla (nombre, subir foto, borrar foto). Hacen lo mismo que antes
   * —las épocas, la adopción por CAS y la relectura ante un 409—, pero ya no
   * avisan con un toast: devuelven el resultado de su parte, y el error queda en
   * ESE campo del formulario. Nunca lanzan.
   */
  const guardarNombre = useCallback(async (nombre: string, apellido: string): Promise<ResultadoParte> => {
    let first: string;
    let last: string;
    try {
      first = profileNameInput(nombre);
      last = profileNameInput(apellido);
    } catch {
      return { ok: false, error: t('Revisa el nombre y el apellido.') };
    }
    const expected = session;
    const epoch = mutationEpoch.current.next();
    profileEpoch.current.next();
    try {
      const response = await api.updateProfileIdentity({ first_name: first, last_name: last }, expected);
      if (!mutationEpoch.current.isCurrent(epoch) || !adoptProfileMutationUser(
        expected,
        (current) => mergeProfileIdentityIntoCurrentUser(current, response.user),
        { loadCurrent: loadSession, isCurrent: isCurrentSession, adoptUser },
      )) return { ok: false, error: t('No pudimos actualizar tu nombre.') };
      return { ok: true };
    } catch {
      return { ok: false, error: t('No pudimos actualizar tu nombre.') };
    }
  }, [adoptUser, session, t]);

  const subirFoto = useCallback(async (image: File): Promise<ResultadoParte> => {
    if (!user) return { ok: false, error: t('No pudimos actualizar tu foto.') };
    try {
      validateAvatarInput(image);
    } catch {
      return { ok: false, error: t('Usa una imagen JPG, PNG o WebP de hasta 5 MB.') };
    }
    const expected = session;
    const expectedRevision = user.avatar?.revision ?? null;
    const epoch = mutationEpoch.current.next();
    profileEpoch.current.next();
    avatarEpoch.current.next();
    try {
      const response = await api.putProfileAvatar(image, expectedRevision, expected);
      if (!mutationEpoch.current.isCurrent(epoch) || !adoptProfileMutationUser(
        expected,
        (current) => current.user ? { ...current.user, avatar: response.avatar } : null,
        { loadCurrent: loadSession, isCurrent: isCurrentSession, adoptUser },
      )) return { ok: false, error: t('No pudimos actualizar tu foto.') };
      return { ok: true };
    } catch (error) {
      if (extractApiError(error).status === 409) {
        await refreshProfileAfterMutation(expected, epoch).catch(() => false);
        return { ok: false, error: t('Tu foto cambió en otra sesión. Reintenta.') };
      }
      return { ok: false, error: t('No pudimos actualizar tu foto.') };
    }
  }, [adoptUser, refreshProfileAfterMutation, session, t, user]);

  const quitarFoto = useCallback(async (): Promise<ResultadoParte> => {
    const revision = user?.avatar?.revision;
    // Sin foto no hay nada que borrar: la parte está hecha.
    if (!revision) return { ok: true };
    const expected = session;
    const epoch = mutationEpoch.current.next();
    profileEpoch.current.next();
    avatarEpoch.current.next();
    try {
      await api.deleteProfileAvatar(revision, expected);
      if (!mutationEpoch.current.isCurrent(epoch) || !adoptProfileMutationUser(
        expected,
        (current) => current.user ? { ...current.user, avatar: null } : null,
        { loadCurrent: loadSession, isCurrent: isCurrentSession, adoptUser },
      )) return { ok: false, error: t('No pudimos eliminar tu foto.') };
      avatarLease.current?.clear();
      setAvatarUrl(null);
      return { ok: true };
    } catch (error) {
      if (extractApiError(error).status === 409) {
        await refreshProfileAfterMutation(expected, epoch).catch(() => false);
        return { ok: false, error: t('Tu foto cambió en otra sesión. Reintenta.') };
      }
      return { ok: false, error: t('No pudimos eliminar tu foto.') };
    }
  }, [adoptUser, refreshProfileAfterMutation, session, t, user]);

  const handleAvatarError = useCallback(() => {
    avatarLease.current?.clear();
    setAvatarUrl(null);
  }, []);

  // El único lápiz edita lo que se pueda: nombre y foto con la capability del
  // dueño, y el @ si hay uno (en espera también: el formulario dice desde cuándo).
  const editaNombreYFoto = enabled && !!user;
  const editaArroba = arroba.editable !== null || arroba.notaDeEspera !== null;

  if (editando && (editaNombreYFoto || editaArroba)) {
    return (
      <div className="config-profile">
        <EditarPerfil
          actual={{
            nombre: user?.first_name ?? '',
            apellido: user?.last_name ?? '',
            arroba: arroba.editable,
          }}
          editaNombreYFoto={editaNombreYFoto}
          arrobaEnEspera={arroba.notaDeEspera !== null ? arroba.arroba : null}
          notaDeEspera={arroba.notaDeEspera}
          fotoUrl={avatarUrl}
          tieneFoto={!!user?.avatar}
          nombreParaAvatar={fullName}
          guardadores={{ nombre: guardarNombre, arroba: arroba.guardar, subirFoto, quitarFoto }}
          onGuardado={() => { setEditando(false); toast(t('Perfil actualizado ✓')); }}
          onCerrar={() => setEditando(false)}
        />
      </div>
    );
  }

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
      </div>

      <div className="profile-name-line">
        <div className="h2">{user ? fullName : t('Tu cuenta')}</div>
        {(editaNombreYFoto || editaArroba) && (
          <button type="button" className="profile-name-edit" onClick={() => setEditando(true)} aria-label={t('Editar perfil')}>
            <Icon name="pencil" size={15} />
          </button>
        )}
      </div>

      {/* AF-USERNAME-D104 · decisión 104: debajo del nombre, el @ propio en lugar
          del `payme_id`. AF-LAPIZ-UNICO · decisión 110: sin lápiz propio; se
          cambia en «Editar perfil». Apagado, sin elegir o todavía sin leer, no
          se muestra nada. */}
      {user && <ArrobaEnConfiguracion arroba={arroba.arroba} />}
      {/* M03 · LEGAL-3.0.0 (AF2): el campo de fecha de nacimiento se retiró.
          La mayoría de edad se declara al aceptar el paquete legal (decisión 39);
          el dueño deja de leer la fecha y la borra en AB2. */}
    </div>
  );
}
