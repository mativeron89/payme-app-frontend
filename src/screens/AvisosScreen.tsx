import { useEffect, useState } from 'react';
import { useIdioma } from '../i18n/idioma';
import { api } from '../api';
import type { AppNotification } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { fullName } from '../utils/identity';
import { AppBottomBar } from '../components/AppBottomBar';
import { AppHeaderBack } from '../components/AppHeader';
import { Icon, type IconName } from '../components/Icon';
import { useToast } from '../components/ui';
import { extractApiError } from '../api/errors';
import {
  copyAdmision,
  invitacionesMostrables,
  metaInvitacion,
  type InvitacionMostrable,
} from './invitacionAdmision';
import { goBack, navigate } from '../router';
import { relTime } from '../utils/format';
import { useShortfallDetailCapability } from '../api/privateFeatures';
import { readShortfallNotificationDisclosure } from '../api/shortfallDetail';
import { ShortfallDisclosure } from '../components/ShortfallDisclosure';

/**
 * Avisos: invitaciones in-app pendientes (GET /invitations + accept) arriba,
 * y el inbox de notificaciones (GET /notifications) abajo.
 *
 * SPEC_APP.md §1.8, aplicado. Lo que cambia respecto de lo construido y por qué:
 *
 *  - **Cabecera de dos filas con Volver.** Logo + nombre completo + campana en la
 *    primera fila y la navegación explícita en la segunda. La campana queda
 *    presente pero no es interactiva dentro de su propio destino (`bellHere`).
 *  - **"Marcar leídos" baja del encabezado**: es una acción sobre la lista, no
 *    parte de la identidad de la pantalla.
 *  - **Tarjeta de título `Notificaciones`**, separada de la sección homónima
 *    que agrupa el inbox debajo de las invitaciones.
 *  - **La tarjeta de invitación deja de ser `card` blanca**: fondo `--teal-l` y
 *    borde `--action-2`, que es lo que la separa del resto de la lista. El
 *    texto va en **dos líneas** —"{Nombre} te invitó a" / "{Restaurante}"— y
 *    nunca en una sola línea larga, que era lo que se partía feo con nombres
 *    reales.
 *  - **El botón dice "Sumarme"**, el mismo verbo que "Sumate a la mesa" de la
 *    entrada por link (§1.2). Sigue en `--action` navy: el naranja se evaluó
 *    como quinta excepción y se rechazó, porque esta pantalla muestra la barra
 *    con su propio círculo naranja.
 *  - **No leído = punto `--action` navy de 8px a la izquierda Y peso 700.** Dos
 *    señales, no una. El punto era `--action-2` teal; el spec dice navy.
 *  - **El leído ya no se atenúa con `opacity` sobre la fila entera.** Bajar la
 *    opacidad del contenedor arrastra el texto por debajo del mínimo de
 *    contraste. La diferencia la marcan el peso y el punto.
 *  - **Vacío real sin borde**, con la copy del spec.
 *  - Barra de cinco posiciones **sin ítem activo**: ninguna de las cinco
 *    representa "estoy en Avisos".
 *
 * **El ícono de la invitación NO puede ser el de la categoría del restaurante,
 * que es lo que pide el spec: G-31.** `GET /invitations` proyecta
 * `r.name AS restaurant_name` y nada más — no manda `category` ni el id del
 * restaurante con el que pedirla, y `GET /mesas/:code` exige ser participante,
 * que es justo lo que todavía no sos. Se usa `store` —un local—, que es
 * genérico y no afirma ninguna cocina. Antes había un `sushi` hardcodeado: eso
 * no era un ícono genérico, era decir que el restaurante es japonés sin saberlo.
 */

const NOTIF_ICON: Record<string, IconName> = {
  invitation_received: 'dining',
  // OLA 3C: aviso nuevo del backend v2.29 (la plantilla existía y ninguna ruta
  // la usaba). Sin ícono propio caía en la campana genérica.
  friend_request_received: 'users',
  friend_added: 'users',
  transfer_received: 'arrow-down-left',
  transfer_sent: 'arrow-up-right',
  topup_succeeded: 'check-circle',
  topup_pending: 'store',
  mesa_shortfall_charged: 'lock',
  mesa_garantia_impagos: 'warning',
  payment_failed: 'x-circle',
};

export function AvisosScreen() {
  const { t } = useIdioma();
  const toast = useToast();
  const { session } = useAuth();
  const shortfallCapability = useShortfallDetailCapability();
  const [notifs, setNotifs] = useState<AppNotification[] | null>(null);
  // C-01: la lista se guarda YA DECODIFICADA. El tipo del contrato promete
  // campos que la red puede no traer, y confiar en esa promesa era lo que
  // dejaba entrar a mesas muertas (y reventaba la pantalla con una fila mala).
  const [invitations, setInvitations] = useState<InvitacionMostrable[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    api.getNotifications().then((r) => setNotifs(r.notifications)).catch(() => setNotifs([]));
    api
      .getPendingInvitations()
      .then((r) => setInvitations(invitacionesMostrables(r.invitations)))
      .catch(() => undefined);
  }
  useEffect(load, []);

  async function accept(inv: InvitacionMostrable) {
    setBusyId(inv.id);
    try {
      await api.acceptInvitation(inv.id);
      toast(t('Te sumaste a la mesa ✓'));
      // Sin código no se navega a ciegas: se recarga y la lista se corrige
      // sola. Sólo llega acá una fila `admite`, que en el contrato trae code.
      if (inv.mesaCode) navigate('mesa', inv.mesaCode);
      else load();
    } catch (err) {
      // v2.45.0 · la carrera entre el GET y el toque: la tarjeta vino viva y
      // la mesa murió en el medio. El 410 tiene copy propia (Diseño) — el
      // genérico diría "no pudimos" cuando lo que pasó es "ya no hay dónde".
      const { status } = extractApiError(err);
      toast(status === 410 ? t('Esta mesa ya cerró.') : t('No pudimos aceptar la invitación'));
      load();
    } finally {
      setBusyId(null);
    }
  }

  async function markAll() {
    try {
      await api.markAllNotificationsRead();
      load();
    } catch {
      toast(t('No se pudo marcar como leído'));
    }
  }

  const hasUnread = notifs?.some((n) => !n.read_at) ?? false;

  return (
    <div className="screen has-appbar">
      <AppHeaderBack userName={fullName(session) ?? undefined} onBack={() => goBack('home')} bellHere />
      <div className="title-card">
        <h1 className="title-card-title">{t('Notificaciones')}</h1>
      </div>
      <div className="scroll flow-scroll">
        {invitations.length > 0 && (
          <>
            <h2 className="sectlabel">{t('Te invitaron')}</h2>
            {invitations.map((inv) => (
              /**
               * v2.45.0 · el listado MARCA, no filtra: `mesa_joinable` lo
               * computa el emisor con el mismo predicado que gatea el accept.
               * La tarjeta de mesa muerta se muestra APAGADA en vez de
               * desaparecer (una invitación que se esfuma parece bug) y en
               * vez de invitar a un camino muerto.
               *
               * C-01 · el estado lo decide el decoder, no una comparación
               * suelta: **sólo `admite` deja el botón**. Ausente, null,
               * string o forma rara caen en `desconocida`, que apaga la
               * tarjeta igual pero con copy distinta — no sabemos que cerró.
               */
              <div key={inv.id} className={`inv-card${inv.admision !== 'admite' ? ' inv-card--cerrada' : ''}`}>
                <div className="inv-head">
                  {/* G-31: genérico a propósito. El contrato no manda la
                      categoría del restaurante, y el `sushi` que había acá
                      afirmaba una cocina que nadie nos dijo. `store` —un local—
                      y no `dining`: a 26px los dos círculos concéntricos de
                      `dining` se leen como una diana, no como un plato. El
                      ícono de la fila de notificación sigue siendo `dining`
                      porque ahí habla del EVENTO; acá habla del restaurante. */}
                  <Icon name="store" size={26} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* DOS líneas, nunca una sola larga: con nombres reales,
                        "Sofía te invitó a Hanzo Sushi" se parte donde cae.
                        C-01: cada dato puede faltar sin llevarse la fila —
                        una invitación a medias se muestra genérica, no se
                        pinta "undefined te invitó a undefined". */}
                    <div className="inv-l1">
                      {inv.invitador ? t('{0} te invitó a', inv.invitador) : t('Te invitaron a una mesa')}
                    </div>
                    {inv.restaurante && <div className="inv-l2">{inv.restaurante}</div>}
                    {metaInvitacion(inv, (iso) => relTime(iso, undefined, t), t) && (
                      <div className="inv-meta">{metaInvitacion(inv, (iso) => relTime(iso, undefined, t), t)}</div>
                    )}
                  </div>
                </div>
                {/* Navy y no naranja: el naranja se evaluó como quinta excepción
                    de la lista cerrada y se RECHAZÓ, porque esta pantalla
                    muestra la barra con su círculo naranja y serían dos
                    naranjas compitiendo. Navy da 16.36:1.
                    A la derecha y del ancho de su texto, como el esquema del
                    spec: a ancho completo pesaba más que el nombre del
                    restaurante, que es el dato que la persona vino a leer. */}
                <div className="inv-cta">
                  {inv.admision !== 'admite' ? (
                    /* Sin botón: no se ofrece entrar a donde ya no se puede —
                       ni a donde no sabemos si se puede. La copy distingue
                       las dos cosas (`copyAdmision`): "ya cerró" sólo cuando
                       el emisor lo dijo; si el dato no vino, lo honesto es
                       decir que no pudimos verificar. */
                    <span className="inv-cerrada-copy">{copyAdmision(inv.admision)}</span>
                  ) : (
                    <button
                      className="btn btn-navy btn-fit"
                      onClick={() => accept(inv)}
                      disabled={busyId === inv.id}
                    >
                      {busyId === inv.id ? t('Sumándote…') : t('Sumarme')}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </>
        )}

        {notifs === null && <div className="loading">{t('Cargando avisos…')}</div>}
        {notifs?.length === 0 && invitations.length === 0 && (
          <div className="empty aviso-empty">
            <div className="emoji"><Icon name="bell" size={40} /></div>
            {t('No tienes avisos.')}
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {notifs?.map((n) => {
            const sinLeer = !n.read_at;
            const shortfallDisclosure = readShortfallNotificationDisclosure(n);
            const inviterName = n.type === 'invitation_received' && typeof n.payload?.inviter_name === 'string'
              ? n.payload.inviter_name.trim()
              : '';
            const invitationSuffix = inviterName && n.body.startsWith(`${inviterName} `)
              ? n.body.slice(inviterName.length)
              : null;
            return (
              <div
                key={n.id}
                className={`card card-p aviso-row${n.type === 'mesa_shortfall_charged' || n.type === 'mesa_garantia_impagos' ? ' aviso-row--guarantee' : ''}`}
              >
                <div className="aviso-row-main">
                  <span
                    className={`aviso-dot ${sinLeer ? '' : 'off'}`}
                    aria-hidden={sinLeer ? undefined : 'true'}
                    aria-label={sinLeer ? t('Sin leer') : undefined}
                    role={sinLeer ? 'img' : undefined}
                  />
                  <Icon name={NOTIF_ICON[n.type] ?? 'bell'} size={18} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className={`aviso-title ${sinLeer ? 'unread' : ''}`}>
                      {invitationSuffix !== null ? (
                        <><strong>{inviterName}</strong>{invitationSuffix}</>
                      ) : n.body}
                    </div>
                    <div className="aviso-time">{relTime(n.created_at, undefined, t)}</div>
                  </div>
                </div>
                {shortfallCapability.enabled && session && shortfallDisclosure && (
                  <ShortfallDisclosure session={session} disclosure={shortfallDisclosure} />
                )}
              </div>
            );
          })}
        </div>
        {hasUnread && (
          <div className="avisos-actions">
            <button type="button" className="linkbtn" onClick={markAll}>
              {t('Marcar leídos')}
            </button>
          </div>
        )}
      </div>
      {/* Ningún ítem activo: ninguna de las cinco posiciones es "Avisos". */}
      <AppBottomBar active={null} />
    </div>
  );
}
