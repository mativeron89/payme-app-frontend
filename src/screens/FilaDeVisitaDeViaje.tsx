import { useIdioma } from '../i18n/idioma';
import type { VisitaDeViaje } from '../api/viajesVisitas';
import type { EstadoDeFoto } from '../api/fotosDeTickets';
import { navigate } from '../router';
import { formatMXN } from '../utils/format';
import { BotonDeMiniatura, FilaDeTicket } from '../components/VisorDelTicket';
import { InsigniaDelViaje } from './viajes/InsigniaDelViaje';
import { iconoTipoLugar, nombreDelLugar, parametroDeTicket } from './viajes/viajesView';

/**
 * D293 · un restaurante, bar o café de un viaje en la lista de Mesas, junto a las mesas y por fecha.
 *
 * Mati eligió «Sí, con el nombre del viaje (Recomendada)». A la derecha, lo que me toca con el mismo texto del ticket
 * del viaje («Te toca»), el monto que publica el dueño (`te_toca_cents`, igual al del ticket y al de Estadísticas).
 *
 * D481 · 8 · la misma fila que una mesa (Mati aceptó las ocho recomendaciones): la columna de 44 con la miniatura si
 * hay (`visitas[].ticket_image`) o el ícono del tipo de lugar, el lugar (o su tipo, si el ticket no lo leyó) y, debajo,
 * la insignia del viaje con su nombre, que es lo que la distingue de una mesa. Sin la fecha, como la fila de mesa.
 *
 * Tocarla abre el ticket dentro del viaje (`/viaje-ticket/<viaje>.<ticket>`), abierto o cerrado; la miniatura, el
 * visor. No tiene el gesto de «Eliminar»: el dueño no ofrece ocultar un ticket de viaje (el ocultamiento, D238, es de
 * mesas).
 */
export function FilaDeVisitaDeViaje({ visita, foto, miniatura, onVerFoto }: {
  visita: VisitaDeViaje;
  /** La URL de la foto del viaje, si tiene y ya llegó. */
  foto: string | null;
  /** D481 · 8 · la miniatura del ticket, si hay foto (con la capacidad encendida). */
  miniatura?: { readonly url: string | null; readonly estado: EstadoDeFoto } | null;
  onVerFoto?: (boton: HTMLButtonElement) => void;
}) {
  const { t } = useIdioma();
  const nombre = nombreDelLugar(visita.lugar, visita.tipo_lugar, t);
  const icono = iconoTipoLugar(visita.tipo_lugar);
  return (
    <div className="hist-item vj-visita fila-ticket-item">
      <FilaDeTicket
        icono={icono}
        nombre={nombre}
        etiqueta={t('Te toca')}
        monto={formatMXN(visita.te_toca_cents)}
        extra={(
          <span className="vj-visita-viaje">
            <InsigniaDelViaje nombre={visita.viaje.nombre} color={visita.viaje.color} foto={foto} marca />
            <span className="vj-visita-viaje-nombre">{visita.viaje.nombre}</span>
          </span>
        )}
        miniatura={miniatura && onVerFoto ? (
          <BotonDeMiniatura nombre={nombre} url={miniatura.url} estado={miniatura.estado} icono={icono} onAbrir={onVerFoto} />
        ) : undefined}
        onAbrir={() => navigate('viaje-ticket', parametroDeTicket(visita.viaje.id, visita.ticket_id))}
      />
    </div>
  );
}
