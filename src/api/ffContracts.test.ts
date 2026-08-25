import { describe, expect, it } from 'vitest';
import { legalTextResponse, ocrResponse } from './contractResponses';

const notice = {
  legal_text: {
    kind: 'aviso_privacidad',
    version: '2.2.0',
    hash: 'a'.repeat(64),
    effective_from: '2026-08-12T00:00:00.000Z',
    body: 'Aviso de privacidad de la prueba cerrada.',
  },
};

const item = {
  name: 'Tacos al pastor',
  category: 'mexican',
  price_cents: 18000,
  quantity: 2,
  confidence: 74,
  low_confidence: true,
};

describe('aviso previo al alta · decoder fail-closed', () => {
  it('acepta y proyecta exactamente el texto público vigente', () => {
    expect(legalTextResponse(notice)).toEqual(notice);
  });

  it.each([
    null,
    {},
    { legal_text: { ...notice.legal_text, kind: 'aviso_campanas' } },
    { legal_text: { ...notice.legal_text, version: '' } },
    { legal_text: { ...notice.legal_text, version: 'ayer' } },
    { legal_text: { ...notice.legal_text, hash: 'corto' } },
    { legal_text: { ...notice.legal_text, effective_from: 'ayer' } },
    { legal_text: { ...notice.legal_text, body: '   ' } },
    { ...notice, extra_top_level: 'not-contract' },
  ])('rechaza una respuesta que no acredita el aviso (%j)', (malformed) => {
    expect(() => legalTextResponse(malformed)).toThrow('contract_response_invalid:legal/aviso_privacidad');
  });
});

describe('OCR real · decoder del contrato publicado', () => {
  it('conserva confianza, total impreso y warnings; descarta extras top-level', () => {
    expect(ocrResponse({
      items: [item],
      total_cents: 36000,
      total_detected_cents: 35000,
      warnings: ['low_confidence_items', 'total_mismatch'],
      mock: false,
      internal_provider_id: 'must-not-escape',
    })).toEqual({
      items: [item],
      total_cents: 36000,
      total_detected_cents: 35000,
      warnings: ['low_confidence_items', 'total_mismatch'],
      mock: false,
    });
  });

  it('acepta la degradación explícita del proveedor sin disfrazarla de ticket', () => {
    expect(ocrResponse({
      items: [], total_cents: 0, warnings: ['provider_error'], mock: false,
    }).warnings).toEqual(['provider_error']);
  });

  it.each([
    { items: [{ ...item, leaked_text: 'PII' }], total_cents: 36000, warnings: [], mock: false },
    { items: [{ ...item, category: 'seafood' }], total_cents: 36000, warnings: [], mock: false },
    { items: [{ ...item, name: ' Tacos' }], total_cents: 36000, warnings: [], mock: false },
    { items: [{ ...item, price_cents: 0 }], total_cents: 36000, warnings: [], mock: false },
    { items: [{ ...item, quantity: 0 }], total_cents: 36000, warnings: [], mock: false },
    { items: [{ ...item, confidence: 101 }], total_cents: 36000, warnings: [], mock: false },
    { items: [{ ...item, confidence: undefined }], total_cents: 36000, warnings: [], mock: false },
    { items: [item], total_cents: -1, warnings: [], mock: false },
    { items: [item], total_cents: 36000, total_detected_cents: 1.5, warnings: [], mock: false },
    { items: [item], total_cents: 36000, warnings: ['new_warning'], mock: false },
    { items: [item], total_cents: 36000, warnings: ['total_mismatch', 'total_mismatch'], mock: false },
    { items: [item], total_cents: 36000, warnings: [], mock: 'false' },
  ])('rechaza forma fuera de contrato sin interpretar (%j)', (malformed) => {
    expect(() => ocrResponse(malformed)).toThrow('contract_response_invalid:ocr');
  });
});
