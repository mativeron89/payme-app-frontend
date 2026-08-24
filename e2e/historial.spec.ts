import { expect, test } from '@playwright/test';
import { abrirMesaConLink, ingresar } from './_app';

/**
 * §1.10 · LA ENTRADA "MESAS" ES EL HISTORIAL DE MESAS CERRADAS.
 *
 * Lo que este spec acredita y ningún test sin navegador puede:
 *
 * 1. **La mesa viva no se repite acá.** Era un defecto EN PANTALLA, no
 *    cosmética: el organizador que pagaba su parte veía su mesa dos veces —en
 *    Inicio como abierta y acá abajo de un encabezado de mes, como si hubiera
 *    terminado—. Recién se pudo arreglar con `mesa_status` (v2.42.0).
 * 2. **El acordeón despliega el estado DESCONOCIDO, no un detalle.** G-33
 *    sigue abierta: el contrato no tiene detalle de mesa cerrada, y el spec
 *    prohíbe un mock que aparente funcionar.
 * 3. **"Abiertas ahora" ya no existe.** Afirmar la ausencia a propósito: lo
 *    rompe alguien "completando" la pantalla de buena fe con la sección que
 *    siempre estuvo ahí.
 */

test.describe('Historial (§1.10)', () => {
  test('lista las cerradas del seed por mes, sin sección "Abiertas ahora"', async ({ page }) => {
    await ingresar(page);
    await page.goto('/#/mesas');

    // El título de la PANTALLA es "Historial"; "Mesas" es la etiqueta de la
    // barra, por espacio. El heading viejo "Mesas" murió con la TopBar.
    await expect(page.getByRole('heading', { name: 'Historial', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Volver', exact: true })).toBeVisible();
    await expect(page.getByText('Atajo de demo:', { exact: true })).toHaveCount(0);

    // El seed trae tres mesas completadas: hace 3, 9 y 16 días. Siempre caen
    // en el mes corriente y/o el anterior, así que hay AL MENOS un encabezado
    // de mes — se afirma el del mes de la mesa más nueva, que es determinista.
    const mesReciente = new Date(Date.now() - 3 * 24 * 60 * 60_000)
      .toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
    await expect(page.getByRole('heading', { name: mesReciente })).toBeVisible();

    // Los tres montos del seed, tabulares, uno por mesa.
    await expect(page.getByText('$224.25')).toBeVisible();
    await expect(page.getByText('$418.00')).toBeVisible();
    await expect(page.getByText('$156.50')).toBeVisible();

    // La ausencia es el spec: la mesa abierta vive en Inicio y esta pantalla
    // no tiene sección de abiertas.
    await expect(page.getByText('Abiertas ahora')).toHaveCount(0);
  });

  test('el acordeón despliega el estado desconocido, nunca un detalle aparente (G-33)', async ({ page }) => {
    await ingresar(page);
    await page.goto('/#/mesas');

    const fila = page.getByRole('button', { name: /\$224\.25/ });
    await expect(fila).toHaveAttribute('aria-expanded', 'false');
    await fila.click();
    await expect(fila).toHaveAttribute('aria-expanded', 'true');

    // Estado desconocido (SISTEMA_DISENO §5): copy honesta, cero ítems.
    await expect(page.getByText('No podemos confirmar que sea seguro de mostrar', { exact: false })).toBeVisible();

    // Cerrarlo lo repliega de verdad.
    await fila.click();
    await expect(fila).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByText('No podemos confirmar que sea seguro de mostrar', { exact: false })).toHaveCount(0);
  });

  /**
   * El defecto que `mesa_status` vino a matar, reproducido entero: pagar la
   * parte propia deja la mesa VIVA (`partially_paid`, quedan tres partes) y
   * genera un pago propio de $241.50 — que con el filtro viejo aparecía como
   * mesa terminada bajo el mes corriente.
   *
   * El ancla es el MONTO, no el código: la fila de §1.10 ya no muestra
   * "Mesa PA-XXXX", y $241.50 ($210.00 + 15 %) no colisiona con ningún monto
   * del seed. Sin el filtro, este número aparece; con él, no.
   */
  test('la mesa viva con mi parte pagada NO aparece en el historial', async ({ page }) => {
    await ingresar(page);
    const mesa = await abrirMesaConLink(page);

    await page.getByRole('button', { name: 'Elegir mis ítems', exact: true }).click();
    await expect(page.getByText('$840.00')).toBeVisible();
    await page.getByRole('button', { name: 'Tagliatelle Bolognese' }).click();
    await page.getByRole('button', { name: 'Continuar' }).click();
    await expect(page.getByRole('heading', { name: 'Pagas solo tu parte' })).toBeVisible();

    const propinas = page.getByRole('radiogroup', { name: /propina/i });
    await propinas.getByRole('radio', { name: '15%', exact: true }).click();
    await page.getByRole('button', { name: 'Pagar', exact: true }).click();
    await expect(page.getByText('¡Listo!')).toBeVisible();
    await expect(page.getByText('La mesa sigue abierta para los demás')).toBeVisible();

    await page.goto('/#/mesas');
    await expect(page.getByRole('heading', { name: 'Historial', exact: true })).toBeVisible();
    // La pantalla no está vacía ni rota: el seed sigue ahí…
    await expect(page.getByText('$224.25')).toBeVisible();
    // …y MI mesa viva no está. Ni el pago ni el código.
    await expect(page.getByText('$241.50')).toHaveCount(0);
    await expect(page.getByText(mesa.code)).toHaveCount(0);
  });
});
