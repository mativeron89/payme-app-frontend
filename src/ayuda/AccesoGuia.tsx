import { Icon } from '../components/Icon';
import { useIdioma } from '../i18n/idioma';
import { useGuia } from './GuiaProvider';
import './ayuda.css';

export function AccesoGuia({ lugar }: { lugar: 'inicio' | 'ayuda' }) {
  const { t } = useIdioma();
  const guia = useGuia();
  if (!guia || (lugar === 'inicio' && !guia.oferta)) return null;
  return <section className={`ayuda-acceso ayuda-acceso--${lugar}`} aria-label={t('Ayuda')}>
    {lugar === 'ayuda' && <h2 className="ayuda-seccion">{t('Ayuda')}</h2>}
    {lugar === 'inicio' ? <div className="guia-oferta">
      <p>{t('¿Primera vez? Descubre qué hace cada control.')}</p>
      <div className="guia-oferta-acciones">
        <button type="button" className="ayuda-enlace" onClick={(e) => guia.abrir(e.currentTarget)}>{t('Ver guía')}</button>
        <button type="button" className="ayuda-enlace ayuda-enlace--muted" aria-label={t('Ocultar guía por ahora')} onClick={guia.omitir}>{t('Ahora no')}</button>
      </div>
    </div> : <button type="button" className="list-row guia-fila" onClick={(e) => guia.abrir(e.currentTarget)}>
      <Icon name="info" size={18} /><span>{t('Cómo usar PayMe')}</span><Icon name="arrow-right" size={16} />
    </button>}
  </section>;
}
