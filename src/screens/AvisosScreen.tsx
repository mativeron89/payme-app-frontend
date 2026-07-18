import { useEffect, useState } from 'react';
import { api } from '../api';
import type { AppNotification, PendingInvitation } from '../api/types';
import { TopBar, useToast } from '../components/ui';
import { navigate } from '../router';

/**
 * Avisos: invitaciones in-app pendientes (GET /invitations + accept) arriba,
 * y el inbox de notificaciones (GET /notifications) abajo.
 */

const NOTIF_EMOJI: Record<string, string> = {
  invitation_received: '🍽️',
  transfer_received: '↘️',
  transfer_sent: '↗️',
  topup_succeeded: '✅',
  topup_pending: '🏪',
  mesa_shortfall_charged: '🔒',
  mesa_garantia_impagos: '⚠️',
  payment_failed: '❌',
};

function relTime(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'recién';
  if (mins < 60) return `hace ${mins} min`;
  const hs = Math.floor(mins / 60);
  if (hs < 24) return `hace ${hs} h`;
  const days = Math.floor(hs / 24);
  return days === 1 ? 'ayer' : `hace ${days} días`;
}

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
    <div className="screen">
      <TopBar
        title="Avisos"
        onBack={() => navigate('home')}
        right={
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
                  <div style={{ fontSize: 26 }}>🍣</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>
                      {inv.inviter_first_name} te invitó a {inv.restaurant_name}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--gray-d)', fontFamily: 'var(--font-body)' }}>
                      Mesa {inv.mesa_code} · {relTime(inv.created_at)}
                    </div>
                  </div>
                </div>
                <button
                  className="btn btn-primary"
                  style={{ padding: 12, fontSize: 14 }}
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
          <div className="empty">
            <div className="emoji">🔔</div>
            Nada nuevo por acá.
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {notifs?.map((n) => (
            <div
              key={n.id}
              className="card card-p"
              style={{ display: 'flex', gap: 12, alignItems: 'flex-start', opacity: n.read_at ? 0.65 : 1 }}
            >
              <div style={{ fontSize: 18 }}>{NOTIF_EMOJI[n.type] ?? '🔔'}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: n.read_at ? 500 : 700, fontFamily: 'var(--font-body)', color: 'var(--navy)' }}>
                  {n.body}
                </div>
                <div style={{ fontSize: 11, color: 'var(--gray-d)', marginTop: 2, fontFamily: 'var(--font-body)' }}>
                  {relTime(n.created_at)}
                </div>
              </div>
              {!n.read_at && (
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--orange)', marginTop: 6, flexShrink: 0 }} />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
