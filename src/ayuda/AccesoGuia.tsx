import { useId, useState } from 'react';
import { Icon } from '../components/Icon';
import { useIdioma } from '../i18n/idioma';
import { useAperturaPendiente } from './aperturaPendiente';
import { useGuia } from './GuiaProvider';
import { estadoDeLaAyuda, useEnFechasDeViaje } from './inicioGuia';
import './ayuda.css';

/**
 * Más → Ayuda → «Cómo usar PayMe» (1o). D364 · es, con la tarjeta Tutorial de
 * Inicio, la única entrada a la guía: la oferta «¿Primera vez?…» de Inicio ya
 * no existe.
 *
 * Q9 · dentro de las fechas de un viaje se ve deshabilitada, con la línea que
 * dice por qué: ahí Escanear lleva al ticket del viaje. Con una apertura de mesa
 * sin confirmar se ve, pero el ejemplo no arranca y en su lugar sale un aviso.
 */
export function AccesoGuia() {
  const { t } = useIdioma();
  const guia = useGuia();
  const estado = estadoDeLaAyuda({ enFechasDeViaje: useEnFechasDeViaje(), aperturaPendiente: useAperturaPendiente() });
  const [avisar, setAvisar] = useState(false);
  const idNota = useId();
  if (!guia) return null;
  const nota = estado === 'en-viaje'
    ? t('Disponible fuera de las fechas de un viaje')
    : estado === 'apertura-pendiente' && avisar ? t('Primero resuelve la mesa que dejaste sin confirmar en Inicio.') : null;
  return <section className="ayuda-acceso ayuda-acceso--ayuda" aria-label={t('Ayuda')}>
    <h2 className="ayuda-seccion">{t('Ayuda')}</h2>
    <button
      type="button"
      className="list-row guia-fila"
      disabled={estado === 'en-viaje' || estado === 'sin-saber'}
      aria-describedby={nota ? idNota : undefined}
      onClick={(e) => {
        if (estado === 'apertura-pendiente') { setAvisar(true); return; }
        guia.abrir(e.currentTarget);
      }}
    >
      <Icon name="info" size={18} /><span>{t('Cómo usar PayMe')}</span><Icon name="arrow-right" size={16} />
    </button>
    {nota && <p id={idNota} className="ayuda-nota" role={estado === 'apertura-pendiente' ? 'status' : undefined}>{nota}</p>}
  </section>;
}
