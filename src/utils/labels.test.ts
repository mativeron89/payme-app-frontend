import { describe, expect, it } from 'vitest';
import {
  estadoDeTuMesa,
  estadoPersonalDeMesa,
  iconoDeCategoriaRestaurante,
  pagadoPropioCentavos,
  personasEnMesa,
  tuMesaEnCurso,
  mesaDelAviso,
} from './labels';

/**
 * AF-18 · los campos aditivos del dueño v2.93.0 se leen campo por campo.
 * Cada `it` rompe UNA condición: una forma que el contrato no declara cae en
 * `null`/`store`, que es la conducta 0.168.0 contra un backend 2.92.0.
 */

describe('G-27 · personasEnMesa', () => {
  it('control positivo: un entero ≥ 0 se lee tal cual', () => {
    expect(personasEnMesa({ participants_count: 4 })).toBe(4);
    expect(personasEnMesa({ participants_count: 1 })).toBe(1);
    expect(personasEnMesa({ participants_count: 0 })).toBe(0);
  });

  it('🔴 ausente o con forma rara ⇒ null: la línea va sin conteo', () => {
    for (const raro of [undefined, null, '4', 4.5, -1, Number.NaN, Infinity, 2 ** 60, {}]) {
      expect(personasEnMesa({ participants_count: raro }), String(raro)).toBeNull();
    }
    expect(personasEnMesa({})).toBeNull();
  });
});

describe('G-34 · estadoPersonalDeMesa («Según lo que eligió cada uno»)', () => {
  it('control positivo: paid y pending en una mesa en curso', () => {
    expect(estadoPersonalDeMesa({ status: 'partially_paid', my_status: 'paid' })).toBe('paid');
    expect(estadoPersonalDeMesa({ status: 'open', my_status: 'pending' })).toBe('pending');
    expect(estadoPersonalDeMesa({ status: 'partially_paid', my_status: 'pending' })).toBe('pending');
  });

  it('🔴 not_applicable ⇒ sin personalizar: la etiqueta genérica de la mesa', () => {
    expect(estadoPersonalDeMesa({ status: 'partially_paid', my_status: 'not_applicable' })).toBeNull();
  });

  it('🔴 ausente o desconocido ⇒ sin personalizar', () => {
    for (const raro of [undefined, null, 'PAID', 'paid ', 'refunded', 1, true]) {
      expect(estadoPersonalDeMesa({ status: 'partially_paid', my_status: raro }), String(raro)).toBeNull();
    }
  });

  it('🔴 «Ya pagaste, faltan otros» sólo con la mesa en curso: completa o cerrada, no', () => {
    for (const status of ['fully_paid', 'completed', 'settled', 'expired', 'pending_auth']) {
      expect(estadoPersonalDeMesa({ status, my_status: 'paid' }), status).toBeNull();
    }
  });
});

describe('G-34 · pagadoPropioCentavos', () => {
  it('control positivo: centavos enteros > 0 junto a paid o pending', () => {
    expect(pagadoPropioCentavos({ status: 'partially_paid', my_status: 'paid', my_paid_cents: 15500 })).toBe(15500);
    expect(pagadoPropioCentavos({ status: 'open', my_status: 'pending', my_paid_cents: 1 })).toBe(1);
  });

  it('🔴 con 0 no hay línea: «Pagaste $0.00» no se dibuja, la etiqueta personal sigue', () => {
    expect(pagadoPropioCentavos({ status: 'open', my_status: 'pending', my_paid_cents: 0 })).toBeNull();
    expect(pagadoPropioCentavos({ status: 'partially_paid', my_status: 'paid', my_paid_cents: 0 })).toBeNull();
    expect(estadoPersonalDeMesa({ status: 'open', my_status: 'pending' })).toBe('pending');
  });

  it('🔴 sin etiqueta personal no se muestra, aunque el monto venga', () => {
    expect(pagadoPropioCentavos({ status: 'partially_paid', my_status: 'not_applicable', my_paid_cents: 15500 })).toBeNull();
    expect(pagadoPropioCentavos({ status: 'fully_paid', my_status: 'paid', my_paid_cents: 15500 })).toBeNull();
  });

  it('🔴 un monto que no son centavos enteros ≥ 0 no se muestra', () => {
    for (const raro of [undefined, '15500', 155.5, -1, Number.NaN]) {
      expect(pagadoPropioCentavos({ status: 'partially_paid', my_status: 'paid', my_paid_cents: raro }), String(raro)).toBeNull();
    }
  });
});

describe('G-31 · iconoDeCategoriaRestaurante', () => {
  it('control positivo: cada cocina del enum tiene su ícono', () => {
    expect(iconoDeCategoriaRestaurante('italian')).toBe('pasta');
    expect(iconoDeCategoriaRestaurante('japanese')).toBe('sushi');
    expect(iconoDeCategoriaRestaurante('mexican')).toBe('taco');
    expect(iconoDeCategoriaRestaurante('cafe')).toBe('coffee');
  });

  it('🔴 other, ausente o desconocido ⇒ store, que no afirma ninguna cocina', () => {
    for (const raro of ['other', undefined, null, '', 'Japanese', 'sushi', 'toString', '__proto__', 7]) {
      expect(iconoDeCategoriaRestaurante(raro), String(raro)).toBe('store');
    }
  });
});

describe('AF-24 · «Tus mesas»', () => {
  it('las mesas en curso no van a Historial (ya están en Inicio)', () => {
    for (const s of ['pending_auth', 'open', 'partially_paid']) expect(tuMesaEnCurso(s), s).toBe(true);
    for (const s of ['expired', 'completed', 'fully_paid', 'cancelled']) expect(tuMesaEnCurso(s), s).toBe(false);
  });

  it('🔴 «Cerró sin cobro» exige guarantee_mode false Y un motivo de cierre (una legacy con false no alcanza)', () => {
    expect(estadoDeTuMesa({ status: 'expired', guaranteeMode: false, closureReason: 'time' })).toBe('sin_cobro');
    expect(estadoDeTuMesa({ status: 'expired', guaranteeMode: false, closureReason: 'all_items_selected' })).toBe('sin_cobro');
    expect(estadoDeTuMesa({ status: 'expired', guaranteeMode: false, closureReason: null })).toBe('vencio');
    expect(estadoDeTuMesa({ status: 'completed', guaranteeMode: false, closureReason: null })).toBe('pagada');
  });

  it('el resto de los estados', () => {
    expect(estadoDeTuMesa({ status: 'completed', guaranteeMode: true, closureReason: null })).toBe('pagada');
    expect(estadoDeTuMesa({ status: 'expired', guaranteeMode: true, closureReason: null })).toBe('vencio');
    expect(estadoDeTuMesa({ status: 'cancelled', guaranteeMode: true, closureReason: null })).toBe('cancelada');
    expect(estadoDeTuMesa({ status: 'raro', guaranteeMode: null, closureReason: null })).toBe('cerrada');
  });
});

describe('AF-34 · mesaDelAviso · a qué mesa lleva el aviso', () => {
  it('mesa_expired con código: esa mesa', () => {
    expect(mesaDelAviso({ type: 'mesa_expired', payload: { mesa_code: 'PA-1099', closure_reason: 'time' } })).toBe('PA-1099');
  });

  it('sin código, código raro u otro tipo: no navega', () => {
    expect(mesaDelAviso({ type: 'mesa_expired', payload: { closure_reason: 'time' } })).toBeNull();
    expect(mesaDelAviso({ type: 'mesa_expired', payload: null })).toBeNull();
    expect(mesaDelAviso({ type: 'mesa_expired', payload: { mesa_code: 42 } })).toBeNull();
    expect(mesaDelAviso({ type: 'mesa_expired', payload: { mesa_code: '   ' } })).toBeNull();
    expect(mesaDelAviso({ type: 'payment_failed', payload: { mesa_code: 'PA-1099' } })).toBeNull();
  });

  it('🔴 un closure_reason desconocido no cambia nada: el texto es el body del dueño', () => {
    expect(mesaDelAviso({ type: 'mesa_expired', payload: { mesa_code: 'PA-1', closure_reason: 'algo_nuevo' } })).toBe('PA-1');
  });
});
