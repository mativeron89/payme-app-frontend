import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Friend } from '../api/types';
import { Avatar, TopBar, useToast } from '../components/ui';
import { Icon } from '../components/Icon';
import { navigate } from '../router';

/** s-friends: lista + búsqueda + alta por email/payme_id (routes/friends.js). */
export function FriendsScreen() {
  const toast = useToast();
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [filter, setFilter] = useState('');
  const [adding, setAdding] = useState(false);
  const [newQuery, setNewQuery] = useState('');
  const [busy, setBusy] = useState(false);

  function load() {
    api.getFriends().then((r) => setFriends(r.friends)).catch(() => setFriends([]));
  }
  useEffect(load, []);

  const visible =
    friends?.filter(
      (f) =>
        !filter ||
        f.full_name.toLowerCase().includes(filter.toLowerCase()) ||
        f.payme_id.toLowerCase().includes(filter.toLowerCase()) ||
        f.email.toLowerCase().includes(filter.toLowerCase()),
    ) ?? null;

  async function addFriend() {
    const q = newQuery.trim();
    if (!q) return;
    setBusy(true);
    try {
      const friend = await api.addFriend(q.includes('@') ? { email: q } : { payme_id: q });
      toast(`${friend.first_name} agregado ✓`);
      setNewQuery('');
      setAdding(false);
      load();
    } catch {
      toast('No encontramos a nadie con ese dato');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen has-nav">
      <TopBar
        title="Amigos"
        right={friends ? <span className="badge badge-gray">{friends.length}</span> : undefined}
      />
      <div className="scroll">
        <div style={{ padding: '14px 16px 8px' }}>
          <input
            className="input"
            style={{ margin: 0 }}
            placeholder="Buscar por nombre, email o ID"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        {adding && (
          <div style={{ padding: '4px 16px 0' }}>
            <div className="card card-p" style={{ marginBottom: 4 }}>
              <div className="sectlabel">Agregar amigo</div>
              <input
                className="input"
                placeholder="Email o ID PayMe (payme_mx_xxxx)"
                value={newQuery}
                onChange={(e) => setNewQuery(e.target.value)}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-ghost" style={{ padding: 12, fontSize: 'var(--fs-sm)' }} onClick={() => setAdding(false)}>
                  Cancelar
                </button>
                <button className="btn btn-primary" style={{ padding: 12, fontSize: 'var(--fs-sm)' }} onClick={addFriend} disabled={busy || !newQuery.trim()}>
                  {busy ? 'Buscando…' : 'Agregar'}
                </button>
              </div>
            </div>
          </div>
        )}
        {visible === null && <div className="loading">Cargando amigos…</div>}
        {visible?.length === 0 && (
          <div className="empty">
            <div className="emoji"><Icon name="users" size={40} /></div>
            {friends?.length === 0 ? 'Todavía no agregaste amigos.' : 'Sin resultados para esa búsqueda.'}
          </div>
        )}
        {visible && visible.length > 0 && (
          <div className="card" style={{ margin: '8px 12px' }}>
            {visible.map((f) => (
              <div key={f.id} className="friend-row" style={{ cursor: 'default' }}>
                <Avatar name={f.full_name} />
                <div className="fr-name">
                  <div className="n">{f.full_name}</div>
                  <div className="id">{f.payme_id}</div>
                </div>
                <button
                  className="btn"
                  style={{ width: 'auto', padding: '7px 12px', fontSize: 'var(--fs-sm)', background: 'var(--teal-l)', color: '#0a7b80' }}
                  onClick={() => navigate('transferir', f.payme_id)}
                  aria-label={`Transferir a ${f.full_name}`}
                >
                  <Icon name="arrow-up-right" size={16} />
                </button>
                <button
                  className="back-btn"
                  style={{ width: 30, height: 30, fontSize: 'var(--fs-sm)' }}
                  aria-label={`Quitar a ${f.first_name}`}
                  onClick={async () => {
                    if (!window.confirm(`¿Quitar a ${f.full_name} de tus amigos?`)) return;
                    try {
                      await api.removeFriend(f.id);
                      toast('Amigo quitado');
                      load();
                    } catch {
                      toast('No se pudo quitar');
                    }
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="action-bar">
        <button className="btn btn-primary" onClick={() => setAdding(true)}>
          + Agregar amigo
        </button>
      </div>
    </div>
  );
}
