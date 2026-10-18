import { useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useIdioma } from '../i18n/idioma';
import { useHojaModal } from './useHojaModal';

/**
 * D360-4b · «En la burbuja de la mesa, arriba a la izquierda tiene que haber un
 * engranaje de configuración, eso abre el código para unirse y la propina (para
 * poder modificarla)» (literal de Mati).
 *
 * La hoja que abre el engranaje de «Tu mesa» (sólo el organizador): el código
 * para unirse, como texto para dictarlo, y el selector de la propina de la mesa
 * (D344), el mismo de «Compartir la mesa». Es modal (`useHojaModal`: foco
 * adentro, Escape cierra, la pantalla de atrás inerte), como «Antes de cerrar».
 *
 * No decide nada: el selector y su `PUT /tip` siguen siendo de `MesaScreen` y
 * `propinaDeLaMesa.ts`; acá sólo se dibujan.
 */
export function HojaDeLaMesa({
  codigo,
  propina,
  onCerrar,
}: {
  /** El código para unirse, o `null` si la mesa ya no recibe gente. */
  codigo: string | null;
  /** El selector de la propina de la mesa, o `null` si no se puede cambiar. */
  propina: ReactNode;
  onCerrar: () => void;
}) {
  const { t } = useIdioma();
  const hoja = useRef<HTMLDivElement | null>(null);
  const cerrar = useRef<HTMLButtonElement | null>(null);
  useHojaModal(hoja, cerrar, onCerrar);
  return createPortal(
    <div className="sheet-overlay" onClick={onCerrar}>
      <div
        ref={hoja}
        className="sheet hoja-de-la-mesa"
        role="dialog"
        aria-modal="true"
        aria-label={t('Configuración de la mesa')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-head">
          <span className="sheet-title">{t('Configuración de la mesa')}</span>
          <button ref={cerrar} type="button" className="sheet-close" aria-label={t('Cerrar')} onClick={onCerrar}>✕</button>
        </div>
        {codigo !== null && (
          <p className="mesa-codigo-para-unirse">
            {t('Código para unirse:')} <strong>{codigo}</strong>
          </p>
        )}
        {propina}
      </div>
    </div>,
    document.body,
  );
}
