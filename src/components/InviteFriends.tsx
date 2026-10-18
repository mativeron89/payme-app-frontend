import { useEffect, useMemo, useRef, useState } from 'react';
import { useIdioma } from '../i18n/idioma';
import { api, newIdempotencyKey } from '../api';
import { extractApiError } from '../api/errors';
import { isDefinitiveMutationError, isServiceUnavailable } from '../api/mutationRetry';
import type { CreateInvitationResponse, Friend, Group } from '../api/types';
import { fold } from '../utils/format';
import { useToast } from './ui';
import { Icon } from './Icon';
import { FriendAvatar } from './FriendAvatar';
import { podarFotosDeAmigos } from '../api/fotosEnMemoria';
import { loadSession } from '../api/storage';
import { ArrobaDebajo } from './ArrobaDebajo';
import { arrobaCoincide, useUsernameCapability } from '../api/username';

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
  /** Clave interna para invitar (`POST /invitations`). NO se muestra (decisión 104). */
  payme_id: string;
  first_name: string;
  full_name: string;
  /** AF-USERNAME-D104 · lo que se ve debajo del nombre, vía `ArrobaDebajo`. */
  username?: string | null;
  /** E173-3 · sólo en la lista de amigos (`GET /friends`, dueño v2.148.0). */
  has_avatar?: boolean;
}

/**
 * D379 · la memoria de las invitaciones de UNA mesa, fuera del panel.
 *
 * Desde D379 el panel vive en la hoja del engranaje de «Tu mesa», que se cierra
 * con la ✕, Escape, el velo o sola: cada cierre lo desmonta. Si la clave de una
 * invitación ambigua («Reintenta la misma: vamos a reutilizarla») o la reserva
 * de una en curso vivieran en el componente, se perderían al cerrar, y reabrir
 * y reintentar mandaría otra `Idempotency-Key`: la invitación se podía
 * duplicar. Por eso las claves por mesa+destinatario, lo reservado (en curso o
 * ya invitado) y los «Invitado ✓» viven acá, y quien abre la mesa
 * (`MesaScreen`) crea una por mesa e identidad y la conserva mientras tanto.
 * Sin memoria de afuera (la pantalla «Compartir la mesa»), el panel usa una
 * propia, como antes.
 */
export interface MemoriaDeInvitaciones {
  /** El código de la mesa: la operación es mesa+destinatario. */
  readonly mesa: string;
  /** Una key por mesa+destinatario; un error ambiguo libera el botón, no la key. */
  readonly claves: Map<string, string>;
  /** Reservados ANTES de ceder el event loop: en curso o ya invitados (el guard contra dobles envíos). */
  readonly reservados: Set<string>;
  /** «Invitado ✓». */
  readonly invitados: Set<string>;
  /** Quién se entera cuando cambia (el panel montado, si hay uno). */
  readonly oyentes: Set<() => void>;
}

export function crearMemoriaDeInvitaciones(mesa: string): MemoriaDeInvitaciones {
  return { mesa, claves: new Map(), reservados: new Set(), invitados: new Set(), oyentes: new Set() };
}

function avisar(memoria: MemoriaDeInvitaciones): void {
  for (const oyente of [...memoria.oyentes]) oyente();
}

/** En curso: reservado y todavía sin «Invitado ✓». */
export function invitacionEnCurso(memoria: MemoriaDeInvitaciones, paymeId: string): boolean {
  return memoria.reservados.has(paymeId) && !memoria.invitados.has(paymeId);
}

export type ResultadoDeInvitar =
  | { readonly tipo: 'reservado' }
  | { readonly tipo: 'enviada' }
  | { readonly tipo: 'vencida' }
  | { readonly tipo: 'error'; readonly code: string; readonly status: number | null; readonly definitivo: boolean };

/**
 * Una invitación idempotente sobre la memoria de la mesa. Si ya está reservada
 * (en curso o invitada) no manda nada. La key se reutiliza mientras el error sea
 * ambiguo y se descarta con una respuesta definitiva, un vencimiento o un envío
 * confirmado. La memoria se actualiza aunque el panel ya no esté montado.
 */
export async function invitarConMemoria(
  memoria: MemoriaDeInvitaciones,
  paymeId: string,
  enviar: (idempotencyKey: string) => Promise<CreateInvitationResponse>,
  nuevaClave: () => string = newIdempotencyKey,
): Promise<ResultadoDeInvitar> {
  if (memoria.reservados.has(paymeId)) return { tipo: 'reservado' };
  memoria.reservados.add(paymeId);
  avisar(memoria);
  const operacion = `${memoria.mesa}::${paymeId}`;
  try {
    const key = memoria.claves.get(operacion) ?? nuevaClave();
    memoria.claves.set(operacion, key);
    const invitation = await enviar(key);
    memoria.claves.delete(operacion);
    if (invitation.invitation.status === 'expired') {
      memoria.reservados.delete(paymeId);
      return { tipo: 'vencida' };
    }
    memoria.invitados.add(paymeId);
    return { tipo: 'enviada' };
  } catch (err) {
    const failure = extractApiError(err);
    const definitivo = isDefinitiveMutationError(failure.code, failure.status);
    if (definitivo) memoria.claves.delete(operacion);
    memoria.reservados.delete(paymeId);
    return { tipo: 'error', code: failure.code, status: failure.status, definitivo };
  } finally {
    avisar(memoria);
  }
}

export function InviteFriends({ code, memoria: memoriaDeAfuera }: {
  code: string;
  /** D379 · la memoria de la mesa, si quien abre el panel la conserva entre cierres (la hoja del engranaje). */
  memoria?: MemoriaDeInvitaciones;
}) {
  const { t } = useIdioma();
  const toast = useToast();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const [mode, setMode] = useState<'friends' | 'groups'>('friends');
  const [q, setQ] = useState('');
  const { enabled: arrobaHabilitada } = useUsernameCapability();
  /** Grupo abierto en el acordeón. Uno solo: dos abiertos empujan de más. */
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  /** Integrantes por grupo, cacheados: `GET /groups/:id` se pide al abrir. */
  const [members, setMembers] = useState<Record<string, Invitable[]>>({});
  const [loadingGroup, setLoadingGroup] = useState<string | null>(null);
  const [groupError, setGroupError] = useState<string | null>(null);
  // Sin memoria de afuera, una propia por mesa: cambiar de mesa empieza de cero, como antes.
  const memoriaPropia = useRef<MemoriaDeInvitaciones | null>(null);
  if (!memoriaDeAfuera && memoriaPropia.current?.mesa !== code) memoriaPropia.current = crearMemoriaDeInvitaciones(code);
  const memoria = memoriaDeAfuera ?? memoriaPropia.current!;
  const [, setVersion] = useState(0);
  useEffect(() => {
    const repintar = () => setVersion((v) => v + 1);
    memoria.oyentes.add(repintar);
    // Lo que cambió mientras el panel no estaba (una invitación en curso que terminó) se ve al volver.
    repintar();
    return () => { memoria.oyentes.delete(repintar); };
  }, [memoria]);

  useEffect(() => {
    setOpenGroup(null);
  }, [code]);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    const expected = loadSession();
    Promise.all([api.getFriends(), api.getGroups()])
      .then(([f, g]) => {
        if (!alive) return;
        // E173-3 · decisión 175: la misma poda que en Amigos.
        if (expected) podarFotosDeAmigos(expected, f.friends);
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
          // AF-USERNAME-D104: por el @ que se ve, ya no por el `payme_id`.
          (f) => fold(f.full_name).includes(needle) || arrobaCoincide(f.username, arrobaHabilitada, needle),
        )
      : friends;
    return pool.slice(0, 6);
  }, [friends, q, arrobaHabilitada]);

  /**
   * E173-3 · `has_avatar` viene sólo en la lista de amigos. Un integrante de
   * grupo que también es amigo usa el de esa lista; si no está, se pide como
   * antes y se tolera el 404.
   */
  const fotoDeAmigo = useMemo(() => new Map(friends.map((f) => [f.id, f.has_avatar])), [friends]);

  const shownGroups = useMemo(() => {
    const needle = fold(q.trim());
    return (needle ? groups.filter((g) => fold(g.name).includes(needle)) : groups).slice(0, 6);
  }, [groups, q]);

  async function invite(f: Invitable) {
    const r = await invitarConMemoria(memoria, f.payme_id, (key) => api.inviteFriend(code, f.payme_id, key));
    if (r.tipo === 'reservado') return;
    if (r.tipo === 'vencida') {
      toast(t('La invitación anterior a {0} venció. Toca de nuevo para generar otra.', f.first_name));
      return;
    }
    if (r.tipo === 'enviada') {
      toast(t('Invitación enviada a {0} ✓', f.first_name));
      return;
    }
    toast(
      r.code === 'mesa_not_invitable'
        ? t('La mesa ya no acepta invitados')
        : isServiceUnavailable(r.status)
          ? t('El servicio no pudo confirmar la invitación a {0}. Reintenta esta misma invitación; no generes otra.', f.first_name)
          : r.definitivo
            ? t('No pudimos invitar a {0}', f.first_name)
            : t('No pudimos confirmar la invitación a {0}. Reintenta la misma: vamos a reutilizarla.', f.first_name),
    );
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
    const retrying = openGroup === g.id && groupError === g.id;
    if (openGroup === g.id && !retrying) {
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
          username: m.username ?? null,
        })),
      }));
    } catch {
      setGroupError(g.id);
    } finally {
      setLoadingGroup(null);
    }
  }

  function fila(f: Invitable, key: string) {
    const done = memoria.invitados.has(f.payme_id);
    const enviando = invitacionEnCurso(memoria, f.payme_id);
    return (
      <div key={key} className="inv-row">
        {/* Pedido de Mati (2026-09-25): la misma foto que en Amigos (n196),
            con el mismo componente y la misma ruta del dueño
            (`GET /friends/:userId/avatar`); `f.id` es el user id del amigo,
            también en los integrantes de un grupo. Sin foto queda el monograma
            navy sobre `--teal-l`, SIN color por persona (reconciliación
            2026-08-21): el color por hash no lo elegía nadie y metía un sexto
            color sin token en la única pantalla donde §5 bis · F declara que
            hay uno solo. */}
        <FriendAvatar
          friendId={f.id}
          name={f.full_name}
          refreshToken={tick}
          hasAvatar={f.has_avatar ?? fotoDeAmigo.get(f.id)}
          variant="marca"
        />
        <div className="fr-name">
          <div className="n">{f.full_name}</div>
          <ArrobaDebajo username={f.username} />
        </div>
        {/* Con BORDE y sin relleno: invitar es una acción repetible sobre una
            lista, no el cierre de la pantalla. Un botón lleno por fila competía
            con el círculo de la barra. */}
        <button
          type="button"
          className={`btn btn-sm btn-fit ${done ? 'btn-ghost' : 'btn-outline'}`}
          disabled={done || enviando}
          onClick={() => void invite(f)}
        >
          {done ? t('Invitado ✓') : enviando ? t('Enviando…') : t('Invitar')}
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

  return (
    <div className="inv-panel">
      <div className="inv-kind-tabs" role="tablist" aria-label={t('Elegir a quién invitar')}>
        {([
          ['friends', t('Amigos')],
          ['groups', t('Grupos')],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            id={`invite-${id}-tab`}
            type="button"
            role="tab"
            aria-selected={mode === id}
            aria-controls="invite-progressive-panel"
            className={`inv-kind-tab${mode === id ? ' on' : ''}`}
            onClick={() => {
              setMode(id);
              setQ('');
              setOpenGroup(null);
            }}
          >
            <Icon name={id === 'friends' ? 'users' : 'users-group'} size={20} aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>
      <div
        id="invite-progressive-panel"
        className="inv-progressive-panel"
        role="tabpanel"
        aria-labelledby={`invite-${mode}-tab`}
      >
        <div className="social-search">
          <Icon name="search" size={18} aria-hidden="true" />
          <input
            className="social-search-input"
            // AF-USERNAME-D104: se busca por lo que se ve. El «ID» ya no se ve.
            placeholder={mode === 'groups'
              ? t('Buscar grupo por nombre')
              : arrobaHabilitada ? t('Buscar por nombre o @') : t('Buscar por nombre')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label={mode === 'friends' ? t('Buscar contactos para invitar') : t('Buscar grupo por nombre')}
          />
        </div>

        {mode === 'friends' && (
          <>
            {shown.length > 0 && <div className="inv-list">{shown.map((f) => fila(f, f.id))}</div>}
            {shown.length === 0 && (
              <p className="inv-none">
                {q.trim()
                  ? t('Ningún contacto coincide con “{0}”.', q.trim())
                  : t('Todavía no agregaste amigos.')}
              </p>
            )}
          </>
        )}

        {mode === 'groups' && (
          <>
          {shownGroups.length === 0 && (
            <p className="inv-none">
              {q.trim()
                ? t('Ningún grupo coincide con “{0}”.', q.trim())
                : t('Todavía no creaste grupos.')}
            </p>
          )}
          {shownGroups.length > 0 && <div className="inv-list">
            {shownGroups.map((g) => {
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
          </div>}
          </>
        )}
      </div>
    </div>
  );
}
