import { describe, expect, it } from 'vitest';

const sources = import.meta.glob('/src/screens/CreateMesaFlow.tsx', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

const source = sources['/src/screens/CreateMesaFlow.tsx'];

describe('superficie OCR consume las señales publicadas', () => {
  it('integra la decisión pura y no vuelve a tratar total_cents como impreso', () => {
    expect(source).toContain('decideOcrScan(r)');
    expect(source).toContain('setScannedTotalCents(decision.printedTotalCents)');
    expect(source).not.toContain('setScannedTotalCents(r.total_cents');
  });

  it('distingue proveedor, cero ítems, formato, tamaño y falla genérica', () => {
    for (const state of ['provider', 'no_items', 'image_type', 'too_large', 'ocr']) {
      expect(source).toContain(`scanIssue === '${state}'`);
    }
    expect(source).toContain("unsupported_image_type_for_provider");
  });

  it('conserva y diferencia la baja confianza sin bloquear Continuar', () => {
    expect(source).toContain('lowConfidence: true as const');
    expect(source).toContain('tk-row-warning');
    expect(source).toContain("aria-label={t('No pudimos leer este ítem')}");
    expect(source).toContain('{confidenceWarning}');
    expect(source).toContain('setEditingItems(decision.hasLowConfidence)');
    expect(source).not.toMatch(/ticketValid[\s\S]{0,240}lowConfidence/);
  });

  it('el scan no muestra promesas contextuales de demo', () => {
    expect(source).not.toContain("ocrMode === 'mock'");
    expect(source).not.toContain("t('todavía no leemos la foto. Usamos un ticket de ejemplo");
    expect(source).not.toContain('scan-note');
  });

  it('muestra progreso real accesible y cae a texto sin porcentaje cuando no hay total', () => {
    expect(source).toContain('api.scanTicket(image, setUploadProgress)');
    expect(source).toContain('<progress');
    expect(source).toContain("aria-label={t('Progreso de subida')}");
    expect(source).toContain('uploadProgress.totalBytes !== null');
    expect(source).toContain("t('Subiendo la foto…')");
  });
});
