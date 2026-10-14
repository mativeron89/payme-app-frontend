import { describe, expect, it } from 'vitest';
import { EntradasGuia, objetivoDeInicio, puedeIniciarGuia } from './inicioGuia';

describe('D328 · una aparición por entrada autenticada', () => {
  it('cerrar/omitir/completar consumen sólo esta entrada; otra carga o login sí tiene turno', () => {
    const entradas = new EntradasGuia();
    expect(entradas.usada('A:familia1')).toBe(false);
    entradas.consumir('A:familia1');
    expect(entradas.usada('A:familia1')).toBe(true);
    expect(entradas.usada('A:familia2')).toBe(false);
    expect(entradas.usada('B:familia1')).toBe(false);
    expect(new EntradasGuia().usada('A:familia1')).toBe(false);
  });
  it('render, ruta, retorno de cámara y refresh no generan otro turno de la misma familia', () => {
    const entradas = new EntradasGuia(); entradas.consumir('A:familia1');
    for (const pagina of ['home', 'scan', 'home', 'viaje', 'home'] as const) {
      expect(puedeIniciarGuia({ usada: entradas.usada('A:familia1'), noMostrar: false, habilitada: true, prioridad: false, objetivo: !!objetivoDeInicio(pagina) })).toBe(false);
    }
  });
  it('sólo abre tras lectura desmarcada, gates abiertos, objetivo real y prioridad resuelta', () => {
    const apta = { usada: false, noMostrar: false, habilitada: true, prioridad: false, objetivo: true };
    expect(puedeIniciarGuia(apta)).toBe(true);
    for (const cambio of [{ noMostrar: null }, { noMostrar: true }, { habilitada: false }, { prioridad: true }, { objetivo: false }, { usada: true }]) {
      expect(puedeIniciarGuia({ ...apta, ...cambio })).toBe(false);
    }
  });
  it('diferir por prioridad u objetivo no consume la entrada, pero desmarcar tras abrir no la relanza', () => {
    const entradas = new EntradasGuia();
    const estado = { usada: entradas.usada('A:1'), noMostrar: false, habilitada: true, prioridad: true, objetivo: true };
    expect(puedeIniciarGuia(estado)).toBe(false);
    expect(puedeIniciarGuia({ ...estado, prioridad: false })).toBe(true);
    entradas.consumir('A:1');
    expect(puedeIniciarGuia({ ...estado, usada: entradas.usada('A:1'), prioridad: false, noMostrar: false })).toBe(false);
  });
  it('rutas ajenas, altas y enlaces no reciben un objetivo inventado', () => {
    for (const pagina of ['recovery', 'invitacion', 'avisos', 'cuenta', 'amigos'] as const) expect(objetivoDeInicio(pagina)).toBeNull();
    expect(objetivoDeInicio('home')).toBe('[data-guia="camara"]');
    expect(objetivoDeInicio('viaje-gasto')).toBe('[data-guia="descripcion-gasto"]');
  });
});
