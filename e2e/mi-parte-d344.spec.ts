import { expect, test, type Page } from '@playwright/test';
import {
  corregirLaMesa,
  hastaCompartir,
  pedidosDePropina,
  selectorDePropina,
  verComoParticipante,
} from './fixtures/mi-parte-d344';
import { abrirConfiguracionDeLaMesa, abrirTusConsumos } from './_mesa';

/**
 * D344 · AF-D344-MI-PARTE-FRONT-20261017 · el organizador fija la propina de la
 * mesa (P1) y «Mi parte» suma platos, ajustes y propina (P2–P4), en la mesa sin
 * garantía. Las cuentas, a mano (contrato `mesa-mi-parte-v1.json`, `calculo`):
 *
 *   servicio_descuento, partes iguales entre 4, 10 %:
 *     P = $840, D = $50, S = $85 → N = 840 + 85 − 50 = $875
 *     B = 840 − 50 = $790 → T = 10 % de 790 = $79
 *     la parte 0 (el organizador): platos 840/4 = $210, neto 875/4 = $218.75
 *     (ajustes +$8.75), propina 79/4 = $19.75 → $238.50
 *
 *   descuento, por consumo, 15 %, el organizador elige el Tagliatelle ($195):
 *     P = $840, D = $50 → N = $790; B = $790 → T = 15 % de 790 = $118.50
 *     vista previa: 195 × (840 − 50 + 118.50) / 840 = 210.9017… → $210.90
 *     servidor, mayor resto con pesos [195, otro 0, nadie 645]:
 *       neto 790 × 195/840 = 183.392… → $183.39 (el centavo suelto va a «nadie»)
 *       propina 118.50 × 195/840 = 27.508… → $27.50 + el centavo → $27.51
 *       → ajustes 183.39 − 195 = −$11.61, total 183.39 + 27.51 = $210.90
 *
 *   la misma mesa corregida (R4): sin ajustes, B = P = $840, T = $126
 *     neto 840 × 195/840 = $195, propina 126 × 195/840 = $29.25 → $224.25
 *
 * Capturas a 390×844 (proyecto `movil`) sólo con `PAYME_E2E_CAPTURAS`.
 */

/**
 * Sólo con `PAYME_E2E_CAPTURAS`. `PAYME_E2E_CAPTURAS_SOLO` (nombres separados por
 * coma) toma sólo esas: rehacer una captura no gasta las demás de la reserva.
 * Con `mostrar`, la pantalla se desplaza hasta ese elemento antes de capturar.
 */
async function capturar(page: Page, nombre: string, mostrar?: ReturnType<Page['locator']>): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (!dir) return;
  const solo = process.env.PAYME_E2E_CAPTURAS_SOLO?.split(',').map((n) => n.trim()).filter(Boolean);
  if (solo && !solo.includes(nombre)) return;
  if (mostrar) await mostrar.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: `${dir}/${nombre}.png`, animations: 'disabled' });
}

const MENOS = '−';
const desglose = (page: Page) => page.getByRole('region', { name: 'Cómo se arma tu parte' });

async function filasDelDesglose(page: Page): Promise<string[]> {
  return desglose(page).locator('.mi-parte-desglose-fila').evaluateAll((filas) =>
    filas.map((f) => (f as HTMLElement).innerText.replace(/\s+/g, ' ').trim()));
}

test.describe('D344 · la propina de la mesa y «Mi parte»', () => {
  test('🔴 el organizador la fija en «Compartir la mesa», con el aviso de servicio y sin el monto para la mesa (D360-3); partes iguales', async ({ page }) => {
    await hastaCompartir(page, { ocr: 'servicio_descuento', modo: 'igual' });
    const selector = selectorDePropina(page);
    await expect(selector).toBeVisible();
    // Sin nada preseleccionado (§1.5 bis): seis opciones, ninguna marcada.
    const opciones = selector.getByRole('radio');
    await expect(opciones).toHaveCount(6);
    for (let i = 0; i < 6; i += 1) await expect(opciones.nth(i)).toHaveAttribute('aria-checked', 'false');
    await expect(selector).toContainText('El ticket ya trae un cargo por servicio de $85.');

    await selector.getByRole('radio', { name: '10%', exact: true }).click();
    await expect(selector.getByRole('radio', { name: '10%', exact: true })).toHaveAttribute('aria-checked', 'true');
    // D360-3 · ya no se dice cuánto da para toda la mesa. Primero el testigo de que
    // se guardó (el pedido salió y «Guardando…» se fue), después la ausencia.
    await expect.poll(() => pedidosDePropina(page)).toBe(1);
    await expect(selector.getByRole('status')).toHaveCount(0);
    await expect(selector).not.toContainText('para toda la mesa');
    await expect(selector).not.toContainText('$79');
    // El aviso del cargo por servicio sí queda (respuesta 11 de V).
    await expect(selector).toContainText('El ticket ya trae un cargo por servicio de $85.');
    await capturar(page, 'd344-01-selector-compartir-servicio');

    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Tu mesa' })).toBeVisible();
    // D360-4b · en la página, lo que quedó fijado; el selector, en el engranaje.
    await expect(page.getByText('Propina de la mesa: 10 %', { exact: true })).toBeVisible();
    await expect(selectorDePropina(page)).toHaveCount(0);
    await abrirConfiguracionDeLaMesa(page);
    // En «Tu mesa» el mismo selector, con lo que quedó guardado.
    await expect(selectorDePropina(page).getByRole('radio', { name: '10%', exact: true })).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Configuración de la mesa' })).toHaveCount(0);
    expect(await filasDelDesglose(page)).toEqual([
      'Tus platos $210',
      'Descuento y cargos del ticket $8.75',
      'Propina (10 % de la mesa) $19.75',
      'Tu parte $238.50',
    ]);
    // D360 · P47 · la propina en negrita, rótulo y monto. Control positivo: «Tus platos», en el mismo desglose, no lo
    // está (la medición distingue).
    const pesos = (rotulo: string) => desglose(page).locator('.mi-parte-desglose-fila').filter({ hasText: rotulo })
      .evaluate((fila) => [...fila.children].map((c) => Number(getComputedStyle(c).fontWeight)));
    expect(await pesos('Propina (10 % de la mesa)')).toEqual([700, 700]);
    const platos = await pesos('Tus platos');
    expect(platos).toHaveLength(2);
    for (const peso of platos) expect(peso).toBeLessThan(700);
    await expect(page.locator('.mi-parte-amt')).toHaveText('$238.50');
    await capturar(page, 'd344-02-mi-parte-partes-iguales', desglose(page));
  });

  test('🔴 por consumo: «Mi parte» antes de «Listo» y la parte del servidor después', async ({ page }) => {
    const code = await hastaCompartir(page, { ocr: 'descuento', modo: 'consumo' });
    await selectorDePropina(page).getByRole('radio', { name: '15%', exact: true }).click();
    await expect(selectorDePropina(page).getByRole('radio', { name: '15%', exact: true })).toHaveAttribute('aria-checked', 'true');
    await expect.poll(() => pedidosDePropina(page)).toBe(1);
    await expect(selectorDePropina(page).getByRole('status')).toHaveCount(0);
    await expect(selectorDePropina(page)).not.toContainText('para toda la mesa');
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Tu mesa' })).toBeVisible();
    // Sin nada elegido, no hay desglose: la fila de abajo guía.
    await expect(desglose(page)).toHaveCount(0);

    await abrirTusConsumos(page);
    await page.getByRole('button', { name: /Tagliatelle Bolognese/ }).click();
    await expect(page.locator('.mi-parte-amt')).toHaveText('$210.90');
    await capturar(page, 'd344-03-mi-parte-consumo-vista-previa');

    await page.getByRole('button', { name: 'Listo', exact: true }).click();
    await page.goto(`/#/mesa/${code}`);
    await expect(page.getByRole('heading', { name: 'Tu mesa' })).toBeVisible();
    expect(await filasDelDesglose(page)).toEqual([
      'Tus platos $195',
      `Descuento ${MENOS}$11.61`,
      'Propina (15 % de la mesa) $27.51',
      'Tu parte $210.90',
    ]);
    await capturar(page, 'd344-04-mi-parte-consumo', desglose(page));

    // R4 · la mesa corregida: el aviso literal, sin ajustes y la propina sobre los platos.
    await corregirLaMesa(page, code);
    await expect(page.getByRole('heading', { name: 'Tu mesa' })).toBeVisible();
    await expect(page.locator('.aviso-ajustes-omitidos')).toHaveText(
      'Como la mesa se corrigió, los ajustes del ticket no se aplicaron y la propina va sobre los platos.',
    );
    expect(await filasDelDesglose(page)).toEqual([
      'Tus platos $195',
      'Propina (15 % de la mesa) $29.25',
      'Tu parte $224.25',
    ]);
    await capturar(page, 'd344-05-aviso-mesa-corregida');
    await capturar(page, 'd344-05b-mesa-corregida-desglose', desglose(page));
  });

  test('🔴 quien no organiza ve la propina de la mesa y su parte, sin poder cambiarla (R5)', async ({ page }) => {
    const code = await hastaCompartir(page, { ocr: 'descuento', modo: 'consumo' });
    await selectorDePropina(page).getByRole('radio', { name: '15%', exact: true }).click();
    await expect(selectorDePropina(page).getByRole('radio', { name: '15%', exact: true })).toHaveAttribute('aria-checked', 'true');
    await expect.poll(() => pedidosDePropina(page)).toBe(1);
    await expect(selectorDePropina(page).getByRole('status')).toHaveCount(0);
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await abrirTusConsumos(page);
    await page.getByRole('button', { name: /Tagliatelle Bolognese/ }).click();
    await page.getByRole('button', { name: 'Listo', exact: true }).click();

    await verComoParticipante(page, code);
    await expect(page.getByRole('heading', { name: '¿Qué consumiste?' })).toBeVisible();
    await expect(selectorDePropina(page)).toHaveCount(0);
    // D360-4b · sin engranaje: quien no organiza no configura la mesa.
    await expect(page.getByRole('button', { name: 'Configuración de la mesa', exact: true })).toHaveCount(0);
    await expect(page.getByText('Propina de la mesa: 15 %', { exact: true })).toBeVisible();
    // Con el organizador primero, el reparto da lo mismo: el centavo suelto sigue en «nadie».
    expect(await filasDelDesglose(page)).toEqual([
      'Tus platos $195',
      `Descuento ${MENOS}$11.61`,
      'Propina (15 % de la mesa) $27.51',
      'Tu parte $210.90',
    ]);
    await capturar(page, 'd344-06-no-organizador');
  });

  test('mientras se guarda no se eligen platos; con fallas transitorias, tres intentos y se destraba', async ({ page }) => {
    await hastaCompartir(page, { ocr: 'descuento', modo: 'consumo' });
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Tu mesa' })).toBeVisible();
    await abrirTusConsumos(page);
    await page.evaluate(() => { localStorage.setItem('payme.app.mock.propina_mesa.v1', 'error'); });

    await abrirConfiguracionDeLaMesa(page);
    await selectorDePropina(page).getByRole('radio', { name: '5%', exact: true }).click();
    await expect(selectorDePropina(page).getByRole('status')).toHaveText('Guardando la propina…');
    // D360-4b · con la hoja cerrada, la página dice que se está guardando y los
    // platos esperan (la hoja abierta deja la pantalla de atrás inerte).
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Configuración de la mesa' })).toHaveCount(0);
    await expect(page.locator('.propina-mesa-estado--pagina[role="status"]')).toHaveText('Guardando la propina…');
    await expect(page.getByRole('button', { name: /Tagliatelle Bolognese/ })).toBeDisabled();

    // 1 s y 2 s de espera entre los tres intentos. Con la hoja cerrada, la
    // página avisa y ofrece abrirla.
    const aviso = page.locator('.propina-mesa-estado--pagina[role="alert"]');
    await expect(aviso).toContainText('No pudimos guardar la propina.', { timeout: 15_000 });
    expect(await pedidosDePropina(page)).toBe(3);
    await expect(page.locator('.propina-mesa-estado--pagina[role="status"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Tagliatelle Bolognese/ })).toBeEnabled();
    await aviso.getByRole('button', { name: 'Revisar', exact: true }).click();
    await expect(selectorDePropina(page).getByRole('alert')).toContainText(
      'No pudimos guardar la propina. Puedes elegir tus platos y volver a intentarlo desde la propina de la mesa.',
    );
    // Con la hoja abierta, el aviso de la página no se repite.
    await expect(aviso).toHaveCount(0);
  });
});
