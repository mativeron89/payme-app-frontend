import type { DetalleViaje } from '../../api/viajes';
import { useAuth } from '../../auth/AuthContext';
import { AppBottomBar } from '../../components/AppBottomBar';
import { AppHeaderBack } from '../../components/AppHeader';
import { Icon } from '../../components/Icon';
import { useIdioma } from '../../i18n/idioma';
import { goBack, navigate } from '../../router';
import { formatMXN } from '../../utils/format';
import { fullName } from '../../utils/identity';
import { AvatarDeViaje, EstadoSinViaje, useDetalleViaje, type CargaDeViaje } from './ViajeScreen';
import { avisoSinRepartir, faltaElegirEn, rotuloDeBalance, tonoDeBalance } from './viajeView';
import { nombreDeMiembro } from './viajesView';
import './viajes.css';
import './viaje.css';

/**
 * AF-VIAJES · D242 · el balance en vivo (1l, `/viaje-balance/<id>`): una fila
 * por miembro con «Debe» / «Le deben» y su monto, tal como lo publica el dueño.
 * Nunca qué eligió otro: sólo cuánto debe o le deben. Lo que nadie eligió
 * todavía va en una nota aparte. Cerrado, el balance de los demás no se ve
 * (D240-17): la ruta pasa al detalle de Cerrados.
 */
export function BalanceScreen({ viajeId }: { viajeId: string }) {
  const { session } = useAuth();
  const { carga, cargar } = useDetalleViaje(viajeId);
  return (
    <div className="screen has-appbar">
      <AppHeaderBack userName={fullName(session) ?? undefined} onBack={() => goBack('viaje', viajeId)} />
      <BalanceVista carga={carga} onReintentar={cargar} onVerViajes={() => navigate('viajes', 'abiertos')} />
      <AppBottomBar active={null} />
    </div>
  );
}

export function BalanceVista({
  carga,
  onReintentar,
  onVerViajes,
}: {
  carga: CargaDeViaje;
  onReintentar: () => void;
  onVerViajes: () => void;
}) {
  const { t } = useIdioma();
  const viaje = carga.tipo === 'listo' ? carga.viaje : null;
  return (
    <>
      <div className="title-card">
        <h1 className="title-card-title">{t('Balance')}</h1>
        {viaje && <div className="title-card-sub">{t('{0} · se actualiza con cada ticket', viaje.nombre)}</div>}
      </div>
      <div className="scroll vj-scroll">
        {carga.tipo === 'listo' ? (
          <ListaDeBalance viaje={carga.viaje} />
        ) : (
          <EstadoSinViaje carga={carga} onReintentar={onReintentar} onVerViajes={onVerViajes} />
        )}
      </div>
    </>
  );
}

function ListaDeBalance({ viaje: v }: { viaje: DetalleViaje }) {
  const { t, idioma } = useIdioma();
  return (
    <>
      <ul className="vj-card vjb-lista">
        {v.miembros.map((m) => {
          const rotulo = rotuloDeBalance(m, t);
          const falta = faltaElegirEn(m.falta_elegir, t);
          return (
            <li key={m.id} className="vjb-fila">
              <AvatarDeViaje persona={m} />
              <span className="vjb-quien">
                <span className="vjb-nombre">{nombreDeMiembro(m, t)}</span>
                {falta && <span className="vjb-falta">{falta}</span>}
              </span>
              {rotulo !== null && m.balance_cents !== null && (
                <span className="vjb-monto">
                  <span className={`vjb-rotulo ${tonoDeBalance(m.balance_cents)}`}>{rotulo}</span>
                  {m.balance_cents !== 0 && <span className="vjb-cifra">{formatMXN(Math.abs(m.balance_cents))}</span>}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {v.sin_repartir.map((s) => (
        <p key={s.ticket_id} className="vjb-aviso">
          <Icon name="warning" size={18} />
          <span>{avisoSinRepartir(s, v, t, idioma, formatMXN)}</span>
        </p>
      ))}
      <p className="vj-nota vjv-nota-sola">
        <Icon name="info" size={18} />
        <span>{t('Ves cuánto debe o le deben a cada uno. Lo que eligió cada quien solo lo ve esa persona.')}</span>
      </p>
    </>
  );
}
