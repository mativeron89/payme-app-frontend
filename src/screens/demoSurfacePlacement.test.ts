import { describe, expect, it } from 'vitest';

const SOURCES = import.meta.glob('./{HomeScreen,MasScreen,CreateMesaFlow}.tsx', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

const source = (name: string): string => {
  const hit = Object.entries(SOURCES).find(([path]) => path.endsWith(`/${name}.tsx`))?.[1];
  if (!hit) throw new Error(`No se encontró ${name}.tsx`);
  return hit;
};

describe('AF-REDISENO-12 · el aviso de demo vive sólo en Configuración', () => {
  it('Configuración conserva aviso y reset; Inicio y Scan no los duplican', () => {
    const config = source('MasScreen');
    expect(config).toContain("t('Modo demo:')");
    expect(config).toContain("t('Reiniciar la demo')");

    for (const name of ['HomeScreen', 'CreateMesaFlow']) {
      const screen = source(name);
      expect(screen, `${name} no debe montar aviso de demo`).not.toContain('demo-reset');
      expect(screen, `${name} no debe ofrecer reset de demo`).not.toContain("t('Reiniciar la demo')");
    }
  });
});
