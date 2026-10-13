import type { ResumenDeNotas } from '../../api/viajes';
import { Icon } from '../../components/Icon';
import { useIdioma } from '../../i18n/idioma';
import './notas.css';

/**
 * D290 · la fila «Notas» del viaje (PANTALLA-notas-del-viaje.md §1): tarjeta blanca de 56, el ícono de notas, «Notas»,
 * el punto naranja si hay algo nuevo desde mi última visita (Mati: «Punto naranja en la fila», sin aviso en la campana),
 * «{n} de {total} escribieron» a la derecha y el chevron. Toda la fila abre el pizarrón.
 *
 * Abierto, entre «Ver balance del viaje» y «Configuración»; esperando pagos, antes de «Salir del viaje»; cerrado, debajo
 * de «Lugares visitados» (Mati: «Debajo de «Lugares visitados»»). Sin el resumen todavía (el detalle no llegó), la fila
 * va sin el número ni el punto: nunca afirma «nada nuevo» sin haberlo leído.
 */
export function FilaDeNotas({ resumen, onAbrir }: { resumen: ResumenDeNotas | null; onAbrir: () => void }) {
  const { t } = useIdioma();
  return (
    <button type="button" className="nts-fila" onClick={onAbrir}>
      <Icon name="notas" size={20} className="nts-fila-icono" scale="row" />
      <span className="nts-fila-texto">{t('Notas')}</span>
      {resumen?.nuevo && <span className="nts-punto" role="img" aria-label={t('Hay notas nuevas')} />}
      <span className="nts-fila-espacio" />
      {resumen && <span className="nts-fila-resumen">{t('{0} de {1} escribieron', resumen.escribieron, resumen.total)}</span>}
      <Icon name="chevron-right" size={18} className="nts-fila-chev" />
    </button>
  );
}
