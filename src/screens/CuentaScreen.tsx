import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useWalletRail } from '../api/walletRail';
import { accountRailView } from '../api/releaseGates';
import type { BalanceResponse, HistoryEntry, StatsResponse, WalletTransaction } from '../api/types';
import { AppBottomBar } from '../components/AppBottomBar';
import { CardsPanel } from '../components/CardsPanel';
import { Icon } from '../components/Icon';
import { TopBar } from '../components/ui';
import { navigate } from '../router';
import { formatMXN } from '../utils/format';
import { walletTxIcon, walletTxLabel } from '../utils/labels';

/**
 * `s-account` — la Cuenta VIEJA.
 *
 * §1.11 la absorbió: sus contenidos son ahora tres pantallas de primer nivel
 * —`#/tarjetas`, `#/pagos`, `#/estadisticas`— que lanzan las pestañas de
 * Inicio. Este archivo queda porque **sigue siendo alcanzable** desde la barra
 * vieja (Amigos, Grupos, Perfil) y desde una fila de Perfil, que son pantallas
 * que §1.9 todavía no convirtió. Cuando lo haga, se retira entero.
 *
 * Lo que era su pestaña "Tarjetas" ya no vive acá: monta `CardsPanel`, el
 * mismo componente que usa `TarjetasScreen`. **Una sola copia de la máquina de
 * alta de tarjeta** — dos serían dos formas de crear una tarjeta de más.
 *
 * Lo demás que le queda son los dos bloques del riel de saldo, gateados por la
 * capability del backend y por lo tanto sin UI. No se borran.
 */

function txDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const diffDays = Math.floor((today.getTime() - d.getTime()) / (24 * 60 * 60_000));
  if (diffDays === 0) return 'Hoy';
  if (diffDays === 1) return 'Ayer';
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
}

/**
 * Torta de gastos por categoría (T-F1, feedback del hermano): computada en el
 * front desde GET /account/history (cada pago trae `category` — sin pedirle
 * nada nuevo al backend). Las categorías son las del contrato; "bar" no
 * existe hoy en el enum del backend (anotado con Mati).
 */
const CAT_LABEL: Record<string, string> = {
  italian: 'Italiana',
  japanese: 'Japonesa',
  mexican: 'Mexicana',
  cafe: 'Café',
  bar: 'Bar',
  other: 'Otros',
};
const CAT_COLORS = ['var(--navy)', 'var(--teal)', 'var(--orange)', '#8FA6C0', '#C9D4E3'];

function CategoryPie({ slices }: { slices: Array<[string, number]> }) {
  const total = slices.reduce((s, [, v]) => s + v, 0);
  if (total <= 0) return null;
  // Donut por stroke-dasharray sobre circunferencia normalizada a 100.
  const R = 15.9155;
  let offset = 25; // arranca a las 12
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 12 }}>
      <svg width="96" height="96" viewBox="0 0 42 42" aria-hidden="true" style={{ flexShrink: 0 }}>
        {slices.map(([cat, v], i) => {
          const pct = (v / total) * 100;
          const el = (
            <circle
              key={cat}
              cx="21"
              cy="21"
              r={R}
              fill="none"
              stroke={CAT_COLORS[i % CAT_COLORS.length]}
              strokeWidth="7"
              strokeDasharray={`${pct} ${100 - pct}`}
              strokeDashoffset={offset}
            />
          );
          offset -= pct;
          return el;
        })}
      </svg>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
        {slices.map(([cat, v], i) => (
          <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{ width: 10, height: 10, borderRadius: 3, background: CAT_COLORS[i % CAT_COLORS.length], flexShrink: 0 }}
              aria-hidden="true"
            />
            <span style={{ flex: 1, fontSize: 'var(--fs-legacy-sm)', fontFamily: 'var(--font-body)' }}>
              {CAT_LABEL[cat] ?? 'Otros'}
            </span>
            <span style={{ fontSize: 'var(--fs-legacy-sm)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
              {formatMXN(v)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function CuentaScreen() {
  // OLA 5D · las DOS decisiones vienen del backend y por campos SEPARADOS:
  // el riel saldo y la actividad de cuenta card-only no comparten variable.
  const { walletRailEnabled, accountActivity } = useWalletRail();
  const accountView = accountRailView(walletRailEnabled, accountActivity);
  /**
   * La capability llega DESPUÉS del primer render, así que la pestaña no puede
   * quedar congelada en lo que valía al montar: si el backend declarara
   * `account_activity: false`, el estado seguiría en 'historial', el panel de
   * historial estaría gateado y el de tarjetas pediría `tab === 'tarjetas'` —
   * pantalla en blanco, con las dos secciones apagadas a la vez.
   *
   * Es la lección 9 del ciclo en chiquito: un gate correcto crea un estado que
   * la UI no sabía representar. Se resuelve DERIVANDO la pestaña efectiva en vez
   * de recordarla, así el caso no depende de que alguien se acuerde de resetear.
   */
  const [tabElegida, setTab] = useState<'historial' | 'tarjetas'>('historial');
  const tab = accountView.showAccountActivity ? tabElegida : 'tarjetas';
  const [balance, setBalance] = useState<BalanceResponse | null>(null);
  const [txs, setTxs] = useState<WalletTransaction[] | null>(null);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  // Gastos del mes por categoría, ordenados de mayor a menor (para la torta).
  // Mes en UTC: espeja el date_trunc('month', NOW()) del backend (server en
  // UTC) para que la torta cierre contra el "gastado" de stats de al lado.
  const monthCats = useMemo(() => {
    const now = new Date();
    const sums = new Map<string, number>();
    for (const h of history) {
      const d = new Date(h.date);
      if (d.getUTCMonth() !== now.getUTCMonth() || d.getUTCFullYear() !== now.getUTCFullYear()) continue;
      sums.set(h.category, (sums.get(h.category) ?? 0) + h.amount_cents);
    }
    return [...sums.entries()].sort((a, b) => b[1] - a[1]);
  }, [history]);

  /**
   * ⚠️ UN EFECTO POR CAPABILITY, CON SU DEPENDENCIA. Ver el docblock gemelo en
   * `HomeScreen`: las dos capabilities llegan DESPUÉS del primer render, así que
   * un efecto `[]` las lee cuando todavía valen su default y nunca las vuelve a
   * mirar. Con el riel encendido por el backend, el saldo quedaba en "…" y los
   * movimientos vacíos para siempre.
   *
   * Y van SEPARADAS entre sí por la misma razón que en `accountRailView`: si
   * compartieran efecto, un cambio en una re-pediría los datos de la otra, y
   * volverían a estar acopladas por la puerta de atrás.
   */
  useEffect(() => {
    if (!walletRailEnabled) return;
    let alive = true;
    api.getBalance().then((b) => alive && setBalance(b)).catch(() => undefined);
    api.getWalletTransactions().then((r) => alive && setTxs(r.transactions)).catch(() => alive && setTxs([]));
    return () => {
      alive = false;
    };
  }, [walletRailEnabled]);

  useEffect(() => {
    if (!accountView.showAccountActivity) return;
    let alive = true;
    api.getStats().then((s) => alive && setStats(s)).catch(() => undefined);
    // El mes COMPLETO para la torta: sin params el backend da solo la primera
    // página (20) y con >20 pagos los montos no cerrarían contra stats.
    const now = new Date();
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    api.getHistory({ from, limit: 100 }).then((r) => alive && setHistory(r.history)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [accountView.showAccountActivity]);

  return (
    // T-F1: Cuenta es pestaña de la nav — sin flecha atrás, con aire para la barra.
    <div className="screen has-appbar">
      <TopBar title="Mi Cuenta" />
      {/* Longhands: el shorthand inline pisa el `padding-bottom` de
          `.has-appbar .scroll` y la última fila queda debajo de la barra. */}
      <div className="scroll" style={{ paddingTop: 16, paddingLeft: 16, paddingRight: 16 }}>
        {accountView.showBalance && <div style={{ background: 'linear-gradient(135deg,#071A33,#10264A)', borderRadius: 18, padding: '16px 18px 14px', marginBottom: 16 }}>
          {/* G-03 RESUELTO (v2.21): el monto grande es el DISPONIBLE real
              (balance − retenido, computado por el backend). */}
          <div style={{ fontSize: 'var(--fs-legacy-2xs)', color: 'rgba(255,255,255,0.7)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1.3, fontWeight: 700 }}>
            Disponible
          </div>
          <div style={{ fontSize: 'var(--fs-legacy-2xl)', fontWeight: 800, color: '#fff', lineHeight: 1 }}>
            {balance ? formatMXN(balance.available_cents) : '…'}
          </div>
          {balance && balance.held_balance_cents > 0 && (
            <div style={{ fontSize: 'var(--fs-legacy-sm)', color: 'rgba(255,255,255,0.75)', marginTop: 7, fontFamily: 'var(--font-body)' }}>
              <Icon name="lock" size={14} className="ico-inline" /> Retenido en garantías:{' '}
              {formatMXN(balance.held_balance_cents)}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
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
        </div>}

        {accountView.showAccountActivity && <div className="tabs">
          <button className={`tab ${tab === 'historial' ? 'on' : ''}`} onClick={() => setTab('historial')}>
            Historial
          </button>
          <button className={`tab ${tab === 'tarjetas' ? 'on' : ''}`} onClick={() => setTab('tarjetas')}>
            Tarjetas
          </button>
        </div>}

        {accountView.showAccountActivity && tab === 'historial' && (
          <>
            {stats && stats.month.visits > 0 && (
              <div className="card card-p" style={{ marginBottom: 14 }}>
                <div className="sectlabel">Este mes</div>
                <div style={{ display: 'flex', gap: 8, textAlign: 'center' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 'var(--fs-legacy-lg)', fontWeight: 800 }}>{formatMXN(stats.month.spent_cents)}</div>
                    <div className="caption">gastado</div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 'var(--fs-legacy-lg)', fontWeight: 800 }}>{stats.month.visits}</div>
                    <div className="caption">salidas</div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 'var(--fs-legacy-lg)', fontWeight: 800 }}>{formatMXN(stats.month.avg_per_visit_cents)}</div>
                    <div className="caption">promedio</div>
                  </div>
                </div>
                <CategoryPie slices={monthCats} />
                {stats.top_restaurants[0] && (
                  <div className="caption" style={{ marginTop: 10, textAlign: 'center' }}>
                    Tu favorito: <b style={{ color: 'var(--navy)' }}>{stats.top_restaurants[0].name}</b> ({stats.top_restaurants[0].visits} visitas)
                  </div>
                )}
              </div>
            )}
            {/* N-10: los pagos propios salen de GET /account/history (card-only) y
                se muestran SIEMPRE. La lista de wallet_transactions de abajo es
                riel saldo y sigue su flag. Sin el riel, esta es la única lista,
                así que el historial de la cuenta no desaparece del build real. */}
            {!accountView.showWalletMovements && (
              <>
                <div className="sectlabel">Mis pagos</div>
                {history.length === 0 && (
                  <div className="empty">
                    <div className="emoji"><Icon name="receipt" size={40} /></div>
                    Todavía no pagaste ninguna mesa.
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
                  {history.map((h) => (
                    <div key={h.id} className="card card-p" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ color: 'var(--gray-txt)' }} aria-hidden="true">
                        <Icon name="receipt" size={20} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 'var(--fs-legacy-base)' }}>{h.restaurant}</div>
                        <div className="caption">
                          {txDate(h.date)} · Mesa {h.mesa_code}
                        </div>
                      </div>
                      <div style={{ fontWeight: 700, fontSize: 'var(--fs-legacy-base)' }}>
                        {formatMXN(h.amount_cents)}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
            {accountView.showWalletMovements && (
              <>
            <div className="sectlabel">Movimientos</div>
            {txs === null && <div className="loading">Cargando movimientos…</div>}
            {txs?.length === 0 && (
              <div className="empty">
                <div className="emoji"><Icon name="receipt" size={40} /></div>
                Todavía no hay movimientos.
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {txs?.map((t) => (
                <div key={t.id} className="card card-p" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ color: 'var(--gray-txt)' }} aria-hidden="true">
                    <Icon name={walletTxIcon(t.type)} size={20} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 'var(--fs-legacy-base)' }}>
                      {t.description ?? walletTxLabel(t.type)}
                    </div>
                    <div className="caption">
                      {txDate(t.date)} · {walletTxLabel(t.type)}
                    </div>
                  </div>
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: 'var(--fs-legacy-base)',
                      color: t.sign === 'credit' ? 'var(--green)' : 'var(--red)',
                    }}
                  >
                    {t.sign === 'credit' ? '+' : '−'}
                    {formatMXN(Math.abs(t.amount_cents))}
                  </div>
                </div>
              ))}
            </div>
              </>
            )}
          </>
        )}

        {tab === 'tarjetas' && (
          <>
            <div className="sectlabel">Tarjetas guardadas</div>
            <CardsPanel />
          </>
        )}
      </div>
      {/* §1.9 · paso 3 · la cuarta y última, con la que `showNav` queda vacío y
          `BottomNav` se muere.

          `active={null}` —o sea NINGUNA posición encendida— y es lo honesto:
          Cuenta no es una de las cinco. §1.11 la fusionó adentro de las pestañas
          de Inicio, así que no le queda posición propia, y encender otra diría
          que estás en una sección en la que no estás.

          Esta pantalla se retira entera en el paso 6. Hasta entonces sigue
          alcanzable, y una pantalla alcanzable necesita navegación. Sus dos
          gates del riel saldo no se tocan acá. */}
      <AppBottomBar active={null} />
    </div>
  );
}
