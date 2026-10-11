import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pestanaPorTecla } from './QueComesScreen';

/**
 * 🔴 F-13 (auditoría Codex) · las pestañas de Qué comes usan el foco móvil (sólo la elegida está en el orden de Tab):
 * sin las flechas, «Ingrediente» y «Momento» no se alcanzaban con el teclado. El recorrido real, en el navegador:
 * `e2e/auditorias-pendientes.spec.ts`.
 */
describe('🔴 F-13 · las pestañas de Qué comes, con el teclado', () => {
  const tres = ['platos', 'ingrediente', 'momento'] as const;

  it('las flechas pasan a la de al lado, con vuelta', () => {
    expect(pestanaPorTecla(tres, 'platos', 'ArrowRight')).toBe('ingrediente');
    expect(pestanaPorTecla(tres, 'ingrediente', 'ArrowRight')).toBe('momento');
    expect(pestanaPorTecla(tres, 'momento', 'ArrowRight')).toBe('platos');
    expect(pestanaPorTecla(tres, 'platos', 'ArrowLeft')).toBe('momento');
    expect(pestanaPorTecla(tres, 'momento', 'ArrowLeft')).toBe('ingrediente');
  });

  it('Inicio va a la primera y Fin a la última', () => {
    expect(pestanaPorTecla(tres, 'ingrediente', 'Home')).toBe('platos');
    expect(pestanaPorTecla(tres, 'ingrediente', 'End')).toBe('momento');
  });

  it('sólo entre las que se ven (sin «Ingrediente», de Platos a Momento)', () => {
    expect(pestanaPorTecla(['platos', 'momento'], 'platos', 'ArrowRight')).toBe('momento');
    expect(pestanaPorTecla(['platos', 'momento'], 'momento', 'ArrowRight')).toBe('platos');
  });

  it('cualquier otra tecla no hace nada (Tab, Enter, flechas de arriba y abajo)', () => {
    for (const tecla of ['Tab', 'Enter', ' ', 'ArrowUp', 'ArrowDown', 'a']) expect(pestanaPorTecla(tres, 'platos', tecla), tecla).toBeNull();
  });

  it('el `tablist` lo escucha, y la pestaña elegida queda en el orden de Tab', () => {
    const fuente = readFileSync(new URL('./QueComesScreen.tsx', import.meta.url), 'utf8');
    expect(fuente).toContain(`role="tablist" aria-label={t('Qué comes')} onKeyDown={alTeclado}`);
    expect(fuente).toContain("document.getElementById(`que-comes-tab-${otra}`)?.focus();");
  });
});
