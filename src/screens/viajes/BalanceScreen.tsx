import { useState } from 'react';
import type { DetalleViaje } from '../../api/viajes';
import { useAuth } from '../../auth/AuthContext';
import { AppBottomBar } from '../../components/AppBottomBar';
import { AppHeaderBack, BubbleTabs } from '../../components/AppHeader';
import { Icon } from '../../components/Icon';
import { useIdioma } from '../../i18n/idioma';
import { goBack, navigate } from '../../router';
import { formatMXN } from '../../utils/format';
import { fullName } from '../../utils/identity';
import { AvatarDeViaje, EstadoSinViaje, useDetalleViaje, type CargaDeViaje } from './ViajeScreen';
import { metaDelTicket } from './viajeView';
import { iconoTipoLugar, nombreDelLugar, nombreDeMiembro, parametroDeTicket } from './viajesView';
import './viajes.css';
import './viaje.css';

/**
 * D245-6 · Balance (`/viaje-balance/<id>`): la burbuja dice sólo «Balance» y
 * debajo dos opciones, como las burbujas de Inicio (el mismo `BubbleTabs`):
 * - **Consumos** (primero): los tickets y gastos del viaje, el más nuevo arriba,
 *   con lugar o descripción, fecha, quién pagó y el total. Al tocarlo abre el
 *   ticket como antes. Nunca qué eligió cada uno.
 * - **Miembros** (segundo): cada miembro con lo que pagó (Mati: «Lo que pagó»),
 *   que publica el dueño. La app no lo calcula.
 * Cerrado, la ruta pasa al detalle de Cerrados (D240-17).
 */
export type OpcionDeBalance = 'consumos' | 'miembros';

export function BalanceScreen({ viajeId }: { viajeId: string }) {
  const { session } = useAuth();
  const { carga, cargar } = useDetalleViaje(viajeId);
  const [opcion, setOpcion] = useState<OpcionDeBalance>('consumos');
  return (
    <div className="screen has-appbar">
      <AppHeaderBack userName={fullName(session) ?? undefined} onBack={() => goBack('viaje', viajeId)} />
      <BalanceVista
        carga={carga}
        opcion={opcion}
        onOpcion={setOpcion}
        onReintentar={cargar}
        onVerViajes={() => navigate('viajes', 'abiertos')}
        onAbrirTicket={(ticketId) => navigate('viaje-ticket', parametroDeTicket(viajeId, ticketId))}
      />
      <AppBottomBar active={null} />
    </div>
  );
}

export function BalanceVista({
  carga,
  opcion,
  onOpcion,
  onReintentar,
  onVerViajes,
  onAbrirTicket,
}: {
  carga: CargaDeViaje;
  opcion: OpcionDeBalance;
  onOpcion: (o: OpcionDeBalance) => void;
  onReintentar: () => void;
  onVerViajes: () => void;
  onAbrirTicket: (ticketId: string) => void;
}) {
  const { t } = useIdioma();
  return (
    <>
      <div className="title-card">
        <h1 className="title-card-title">{t('Balance')}</h1>
      </div>
      <div className="scroll vj-scroll">
        {carga.tipo === 'listo' ? (
          <div>
            <div className="vjb-banda">
              <BubbleTabs
                tabs={[{ id: 'consumos', label: t('Consumos') }, { id: 'miembros', label: t('Miembros') }]}
                active={opcion}
                onSelect={(id) => onOpcion(id as OpcionDeBalance)}
              />
            </div>
            <div className={`vjb-tarjeta ${opcion === 'consumos' ? 'seam-left' : 'seam-right'}`}>
              {opcion === 'consumos'
                ? <Consumos viaje={carga.viaje} onAbrirTicket={onAbrirTicket} />
                : <Miembros viaje={carga.viaje} />}
            </div>
          </div>
        ) : (
          <EstadoSinViaje carga={carga} onReintentar={onReintentar} onVerViajes={onVerViajes} />
        )}
      </div>
    </>
  );
}

function Consumos({ viaje: v, onAbrirTicket }: { viaje: DetalleViaje; onAbrirTicket: (ticketId: string) => void }) {
  const { t, idioma } = useIdioma();
  if (v.tickets.length === 0) return <p className="vjb-vacio">{t('Todavía no hay consumos.')}</p>;
  return (
    <ul className="vjb-consumos">
      {v.tickets.map((tk) => (
        <li key={tk.id}>
          <button type="button" className="vjb-consumo" onClick={() => onAbrirTicket(tk.id)}>
            <span className="vjv-ticket-icono">
              <Icon name={iconoTipoLugar(tk.tipo_lugar)} size={22} />
            </span>
            <span className="vjb-consumo-main">
              <span className="vjb-consumo-lugar">{nombreDelLugar(tk.lugar, tk.tipo_lugar, t)}</span>
              <span className="vjb-consumo-meta">{metaDelTicket(tk, v.miembros, t, idioma)}</span>
              {tk.falta_que_elija > 0 && (
                <span className="vjv-chip vjv-chip-aviso">{t('Falta que elija {0}', tk.falta_que_elija)}</span>
              )}
            </span>
            <span className="vjb-consumo-monto">{formatMXN(tk.te_toca_cents)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Miembros({ viaje: v }: { viaje: DetalleViaje }) {
  const { t } = useIdioma();
  return (
    <ul className="vjb-miembros">
      {v.miembros.map((m) => (
        <li key={m.id} className="vjb-fila">
          <AvatarDeViaje persona={m} />
          <span className="vjb-quien">
            <span className="vjb-nombre">{nombreDeMiembro(m, t)}</span>
          </span>
          <span className="vjb-monto">
            <span className="vjb-rotulo">{t('Pagó')}</span>
            <span className="vjb-cifra">—</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
