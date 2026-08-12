import type { OcrResponse } from '../api/types';

export type OcrScanDecision =
  | { kind: 'provider_unavailable' }
  | { kind: 'no_items' }
  | {
      kind: 'ticket';
      response: OcrResponse;
      printedTotalCents: number | null;
      hasLowConfidence: boolean;
    };

/**
 * Traduce señales autoritativas del owner a estados de producto sin disfrazar
 * una degradación HTTP 200 de Textract como un ticket válido.
 */
export function decideOcrScan(response: OcrResponse): OcrScanDecision {
  // Lo utilizable manda: el owner promete degradar sin romper el flujo. Si un
  // proveedor futuro entrega filas junto a un warning, no las descartamos.
  if (response.items.length > 0) {
    return {
      kind: 'ticket',
      response,
      printedTotalCents: response.total_detected_cents ?? null,
      hasLowConfidence: response.items.some((item) => item.low_confidence === true),
    };
  }
  if (response.warnings.includes('provider_error')) {
    return { kind: 'provider_unavailable' };
  }
  return { kind: 'no_items' };
}
