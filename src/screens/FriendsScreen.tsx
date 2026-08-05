import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Friend } from '../api/types';
import { Avatar, SocialTabs, TopBar, useToast } from '../components/ui';
import { Icon } from '../components/Icon';
import { navigate } from '../router';
import { useWalletRail } from '../api/walletRail';
import { fold, relTime } from '../utils/format';
import {
  incomingRowView, outgoingRowView, type IncomingRowView, type OutgoingRowView,
} from './friendRequestsView';

/** s-friends: lista + búsqueda + alta por email/payme_id (routes/friends.js). */
export function FriendsScreen() {
  // OLA 5D · el atajo "transferir" es riel saldo: lo habilita el BACKEND.
  const { walletRailEnabled } = useWalletRail();
  const toast = useToast();
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [filter, setFilter] = useState('');
  const [adding, setAdding] = useState(false);
  const [newQuery, setNewQuery] = useState('');
  const [busy, setBusy] = useState(false);
  /**
   * OLA 3C · las solicitudes pendientes. Sin esta pantalla el flujo quedaba
   * cortado a la mitad: `POST /friends` ya no crea amistad, así que alguien
   * mandaba una solicitud y nadie podía aceptarla desde la app.
   */
  const [incoming, setIncoming] = useState<IncomingRowView[]>([]);
  /**
   * ⚠️ `OutgoingRowView`, NO `FriendRequest`: la identidad del destinatario se
   * descarta acá, en el borde de red, y nunca entra al componente. Guardar el
   * `FriendRequest` crudo y "acordarse de no pintarlo" es lo que falló.
   */
  const [outgoing, setOutgoing] = useState<OutgoingRowView[]>([]);
  const [reqBusy, setReqBusy] = useState<string | null>(null);

  function loadRequests() {
    void api.getFriendRequests('incoming')
      .then((r) => setIncoming(r.requests.map(incomingRowView))).catch(() => setIncoming([]));
    void api.getFriendRequests('outgoing')
      .then((r) => setOutgoing(r.requests.map(outgoingRowView))).catch(() => setOutgoing([]));
  }

  /** El `id` que viaja es el de la SOLICITUD, nunca el de la persona. */
  async function resolveRequest(
    requestId: string,
    action: 'accept' | 'reject' | 'cancel',
    /** Sólo para las ENTRANTES: de una saliente no sabemos —ni mostramos— quién es. */
    quien?: string,
  ) {
    setReqBusy(requestId);
    try {
      if (action === 'accept') await api.acceptFriendRequest(requestId);
      else if (action === 'reject') await api.rejectFriendRequest(requestId);
      else await api.cancelFriendRequest(requestId);
      toast(
        action === 'accept' ? `Ahora son amigos con ${quien} ✓`
          : action === 'reject' ? 'Solicitud rechazada'
            : 'Solicitud cancelada',
      );
      load();
      loadRequests();
    } catch {
      // 404 = la solicitud ya no está (la resolvieron del otro lado o venció).
      toast('Esa solicitud ya no está disponible');
      loadRequests();
    } finally {
      setReqBusy(null);
    }
  }

  async function block(userId: string, quien: string) {
    if (!window.confirm(`¿Bloquear a ${quien}? Se rompe la amistad y no van a poder mandarse solicitudes.`)) return;
    try {
      await api.blockUser(userId);
      toast(`${quien} quedó bloqueado`);
      load();
      loadRequests();
    } catch {
      toast('No pudimos bloquear a esa persona');
    }
  }

  function load() {
    api.getFriends().then((r) => setFriends(r.friends)).catch(() => setFriends([]));
    loadRequests();
  }
  useEffect(load, []);

  // fold: "sofia" encuentra a "Sofía" (búsqueda insensible a acentos).
  const visible =
    friends?.filter(
      (f) =>
        !filter ||
        fold(f.full_name).includes(fold(filter)) ||
        // C4 (v2.29): `email` salió del contrato, del resultado y del criterio.
        // Buscar por substring de correo confirmaba su existencia carácter a
        // carácter. No se repone del lado del front.
        fold(f.payme_id).includes(fold(filter)),
    ) ?? null;

  async function addFriend() {
    const q = newQuery.trim();
    if (!q) return;
    setBusy(true);
    try {
      await api.addFriend(q.includes('@') ? { email: q } : { payme_id: q });
      // C1/C2: el backend responde 202 igual exista o no la persona. La app NO
      // puede decir "no encontramos a nadie": esa respuesta era un oráculo para
      // descubrir cuentas probando correos. El copy no afirma nada del otro.
      toast('Si tiene PayMe, le va a llegar tu solicitud');
      setNewQuery('');
      setAdding(false);
      // ⚠️ A propósito NO se recarga la lista acá. Recargar contestaba, medio
      // segundo después, la misma pregunta que el 202 ciego se acababa de negar
      // a contestar: aparecía una fila nueva si la cuenta existía y ninguna si
      // no. La solicitud se ve al volver a entrar. No cierra el oráculo —el
      // contador sigue delatando— pero la app deja de desmentir su propio copy.
    } catch {
      toast('No pudimos enviar la solicitud. Probá de nuevo.');
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
          <SocialTabs active="amigos" />
          <input
            className="input"
            style={{ margin: 0 }}
            placeholder="Buscar por nombre o ID PayMe"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>

        {/* OLA 3C · solicitudes. Van ARRIBA de la lista: una solicitud entrante
            es una acción pendiente, y enterrarla abajo dejaba el flujo cortado
            aunque el endpoint existiera. */}
        {incoming.length > 0 && (
          <div style={{ padding: '0 16px 8px' }}>
            <div className="sectlabel">
              Te quieren agregar ({incoming.length})
            </div>
            <div className="card">
              {incoming.map((r) => (
                <div key={r.requestId} className="friend-row with-actions" style={{ cursor: 'default' }}>
                  <Avatar name={r.fullName} />
                  <div className="fr-name">
                    <div className="n">{r.fullName}</div>
                    <div className="id">{r.paymeId}</div>
                  </div>
                  <div className="fr-actions">
                    <button
                      className="btn btn-teal btn-sm btn-fit"
                      disabled={reqBusy === r.requestId}
                      onClick={() => void resolveRequest(r.requestId, 'accept', r.firstName)}
                    >
                      Aceptar
                    </button>
                    <button
                      className="btn btn-ghost btn-sm btn-fit"
                      disabled={reqBusy === r.requestId}
                      onClick={() => void resolveRequest(r.requestId, 'reject', r.firstName)}
                    >
                      Rechazar
                    </button>
                    <button
                      className="btn btn-ghost btn-sm btn-fit"
                      aria-label={`Bloquear a ${r.fullName}`}
                      disabled={reqBusy === r.requestId}
                      onClick={() => void block(r.userId, r.firstName)}
                    >
                      <Icon name="x-circle" size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {outgoing.length > 0 && (
          <div style={{ padding: '0 16px 8px' }}>
            <div className="sectlabel">Enviadas ({outgoing.length})</div>
            {/* Sin nombre ni avatar: ver friendRequestsView.ts. Quien todavía no
                aceptó no eligió darse a conocer, y pintarlo acá le entregaba
                nombre y apellido a cualquiera que tipeara su correo. */}
            <div className="caption" style={{ margin: '0 0 6px' }}>
              Por privacidad no mostramos a quién hasta que acepte.
            </div>
            <div className="card">
              {outgoing.map((r) => (
                <div key={r.requestId} className="friend-row" style={{ cursor: 'default' }}>
                  <div
                    className="avatar"
                    style={{ background: 'var(--gray-l, #eceff3)', color: 'var(--muted)', width: 42, height: 42 }}
                    aria-hidden="true"
                  >
                    <Icon name="clock" size={18} />
                  </div>
                  <div className="fr-name">
                    <div className="n">Solicitud enviada</div>
                    <div className="id">{relTime(r.requestedAt)} · pendiente</div>
                  </div>
                  <button
                    className="btn btn-ghost btn-sm btn-fit"
                    disabled={reqBusy === r.requestId}
                    onClick={() => void resolveRequest(r.requestId, 'cancel')}
                  >
                    Cancelar
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
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
                <button className="btn btn-ghost" style={{ padding: 12, fontSize: 'var(--fs-legacy-sm)' }} onClick={() => setAdding(false)}>
                  Cancelar
                </button>
                <button className="btn btn-primary" style={{ padding: 12, fontSize: 'var(--fs-legacy-sm)' }} onClick={addFriend} disabled={busy || !newQuery.trim()}>
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
                {walletRailEnabled && <button
                  className="btn"
                  style={{ width: 'auto', padding: '7px 12px', fontSize: 'var(--fs-legacy-sm)', background: 'var(--teal-l)', color: '#0a7b80' }}
                  onClick={() => navigate('transferir', f.payme_id)}
                  aria-label={`Transferir a ${f.full_name}`}
                >
                  <Icon name="arrow-up-right" size={16} />
                </button>}
                <button
                  className="back-btn"
                  style={{ width: 30, height: 30, fontSize: 'var(--fs-legacy-sm)' }}
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
