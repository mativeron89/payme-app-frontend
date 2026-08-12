import { describe, expect, it } from 'vitest';
import { readOcrRail } from './ocrRail';

/**
 * `readOcrRail` · el `accept` sale del DUEÑO del contrato.
 *
 * 🔴 LA DECISIÓN QUE ESTOS TESTS FIJAN, y refuta la orden original.
 *
 * Pedían «usá `provider_mime_types` como `accept`». **Mide de menos:** el
 * emisor acepta los cuatro en modo `mock` A PROPÓSITO —nada llega a Textract— y
 * apretarlo *«rompería la demo para todos los iPhone, que es justo la prueba
 * que está por abrirse»*. Se lee el MODO y las DOS listas.
 */
const cfg = (ocr: unknown) => ({ features: { ocr } });
const CUATRO = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic'];
const PROV = ['image/jpeg', 'image/png'];

describe('🔴 el `accept` sigue al MODO, no a una lista sola', () => {
  it('real → sólo lo que el proveedor procesa · no invita el 415', () => {
    const s = readOcrRail(cfg({ mode: 'real', accepted_mime_types: CUATRO, provider_mime_types: PROV }));
    expect(s.accept).toBe('image/jpeg,image/png');
    expect(s.status).toBe('authoritative');
  });

  it('🔴 mock → los CUATRO · en mock nada llega a Textract y el HEIC funciona', () => {
    // Si esto se rompe, la demo le angosta el selector a todos los iPhone.
    const s = readOcrRail(cfg({ mode: 'mock', accepted_mime_types: CUATRO, provider_mime_types: PROV }));
    expect(s.accept).toBe(CUATRO.join(','));
  });

  it('🔴 un modo DESCONOCIDO no se interpreta como permisivo', () => {
    // Mismo criterio que `real_money`: no se deduce del nombre del modo.
    const s = readOcrRail(cfg({ mode: 'staging', accepted_mime_types: CUATRO, provider_mime_types: PROV }));
    expect(s.accept).toBe('image/jpeg,image/png');
  });
});

describe('🔴 el FALLBACK es la intersección · correcto en los dos mundos', () => {
  const FALLBACK = 'image/jpeg,image/jpg,image/png';

  it.each([
    ['config no es objeto', 'malformed', 'nada'],
    ['sin features', 'malformed', { features: null }],
    ['ocr ausente · backend previo', 'absent', { features: {} }],
    ['ocr no es objeto', 'malformed', cfg('mock')],
    ['sin provider_mime_types', 'malformed', cfg({ mode: 'real', accepted_mime_types: CUATRO })],
    ['provider vacío', 'malformed', cfg({ mode: 'real', provider_mime_types: [] })],
    ['provider con basura', 'malformed', cfg({ mode: 'real', provider_mime_types: ['jpeg', 7] })],
  ])('%s → fallback (%s)', (_c, status, entrada) => {
    const s = readOcrRail(entrada);
    expect(s.accept).toBe(FALLBACK);
    expect(s.status).toBe(status);
  });

  it('🔴 mock CON provider pero SIN accepted → estricto, no vacío', () => {
    // El ensanche exige las DOS listas. Media respuesta no ensancha.
    const s = readOcrRail(cfg({ mode: 'mock', provider_mime_types: PROV }));
    expect(s.accept).toBe('image/jpeg,image/png');
  });

  it('🔴 CONTROL · con la forma buena NO cae al fallback', () => {
    // Sin esto, un `return CERRADO` al tope pasaría los ocho casos de arriba y
    // el `accept` nunca seguiría al contrato.
    const s = readOcrRail(cfg({ mode: 'real', accepted_mime_types: CUATRO, provider_mime_types: PROV }));
    expect(s.accept).not.toBe(FALLBACK);
    expect(s.accept).toBe('image/jpeg,image/png');
  });

  it('🔴 el `accept` NUNCA queda vacío · un input sin accept ofrece cualquier archivo', () => {
    for (const entrada of ['nada', { features: {} }, cfg({}), cfg({ mode: 'real', provider_mime_types: [] })]) {
      expect(readOcrRail(entrada).accept.length).toBeGreaterThan(0);
    }
  });
});
