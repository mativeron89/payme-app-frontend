import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { AvatarObjectUrlLease } from '../api/profileIdentity';
import { isCurrentSession } from '../api/storage';
import { useAuth } from '../auth/AuthContext';
import { Avatar } from './ui';

/**
 * Foto privada de una amistad ya aceptada. La ruta nunca llega a `src`: sólo
 * vive un `blob:` efímero y cualquier 404/error conserva las iniciales.
 */
export function FriendAvatar({
  friendId,
  name,
  refreshToken,
}: {
  friendId: string;
  name: string;
  refreshToken: number;
}) {
  const { session } = useAuth();
  const lease = useRef<AvatarObjectUrlLease | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  if (!lease.current) lease.current = new AvatarObjectUrlLease();

  useEffect(() => {
    const currentLease = lease.current!;
    currentLease.clear();
    setUrl(null);
    if (!session || !isCurrentSession(session)) return undefined;
    const expected = session;
    let alive = true;
    void api.getFriendAvatar(friendId, expected)
      .then(({ blob }) => {
        if (!alive || !isCurrentSession(expected)) return;
        setUrl(currentLease.replace(blob));
      })
      .catch(() => { /* fallback uniforme; no revela por qué no hay foto */ });
    return () => {
      alive = false;
      currentLease.clear();
    };
  }, [friendId, refreshToken, session]);

  useEffect(() => () => lease.current?.dispose(), []);

  return url ? (
    <img className="friend-avatar-image" src={url} alt="" aria-hidden="true" />
  ) : <Avatar name={name} />;
}
