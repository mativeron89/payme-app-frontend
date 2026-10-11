import { useIdioma } from '../../i18n/idioma';
import { formatMXN } from '../../utils/format';
import { montoDeDescuento } from '../desgloseDelTicket';
import type { FilaDelTotal } from './ticketView';

/**
 * D278-2 · D284 · cómo se llega al total impreso de un ticket del viaje: los platos y lo que el recibo trae aparte (el
 * IVA, el cargo por servicio y el descuento), con los rótulos de «Ver el ticket» de las mesas. Sin ajustes, nada.
 */
export function FilasDelTotal({ filas }: { filas: readonly FilaDelTotal[] }) {
  const { t } = useIdioma();
  if (filas.length === 0) return null;
  return (
    <dl className="vjt-ajustes">
      {filas.map((f) => (
        <div key={f.clave} className="vjt-ajuste">
          <dt>
            {f.clave === 'platos' ? t('Platos')
              : f.clave === 'iva' ? t('IVA')
                : f.clave === 'servicio' ? t('Cargo por servicio')
                  : t('Descuento')}
          </dt>
          <dd>{f.clave === 'descuento' ? montoDeDescuento(f.cents) : formatMXN(f.cents)}</dd>
        </div>
      ))}
    </dl>
  );
}
