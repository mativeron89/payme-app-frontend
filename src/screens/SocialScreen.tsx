import { useEffect, useState } from 'react';
import { useIdioma } from '../i18n/idioma';
import { api } from '../api';
import type { Friend, Group, GroupDetailResponse } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Avatar, useToast } from '../components/ui';
import { AppBottomBar } from '../components/AppBottomBar';
import {
  AppHeader, AppHeaderBack, BubbleTabs, Launcher, MountedCard, type BubbleTab,
} from '../components/AppHeader';
import { Icon } from '../components/Icon';
import { navigate } from '../router';
import { useWalletRail } from '../api/walletRail';
import { fold, relTime } from '../utils/format';
import { fullName } from '../utils/identity';
import {
  incomingRowView, outgoingRowView, type IncomingRowView, type OutgoingRowView,
} from './friendRequestsView';

/**
 * §1.9 · La sección social — **UNA pantalla con tres pestañas**: Amigos, Grupos
 * y Solicitudes. Reemplaza a `FriendsScreen` y `GroupsScreen`, que eran dos
 * rutas con pestañas que navegaban entre sí.
 *
 * **Por qué una sola pantalla y no tres rutas**, que es la pregunta obvia
 * viniendo de §1.11: **el badge de Solicitudes tiene que verse desde Amigos y
 * desde Grupos.** Con una ruta por pestaña, las tres pantallas tendrían que
 * pedir las solicitudes sólo para pintar un número en una pestaña que no es la
 * suya. Con una pantalla se piden una vez. La razón es medible, no de gusto.
 *
 * Que se pudiera fue medido antes de decidirlo: `grupos` tenía **un solo call
 * site** —las pestañas viejas— y **cero `navigate('grupos')` durmientes**, así
 * que su ruta se retira limpia. Es el mismo caso que `perfil` en 0.46.0, y lo
 * contrario de `cuenta`, que conserva su `case` porque sí los tiene.
 *
 * Es de PRIMER NIVEL —una de las cinco posiciones de la barra—, así que lleva
 * el logo arriba y no tiene flecha de volver (§5 bis · A). El detalle de un
 * grupo sí la tiene, y por eso mismo va sin logo.
 */

type SocialTabId = 'amigos' | 'grupos' | 'solicitudes';

/**
 * Orden alfabético del listado (§1.9). `localeCompare` con `es` ordena bien los
 * acentos —"Álvarez" antes que "Bianchi"—, que es justo lo que un `sort()`
 * pelado hace mal.
 */
function alfabetico(a: string, b: string): number {
  return a.localeCompare(b, 'es', { sensitivity: 'base' });
}

/**
 * Paleta de íconos para grupos nuevos. **§1.9 pide que cada fila lleve ícono
 * propio, "no uno repetido"** — y hasta hoy la app no ofrecía elegirlo, así que
 * el backend le ponía su default `👥` a todos y la lista entera se veía igual.
 *
 * El contrato ya lo aceptaba: `createGroup` valida `icon` opcional de hasta 10
 * caracteres (`schemas/index.js:146`) y la fachada ya lo pasaba. Faltaba
 * únicamente la superficie.
 */
const ICONOS_GRUPO = ['👨‍👩‍👧', '💼', '🎉', '⚽', '🎓', '🏠', '✈️', '🍕'];

export function SocialScreen() {
  const { t } = useIdioma();
  const { session } = useAuth();
  // OLA 5D · el atajo "transferir" es riel saldo: lo habilita el BACKEND.
  const { walletRailEnabled } = useWalletRail();
  const toast = useToast();
  const [tab, setTab] = useState<SocialTabId>('amigos');

  // ─── Amigos ───
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [filtroAmigos, setFiltroAmigos] = useState('');
  const [adding, setAdding] = useState(false);
  const [newQuery, setNewQuery] = useState('');
  const [busy, setBusy] = useState(false);

  // ─── Grupos ───
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [filtroGrupos, setFiltroGrupos] = useState('');
  const [detail, setDetail] = useState<GroupDetailResponse | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newIcon, setNewIcon] = useState(ICONOS_GRUPO[0]!);
  const [groupBusy, setGroupBusy] = useState(false);

  // ─── Solicitudes ───
  const [incoming, setIncoming] = useState<IncomingRowView[]>([]);
  /**
   * ⚠️ `OutgoingRowView`, NO `FriendRequest`: la identidad del destinatario se
   * descarta en el borde de red y nunca entra al componente. Guardar el
   * `FriendRequest` crudo y "acordarse de no pintarlo" es lo que falló en su
   * momento (`fabddfe`).
   */
  const [outgoing, setOutgoing] = useState<OutgoingRowView[]>([]);
  const [reqBusy, setReqBusy] = useState<string | null>(null);

  function loadRequests() {
    void api.getFriendRequests('incoming')
      .then((r) => setIncoming(r.requests.map(incomingRowView))).catch(() => setIncoming([]));
    void api.getFriendRequests('outgoing')
      .then((r) => setOutgoing(r.requests.map(outgoingRowView))).catch(() => setOutgoing([]));
  }

  function loadFriends() {
    api.getFriends().then((r) => setFriends(r.friends)).catch(() => setFriends([]));
  }

  function loadGroups() {
    api.getGroups().then((r) => setGroups(r.groups)).catch(() => setGroups([]));
  }

  useEffect(() => {
    loadFriends();
    loadGroups();
    loadRequests();
  }, []);

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
        action === 'accept' ? t('Ahora son amigos con {0} ✓', quien)
          : action === 'reject' ? t('Solicitud rechazada')
            : t('Solicitud cancelada'),
      );
      loadFriends();
      loadRequests();
    } catch {
      // 404 = la solicitud ya no está (la resolvieron del otro lado o venció).
      toast(t('Esa solicitud ya no está disponible'));
      loadRequests();
    } finally {
      setReqBusy(null);
    }
  }

  async function block(userId: string, quien: string) {
    if (!window.confirm(t('¿Bloquear a {0}? Se rompe la amistad y no van a poder mandarse solicitudes.', quien))) return;
    try {
      await api.blockUser(userId);
      toast(t('{0} quedó bloqueado', quien));
      loadFriends();
      loadRequests();
    } catch {
      toast(t('No pudimos bloquear a esa persona'));
    }
  }

  async function addFriend() {
    const q = newQuery.trim();
    if (!q) return;
    setBusy(true);
    try {
      await api.addFriend(q.includes('@') ? { email: q } : { payme_id: q });
      // C1/C2: el backend responde 202 igual exista o no la persona. La app NO
      // puede decir "no encontramos a nadie": esa respuesta era un oráculo para
      // descubrir cuentas probando correos. El copy no afirma nada del otro.
      toast(t('Si tiene PayMe, le va a llegar tu solicitud'));
      setNewQuery('');
      setAdding(false);
      // ⚠️ A propósito NO se recarga la lista acá. Recargar contestaba, medio
      // segundo después, la misma pregunta que el 202 ciego se acababa de negar
      // a contestar: aparecía una fila nueva si la cuenta existía y ninguna si
      // no. La solicitud se ve al volver a entrar.
    } catch {
      toast(t('No pudimos enviar la solicitud. Prueba de nuevo.'));
    } finally {
      setBusy(false);
    }
  }

  async function createGroup() {
    if (!newName.trim()) return;
    setGroupBusy(true);
    try {
      await api.createGroup(newName.trim(), newIcon);
      toast(t('Grupo creado ✓'));
      setNewName('');
      setNewIcon(ICONOS_GRUPO[0]!);
      setCreating(false);
      loadGroups();
    } catch {
      toast(t('No pudimos crear el grupo'));
    } finally {
      setGroupBusy(false);
    }
  }

  // fold: "sofia" encuentra a "Sofía" (búsqueda insensible a acentos).
  const amigosVisibles = friends
    ?.filter(
      (f) =>
        !filtroAmigos ||
        fold(f.full_name).includes(fold(filtroAmigos)) ||
        // C4 (v2.29): `email` salió del contrato, del resultado y del criterio.
        // Buscar por substring de correo confirmaba su existencia carácter a
        // carácter. No se repone del lado del front.
        fold(f.payme_id).includes(fold(filtroAmigos)),
    )
    .sort((a, b) => alfabetico(a.full_name, b.full_name)) ?? null;

  const gruposVisibles = groups
    ?.filter((g) => !filtroGrupos || fold(g.name).includes(fold(filtroGrupos)))
    .sort((a, b) => alfabetico(a.name, b.name)) ?? null;

  /**
   * El badge cuenta **sólo las entrantes**: es un aviso de acción pendiente, y
   * una solicitud que mandaste vos no espera nada tuyo. Contar las dos inflaría
   * el número con cosas que no podés resolver.
   */
  const pendientes = incoming.length;

  const TABS: BubbleTab[] = [
    { id: 'amigos', label: t('Amigos') },
    { id: 'grupos', label: t('Grupos') },
    { id: 'solicitudes', label: t('Solicitudes'), badge: pendientes },
  ];

  // ─── Detalle de un grupo ───
  // Es SUBpantalla: lleva flecha de volver y por eso va sin logo (§5 bis · A).
  if (detail) {
    const memberIds = new Set(detail.members.map((m) => m.id));
    const addable = friends?.filter((f) => !memberIds.has(f.id)) ?? [];
    return (
      <div className="screen has-appbar">
        <AppHeaderBack
          userName={fullName(session) ?? undefined}
          title={t('{0} {1}', detail.group.icon, detail.group.name)}
          onBack={() => setDetail(null)}
        />
        {/* Longhands: el shorthand inline pisa el `padding-bottom` de
            `.has-appbar .scroll` y "Eliminar grupo" queda abajo de la barra. */}
        <div className="scroll" style={{ paddingTop: 14, paddingLeft: 16, paddingRight: 16 }}>
          <div className="sectlabel">{t('Miembros (')}{detail.members.length})</div>
          <div className="card" style={{ marginBottom: 16 }}>
            {detail.members.length === 0 && (
              <div className="empty" style={{ padding: 18 }}>{t('Sin miembros todavía.')}</div>
            )}
            {detail.members.map((m) => (
              <div key={m.id} className="friend-row" style={{ cursor: 'default' }}>
                <Avatar name={t('{0} {1}', m.first_name, m.last_name)} />
                <div className="fr-name">
                  <div className="n">
                    {m.first_name} {m.last_name}
                  </div>
                  <div className="id">{m.payme_id}</div>
                </div>
                <button
                  className="back-btn"
                  style={{ width: 30, height: 30, fontSize: 'var(--fs-legacy-sm)' }}
                  aria-label={t('Quitar a {0} del grupo', m.first_name)}
                  onClick={async () => {
                    try {
                      await api.removeGroupMember(detail.group.id, m.id);
                      setDetail(await api.getGroup(detail.group.id));
                      loadGroups();
                    } catch {
                      toast(t('No se pudo quitar del grupo'));
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
              <div className="sectlabel">{t('Agregar del listado de amigos')}</div>
              <div className="card" style={{ marginBottom: 16 }}>
                {addable.map((f) => (
                  <button
                    key={f.id}
                    className="friend-row"
                    onClick={async () => {
                      try {
                        await api.addGroupMember(detail.group.id, f.id);
                        setDetail(await api.getGroup(detail.group.id));
                        loadGroups();
                      } catch {
                        toast(t('No se pudo agregar'));
                      }
                    }}
                  >
                    <Avatar name={f.full_name} />
                    <div className="fr-name">
                      <div className="n">{f.full_name}</div>
                      <div className="id">{f.payme_id}</div>
                    </div>
                    <span className="badge badge-teal">{t('+ sumar')}</span>
                  </button>
                ))}
              </div>
            </>
          )}
          <button
            className="btn btn-ghost"
            onClick={async () => {
              if (!window.confirm(t('¿Eliminar el grupo "{0}"?', detail.group.name))) return;
              try {
                await api.deleteGroup(detail.group.id);
                toast(t('Grupo eliminado'));
                setDetail(null);
                loadGroups();
              } catch {
                toast(t('No se pudo eliminar el grupo'));
              }
            }}
          >
            <Icon name="trash" size={16} className="ico-inline" /> {t('Eliminar grupo')}
          </button>
        </div>
        {/* El detalle TAMBIÉN la lleva: que tenga flecha de volver no alcanza,
            esa vuelve a la lista y no sale de la sección. */}
        <AppBottomBar active="amigos" />
      </div>
    );
  }

  return (
    <div className="screen has-appbar">
      <AppHeader
        userName={fullName(session) ?? undefined}
        alignChrome
        tabs={
          <BubbleTabs tabs={TABS} active={tab} onSelect={(id) => setTab(id as SocialTabId)} />
        }
      />

      <div className="scroll">
        {/* La tarjeta cuadra la esquina que coincide con una pestaña extrema,
            para que burbuja y tarjeta lean como una sola pieza. */}
        <MountedCard seam={tab === TABS[0]!.id ? 'left' : tab === TABS.at(-1)!.id ? 'right' : undefined}>
          {tab === 'amigos' && (
            /* Tile ÚNICO y sin dividir (§1.9). Se probó con un segundo tile
               "Buscar amigo" al lado y se sacó: la búsqueda vive siempre
               visible en su propia burbuja, acá abajo. */
            <div className="launch-stack">
              <Launcher icon="users" label={t('Nuevo amigo')} onClick={() => setAdding(true)} />
            </div>
          )}

          {tab === 'grupos' && (
            <div className="launch-stack">
              <Launcher icon="users-group" label={t('Nuevo grupo')} onClick={() => setCreating(true)} />
            </div>
          )}

          {/* Solicitudes NO es lanzador: necesita los botones de acción ahí
              mismo, así que muestra directo dentro de la tarjeta montada. */}
          {tab === 'solicitudes' && (
            <SolicitudesPanel
              incoming={incoming}
              outgoing={outgoing}
              reqBusy={reqBusy}
              onResolve={resolveRequest}
              onBlock={block}
            />
          )}
        </MountedCard>

        {/* ─── Burbuja aparte: buscador arriba, listado alfabético debajo ─── */}
        {tab === 'amigos' && (
          <div className="social-list">
            {adding && (
              <div className="card card-p" style={{ marginBottom: 12 }}>
                <div className="sectlabel">{t('Agregar amigo')}</div>
                <input
                  className="input"
                  placeholder={t('Email o ID PayMe (payme_mx_xxxx)')}
                  value={newQuery}
                  onChange={(e) => setNewQuery(e.target.value)}
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="btn btn-ghost"
                    style={{ padding: 12, fontSize: 'var(--fs-legacy-sm)' }}
                    onClick={() => setAdding(false)}
                  >
                    {t('Cancelar')}
                  </button>
                  <button
                    className="btn btn-primary"
                    style={{ padding: 12, fontSize: 'var(--fs-legacy-sm)' }}
                    onClick={addFriend}
                    disabled={busy || !newQuery.trim()}
                  >
                    {busy ? t('Buscando…') : t('Agregar')}
                  </button>
                </div>
              </div>
            )}
            <div className="card">
              <div className="social-search">
                <Icon name="search" size={18} aria-hidden="true" />
                <input
                  className="social-search-input"
                  placeholder={t('Buscar entre tus amigos')}
                  aria-label={t('Buscar entre tus amigos')}
                  value={filtroAmigos}
                  onChange={(e) => setFiltroAmigos(e.target.value)}
                />
              </div>
              {amigosVisibles === null && <div className="loading">{t('Cargando amigos…')}</div>}
              {amigosVisibles?.length === 0 && (
                <div className="empty">
                  <div className="emoji"><Icon name="users" size={40} /></div>
                  {friends?.length === 0
                    ? t('Todavía no agregaste amigos.')
                    : t('Sin resultados para esa búsqueda.')}
                </div>
              )}
              {amigosVisibles?.map((f) => (
                <div key={f.id} className="friend-row" style={{ cursor: 'default' }}>
                  <Avatar name={f.full_name} />
                  <div className="fr-name">
                    <div className="n">{f.full_name}</div>
                    <div className="id">{f.payme_id}</div>
                  </div>
                  {walletRailEnabled && (
                    <button
                      className="btn"
                      style={{ width: 'auto', padding: '7px 12px', fontSize: 'var(--fs-legacy-sm)', background: 'var(--teal-l)', color: '#0a7b80' }}
                      onClick={() => navigate('transferir', f.payme_id)}
                      aria-label={`Transferir a ${f.full_name}`}
                    >
                      <Icon name="arrow-up-right" size={16} />
                    </button>
                  )}
                  <button
                    className="back-btn"
                    style={{ width: 30, height: 30, fontSize: 'var(--fs-legacy-sm)' }}
                    aria-label={t('Quitar a {0}', f.first_name)}
                    onClick={async () => {
                      if (!window.confirm(t('¿Quitar a {0} de tus amigos?', f.full_name))) return;
                      try {
                        await api.removeFriend(f.id);
                        toast(t('Amigo quitado'));
                        loadFriends();
                      } catch {
                        toast(t('No se pudo quitar de tus amigos'));
                      }
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'grupos' && (
          <div className="social-list">
            {creating && (
              <div className="card card-p" style={{ marginBottom: 12 }}>
                <div className="sectlabel">{t('Nuevo grupo')}</div>
                <input
                  className="input"
                  placeholder={t('Nombre (Familia, Trabajo…)')}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  maxLength={100}
                />
                {/* §1.9 pide ícono propio por fila. Sin esto el backend le pone
                    su default a todos y la lista entera se ve igual. */}
                <div className="sectlabel">{t('Ícono')}</div>
                <div className="icon-pick" role="radiogroup" aria-label={t('Ícono del grupo')}>
                  {ICONOS_GRUPO.map((ic) => (
                    <button
                      key={ic}
                      type="button"
                      role="radio"
                      aria-checked={ic === newIcon}
                      aria-label={t('Ícono {0}', ic)}
                      className={`icon-pick-opt ${ic === newIcon ? 'on' : ''}`}
                      onClick={() => setNewIcon(ic)}
                    >
                      {ic}
                    </button>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="btn btn-ghost"
                    style={{ padding: 12, fontSize: 'var(--fs-legacy-sm)' }}
                    onClick={() => setCreating(false)}
                  >
                    {t('Cancelar')}
                  </button>
                  <button
                    className="btn btn-primary"
                    style={{ padding: 12, fontSize: 'var(--fs-legacy-sm)' }}
                    onClick={createGroup}
                    disabled={groupBusy || !newName.trim()}
                  >
                    {groupBusy ? t('Creando…') : t('Crear')}
                  </button>
                </div>
              </div>
            )}
            <div className="card">
              <div className="social-search">
                <Icon name="search" size={18} aria-hidden="true" />
                <input
                  className="social-search-input"
                  placeholder={t('Buscar entre tus grupos')}
                  aria-label={t('Buscar entre tus grupos')}
                  value={filtroGrupos}
                  onChange={(e) => setFiltroGrupos(e.target.value)}
                />
              </div>
              {gruposVisibles === null && <div className="loading">{t('Cargando grupos…')}</div>}
              {gruposVisibles?.length === 0 && (
                <div className="empty">
                  <div className="emoji"><Icon name="users-group" size={40} /></div>
                  {groups?.length === 0
                    ? t('Crea un grupo para dividir siempre con la misma gente.')
                    : t('Sin resultados para esa búsqueda.')}
                </div>
              )}
              {gruposVisibles?.map((g) => (
                <button key={g.id} className="list-row" onClick={async () => {
                  try {
                    setDetail(await api.getGroup(g.id));
                  } catch {
                    toast(t('No pudimos abrir el grupo'));
                  }
                }}>
                  <div className="group-ico" aria-hidden="true">{g.icon}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 'var(--fs-legacy-base)', fontWeight: 600 }}>{g.name}</div>
                    <div className="caption">
                      {g.member_count} {g.member_count === 1 ? t('miembro') : t('miembros')}
                    </div>
                  </div>
                  <span style={{ color: 'var(--gray-b)' }}>→</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <AppBottomBar active="amigos" />
    </div>
  );
}

/**
 * §1.9 · Solicitudes.
 *
 * 🔴 **Sale con UNA lista, y la ausencia es deliberada.** El spec pide acá un
 * selector de pastilla Amigos / Grupos con filas *"Te invitó a {grupo}"*. **Eso
 * no existe en el contrato, y no es un endpoint que falte: es otro modelo de
 * producto.** Medido en el espejo (backend v2.31.0):
 *
 * - `friend_groups` tiene `user_id` y `UNIQUE (user_id, name)` — un grupo es de
 *   UNA persona (`db/schema.sql:683`).
 * - `GET /groups` filtra `WHERE g.user_id = $1`: a quien agregás **nunca se le
 *   avisa**, y el grupo **no le aparece** (`routes/groups.js:15`).
 * - `POST /groups/:id/members` inserta directo y contesta `201 {added:true}`.
 *   No crea ningún estado pendiente que alguien pueda aceptar.
 * - Cero coincidencias de invitación a grupo en todo el espejo.
 *
 * O sea que un grupo es **una carpeta de contactos tuya**. Un selector cuyo
 * segundo lado no puede tener nada nunca es exactamente la promesa vacía que el
 * spec ya le negó al QR de §1.7, a Cuentas Asociadas de §1.11 y a
 * "Configuración" en `Más`. Anotado como **G-32**; entra cuando exista.
 */
function SolicitudesPanel({
  incoming,
  outgoing,
  reqBusy,
  onResolve,
  onBlock,
}: {
  incoming: IncomingRowView[];
  outgoing: OutgoingRowView[];
  reqBusy: string | null;
  onResolve: (id: string, action: 'accept' | 'reject' | 'cancel', quien?: string) => void;
  onBlock: (userId: string, quien: string) => void;
}) {
  const { t } = useIdioma();
  if (incoming.length === 0 && outgoing.length === 0) {
    return (
      <div className="empty" style={{ padding: '28px 18px' }}>
        <div className="emoji"><Icon name="users" size={40} /></div>
        {t('No tienes solicitudes pendientes.')}
      </div>
    );
  }

  return (
    <div className="solicitudes">
      {incoming.length > 0 && (
        <>
          <div className="sectlabel">{t('Te quieren agregar (')}{incoming.length})</div>
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
                  onClick={() => onResolve(r.requestId, 'accept', r.firstName)}
                >
                  {t('Aceptar')}
                </button>
                <button
                  className="btn btn-ghost btn-sm btn-fit"
                  disabled={reqBusy === r.requestId}
                  onClick={() => onResolve(r.requestId, 'reject', r.firstName)}
                >
                  {t('Rechazar')}
                </button>
                <button
                  className="btn btn-ghost btn-sm btn-fit"
                  aria-label={t('Bloquear a {0}', r.fullName)}
                  disabled={reqBusy === r.requestId}
                  onClick={() => onBlock(r.userId, r.firstName)}
                >
                  <Icon name="x-circle" size={16} />
                </button>
              </div>
            </div>
          ))}
        </>
      )}

      {outgoing.length > 0 && (
        <>
          <div className="sectlabel">{t('Enviadas (')}{outgoing.length})</div>
          {/* Sin nombre ni avatar: ver friendRequestsView.ts. Quien todavía no
              aceptó no eligió darse a conocer, y pintarlo acá le entregaba
              nombre y apellido a cualquiera que tipeara su correo. */}
          <div className="caption" style={{ margin: '0 16px 6px' }}>
            {t('Por privacidad no mostramos a quién hasta que acepte.')}
          </div>
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
                <div className="n">{t('Solicitud enviada')}</div>
                <div className="id">{relTime(r.requestedAt, undefined, t)} {t('· pendiente')}</div>
              </div>
              <button
                className="btn btn-ghost btn-sm btn-fit"
                disabled={reqBusy === r.requestId}
                onClick={() => onResolve(r.requestId, 'cancel')}
              >
                {t('Cancelar')}
              </button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
