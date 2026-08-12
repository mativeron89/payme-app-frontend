import { describe, expect, it } from 'vitest';
import type { OcrResponse } from '../api/types';
import { decideOcrScan } from './ocrScanView';

function response(patch: Partial<OcrResponse> = {}): OcrResponse {
  return {
    items: [{
      name: 'Tacos', category: 'mexican', price_cents: 10000, quantity: 1,
    }],
    total_cents: 10000,
    warnings: [],
    mock: false,
    ...patch,
  };
}

describe('decisión visible del OCR', () => {
  it('usa total_detected_cents como impreso y no la suma calculada', () => {
    expect(decideOcrScan(response({
      total_cents: 10000,
      total_detected_cents: 12500,
      warnings: ['total_mismatch'],
    }))).toMatchObject({ kind: 'ticket', printedTotalCents: 12500 });
  });

  it('no inventa un total impreso cuando falta y conserva cero si fue detectado', () => {
    expect(decideOcrScan(response())).toMatchObject({ kind: 'ticket', printedTotalCents: null });
    expect(decideOcrScan(response({ total_detected_cents: 0 })))
      .toMatchObject({ kind: 'ticket', printedTotalCents: 0 });
  });

  it('abre revisión cuando al menos una fila trae baja confianza', () => {
    expect(decideOcrScan(response({ items: [{
      name: 'Tacos', category: 'mexican', price_cents: 10000, quantity: 1,
      confidence: 42, low_confidence: true,
    }], warnings: ['low_confidence_items'] })))
      .toMatchObject({ kind: 'ticket', hasLowConfidence: true });
  });

  it('no confunde provider_error 200 con un ticket vacío', () => {
    expect(decideOcrScan(response({
      items: [], total_cents: 0, warnings: ['provider_error'],
    }))).toEqual({ kind: 'provider_unavailable' });
  });

  it.each([
    response({ items: [], total_cents: 0 }),
    response({ items: [], total_cents: 0, warnings: ['no_items_found'] }),
  ])('conserva salida de reintento/manual cuando no hay ítems', (value) => {
    expect(decideOcrScan(value)).toEqual({ kind: 'no_items' });
  });

  it('conserva filas utilizables aunque una respuesta futura combine warnings', () => {
    expect(decideOcrScan(response({ warnings: ['provider_error'] })))
      .toMatchObject({ kind: 'ticket' });
    expect(decideOcrScan(response({ warnings: ['no_items_found'] })))
      .toMatchObject({ kind: 'ticket' });
  });
});
