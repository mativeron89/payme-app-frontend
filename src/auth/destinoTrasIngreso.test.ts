import { describe, expect, it } from 'vitest';
import { parseLocation } from '../router';
import { conservaRutaTrasIngreso, mesaDeRetorno, trasCambioDeSesion } from './destinoTrasIngreso';

/** AF-INICIO-TRAS-INGRESO · a dónde va la app después de entrar. */
const sinNada = { tokenDeInvitacion: null, invitacionDeAlta: false };

describe('conservaRutaTrasIngreso · sólo un enlace de entrada conserva la ruta', () => {
  it('una ruta que quedó de antes (Más, Mesas, Estadísticas) no conserva: va a Inicio', () => {
    for (const p of ['/mas', '/mesas', '/estadisticas', '/notificaciones', '/', '/home']) {
      expect(conservaRutaTrasIngreso(parseLocation(p, ''), sinNada), p).toBe(false);
    }
  });

  it('la invitación a una mesa conserva, con su token en la URL o en custodia', () => {
    const r = parseLocation('/mesa/PA-2847', '');
    expect(conservaRutaTrasIngreso(r, { ...sinNada, tokenDeInvitacion: 'tok' })).toBe(true);
  });

  it('una mesa SIN token de invitación no es una entrada: va a Inicio', () => {
    expect(conservaRutaTrasIngreso(parseLocation('/mesa/PA-2847', ''), sinNada)).toBe(false);
  });

  it('un token de invitación con otra ruta no convierte esa ruta en entrada', () => {
    expect(conservaRutaTrasIngreso(parseLocation('/mas', ''), { ...sinNada, tokenDeInvitacion: 'tok' })).toBe(false);
  });

  it('el QR del restaurante (/scan?r=…) conserva; /scan sin r no', () => {
    expect(conservaRutaTrasIngreso(parseLocation('/scan', '?r=rest-qr-1'), sinNada)).toBe(true);
    expect(conservaRutaTrasIngreso(parseLocation('/scan', ''), sinNada)).toBe(false);
    expect(conservaRutaTrasIngreso(parseLocation('/scan', '?r='), sinNada)).toBe(false);
  });

  it('un ?r= en otra ruta no la convierte en entrada', () => {
    expect(conservaRutaTrasIngreso(parseLocation('/mas', '?r=rest-qr-1'), sinNada)).toBe(false);
  });

  it('una invitación de alta vista sin sesión conserva la ruta en la que se abrió', () => {
    expect(conservaRutaTrasIngreso(parseLocation('/mesas', ''), { ...sinNada, invitacionDeAlta: true })).toBe(true);
  });
});

describe('trasCambioDeSesion · sólo «sin sesión → con sesión» es un ingreso', () => {
  const conserva = (v: boolean) => () => v;

  it('sin sesión → con sesión: Inicio, salvo que la ruta sea una entrada', () => {
    expect(trasCambioDeSesion(false, true, conserva(false))).toBe('inicio');
    expect(trasCambioDeSesion(false, true, conserva(true))).toBe('quedarse');
  });

  it('una sesión que sigue (o se restaura al cargar) no mueve la ruta', () => {
    expect(trasCambioDeSesion(true, true, conserva(false))).toBe('quedarse');
  });

  it('cerrar sesión no decide acá (la URL la limpia el cierre)', () => {
    expect(trasCambioDeSesion(true, false, conserva(false))).toBe('quedarse');
    expect(trasCambioDeSesion(false, false, conserva(false))).toBe('quedarse');
  });

  it('no consulta la ruta si no hubo ingreso', () => {
    let consultas = 0;
    trasCambioDeSesion(true, true, () => { consultas += 1; return false; });
    expect(consultas).toBe(0);
  });
});

/**
 * AF-INVITACION-TRAS-GOOGLE · la marca de retorno vale sólo con la invitación
 * custodiada de ESA mesa. El recorrido con Google está en
 * `e2e/invitacion-mesa-google-redirect.spec.ts`.
 */
describe('mesaDeRetorno · se vuelve a la mesa sólo si marca y custodia coinciden', () => {
  const marca = { code: 'PA-2847' };

  it('la misma mesa: se vuelve a ella', () => {
    expect(mesaDeRetorno(marca, 'PA-2847')).toBe('PA-2847');
  });

  it('otra mesa en custodia: no se vuelve (la marca de A no lleva a A a quien abrió B)', () => {
    expect(mesaDeRetorno(marca, 'PA-9999')).toBeNull();
  });

  it('sin marca o sin custodia: no se vuelve', () => {
    expect(mesaDeRetorno(null, 'PA-2847')).toBeNull();
    expect(mesaDeRetorno(marca, null)).toBeNull();
    expect(mesaDeRetorno(null, null)).toBeNull();
  });
});
