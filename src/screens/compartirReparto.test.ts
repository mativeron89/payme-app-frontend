import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MyShare, ShareTotals } from '../api/miParte';
import { traducir, type Idioma } from '../i18n/idioma';
import { formatMXN } from '../utils/format';
import { compartirTexto, montoDeAjustes, textoDelReparto, type DatosDelReparto } from './compartirReparto';
import { renglonDeAjustes, rotuloDeAjustes, rotuloDePropina } from './miParteView';

/**
 * D588–D591 · «Compartir» el reparto, entrega 1 (texto). Las cuentas son las de
 * `e2e/mi-parte-d344.spec.ts`: ticket de $840 en platos.
 */

const tr = (idioma: Idioma) => (s: string, ...args: unknown[]) => traducir(s, idioma, ...args);
const es = tr('es');
const en = tr('en');
const MENOS = '−';

/** Por consumo, descuento de $50, 15 %: el organizador eligió el Tagliatelle ($195). */
const TOTALES_DESCUENTO: ShareTotals = {
  items_cents: 84000, discounts_cents: 5000, service_cents: 0, tax_added_cents: 0, adjustments_cents: -5000,
  tip_basis_cents: 79000, tip_cents: 11850, total_cents: 90850,
  adjustments_omitted: false, adjustments_omitted_reason: null,
};
const MIA_DESCUENTO: MyShare = { items_cents: 19500, adjustments_cents: -1161, tip_cents: 2751, total_cents: 21090 };

/** Partes iguales entre 4, servicio $85 y descuento $50, 10 %. */
const TOTALES_SERVICIO: ShareTotals = {
  items_cents: 84000, discounts_cents: 5000, service_cents: 8500, tax_added_cents: 0, adjustments_cents: 3500,
  tip_basis_cents: 79000, tip_cents: 7900, total_cents: 95400,
  adjustments_omitted: false, adjustments_omitted_reason: null,
};
const MIA_SERVICIO: MyShare = { items_cents: 21000, adjustments_cents: 875, tip_cents: 1975, total_cents: 23850 };

/** Sin ajustes ni propina fijada. */
const TOTALES_LIMPIOS: ShareTotals = {
  items_cents: 84000, discounts_cents: 0, service_cents: 0, tax_added_cents: 0, adjustments_cents: 0,
  tip_basis_cents: 84000, tip_cents: 0, total_cents: 84000,
  adjustments_omitted: false, adjustments_omitted_reason: null,
};
const MIA_LIMPIA: MyShare = { items_cents: 21000, adjustments_cents: 0, tip_cents: 0, total_cents: 21000 };

const consumoCerrada: DatosDelReparto = {
  restaurante: 'Trattoria Sintética',
  status: 'completed',
  divisionMode: 'consumo',
  expectedParticipants: 4,
  totalDeLaMesaCents: 84000,
  totales: TOTALES_DESCUENTO,
  mia: MIA_DESCUENTO,
  tipSetting: { tip_bps: 1500 },
};

const igualAbierta: DatosDelReparto = {
  restaurante: 'Trattoria Sintética',
  status: 'open',
  divisionMode: 'igual',
  expectedParticipants: 4,
  totalDeLaMesaCents: 84000,
  totales: TOTALES_SERVICIO,
  mia: MIA_SERVICIO,
  tipSetting: { tip_bps: 1000 },
};

describe('textoDelReparto · D588 · mi parte y el total de la mesa', () => {
  it('por consumo, mesa cerrada, con descuento (ES)', () => {
    expect(textoDelReparto(consumoCerrada, es)).toBe([
      'Trattoria Sintética',
      'Así quedó la mesa (por consumo)',
      'Mi parte: $210.90',
      '  Mis platos: $195',
      `  Descuento: ${MENOS}$11.61`,
      '  Propina (15 % de la mesa): $27.51',
      'Total del ticket: $840',
      'Dividido con PayMe · paymemx.com',
    ].join('\n'));
  });

  it('por consumo, mesa cerrada, con descuento (EN)', () => {
    expect(textoDelReparto(consumoCerrada, en)).toBe([
      'Trattoria Sintética',
      'How the table ended up (by item)',
      'My share: $210.90',
      '  My dishes: $195',
      `  Discount: ${MENOS}$11.61`,
      '  Tip (15 % for the table): $27.51',
      'Ticket total: $840',
      'Split with PayMe · paymemx.com',
    ].join('\n'));
  });

  it('partes iguales, mesa abierta, con servicio y descuento: «entre N» y nunca «cada uno»', () => {
    const texto = textoDelReparto(igualAbierta, es);
    expect(texto).toBe([
      'Trattoria Sintética',
      'Así va la mesa (partes iguales, entre 4)',
      'Mi parte: $238.50',
      '  Mis platos: $210',
      '  Descuento y cargos del ticket: +$8.75',
      '  Propina (10 % de la mesa): $19.75',
      'Total del ticket: $840',
      'Dividido con PayMe · paymemx.com',
    ].join('\n'));
    expect(texto).not.toMatch(/cada uno/i);
    expect(textoDelReparto(igualAbierta, en)).toContain('How the table is going (split evenly, between 4)');
  });

  it('sin ajustes ni propina fijada: no hay renglón de ajustes y la propina va sin %', () => {
    const texto = textoDelReparto({ ...igualAbierta, totales: TOTALES_LIMPIOS, mia: MIA_LIMPIA, tipSetting: null }, es);
    expect(texto.split('\n')).toEqual([
      'Trattoria Sintética',
      'Así va la mesa (partes iguales, entre 4)',
      'Mi parte: $210',
      '  Mis platos: $210',
      '  Propina: $0',
      'Total del ticket: $840',
      'Dividido con PayMe · paymemx.com',
    ]);
  });

  it('una sola persona: describe toda la cuenta sin invitar a pagar con pagos apagados', () => {
    const texto = textoDelReparto({ ...igualAbierta, expectedParticipants: 1 }, es);
    expect(texto).toContain('Así va la mesa (toda la cuenta)');
    expect(texto).not.toMatch(/\bpagar\b/i);
  });

  it('🔴 los renglones dicen lo mismo que «Tu parte»: mismas funciones de rótulo y de monto', () => {
    for (const datos of [consumoCerrada, igualAbierta]) {
      const texto = textoDelReparto(datos, es);
      const renglon = renglonDeAjustes(datos.totales, datos.mia);
      expect(renglon).not.toBeNull();
      expect(texto).toContain(`  ${rotuloDeAjustes(renglon!, es)}: ${montoDeAjustes(datos.mia)}`);
      expect(texto).toContain(`  ${rotuloDePropina(datos.tipSetting, es)}: ${formatMXN(datos.mia.tip_cents)}`);
      expect(texto).toContain(`Mi parte: ${formatMXN(datos.mia.total_cents)}`);
    }
  });

  it('🔴 sólo lo que la persona ve: ni código, ni link de la mesa, ni la parte de otro', () => {
    const texto = textoDelReparto(consumoCerrada, es);
    expect(texto).not.toMatch(/PA-|#\/mesa|https?:\/\//);
    // Los únicos montos son los cuatro del desglose propio y el total del encabezado.
    const montos = texto.match(/\$[\d,.]+/g) ?? [];
    expect(montos).toEqual(['$210.90', '$195', '$11.61', '$27.51', '$840']);
  });

  it('montoDeAjustes: el descuento con el signo menos, el cargo como monto', () => {
    expect(montoDeAjustes(MIA_DESCUENTO)).toBe(`${MENOS}$11.61`);
    expect(montoDeAjustes(MIA_SERVICIO)).toBe('+$8.75');
    expect(montoDeAjustes({ ...MIA_LIMPIA, adjustments_cents: 0 })).toBe('$0');
    expect(montoDeAjustes({ ...MIA_LIMPIA, adjustments_cents: 1 })).toBe('+$0.01');
    expect(montoDeAjustes({ ...MIA_LIMPIA, adjustments_cents: -1 })).toBe('−$0.01');
  });
});

describe('compartirTexto · D588 · hoja nativa y copia de respaldo', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('con hoja nativa: comparte el texto y no copia', async () => {
    const share = vi.fn(async () => undefined);
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { share, clipboard: { writeText } });
    await expect(compartirTexto('hola')).resolves.toBe('compartido');
    expect(share).toHaveBeenCalledWith({ text: 'hola' });
    expect(writeText).not.toHaveBeenCalled();
  });

  it('si la persona cancela la hoja (AbortError): ni copia ni aviso', async () => {
    const share = vi.fn(async () => { throw Object.assign(new Error('cancel'), { name: 'AbortError' }); });
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { share, clipboard: { writeText } });
    await expect(compartirTexto('hola')).resolves.toBe('cancelado');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('si la hoja falla por otra cosa: copia', async () => {
    const share = vi.fn(async () => { throw Object.assign(new Error('no'), { name: 'NotAllowedError' }); });
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { share, clipboard: { writeText } });
    await expect(compartirTexto('hola')).resolves.toBe('copiado');
    expect(writeText).toHaveBeenCalledWith('hola');
  });

  it('sin hoja nativa: copia; sin portapapeles, lo dice', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    await expect(compartirTexto('hola')).resolves.toBe('copiado');
    expect(writeText).toHaveBeenCalledWith('hola');
    vi.stubGlobal('navigator', {});
    await expect(compartirTexto('hola')).resolves.toBe('sin_portapapeles');
  });
});
