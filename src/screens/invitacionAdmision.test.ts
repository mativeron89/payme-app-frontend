import { describe, expect, it } from 'vitest';
import {
  admisionDeInvitacion,
  copyAdmision,
  invitacionesMostrables,
  metaInvitacion,
} from './invitacionAdmision';

/**
 * C-01 · FAIL-CLOSED DE LA ADMISIÓN — LOS SEIS CASOS.
 *
 * El residual: `AvisosScreen` bloqueaba con `mesa_joinable === false`, así que
 * **sólo el "no" explícito** cerraba la puerta. La regla nueva es **sólo
 * `=== true` habilita**, y estos tests recorren la tabla entera porque el
 * defecto no estaba en el caso que alguien pensó, sino en los cinco que no.
 *
 * Y la segunda mitad, que es la que hace honesto el fail-closed: **no saber
 * no es saber que cerró**. Un decoder que mandara todo lo raro a "esta mesa
 * ya cerró" también estaría inventando un hecho del emisor.
 */

const BASE = {
  id: 'inv-1',
  mesa_code: 'PA-4520',
  restaurant_name: 'Hanzo Sushi',
  inviter_first_name: 'Sofía',
  created_at: '2026-08-06T20:00:00.000Z',
};

describe('admisionDeInvitacion · la tabla completa de los seis', () => {
  it('1 · true (booleano) → admite: el ÚNICO caso accionable', () => {
    expect(admisionDeInvitacion({ ...BASE, mesa_joinable: true })).toBe('admite');
  });

  it('2 · false (booleano) → cerrada: el emisor lo dijo y se puede decir', () => {
    expect(admisionDeInvitacion({ ...BASE, mesa_joinable: false })).toBe('cerrada');
  });

  it('3 · AUSENTE → desconocida, no admite (backend previo a v2.45.0)', () => {
    // El caso normal de un deploy desincronizado, y el que el gate viejo
    // dejaba pasar: `undefined === false` es falso, así que mostraba el botón.
    expect(admisionDeInvitacion(BASE)).toBe('desconocida');
  });

  it('4 · null → desconocida, no admite', () => {
    expect(admisionDeInvitacion({ ...BASE, mesa_joinable: null })).toBe('desconocida');
  });

  it('5 · string → desconocida: "false" es VERDADERO en JS', () => {
    // La trampa de coerción que `walletRail` ya bloquea exigiendo el tipo: sin
    // `typeof === 'boolean'`, un `"false"` del backend habilitaría el botón.
    expect(admisionDeInvitacion({ ...BASE, mesa_joinable: 'false' })).toBe('desconocida');
    expect(admisionDeInvitacion({ ...BASE, mesa_joinable: 'true' })).toBe('desconocida');
    expect(admisionDeInvitacion({ ...BASE, mesa_joinable: 1 })).toBe('desconocida');
  });

  it('6 · shape inválido → desconocida, sin excepción', () => {
    for (const raro of [null, undefined, 'una string', 42, [], () => true]) {
      expect(admisionDeInvitacion(raro)).toBe('desconocida');
    }
  });
});

describe('la copy distingue "cerró" de "no sé"', () => {
  it('cerrada AFIRMA el cierre; desconocida NO lo afirma', () => {
    expect(copyAdmision('cerrada')).toBe('Esta mesa ya cerró');
    const desconocida = copyAdmision('desconocida')!;
    expect(desconocida).toContain('No pudimos verificar');
    // La afirmación directa: no saber no puede leerse como saber que cerró.
    expect(desconocida.toLowerCase()).not.toContain('cerró');
  });

  it('admite no tiene copy: su superficie es el botón', () => {
    expect(copyAdmision('admite')).toBeNull();
  });
});

describe('invitacionesMostrables · la lista entera se normaliza', () => {
  it('una fila podrida NO se lleva la pantalla: se descarta y el resto vive', () => {
    // Antes esto era `.map` sobre datos crudos: un `null` en la lista tiraba
    // el render de Avisos ENTERO — ni invitaciones ni notificaciones.
    const r = invitacionesMostrables([
      null,
      { sin: 'id' },
      { ...BASE, mesa_joinable: true },
      'basura',
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]!.admision).toBe('admite');
  });

  it('los datos que faltan quedan en null — nunca se pinta "undefined"', () => {
    const [fila] = invitacionesMostrables([{ id: 'x', mesa_joinable: false }]);
    expect(fila).toMatchObject({
      id: 'x',
      mesaCode: null,
      restaurante: null,
      invitador: null,
      admision: 'cerrada',
    });
  });

  it('un campo de texto con tipo equivocado se trata como ausente', () => {
    const [fila] = invitacionesMostrables([
      { ...BASE, restaurant_name: 42, inviter_first_name: '   ', mesa_joinable: true },
    ]);
    expect(fila!.restaurante).toBeNull();
    expect(fila!.invitador).toBeNull();
    expect(fila!.mesaCode).toBe('PA-4520');
  });

  it('una respuesta que no es lista da lista vacía, no una excepción', () => {
    for (const raro of [null, undefined, {}, 'nada', 7]) {
      expect(invitacionesMostrables(raro)).toEqual([]);
    }
  });

  it('preserva el orden del emisor (created_at DESC lo decide él)', () => {
    const r = invitacionesMostrables([
      { ...BASE, id: 'a', mesa_joinable: true },
      { ...BASE, id: 'b', mesa_joinable: false },
      { ...BASE, id: 'c' },
    ]);
    expect(r.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(r.map((i) => i.admision)).toEqual(['admite', 'cerrada', 'desconocida']);
  });
});

describe('metaInvitacion · la línea de datos se arma con lo que haya', () => {
  const fecha = () => 'hace 8 min';
  it('con los dos datos, unidos por el separador del sistema', () => {
    expect(metaInvitacion({ mesaCode: 'PA-4520', creada: 'x' }, fecha)).toBe('Mesa PA-4520 · hace 8 min');
  });
  it('con uno solo, sin separador colgando', () => {
    expect(metaInvitacion({ mesaCode: 'PA-4520', creada: null }, fecha)).toBe('Mesa PA-4520');
    expect(metaInvitacion({ mesaCode: null, creada: 'x' }, fecha)).toBe('hace 8 min');
  });
  it('sin ninguno devuelve null: la fila no muestra una línea vacía', () => {
    expect(metaInvitacion({ mesaCode: null, creada: null }, fecha)).toBeNull();
  });
});
