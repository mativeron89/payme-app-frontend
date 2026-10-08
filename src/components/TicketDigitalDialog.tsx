import { useEffect, useRef, useState, type RefObject } from 'react';
import { api } from '../api';
import { extractApiError } from '../api/errors';
import { isCurrentSession, loadSession } from '../api/storage';
import { useAuth } from '../auth/AuthContext';
import { useIdioma } from '../i18n/idioma';
import { montoDeDescuento, notaDeLoQueNoSeReparte, type FilaDelDesglose, type LoQueNoSeReparte } from '../screens/desgloseDelTicket';
import { ticketDigitalView, type TicketDigitalView } from '../screens/ticketDigitalView';
import { formatMXN } from '../utils/format';
import { RequestEpoch } from '../utils/requestEpoch';
import { Icon } from './Icon';

type Estado =
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'lista'; readonly ticket: TicketDigitalView }
  | { readonly tipo: 'sin_acceso' }
  | { readonly tipo: 'no_encontrado' }
  | { readonly tipo: 'error' };

export function TicketDigitalDialog({
  code,
  onClose,
  returnFocusRef,
}: {
  code: string;
  onClose: () => void;
  returnFocusRef: RefObject<HTMLButtonElement>;
}) {
  const { t } = useIdioma();
  const { session } = useAuth();
  const [estado, setEstado] = useState<Estado>({ tipo: 'cargando' });
  const epochRef = useRef(new RequestEpoch());
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const epoch = epochRef.current.next();
    const expected = session;
    setEstado({ tipo: 'cargando' });
    if (!expected || !isCurrentSession(expected)) {
      setEstado({ tipo: 'sin_acceso' });
      return () => { epochRef.current.next(); };
    }

    void api.getMesa(code)
      .then(({ mesa }) => {
        const current = loadSession();
        if (
          !epochRef.current.isCurrent(epoch)
          || !current
          || current.family_id !== expected.family_id
          || current.principal_id !== expected.principal_id
        ) return;
        setEstado({ tipo: 'lista', ticket: ticketDigitalView(mesa, code) });
      })
      .catch((error: unknown) => {
        if (!epochRef.current.isCurrent(epoch)) return;
        const current = loadSession();
        if (!current || current.family_id !== expected.family_id || current.principal_id !== expected.principal_id) return;
        const failure = extractApiError(error);
        setEstado(failure.status === 403
          ? { tipo: 'sin_acceso' }
          : failure.status === 404
            ? { tipo: 'no_encontrado' }
            : { tipo: 'error' });
      });
    return () => { epochRef.current.next(); };
  }, [code, session]);

  useEffect(() => {
    closeRef.current?.focus();
    const dialog = dialogRef.current;
    const keepFocusInside = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const focusables = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex]:not([tabindex="-1"])')];
      if (focusables.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', keepFocusInside);
    return () => {
      document.removeEventListener('keydown', keepFocusInside);
      returnFocusRef.current?.focus();
    };
  }, [onClose, returnFocusRef]);

  const retry = () => {
    const current = loadSession();
    if (!current) {
      setEstado({ tipo: 'sin_acceso' });
      return;
    }
    const epoch = epochRef.current.next();
    setEstado({ tipo: 'cargando' });
    void api.getMesa(code)
      .then(({ mesa }) => {
        if (epochRef.current.isCurrent(epoch) && isCurrentSession(current)) {
          setEstado({ tipo: 'lista', ticket: ticketDigitalView(mesa, code) });
        }
      })
      .catch((error: unknown) => {
        if (!epochRef.current.isCurrent(epoch) || !isCurrentSession(current)) return;
        const failure = extractApiError(error);
        setEstado(failure.status === 403
          ? { tipo: 'sin_acceso' }
          : failure.status === 404
            ? { tipo: 'no_encontrado' }
            : { tipo: 'error' });
      });
  };

  return (
    <div className="ticket-digital-backdrop">
      <section
        ref={dialogRef}
        className="ticket-digital-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ticket-digital-title"
        tabIndex={-1}
      >
        <div className="ticket-digital-head">
          <div>
            <h2 id="ticket-digital-title">{t('Detalle digital del ticket')}</h2>
            <p>{t('No es una foto, factura ni comprobante de pago.')}</p>
          </div>
          <button ref={closeRef} type="button" className="ticket-digital-close" onClick={onClose} aria-label={t('Cerrar')}>
            <Icon name="x-circle" size={24} />
          </button>
        </div>

        <div className="ticket-digital-scroll">
          {estado.tipo === 'cargando' ? (
            <div className="loading" role="status">{t('Cargando detalle…')}</div>
          ) : estado.tipo === 'sin_acceso' ? (
            <div className="state-unknown" role="status">
              <Icon name="lock" size={20} />
              <div className="state-unknown-title">{t('No tienes acceso a este detalle.')}</div>
            </div>
          ) : estado.tipo === 'no_encontrado' ? (
            <div className="state-unknown" role="status">
              <Icon name="info" size={20} />
              <div className="state-unknown-title">{t('Este detalle ya no está disponible.')}</div>
            </div>
          ) : estado.tipo === 'error' ? (
            <div className="state-error" role="alert">
              <div className="state-error-title">{t('No pudimos cargar el detalle')}</div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={retry}>{t('Reintentar')}</button>
            </div>
          ) : (
            <>
              <div className="ticket-digital-restaurant">{estado.ticket.restaurantName}</div>
              <div className="ticket-digital-code">{t('Mesa {0}', estado.ticket.code)}</div>
              {estado.ticket.items.length === 0 ? (
                <p className="ticket-digital-empty">{t('Este ticket no tiene ítems disponibles.')}</p>
              ) : (
                <ul className="ticket-digital-items">
                  {estado.ticket.items.map((item, index) => (
                    <li key={`${item.name}:${index}`}>
                      <span className="ticket-digital-qty">{item.quantity} ×</span>
                      <span className="ticket-digital-name">{item.name}</span>
                      <span className="ticket-digital-price">{formatMXN(item.unitPriceCents)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {estado.ticket.desglose ? (
                /* D224 · una fila v2 con el impreso deducido sin ambigüedad: el
                   desglose en el orden de la cuenta, el cargo por servicio en su
                   línea y el total impreso. El cargo no se reparte. */
                <>
                  <dl className="ticket-digital-desglose">
                    {estado.ticket.desglose.filas.filter((fila) => fila.clave !== 'total').map((fila) => (
                      <div key={fila.clave}>
                        <dt>{etiquetaDeFila(fila.clave, t)}</dt>
                        <dd>{fila.clave === 'descuento' ? montoDeDescuento(fila.cents) : formatMXN(fila.cents)}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="ticket-digital-total">
                    <span>{t('Total del ticket')}</span>
                    <strong>{formatMXN(estado.ticket.desglose.filas.find((fila) => fila.clave === 'total')!.cents)}</strong>
                  </div>
                  <p className="ticket-digital-nota">{notaDelServicio(estado.ticket.desglose.aparte, t)}</p>
                </>
              ) : estado.ticket.apartes ? (
                /* D224 · una fila v2 cuyo impreso no se pudo deducir: como la
                   mesa con descuento, el total de los consumos y las líneas
                   aparte. Nunca un total inventado (plan D). */
                <>
                  <div className="ticket-digital-total">
                    <span>{t('Total de los consumos')}</span>
                    <strong>{formatMXN(estado.ticket.totalCents)}</strong>
                  </div>
                  <dl className="ticket-digital-desglose ticket-digital-descuento">
                    {estado.ticket.apartes.servicioCents > 0 && (
                      <div>
                        <dt>{t('Cargo por servicio')}</dt>
                        <dd>{formatMXN(estado.ticket.apartes.servicioCents)}</dd>
                      </div>
                    )}
                    {estado.ticket.apartes.descuentoCents > 0 && (
                      <div>
                        <dt>{t('Descuento')}</dt>
                        <dd>{montoDeDescuento(estado.ticket.apartes.descuentoCents)}</dd>
                      </div>
                    )}
                  </dl>
                  <p className="ticket-digital-nota">
                    {notaDelServicio({ ivaCents: 0, ...estado.ticket.apartes }, t)}
                  </p>
                </>
              ) : estado.ticket.discountCents !== undefined ? (
                /* D218 · con descuento el dueño guarda sólo los descuentos y la
                   suma de los ítems: no hay subtotal, IVA ni total impreso. Lo
                   que siempre es cierto es el total de los consumos y el
                   descuento aparte, que no se reparte (opción 1 aprobada). */
                <>
                  <div className="ticket-digital-total">
                    <span>{t('Total de los consumos')}</span>
                    <strong>{formatMXN(estado.ticket.totalCents)}</strong>
                  </div>
                  <dl className="ticket-digital-desglose ticket-digital-descuento">
                    <div>
                      <dt>{t('Descuento')}</dt>
                      <dd>{montoDeDescuento(estado.ticket.discountCents)}</dd>
                    </div>
                  </dl>
                  <p className="ticket-digital-nota">{t('El descuento no se reparte.')}</p>
                </>
              ) : (
                <>
                  {/* D209 · el subtotal y el IVA impresos, arriba del total, sólo
                      cuando el dueño los publica. Sin ellos, como antes. */}
                  {estado.ticket.totals && (
                    <dl className="ticket-digital-desglose">
                      <div>
                        <dt>{t('Subtotal')}</dt>
                        <dd>{formatMXN(estado.ticket.totals.subtotalCents)}</dd>
                      </div>
                      <div>
                        <dt>{t('IVA')}</dt>
                        <dd>{formatMXN(estado.ticket.totals.taxCents)}</dd>
                      </div>
                    </dl>
                  )}
                  <div className="ticket-digital-total">
                    <span>{t('Total del ticket')}</span>
                    {/* L1 · con IVA agregado el total de la mesa es el subtotal; el
                        del ticket es subtotal + IVA (en los dos casos, el impreso). */}
                    <strong>
                      {formatMXN(estado.ticket.totals
                        ? estado.ticket.totals.subtotalCents + estado.ticket.totals.taxCents
                        : estado.ticket.totalCents)}
                    </strong>
                  </div>
                  {estado.ticket.totals?.ivaAparte && (
                    <p className="ticket-digital-nota">
                      {notaDeLoQueNoSeReparte({ ivaCents: estado.ticket.totals.taxCents, descuentoCents: 0 }, t)}
                    </p>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}

/** D224 · el rótulo de cada fila del desglose, con los textos de «¿Cómo dividen?». */
function etiquetaDeFila(clave: FilaDelDesglose['clave'], t: (s: string, ...args: unknown[]) => string): string {
  return clave === 'subtotal' ? t('Subtotal')
    : clave === 'iva' ? t('IVA')
      : clave === 'servicio' ? t('Cargo por servicio')
        : clave === 'descuento' ? t('Descuento')
          : t('Total del ticket');
}

/**
 * D224 · la nota de lo que no se reparte, en «Ver el ticket» de una mesa con
 * cargo por servicio (plan C aprobado): la corta, como «El descuento no se
 * reparte.»; con IVA agregado también, la larga de «¿Cómo dividen?», que nombra
 * los tres.
 */
function notaDelServicio(aparte: LoQueNoSeReparte, t: (s: string, ...args: unknown[]) => string): string | null {
  if (aparte.ivaCents > 0) return notaDeLoQueNoSeReparte(aparte, t);
  if ((aparte.servicioCents ?? 0) > 0) {
    return aparte.descuentoCents > 0
      ? t('El cargo por servicio y el descuento no se reparten.')
      : t('El cargo por servicio no se reparte.');
  }
  return notaDeLoQueNoSeReparte(aparte, t);
}
