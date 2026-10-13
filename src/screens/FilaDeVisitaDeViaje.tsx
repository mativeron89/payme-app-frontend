import { useIdioma } from '../i18n/idioma';
import type { VisitaDeViaje } from '../api/viajesVisitas';
import { navigate } from '../router';
import { formatMXN } from '../utils/format';
import { personalDateLabel } from '../utils/personalDates';
import { Icon } from '../components/Icon';
import { InsigniaDelViaje } from './viajes/InsigniaDelViaje';
import { etiquetaTipoLugar, iconoTipoLugar, nombreDelLugar, parametroDeTicket } from './viajes/viajesView';

/**
 * D293 · un restaurante, bar o café de un viaje en la lista de Mesas, junto a las mesas y por fecha.
 *
 * Mati eligió «Sí, con el nombre del viaje (Recomendada)». Como un renglón de mesa: el ícono del tipo de lugar, el lugar
 * (o su tipo, si el ticket no lo leyó) y la fecha del instante. Debajo, la marca del viaje: su foto o su inicial sobre
 * su color, con su nombre. A la derecha, lo que me toca con el mismo texto del ticket del viaje («Te toca»), el monto que
 * publica el dueño (`te_toca_cents`, igual al del ticket y al de Estadísticas).
 *
 * Tocarlo abre el ticket dentro del viaje (`/viaje-ticket/<viaje>.<ticket>`), abierto o cerrado. No tiene el gesto de
 * «Eliminar»: el dueño no ofrece ocultar un ticket de viaje (el ocultamiento, D238, es de mesas).
 */
export function FilaDeVisitaDeViaje({ visita, foto, zona }: {
  visita: VisitaDeViaje;
  /** La URL de la foto del viaje, si tiene y ya llegó. */
  foto: string | null;
  zona: string | null;
}) {
  const { t, locale } = useIdioma();
  const tipo = etiquetaTipoLugar(visita.tipo_lugar, t);
  return (
    <div className="hist-item vj-visita">
      <button
        type="button"
        className="hist-row"
        onClick={() => navigate('viaje-ticket', parametroDeTicket(visita.viaje.id, visita.ticket_id))}
      >
        <span aria-hidden="true">
          <Icon name={iconoTipoLugar(visita.tipo_lugar)} size={22} scale="list" />
        </span>
        <div className="hist-main">
          <div className="hist-rest">{nombreDelLugar(visita.lugar, visita.tipo_lugar, t)}</div>
          <div className="hist-meta">
            {personalDateLabel(visita.instante, locale, zona, t)}
            {/* Sin nombre del lugar, el tipo ya es el título: no se repite. */}
            {visita.lugar !== null && <>{' · '}{tipo}</>}
          </div>
          <div className="vj-visita-viaje">
            <InsigniaDelViaje nombre={visita.viaje.nombre} color={visita.viaje.color} foto={foto} marca />
            <span className="vj-visita-viaje-nombre">{visita.viaje.nombre}</span>
          </div>
        </div>
        <div className="vj-visita-monto">
          <span className="vj-visita-rotulo">{t('Te toca')}</span>
          <span className="hist-amt">{formatMXN(visita.te_toca_cents)}</span>
        </div>
        <span className="hist-chevron" aria-hidden="true">
          <Icon name="chevron-right" size={20} />
        </span>
      </button>
    </div>
  );
}
