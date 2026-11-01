import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IdiomaProvider } from '../i18n/idioma';
import { MONEY_RAIL_CERRADO, readMoneyRail, type MoneyRailState } from '../api/moneyRail';
import { LemaDelIngreso } from './LemaDelIngreso';

/**
 * D673 · el lema de la pantalla de ingreso. Mientras los pagos estén apagados dice
 * «Divide la cuenta con tus amigos, desde donde quieras»; con los pagos encendidos
 * vuelve el de siempre. Quién lo dice es `features.money_rail` de `GET /api/config`,
 * leído por el mismo corte que apaga los pagos (`corteDePagosView`): no lo decide
 * el front.
 */
const riel = (pagos: boolean): MoneyRailState => readMoneyRail({
  features: { money_rail: { mode: pagos ? 'sandbox' : 'disabled', payments_enabled: pagos, real_money: false } },
});

const SIN_PAGOS = 'Divide la cuenta con tus amigos, desde donde quieras';
const CON_PAGOS = 'Divide y paga la cuenta desde donde quieras';

function texto(rail: MoneyRailState): string {
  return renderToStaticMarkup(<IdiomaProvider><LemaDelIngreso rail={rail} /></IdiomaProvider>);
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('D673 · el lema del ingreso sigue a la capacidad de pagos', () => {
  it('🔴 con los pagos apagados (declarado por el dueño): sin «paga»', () => {
    expect(riel(false).status).toBe('authoritative');
    expect(texto(riel(false))).toBe(`<div class="ingreso-sub">${SIN_PAGOS}</div>`);
  });

  it('🔴 con los pagos encendidos: el lema de siempre', () => {
    expect(riel(true).status).toBe('authoritative');
    expect(texto(riel(true))).toBe(`<div class="ingreso-sub">${CON_PAGOS}</div>`);
  });

  it('🔴 sin saber (todavía no contestó, capacidad ausente o mal formada): sin «paga», el lado que no promete', () => {
    for (const rail of [MONEY_RAIL_CERRADO, readMoneyRail({ features: {} }), readMoneyRail({ features: { money_rail: { mode: 'x' } } })]) {
      expect(texto(rail), rail.status).toBe(`<div class="ingreso-sub">${SIN_PAGOS}</div>`);
    }
  });

  it('con el idioma EN: «Split the bill with your friends…» sin pagos, y el de siempre con pagos', () => {
    vi.stubGlobal('localStorage', { getItem: () => 'en', setItem: () => undefined, removeItem: () => undefined });
    expect(texto(riel(false))).toBe('<div class="ingreso-sub">Split the bill with your friends, from wherever you are</div>');
    expect(texto(riel(true))).toBe('<div class="ingreso-sub">Split and pay the bill from wherever you are</div>');
  });
});
