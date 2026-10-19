import { Icon } from '../components/Icon';
import { useIdioma } from '../i18n/idioma';
import { formatMXN } from '../utils/format';
import { confirmedConsumptionProgress } from '../screens/mesaItemsView';
import { mesaDeEjemploEnInicio, useEjemplo } from './ejemplo/estadoEjemplo';
import { detalleDeEjemplo } from './ejemplo/mesaDeEjemplo';
import { useGuia } from './GuiaProvider';
import { tarjetaVisible, useEnFechasDeViaje } from './inicioGuia';
import './ayuda.css';

/**
 * D363 · D364 · 2f · la tarjeta «Tutorial» de Inicio, una de las dos entradas
 * a la guía (la otra es Más → Ayuda). Tocarla abre 2a; la ✕ roja la quita sin
 * preguntar (Q1: persiste por cuenta y dispositivo). Va debajo de la invitación
 * pendiente, si la hay (Q5). No aparece dentro de las fechas de un viaje (D365),
 * con una apertura sin confirmar, a quien marcó «No volver a mostrar» (D364) ni
 * mientras se lee algo de eso: no aparece para irse después.
 *
 * Son dos botones hermanos (abrir y quitar), nunca uno dentro del otro.
 */
export function TarjetaTutorial({ aperturaPendiente }: { readonly aperturaPendiente: boolean | null }) {
  const { t } = useIdioma();
  const guia = useGuia();
  const ejemplo = useEjemplo();
  const enFechasDeViaje = useEnFechasDeViaje();
  if (!guia || !tarjetaVisible({
    noVolverAMostrar: guia.noVolverAMostrar,
    tarjetaOculta: guia.tarjetaOculta,
    enFechasDeViaje,
    aperturaPendiente,
    mesaDeEjemploEnInicio: mesaDeEjemploEnInicio(ejemplo),
  })) return null;
  return (
    <section className="tarjeta-tutorial" data-guia="tarjeta-tutorial" aria-label={t('Tutorial')}>
      <button type="button" className="tarjeta-tutorial-abrir" onClick={(e) => guia.abrir(e.currentTarget)}>
        <span className="tarjeta-tutorial-cuadro" aria-hidden="true"><Icon name="map" size={28} /></span>
        <span className="tarjeta-tutorial-titulo">{t('Tutorial')}</span>
      </button>
      <button type="button" className="tarjeta-tutorial-quitar" aria-label={t('Quitar el tutorial de Inicio')} onClick={guia.ocultarTarjeta}>
        <Icon name="x" size={18} />
      </button>
    </section>
  );
}

/**
 * D363 · D367 · 4a · la mesa de ejemplo en Inicio, en el lugar de la tarjeta
 * Tutorial: la tarjeta de una mesa abierta, con la píldora «Ejemplo» donde va el
 * estado. Dice cuánto ya se eligió de la cuenta (D367: con los pagos apagados no
 * hay nada pagado). Q6 · «Ver mesa →» hace lo mismo que «Terminar guía»: la
 * tarjeta entera es ese botón, como la de una mesa real.
 */
export function TarjetaMesaDeEjemplo() {
  const { t } = useIdioma();
  const guia = useGuia();
  const ejemplo = useEjemplo();
  if (!guia || !mesaDeEjemploEnInicio(ejemplo)) return null;
  const { mesa } = detalleDeEjemplo(ejemplo);
  const progreso = confirmedConsumptionProgress(
    mesa, mesa.division_mode === 'igual' ? (item) => item.informative_remaining_bps : undefined,
  );
  const elegido = progreso.status === 'known' ? progreso.assignedCents : 0;
  const porcentaje = progreso.status === 'known' ? progreso.visualPercent : 0;
  return (
    <section className="home-mesa home-mesa-ejemplo" aria-label={t('Mesa de ejemplo')}>
      <button type="button" className="mesa-card" data-guia="mesa-ejemplo" onClick={guia.terminar}>
        <div className="mesa-top">
          <span className="mesa-kicker">{t('Tu mesa abierta')}</span>
          <span className="badge badge-ejemplo">{t('Ejemplo')}</span>
        </div>
        <div className="mesa-name">{mesa.restaurant.name}</div>
        <div className="mesa-meta">{`${t('Mesa')} ${mesa.code} · ${t('1 persona')}`}</div>
        <div className="mesa-money">
          <span className="mesa-paid">{formatMXN(elegido)}</span>
          <span className="mesa-total">{t('de')} {formatMXN(mesa.total_cents)}</span>
        </div>
        <div className="mesa-bar" aria-hidden="true"><span style={{ width: `${porcentaje}%` }} /></div>
        <div className="mesa-foot"><span className="mesa-go">{t('Ver mesa →')}</span></div>
      </button>
    </section>
  );
}
