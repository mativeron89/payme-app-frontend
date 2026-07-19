import { useEffect, useState } from 'react';
import { api } from '../api';
import type { BalanceResponse, OpenMesasResponse, PendingInvitation } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { navigate } from '../router';
import { formatMXN } from '../utils/format';

/**
 * Home (maqueta s-home): saldo → Cuenta, Cargar/Transferir, Nueva Mesa,
 * Mesas Abiertas, y la fila Amigos/Grupos/Perfil.
 * Datos reales del contrato: GET /account/balance + GET /mesas/open.
 */
export function HomeScreen() {
  const { session } = useAuth();
  const [balance, setBalance] = useState<BalanceResponse | null>(null);
  const [openMesas, setOpenMesas] = useState<OpenMesasResponse | null>(null);
  const [unread, setUnread] = useState(0);
  const [invitation, setInvitation] = useState<PendingInvitation | null>(null);

  useEffect(() => {
    let alive = true;
    api.getBalance().then((b) => alive && setBalance(b)).catch(() => undefined);
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

  // G-02: tras un login real no hay user (solo tokens); saludo genérico.
  const firstName = session?.user?.first_name;
  const mesasCount = openMesas?.mesas.length ?? null;
  const mesasSub =
    mesasCount === null
      ? 'Cargando…'
      : mesasCount === 0
        ? 'No tenés mesas activas'
        : mesasCount === 1
          ? '1 esperando pago'
          : `${mesasCount} esperando pago`;

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
        <button
          className="home-card"
          onClick={() => navigate('cuenta')}
          style={{ background: 'linear-gradient(135deg,#071A33,#12264A)' }}
        >
          <div className="home-card-icon" style={{ background: 'rgba(0,194,203,0.15)' }} aria-hidden="true">
            💳
          </div>
          <div>
            <div className="home-card-title" style={{ color: '#fff' }}>
              Cuenta
            </div>
            <div className="home-card-sub" style={{ color: 'rgba(255,255,255,0.5)' }}>
              {balance ? `${formatMXN(balance.balance_cents)} · saldo y movimientos` : 'Cargando saldo…'}
            </div>
          </div>
        </button>

        <div className="home-row">
          <button className="home-card compact" onClick={() => navigate('cargar')} style={{ background: 'var(--teal)' }}>
            <div className="home-card-icon" style={{ background: 'rgba(255,255,255,0.25)' }} aria-hidden="true">
              ➕
            </div>
            <div className="home-card-title" style={{ color: '#fff', fontSize: 14 }}>
              Cargar
            </div>
          </button>
          <button
            className="home-card compact"
            onClick={() => navigate('transferir')}
            style={{ border: '1.5px solid var(--gray-l)' }}
          >
            <div className="home-card-icon" style={{ background: 'var(--orange-l)' }} aria-hidden="true">
              ↗️
            </div>
            <div className="home-card-title" style={{ fontSize: 14 }}>
              Transferir
            </div>
          </button>
        </div>

        <button
          className="home-card"
          onClick={() => navigate('scan')}
          style={{ background: 'linear-gradient(135deg,var(--orange),#ff8a5c)' }}
        >
          <div className="home-card-icon" style={{ background: 'rgba(255,255,255,0.2)' }} aria-hidden="true">
            📷
          </div>
          <div>
            <div className="home-card-title" style={{ color: '#fff' }}>
              Nueva Mesa (escanear)
            </div>
            <div className="home-card-sub" style={{ color: 'rgba(255,255,255,0.85)' }}>
              Escaneá el ticket y dividí
            </div>
          </div>
        </button>

        <button className="home-card" onClick={() => navigate('mesas')} style={{ border: '1.5px solid var(--gray-l)' }}>
          <div className="home-card-icon" style={{ background: 'var(--teal-l)' }} aria-hidden="true">
            🍽️
          </div>
          <div>
            <div className="home-card-title">Mesas Abiertas</div>
            <div className="home-card-sub" style={{ color: 'var(--gray-d)' }}>
              {mesasSub}
            </div>
          </div>
        </button>

        <div className="home-row" style={{ marginTop: 2 }}>
          <button className="home-card compact" onClick={() => navigate('amigos')} style={{ border: '1.5px solid var(--gray-l)' }}>
            <div className="home-card-icon" style={{ background: 'var(--teal-l)' }} aria-hidden="true">
              👥
            </div>
            <div className="home-card-title" style={{ fontSize: 13 }}>
              Amigos
            </div>
          </button>
          <button className="home-card compact" onClick={() => navigate('grupos')} style={{ border: '1.5px solid var(--gray-l)' }}>
            <div className="home-card-icon" style={{ background: 'var(--orange-l)' }} aria-hidden="true">
              👨‍👩‍👧
            </div>
            <div className="home-card-title" style={{ fontSize: 13 }}>
              Grupos
            </div>
          </button>
          <button className="home-card compact" onClick={() => navigate('perfil')} style={{ border: '1.5px solid var(--gray-l)' }}>
            <div className="home-card-icon" style={{ background: 'var(--gray-l)' }} aria-hidden="true">
              ⚙️
            </div>
            <div className="home-card-title" style={{ fontSize: 13 }}>
              Perfil
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
