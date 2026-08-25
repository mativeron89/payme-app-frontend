import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const component = readFileSync(new URL('./ShortfallDisclosure.tsx', import.meta.url), 'utf8');
const avisos = readFileSync(new URL('../screens/AvisosScreen.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');

describe('ShortfallDisclosure · lifecycle privado', () => {
  it('el fetch ocurre exclusivamente después del click y pasa el gate de una vez', () => {
    expect(component).toContain('const generation = gate.current.start()');
    expect(component).toContain('if (generation === null) return');
    expect(component).toContain('await loadShortfallDetailForSession');
    expect(component).toContain('api.getShortfallDetail(code, cents, expected)');
    expect(component.indexOf('await loadShortfallDetailForSession'))
      .toBeGreaterThan(component.indexOf('const load = useCallback'));
  });

  it('404/red/malformed caen al agregado y respuestas stale no escriben', () => {
    expect(component).toContain("setState({ kind: 'unavailable' })");
    expect(component).toContain('loadShortfallDetailForSession(origin, mesaCode, shortfallCents');
    expect(component).toContain("outcome.kind === 'stale'");
    expect(component).toContain('gate.current.isCurrent(generation)');
    expect(component).toContain('isCurrent: isCurrentSession');
  });

  it('nombres nunca se persisten ni se deduplican', () => {
    expect(component).not.toMatch(/localStorage|sessionStorage|indexedDB/i);
    expect(component).not.toMatch(/new Set|\.filter\([^)]*display_name/);
    expect(component).toContain('rows.map((row, index)');
    expect(component).toContain('[...row.display_name.trim()][0]');
    expect(component).not.toContain("charAt(0)");
  });

  it('residual no fabrica cardinalidad y sólo se rotula cuando es un hecho disponible', () => {
    expect(component).toContain('shortfallIdentifiedCount(state.detail)');
    expect(component).not.toContain('rows.length +');
    expect(component).toContain("state.kind === 'available'");
    expect(component).toContain("t('Sin asignar')");
  });
});

describe('Avisos · detalle debajo, no comprimido junto al icono', () => {
  it('main ocupa su propia fila y disclosure es hermano posterior', () => {
    expect(avisos).toContain('className="aviso-row-main"');
    expect(avisos.indexOf('className="aviso-row-main"')).toBeLessThan(avisos.indexOf('<ShortfallDisclosure'));
    expect(css).toMatch(/\.aviso-row\s*\{\s*display:\s*block/);
    expect(css).toMatch(/\.shortfall-disclosure\s*\{[^}]*width:\s*100%/s);
  });

  it('requiere capability, sesión y payload final decodificado', () => {
    expect(avisos).toContain('shortfallCapability.enabled && session && shortfallDisclosure');
    expect(avisos).toContain('readShortfallNotificationDisclosure(n)');
  });
});
