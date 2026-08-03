import { useEffect, useMemo, useRef, useState } from 'react';
import { api, newIdempotencyKey } from '../api';
import { extractApiError } from '../api/errors';
import { isDefinitiveMutationError, isServiceUnavailable } from '../api/mutationRetry';
import type { Friend, Group } from '../api/types';
import { fold } from '../utils/format';
import { Avatar, useToast } from './ui';
import { Icon } from './Icon';

/**
 * Invitar amigos de PayMe a una mesa (feedback del hermano de Mati,
 * 2026-07-24): buscador con typeahead sobre los amigos + desplegable de
 * grupos ("invitar a todos"). Usa el contrato EXISTENTE de invitaciones
 * in-app (POST /mesas/:code/invitations, type 'in_app' por payme_id) — el
 * mismo que dispara el banner "X te invitó" en el home del invitado.
 * Solo lo ve el organizador (el backend exige opener: 403 si no).
 */
export function InviteFriends({ code }: { code: string }) {
  const toast = useToast();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const [q, setQ] = useState('');
  const [invited, setInvited] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [groupBusy, setGroupBusy] = useState<string | null>(null);
  /**
   * Guard SINCRÓNICO contra dobles envíos: individual y grupo reservan el
   * payme_id ANTES de ceder el event loop. La key del backend cubre replays,
   * pero no reemplaza este mutex contra dos taps simultáneos. Si el envío
   * falla se libera el botón; ante ambigüedad se conserva la misma key.
   */
  const sentRef = useRef<Set<string>>(new Set());
  /** Una key por mesa+destinatario; un error ambiguo libera el botón, no la key. */
  const invitationKeysRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    sentRef.current.clear();
    setInvited(new Set());
    setBusy(new Set());
    setGroupBusy(null);
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

  async function invite(f: Friend) {
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
        toast(`La invitación anterior a ${f.first_name} venció. Tocá de nuevo para generar otra.`);
        return;
      }
      invitationKeysRef.current.delete(operation);
      setInvited((s) => new Set(s).add(f.payme_id));
      toast(`Invitación enviada a ${f.first_name} ✓`);
    } catch (err) {
      const failure = extractApiError(err);
      const definitive = isDefinitiveMutationError(failure.code, failure.status);
      if (definitive) invitationKeysRef.current.delete(operation);
      sentRef.current.delete(f.payme_id);
      toast(
        failure.code === 'mesa_not_invitable'
          ? 'La mesa ya no acepta invitados'
          : isServiceUnavailable(failure.status)
            ? `El servicio no pudo confirmar la invitación a ${f.first_name}. Reintentá esta misma invitación; no generes otra.`
            : definitive
              ? `No pudimos invitar a ${f.first_name}`
              : `No pudimos confirmar la invitación a ${f.first_name}. Reintentá la misma: vamos a reutilizarla.`,
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
   * Invita a los miembros del grupo que falten. El toast dice la VERDAD:
   * distingue todo-ok / parcial / todo-falló / nada-para-invitar, y si la
   * mesa dejó de aceptar invitados corta el resto (fallarían igual).
   */
  async function inviteGroup(g: Group) {
    if (groupBusy) return;
    setGroupBusy(g.id);
    try {
      const detail = await api.getGroup(g.id);
      let ok = 0;
      let fallidas = 0;
      let intentadas = 0;
      let notInvitable = false;
      let ambiguous = false;
      let unavailable = false;
      for (const m of detail.members) {
        if (sentRef.current.has(m.payme_id)) continue;
        sentRef.current.add(m.payme_id);
        intentadas += 1;
        const operation = `${code}::${m.payme_id}`;
        try {
          const key = invitationKeysRef.current.get(operation) ?? newIdempotencyKey();
          invitationKeysRef.current.set(operation, key);
          const invitation = await api.inviteFriend(code, m.payme_id, key);
          if (invitation.invitation.status === 'expired') {
            invitationKeysRef.current.delete(operation);
            sentRef.current.delete(m.payme_id);
            fallidas += 1;
            continue;
          }
          invitationKeysRef.current.delete(operation);
          setInvited((s) => new Set(s).add(m.payme_id));
          ok += 1;
        } catch (err) {
          const failure = extractApiError(err);
          const definitive = isDefinitiveMutationError(failure.code, failure.status);
          if (definitive) invitationKeysRef.current.delete(operation);
          else ambiguous = true;
          if (isServiceUnavailable(failure.status)) unavailable = true;
          sentRef.current.delete(m.payme_id);
          fallidas += 1;
          if (failure.code === 'mesa_not_invitable') {
            notInvitable = true;
            break;
          }
        }
      }
      if (notInvitable) toast('La mesa ya no acepta invitados');
      else if (intentadas === 0) toast(`Ya habías invitado a todos en ${g.name}`);
      else if (ambiguous) {
        toast(
          unavailable
            ? `El servicio no confirmó todas las invitaciones a ${g.name}. Reintentá las pendientes: reutilizamos cada operación, no generes otras.`
            : `No pudimos confirmar todas las invitaciones a ${g.name}. Reintentá las pendientes: vamos a reutilizar las mismas.`,
        );
      }
      else if (fallidas === 0)
        toast(`${ok} invitación${ok === 1 ? '' : 'es'} enviada${ok === 1 ? '' : 's'} a ${g.name} ✓`);
      else if (ok === 0) toast(`No pudimos enviar las invitaciones a ${g.name} — probá de nuevo`);
      else toast(`${ok} de ${intentadas} invitaciones enviadas a ${g.name} — reintentá las que faltan`);
    } catch {
      toast('No pudimos abrir el grupo');
    } finally {
      setGroupBusy(null);
    }
  }

  if (failed) {
    return (
      <div style={{ marginTop: 18, textAlign: 'left' }}>
        <div className="sectlabel">Invitar amigos de PayMe</div>
        <div className="caption">No pudimos cargar tus amigos.</div>
        <button className="btn btn-ghost btn-sm btn-fit" style={{ marginTop: 8 }} onClick={() => setTick((t) => t + 1)}>
          Reintentar
        </button>
      </div>
    );
  }
  if (friends.length === 0 && groups.length === 0) return null;

  return (
    <div style={{ marginTop: 18, textAlign: 'left' }}>
      <div className="sectlabel">Invitar amigos de PayMe</div>
      <input
        className="input"
        placeholder="Buscar por nombre o ID"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Buscar amigos para invitar"
      />
      {shown.length > 0 && (
        <div className="card" style={{ marginTop: 8 }}>
          {shown.map((f) => {
            const done = invited.has(f.payme_id);
            return (
              <div key={f.id} className="friend-row" style={{ cursor: 'default' }}>
                <Avatar name={f.full_name} />
                <div className="fr-name">
                  <div className="n">{f.full_name}</div>
                  <div className="id">{f.payme_id}</div>
                </div>
                <button
                  className={`btn btn-sm btn-fit ${done ? 'btn-ghost' : 'btn-teal'}`}
                  disabled={done || busy.has(f.payme_id) || groupBusy !== null}
                  onClick={() => void invite(f)}
                >
                  {done ? 'Invitado ✓' : busy.has(f.payme_id) ? 'Enviando…' : 'Invitar'}
                </button>
              </div>
            );
          })}
        </div>
      )}
      {q.trim() && shown.length === 0 && (
        <div className="caption" style={{ marginTop: 8 }}>
          Ningún amigo coincide con “{q.trim()}”.
        </div>
      )}

      {groups.length > 0 && (
        <>
          <button
            className="btn btn-ghost btn-sm"
            style={{ marginTop: 10 }}
            onClick={() => setGroupsOpen((v) => !v)}
            aria-expanded={groupsOpen}
          >
            <Icon name="users-group" size={16} className="ico-inline" /> Invitar a un grupo{' '}
            {groupsOpen ? '▴' : '▾'}
          </button>
          {groupsOpen && (
            <div className="card" style={{ marginTop: 8 }}>
              {groups.map((g) => (
                <div key={g.id} className="friend-row" style={{ cursor: 'default' }}>
                  <div className="fr-name" style={{ marginLeft: 4 }}>
                    <div className="n">
                      {g.icon} {g.name}
                    </div>
                    <div className="id">
                      {g.member_count} {g.member_count === 1 ? 'miembro' : 'miembros'}
                    </div>
                  </div>
                  <button
                    className="btn btn-teal btn-sm btn-fit"
                    disabled={groupBusy !== null}
                    onClick={() => void inviteGroup(g)}
                  >
                    {groupBusy === g.id ? 'Enviando…' : 'Invitar a todos'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
