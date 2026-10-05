import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { draftForCountry, RegionLocalManagement, RegionRowChevron, RegionSettingsPanel, regionNoticeText, regionOpeningInput } from './RegionSettingsPanel';
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

describe('D169 · gestión local fuera del panel de selección', () => {
  it('R2 distingue teclado/tecnología asistiva de click/toque sin quitar el foco', () => {
    expect(regionOpeningInput(0)).toBe('keyboard');
    expect(regionOpeningInput(1)).toBe('pointer');
    expect(regionOpeningInput(2)).toBe('pointer');
  });
  it('R2 usa un chevrón decorativo local sin eje ni otro tab stop', () => {
    const html = renderToStaticMarkup(<RegionRowChevron />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('d="m9 5 7 7-7 7"');
    expect((html.match(/<path /g) ?? []).length).toBe(1);
    expect(html).not.toContain('<line');
    expect(html).not.toContain('tabindex');
  });
  it('la fila cerrada no monta ayuda, reset ni un reloj global', () => {
    const html = renderToStaticMarkup(<RegionSettingsPanel />);
    expect(html).toContain('Ubicación');
    expect(html).not.toContain('<dialog');
    expect(html).not.toContain('Restablecer país y zona');
    expect(html).not.toContain('Sólo en este navegador');
  });
  it('la gestión plegada conserva ayuda de privacidad y reset OWN', () => {
    const html = renderToStaticMarkup(<RegionLocalManagement />);
    expect(html).toContain('<details');
    expect(html).not.toContain('<details open');
    expect(html).toContain('Restablecer país y zona');
    expect(html).toContain('otra persona heredará esta selección');
    expect(html).toContain('7 países y 62 zonas');
    expect(html).not.toContain('<dialog');
    // D181 · sin la leyenda «Sólo en este navegador», ni como título ni en el texto.
    expect(html).not.toContain('Sólo en este navegador');
    expect(html).toContain('Más sobre la ubicación');
  });
});

describe('D171 · borrador automático sin inferir país ni destruir Manual', () => {
  it('país automático significa sólo zona: cambiar a CO conserva modo y fallback, no infiere ubicación', () => {
    const before = { country: 'MX', timeZone: 'America/Matamoros', mode: 'automatic' } as const;
    expect(draftForCountry(before, 'CO')).toEqual({ ...before, country: 'CO' });
    expect(draftForCountry(before, 'MX')).toBe(before);
    expect(before.country).toBe('MX');
  });
  it('fallo de zona explica fallback sin afirmar GPS ni guardado', () => {
    const state = { ...defaultRegionState(), notice: 'device-unavailable' } as const;
    expect(regionNoticeText(state, (s) => s)).toContain('última zona válida');
    expect(regionNoticeText(state, (s) => s)).not.toContain('Guardado');
    const html = renderToStaticMarkup(<RegionLocalManagement />);
    expect(html).toContain('no obtiene tu ubicación física');
    expect(html).toContain('no se sincroniza entre dispositivos ni cuentas');
  });
});
