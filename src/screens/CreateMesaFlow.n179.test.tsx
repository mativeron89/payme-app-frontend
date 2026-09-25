import { describe, expect, it } from 'vitest';
import { ocrFailureIssue, rechazoLocalDeImagen, ticketOpeningRoute } from './CreateMesaFlow';
import { EN } from '../i18n/en';

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

describe('n81 · foto de ticket demasiado pequeña', () => {
  it('el 422 del dueño con su código es «too_small»; otro 422 u otro código, no', () => {
    expect(ocrFailureIssue('ticket_image_too_small', 422)).toBe('too_small');
    expect(ocrFailureIssue('ticket_image_too_small', 400)).toBe('ocr');
    expect(ocrFailureIssue('otra_cosa', 422)).toBe('ocr');
  });

  it('el rechazo local usa el piso del dueño sólo si vino', () => {
    const MAX = 8 * 1024 * 1024;
    expect(rechazoLocalDeImagen(5000, MAX, 10240)).toBe('too_small');
    expect(rechazoLocalDeImagen(10240, MAX, 10240)).toBeNull();
    expect(rechazoLocalDeImagen(MAX + 1, MAX, 10240)).toBe('too_large');
    // 🔴 Sin piso publicado: una foto chica se sube y decide el 422, como antes.
    expect(rechazoLocalDeImagen(5000, MAX, null)).toBeNull();
    expect(rechazoLocalDeImagen(MAX + 1, MAX, null)).toBe('too_large');
  });

  it('las dos oraciones tienen su traducción en el diccionario EN', () => {
    expect(EN['La foto es demasiado pequeña para leer el ticket.']).toBe('The photo is too small to read the receipt.');
    expect(EN['Toma otra más cerca, con buena luz y sin recortarla.']).toBe('Take another one closer, in good light, without cropping it.');
  });
});
