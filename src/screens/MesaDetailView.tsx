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
  /**
   * CORTE DEL VIERNES (`releaseGates.ts`) · con el corte activo la pantalla
   * TERMINA acá: no hay `Continuar` hacia el pago ni reintento de un pago
   * congelado. El aviso del pago congelado se conserva, sin su botón y con un
   * texto que no promete una acción que la app no ofrece.
   */
  pagosCortados: boolean;
  /**
   * 🔴 **D-R8 · el corte DECLARADO por el dueño, que no es lo mismo que
   * `pagosCortados`.**
   *
   * `pagosCortados` es fail-closed: también es `true` mientras el riel está
   * `pending`, o sea antes de que el backend conteste. Este otro sólo es `true`
   * cuando el dueño **declaró** que no hay pagos.
   *
   * La diferencia importa por dos razones. Una de producto: prometer «los pagos
   * llegan pronto» mientras no sabemos si están vivos sería inventar una
   * promesa. Y una de verificación, que era un hueco medido: `pending` y
   * `authoritative + disabled` producían señales IDÉNTICAS en toda la UI, así
   * que ningún recorrido podía distinguir «no llegó el config» de «llegó y dice
   * que no hay pagos» — y por eso una aserción de ausencia pasaba trivialmente.
   * Este aviso es la primera superficie que sólo existe con el estado
   * autoritativo: es el **testigo positivo** de esta capability.
   */
  corteDeclarado: boolean;
  /** La salida del flujo cuando no hay pago al que continuar. */
  onLeave: () => void;
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
  pagosCortados,
  corteDeclarado,
  onLeave,
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
  const [confirmandoCierre, setConfirmandoCierre] = useState(false);
  const itemsRef = useRef<HTMLDivElement | null>(null);
  const cd = countdownTo(mesa.expires_at);
  const urgente = countdownIsUrgent(cd);
  const pct = mesa.total_cents > 0 ? Math.round((mesa.paid_amount_cents / mesa.total_cents) * 100) : 0;
  const availableSlots = availableSlotsOf(mesa);
  const nothingLeft = nothingLeftFor(mesa);
  const esConsumo = mesa.division_mode === 'consumo';
  const divisionLabel = esConsumo
    ? t('cada uno lo suyo')
    : mesa.expected_participants === 1
      ? t('pagar el total')
      : t('partes iguales');

  /**
   * El aviso NO se oculta con el corte: el estado real de la persona es que
   * hay un pago sin confirmar. Lo que se retira es el botón, y con él la
   * promesa de reintentar. `#/pagos` se conserva y es donde puede verificarlo.
   */
  const avisoPagoCongelado = frozenScope && (
    <div className="note note-orange" role="status" style={{ marginBottom: 12 }}>
      <b>{t('Tienes un pago sin confirmar.')}</b>{' '}
      {pagosCortados
        ? t('Puede que ya se haya cobrado. Puedes revisarlo en Mis pagos.')
        : t('Puede que ya se haya cobrado. Reinténtalo tal cual antes de cambiar tu selección.')}
      {!pagosCortados && (
        <button
          className="btn btn-ghost btn-sm btn-fit"
          style={{ marginTop: 8 }}
          onClick={onRetryFrozenPay}
        >
          {t('Reintentar ese pago')}
        </button>
      )}
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

  /**
   * 🔴 **D-R20 · «Aviso sin nombres», etiqueta literal de Mati.**
   *
   * En división por consumo la selección es IRREVERSIBLE —no hay «soltar
   * ítem»— y quien reclama el último cierra la mesa **para todos, en el acto**.
   * Confirmarlo antes no es cortesía: es la única oportunidad de enterarse.
   *
   * ⚠️ **Y el aviso NO dice quién tomó qué.** El contrato publica por ítem
   * sólo mío/no-mío —`locked_by_me`, y su comentario lo declara: *«jamás expone
   * de quién es el ajeno»*—, así que la atribución no existe de este lado. La
   * primera redacción de esta decisión pedía mostrarla; se corrigió al medir el
   * contrato, y Mati eligió esta variante sabiendo la diferencia. Cada consumo
   * se muestra **tomado o libre**, sin persona.
   */
  const librosTrasMiSeleccion = esConsumo
    ? mesa.items.filter((i) => {
        if (i.status === 'paid') return false;
        if (i.locked_by_me) return false;
        if (i.status === 'locked') return false;
        return !selected.has(i.id);
      })
    : [];
  const cierraLaMesa = esConsumo && selected.size > 0 && librosTrasMiSeleccion.length === 0;
  /**
   * D-R8 · el final del recorrido del comensal durante el corte: eligió lo suyo
   * y no hay checkout. En vez de dejarlo sin salida, se le dice qué pasó con su
   * selección. **La selección no vence** —el dueño publica `item_lock_seconds:
   * null` en este modo—, así que la promesa es literal.
   */
  const avisoCorte = corteDeclarado && (
    <div className="note note-orange" role="status" style={{ marginBottom: 12 }}>
      {t('Los pagos llegan pronto; tu selección queda registrada.')}
    </div>
  );

  /**
   * D-R20 · el resumen que acompaña al aviso: **lo que queda y lo mío**, con
   * cada consumo como tomado o libre. Ninguna persona aparece.
   */
  const hojaCierre = confirmandoCierre && (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-label={t('Con esto se cierra la mesa')}>
      <div className="sheet">
        <div className="sheet-title">{t('Con esto se cierra la mesa para todos')}</div>
        <p className="sheet-copy">
          {t('Estás por tomar el último consumo disponible. Cuando lo hagas, la mesa se cierra para todos los comensales.')}
        </p>
        <div className="receipt-row">
          <span className="lbl">{t('Lo que tomas')}</span>
          <span className="val">{selected.size}</span>
        </div>
        <div className="receipt-row">
          <span className="lbl">{t('Lo que queda libre')}</span>
          <span className="val">{librosTrasMiSeleccion.length}</span>
        </div>
        <ul className="sheet-list">
          {mesa.items.map((i) => (
            <li key={i.id}>
              {/* Tomado o libre. NUNCA por quién: el contrato no lo publica y
                  la decisión de Mati es explícita en no mostrarlo. */}
              {i.status === 'paid' || i.status === 'locked' || selected.has(i.id)
                ? t('Tomado')
                : t('Libre')}
            </li>
          ))}
        </ul>
        <div className="sheet-actions">
          <button className="btn btn-ghost" onClick={() => setConfirmandoCierre(false)}>
            {t('Volver a elegir')}
          </button>
          <button
            className="btn btn-navy"
            onClick={() => { setConfirmandoCierre(false); onGoToPay(); }}
          >
            {t('Sí, cerrar la mesa')}
          </button>
        </div>
      </div>
    </div>
  );

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
      <div className="title-card mesa-selection-title">
        <h1 className="title-card-title">{t('¿Qué consumiste?')}</h1>
        <div className="title-card-sub">
          {code} · <strong>{divisionLabel}</strong>
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
        {hojaCierre}
        {avisoCorte}
        {avisoPagoCongelado}
        {esConsumo && nothingLeft && (
          <div className="note note-amber" style={{ marginBottom: 12 }}>
            {t('Los demás ya tomaron todo lo de esta mesa. No queda nada para que pagues.')}
          </div>
        )}
        <div
          ref={itemsRef}
          className={`card${faltaElegirConsumos ? ' tk-fold--pending' : ''}${itemsPulse ? ' tk-fold--pulse' : ''}`}
          style={{ marginBottom: 14 }}
          onAnimationEnd={() => setItemsPulse(false)}
        >
          {mesa.items.map((i) => {
            const fullPrice = i.price_cents * i.quantity;
            // En igualdad la selección sólo declara consumo y no reclama el
            // ítem: otras tenencias/remaining_bps no deben bloquearla.
            const state = esConsumo
              ? rowStateOf(i, selected)
              : selected.has(i.id) ? 'seleccionado' : 'disponible';
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
                {/* Selector de porción en LOS DOS MODOS. En consumo expresa
                    tenencia/cobro y se limita por lo restante; en igualdad es
                    sólo `declared_fraction_bps`, sin alterar el casillero. */}
                {sel && (
                  <div className="mi-frac">
                    <div className="mi-frac-lbl" id={`frac-${i.id}`}>
                      {t('¿Cuánto tomas tú?')}
                    </div>
                    <div className="seg" role="radiogroup" aria-labelledby={`frac-${i.id}`}>
                      {FRACTIONS.filter((f) => !esConsumo || f.bps <= i.remaining_bps).map((f) => (
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
                    {esConsumo && (
                      <div className="mi-frac-amt" aria-live="polite">
                        {t('Tu parte:')} {formatMXN(fractionPreview(fullPrice, myBpsSel, i.remaining_bps))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
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
      {/* CORTE DEL VIERNES · el círculo no puede ser un botón muerto (§5 bis ·
          E): sin pago al que continuar, cierra el flujo y vuelve a Inicio. El
          camino a `pay` queda abajo, dormido, para cuando el corte se levante. */}
      <AppBottomBar
        active={null}
        above={miParte}
        center={pagosCortados ? {
          label: t('Listo'),
          icon: 'check',
          /**
           * D-R8 · con el corte el círculo **registra la selección** y termina
           * el recorrido; antes salía sin registrar nada, y el aviso que la
           * persona lee —«tu selección queda registrada»— habría sido falso.
           * Sin selección no hay nada que registrar y se sale, como antes.
           * D-R20 se interpone cuando este toque cerraría la mesa.
           */
          onClick: () => {
            if (selected.size === 0) { onLeave(); return; }
            if (cierraLaMesa) { setConfirmandoCierre(true); return; }
            onGoToPay();
          },
          disabled: false,
        } : {
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
