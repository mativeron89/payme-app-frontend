import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MONEY_RAIL_CERRADO, readMoneyRail, type MoneyRailState } from '../api/moneyRail';
import { PagadoPorLosComensales } from './PagadoPorLosComensales';

/**
 * D674 · en el cierre de la mesa, con los pagos apagados no aparece la línea
 * «Pagado por los comensales · $0». Con los pagos encendidos, queda como siempre.
 * La autoridad es la misma del lema (D673): `features.money_rail` por `corteDePagosView`.
 */
const riel = (pagos: boolean): MoneyRailState => readMoneyRail({
  features: { money_rail: { mode: pagos ? 'live' : 'disabled', payments_enabled: pagos, real_money: pagos } },
});

describe('D674 · «Pagado por los comensales» sigue a la capacidad de pagos', () => {
  it('🔴 con los pagos apagados no se dibuja nada', () => {
    expect(renderToStaticMarkup(<PagadoPorLosComensales rail={riel(false)} paidCents={0} />)).toBe('');
  });

  it('🔴 sin saber (todavía no contestó, ausente o mal formada) tampoco: no se afirma un $0 de cobros que no existen', () => {
    for (const rail of [MONEY_RAIL_CERRADO, readMoneyRail({ features: {} }), readMoneyRail({ features: { money_rail: 1 } })]) {
      expect(renderToStaticMarkup(<PagadoPorLosComensales rail={rail} paidCents={0} />), rail.status).toBe('');
    }
  });

  it('🔴 con los pagos encendidos, la fila de siempre, con su monto en verde', () => {
    const html = renderToStaticMarkup(<PagadoPorLosComensales rail={riel(true)} paidCents={84000} />);
    expect(html).toBe(
      '<div class="receipt-row"><span class="lbl">Pagado por los comensales</span>'
      + '<span class="val" style="color:var(--green)">$840</span></div>',
    );
    expect(renderToStaticMarkup(<PagadoPorLosComensales rail={riel(true)} paidCents={0} />)).toContain('$0</span>');
  });
});
