import { describe, expect, it } from 'vitest';
import { reservarDesbordeDelIngreso } from './ui';

/** Geometría sintética: prueba cálculo/ciclo/limpieza; el layout y el
 * hit-test reales corresponden a Playwright en el CI oficial. */
function superficie(natural = 280, altoAviso = 160.375) {
  let height = '';
  let conectada = true;
  let primera = true;
  let activa = false;
  const style = {
    get height() { return height; },
    set height(v: string) { height = v; },
    removeProperty() { height = ''; },
  };
  const espacio = { style, getBoundingClientRect: () => ({ height: Number.parseFloat(height) || 0 }) };
  const boton = { getBoundingClientRect: () => ({ top: natural + (Number.parseFloat(height) || 0) }) };
  const contenedor = {
    get isConnected() { return conectada; },
    querySelector: (selector: string) => selector === '.toast-ingreso-reserva' ? espacio : primera ? boton : null,
    toggleAttribute: (_nombre: string, valor: boolean) => { activa = valor; },
    removeAttribute: () => { activa = false; },
  } as unknown as HTMLElement;
  const aviso = { getBoundingClientRect: () => ({ height: altoAviso }) } as unknown as HTMLElement;
  return {
    reserva: reservarDesbordeDelIngreso(contenedor, aviso),
    get altura() { return Number.parseFloat(height) || 0; },
    get activa() { return activa; },
    cambiar: (top: number, alto: number) => { natural = top; altoAviso = alto; },
    desconectar: () => { conectada = false; },
    sinBoton: () => { primera = false; },
  };
}

describe('P3-DIS-01 · reserva del desborde antes de la primera acción', () => {
  it('deja cero espacio cuando el título ya absorbe el aviso', () => {
    const s = superficie(280, 90);
    s.reserva.medir(145);
    expect(s.altura).toBe(0);
    expect(s.activa).toBe(false);
  });

  it('reserva sólo el exceso y permanece estable al medir su propio ajuste', () => {
    const s = superficie();
    for (let entrega = 0; entrega < 10; entrega += 1) {
      s.reserva.medir(145);
      expect(s.altura).toBe(26);
      expect(s.activa).toBe(true);
    }
    s.cambiar(290, 160.375); // cambió el inset/la posición natural
    s.reserva.medir(170);
    expect(s.altura).toBe(41);
    s.cambiar(290, 80); // texto/viewport más ancho: retira el exceso
    s.reserva.medir(170);
    expect(s.altura).toBe(0);
    expect(s.activa).toBe(false);
  });

  it('descarte/reemplazo/unmount limpian y una entrega tardía no revive la reserva', () => {
    const s = superficie();
    s.reserva.medir(145);
    s.reserva.limpiar();
    s.reserva.limpiar();
    s.reserva.medir(200);
    expect(s.altura).toBe(0);
    expect(s.activa).toBe(false);
  });

  it('cambiar de destino limpia el nodo anterior, sin reservar en la nueva pantalla', () => {
    const s = superficie();
    s.reserva.medir(145);
    s.desconectar();
    s.reserva.medir(145);
    expect(s.altura).toBe(0);
    expect(s.activa).toBe(false);
  });

  it('sin superficie interactiva no agrega espacio', () => {
    const s = superficie();
    s.reserva.medir(145);
    s.sinBoton();
    s.reserva.medir(145);
    expect(s.altura).toBe(0);
    expect(s.activa).toBe(false);
  });
});
