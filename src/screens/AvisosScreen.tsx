import { useEffect, useState } from 'react';
import { api } from '../api';
import type { AppNotification, PendingInvitation } from '../api/types';
import { AppBottomBar } from '../components/AppBottomBar';
import { AppHeaderBack } from '../components/AppHeader';
import { Icon, type IconName } from '../components/Icon';
import { useToast } from '../components/ui';
import { goBack, navigate } from '../router';
import { relTime } from '../utils/format';

/**
 * Avisos: invitaciones in-app pendientes (GET /invitations + accept) arriba,
 * y el inbox de notificaciones (GET /notifications) abajo.
 *
 * SPEC_APP.md §1.8, aplicado:
 *
 *  - **No leído = punto `--action-2` de 8px a la izquierda Y peso 700.** Antes
 *    el punto era naranja y estaba a la derecha, y el naranja está reservado
 *    (SISTEMA_DISENO.md §1). Dos señales, no una: el punto solo no alcanza.
 *  - **El leído ya no se atenúa con `opacity` sobre la fila entera.** Bajar la
 *    opacidad del contenedor arrastra el texto por debajo del mínimo de
 *    contraste — es el mismo defecto que el spec da por corregido en Mis ítems
 *    (§1.5) y acá seguía vivo. La diferencia la marcan el peso y el punto.
 *  - **Vacío real sin borde**, con la copy del spec.
 *  - Cabecera de subpantalla y barra de cinco posiciones **sin ítem activo**:
 *    ninguna de las cinco representa "estoy en Avisos" (§1.3 lo dice de esta
 *    pantalla por su nombre).
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
  const toast = useToast();
  const [notifs, setNotifs] = useState<AppNotification[] | null>(null);
  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    api.getNotifications().then((r) => setNotifs(r.notifications)).catch(() => setNotifs([]));
    api.getPendingInvitations().then((r) => setInvitations(r.invitations)).catch(() => undefined);
  }
  useEffect(load, []);

  async function accept(inv: PendingInvitation) {
    setBusyId(inv.id);
    try {
      await api.acceptInvitation(inv.id);
      toast('Te sumaste a la mesa ✓');
      navigate('mesa', inv.mesa_code);
    } catch {
      toast('No pudimos aceptar la invitación');
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
      toast('No se pudo marcar como leído');
    }
  }

  const hasUnread = notifs?.some((n) => !n.read_at) ?? false;

  return (
    <div className="screen has-appbar">
      <AppHeaderBack
        title="Avisos"
        onBack={() => goBack('home')}
        step={
          hasUnread ? (
            <button className="login-toggle" style={{ padding: 4 }} onClick={markAll}>
              Marcar leídos
            </button>
          ) : undefined
        }
      />
      <div className="scroll" style={{ padding: '14px 16px' }}>
        {invitations.length > 0 && (
          <>
            <div className="sectlabel">Te invitaron</div>
            {invitations.map((inv) => (
              <div key={inv.id} className="card card-p" style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                  <Icon name="sushi" size={26} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 'var(--fs-legacy-base)', fontWeight: 700 }}>
                      {inv.inviter_first_name} te invitó a {inv.restaurant_name}
                    </div>
                    <div className="caption">
                      Mesa {inv.mesa_code} · {relTime(inv.created_at)}
                    </div>
                  </div>
                </div>
                {/* Era `btn-primary`: naranja con texto blanco, 2.84:1. El
                    naranja además está reservado y este botón no es ninguno de
                    sus cuatro usos. Navy da 16.36:1. Corregir contraste sí se
                    puede hoy en cualquier pantalla — no es rediseño (§3). */}
                <button
                  className="btn btn-navy"
                  style={{ padding: 12, fontSize: 'var(--fs-legacy-base)' }}
                  onClick={() => accept(inv)}
                  disabled={busyId === inv.id}
                >
                  {busyId === inv.id ? 'Sumándote…' : 'Aceptar y ver la mesa →'}
                </button>
              </div>
            ))}
          </>
        )}

        <div className="sectlabel">Notificaciones</div>
        {notifs === null && <div className="loading">Cargando avisos…</div>}
        {notifs?.length === 0 && invitations.length === 0 && (
          <div className="empty aviso-empty">
            <div className="emoji"><Icon name="bell" size={40} /></div>
            No tenés avisos.
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {notifs?.map((n) => {
            const sinLeer = !n.read_at;
            return (
              <div key={n.id} className="card card-p aviso-row">
                <span
                  className={`aviso-dot ${sinLeer ? '' : 'off'}`}
                  aria-hidden={sinLeer ? undefined : 'true'}
                  aria-label={sinLeer ? 'Sin leer' : undefined}
                  role={sinLeer ? 'img' : undefined}
                />
                <Icon name={NOTIF_ICON[n.type] ?? 'bell'} size={18} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className={`aviso-title ${sinLeer ? 'unread' : ''}`}>{n.body}</div>
                  <div className="aviso-time">{relTime(n.created_at)}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {/* Ningún ítem activo: ninguna de las cinco posiciones es "Avisos". */}
      <AppBottomBar active={null} />
    </div>
  );
}
