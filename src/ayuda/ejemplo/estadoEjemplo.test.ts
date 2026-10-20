import { describe, expect, it, vi } from 'vitest';
import { EJEMPLO_APAGADO, EjemploLocal, mesaArmada, mesaDeEjemploEnInicio } from './estadoEjemplo';

describe('D363 · el estado de la mesa de ejemplo (en memoria)', () => {
  it('D429 · las explicaciones sólo abren en Compartir y se descartan al avanzar, salir o empezar de nuevo', () => {
    const ejemplo = new EjemploLocal();
    ejemplo.explicarCompartir('copiar');
    expect(ejemplo.leer()).toBe(EJEMPLO_APAGADO);
    ejemplo.empezar();
    ejemplo.explicarCompartir('whatsapp');
    expect(ejemplo.leer().explicacionCompartir).toBeNull();
    ejemplo.armarMesa('consumo', 2, 1_000);
    for (const accion of ['copiar', 'whatsapp', 'amigo-lucia', 'amigo-tomas', 'amigo-ana'] as const) {
      const antes = ejemplo.leer();
      ejemplo.explicarCompartir(accion);
      expect(ejemplo.leer()).toEqual({ ...antes, explicacionCompartir: accion });
      ejemplo.explicarCompartir(null);
      expect(ejemplo.leer()).toEqual(antes);
    }
    ejemplo.explicarCompartir('amigo-lucia');
    ejemplo.irA('mesa');
    expect(ejemplo.leer().explicacionCompartir).toBeNull();
    ejemplo.armarMesa('consumo', 2, 1_000);
    ejemplo.explicarCompartir('copiar');
    ejemplo.empezar();
    expect(ejemplo.leer().explicacionCompartir).toBeNull();
    ejemplo.armarMesa('consumo', 2, 1_000);
    ejemplo.explicarCompartir('copiar');
    ejemplo.descartar();
    expect(ejemplo.leer()).toBe(EJEMPLO_APAGADO);
  });
  it('nace apagado y empezar() lo prende en Escanear, sin mesa ni selección', () => {
    const ejemplo = new EjemploLocal();
    expect(ejemplo.leer()).toBe(EJEMPLO_APAGADO);
    ejemplo.empezar();
    expect(ejemplo.leer()).toMatchObject({ activo: true, fase: 'foto', division: null, personas: null, armadaEn: null });
    expect(ejemplo.leer().seleccion.size).toBe(0);
    expect(mesaArmada(ejemplo.leer())).toBe(false);
  });

  it('con el ejemplo apagado, mover la fase, armar la mesa o elegir no lo prenden', () => {
    const ejemplo = new EjemploLocal();
    ejemplo.irA('mesa');
    ejemplo.armarMesa('consumo', 2, 1000);
    ejemplo.elegir(new Map([['x', 10000]]));
    expect(ejemplo.leer()).toBe(EJEMPLO_APAGADO);
  });

  it('armar la mesa fija forma, N y hora, y pasa a Compartir; descartar vuelve a apagado', () => {
    const ejemplo = new EjemploLocal();
    ejemplo.empezar();
    ejemplo.irA('dividir');
    ejemplo.armarMesa('igual', 3, 1_000);
    const armado = ejemplo.leer();
    expect(armado).toMatchObject({ activo: true, fase: 'compartir', division: 'igual', personas: 3, armadaEn: 1_000 });
    expect(mesaArmada(armado)).toBe(true);
    ejemplo.descartar();
    expect(ejemplo.leer()).toBe(EJEMPLO_APAGADO);
  });

  it('mesaArmada exige el ejemplo activo además de la forma, el N y la hora', () => {
    const forma = { division: 'consumo' as const, personas: 2, armadaEn: 0 };
    expect(mesaArmada({ ...EJEMPLO_APAGADO, ...forma, activo: true })).toBe(true);
    expect(mesaArmada({ ...EJEMPLO_APAGADO, ...forma })).toBe(false);
    expect(mesaArmada({ ...EJEMPLO_APAGADO, ...forma, activo: true, personas: null })).toBe(false);
    expect(mesaArmada({ ...EJEMPLO_APAGADO, ...forma, activo: true, armadaEn: null })).toBe(false);
    expect(mesaArmada({ ...EJEMPLO_APAGADO, ...forma, activo: true, division: null })).toBe(false);
  });

  it('4a · la mesa de ejemplo está en Inicio sólo armada y después del «Listo»', () => {
    const ejemplo = new EjemploLocal();
    ejemplo.empezar();
    ejemplo.irA('listo');
    expect(mesaDeEjemploEnInicio(ejemplo.leer())).toBe(false);
    ejemplo.armarMesa('consumo', 1, 0);
    expect(mesaDeEjemploEnInicio(ejemplo.leer())).toBe(false);
    ejemplo.irA('listo');
    expect(mesaDeEjemploEnInicio(ejemplo.leer())).toBe(true);
    ejemplo.descartar();
    expect(mesaDeEjemploEnInicio(ejemplo.leer())).toBe(false);
  });

  it('rechaza el N que la pantalla tampoco deja: el piso de cada forma y el tope de 50 (D375)', () => {
    const ejemplo = new EjemploLocal();
    ejemplo.empezar();
    // Control positivo: el piso exacto de cada forma pasa.
    expect(() => ejemplo.armarMesa('consumo', 1, 0)).not.toThrow();
    expect(() => ejemplo.armarMesa('total', 1, 0)).not.toThrow();
    expect(() => ejemplo.armarMesa('igual', 2, 0)).not.toThrow();
    expect(() => ejemplo.armarMesa('consumo', 50, 0)).not.toThrow();
    expect(() => ejemplo.armarMesa('igual', 1, 0)).toThrow('ejemplo_personas_invalidas');
    expect(() => ejemplo.armarMesa('consumo', 0, 0)).toThrow('ejemplo_personas_invalidas');
    expect(() => ejemplo.armarMesa('consumo', 51, 0)).toThrow('ejemplo_personas_invalidas');
    expect(() => ejemplo.armarMesa('consumo', 1.5, 0)).toThrow('ejemplo_personas_invalidas');
  });

  it('elegir reemplaza la selección entera y anota cuándo; una vacía no deja hora', () => {
    const ejemplo = new EjemploLocal();
    ejemplo.empezar();
    ejemplo.elegir(new Map([['antes', 10000]]), 5);
    expect(ejemplo.leer().seleccion.size).toBe(0);
    ejemplo.armarMesa('consumo', 2, 0);
    ejemplo.elegir(new Map([['a', 5000]]), 7);
    expect([...ejemplo.leer().seleccion]).toEqual([['a', 5000]]);
    expect(ejemplo.leer().guardadaEn).toBe(7);
    ejemplo.elegir(new Map(), 9);
    expect(ejemplo.leer().seleccion.size).toBe(0);
    expect(ejemplo.leer().guardadaEn).toBeNull();
  });

  it('volver a armar la mesa borra lo elegido antes: cada mesa de ejemplo empieza vacía', () => {
    const ejemplo = new EjemploLocal();
    ejemplo.empezar();
    ejemplo.armarMesa('consumo', 2, 0);
    ejemplo.elegir(new Map([['a', 10000]]), 1);
    ejemplo.armarMesa('igual', 2, 2);
    expect(ejemplo.leer().seleccion.size).toBe(0);
    expect(ejemplo.leer().guardadaEn).toBeNull();
  });

  it('avisa a los suscriptos sólo cuando cambia, y deja de avisar al desuscribirse', () => {
    const ejemplo = new EjemploLocal();
    const oyente = vi.fn();
    const soltar = ejemplo.suscribir(oyente);
    ejemplo.descartar();
    expect(oyente).not.toHaveBeenCalled();
    ejemplo.empezar();
    expect(oyente).toHaveBeenCalledTimes(1);
    ejemplo.irA('foto');
    expect(oyente).toHaveBeenCalledTimes(1);
    ejemplo.irA('ticket');
    expect(oyente).toHaveBeenCalledTimes(2);
    soltar();
    ejemplo.descartar();
    expect(oyente).toHaveBeenCalledTimes(2);
  });
});
