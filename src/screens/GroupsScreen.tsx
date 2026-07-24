import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Friend, Group, GroupDetailResponse } from '../api/types';
import { Avatar, TopBar, useToast } from '../components/ui';
import { Icon } from '../components/Icon';

/** s-groups: grupos + detalle + crear + sumar miembros (routes/groups.js). */
export function GroupsScreen() {
  const toast = useToast();
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [detail, setDetail] = useState<GroupDetailResponse | null>(null);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  function load() {
    api.getGroups().then((r) => setGroups(r.groups)).catch(() => setGroups([]));
  }
  useEffect(() => {
    load();
    api.getFriends().then((r) => setFriends(r.friends)).catch(() => undefined);
  }, []);

  async function createGroup() {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      await api.createGroup(newName.trim());
      toast('Grupo creado ✓');
      setNewName('');
      setCreating(false);
      load();
    } catch {
      toast('No pudimos crear el grupo');
    } finally {
      setBusy(false);
    }
  }

  async function openGroup(g: Group) {
    try {
      setDetail(await api.getGroup(g.id));
    } catch {
      toast('No pudimos abrir el grupo');
    }
  }

  async function addMember(friendId: string) {
    if (!detail) return;
    try {
      await api.addGroupMember(detail.group.id, friendId);
      setDetail(await api.getGroup(detail.group.id));
      load();
    } catch {
      toast('No se pudo agregar');
    }
  }

  // Detalle de grupo
  if (detail) {
    const memberIds = new Set(detail.members.map((m) => m.id));
    const addable = friends.filter((f) => !memberIds.has(f.id));
    return (
      <div className="screen has-nav">
        <TopBar title={`${detail.group.icon} ${detail.group.name}`} onBack={() => setDetail(null)} />
        <div className="scroll" style={{ padding: '14px 16px' }}>
          <div className="sectlabel">Miembros ({detail.members.length})</div>
          <div className="card" style={{ marginBottom: 16 }}>
            {detail.members.length === 0 && <div className="empty" style={{ padding: 18 }}>Sin miembros todavía.</div>}
            {detail.members.map((m) => (
              <div key={m.id} className="friend-row" style={{ cursor: 'default' }}>
                <Avatar name={`${m.first_name} ${m.last_name}`} />
                <div className="fr-name">
                  <div className="n">
                    {m.first_name} {m.last_name}
                  </div>
                  <div className="id">{m.payme_id}</div>
                </div>
                <button
                  className="back-btn"
                  style={{ width: 30, height: 30, fontSize: 'var(--fs-sm)' }}
                  aria-label={`Quitar a ${m.first_name} del grupo`}
                  onClick={async () => {
                    try {
                      await api.removeGroupMember(detail.group.id, m.id);
                      setDetail(await api.getGroup(detail.group.id));
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
          {addable.length > 0 && (
            <>
              <div className="sectlabel">Agregar del listado de amigos</div>
              <div className="card" style={{ marginBottom: 16 }}>
                {addable.map((f) => (
                  <button key={f.id} className="friend-row" onClick={() => addMember(f.id)}>
                    <Avatar name={f.full_name} />
                    <div className="fr-name">
                      <div className="n">{f.full_name}</div>
                      <div className="id">{f.payme_id}</div>
                    </div>
                    <span className="badge badge-teal">+ sumar</span>
                  </button>
                ))}
              </div>
            </>
          )}
          <button
            className="btn btn-ghost"
            onClick={async () => {
              if (!window.confirm(`¿Eliminar el grupo "${detail.group.name}"?`)) return;
              try {
                await api.deleteGroup(detail.group.id);
                toast('Grupo eliminado');
                setDetail(null);
                load();
              } catch {
                toast('No se pudo eliminar');
              }
            }}
          >
            <Icon name="trash" size={16} className="ico-inline" /> Eliminar grupo
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="screen has-nav">
      <TopBar title="Grupos" />
      <div className="scroll" style={{ padding: '14px 16px' }}>
        {creating && (
          <div className="card card-p" style={{ marginBottom: 12 }}>
            <div className="sectlabel">Nuevo grupo</div>
            <input className="input" placeholder="Nombre (Familia, Trabajo…)" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={100} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-ghost" style={{ padding: 12, fontSize: 'var(--fs-sm)' }} onClick={() => setCreating(false)}>
                Cancelar
              </button>
              <button className="btn btn-primary" style={{ padding: 12, fontSize: 'var(--fs-sm)' }} onClick={createGroup} disabled={busy || !newName.trim()}>
                {busy ? 'Creando…' : 'Crear'}
              </button>
            </div>
          </div>
        )}
        {groups === null && <div className="loading">Cargando grupos…</div>}
        {groups?.length === 0 && (
          <div className="empty">
            <div className="emoji"><Icon name="users-group" size={40} /></div>
            Creá un grupo para dividir siempre con la misma gente.
          </div>
        )}
        {groups && groups.length > 0 && (
          <div className="card" style={{ marginBottom: 12 }}>
            {groups.map((g) => (
              <button key={g.id} className="list-row" onClick={() => openGroup(g)}>
                <div style={{ width: 42, height: 42, borderRadius: 12, background: 'var(--orange-l)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--fs-xl)' }}>
                  {g.icon}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 'var(--fs-base)', fontWeight: 600 }}>{g.name}</div>
                  <div className="caption">
                    {g.member_count} {g.member_count === 1 ? 'miembro' : 'miembros'}
                  </div>
                </div>
                <span style={{ color: 'var(--gray-b)' }}>→</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="action-bar">
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          + Crear grupo
        </button>
      </div>
    </div>
  );
}
