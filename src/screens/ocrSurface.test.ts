import { describe, expect, it } from 'vitest';

const sources = import.meta.glob('/src/screens/CreateMesaFlow.tsx', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

const source = sources['/src/screens/CreateMesaFlow.tsx'];

describe('superficie OCR consume las señales publicadas', () => {
  it('cupo diario: usa el clasificador, copy ratificada y salida manual', () => {
    expect(source).toContain('isOcrQuotaExhausted(apiError)');
    const inicio = source.indexOf('{ocrQuotaExhausted && (');
    const fin = source.indexOf("{scanIssue === 'ocr'", inicio);
    expect(inicio).toBeGreaterThan(-1);
    expect(fin).toBeGreaterThan(inicio);
    const cuota = source.slice(inicio, fin);
    expect(cuota).toContain("t('Alcanzamos el límite de lecturas de hoy')");
    expect(cuota).toContain("t('Puedes cargar los consumos a mano.')");
    expect(cuota).toContain("t('Cargarlo a mano')");
    expect(cuota).toContain('onClick={cargarAMano}');
    expect(cuota).not.toContain('doScan');
    expect(cuota).not.toContain('Reintentar');
  });

  it('la captura y las tres entradas de escaneo consultan el bloqueo de instancia', () => {
    expect(source).toContain('disabled={scanning || ocrQuotaExhausted}');
    expect(source).toContain('onClick: doScan, disabled: scanning || ocrQuotaExhausted');
    expect(source.match(/if \(ocrQuotaBlocked\.current \|\| scanInFlight\.current \|\| scanning\) return;/g))
      .toHaveLength(3);
    expect(source).not.toContain('ocrQuotaBlocked.current = false');
    expect(source).not.toContain('setOcrQuotaExhausted(false)');
  });
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
