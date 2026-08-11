import { useEffect, useMemo, useRef, useState } from 'react';
import { useIdioma } from '../i18n/idioma';
import { api, newIdempotencyKey } from '../api';
import { extractApiError } from '../api/errors';
import { isDefinitiveMutationError, isServiceUnavailable } from '../api/mutationRetry';
import type { Friend, Group } from '../api/types';
import { fold } from '../utils/format';
import { Avatar, useToast } from './ui';
import { Icon } from './Icon';

/**
 * Invitar amigos de PayMe a una mesa — el panel de §1.7 Compartir.
 *
 * Usa el contrato EXISTENTE de invitaciones in-app (POST /mesas/:code/invitations,
 * type 'in_app' por payme_id), el mismo que dispara el aviso "X te invitó" en
 * Avisos del invitado. Solo lo ve el organizador (el backend exige opener: 403).
 *
 * ## Qué cambió con §1.7, y por qué
 *
 * **Se cae "Invitar a todos".** El spec es explícito: tocar un grupo lo expande
 * en acordeón y muestra a sus integrantes **cada uno con su propio botón
 * Invitar** — *"es un atajo para encontrar gente, no un envío masivo"*. Con eso
 * desaparece `inviteGroup()`, que mandaba N invitaciones de un toque y tenía que
 * contar parciales para poder decir la verdad en un toast.
 *
 * No es sólo estética: un envío masivo desde un botón chico, en una mesa, con
 * gente esperando, es la clase de acción que no se puede deshacer y que nadie
 * revisa antes de tocar. Invitar de a uno hace que el error cueste una fila.
 *
 * **El guard sincrónico contra dobles envíos se conserva entero**, porque el
 * riesgo no cambió: `sentRef` reserva el `payme_id` ANTES de ceder el event
 * loop. La key del backend cubre replays, pero no dos taps simultáneos. Si el
 * envío falla se libera el botón; ante ambigüedad se conserva la misma key.
 */
/**
 * Lo MÍNIMO que necesita una fila para pintarse e invitar. Existe para no
 * castear los integrantes de un grupo a `Friend`: `GET /groups/:id` devuelve
 * `email` y no devuelve `added_at`, así que decir que son `Friend` sería mentir
 * en las dos direcciones. `Friend` lo satisface estructuralmente sin conversión.
 */
interface Invitable {
  id: string;
  payme_id: string;
  first_name: string;
  full_name: string;
}

export function InviteFriends({ code }: { code: string }) {
  const { t } = useIdioma();
  const toast = useToast();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const [q, setQ] = useState('');
  const [invited, setInvited] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  /** Grupo abierto en el acordeón. Uno solo: dos abiertos empujan de más. */
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  /** Integrantes por grupo, cacheados: `GET /groups/:id` se pide al abrir. */
  const [members, setMembers] = useState<Record<string, Invitable[]>>({});
  const [loadingGroup, setLoadingGroup] = useState<string | null>(null);
  const [groupError, setGroupError] = useState<string | null>(null);
  const sentRef = useRef<Set<string>>(new Set());
  /** Una key por mesa+destinatario; un error ambiguo libera el botón, no la key. */
  const invitationKeysRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    sentRef.current.clear();
    setInvited(new Set());
    setBusy(new Set());
    setOpenGroup(null);
  }, [code]);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    Promise.all([api.getFriends(), api.getGroups()])
      .then(([f, g]) => {
        if (!alive) return;
        setFriends(f.friends);
        setGroups(g.groups);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [tick]);

  const shown = useMemo(() => {
    const needle = fold(q.trim());
    const pool = needle
      ? friends.filter(
          (f) => fold(f.full_name).includes(needle) || fold(f.payme_id).includes(needle),
        )
      : friends;
    return pool.slice(0, 6);
  }, [friends, q]);

  async function invite(f: Invitable) {
    if (sentRef.current.has(f.payme_id)) return;
    sentRef.current.add(f.payme_id);
    setBusy((s) => new Set(s).add(f.payme_id));
    const operation = `${code}::${f.payme_id}`;
    try {
      const key = invitationKeysRef.current.get(operation) ?? newIdempotencyKey();
      invitationKeysRef.current.set(operation, key);
      const invitation = await api.inviteFriend(code, f.payme_id, key);
      if (invitation.invitation.status === 'expired') {
        invitationKeysRef.current.delete(operation);
        sentRef.current.delete(f.payme_id);
        toast(t('La invitación anterior a {0} venció. Toca de nuevo para generar otra.', f.first_name));
        return;
      }
      invitationKeysRef.current.delete(operation);
      setInvited((s) => new Set(s).add(f.payme_id));
      toast(t('Invitación enviada a {0} ✓', f.first_name));
    } catch (err) {
      const failure = extractApiError(err);
      const definitive = isDefinitiveMutationError(failure.code, failure.status);
      if (definitive) invitationKeysRef.current.delete(operation);
      sentRef.current.delete(f.payme_id);
      toast(
        failure.code === 'mesa_not_invitable'
          ? t('La mesa ya no acepta invitados')
          : isServiceUnavailable(failure.status)
            ? t('El servicio no pudo confirmar la invitación a {0}. Reintenta esta misma invitación; no generes otra.', f.first_name)
            : definitive
              ? t('No pudimos invitar a {0}', f.first_name)
              : t('No pudimos confirmar la invitación a {0}. Reintenta la misma: vamos a reutilizarla.', f.first_name),
      );
    } finally {
      setBusy((s) => {
        const n = new Set(s);
        n.delete(f.payme_id);
        return n;
      });
    }
  }

  /**
   * Abrir un grupo trae sus integrantes UNA vez y los deja cacheados. Cerrar no
   * los tira: reabrir el mismo grupo no vuelve a pegarle a la red.
   *
   * `GET /groups/:id` devuelve además el `email` de cada integrante y acá NO se
   * usa nunca. Es la misma lección de G-25: si un campo de identidad entra al
   * estado de la pantalla, alguien lo va a pintar; se descarta en el borde.
   */
  async function toggleGroup(g: Group) {
    if (openGroup === g.id) {
      setOpenGroup(null);
      return;
    }
    setOpenGroup(g.id);
    setGroupError(null);
    if (members[g.id]) return;
    setLoadingGroup(g.id);
    try {
      const detail = await api.getGroup(g.id);
      setMembers((prev) => ({
        ...prev,
        [g.id]: detail.members.map((m) => ({
          id: m.id,
          payme_id: m.payme_id,
          first_name: m.first_name,
          full_name: t('{0} {1}', m.first_name, m.last_name).trim(),
        })),
      }));
    } catch {
      setGroupError(g.id);
    } finally {
      setLoadingGroup(null);
    }
  }

  function fila(f: Invitable, key: string) {
    const done = invited.has(f.payme_id);
    return (
      <div key={key} className="inv-row">
        <Avatar name={f.full_name} />
        <div className="fr-name">
          <div className="n">{f.full_name}</div>
          <div className="id">{f.payme_id}</div>
        </div>
        {/* Con BORDE y sin relleno: invitar es una acción repetible sobre una
            lista, no el cierre de la pantalla. Un botón lleno por fila competía
            con el círculo de la barra. */}
        <button
          type="button"
          className={`btn btn-sm btn-fit ${done ? 'btn-ghost' : 'btn-outline'}`}
          disabled={done || busy.has(f.payme_id)}
          onClick={() => void invite(f)}
        >
          {done ? t('Invitado ✓') : busy.has(f.payme_id) ? t('Enviando…') : t('Invitar')}
        </button>
      </div>
    );
  }

  if (failed) {
    return (
      <div className="inv-panel">
        <div className="state-error" role="alert">
          <div className="state-error-row">
            <Icon name="x-circle" size={22} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="state-error-title">{t('No pudimos cargar tus contactos')}</div>
              <p className="state-error-body">
                {t('Puedes compartir el link igual mientras tanto.')}
              </p>
            </div>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTick((t) => t + 1)}>
            {t('Reintentar')}
          </button>
        </div>
      </div>
    );
  }

  if (friends.length === 0 && groups.length === 0) return null;

  return (
    <div className="inv-panel">
      <h2 className="sectlabel">{t('Invitar')}</h2>
      <input
        className="input"
        placeholder={t('Buscar por nombre o ID')}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label={t('Buscar contactos para invitar')}
      />
      {shown.length > 0 && <div className="inv-list">{shown.map((f) => fila(f, f.id))}</div>}
      {q.trim() && shown.length === 0 && (
        <p className="inv-none">Ningún contacto coincide con “{q.trim()}”.</p>
      )}

      {groups.length > 0 && (
        <>
          <h2 className="sectlabel inv-groups-label">{t('O invita a un grupo')}</h2>
          {/* Lista VERTICAL, no burbujas lado a lado: con más de dos grupos no
              entran en una fila. */}
          <div className="inv-list">
            {groups.map((g) => {
              const abierto = openGroup === g.id;
              const gente = members[g.id];
              return (
                <div key={g.id}>
                  <button
                    type="button"
                    className="inv-group"
                    onClick={() => void toggleGroup(g)}
                    aria-expanded={abierto}
                  >
                    {/* Ícono PROPIO del grupo, no uno fijo repetido: `icon` es
                        del contrato y lo elige quien crea el grupo. */}
                    <span className="inv-group-ico" aria-hidden="true">
                      {g.icon}
                    </span>
                    <div className="fr-name">
                      <div className="n">{g.name}</div>
                      <div className="id">
                        {g.member_count} {g.member_count === 1 ? t('integrante') : t('integrantes')}
                      </div>
                    </div>
                    <span className={`inv-chevron ${abierto ? 'on' : ''}`} aria-hidden="true">
                      <Icon name="chevron-down" size={20} />
                    </span>
                  </button>
                  {abierto && (
                    <div className="inv-members">
                      {loadingGroup === g.id && <p className="inv-none">{t('Cargando integrantes…')}</p>}
                      {groupError === g.id && (
                        <p className="inv-none">
                          {t('No pudimos abrir el grupo.')}{' '}
                          <button type="button" className="linkbtn" onClick={() => void toggleGroup(g)}>
                            {t('Reintentar')}
                          </button>
                        </p>
                      )}
                      {gente?.length === 0 && <p className="inv-none">{t('Este grupo no tiene integrantes.')}</p>}
                      {gente?.map((m) => fila(m, `${g.id}::${m.payme_id}`))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
