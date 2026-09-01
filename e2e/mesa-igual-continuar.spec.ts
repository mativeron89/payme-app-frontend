import { expect, test } from '@playwright/test';
import { ingresar } from './_app';

/**
 * 🔴 CORTE DEL VIERNES (APP-FE-FRIDAY-NO-PAY-GUARD-02, 2026-09-01) · el
 * checkout del participante está cerrado en producción pública sin pagos. En
 * esta pantalla eso significa: el círculo ya no es «Continuar» hacia el pago,
 * es «Listo» y cierra el flujo hacia Inicio; la pantalla de pago no se alcanza
 * desde ningún control; y elegir NO reserva nada —el corte va ANTES del lock—.
 * Los dos recorridos que pagaban se reescribieron para acreditar eso; el
 * feedback de «Continuar sin elegir» (toast + scroll + pulso) queda dormido con
 * el control, en la rama sin corte de `MesaDetailView`.
 *
 * H-14 (auditoría 2026-08-06): EN PARTES IGUALES, MARCAR ES INFORMATIVO — Y EL
 * GATE LO DECÍA OBLIGATORIO.
 *
 * Marcar en la mesa igual es una declaración separada y no cambia el slot;
 * el gate viejo exigía seleccionar igual y contradecía esa semántica. El seed
 * agravaba: PA-3121 tenía `items: []` —un estado
 * IMPOSIBLE en producción, `POST /mesas` exige `.min(1)`— y el Continuar
 * quedaba apagado PARA SIEMPRE: la persona no podía pagar su parte de $155.
 *
 * Las dos mitades se afirman a propósito, porque el fix tenía alcance exacto:
 * en `igual` el gate NO exige selección; en `consumo` la selección SÍ
 * determina el monto y el gate NO se toca. Si la segunda mitad cae, el fix se
 * pasó de alcance.
 */

test.describe('Continuar en la mesa (H-14)', () => {
  test('partes iguales: la fila dice Mi parte, y el círculo cierra el flujo SIN pago (corte)', async ({ page }) => {
    await ingresar(page);
    await page.goto('/#/mesa/PA-3121');
    await expect(page.locator('.mesa-selection-title')).toContainText('partes iguales');

    // La mesa igual del seed ahora tiene ítems reales (el contrato los exige).
    await expect(page.getByText('Omakase para dos')).toBeVisible();

    // Sin tocar ningún ítem: la fila ya dice "Mi parte" con el casillero.
    await expect(page.getByText('Mi parte')).toBeVisible();
    await expect(page.getByText('$155.00').first()).toBeVisible();

    // 🔴 CORTE · no hay «Continuar»; el círculo es «Listo», habilitado, y
    // cierra hacia Inicio. La pantalla de pago no aparece nunca.
    await expect(page.getByRole('button', { name: 'Continuar', exact: true })).toHaveCount(0);
    const listo = page.getByRole('button', { name: 'Listo', exact: true });
    await expect(listo).toBeEnabled();
    await listo.click();
    await expect(page).toHaveURL(/#\/home$/);
    await expect(page.getByRole('heading', { name: 'Pagar mi parte' })).toHaveCount(0);
  });

  test('partes iguales: permite declarar una fracción sin alterar el casillero', async ({ page }) => {
    await ingresar(page);
    await page.goto('/#/mesa/PA-3121');

    await page.getByRole('button', { name: 'Omakase para dos', exact: true }).click();
    const fracciones = page.getByRole('radiogroup', { name: '¿Cuánto tomas tú?' });
    await expect(fracciones.getByRole('radio')).toHaveCount(6);
    await expect(fracciones.getByRole('radio', { name: '⅔', exact: true })).toBeVisible();
    await fracciones.getByRole('radio', { name: '½', exact: true }).click();

    // No hay preview monetario por plato en igualdad: la fracción es una
    // declaración separada y el monto sigue siendo el slot fijo.
    await expect(page.locator('.mi-frac-amt')).toHaveCount(0);
    const filaMiParte = page.getByText('Mi parte', { exact: true }).locator('..');
    await expect(filaMiParte).toContainText('$155.00');
  });

  /**
   * 🔴 CORTE · lo que H-14 cuida en `consumo` —la selección determina el
   * monto— sigue vivo y se afirma igual (`.mi-frac-amt`, fila «Mi parte»). Lo
   * que cambia es el final: no hay «Continuar», no hay pantalla de pago, y
   * elegir NO reserva el ítem —el corte va ANTES de `api.lockItems`, así que
   * los `claims` del mock quedan como estaban—. Sin esa última afirmación, un
   * corte puesto DESPUÉS del lock pasaría igual y dejaría ítems reservados diez
   * minutos para nadie.
   *
   * El feedback «toast + scroll + pulso» del Continuar sin elegir (§5 bis · E,
   * P62) queda dormido con el control; vuelve con él.
   */
  test('consumo: elegir sigue vivo, NINGÚN control lleva al pago y NADA se reserva (corte)', async ({ page }) => {
    await ingresar(page);
    await page.goto('/#/mesa/PA-2847');
    await expect(page.locator('.mesa-selection-title')).toContainText('cada uno lo suyo');

    await expect(page.getByText('Tagliatelle Bolognese')).toBeVisible();
    await expect(page.getByText('Elige lo que consumiste').first()).toBeVisible();

    // No hay «Continuar»: la única salida del círculo es «Listo».
    await expect(page.getByRole('button', { name: 'Continuar', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Listo', exact: true })).toBeEnabled();

    const claimsDe = () => page.evaluate(() => {
      const st = JSON.parse(localStorage.getItem('payme_mock_state_v1')!);
      const mesa = st.mesas.find((m: { code: string }) => m.code === 'PA-2847');
      const item = mesa.items.find((i: { name: string }) => i.name === 'Tagliatelle Bolognese');
      return (item.claims ?? []).length as number;
    });
    const antes = await claimsDe();

    // La selección y su aritmética siguen: es lo que la pantalla ofrece.
    await page.getByText('Tagliatelle Bolognese').click();
    const fracciones = page.getByRole('radiogroup', { name: '¿Cuánto tomas tú?' });
    await expect(fracciones.getByRole('radio')).toHaveCount(6);
    await fracciones.getByRole('radio', { name: '⅔', exact: true }).click();
    await expect(page.locator('.mi-frac-amt')).toContainText('$130.01');
    const filaMiParte = page.getByText('Mi parte', { exact: true }).locator('..');
    await expect(filaMiParte).toContainText('$130.01');

    // Con la selección hecha sigue sin haber pago, y el círculo cierra.
    await expect(page.getByRole('heading', { name: 'Pagar mi parte' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Listo', exact: true }).click();
    await expect(page).toHaveURL(/#\/home$/);

    // ⭐ Y nada se reservó: el corte fue ANTES del lock.
    expect(await claimsDe(), 'elegir reservó el ítem: hubo lock sin pago detrás').toBe(antes);
  });
});

for (const width of [320, 390]) {
  test(`Mis ítems conserva scroll propio y deja el final sobre la barra · ${width}×844`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await ingresar(page);
    await page.goto('/#/mesa/PA-2847');

    // Dos filas expandidas reproducen el caso que desbordaba la pantalla: cada
    // selector agrega seis fracciones y su preview, sin cambiar el shell.
    await page.getByRole('button', { name: 'Tagliatelle Bolognese', exact: true }).click();
    await page.getByRole('button', { name: 'Risotto ai Funghi', exact: true }).click();
    await expect(page.getByRole('radiogroup', { name: '¿Cuánto tomas tú?' })).toHaveCount(2);

    const scroll = page.locator('.screen > .scroll.flow-scroll');
    const shell = page.locator('.app');
    const initial = await scroll.evaluate((node) => ({
      clientHeight: node.clientHeight,
      scrollHeight: node.scrollHeight,
      overflowY: getComputedStyle(node).overflowY,
    }));
    expect(initial.scrollHeight).toBeGreaterThan(initial.clientHeight);
    expect(initial.overflowY).toBe('auto');

    const outer = await shell.evaluate((node) => ({
      clientHeight: node.clientHeight,
      scrollHeight: node.scrollHeight,
      overflow: getComputedStyle(node).overflow,
    }));
    expect(outer.scrollHeight).toBe(outer.clientHeight);
    expect(outer.overflow).toBe('hidden');

    const atEnd = await scroll.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
      return {
        max: node.scrollHeight - node.clientHeight,
        scrollTop: node.scrollTop,
      };
    });
    expect(atEnd.scrollTop).toBeGreaterThanOrEqual(atEnd.max - 1);

    const lastItem = await page.getByRole('button', { name: 'Vino tinto (copa)', exact: true }).boundingBox();
    const lastAction = await page.getByRole('button', { name: 'Invitar amigos de PayMe', exact: true }).boundingBox();
    const appbar = await page.locator('.screen > .appbar-block .appbar').boundingBox();
    expect(lastItem).not.toBeNull();
    expect(lastAction).not.toBeNull();
    expect(appbar).not.toBeNull();
    expect(lastItem!.y).toBeGreaterThanOrEqual(0);
    expect(lastAction!.y).toBeGreaterThanOrEqual(0);
    expect(lastAction!.y + lastAction!.height).toBeLessThanOrEqual(appbar!.y + 1);
  });
}
