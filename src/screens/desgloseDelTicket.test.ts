import { describe, expect, it } from 'vitest';
import { desgloseDelTicket, montoDeDescuento, notaDeLoQueNoSeReparte } from './desgloseDelTicket';
import { notaDeLoQueYaIncluyeMiParte, notaNeutraDelAlta } from './desgloseDelTicket';

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

/**
 * D344 · las notas de «Mi parte» (respuesta 4 de V, aprobada). Montos distintos
 * en los tres campos para que un argumento cambiado de lugar se note:
 *   · IVA 13440 centavos      → formatMXN → «$134.40»
 *   · servicio 8525 centavos  → formatMXN → «$85.25»
 *   · descuento 5070 centavos → montoDeDescuento → «−$50.70» (U+2212 + «$50.70»)
 */
describe('D344 · notaDeLoQueYaIncluyeMiParte: lo que paga cada uno YA incluye los ajustes', () => {
  const t = (s: string, ...a: unknown[]) => a.reduce<string>((acc, v, i) => acc.replace(`{${i}}`, String(v)), s);
  const totales = (tax_added_cents: number, service_cents: number, discounts_cents: number) =>
    ({ tax_added_cents, service_cents, discounts_cents });

  // Las siete combinaciones, en el orden IVA, servicio, descuento; la última
  // unión con «y». Un caso por término de cada condición del código.
  it.each([
    ['sólo IVA', totales(13440, 0, 0), 'Lo que paga cada uno ya incluye el IVA ($134.40)'],
    ['sólo servicio', totales(0, 8525, 0), 'Lo que paga cada uno ya incluye el cargo por servicio ($85.25)'],
    ['sólo descuento', totales(0, 0, 5070), 'Lo que paga cada uno ya incluye el descuento (−$50.70)'],
    ['IVA y servicio', totales(13440, 8525, 0),
      'Lo que paga cada uno ya incluye el IVA ($134.40) y el cargo por servicio ($85.25)'],
    ['IVA y descuento', totales(13440, 0, 5070),
      'Lo que paga cada uno ya incluye el IVA ($134.40) y el descuento (−$50.70)'],
    ['servicio y descuento', totales(0, 8525, 5070),
      'Lo que paga cada uno ya incluye el cargo por servicio ($85.25) y el descuento (−$50.70)'],
    ['los tres', totales(13440, 8525, 5070),
      'Lo que paga cada uno ya incluye el IVA ($134.40), el cargo por servicio ($85.25) y el descuento (−$50.70)'],
  ])('🔴 %s: el texto exacto aprobado', (_caso, entrada, esperado) => {
    expect(notaDeLoQueYaIncluyeMiParte(entrada, t)).toBe(esperado);
  });

  it('🔴 sin ninguno de los tres: null', () => {
    expect(notaDeLoQueYaIncluyeMiParte(totales(0, 0, 0), t)).toBeNull();
  });

  it('🔴 la última unión es «y», nunca «ni», y no dice «todavía no incluye»', () => {
    const combinaciones = [
      totales(13440, 0, 0), totales(0, 8525, 0), totales(0, 0, 5070), totales(13440, 8525, 0),
      totales(13440, 0, 5070), totales(0, 8525, 5070), totales(13440, 8525, 5070),
    ];
    for (const c of combinaciones) {
      const nota = notaDeLoQueYaIncluyeMiParte(c, t);
      expect(nota, JSON.stringify(c)).not.toBeNull();
      expect(nota, JSON.stringify(c)).toContain('ya incluye');
      expect(nota, JSON.stringify(c)).not.toContain(' ni ');
      expect(nota, JSON.stringify(c)).not.toContain('todavía no incluye');
    }
  });

  it('🔴 el descuento lleva el menos tipográfico U+2212, no el guion ASCII', () => {
    const nota = notaDeLoQueYaIncluyeMiParte(totales(0, 0, 5070), t)!;
    expect(nota).toContain('(−$50.70)');
    expect(nota).not.toContain('-$50.70');
  });

  it('el descuento va en positivo en la entrada y en negativo en el texto, con miles', () => {
    // 125050 centavos → «$1,250.50»; con el menos: «−$1,250.50».
    expect(notaDeLoQueYaIncluyeMiParte(totales(0, 0, 125050), t))
      .toBe('Lo que paga cada uno ya incluye el descuento (−$1,250.50)');
  });
});

describe('D344 · notaNeutraDelAlta: la nota de «¿Cómo dividen?» antes de crear la mesa', () => {
  const t = (s: string, ...a: unknown[]) => a.reduce<string>((acc, v, i) => acc.replace(`{${i}}`, String(v)), s);
  const final = ' en lo que paga cada uno se ve en «Mi parte» al crear la mesa';

  // Singular («Cómo queda el …») con uno; plural («Cómo quedan …») con dos o tres.
  it.each([
    ['sólo IVA', { ivaCents: 13440, descuentoCents: 0, servicioCents: 0 }, `Cómo queda el IVA ($134.40)${final}`, 1],
    ['sólo servicio', { ivaCents: 0, descuentoCents: 0, servicioCents: 8525 },
      `Cómo queda el cargo por servicio ($85.25)${final}`, 1],
    ['sólo descuento', { ivaCents: 0, descuentoCents: 5070, servicioCents: 0 }, `Cómo queda el descuento (−$50.70)${final}`, 1],
    ['IVA y servicio', { ivaCents: 13440, descuentoCents: 0, servicioCents: 8525 },
      `Cómo quedan el IVA ($134.40) y el cargo por servicio ($85.25)${final}`, 2],
    ['IVA y descuento', { ivaCents: 13440, descuentoCents: 5070, servicioCents: 0 },
      `Cómo quedan el IVA ($134.40) y el descuento (−$50.70)${final}`, 2],
    ['servicio y descuento', { ivaCents: 0, descuentoCents: 5070, servicioCents: 8525 },
      `Cómo quedan el cargo por servicio ($85.25) y el descuento (−$50.70)${final}`, 2],
    ['los tres', { ivaCents: 13440, descuentoCents: 5070, servicioCents: 8525 },
      `Cómo quedan el IVA ($134.40), el cargo por servicio ($85.25) y el descuento (−$50.70)${final}`, 3],
  ])('🔴 %s: el texto exacto, neutro', (_caso, aparte, esperado, cuantos) => {
    const nota = notaNeutraDelAlta(aparte, t);
    expect(nota).toBe(esperado);
    // Lo que pide la especificación, además del texto exacto.
    expect(nota).not.toContain('todavía no incluye');
    expect(nota).not.toContain('ya incluye');
    expect(nota!.endsWith('se ve en «Mi parte» al crear la mesa')).toBe(true);
    expect(nota!.startsWith(cuantos === 1 ? 'Cómo queda el ' : 'Cómo quedan el ')).toBe(true);
  });

  it('🔴 sin ninguno: null, con el servicio en cero o sin la clave', () => {
    expect(notaNeutraDelAlta({ ivaCents: 0, descuentoCents: 0, servicioCents: 0 }, t)).toBeNull();
    expect(notaNeutraDelAlta({ ivaCents: 0, descuentoCents: 0 }, t)).toBeNull();
  });

  it('🔴 sin la clave del servicio cuenta como cero: rige la combinación sin servicio', () => {
    expect(notaNeutraDelAlta({ ivaCents: 13440, descuentoCents: 0 }, t)).toBe(`Cómo queda el IVA ($134.40)${final}`);
    expect(notaNeutraDelAlta({ ivaCents: 13440, descuentoCents: 5070 }, t))
      .toBe(`Cómo quedan el IVA ($134.40) y el descuento (−$50.70)${final}`);
  });
});

describe('D344 · notaDeLoQueNoSeReparte sigue igual (no cambió con «Mi parte»)', () => {
  const t = (s: string, ...a: unknown[]) => a.reduce<string>((acc, v, i) => acc.replace(`{${i}}`, String(v)), s);
  const inicio = 'Lo que paga cada uno todavía no incluye';

  // Las siete de siempre, con los mismos montos de arriba: «ni» en la última unión.
  it.each([
    ['sólo IVA', { ivaCents: 13440, descuentoCents: 0, servicioCents: 0 }, `${inicio} el IVA ($134.40)`],
    ['sólo servicio', { ivaCents: 0, descuentoCents: 0, servicioCents: 8525 }, `${inicio} el cargo por servicio ($85.25)`],
    ['sólo descuento', { ivaCents: 0, descuentoCents: 5070, servicioCents: 0 }, `${inicio} el descuento (−$50.70)`],
    ['IVA y servicio', { ivaCents: 13440, descuentoCents: 0, servicioCents: 8525 },
      `${inicio} el IVA ($134.40) ni el cargo por servicio ($85.25)`],
    ['IVA y descuento', { ivaCents: 13440, descuentoCents: 5070, servicioCents: 0 },
      `${inicio} el IVA ($134.40) ni el descuento (−$50.70)`],
    ['servicio y descuento', { ivaCents: 0, descuentoCents: 5070, servicioCents: 8525 },
      `${inicio} el cargo por servicio ($85.25) ni el descuento (−$50.70)`],
    ['los tres', { ivaCents: 13440, descuentoCents: 5070, servicioCents: 8525 },
      `${inicio} el IVA ($134.40), el cargo por servicio ($85.25) ni el descuento (−$50.70)`],
  ])('🔴 %s: el texto de siempre', (_caso, aparte, esperado) => {
    expect(notaDeLoQueNoSeReparte(aparte, t)).toBe(esperado);
  });

  it('sin ninguno: null, como siempre', () => {
    expect(notaDeLoQueNoSeReparte({ ivaCents: 0, descuentoCents: 0, servicioCents: 0 }, t)).toBeNull();
  });
});
