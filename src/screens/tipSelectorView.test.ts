import { describe, expect, it } from 'vitest';
import {
  NO_TIP_CHOSEN,
  TIP_OPTIONS,
  type TipChoice,
  tipCentsFor,
  tipIsChosen,
  tipPayloadFor,
  tipScopeToken,
} from './tipSelectorView';

/**
 * El defecto que estos tests fijan tenía un número: **1500**.
 *
 * `MesaScreen` arrancaba en `useState(15)` y quien no tocaba el selector pagaba
 * 15 % de su parte con un payload que decía `tip_bps: 1500`, indistinguible de
 * una elección. Lo que se acredita acá no es la aritmética de la propina —esa
 * ya la fija `money.test.ts`— sino que **el punto de partida no cobra nada** y
 * que el único camino por el que una propina no elegida llega al cable manda
 * cero.
 *
 * La mesa de referencia es la del recorrido de pago: ticket $840.00 entre 4 =
 * base $210.00. El 15 % de esa base son $31.50, que es exactamente la plata que
 * el defecto movía sin permiso.
 */

const BASE = { totalCents: 84000, participants: 4, customStr: '' };

describe('el punto de partida no elige nada', () => {
  it('el estado inicial NO está elegido', () => {
    expect(tipIsChosen(NO_TIP_CHOSEN)).toBe(false);
  });

  it('🔴 sin elegir no hay propina: 0, y en particular NO los 3150 del default viejo', () => {
    expect(tipCentsFor(NO_TIP_CHOSEN, BASE)).toBe(0);
    // La afirmación directa del defecto: 3150 es el 15 % que se cobraba solo.
    expect(tipCentsFor(NO_TIP_CHOSEN, BASE)).not.toBe(3150);
  });

  it('🔴 sin elegir el payload manda tip_bps 0 EXPLÍCITO, nunca 1500', () => {
    expect(tipPayloadFor(NO_TIP_CHOSEN, 0)).toEqual({ tip_bps: 0 });
  });

  it('el 15 % sigue siendo 15 % cuando alguien lo elige', () => {
    const elegido: TipChoice = { mode: 'pct', pct: 15 };
    expect(tipCentsFor(elegido, BASE)).toBe(3150);
    expect(tipPayloadFor(elegido, 3150)).toEqual({ tip_bps: 1500 });
  });
});

describe('los presets', () => {
  it('son los cinco del spec, con el 5 % adentro y el 0 % primero', () => {
    expect(TIP_OPTIONS).toEqual([0, 5, 10, 15, 20]);
  });

  it('ninguno viene pre-elegido: el estado inicial no es ninguno de ellos', () => {
    // Un preset "elegido de fábrica" sería representable sólo escribiendo
    // `{ mode: 'pct', pct: N }` como estado inicial. Acá se fija que no lo es.
    for (const pct of TIP_OPTIONS) {
      expect(tipIsChosen({ mode: 'pct', pct })).toBe(true);
    }
    expect(tipIsChosen(NO_TIP_CHOSEN)).toBe(false);
  });

  it('el 0 % elegido es una elección de primera clase, no un "no elegí"', () => {
    const cero: TipChoice = { mode: 'pct', pct: 0 };
    expect(tipIsChosen(cero)).toBe(true);
    expect(tipCentsFor(cero, BASE)).toBe(0);
    expect(tipPayloadFor(cero, 0)).toEqual({ tip_bps: 0 });
  });
});

describe('el monto a mano', () => {
  it('toma centavos enteros del texto tipeado', () => {
    expect(tipCentsFor({ mode: 'custom' }, { ...BASE, customStr: '31.5' })).toBe(3150);
  });

  it('vacío o ilegible es 0, no una excepción en la pantalla de pago', () => {
    expect(tipCentsFor({ mode: 'custom' }, { ...BASE, customStr: '' })).toBe(0);
    expect(tipCentsFor({ mode: 'custom' }, { ...BASE, customStr: '1.2.3' })).toBe(0);
  });
});

describe('el token de la clave de idempotencia', () => {
  it('sale del payload, así que el fallback y el 0 % elegido comparten token', () => {
    // No es un descuido: los dos mandan EXACTAMENTE el mismo cuerpo. Dos tokens
    // distintos para un mismo payload darían dos claves locales para un solo
    // cobro del backend.
    expect(tipScopeToken(tipPayloadFor(NO_TIP_CHOSEN, 0))).toBe('b0');
    expect(tipScopeToken(tipPayloadFor({ mode: 'pct', pct: 0 }, 0))).toBe('b0');
  });

  it('conserva la forma que ya usaba el scope: b<bps> y c<centavos>', () => {
    expect(tipScopeToken(tipPayloadFor({ mode: 'pct', pct: 20 }, 4200))).toBe('b2000');
    expect(tipScopeToken(tipPayloadFor({ mode: 'custom' }, 4200))).toBe('c4200');
  });
});
