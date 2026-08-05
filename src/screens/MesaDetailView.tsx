import type { ReactNode } from 'react';
import { Icon } from '../components/Icon';
import { InviteFriends } from '../components/InviteFriends';
import { TopLogo } from '../components/ui';
import type { MesaDetail } from '../api/types';
import { countdownTo, formatMXN } from '../utils/format';
import {
  FRACTIONS,
  availableSlotsOf,
  bpsLabel,
  fractionPreview,
  nothingLeftFor,
} from './mesaItemsView';

/**
 * Detalle de la mesa y selección de consumos — `s-myitems`, SPEC_APP.md §1.5.
 *
 * ## Por qué vive en su propio archivo
 *
 * `MesaScreen.tsx` tenía 1917 líneas y mezclaba DOS cosas con permisos
 * distintos: esta pantalla, que §1.5 rediseña y es prioridad 1 del spec, y el
 * pago / procesando / confirmación / expiración, que son prioridad 3 y **no se
 * tocan** hasta que se resuelvan los bloqueos card-only. Rediseñar con las dos
 * en el mismo archivo es cómo un cambio visual termina rozando el pago.
 *
 * ## Qué NO se mudó, y es a propósito
 *
 * Este componente **no tiene estado propio y no llama a la red**. La selección,
 * el journal monetario, los locks y la identidad siguen siendo de `MesaScreen`:
 * son lo que decide si alguien paga dos veces. Acá sólo entran valores ya
 * calculados y salen intenciones.
 *
 * `isGuest` baja como prop en vez de derivarse acá. Además de ser lo correcto
 * —es identidad, no presentación—, `pagoSinCuenta.test.ts` fija que la
 * superficie de invitado siga viva EN `MesaScreen.tsx`: derivarla acá habría
 * puesto ese test en rojo sin que nada dejara de ser cierto.
 */

export interface MesaDetailViewProps {
  mesa: MesaDetail;
  code: string;
  /** Siempre `false` desde el cierre del pago sin cuenta — ver `MesaScreen`. */
  isGuest: boolean;
  guestHeader: ReactNode;
  selected: Map<string, number>;
  /** Ya calculado por el dueño del estado: acá no se recalcula plata. */
  itemsAmount: number;
  mySlotsTaken: number;
  /** Hay un pago sin confirmar: se avisa y se ofrece volver a ÉL, no a otro. */
  frozenScope: string | null;
  busy: boolean;
  inviteOpen: boolean;
  onToggleItem: (id: string) => void;
  onSetFraction: (id: string, bps: number) => void;
  onGoToPay: () => void;
  onRetryFrozenPay: () => void;
  onOpenInvite: () => void;
  onCopyInvitationLink: () => void;
  onBack: () => void;
}

export function MesaDetailView({
  mesa,
  code,
  isGuest,
  guestHeader,
  selected,
  itemsAmount,
  mySlotsTaken,
  frozenScope,
  busy,
  inviteOpen,
  onToggleItem,
  onSetFraction,
  onGoToPay,
  onRetryFrozenPay,
  onOpenInvite,
  onCopyInvitationLink,
  onBack,
}: MesaDetailViewProps) {
  const cd = countdownTo(mesa.expires_at);
  const pct = mesa.total_cents > 0 ? Math.round((mesa.paid_amount_cents / mesa.total_cents) * 100) : 0;
  const availableSlots = availableSlotsOf(mesa);
  // Si ya no queda NADA seleccionable, no tiene sentido pedir "elegí tus consumos".
  const nothingLeft = nothingLeftFor(mesa);

  // Compartir link: mismo botón en las dos ramas de división (antes duplicado
  // e inaccesible — era solo el emoji 🔗 sin nombre).
  const shareButton = !isGuest && mesa.my_role === 'opener' && (
    <button
      className="back-btn"
      style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', flex: 'none' }}
      aria-label="Copiar link de invitación"
      onClick={onCopyInvitationLink}
    >
      <Icon name="link" size={18} />
    </button>
  );

  return (
    <div className="screen has-cta">
      <div className="top-bar" style={{ background: 'var(--navy)' }}>
        {!isGuest && (
          <button
            className="back-btn"
            onClick={onBack}
            aria-label="Volver"
            style={{ background: 'rgba(255,255,255,0.15)', color: '#fff' }}
          >
            <span aria-hidden="true">←</span>
          </button>
        )}
        <TopLogo inv />
        <div style={{ flex: 1 }} />
        {shareButton}
        {isGuest && <span className="badge badge-teal">Invitado</span>}
      </div>
      <div style={{ background: 'var(--navy)', padding: '0 20px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <div style={{ fontSize: 'var(--fs-legacy-sm)', color: 'rgba(255,255,255,0.75)', fontFamily: 'var(--font-body)', minWidth: 0 }}>
            {mesa.restaurant.name} · Mesa {code} ·{' '}
            {mesa.division_mode === 'igual' ? 'partes iguales' : 'cada uno lo suyo'}
          </div>
          <div style={{ background: 'var(--teal)', color: 'var(--navy)', padding: '4px 12px', borderRadius: 20, fontWeight: 800, fontSize: 'var(--fs-legacy-sm)', flexShrink: 0 }}>
            {formatMXN(mesa.total_cents)}
          </div>
        </div>
        <div style={{ marginTop: 10 }}>
          <div
            className="progress-bar"
            style={{ background: 'rgba(255,255,255,0.15)' }}
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Pagado ${pct}% de la mesa`}
          >
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 'var(--fs-legacy-xs)', color: 'rgba(255,255,255,0.75)', fontFamily: 'var(--font-body)' }}>
            <span>
              {formatMXN(mesa.paid_amount_cents)} pagado ({pct}%)
            </span>
            <span style={{ color: '#ffb59b', fontWeight: 700 }}>
              <Icon name="clock" size={14} className="ico-inline" /> {cd ?? 'venció'}
            </span>
          </div>
        </div>
      </div>
      {guestHeader}
      {mesa.division_mode === 'consumo' ? (
        <>
          <div className="totalbar">
            <div>
              <div className="lbl">Mi parte</div>
              <div className="amt">{formatMXN(itemsAmount)}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 'var(--fs-legacy-xs)', color: 'rgba(255,255,255,0.75)' }}>de {formatMXN(mesa.total_cents)}</div>
              <div style={{ fontSize: 'var(--fs-legacy-sm)', color: 'var(--teal)', fontWeight: 700 }}>
                {mesa.total_cents > 0 ? Math.round((itemsAmount / mesa.total_cents) * 100) : 0}%
              </div>
            </div>
          </div>
          <div className="scroll" style={{ background: '#fff' }}>
          {/* B-06: el pago quedó sin confirmar. Un toast al tocar un ítem se
              pierde; acá queda a la vista, con el camino de vuelta. */}
          {frozenScope && (
            <div style={{ padding: '12px 16px 0' }}>
              <div className="note note-orange" role="status">
                <b>Tenés un pago sin confirmar.</b> Puede que ya se haya cobrado. Reintentalo tal
                cual antes de cambiar tu selección.
                <button
                  className="btn btn-ghost btn-sm btn-fit"
                  style={{ marginTop: 8 }}
                  onClick={onRetryFrozenPay}
                >
                  Reintentar ese pago
                </button>
              </div>
            </div>
          )}
            <div style={{ padding: '12px 16px 4px' }} className="caption">
              Tocá lo que consumiste. Al elegirlo queda <b>reservado</b> para vos.
            </div>
            {nothingLeft && (
              <div className="note note-amber" style={{ margin: '8px 16px' }}>
                Los demás ya tomaron todo lo de esta mesa. No queda nada para que pagues.
              </div>
            )}
            {mesa.items.map((i) => {
              const fullPrice = i.price_cents * i.quantity;
              const paidFull = i.status === 'paid';
              // Bloqueado solo si NO queda nada y nada es mío.
              const blocked = (paidFull || i.remaining_bps <= 0) && i.my_bps === 0 && !selected.has(i.id);
              const sel = selected.has(i.id);
              const myBpsSel = selected.get(i.id) ?? 10000;
              const partial = i.remaining_bps > 0 && i.remaining_bps < 10000;
              const hint = paidFull
                ? ' · ya pagado'
                : blocked
                  ? ' · lo tomaron'
                  : partial
                    ? ` · queda ${bpsLabel(i.remaining_bps)}`
                    : '';
              return (
                <div
                  key={i.id}
                  className={`item-row ${sel ? 'sel' : ''} ${blocked ? 'paid-other' : ''}`}
                  style={{ flexWrap: 'wrap', rowGap: 4 }}
                >
                  <button
                    onClick={() => !blocked && onToggleItem(i.id)}
                    disabled={blocked}
                    aria-pressed={blocked ? undefined : sel}
                    aria-label={`${i.name}, ${formatMXN(fullPrice)}${hint}`}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0, background: 'none', border: 'none', padding: 0, cursor: blocked ? 'default' : 'pointer', textAlign: 'left' }}
                  >
                    <div className={`checkbox ${sel ? 'on' : ''} ${blocked ? 'blocked' : ''}`} aria-hidden="true">
                      {blocked ? (paidFull ? '✓' : <Icon name="lock" size={13} />) : '✓'}
                    </div>
                    <div className="item-name" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {i.name}
                      {partial && !blocked && (
                        <span className="item-hint"> · queda {bpsLabel(i.remaining_bps)}</span>
                      )}
                      {(paidFull || blocked) && <span className="item-hint">{hint}</span>}
                    </div>
                  </button>
                  {/* v2.18: fracción en la MISMA línea (UX ratificada). */}
                  {sel && (
                    <div style={{ display: 'flex', gap: 4, flex: 'none' }} role="radiogroup" aria-label={`Fracción de ${i.name}`}>
                      {FRACTIONS.filter((f) => f.bps <= i.remaining_bps).map((f) => (
                        <button
                          key={f.bps}
                          className={`tip-pill ${myBpsSel === f.bps ? 'sel' : ''}`}
                          style={{ padding: '3px 9px', fontSize: 'var(--fs-legacy-sm)' }}
                          onClick={() => onSetFraction(i.id, f.bps)}
                          role="radio"
                          aria-checked={myBpsSel === f.bps}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="item-price" style={{ flex: 'none' }}>
                    {sel && myBpsSel < 10000
                      ? formatMXN(fractionPreview(fullPrice, myBpsSel, i.remaining_bps))
                      : formatMXN(fullPrice)}
                  </div>
                </div>
              );
            })}
          </div>
          {/* T-F1: el organizador puede invitar amigos in-app también acá —
              la pantalla de compartir post-crear se ve UNA sola vez. */}
          {!isGuest && mesa.my_role === 'opener' && (mesa.status === 'open' || mesa.status === 'partially_paid') && (
            <div style={{ padding: '4px 16px 0' }}>
              {inviteOpen ? (
                <InviteFriends code={code} />
              ) : (
                <button className="btn btn-ghost btn-sm btn-fit" onClick={onOpenInvite}>
                  <Icon name="users" size={16} className="ico-inline" /> Invitar amigos de PayMe
                </button>
              )}
            </div>
          )}
          <button className="cta-float" onClick={onGoToPay} disabled={busy || selected.size === 0}>
            {busy
              ? 'Reservando…'
              : nothingLeft
                ? 'No queda nada por pagar'
                : selected.size === 0
                  ? 'Elegí lo que consumiste'
                  : `Pagar mi parte → ${formatMXN(itemsAmount)}`}
          </button>
        </>
      ) : (
        <>
          <div className="scroll" style={{ padding: 16 }}>
            {/* IMPORTANTÍSIMO (Mati): aunque se pague en partes iguales, cada
                comensal marca QUÉ consumió — esa info sostiene el modelo.
                No cambia el monto (la parte es fija) ni reserva nada. */}
            {/* B-06: el pago quedó sin confirmar. Un toast al tocar un ítem se
                pierde; acá queda a la vista, con el camino de vuelta. */}
              {frozenScope && (
              <div style={{ padding: '12px 16px 0' }}>
                <div className="note note-orange" role="status">
                  <b>Tenés un pago sin confirmar.</b> Puede que ya se haya cobrado. Reintentalo tal
                  cual antes de cambiar tu selección.
                  <button
                    className="btn btn-ghost btn-sm btn-fit"
                    style={{ marginTop: 8 }}
                    onClick={onRetryFrozenPay}
                  >
                    Reintentar ese pago
                  </button>
                </div>
              </div>
            )}
            <div className="sectlabel">¿Qué consumiste?</div>
            <div className="caption" style={{ margin: '0 2px 8px' }}>
              Marcalo para el restaurante — no cambia lo que pagás.
            </div>
            <div className="card" style={{ marginBottom: 14 }}>
              {mesa.items.map((i) => {
                const sel = selected.has(i.id);
                return (
                  <button
                    key={i.id}
                    className={`item-row ${sel ? 'sel' : ''}`}
                    onClick={() => onToggleItem(i.id)}
                    aria-pressed={sel}
                    aria-label={`${i.name}${i.quantity > 1 ? ` por ${i.quantity}` : ''}`}
                  >
                    <div className={`checkbox ${sel ? 'on' : ''}`} aria-hidden="true">
                      ✓
                    </div>
                    <div className="item-name">
                      {i.name}
                      {i.quantity > 1 ? ` × ${i.quantity}` : ''}
                    </div>
                    {/* Feedback Mati: el precio de cada producto, visible. */}
                    <div className="item-price">{formatMXN(i.price_cents * i.quantity)}</div>
                  </button>
                );
              })}
            </div>
            <div className="note note-teal">
              La cuenta se dividió en {mesa.expected_participants} partes iguales de{' '}
              <b>{formatMXN(itemsAmount)}</b>. Quedan <b>{availableSlots}</b> por pagar.
            </div>
            {/* v2.25 §4.3 (B-06): `claimed_by_me` es lo único que le permite al
                comensal ver que su parte YA está tomada. Sin esto volvía, veía
                casilleros libres y pagaba de nuevo — llevándose el de otro.
                No se bloquea: pagar más de una parte es legítimo (acta
                2026-07-25), pero tiene que ser una decisión, no un accidente. */}
            {mySlotsTaken > 0 && (
              <div className="note note-teal" style={{ marginTop: 8 }}>
                <b>Ya pagaste {mySlotsTaken === 1 ? 'tu parte' : `${mySlotsTaken} partes`} ✓</b>
                {availableSlots > 0 && ' Si tocás pagar de nuevo, cubrís la parte de otro comensal.'}
              </div>
            )}
          </div>
          <button
            className="cta-float"
            onClick={onGoToPay}
            disabled={busy || availableSlots === 0 || selected.size === 0}
          >
            {availableSlots === 0
              ? 'No quedan partes'
              : selected.size === 0
                ? 'Marcá lo que consumiste'
                : mySlotsTaken > 0
                  ? `Pagar otra parte → ${formatMXN(itemsAmount)}`
                  : `Pagar mi parte → ${formatMXN(itemsAmount)}`}
          </button>
        </>
      )}
    </div>
  );
}
