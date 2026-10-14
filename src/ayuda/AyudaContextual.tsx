import { useIdioma } from '../i18n/idioma';
import './ayuda.css';

export function AyudaDePorciones() {
  const { t } = useIdioma();
  return <details className="ayuda-contextual"><summary>{t('¿Compartieron un plato?')}</summary><p>{t('Elige sólo tu porción: ½ si comiste la mitad, ⅓ si comiste un tercio. Cada persona confirma lo suyo. Las opciones dependen de lo disponible.')}</p></details>;
}

export function AyudaDeBalance() {
  const { t } = useIdioma();
  return <details className="ayuda-contextual"><summary>{t('¿Qué significa mi balance?')}</summary><p>{t('Es lo que pagaste menos lo que te corresponde consumir. A favor: pusiste de más. En negativo: te falta cubrir esa parte. Puede cambiar mientras cargan gastos o eligen consumos.')}</p><p>{t('Al cerrar el viaje se proponen transferencias entre personas. PayMe no mueve ese dinero: el pago y su confirmación se hacen por separado.')}</p></details>;
}
