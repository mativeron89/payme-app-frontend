import { describe, expect, it } from 'vitest';
import { crearAvisoDeIngresoAMesa } from './avisoDeIngresoAMesa';

describe('D387 · recibo de presentación efímero, por canje y destino', () => {
  it('sólo avisa por un canje explícito, una vez, y usa el código devuelto', () => {
    const aviso = crearAvisoDeIngresoAMesa();
    aviso.contexto('cuenta:familia', 'ENLACE');
    expect(aviso.capturar('ENLACE')).toBeNull();
    aviso.preparar('DEVUELTO', 'cuenta:familia');
    expect(aviso.capturar('ENLACE')).toBeNull();
    const recibo = aviso.capturar('DEVUELTO');
    expect(recibo).toEqual({ mesa_code: 'DEVUELTO' });
    expect(aviso.consumir(recibo)).toBe(false); // aún no llegó al destino
    aviso.contexto('cuenta:familia', 'DEVUELTO');
    expect(aviso.consumir(recibo)).toBe(true);
    expect(aviso.consumir(recibo)).toBe(false);
    aviso.contexto('cuenta:familia', 'DEVUELTO'); // polling, foco, misma ruta
    expect(aviso.capturar('DEVUELTO')).toBeNull();
  });

  it.each([null, 'otra:familia', 'cuenta:otra-familia'])('descarta al cambiar identidad a %s', (identidad) => {
    const aviso = crearAvisoDeIngresoAMesa();
    aviso.contexto('cuenta:familia', 'MESA');
    aviso.preparar('MESA', 'cuenta:familia');
    const recibo = aviso.capturar('MESA');
    aviso.contexto(identidad, 'MESA');
    expect(aviso.consumir(recibo)).toBe(false);
    aviso.contexto('cuenta:familia', 'MESA');
    expect(aviso.capturar('MESA')).toBeNull();
  });

  it('abandonar y volver no revive el recibo ni acepta una respuesta tardía', () => {
    const aviso = crearAvisoDeIngresoAMesa();
    aviso.contexto('cuenta:familia', 'MESA');
    aviso.preparar('MESA', 'cuenta:familia');
    const viejo = aviso.capturar('MESA');
    aviso.contexto('cuenta:familia', null);
    aviso.contexto('cuenta:familia', 'MESA');
    expect(aviso.consumir(viejo)).toBe(false);
    aviso.preparar('MESA', 'cuenta:familia');
    const nuevo = aviso.capturar('MESA');
    expect(aviso.consumir(viejo)).toBe(false);
    expect(aviso.consumir(nuevo)).toBe(true);
  });

  it('una copia del payload o una mesa ajena no consume la señal verdadera', () => {
    const aviso = crearAvisoDeIngresoAMesa();
    aviso.contexto('cuenta:familia', 'MESA');
    aviso.preparar('MESA', 'cuenta:familia');
    expect(aviso.consumir({ mesa_code: 'MESA' })).toBe(false);
    expect(aviso.capturar('OTRA')).toBeNull();
    expect(aviso.consumir(aviso.capturar('MESA'))).toBe(true);
  });

  it('un callback de un canje viejo no prepara un aviso para otra cuenta o familia', () => {
    const aviso = crearAvisoDeIngresoAMesa();
    aviso.contexto('cuenta:familia', 'MESA');
    const respuestaVieja = () => aviso.preparar('MESA', 'cuenta:familia');
    aviso.contexto('otra:familia', 'MESA');
    respuestaVieja();
    expect(aviso.capturar('MESA')).toBeNull();
    aviso.preparar('MESA', 'otra:familia');
    expect(aviso.consumir(aviso.capturar('MESA'))).toBe(true);
  });

  it('sin sesión o tras una recarga no hay un ingreso pendiente', () => {
    const aviso = crearAvisoDeIngresoAMesa();
    aviso.preparar('MESA', 'cuenta:familia');
    aviso.contexto('cuenta:familia', 'MESA');
    expect(aviso.capturar('MESA')).toBeNull();
    aviso.preparar('MESA', 'cuenta:familia');
    const recargado = crearAvisoDeIngresoAMesa();
    recargado.contexto('cuenta:familia', 'MESA');
    expect(recargado.capturar('MESA')).toBeNull();
    expect(aviso.consumir(aviso.capturar('MESA'))).toBe(true);
  });
});
