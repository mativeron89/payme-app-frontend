import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type BlockedUser } from '../api';
import { isCurrentSession } from '../api/storage';
import { useAuth } from '../auth/AuthContext';
import { useIdioma } from '../i18n/idioma';
import { AppHeaderBack } from '../components/AppHeader';
import { AppBottomBar } from '../components/AppBottomBar';
import { useToast } from '../components/ui';
import { ArrobaDebajo } from '../components/ArrobaDebajo';
import { extractApiError } from '../api/errors';
import { fullName } from '../utils/identity';

/** D787: no caché ni almacenamiento; al cerrar se descarta toda la lista. */
export function Bloqueados({ onBack }: { onBack: () => void }) {
  const { t } = useIdioma();
  const { session } = useAuth();
  const toast = useToast();
  const title = useRef<HTMLHeadingElement>(null);
  const epoch = useRef(0);
  const alive = useRef(true);
  const [people, setPeople] = useState<BlockedUser[] | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    if (!session || !isCurrentSession(session)) return;
    const request = ++epoch.current;
    setError(false);
    setPeople(null);
    title.current?.focus();
    try {
      const response = await api.getBlockedUsers();
      if (alive.current && request === epoch.current && isCurrentSession(session)) setPeople(response.blocked);
    } catch {
      if (alive.current && request === epoch.current && isCurrentSession(session)) setError(true);
    }
  }, [session]);
  useEffect(() => {
    alive.current = true;
    title.current?.focus();
    void load();
    return () => { alive.current = false; epoch.current += 1; };
  }, [load]);

  async function unblock(person: BlockedUser) {
    if (busy || !session || !isCurrentSession(session)) return;
    if (!window.confirm(t('¿Desbloquear a {0}? No se va a sumar a tus amigos, pero va a poder mandarte solicitudes de nuevo.', person.full_name))) return;
    setBusy(true);
    try {
      await api.unblockUser(person.id);
      if (!alive.current || !isCurrentSession(session)) return;
      toast(t('Desbloqueaste a {0}', person.full_name));
      await load();
      title.current?.focus();
    } catch (error) {
      if (!alive.current || !isCurrentSession(session)) return;
      const failure = extractApiError(error);
      if (failure.status === 404 && failure.code === 'block_not_found') await load();
      else toast(t('No pudimos desbloquear a {0}', person.full_name));
    } finally {
      if (alive.current && isCurrentSession(session)) {
        setBusy(false);
        title.current?.focus();
      }
    }
  }

  return <div className="screen has-appbar">
    <AppHeaderBack userName={fullName(session) ?? undefined} onBack={onBack} />
    <div className="scroll" style={{ paddingTop: 16, paddingLeft: 16, paddingRight: 16 }}>
      <h1 ref={title} tabIndex={-1}>{t('Bloqueados')}</h1>
      {error ? <div role="alert" className="card" style={{ padding: 16 }}>
        <p>{t('No pudimos cargar tus bloqueados')}</p>
        <button className="btn btn-ghost" type="button" onClick={() => void load()}>{t('Reintentar')}</button>
      </div> : people === null ? <p role="status">{t('Cargando…')}</p>
        : people.length === 0 ? <p className="empty" role="status">{t('No bloqueaste a nadie')}</p>
          : <ul className="card" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {people.map(person => <li key={person.id} style={{ padding: 16, borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div className="fr-name" style={{ minWidth: 0, flex: 1, overflowWrap: 'anywhere' }}>
                <div>{person.full_name}</div>
                <ArrobaDebajo username={person.username} />
              </div>
              <button className="btn btn-ghost" type="button" style={{ width: 'auto', flexShrink: 0 }} disabled={busy}
                aria-label={t('Desbloquear a {0}', person.full_name)} onClick={() => void unblock(person)}>
                {t('Desbloquear')}
              </button>
            </li>)}
          </ul>}
    </div>
    <AppBottomBar active="mas" />
  </div>;
}
