import type { ReactNode } from 'react';
import { AppBottomBar } from '../components/AppBottomBar';
import { AppHeaderFlow } from '../components/AppHeader';
import { Icon } from '../components/Icon';
import { InviteFriends } from '../components/InviteFriends';
import type { MesaDetail, MesaItem } from '../api/types';
import { countdownTo, formatMXN } from '../utils/format';
import {
  FRACTIONS,
  availableSlotsOf,
  bpsLabel,
  bpsValido,
  countdownIsUrgent,
  fractionPreview,
  nothingLeftFor,
} from './mesaItemsView';

/**
 * Mis ítems — `s-myitems`, SPEC_APP.md §1.5.
 *
 * **Es la pantalla que gobierna a cualquier participante autenticado de la
 * mesa**: organizador y, desde el rediseño de §1.2, también quien entró por
 * link. No existe más una vista reducida de "invitado".
 *
 * ## Por qué vive en su propio archivo
 *
 * `MesaScreen.tsx` mezclaba esto —prioridad 1, rediseñable— con el pago, el
 * procesando, la confirmación y la expiración, que son prioridad 3 y no se
 * tocan hasta que se resuelvan los bloqueos card-only. Rediseñar con las dos
 * juntas es cómo un cambio visual termina rozando dinero.
 *
 * ## Qué NO está acá, y es a propósito
 *
 * **No tiene estado propio y no llama a la red.** La selección, el journal
 * monetario, los locks y la identidad siguen siendo de `MesaScreen`: son lo que
 * decide si alguien paga dos veces. Acá entran valores ya calculados y salen
 * intenciones.
 *
 * `isGuest` baja como prop en vez de derivarse acá. Además de ser lo correcto
 * —es identidad, no presentación—, `pagoSinCuenta.test.ts` fija que la
 * superficie de invitado siga viva EN `MesaScreen.tsx`.
 */

export interface MesaDetailViewProps {
  mesa: MesaDetail;
  code: string;
  /** `payme_id` de la sesión, para la fila 1 de la cabecera. */
  paymeId?: string;
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

/**
 * Los CINCO estados de una fila. Se nombran, en vez de recalcularse inline en
 * cada rama del JSX, porque de eso depende qué ve alguien sobre un plato que
 * quizá ya pagó: confundir "tomado" con "pagado" es confundir plata.
 */
type RowState = 'disponible' | 'parcial' | 'seleccionado' | 'tomado' | 'pagado' | 'indeterminado';

function rowStateOf(item: MesaItem, selected: Map<string, number>): RowState {
  if (selected.has(item.id)) return 'seleccionado';
  if (item.status === 'paid') return 'pagado';
  // ORDEN 1A.3 · sin un `remaining_bps` válido no se puede afirmar NADA de
  // este ítem: ni que está libre (era lo que pasaba: `undefined <= 0` y
  // `undefined > 0` son los dos `false`, así que caía en 'disponible') ni que
  // lo tomó otro. Queda no seleccionable y lo dice.
  if (!bpsValido(item.remaining_bps)) return 'indeterminado';
  // Bloqueado sólo si NO queda nada y nada es mío.
  if (item.remaining_bps <= 0 && item.my_bps === 0) return 'tomado';
  if (item.remaining_bps > 0 && item.remaining_bps < 10000) return 'parcial';
  return 'disponible';
}

/**
 * El copy del estado. Va SIEMPRE con palabras: el color y el ícono nunca son el
 * único portador de significado.
 *
 * *"Lo eligió otro"* y no *"Lo eligió otro · todavía no pagó"*: la mesa recarga
 * al montar, después de una acción propia o con el botón manual — no hay
 * polling ni WebSocket que traiga en vivo lo que hace otro comensal. Prometer
 * "todavía no pagó" como hecho instantáneo no sería cierto (§1.5).
 */
function rowTag(state: RowState, item: MesaItem): string | null {
  if (state === 'pagado') return 'Pagado';
  if (state === 'tomado') return 'Lo eligió otro';
  // No afirma que lo tomó otro —no lo sabemos—: dice que no pudimos leerlo.
  if (state === 'indeterminado') return 'No pudimos leer este ítem';
  if (state === 'parcial') return `Queda ${bpsLabel(item.remaining_bps)}`;
  return null;
}

export function MesaDetailView({
  mesa,
  code,
  paymeId,
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
  const urgente = countdownIsUrgent(cd);
  const pct = mesa.total_cents > 0 ? Math.round((mesa.paid_amount_cents / mesa.total_cents) * 100) : 0;
  const availableSlots = availableSlotsOf(mesa);
  const nothingLeft = nothingLeftFor(mesa);
  const esConsumo = mesa.division_mode === 'consumo';

  // §1.5 · ícono de link EN VEZ del contador de paso: esta pantalla no es un
  // paso de un flujo lineal, es donde el usuario vuelve mientras la mesa vive.
  const shareButton = !isGuest && mesa.my_role === 'opener' && (
    <button
      type="button"
      className="hdr-back"
      aria-label="Copiar link de invitación"
      onClick={onCopyInvitationLink}
    >
      <Icon name="link" size={20} />
    </button>
  );

  const avisoPagoCongelado = frozenScope && (
    <div className="note note-orange" role="status" style={{ marginBottom: 12 }}>
      <b>Tenés un pago sin confirmar.</b> Puede que ya se haya cobrado. Reintentalo tal cual
      antes de cambiar tu selección.
      <button
        className="btn btn-ghost btn-sm btn-fit"
        style={{ marginTop: 8 }}
        onClick={onRetryFrozenPay}
      >
        Reintentar ese pago
      </button>
    </div>
  );

  /**
   * Fila superior de la barra. Lo dinámico vive acá y no en el nav item, que
   * dice "Continuar" siempre: un nav item que cambia de texto según el estado
   * es un nav item inestable (§1.5).
   *
   * **La selección sólo manda en CONSUMO** (auditoría 2026-08-06, H-14). En
   * ese modo el monto SALE de lo elegido, así que sin selección la fila guía
   * ("Elegí lo que consumiste") y Continuar espera. En PARTES IGUALES marcar
   * es información para el restaurante y la propia pantalla lo dice — "no
   * cambia lo que pagás" —, pero el gate viejo exigía seleccionar igual:
   * copy y gate se contradecían, y con una mesa sin ítems el Continuar
   * quedaba apagado PARA SIEMPRE, sin salida al pago. En igual la fila
   * muestra "Mi parte" desde que se entra (el monto es el del casillero
   * libre, como manda la tabla del spec) y Continuar sólo espera a que haya
   * casillero. El contrato acompaña: `payMesa` acepta `item_ids: []`
   * (`schemas/index.js:233`, default []).
   */
  const faltaElegir = esConsumo && selected.size === 0;
  const miParte = (
    <div className="mi-parte">
      {nothingLeft ? (
        <span>No queda nada por pagar</span>
      ) : !esConsumo && availableSlots === 0 ? (
        <span>No quedan partes</span>
      ) : faltaElegir ? (
        <span>Elegí lo que consumiste</span>
      ) : (
        <>
          <span>{mySlotsTaken > 0 && !esConsumo ? 'Otra parte' : 'Mi parte'}</span>
          <span className="mi-parte-amt">{formatMXN(itemsAmount)}</span>
        </>
      )}
    </div>
  );

  const continuarDeshabilitado =
    busy || (esConsumo ? selected.size === 0 : availableSlots === 0);

  return (
    <div className="screen has-appbar">
      <AppHeaderFlow paymeId={paymeId} onBack={onBack} action={shareButton} />
      <div className="title-card">
        <div className="title-card-title">{mesa.restaurant.name}</div>
        <div className="title-card-sub">
          Mesa {code} · {esConsumo ? 'cada uno lo suyo' : 'partes iguales'}
        </div>
        <div className="title-card-div" />
        <div
          className="mi-progress"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Pagado ${pct}% de la mesa`}
        >
          <div className="mi-progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="mi-meta">
          <span className="mi-meta-amt">
            {formatMXN(mesa.paid_amount_cents)} de {formatMXN(mesa.total_cents)} ({pct}%)
          </span>
          <span className={`mi-count ${urgente ? 'urgent' : ''}`}>
            <Icon name="clock" size={14} /> {cd ?? 'venció'}
          </span>
        </div>
      </div>
      {guestHeader}
      <div className="scroll flow-scroll">
        {avisoPagoCongelado}
        {esConsumo ? (
          <>
            <div className="caption" style={{ marginBottom: 8 }}>
              Tocá lo que consumiste. Al elegirlo queda <b>reservado</b> para vos.
            </div>
            {nothingLeft && (
              <div className="note note-amber" style={{ marginBottom: 12 }}>
                Los demás ya tomaron todo lo de esta mesa. No queda nada para que pagues.
              </div>
            )}
          </>
        ) : (
          <>
            <div className="sectlabel">¿Qué consumiste?</div>
            <div className="caption" style={{ margin: '0 2px 8px' }}>
              Marcalo para el restaurante — no cambia lo que pagás.
            </div>
          </>
        )}
        <div className="card" style={{ marginBottom: 14 }}>
          {mesa.items.map((i) => {
            const fullPrice = i.price_cents * i.quantity;
            const state = rowStateOf(i, selected);
            const sel = state === 'seleccionado';
            // 1A.3 · 'indeterminado' bloquea igual que 'tomado': sin dato
            // válido no se ofrece tomar nada.
            const bloqueado = state === 'tomado' || state === 'pagado' || state === 'indeterminado';
            const tag = rowTag(state, i);
            const myBpsSel = selected.get(i.id) ?? 10000;
            // En partes iguales marcar es informativo y no reserva nada, así
            // que ahí NUNCA se bloquea una fila: el monto no depende de esto.
            const disabled = esConsumo && bloqueado;
            const precio =
              sel && esConsumo && myBpsSel < 10000
                ? fractionPreview(fullPrice, myBpsSel, i.remaining_bps)
                : fullPrice;
            return (
              <div key={i.id}>
                <button
                  type="button"
                  className={`mi-row ${sel ? 'sel' : ''}`}
                  onClick={() => !disabled && onToggleItem(i.id)}
                  disabled={disabled}
                  aria-pressed={disabled ? undefined : sel}
                  aria-label={`${i.name}${i.quantity > 1 ? ` por ${i.quantity}` : ''}${tag ? `, ${tag}` : ''}`}
                >
                  <span
                    className={`mi-check ${sel ? 'on' : ''} ${state === 'pagado' ? 'paid' : ''} ${state === 'tomado' ? 'taken' : ''}`}
                    aria-hidden="true"
                  >
                    {state === 'tomado' ? (
                      <Icon name="lock" size={13} />
                    ) : (
                      <Icon name="check" size={15} />
                    )}
                  </span>
                  <span className="mi-body">
                    <span className={`mi-name ${bloqueado ? 'dim' : ''} ${state === 'pagado' ? 'paid' : ''}`}>
                      {i.name}
                      {i.quantity > 1 ? ` × ${i.quantity}` : ''}
                    </span>
                    {tag && <span className="mi-tag">{tag}</span>}
                  </span>
                  <span className={`mi-price ${bloqueado ? 'dim' : ''}`}>{formatMXN(precio)}</span>
                </button>
                {/* Selector de porción: en TODO ítem, con "1" ya marcada
                    (resuelto con Mati el 2026-08-04). Tildar y listo sigue
                    siendo el flujo de siempre; esto sólo pesa si se cambia. */}
                {sel && esConsumo && (
                  <div className="mi-frac">
                    <div className="mi-frac-lbl" id={`frac-${i.id}`}>
                      ¿Cuánto tomás vos?
                    </div>
                    <div className="seg" role="radiogroup" aria-labelledby={`frac-${i.id}`}>
                      {FRACTIONS.filter((f) => f.bps <= i.remaining_bps).map((f) => (
                        <button
                          key={f.bps}
                          type="button"
                          className={`seg-btn ${myBpsSel === f.bps ? 'on' : ''}`}
                          onClick={() => onSetFraction(i.id, f.bps)}
                          role="radio"
                          aria-checked={myBpsSel === f.bps}
                          aria-label={f.bps >= 10000 ? 'Entero' : bpsLabel(f.bps)}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                    <div className="mi-frac-amt" aria-live="polite">
                      Tu parte: {formatMXN(fractionPreview(fullPrice, myBpsSel, i.remaining_bps))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {!esConsumo && (
          <div className="note note-teal">
            La cuenta se dividió en {mesa.expected_participants} partes iguales de{' '}
            <b>{formatMXN(itemsAmount)}</b>. Quedan <b>{availableSlots}</b> por pagar.
          </div>
        )}
        {/* v2.25 §4.3 (B-06): `claimed_by_me` es lo único que le permite al
            comensal ver que su parte YA está tomada. Sin esto volvía, veía
            casilleros libres y pagaba de nuevo — llevándose el de otro.
            No se bloquea: pagar más de una parte es legítimo (acta
            2026-07-25), pero tiene que ser una decisión, no un accidente. */}
        {mySlotsTaken > 0 && !esConsumo && (
          <div className="note note-teal" style={{ marginTop: 8 }}>
            <b>Ya pagaste {mySlotsTaken === 1 ? 'tu parte' : `${mySlotsTaken} partes`} ✓</b>
            {availableSlots > 0 && ' Si tocás pagar de nuevo, cubrís la parte de otro comensal.'}
          </div>
        )}
        {/* T-F1: el organizador puede invitar amigos in-app también acá —
            la pantalla de compartir post-crear se ve UNA sola vez. */}
        {!isGuest && mesa.my_role === 'opener' && (mesa.status === 'open' || mesa.status === 'partially_paid') && (
          <div style={{ marginTop: 12 }}>
            {inviteOpen ? (
              <InviteFriends code={code} />
            ) : (
              <button className="btn btn-ghost btn-sm btn-fit" onClick={onOpenInvite}>
                <Icon name="users" size={16} className="ico-inline" /> Invitar amigos de PayMe
              </button>
            )}
          </div>
        )}
      </div>
      <AppBottomBar
        active={null}
        above={miParte}
        center={{
          label: 'Continuar',
          icon: 'arrow-right',
          onClick: onGoToPay,
          disabled: continuarDeshabilitado,
        }}
      />
    </div>
  );
}
