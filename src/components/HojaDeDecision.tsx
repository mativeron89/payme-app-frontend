import { useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useHojaModal } from './useHojaModal';

export function HojaDeDecision({ titulo, detalle, cancelar, onCancelar, children }: {
  titulo: string;
  detalle: string;
  cancelar: string;
  onCancelar: () => void;
  children: ReactNode;
}) {
  const id = useId();
  const hoja = useRef<HTMLDivElement>(null);
  const botonCancelar = useRef<HTMLButtonElement>(null);
  useHojaModal(hoja, botonCancelar, onCancelar);

  return createPortal(
    <div className="sheet-overlay" onClick={onCancelar}>
      <div ref={hoja} className="sheet hoja-de-decision" role="dialog" aria-modal="true"
        aria-labelledby={id} aria-describedby={`${id}-detalle`} onClick={(e) => e.stopPropagation()}>
        <h2 id={id}>{titulo}</h2>
        <p id={`${id}-detalle`}>{detalle}</p>
        {children}
        <button ref={botonCancelar} type="button" className="btn btn-ghost" onClick={onCancelar}>{cancelar}</button>
      </div>
    </div>,
    document.body,
  );
}
