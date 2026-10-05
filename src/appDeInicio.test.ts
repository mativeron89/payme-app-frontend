/**
 * D179 · E179b · la clase de la app de inicio de iOS va sólo con
 * `navigator.standalone === true`.
 */
import { describe, expect, it } from 'vitest';
import { CLASE_APP_DE_INICIO, marcarAppDeInicio } from './appDeInicio';

function ventana(standalone: unknown) {
  const clases = new Set<string>();
  const win = {
    navigator: { standalone },
    document: { documentElement: { classList: { add: (c: string) => { clases.add(c); } } } },
  } as unknown as Window;
  return { win, clases };
}

describe('D179 · E179b · la clase de la app de inicio de iOS', () => {
  it('con `navigator.standalone === true`: la pone en <html>', () => {
    const { win, clases } = ventana(true);
    expect(marcarAppDeInicio(win)).toBe(true);
    expect([...clases]).toEqual([CLASE_APP_DE_INICIO]);
  });

  it.each([
    ['Safari (false)', false],
    ['la computadora (sin la propiedad)', undefined],
    ['un valor que no es `true`', 'true'],
  ])('en %s no la pone', (_nombre, standalone) => {
    const { win, clases } = ventana(standalone);
    expect(marcarAppDeInicio(win)).toBe(false);
    expect(clases.size).toBe(0);
  });

  it('la clase de JS es la misma que nombra el CSS', async () => {
    const css = Object.values(import.meta.glob('/src/styles/global.css', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)[0]!;
    expect(css).toContain(`html.${CLASE_APP_DE_INICIO} .app {`);
  });
});
