import { corteDePagosView, type RielDelCorte } from '../api/releaseGates';
import { useIdioma } from '../i18n/idioma';
import { formatMXN } from '../utils/format';

/**
 * D674 · la fila «Pagado por los comensales» del cierre de la mesa. Con los pagos
 * apagados no aparece: un «$0» ahí describe cobros que no existen. Con los pagos
 * encendidos, la fila de siempre.
 *
 * 🔴 La misma autoridad que el lema del ingreso (D673): `features.money_rail` por
 * `corteDePagosView`. Sin saber, cuenta como apagado.
 */
export function PagadoPorLosComensales({ rail, paidCents }: { rail: RielDelCorte; paidCents: number }) {
  const { t } = useIdioma();
  if (corteDePagosView(rail).pagosCortados) return null;
  return (
    <div className="receipt-row">
      <span className="lbl">{t('Pagado por los comensales')}</span>
      <span className="val" style={{ color: 'var(--green)' }}>
        {formatMXN(paidCents)}
      </span>
    </div>
  );
}
