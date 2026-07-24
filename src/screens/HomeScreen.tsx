import { useEffect, useState } from 'react';
import { api, IS_DEMO } from '../api';
import type {
  BalanceResponse,
  OpenMesasResponse,
  PendingInvitation,
  WalletTransaction,
} from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/ui';
import { navigate } from '../router';
import { countdownTo, formatMXN } from '../utils/format';
import { displayName } from '../utils/identity';
import { walletTxIcon, walletTxLabel } from '../utils/labels';
import { Icon, type IconName } from '../components/Icon';

const CATEGORY_EMOJI: Record<string, IconName> = {
  italian: 'pasta',
  japanese: 'sushi',
  mexican: 'taco',
  cafe: 'coffee',
  other: 'dining',
};

function txDate(iso: string): string {
  const d = new Date(iso);
  const diffDays = Math.floor((Date.now() - d.getTime()) / (24 * 60 * 60_000));
  if (diffDays === 0) return 'Hoy';
  if (diffDays === 1) return 'Ayer';
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
}

/**
 * Home v3 (T-D3a, mock del hermano de Mati, ratificado 2026-07-23): header
 * claro, tarjeta de saldo con MONTO OCULTO + ojito (opción b: privacidad de
 * un vistazo, revelar es un tap), sección "Mesas abiertas" horizontal,
 * "Últimos movimientos", "+ Nueva Mesa" flotante y barra inferior (en App).
 * Los montos de los movimientos respetan el mismo ojito que el saldo.
 */
export function HomeScreen() {
  const { session } = useAuth();
  const toast = useToast();
  const [balance, setBalance] = useState<BalanceResponse | null>(null);
  const [showBalance, setShowBalance] = useState(false);
  const [openMesas, setOpenMesas] = useState<OpenMesasResponse | null>(null);
  const [txs, setTxs] = useState<WalletTransaction[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [invitation, setInvitation] = useState<PendingInvitation | null>(null);
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    let alive = true;
    api.getBalance().then((b) => alive && setBalance(b)).catch(() => undefined);
    api.getOpenMesas().then((m) => alive && setOpenMesas(m)).catch(() => undefined);
    api
      .getWalletTransactions()
      .then((r) => alive && setTxs(r.transactions.slice(0, 4)))
      .catch(() => alive && setTxs([]));
    api.getUnreadCount().then((r) => alive && setUnread(r.unread_count)).catch(() => undefined);
    api
      .getPendingInvitations()
      .then((r) => alive && setInvitation(r.invitations[0] ?? null))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  /**
   * R-04: el banner acepta DIRECTO y te deja adentro de la mesa.
   */
  async function acceptFromBanner() {
    if (!invitation || accepting) return;
    setAccepting(true);
    try {
      await api.acceptInvitation(invitation.id);
      toast('Te sumaste a la mesa ✓');
      navigate('mesa', invitation.mesa_code);
    } catch {
      toast('No pudimos aceptar la invitación');
      setAccepting(false);
    }
  }

  // G-02: tras un login real no hay `user`; displayName cae al email tipeado.
  const firstName = displayName(session);
  const mesas = openMesas?.mesas ?? [];
  const masked = '$ ••••';

  return (
    <div className="screen has-nav">
      <div className="home-head">
        <div className="logo-line">
          Pay<span className="t">Me</span>
        </div>
        <div className="hola">{firstName ? `Hola, ${firstName}!` : '¡Hola!'}</div>
        <button
          onClick={() => navigate('avisos')}
          aria-label={unread > 0 ? `Avisos: ${unread} sin leer` : 'Avisos'}
          style={{ position: 'relative', background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}
        >
          <Icon name="bell" size={21} />
          {unread > 0 && (
            <span
              style={{ position: 'absolute', top: -2, right: -4, background: 'var(--orange)', color: '#fff', fontSize: 'var(--fs-2xs)', fontWeight: 700, borderRadius: 10, minWidth: 17, height: 17, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px', fontFamily: 'var(--font-body)' }}
            >
              {unread}
            </span>
          )}
        </button>
      </div>

      <div className="scroll" style={{ padding: '14px 16px' }}>
        {/* T-F1 (feedback del hermano): botón "Aceptar" explícito a la derecha
            en vez del banner-que-acepta-al-tocar — evita aceptar sin querer. */}
        {invitation && (
          <div
            className="home-card static"
            style={{ background: 'var(--teal-l)', border: '1.5px solid var(--teal)' }}
          >
            <div className="home-card-icon" style={{ background: '#fff' }} aria-hidden="true">
              <Icon name="sushi" size={22} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="home-card-title">
                {invitation.inviter_first_name} te invitó a {invitation.restaurant_name}
              </div>
              <div className="home-card-sub" style={{ color: 'var(--gray-d)' }}>
                Mesa {invitation.mesa_code}
              </div>
            </div>
            <button
              className="btn btn-teal btn-sm btn-fit"
              onClick={() => void acceptFromBanner()}
              disabled={accepting}
              aria-label={`Aceptar invitación a ${invitation.restaurant_name}`}
            >
              {accepting ? 'Sumando…' : 'Aceptar'}
            </button>
          </div>
        )}

        {/* En modo demo (?demo=1) se saca del encuadre: sugiere wallet. */}
        {!IS_DEMO && (
          <div className="saldo-card">
            <div className="lbl">Tu saldo PayMe</div>
            <div className="saldo-row">
              {/* G-03 (v2.21): tras el ojito se muestra el DISPONIBLE real. */}
              <div className="saldo-amt">
                {showBalance ? (balance ? formatMXN(balance.available_cents) : '…') : masked}
              </div>
              <button
                className="eye-btn"
                onClick={() => setShowBalance((v) => !v)}
                aria-label={showBalance ? 'Ocultar saldo' : 'Mostrar saldo'}
                aria-pressed={showBalance}
              >
                <Icon name={showBalance ? 'eye-off' : 'eye'} size={18} className="ico-inline" />
              </button>
              <button className="saldo-arrow" onClick={() => navigate('cuenta')} aria-label="Ir a Cuenta">
                →
              </button>
            </div>
            <div className="saldo-actions">
              <button className="btn btn-teal btn-sm" onClick={() => navigate('cargar')}>
                <Icon name="plus" size={16} className="ico-inline" /> Cargar
              </button>
              <button
                className="btn btn-sm"
                style={{ background: 'rgba(255,255,255,0.18)', color: '#fff' }}
                onClick={() => navigate('transferir')}
              >
                <Icon name="arrow-up-right" size={16} className="ico-inline" /> Transferir
              </button>
            </div>
          </div>
        )}

        {mesas.length > 0 && (
          <>
            <div className="sect-row">
              <div className="sect-title">Mesas abiertas ({mesas.length})</div>
              <button className="vermas" onClick={() => navigate('mesas')}>
                Ver más
              </button>
            </div>
            <div className="hscroll">
              {mesas.map((m) => {
                const cd = countdownTo(m.expires_at);
                return (
                  <button
                    key={m.id}
                    className="event-card open"
                    style={{ background: 'var(--teal-l)', border: '1.5px solid var(--teal)' }}
                    onClick={() => navigate('mesa', m.code)}
                  >
                    <div className="event-icon" aria-hidden="true">
                      <Icon name={CATEGORY_EMOJI[m.restaurant.category] ?? 'dining'} size={22} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="event-name">{m.restaurant.name}</div>
                      <div className="event-meta">Mesa {m.code}</div>
                      <div className="caption" style={{ marginTop: 4 }}>
                        {formatMXN(m.paid_amount_cents)} de {formatMXN(m.total_cents)}
                        {cd ? (
                          <>
                            {' · '}
                            <Icon name="clock" size={14} className="ico-inline" /> {cd}
                          </>
                        ) : null}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {txs && txs.length > 0 && (
          <>
            <div className="sect-row">
              <div className="sect-title">Últimos movimientos</div>
              <button className="vermas" onClick={() => navigate('cuenta')}>
                Ver más
              </button>
            </div>
            <div className="card" style={{ padding: '2px 16px' }}>
              {txs.map((t, idx) => (
                <div
                  key={t.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '11px 0',
                    borderBottom: idx < txs.length - 1 ? '1px solid var(--gray-l)' : 'none',
                  }}
                >
                  <span style={{ color: 'var(--gray-txt)' }} aria-hidden="true">
                    <Icon name={walletTxIcon(t.type)} size={20} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 'var(--fs-base)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {t.description ?? walletTxLabel(t.type)}
                    </div>
                    <div className="caption">{txDate(t.date)}</div>
                  </div>
                  {/* El monto respeta el mismo ojito que el saldo. */}
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: 'var(--fs-base)',
                      fontVariantNumeric: 'tabular-nums',
                      color: showBalance ? (t.sign === 'credit' ? 'var(--green)' : 'var(--red)') : 'var(--gray-txt)',
                    }}
                  >
                    {showBalance
                      ? `${t.sign === 'credit' ? '+' : '−'}${formatMXN(Math.abs(t.amount_cents))}`
                      : masked}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <button className="fab" onClick={() => navigate('scan')}>
        <Icon name="plus" size={16} className="ico-inline" /> Nueva Mesa
      </button>
    </div>
  );
}
