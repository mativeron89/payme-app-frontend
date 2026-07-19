import { useEffect, useState } from 'react';
import { api, IS_MOCK } from '../api';
import type { OpenMesa } from '../api/types';
import { navigate } from '../router';
import { countdownTo, formatMXN } from '../utils/format';
import { mesaStatusBadgeClass, mesaStatusLabel } from '../utils/labels';
import { TopBar } from '../components/ui';

const CATEGORY_EMOJI: Record<string, string> = {
  italian: '🍝',
  japanese: '🍣',
  mexican: '🌮',
  cafe: '☕',
  other: '🍽️',
};

/** s-open: mesas abiertas del organizador (GET /mesas/open). */
export function MesasScreen() {
  const [mesas, setMesas] = useState<OpenMesa[] | null>(null);
  const [, forceTick] = useState(0);

  useEffect(() => {
    let alive = true;
    api.getOpenMesas().then((r) => alive && setMesas(r.mesas)).catch(() => alive && setMesas([]));
    const tick = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => {
      alive = false;
      clearInterval(tick);
    };
  }, []);

  return (
    <div className="screen">
      <TopBar
        title="Mesas Abiertas"
        onBack={() => navigate('home')}
        right={mesas ? <span className="badge badge-gray">{mesas.length}</span> : undefined}
      />
      <div className="scroll" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {mesas === null && <div className="loading">Cargando mesas…</div>}
        {mesas?.length === 0 && (
          <div className="empty">
            <div className="emoji">🍽️</div>
            No tenés mesas activas.
            <div style={{ marginTop: 14 }}>
              <button className="btn btn-primary" onClick={() => navigate('scan')}>
                📷 Abrir una mesa
              </button>
            </div>
          </div>
        )}
        {mesas?.map((m) => {
          const cd = countdownTo(m.expires_at);
          return (
            <button
              key={m.id}
              className={`event-card ${m.status === 'partially_paid' ? 'partial' : 'open'}`}
              onClick={() => navigate('mesa', m.code)}
            >
              <div className="event-icon" aria-hidden="true">
                {CATEGORY_EMOJI[m.restaurant.category] ?? '🍽️'}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="event-name">{m.restaurant.name}</div>
                <div className="event-meta">Mesa {m.code}</div>
                <div style={{ marginTop: 8 }}>
                  <div
                    className="progress-bar"
                    style={{ maxWidth: 150 }}
                    role="progressbar"
                    aria-valuenow={m.pct_paid}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`Pagado ${m.pct_paid}% de la mesa`}
                  >
                    <div
                      className="progress-fill"
                      style={{
                        width: `${m.pct_paid}%`,
                        background: m.status === 'partially_paid' ? 'var(--orange)' : 'var(--teal)',
                      }}
                    />
                  </div>
                  <div className="caption" style={{ marginTop: 4 }}>
                    {formatMXN(m.paid_amount_cents)} de {formatMXN(m.total_cents)} ·{' '}
                    <span className={mesaStatusBadgeClass(m.status)}>
                      {mesaStatusLabel(m.status)}
                    </span>
                  </div>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="event-amount">{formatMXN(m.total_cents)}</div>
                <div className="countdown">
                  {cd ? `⏳ ${cd}` : '⌛ venció'}
                </div>
              </div>
            </button>
          );
        })}
        {IS_MOCK && (
          <div className="note note-amber" style={{ marginTop: 4 }}>
            <b>Atajo de demo:</b> mirá cómo queda una mesa que venció sin que todos pagaran y la
            garantía cubrió el faltante.
            <button
              className="btn btn-ghost btn-sm"
              style={{ marginTop: 10 }}
              onClick={() => navigate('mesa', 'PA-1099')}
            >
              Ver mesa vencida (ejemplo) →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
