import { useEffect, useRef, useState, type RefObject } from 'react';
import { api } from '../api';
import { extractApiError } from '../api/errors';
import { isCurrentSession, loadSession } from '../api/storage';
import { useAuth } from '../auth/AuthContext';
import { useIdioma } from '../i18n/idioma';
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
              <div className="ticket-digital-total">
                <span>{t('Total del ticket')}</span>
                <strong>{formatMXN(estado.ticket.totalCents)}</strong>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
