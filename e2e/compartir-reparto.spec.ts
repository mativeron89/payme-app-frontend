import { expect, test, type Page } from '@playwright/test';
import { RESTAURANTE_DE_EJEMPLO } from '../src/ayuda/ejemplo/fixtureEjemplo';
import { hastaCompartir } from './fixtures/mi-parte-d344';
import * as guia from './_guia';
import { abrirTusConsumos } from './_mesa';

/**
 * D588–D591 · AF-CLAUDE-COMPARTIR-REPARTO-0-269-0-20261030 · «Compartir» al pie
 * de «Tu parte», entrega 1 (texto). En el mock con los pagos apagados (la mesa
 * sin garantía), con las cuentas de `mi-parte-d344.spec.ts`: ticket de $840.
 *
 * La hoja nativa y el portapapeles se reemplazan en la página: lo compartido o
 * copiado queda en memoria, nunca en el sistema.
 *
 * Capturas a 390×844 (proyecto `movil`) sólo con `PAYME_E2E_CAPTURAS`.
 */

type Modo = 'hoja' | 'hoja_cancelada' | 'sin_hoja';

async function prepararCompartir(page: Page, modo: Modo): Promise<void> {
  await page.addInitScript((m: Modo) => {
    const compartidos: unknown[] = [];
    const copias: string[] = [];
    Object.defineProperty(window, '__compartidos', { value: compartidos });
    Object.defineProperty(window, '__copias', { value: copias });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (texto: string) => { copias.push(texto); } },
    });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: m === 'sin_hoja' ? undefined : async (datos: unknown) => {
        compartidos.push(datos);
        if (m === 'hoja_cancelada') throw new DOMException('cancelado', 'AbortError');
      },
    });
  }, modo);
}

const compartidos = (page: Page) => page.evaluate(() => (window as unknown as { __compartidos: unknown[] }).__compartidos);
const copias = (page: Page) => page.evaluate(() => (window as unknown as { __copias: string[] }).__copias);

async function capturar(page: Page, nombre: string, mostrar?: ReturnType<Page['locator']>): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (!dir) return;
  const solo = process.env.PAYME_E2E_CAPTURAS_SOLO?.split(',').map((n) => n.trim()).filter(Boolean);
  if (solo && !solo.includes(nombre)) return;
  if (mostrar) await mostrar.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: `${dir}/${nombre}.png`, animations: 'disabled' });
}

const MENOS = '−';
const tuParte = (page: Page) => page.getByRole('region', { name: 'Tu parte', exact: true });
const botonCompartir = (page: Page) => tuParte(page).getByRole('button', { name: 'Compartir', exact: true });

async function abrirTuParte(page: Page): Promise<void> {
  const cabecera = tuParte(page).locator('.desplegable-cabecera');
  if ((await cabecera.getAttribute('aria-expanded')) !== 'true') await cabecera.click();
  await expect(cabecera).toHaveAttribute('aria-expanded', 'true');
}

/** Partes iguales entre 4, servicio y descuento, 10 %: llega a «Tu mesa». */
async function mesaIgualesAl10(page: Page): Promise<void> {
  await hastaCompartir(page, { ocr: 'servicio_descuento', modo: 'igual' });
  await page.getByRole('region', { name: 'Propina de la mesa' }).getByRole('radio', { name: '10%', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Propina de la mesa' }).getByRole('radio', { name: '10%', exact: true }))
    .toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('region', { name: 'Propina de la mesa' }).getByRole('status')).toHaveCount(0);
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tu mesa' })).toBeVisible();
}

test.describe('D588–D591 · «Compartir» el reparto', () => {
  test('🔴 partes iguales: el botón va al pie de «Tu parte», debajo del total, y comparte mi parte y el total del ticket', async ({ page }) => {
    await prepararCompartir(page, 'hoja');
    await mesaIgualesAl10(page);
    await abrirTuParte(page);
    const boton = botonCompartir(page);
    await expect(boton).toBeVisible();
    // Debajo del «Total»: el botón empieza donde termina el renglón del total.
    const total = await tuParte(page).locator('.mi-parte-desglose-total').boundingBox();
    const caja = await boton.boundingBox();
    expect(total && caja && caja.y >= total.y + total.height).toBe(true);
    await capturar(page, 'compartir-01-boton-tu-parte', tuParte(page));

    await boton.click();
    await expect.poll(() => compartidos(page)).toHaveLength(1);
    const [datos] = await compartidos(page) as Array<{ text: string }>;
    // Sólo `text`: sin link ni título.
    expect(Object.keys(datos)).toEqual(['text']);
    const lineas = datos.text.split('\n');
    expect(lineas.slice(1)).toEqual([
      'Así va la mesa (partes iguales, entre 4)',
      'Mi parte: $238.50',
      '  Mis platos: $210',
      '  Descuento y cargos del ticket: +$8.75',
      '  Propina (10 % de la mesa): $19.75',
      'Total del ticket: $840',
      'Dividido con PayMe · paymemx.com',
    ]);
    // La primera línea es el restaurante que muestra el encabezado.
    expect(lineas[0]!.length).toBeGreaterThan(0);
    await expect(page.locator('.mesa-selection-context-main')).toHaveText(lineas[0]!);
    expect(datos.text).not.toMatch(/PA-|#\/mesa|https?:\/\//);
    // Con la hoja nativa no se copia.
    expect(await copias(page)).toEqual([]);
  });

  test('sin hoja nativa: copia el mismo texto y avisa «Copiado ✓»', async ({ page }) => {
    await prepararCompartir(page, 'sin_hoja');
    await mesaIgualesAl10(page);
    await abrirTuParte(page);
    await botonCompartir(page).click();
    await expect(page.getByText('Copiado ✓', { exact: true })).toBeVisible();
    const [texto] = await copias(page);
    expect(texto).toContain('Mi parte: $238.50');
    expect(texto).toContain('Total del ticket: $840');
    await capturar(page, 'compartir-02-copiado');
  });

  test('si la persona cancela la hoja: ni copia ni aviso', async ({ page }) => {
    await prepararCompartir(page, 'hoja_cancelada');
    await mesaIgualesAl10(page);
    await abrirTuParte(page);
    await botonCompartir(page).click();
    await expect.poll(() => compartidos(page)).toHaveLength(1);
    expect(await copias(page)).toEqual([]);
    await expect(page.getByText('Copiado ✓', { exact: true })).toHaveCount(0);
  });

  test('🔴 por consumo: antes de «Listo» no hay botón; después, comparte la parte guardada', async ({ page }) => {
    await prepararCompartir(page, 'hoja');
    const code = await hastaCompartir(page, { ocr: 'descuento', modo: 'consumo' });
    await page.getByRole('region', { name: 'Propina de la mesa' }).getByRole('radio', { name: '15%', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Propina de la mesa' }).getByRole('radio', { name: '15%', exact: true }))
      .toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('region', { name: 'Propina de la mesa' }).getByRole('status')).toHaveCount(0);
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Tu mesa' })).toBeVisible();
    await abrirTusConsumos(page);
    await page.getByRole('button', { name: /Tagliatelle Bolognese/ }).click();
    await expect(page.locator('.mi-parte-amt')).toHaveText('$210.90');
    // Elegido pero sin «Listo»: no hay «Tu parte» guardada, no hay botón.
    await expect(page.getByRole('button', { name: 'Compartir', exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: 'Listo', exact: true }).click();
    await expect.poll(() => page.evaluate(() => location.pathname)).toBe('/home');
    await page.goto(`/#/mesa/${code}`);
    await expect(page.getByRole('heading', { name: 'Tu mesa' })).toBeVisible();
    await abrirTuParte(page);
    await botonCompartir(page).click();
    await expect.poll(() => compartidos(page)).toHaveLength(1);
    const [datos] = await compartidos(page) as Array<{ text: string }>;
    expect(datos.text.split('\n').slice(1)).toEqual([
      'Así va la mesa (por consumo)',
      'Mi parte: $210.90',
      '  Mis platos: $195',
      `  Descuento: ${MENOS}$11.61`,
      '  Propina (15 % de la mesa): $27.51',
      'Total del ticket: $840',
      'Dividido con PayMe · paymemx.com',
    ]);
    await capturar(page, 'compartir-03-boton-por-consumo', tuParte(page));
  });

  /**
   * O3 de la auditoría del PR #111 · la mesa de ejemplo de la guía no ofrece «Compartir» (D367: la guía no comparte
   * ni copia). Hoy la protegen dos guardas: `ejemplo ? null` en `MesaDetailView` y que el ejemplo no publica
   * `my_share` (sin desglose no hay botón). Si un día el ejemplo publicara su parte, este conteo sigue exigiendo 0.
   */
  test('🔴 la mesa de ejemplo de la guía no ofrece «Compartir»', async ({ page }) => {
    await guia.entrar(page);
    await guia.abrirDesdeLaTarjeta(page);
    await guia.hastaLaCamara(page);
    await guia.hastaElTicket(page);
    await guia.hastaDividir(page);
    await guia.hastaCompartir(page);
    await guia.hastaTuMesa(page);
    // Control positivo: es la mesa de ejemplo, con sus platos a la vista.
    await expect(page.locator('.mesa-selection-context-main')).toHaveText(RESTAURANTE_DE_EJEMPLO.name);
    await expect(page.locator('.qc-lista')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Compartir', exact: true })).toHaveCount(0);
  });
});
