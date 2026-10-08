import { describe, expect, it } from 'vitest';
import { ocrResponse, sumaDeTipo, ticketAdjustmentsOf } from './contractResponses';

/**
 * D224 · `ticket_adjustments_v2` de App Backend 2.168.0: el cargo por servicio
 * impreso, aparte, con las reglas del dueño (`ajustesDelTicket` con
 * `OCR_ADJUSTMENT_KINDS_V2`, `totalesConAjustes` con el servicio y la invariante
 * `ítems + Σservicio − Σdescuento (+ IVA) = impreso` en
 * `contract-mirror/services/ocrResponseContract.js`).
 */
const items = [{ name: 'Taco', category: 'mexican', price_cents: 84000, quantity: 1 }];
const v2 = { contract_version: 2, items, total_cents: 84000, warnings: [], mock: false };
const desc = (amount_cents: number) => ({ kind: 'discount', amount_cents });
const serv = (amount_cents: number) => ({ kind: 'service_charge', amount_cents });

describe('OCR · el cargo por servicio aparte (D224)', () => {
  it('🔴 servicio solo: ítems + servicio = impreso', () => {
    const leido = ocrResponse({ ...v2, total_detected_cents: 92500, ticket_adjustments: [serv(8500)] });
    expect(leido.ticket_adjustments).toEqual([{ kind: 'service_charge', amount_cents: 8500 }]);
    // Los ítems no cambian: el cargo no es un plato.
    expect(leido.items).toHaveLength(1);
    expect(leido.total_cents).toBe(84000);
  });

  it('🔴 servicio con IVA agregado: subtotal + IVA + servicio = impreso', () => {
    const leido = ocrResponse({
      ...v2, total_detected_cents: 105940,
      ticket_totals: { subtotal_cents: 84000, tax_cents: 13440 }, ticket_adjustments: [serv(8500)],
    });
    expect(leido.ticket_totals).toEqual({ subtotal_cents: 84000, tax_cents: 13440 });
  });

  it('🔴 descuento y servicio: ítems + servicio − descuento = impreso', () => {
    const leido = ocrResponse({ ...v2, total_detected_cents: 87500, ticket_adjustments: [desc(5000), serv(8500)] });
    expect(sumaDeTipo(leido.ticket_adjustments, 'discount')).toBe(5000);
    expect(sumaDeTipo(leido.ticket_adjustments, 'service_charge')).toBe(8500);
  });

  it('con el subtotal ya descontado: S + IVA + servicio = impreso', () => {
    const leido = ocrResponse({
      ...v2, total_detected_cents: 100140,
      ticket_totals: { subtotal_cents: 79000, tax_cents: 12640 }, ticket_adjustments: [desc(5000), serv(8500)],
    });
    expect(leido.ticket_totals).toEqual({ subtotal_cents: 79000, tax_cents: 12640 });
  });

  it('el orden no se exige (el validador del dueño tampoco): se suma por tipo', () => {
    expect(ticketAdjustmentsOf([serv(8500), desc(5000)])).toEqual([
      { kind: 'service_charge', amount_cents: 8500 }, { kind: 'discount', amount_cents: 5000 },
    ]);
  });

  it.each([
    ['kind desconocido', [{ kind: 'tip', amount_cents: 8500 }]],
    ['servicio en cero', [serv(0)]],
    ['servicio con la etiqueta impresa', [{ ...serv(8500), label: 'SERVICIO' }]],
  ])('🔴 rechaza `ticket_adjustments` con %s', (_caso, ajustes) => {
    expect(() => ocrResponse({ ...v2, total_detected_cents: 92500, ticket_adjustments: ajustes }))
      .toThrow('contract_response_invalid');
  });

  it('🔴 rechaza la invariante que no cierra con el servicio (un centavo)', () => {
    expect(() => ocrResponse({ ...v2, total_detected_cents: 92501, ticket_adjustments: [serv(8500)] }))
      .toThrow('contract_response_invalid');
    // Restar el servicio como si fuera un descuento tampoco cierra.
    expect(() => ocrResponse({ ...v2, total_detected_cents: 75500, ticket_adjustments: [serv(8500)] }))
      .toThrow('contract_response_invalid');
  });

  it('🔴 rechaza totales que no cierran con el servicio', () => {
    expect(() => ocrResponse({
      ...v2, total_detected_cents: 105940,
      ticket_totals: { subtotal_cents: 84000, tax_cents: 13441 }, ticket_adjustments: [serv(8500)],
    })).toThrow('contract_response_invalid');
  });
});
