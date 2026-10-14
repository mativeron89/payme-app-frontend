import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { Icon } from '../components/Icon';
import { useIdioma } from '../i18n/idioma';
import { almacenDeGuia, preferenciaGuia } from './preferenciaGuia';
import { useGuia } from './GuiaProvider';
import './ayuda.css';

export function AccesoGuia({ lugar }: { lugar: 'inicio' | 'ayuda' }) {
  const { session } = useAuth();
  if (!session) return null;
  return <AccesoDeCuenta key={`${session.principal_id}:${session.family_id}`} principal={session.principal_id} lugar={lugar} />;
}
function AccesoDeCuenta({ principal, lugar }: { principal: string; lugar: 'inicio' | 'ayuda' }) {
  const { t } = useIdioma();
  const guia = useGuia();
  const [vista, setVista] = useState<boolean | null>(null);
  useEffect(() => {
    let vigente = true;
    void preferenciaGuia.vista(principal, almacenDeGuia()).then((v) => { if (vigente) setVista(v); });
    return () => { vigente = false; };
  }, [principal]);
  function recordar() { setVista(true); void preferenciaGuia.marcar(principal, almacenDeGuia()); }
  if (lugar === 'inicio' && vista !== false) return null;
  return <section className={`ayuda-acceso ayuda-acceso--${lugar}`} aria-label={t('Ayuda')}>
    {lugar === 'ayuda' && <h2 className="ayuda-seccion">{t('Ayuda')}</h2>}
    {lugar === 'inicio' ? <div className="guia-oferta">
      <p>{t('¿Primera vez? Descubre qué hace cada control.')}</p>
      <div className="guia-oferta-acciones">
        <button type="button" className="ayuda-enlace" onClick={(e) => { recordar(); guia?.abrir(e.currentTarget); }}>{t('Ver guía')}</button>
        <button type="button" className="ayuda-enlace ayuda-enlace--muted" aria-label={t('Ocultar guía por ahora')} onClick={() => {
          recordar(); document.querySelector<HTMLElement>('.appbar-center')?.focus({ preventScroll: true });
        }}>{t('Ahora no')}</button>
      </div>
    </div> : <button type="button" className="list-row guia-fila" onClick={(e) => { recordar(); guia?.abrir(e.currentTarget); }}>
      <Icon name="info" size={18} /><span>{t('Cómo usar PayMe')}</span><Icon name="arrow-right" size={16} />
    </button>}
  </section>;
}
