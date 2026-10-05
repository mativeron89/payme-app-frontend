/**
 * D182 · el teclado en la app de inicio de iOS: la cuenta de cuánto mover el
 * contenedor y la puerta. El comportamiento con el DOM lo cubre
 * `e2e/teclado-app-de-inicio.spec.ts`.
 */
import { describe, expect, it, vi } from 'vitest';
import { MAX_REAJUSTES, QUIETO_MS, cuidarTeclado, describir, desplazamientoParaVer } from './tecladoAppDeInicio';

describe('D182 · cuánto mover el contenedor para ver el campo', () => {
  const contenedor = { top: 200, bottom: 760 };

  it('un campo ya visible no se mueve', () => {
    expect(desplazamientoParaVer({ top: 240, bottom: 284 }, contenedor, 490)).toBe(0);
  });

  it('un campo debajo de lo visible (el teclado) sube lo justo, con margen', () => {
    // Visible hasta 490 (arriba del teclado); el campo termina en 600: sube 600 − (490 − 12).
    expect(desplazamientoParaVer({ top: 556, bottom: 600 }, contenedor, 490)).toBe(600 - 478);
  });

  it('el borde de abajo es el más alto entre el contenedor y lo visible', () => {
    expect(desplazamientoParaVer({ top: 700, bottom: 744 }, { top: 200, bottom: 720 }, 900)).toBe(744 - 708);
  });

  it('nunca lo sube por encima del borde de arriba del contenedor', () => {
    // Un campo alto: subirlo hasta abajo lo sacaría por arriba; queda con el borde de arriba a la vista.
    expect(desplazamientoParaVer({ top: 300, bottom: 700 }, contenedor, 490)).toBe(300 - 212);
  });

  it('un campo por encima del contenedor baja hasta su borde de arriba', () => {
    expect(desplazamientoParaVer({ top: 150, bottom: 194 }, contenedor, 490)).toBe(150 - 212);
  });

  it('las constantes de la guarda', () => {
    expect(MAX_REAJUSTES).toBe(3);
    expect(QUIETO_MS).toBe(500);
  });
});

describe('D182 · cómo se nombra el campo en el panel', () => {
  const campo = (attrs: Record<string, string>) => ({
    getAttribute: (k: string) => attrs[k] ?? null,
    tagName: 'INPUT',
  }) as unknown as HTMLElement;

  it('por su rótulo o su placeholder, recortado, y sin «@» (el panel se copia)', () => {
    expect(describir(campo({ 'aria-label': 'Buscar entre tus amigos' }))).toBe('Buscar entre tus amigos');
    expect(describir(campo({ placeholder: '@usuario' }))).toBe('usuario');
    expect(describir(campo({ 'aria-label': 'x'.repeat(60) })).length).toBe(40);
    expect(describir(campo({}))).toBe('input');
  });
});

describe('D182 · sólo en la app de inicio de iOS', () => {
  it.each([
    ['Safari (false)', false],
    ['la computadora (sin la propiedad)', undefined],
    ['un valor que no es `true`', 'true'],
  ])('en %s no engancha nada', (_n, standalone) => {
    const agregar = vi.fn();
    const win = {
      navigator: { standalone },
      document: { addEventListener: agregar },
      addEventListener: agregar,
      visualViewport: { addEventListener: agregar },
    } as unknown as Window;
    const soltar = cuidarTeclado(win);
    expect(agregar).not.toHaveBeenCalled();
    expect(() => soltar()).not.toThrow();
  });
});
