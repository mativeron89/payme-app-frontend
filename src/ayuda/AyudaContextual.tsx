import { useIdioma } from '../i18n/idioma';
import './ayuda.css';

export function AyudaDeBalance() {
  const { t } = useIdioma();
  return <details className="ayuda-contextual"><summary>{t('¿Qué significa mi balance?')}</summary><p>{t('Es lo que pagaste menos lo que te corresponde consumir. A favor: pusiste de más. En negativo: te falta cubrir esa parte. Puede cambiar mientras cargan gastos o eligen consumos.')}</p><p>{t('Al cerrar el viaje se proponen transferencias entre personas. PayMe no mueve ese dinero: el pago y su confirmación se hacen por separado.')}</p></details>;
}
