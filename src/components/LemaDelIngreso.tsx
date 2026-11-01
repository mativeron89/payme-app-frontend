import { corteDePagosView, type RielDelCorte } from '../api/releaseGates';
import { useIdioma } from '../i18n/idioma';

/**
 * D673 · el lema bajo el logo de la pantalla de ingreso. Mientras los pagos estén
 * apagados dice «Divide la cuenta con tus amigos, desde donde quieras»; cuando se
 * enciendan, vuelve «Divide y paga la cuenta desde donde quieras».
 *
 * 🔴 No lo decide el front: sale de `features.money_rail` de `GET /api/config`, por
 * el mismo corte (`corteDePagosView`) que apaga tarjetas y la vista de pago. Sin
 * saber (riel pendiente, ausente o mal formado) cuenta como apagado: el lado que no
 * promete un pago.
 */
export function LemaDelIngreso({ rail }: { rail: RielDelCorte }) {
  const { t } = useIdioma();
  return (
    <div className="ingreso-sub">
      {corteDePagosView(rail).pagosCortados
        ? t('Divide la cuenta con tus amigos, desde donde quieras')
        : t('Divide y paga la cuenta desde donde quieras')}
    </div>
  );
}
