import { describe, expect, it } from 'vitest';
import { ocrFailureIssue, ticketOpeningRoute } from './CreateMesaFlow';

describe('n179 · apertura desde ticket sin QR', () => {
  it('resolver el restaurante no crea nada hasta el CTA de la persona', () => {
    expect(ticketOpeningRoute({
      userAction: false,
      restaurantReady: true,
      recordOnly: true,
      moneyEnabled: false,
    })).toBe('wait_for_user');
  });

  it('un registro privado abre sólo en modo record-only sin dinero', () => {
    expect(ticketOpeningRoute({
      userAction: true,
      restaurantReady: true,
      recordOnly: true,
      moneyEnabled: false,
    })).toBe('create_without_money');
    expect(ticketOpeningRoute({
      userAction: true,
      restaurantReady: true,
      recordOnly: true,
      moneyEnabled: true,
    })).toBe('record_only_blocked');
  });

  it('un restaurante público conserva garantía y una resolución pendiente no avanza', () => {
    expect(ticketOpeningRoute({
      userAction: true,
      restaurantReady: true,
      recordOnly: false,
      moneyEnabled: true,
    })).toBe('guarantee');
    expect(ticketOpeningRoute({
      userAction: true,
      restaurantReady: false,
      recordOnly: false,
      moneyEnabled: false,
    })).toBe('resolving_restaurant');
  });

  it('distingue los dos rechazos presupuestarios sin degradarlos a éxito vacío', () => {
    expect(ocrFailureIssue('ocr_monthly_budget_exhausted', 429)).toBe('budget_exhausted');
    expect(ocrFailureIssue('ocr_budget_unavailable', 503)).toBe('budget_unavailable');
    expect(ocrFailureIssue('ocr_monthly_budget_exhausted', 503)).toBe('ocr');
    expect(ocrFailureIssue('ocr_budget_unavailable', 429)).toBe('ocr');
  });
});
