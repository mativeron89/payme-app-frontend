import { useRef, useState, type ReactNode } from 'react';
import { useIdioma } from '../i18n/idioma';
import { AppBottomBar } from '../components/AppBottomBar';
import { AppHeaderFlow } from '../components/AppHeader';
import { Icon } from '../components/Icon';
import { useToast } from '../components/ui';
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
  /** Nombre completo editable de la sesión, para la fila 1 de la cabecera. */
  userName?: string;
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
function rowTag(state: RowState, item: MesaItem, t: (s: string, ...a: unknown[]) => string): string | null {
  if (state === 'pagado') return t('Pagado');
  if (state === 'tomado') return t('Lo eligió otro');
  // No afirma que lo tomó otro —no lo sabemos—: dice que no pudimos leerlo.
  if (state === 'indeterminado') return t('No pudimos leer este ítem');
  if (state === 'parcial') return t('Queda {0}', bpsLabel(item.remaining_bps));
  return null;
}

export function MesaDetailView({
  mesa,
  code,
  userName,
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
  const { t } = useIdioma();
  const toast = useToast();
  /** El par «scroll + pulso» de §1.4/§1.5 bis, acá para la lista de consumos. */
  const [itemsPulse, setItemsPulse] = useState(false);
  const itemsRef = useRef<HTMLDivElement | null>(null);
  const cd = countdownTo(mesa.expires_at);
  const urgente = countdownIsUrgent(cd);
  const pct = mesa.total_cents > 0 ? Math.round((mesa.paid_amount_cents / mesa.total_cents) * 100) : 0;
  const availableSlots = availableSlotsOf(mesa);
  const nothingLeft = nothingLeftFor(mesa);
  const esConsumo = mesa.division_mode === 'consumo';

  const avisoPagoCongelado = frozenScope && (
    <div className="note note-orange" role="status" style={{ marginBottom: 12 }}>
      <b>{t('Tienes un pago sin confirmar.')}</b> {t('Puede que ya se haya cobrado. Reinténtalo tal cual antes de cambiar tu selección.')}
      <button
        className="btn btn-ghost btn-sm btn-fit"
        style={{ marginTop: 8 }}
        onClick={onRetryFrozenPay}
      >
        {t('Reintentar ese pago')}
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
        <span>{t('No queda nada por pagar')}</span>
      ) : !esConsumo && availableSlots === 0 ? (
        <span>{t('No quedan partes')}</span>
      ) : faltaElegir ? (
        <span>{t('Elige lo que consumiste')}</span>
      ) : (
        <>
          <span>{mySlotsTaken > 0 && !esConsumo ? t('Otra parte') : t('Mi parte')}</span>
          <span className="mi-parte-amt">{formatMXN(itemsAmount)}</span>
        </>
      )}
    </div>
  );

  /**
   * 🔴 §5 bis · E, adjudicado 2026-08-21 — el círculo no se apaga por FALTA DE
   * UN DATO. Acá había tres razones mezcladas en una línea y sólo UNA es de esa
   * clase; se separan porque las otras dos NO se retiran:
   *
   *   busy                  operación EN VUELO   → sigue apagando (AF-04)
   *   availableSlots === 0  no quedan casilleros  → sigue apagando · ver abajo
   *   selected.size === 0   falta elegir ítems    → SE RETIRA, frena explicando
   *
   * ⚠️ `availableSlots === 0` NO es «falta un dato», aunque se le parezca: no
   * hay nada que la persona pueda completar para avanzar — la mesa se llenó.
   * Un círculo tocable que no puede avanzar nunca es el botón muerto que §E
   * quiere evitar, no el que quiere habilitar. Le declaré esta fila al
   * Bibliotecario como «se retira `selected.size===0`, se conserva `busy`»;
   * mirándola de cerca son TRES razones, no dos.
   */
  const faltaElegirConsumos = esConsumo && selected.size === 0;
  const continuarDeshabilitado = busy || (!esConsumo && availableSlots === 0);

  return (
    <div className="screen has-appbar">
      <AppHeaderFlow userName={userName} onBack={onBack} bellBlocked={busy || !!frozenScope} />
      <div className="title-card">
        <div className="title-card-title">{mesa.restaurant.name}</div>
        <div className="title-card-sub">
          {t('Mesa')} {code} · {esConsumo ? t('cada uno lo suyo') : t('partes iguales')}
        </div>
        <div className="title-card-div" />
        <div
          className="mi-progress"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={t('Pagado {0}% de la mesa', pct)}
        >
          <div className="mi-progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="mi-meta">
          <span className="mi-meta-amt">
            {formatMXN(mesa.paid_amount_cents)} {t('de')} {formatMXN(mesa.total_cents)} ({pct}%)
          </span>
          <span className={`mi-count ${urgente ? 'urgent' : ''}`}>
            <Icon name="clock" size={14} /> {cd ?? t('venció')}
          </span>
        </div>
      </div>
      {guestHeader}
      <div className="scroll flow-scroll">
        {avisoPagoCongelado}
        {esConsumo ? (
          <>
            <div className="mi-selection-copy">
              {t('Selecciona lo que consumiste')}
            </div>
            {nothingLeft && (
              <div className="note note-amber" style={{ marginBottom: 12 }}>
                {t('Los demás ya tomaron todo lo de esta mesa. No queda nada para que pagues.')}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="sectlabel">{t('¿Qué consumiste?')}</div>
            <div className="caption" style={{ margin: '0 2px 8px' }}>
              {t('Márcalo para el restaurante — no cambia lo que pagas.')}
            </div>
          </>
        )}
        <div
          ref={itemsRef}
          className={`card${faltaElegirConsumos ? ' tk-fold--pending' : ''}${itemsPulse ? ' tk-fold--pulse' : ''}`}
          style={{ marginBottom: 14 }}
          onAnimationEnd={() => setItemsPulse(false)}
        >
          {mesa.items.map((i) => {
            const fullPrice = i.price_cents * i.quantity;
            const state = rowStateOf(i, selected);
            const sel = state === 'seleccionado';
            // 1A.3 · 'indeterminado' bloquea igual que 'tomado': sin dato
            // válido no se ofrece tomar nada.
            const bloqueado = state === 'tomado' || state === 'pagado' || state === 'indeterminado';
            const tag = rowTag(state, i, t);
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
                  aria-label={`${i.name}${i.quantity > 1 ? ` por ${i.quantity}` : ''}${tag ? t(', {0}', tag) : ''}`}
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
                      {t('¿Cuánto tomas tú?')}
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
                          aria-label={f.bps >= 10000 ? t('Entero') : bpsLabel(f.bps)}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                    <div className="mi-frac-amt" aria-live="polite">
                      {t('Tu parte:')} {formatMXN(fractionPreview(fullPrice, myBpsSel, i.remaining_bps))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {!esConsumo && (
          <div className="note note-teal">
            {t('La cuenta se dividió en')} {mesa.expected_participants} {t('partes iguales de')}{' '}
            <b>{formatMXN(itemsAmount)}</b>{t('. Quedan')} <b>{availableSlots}</b> {t('por pagar.')}
          </div>
        )}
        {/* v2.25 §4.3 (B-06): `claimed_by_me` es lo único que le permite al
            comensal ver que su parte YA está tomada. Sin esto volvía, veía
            casilleros libres y pagaba de nuevo — llevándose el de otro.
            No se bloquea: pagar más de una parte es legítimo (acta
            2026-07-25), pero tiene que ser una decisión, no un accidente. */}
        {mySlotsTaken > 0 && !esConsumo && (
          <div className="note note-teal" style={{ marginTop: 8 }}>
            <b>{t('Ya pagaste')} {mySlotsTaken === 1 ? t('tu parte') : t('{0} partes', mySlotsTaken)} ✓</b>
            {availableSlots > 0 && ' Si tocas pagar de nuevo, cubres la parte de otro comensal.'}
          </div>
        )}
        {/* T-F1: el organizador puede invitar amigos in-app también acá —
            la pantalla de compartir post-crear se ve UNA sola vez. */}
        {!isGuest && mesa.my_role === 'opener' && (mesa.status === 'open' || mesa.status === 'partially_paid') && (
          <div className="mesa-secondary-actions">
            <button className="btn btn-ghost btn-sm btn-fit" onClick={onCopyInvitationLink}>
              <Icon name="link" size={16} className="ico-inline" /> {t('Copiar link de invitación')}
            </button>
            {inviteOpen ? (
              <InviteFriends code={code} />
            ) : (
              <button className="btn btn-ghost btn-sm btn-fit" onClick={onOpenInvite}>
                <Icon name="users" size={16} className="ico-inline" /> {t('Invitar amigos de PayMe')}
              </button>
            )}
          </div>
        )}
      </div>
      <AppBottomBar
        active={null}
        above={miParte}
        center={{
          label: t('Continuar'),
          icon: 'arrow-right',
          onClick: () => {
            // Frena explicando, no apagado (§5 bis · E): toast + scroll + pulso,
            // las tres. `onGoToPay` no se llama: no se avanza sin elegir.
            if (faltaElegirConsumos) {
              toast(t('Elige lo que consumiste para continuar'));
              itemsRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
              setItemsPulse(true);
              return;
            }
            onGoToPay();
          },
          disabled: continuarDeshabilitado,
        }}
      />
    </div>
  );
}
