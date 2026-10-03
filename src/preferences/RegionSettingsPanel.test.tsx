import { describe, expect, it } from 'vitest';
import { draftForCountry, regionNoticeText } from './RegionSettingsPanel';
import { REGION_COUNTRIES, zoneLabel } from './regionCatalog';
import { DEFAULT_REGION, defaultRegionState, saveRegion } from './regionPreference';

describe('D165 · borrador exacto de Ubicación, sin efectos de almacenamiento', () => {
  it('cambiar a CUALQUIER país multizona no adivina su primera ciudad', () => {
    for (const country of REGION_COUNTRIES.filter((c) => c.zones.length > 1)) {
      const before = { country: 'CO', timeZone: 'America/Bogota' } as const;
      expect(draftForCountry(before, country.code)).toEqual({ country: country.code, timeZone: '' });
      expect(before).toEqual({ country: 'CO', timeZone: 'America/Bogota' });
    }
  });
  it('Colombia y Perú son las únicas opciones automáticas; Argentina tiene12', () => {
    const single = REGION_COUNTRIES.filter((c) => c.zones.length === 1);
    expect(single.map((c) => c.code)).toEqual(['CO', 'PE']);
    for (const country of single) expect(draftForCountry(DEFAULT_REGION, country.code))
      .toEqual({ country: country.code, timeZone: country.zones[0] });
    expect(draftForCountry(DEFAULT_REGION, 'AR').timeZone).toBe('');
  });
  it('volver al mismo país conserva la ciudad/IANA exacta, no la primera', () => {
    const draft = { country: 'US', timeZone: 'America/Phoenix' } as const;
    expect(draftForCountry(draft, 'US')).toBe(draft);
  });
  it('etiquetas62 legibles e individuales en ambos idiomas', () => {
    const zones = REGION_COUNTRIES.flatMap((c) => c.zones);
    for (const language of ['es', 'en'] as const) {
      const names = zones.map((z) => zoneLabel(z, language));
      expect(new Set(names).size).toBe(62);
      expect(names.every((n) => n.length > 0 && !/[\/_]/.test(n))).toBe(true);
    }
    expect(zoneLabel('America/Indiana/Indianapolis')).toBe('Indianápolis, Indiana');
    expect(zoneLabel('America/North_Dakota/New_Salem')).toBe('New Salem, Dakota del Norte');
    expect(zoneLabel('Pacific/Easter')).toBe('Isla de Pascua (Rapa Nui)');
    expect(zoneLabel('America/Mexico_City', 'en')).toBe('Mexico City');
  });
  it('fallo de guardado tiene aviso temporal, no falsoGuardado', () => {
    const state = saveRegion(DEFAULT_REGION, null, () => true);
    const text = regionNoticeText(state, (s) => s);
    expect(state.persistence).toBe('temporary');
    expect(text).toContain('no se pudo confirmar el guardado');
    expect(text).not.toContain('Guardado sólo');
  });
  it.each(['corrupt', 'unsupported', 'storage-unavailable', 'not-saved', 'not-reset'] as const)
  ('notice %s no desaparece ni promete guardado', (notice) => {
    const text = regionNoticeText(defaultRegionState(notice, () => true), (s) => s);
    expect(text).not.toBe(''); expect(text).not.toContain('Guardado sólo');
  });
});
