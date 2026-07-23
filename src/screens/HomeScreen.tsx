import { useEffect, useState } from 'react';
import { api, IS_DEMO } from '../api';
import type { OpenMesasResponse, PendingInvitation } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { navigate } from '../router';
import { displayName } from '../utils/identity';

/**
 * Home v2 (ratificado 2026-07-22): invitación, Cuenta SIN saldo (privacidad:
 * nadie ve tu plata por mirar la pantalla), Nueva Mesa, Mesas (abiertas +
 * historial) y la fila Amigos/Grupos/Perfil. Cargar/Transferir viven SOLO
 * dentro de Cuenta. Datos reales: GET /mesas/open (el saldo ya no se pide acá).
 */
export function HomeScreen() {
  const { session } = useAuth();
  const [openMesas, setOpenMesas] = useState<OpenMesasResponse | null>(null);
  const [unread, setUnread] = useState(0);
  const [invitation, setInvitation] = useState<PendingInvitation | null>(null);

  useEffect(() => {
    let alive = true;
    api.getOpenMesas().then((m) => alive && setOpenMesas(m)).catch(() => undefined);
    api.getUnreadCount().then((r) => alive && setUnread(r.unread_count)).catch(() => undefined);
    api
      .getPendingInvitations()
      .then((r) => alive && setInvitation(r.invitations[0] ?? null))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // G-02: tras un login real no hay `user`; displayName cae al email tipeado.
  const firstName = displayName(session);
  const mesasCount = openMesas?.mesas.length ?? null;
  const hasOpen = (mesasCount ?? 0) > 0;

  return (
    <div className="screen">
      <div className="top-hero" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="logo">
            Pay<span className="t">Me</span>
          </div>
          <div className="hero-sub">{firstName ? `Hola, ${firstName} 👋` : 'Hola 👋'}</div>
        </div>
        <button
          onClick={() => navigate('avisos')}
          aria-label={unread > 0 ? `Avisos: ${unread} sin leer` : 'Avisos'}
          style={{ position: 'relative', background: 'rgba(255,255,255,0.12)', border: 'none', borderRadius: '50%', width: 42, height: 42, fontSize: 19, cursor: 'pointer' }}
        >
          🔔
          {unread > 0 && (
            <span
              style={{ position: 'absolute', top: -4, right: -4, background: 'var(--orange)', color: '#fff', fontSize: 11, fontWeight: 700, borderRadius: 10, minWidth: 19, height: 19, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px', fontFamily: 'var(--font-body)' }}
            >
              {unread}
            </span>
          )}
        </button>
      </div>
      <div className="scroll" style={{ padding: '18px 16px' }}>
        {invitation && (
          <button
            className="home-card"
            onClick={() => navigate('avisos')}
            style={{ background: 'var(--teal-l)', border: '1.5px solid var(--teal)' }}
          >
            <div className="home-card-icon" style={{ background: '#fff' }} aria-hidden="true">
              🍣
            </div>
            <div>
              <div className="home-card-title">
                {invitation.inviter_first_name} te invitó a {invitation.restaurant_name}
              </div>
              <div className="home-card-sub" style={{ color: 'var(--gray-d)' }}>
                Mesa {invitation.mesa_code} · tocá para aceptar
              </div>
            </div>
          </button>
        )}
        {/* Tres cuadrados grandes: Nueva Mesa, Cuenta, Mesas (pedido de Mati). */}
        <div className="home-grid">
          <button
            className="home-tile"
            onClick={() => navigate('scan')}
            style={{ background: 'linear-gradient(135deg,var(--orange),#ff8a5c)' }}
          >
            <div className="home-card-icon" style={{ background: 'rgba(255,255,255,0.2)' }} aria-hidden="true">
              📷
            </div>
            <div className="home-card-title" style={{ color: '#fff' }}>
              Nueva Mesa
            </div>
          </button>

          {/* En modo demo (?demo=1) se saca del encuadre: sugiere wallet. */}
          {!IS_DEMO && (
            <button
              className="home-tile"
              onClick={() => navigate('cuenta')}
              style={{ background: 'linear-gradient(135deg,#071A33,#12264A)' }}
            >
              <div className="home-card-icon" style={{ background: 'rgba(0,194,203,0.15)' }} aria-hidden="true">
                💳
              </div>
              {/* Sin monto a propósito: el saldo no se muestra en el home
                  (cualquiera que mire la pantalla lo vería). Se ve adentro. */}
              <div className="home-card-title" style={{ color: '#fff' }}>
                Cuenta
              </div>
            </button>
          )}

          <button
            className="home-tile"
            onClick={() => navigate('mesas')}
            style={hasOpen ? { border: '1.5px solid var(--teal)', background: 'var(--teal-l)' } : undefined}
          >
            <div className="home-card-icon" style={{ background: 'var(--teal-l)' }} aria-hidden="true">
              🍽️
            </div>
            <div>
              <div className="home-card-title">Mesas</div>
              <div
                className="home-card-sub"
                style={hasOpen ? { color: 'var(--teal-txt)', fontWeight: 600 } : { color: 'var(--gray-d)' }}
              >
                {hasOpen ? (mesasCount === 1 ? '1 abierta' : `${mesasCount} abiertas`) : 'Historial'}
              </div>
            </div>
          </button>
        </div>

        {/* Abajo: la fila chica de siempre. */}
        <div className="home-grid">
          <button className="home-tile sm" onClick={() => navigate('amigos')}>
            <div className="home-card-icon" style={{ background: 'var(--teal-l)' }} aria-hidden="true">
              👥
            </div>
            <div className="home-card-title">Amigos</div>
          </button>

          <button className="home-tile sm" onClick={() => navigate('grupos')}>
            <div className="home-card-icon" style={{ background: 'var(--orange-l)' }} aria-hidden="true">
              👨‍👩‍👧
            </div>
            <div className="home-card-title">Grupos</div>
          </button>

          <button className="home-tile sm" onClick={() => navigate('perfil')}>
            <div className="home-card-icon" style={{ background: 'var(--gray-l)' }} aria-hidden="true">
              ⚙️
            </div>
            <div className="home-card-title">Perfil</div>
          </button>
        </div>
      </div>
    </div>
  );
}
