import { useEffect, useMemo, useState } from 'react';
import { api, IS_MOCK } from '../api';
import type { HistoryEntry, OpenMesa } from '../api/types';
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

/** Una mesa del historial: pagos propios agrupados por mesa_code. */
interface HistoryMesa {
  mesa_code: string;
  restaurant: string;
  category: string;
  /** Suma de MIS pagos en esa mesa (centavos enteros). */
  amount_cents: number;
  /** Fecha del último pago (la que ordena la lista). */
  date: string;
}

/** GET /account/history trae un renglón POR PAGO; acá se agrupa por mesa. */
function groupByMesa(entries: HistoryEntry[]): HistoryMesa[] {
  const byCode = new Map<string, HistoryMesa>();
  for (const e of entries) {
    const prev = byCode.get(e.mesa_code);
    if (prev) {
      prev.amount_cents += e.amount_cents;
      if (e.date > prev.date) prev.date = e.date;
    } else {
      byCode.set(e.mesa_code, {
        mesa_code: e.mesa_code,
        restaurant: e.restaurant,
        category: e.category,
        amount_cents: e.amount_cents,
        date: e.date,
      });
    }
  }
  return [...byCode.values()].sort((a, b) => b.date.localeCompare(a.date));
}

function historyDate(iso: string): string {
  const d = new Date(iso);
  const diffDays = Math.floor((Date.now() - d.getTime()) / (24 * 60 * 60_000));
  if (diffDays === 0) return 'Hoy';
  if (diffDays === 1) return 'Ayer';
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
}

/**
 * Mesas v2 (ratificado 2026-07-22): las abiertas son transitorias (la garantía
 * captura el faltante al vencer), así que la pantalla vive del HISTORIAL.
 * Si hay una abierta, va arriba destacada en color; las pagadas, en una lista
 * minimalista (GET /account/history agrupado por mesa).
 */
export function MesasScreen() {
  const [mesas, setMesas] = useState<OpenMesa[] | null>(null);
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [, forceTick] = useState(0);

  useEffect(() => {
    let alive = true;
    api.getOpenMesas().then((r) => alive && setMesas(r.mesas)).catch(() => alive && setMesas([]));
    api.getHistory().then((r) => alive && setHistory(r.history)).catch(() => alive && setHistory([]));
    const tick = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => {
      alive = false;
      clearInterval(tick);
    };
  }, []);

  const pastMesas = useMemo(() => (history ? groupByMesa(history) : null), [history]);
  const loading = mesas === null || pastMesas === null;
  const empty = !loading && mesas.length === 0 && pastMesas.length === 0;

  return (
    <div className="screen">
      <TopBar
        title="Mesas"
        onBack={() => navigate('home')}
        right={
          mesas && mesas.length > 0 ? <span className="badge badge-teal">{mesas.length} abierta{mesas.length > 1 ? 's' : ''}</span> : undefined
        }
      />
      <div className="scroll" style={{ padding: 16 }}>
        {loading && <div className="loading">Cargando tus mesas…</div>}

        {empty && (
          <div className="empty">
            <div className="emoji">🍽️</div>
            Todavía no pagaste ninguna mesa.
            <div style={{ marginTop: 14 }}>
              <button className="btn btn-primary" onClick={() => navigate('scan')}>
                📷 Abrir una mesa
              </button>
            </div>
          </div>
        )}

        {/* ─── Abiertas ahora: destacadas en color ─── */}
        {mesas && mesas.length > 0 && (
          <>
            <div className="sectlabel">Abiertas ahora</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 18 }}>
              {mesas.map((m) => {
                const cd = countdownTo(m.expires_at);
                return (
                  <button
                    key={m.id}
                    className={`event-card ${m.status === 'partially_paid' ? 'partial' : 'open'}`}
                    style={{ background: 'var(--teal-l)', border: '1.5px solid var(--teal)' }}
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
                          style={{ maxWidth: 150, background: '#fff' }}
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
                      <div className="countdown">{cd ? `⏳ ${cd}` : '⌛ venció'}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {/* ─── Historial: lista minimalista, una línea por mesa ─── */}
        {pastMesas && pastMesas.length > 0 && (
          <>
            <div className="sectlabel">Historial</div>
            <div className="card" style={{ padding: '2px 16px' }}>
              {pastMesas.map((h, idx) => (
                <div
                  key={h.mesa_code}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '12px 0',
                    borderBottom: idx < pastMesas.length - 1 ? '1px solid var(--gray-l)' : 'none',
                  }}
                >
                  <span style={{ fontSize: 18 }} aria-hidden="true">
                    {CATEGORY_EMOJI[h.category] ?? '🍽️'}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{h.restaurant}</div>
                    <div className="caption">
                      {historyDate(h.date)} · Mesa {h.mesa_code}
                    </div>
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>
                    {formatMXN(h.amount_cents)}
                  </div>
                </div>
              ))}
            </div>
            <div className="caption" style={{ marginTop: 8, textAlign: 'center' }}>
              Lo que pagaste vos en cada mesa.
            </div>
          </>
        )}

        {IS_MOCK && (
          <div className="note note-amber" style={{ marginTop: 14 }}>
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
