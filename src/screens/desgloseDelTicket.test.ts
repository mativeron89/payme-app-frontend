import { describe, expect, it } from 'vitest';
import { desgloseDelTicket, montoDeDescuento, notaDeLoQueNoSeReparte } from './desgloseDelTicket';

/**
 * D209 · D215 · D218 · cuándo «Ver el ticket» muestra subtotal, IVA y
 * descuento, en qué orden, y qué queda afuera de lo que paga cada uno.
 */
const totales = { subtotal_cents: 36207, tax_cents: 5793 };
const descuento50 = [{ kind: 'discount' as const, amount_cents: 5000 }];
const claves = (d: ReturnType<typeof desgloseDelTicket>) => (d.tipo === 'cierra' ? d.filas.map((f) => `${f.clave}:${f.cents}`) : []);

describe('desgloseDelTicket · sin descuento (D209, D215)', () => {
  it('🔴 IVA incluido: los ítems suman el total impreso; nada queda aparte', () => {
    const d = desgloseDelTicket({ sumaItems: 42000, ticketValido: true, impreso: 42000, totales });
    expect(claves(d)).toEqual(['subtotal:36207', 'iva:5793', 'total:42000']);
    expect(d.tipo === 'cierra' && d.aparte).toEqual({ ivaCents: 0, descuentoCents: 0, servicioCents: 0 });
  });

  it('🔴 IVA agregado: los ítems suman EXACTO el subtotal; el IVA queda aparte', () => {
    const d = desgloseDelTicket({ sumaItems: 36207, ticketValido: true, impreso: 42000, totales });
    expect(claves(d)).toEqual(['subtotal:36207', 'iva:5793', 'total:42000']);
    expect(d.tipo === 'cierra' && d.aparte).toEqual({ ivaCents: 5793, descuentoCents: 0, servicioCents: 0 });
  });

  it.each([
    ['sin totales ni descuento', { sumaItems: 42000, ticketValido: true, impreso: 42000, totales: null }],
    ['sin total impreso', { sumaItems: 42000, ticketValido: true, impreso: null, totales }],
    ['ticket incompleto', { sumaItems: 42000, ticketValido: false, impreso: 42000, totales }],
    ['ítems editados que ya no cierran', { sumaItems: 40000, ticketValido: true, impreso: 42000, totales }],
    ['un centavo arriba del subtotal', { sumaItems: 36208, ticketValido: true, impreso: 42000, totales }],
    ['totales que no cierran con el impreso', { sumaItems: 42000, ticketValido: true, impreso: 42001, totales }],
  ])('%s: «ninguno», la pantalla queda como antes', (_caso, entrada) => {
    expect(desgloseDelTicket(entrada)).toEqual({ tipo: 'ninguno' });
  });

  it('con IVA cero y los ítems en el total, nada aparte', () => {
    const d = desgloseDelTicket({ sumaItems: 42000, ticketValido: true, impreso: 42000, totales: { subtotal_cents: 42000, tax_cents: 0 } });
    expect(d.tipo === 'cierra' && d.aparte).toEqual({ ivaCents: 0, descuentoCents: 0, servicioCents: 0 });
  });
});

describe('desgloseDelTicket · con descuento (D218)', () => {
  it('🔴 sin totales: ítems − descuento = impreso → Descuento y Total', () => {
    const d = desgloseDelTicket({ sumaItems: 84000, ticketValido: true, impreso: 79000, totales: null, ajustes: descuento50 });
    expect(claves(d)).toEqual(['descuento:5000', 'total:79000']);
    expect(d.tipo === 'cierra' && d.aparte).toEqual({ ivaCents: 0, descuentoCents: 5000, servicioCents: 0 });
  });

  it('🔴 subtotal antes del descuento, sin IVA: Subtotal, Descuento, Total', () => {
    const d = desgloseDelTicket({
      sumaItems: 84000, ticketValido: true, impreso: 79000, totales: { subtotal_cents: 84000 }, ajustes: descuento50,
    });
    expect(claves(d)).toEqual(['subtotal:84000', 'descuento:5000', 'total:79000']);
  });

  it('🔴 subtotal ya descontado: el Descuento va antes del Subtotal', () => {
    const d = desgloseDelTicket({
      sumaItems: 84000, ticketValido: true, impreso: 79000, totales: { subtotal_cents: 79000 }, ajustes: descuento50,
    });
    expect(claves(d)).toEqual(['descuento:5000', 'subtotal:79000', 'total:79000']);
  });

  it('🔴 IVA agregado y descuento: Subtotal, IVA, Descuento, Total; los dos aparte', () => {
    const d = desgloseDelTicket({
      sumaItems: 84000, ticketValido: true, impreso: 92440, totales: { subtotal_cents: 84000, tax_cents: 13440 }, ajustes: descuento50,
    });
    expect(claves(d)).toEqual(['subtotal:84000', 'iva:13440', 'descuento:5000', 'total:92440']);
    expect(d.tipo === 'cierra' && d.aparte).toEqual({ ivaCents: 13440, descuentoCents: 5000, servicioCents: 0 });
  });

  it('IVA incluido y descuento: el IVA no queda aparte, el descuento sí', () => {
    // Precios con IVA: 89000 − 5000 = 84000 impreso = 72414 + 11586.
    const d = desgloseDelTicket({
      sumaItems: 89000, ticketValido: true, impreso: 84000, totales: { subtotal_cents: 72414, tax_cents: 11586 }, ajustes: descuento50,
    });
    expect(claves(d)).toEqual(['descuento:5000', 'subtotal:72414', 'iva:11586', 'total:84000']);
    expect(d.tipo === 'cierra' && d.aparte).toEqual({ ivaCents: 0, descuentoCents: 5000, servicioCents: 0 });
  });

  it('🔴 ítems editados que ya no cierran con el descuento: «ninguno»', () => {
    expect(desgloseDelTicket({ sumaItems: 80000, ticketValido: true, impreso: 79000, totales: null, ajustes: descuento50 }))
      .toEqual({ tipo: 'ninguno' });
  });

  it('varios descuentos se suman', () => {
    const d = desgloseDelTicket({
      sumaItems: 84000, ticketValido: true, impreso: 77000, totales: null,
      ajustes: [{ kind: 'discount', amount_cents: 5000 }, { kind: 'discount', amount_cents: 2000 }],
    });
    expect(claves(d)).toEqual(['descuento:7000', 'total:77000']);
  });
});

describe('la nota y el monto del descuento', () => {
  const t = (s: string, ...a: unknown[]) => a.reduce<string>((acc, v, i) => acc.replace(`{${i}}`, String(v)), s);

  it('el descuento se muestra en negativo, con el menos tipográfico', () => {
    expect(montoDeDescuento(5000)).toBe('−$50');
  });

  it('🔴 los textos aprobados: sólo descuento, sólo IVA y los dos en una sola nota', () => {
    expect(notaDeLoQueNoSeReparte({ ivaCents: 0, descuentoCents: 5000 }, t))
      .toBe('Lo que paga cada uno todavía no incluye el descuento (−$50)');
    expect(notaDeLoQueNoSeReparte({ ivaCents: 13440, descuentoCents: 0 }, t))
      .toBe('Lo que paga cada uno todavía no incluye el IVA ($134.40)');
    expect(notaDeLoQueNoSeReparte({ ivaCents: 13440, descuentoCents: 5000 }, t))
      .toBe('Lo que paga cada uno todavía no incluye el IVA ($134.40) ni el descuento (−$50)');
    expect(notaDeLoQueNoSeReparte({ ivaCents: 0, descuentoCents: 0 }, t)).toBeNull();
  });
});

describe('desgloseDelTicket · con cargo por servicio (D224)', () => {
  const servicio85 = [{ kind: 'service_charge' as const, amount_cents: 8500 }];
  const t = (s: string, ...a: unknown[]) => a.reduce<string>((acc, v, i) => acc.replace(`{${i}}`, String(v)), s);

  it('🔴 sin totales: ítems + servicio = impreso → Cargo por servicio y Total; el servicio aparte', () => {
    const d = desgloseDelTicket({ sumaItems: 84000, ticketValido: true, impreso: 92500, totales: null, ajustes: servicio85 });
    expect(claves(d)).toEqual(['servicio:8500', 'total:92500']);
    expect(d.tipo === 'cierra' && d.aparte).toEqual({ ivaCents: 0, descuentoCents: 0, servicioCents: 8500 });
  });

  it('🔴 IVA agregado y servicio: Subtotal, IVA, Cargo por servicio, Total (plan A)', () => {
    const d = desgloseDelTicket({
      sumaItems: 84000, ticketValido: true, impreso: 105940, totales: { subtotal_cents: 84000, tax_cents: 13440 }, ajustes: servicio85,
    });
    expect(claves(d)).toEqual(['subtotal:84000', 'iva:13440', 'servicio:8500', 'total:105940']);
    expect(d.tipo === 'cierra' && d.aparte).toEqual({ ivaCents: 13440, descuentoCents: 0, servicioCents: 8500 });
  });

  it('🔴 IVA, servicio y descuento después del subtotal: el servicio antes del descuento', () => {
    const d = desgloseDelTicket({
      sumaItems: 84000, ticketValido: true, impreso: 100940, totales: { subtotal_cents: 84000, tax_cents: 13440 },
      ajustes: [{ kind: 'discount', amount_cents: 5000 }, ...servicio85],
    });
    expect(claves(d)).toEqual(['subtotal:84000', 'iva:13440', 'servicio:8500', 'descuento:5000', 'total:100940']);
    expect(d.tipo === 'cierra' && d.aparte).toEqual({ ivaCents: 13440, descuentoCents: 5000, servicioCents: 8500 });
  });

  it('con el subtotal ya descontado, el descuento va primero, como hoy', () => {
    const d = desgloseDelTicket({
      sumaItems: 84000, ticketValido: true, impreso: 100140, totales: { subtotal_cents: 79000, tax_cents: 12640 },
      ajustes: [{ kind: 'discount', amount_cents: 5000 }, ...servicio85],
    });
    expect(claves(d)).toEqual(['descuento:5000', 'subtotal:79000', 'iva:12640', 'servicio:8500', 'total:100140']);
  });

  it('🔴 sin el servicio no cierra: el servicio no se resta ni se ignora', () => {
    // Ítems editados que ya no cierran con el servicio.
    expect(desgloseDelTicket({ sumaItems: 80000, ticketValido: true, impreso: 92500, totales: null, ajustes: servicio85 }))
      .toEqual({ tipo: 'ninguno' });
  });

  it('🔴 las cuatro notas con el servicio (plan C, aprobadas)', () => {
    expect(notaDeLoQueNoSeReparte({ ivaCents: 0, descuentoCents: 0, servicioCents: 8500 }, t))
      .toBe('Lo que paga cada uno todavía no incluye el cargo por servicio ($85)');
    expect(notaDeLoQueNoSeReparte({ ivaCents: 13440, descuentoCents: 0, servicioCents: 8500 }, t))
      .toBe('Lo que paga cada uno todavía no incluye el IVA ($134.40) ni el cargo por servicio ($85)');
    expect(notaDeLoQueNoSeReparte({ ivaCents: 0, descuentoCents: 5000, servicioCents: 8500 }, t))
      .toBe('Lo que paga cada uno todavía no incluye el cargo por servicio ($85) ni el descuento (−$50)');
    expect(notaDeLoQueNoSeReparte({ ivaCents: 13440, descuentoCents: 5000, servicioCents: 8500 }, t))
      .toBe('Lo que paga cada uno todavía no incluye el IVA ($134.40), el cargo por servicio ($85) ni el descuento (−$50)');
  });
});
