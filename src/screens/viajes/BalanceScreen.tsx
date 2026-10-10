import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../../api';
import { errorAlEliminar, type DetalleViaje, type TicketEnViaje } from '../../api/viajes';
import { useAuth } from '../../auth/AuthContext';
import { AppBottomBar } from '../../components/AppBottomBar';
import { AppHeaderBack, BubbleTabs, MountedCard } from '../../components/AppHeader';
import { FilaDeslizable } from '../../components/FilaDeslizable';
import { Icon } from '../../components/Icon';
import { useToast } from '../../components/ui';
import { useIdioma } from '../../i18n/idioma';
import { goBack, navigate } from '../../router';
import { formatMXN } from '../../utils/format';
import { fullName } from '../../utils/identity';
import { AvatarDeViaje, EstadoSinViaje, useDetalleViaje, useFotosDeMiembros, type CargaDeViaje } from './ViajeScreen';
import { circuloDelViaje } from './circuloDelViaje';
import { iconoTipoLugar, nombreDelLugar, nombreDeMiembro, parametroDeTicket } from './viajesView';
import './viajes.css';
import './viaje.css';

/**
 * D245-6 · Balance (`/viaje-balance/<id>`): dos opciones, como las burbujas de
 * Inicio (el mismo `BubbleTabs`).
 * D255-3 · sin la burbuja «Balance»: Consumos y Miembros van en la cabecera,
 * como Cuenta · Estadísticas · Viajes en Inicio, y su contenido en la tarjeta
 * blanca montada debajo:
 * - **Consumos** (primero): los tickets y gastos del viaje, el más nuevo arriba,
 *   con lugar o descripción y el total. D262 · sin la fecha ni quién pagó: eso se
 *   ve al entrar. Al tocarlo abre el ticket como antes. Nunca qué eligió cada uno.
 * - **Miembros** (segundo): cada miembro, con su foto si la tiene, y lo que
 *   pagó (Mati: «Lo que pagó»): `pagado_cents` del dueño. La app no lo calcula.
 * El total de cada consumo y lo que pagó cada uno llegan con `viaje_version=2`
 * (App Backend 2.172.0).
 * Cerrado, la ruta pasa al detalle de Cerrados (D240-17).
 *
 * D256 · en Consumos, deslizar a la izquierda un ticket o un gasto deja ver
 * «Eliminar» en rojo, como en Mesas (`FilaDeslizable`, D239), sólo donde el
 * dueño dice `puede_eliminar` (quien lo cargó o quien lo pagó, con el viaje
 * abierto). Se elimina sin otra confirmación (Mati descartó la extra) y la
 * pantalla se actualiza con el viaje de la respuesta.
 */
export type OpcionDeBalance = 'consumos' | 'miembros';

export function BalanceScreen({ viajeId }: { viajeId: string }) {
  const { t } = useIdioma();
  const { session } = useAuth();
  const { carga, cargar, mostrar, refrescar, noDisponible } = useDetalleViaje(viajeId);
  const [opcion, setOpcion] = useState<OpcionDeBalance>('consumos');
  const fotoDe = useFotosDeMiembros(viajeId, carga.tipo === 'listo' ? carga.viaje.miembros : null);
  const toast = useToast();
  const [abierta, setAbierta] = useState<string | null>(null);
  const eliminando = useRef(false);
  const vivo = useRef(true);
  useEffect(() => {
    vivo.current = true;
    return () => { vivo.current = false; };
  }, []);

  async function eliminar(tk: TicketEnViaje) {
    if (eliminando.current) return;
    eliminando.current = true;
    setAbierta(null);
    try {
      const v = await api.eliminarTicketDeViaje(viajeId, tk.id);
      if (!vivo.current) return;
      mostrar(v);
      toast(tk.origen === 'manual' ? t('Gasto eliminado') : t('Ticket eliminado'), { sobreLaBarra: true });
    } catch (err) {
      if (!vivo.current) return;
      const e = errorAlEliminar(err);
      if (e.tipo === 'no_disponible') {
        noDisponible();
        return;
      }
      // Lo que vio cambió (otro lo eliminó, se cerró el viaje o ya no puede): se vuelve a pedir.
      if (e.tipo === 'ticket_no_encontrado' || e.tipo === 'no_abierto' || e.tipo === 'eliminar_prohibido') void refrescar();
      toast(
        e.tipo === 'ticket_no_encontrado' ? t('Ya no estaba')
          : e.tipo === 'no_abierto' ? t('El viaje ya no está abierto')
            : e.tipo === 'eliminar_prohibido' ? t('Sólo pueden eliminarlo quien lo cargó o quien lo pagó.')
              : t('No pudimos eliminarlo. Prueba de nuevo.'),
        { sobreLaBarra: true },
      );
    } finally {
      eliminando.current = false;
    }
  }

  return (
    <div className="screen has-appbar">
      <AppHeaderBack
        userName={fullName(session) ?? undefined}
        onBack={() => goBack('viaje', viajeId)}
        tabs={<PestanasDeBalance opcion={opcion} onOpcion={setOpcion} />}
      />
      <BalanceVista
        carga={carga}
        opcion={opcion}
        onReintentar={cargar}
        onVerViajes={() => navigate('viajes', 'abiertos')}
        onAbrirTicket={(ticketId) => navigate('viaje-ticket', parametroDeTicket(viajeId, ticketId))}
        fotoDe={fotoDe}
        deslizar={{ abierta, onAbrir: setAbierta, onCerrar: () => setAbierta(null), onEliminar: (tk) => void eliminar(tk) }}
      />
      {/* D250 · desde Balance de un viaje abierto, el círculo escanea para ese viaje. */}
      <AppBottomBar active={null} center={circuloDelViaje(carga.tipo === 'listo' ? carga.viaje : null, t)} />
    </div>
  );
}

export function PestanasDeBalance({ opcion, onOpcion }: { opcion: OpcionDeBalance; onOpcion: (o: OpcionDeBalance) => void }) {
  const { t } = useIdioma();
  return (
    <BubbleTabs
      tabs={[{ id: 'consumos', label: t('Consumos') }, { id: 'miembros', label: t('Miembros') }]}
      active={opcion}
      onSelect={(id) => onOpcion(id as OpcionDeBalance)}
    />
  );
}

/** D256 · el gesto de eliminar en Consumos: qué fila tiene «Eliminar» a la vista (una sola) y qué hacer al tocarlo. */
export interface DeslizarConsumo {
  readonly abierta: string | null;
  readonly onAbrir: (ticketId: string) => void;
  readonly onCerrar: () => void;
  readonly onEliminar: (tk: TicketEnViaje) => void;
}

export function BalanceVista({
  carga,
  opcion,
  onReintentar,
  onVerViajes,
  onAbrirTicket,
  fotoDe,
  deslizar,
}: {
  carga: CargaDeViaje;
  opcion: OpcionDeBalance;
  onReintentar: () => void;
  onVerViajes: () => void;
  onAbrirTicket: (ticketId: string) => void;
  fotoDe?: (miembroId: string) => string | null;
  deslizar?: DeslizarConsumo;
}) {
  return (
    <div className="scroll">
      <MountedCard seam={opcion === 'consumos' ? 'left' : 'right'} className="vjb-tarjeta">
        {carga.tipo === 'listo' ? (
          opcion === 'consumos'
            ? <Consumos viaje={carga.viaje} onAbrirTicket={onAbrirTicket} deslizar={deslizar} />
            : <Miembros viaje={carga.viaje} fotoDe={fotoDe} />
        ) : (
          <EstadoSinViaje carga={carga} onReintentar={onReintentar} onVerViajes={onVerViajes} />
        )}
      </MountedCard>
    </div>
  );
}

function Consumos({ viaje: v, onAbrirTicket, deslizar }: {
  viaje: DetalleViaje;
  onAbrirTicket: (ticketId: string) => void;
  deslizar?: DeslizarConsumo;
}) {
  const { t } = useIdioma();
  if (v.tickets.length === 0) return <p className="vjb-vacio">{t('Todavía no hay consumos.')}</p>;
  return (
    <ul className="vjb-consumos">
      {v.tickets.map((tk) => (
        <li key={tk.id}>
          <ConGesto tk={tk} deslizar={deslizar} nombre={nombreDelLugar(tk.lugar, tk.tipo_lugar, t)}>
            <button type="button" className="vjb-consumo" onClick={() => onAbrirTicket(tk.id)}>
              <span className="vjv-ticket-icono">
                <Icon name={iconoTipoLugar(tk.tipo_lugar)} size={22} />
              </span>
              <span className="vjb-consumo-main">
                <span className="vjb-consumo-lugar">{nombreDelLugar(tk.lugar, tk.tipo_lugar, t)}</span>
                {tk.falta_que_elija > 0 && (
                  <span className="vjv-chip vjv-chip-aviso">{t('Falta que elija {0}', tk.falta_que_elija)}</span>
                )}
              </span>
              {/* Respuesta A del plan: el total del ticket o del gasto (`monto_cents`). */}
              <span className="vjb-consumo-monto">{formatMXN(tk.monto_cents)}</span>
            </button>
          </ConGesto>
        </li>
      ))}
    </ul>
  );
}

/** D256 · el gesto sólo donde el dueño dice `puede_eliminar`; si no, la fila de siempre, que no se desliza. */
function ConGesto({ tk, deslizar, nombre, children }: {
  tk: TicketEnViaje;
  deslizar?: DeslizarConsumo;
  nombre: string;
  children: ReactNode;
}) {
  if (!deslizar || !tk.puede_eliminar) return <>{children}</>;
  return (
    <FilaDeslizable
      abierta={deslizar.abierta === tk.id}
      onAbrir={() => deslizar.onAbrir(tk.id)}
      onCerrar={deslizar.onCerrar}
      nombre={nombre}
      onEliminar={() => deslizar.onEliminar(tk)}
    >
      {children}
    </FilaDeslizable>
  );
}

function Miembros({ viaje: v, fotoDe }: { viaje: DetalleViaje; fotoDe?: (miembroId: string) => string | null }) {
  const { t } = useIdioma();
  return (
    <ul className="vjb-miembros">
      {v.miembros.map((m) => (
        <li key={m.id} className="vjb-fila">
          <AvatarDeViaje persona={m} foto={fotoDe?.(m.id) ?? null} />
          <span className="vjb-quien">
            <span className="vjb-nombre">{nombreDeMiembro(m, t)}</span>
          </span>
          <span className="vjb-monto">
            <span className="vjb-rotulo">{t('Pagó')}</span>
            {/* `null` sólo para los demás en un viaje cerrado, que no llega acá (Cerrados es otra pantalla). */}
            <span className="vjb-cifra">{m.pagado_cents === null ? '—' : formatMXN(m.pagado_cents)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
