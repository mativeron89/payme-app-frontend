import { expect, test } from '@playwright/test';
import { abrirMesaConLink, ingresar } from './_app';

/**
 * 🔴 **El corte se declara donde se prueba** (Q6, resuelta por medición).
 *
 * El default del mock es `sandbox` —describe el flujo completo que la app sabe
 * hacer, no el corte—, así que un recorrido que ejercita el corte fija su modo
 * antes del render. Es también lo que hace significativa cualquier ausencia que
 * se afirme después: se afirma sobre un estado declarado, no sobre uno que
 * todavía viaja.
 */
async function conRielApagado(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled');
  });
}

/**
 * C3 · **la mesa SIN garantía, de punta a punta.**
 *
 * Con el dinero apagado el dueño admite `guarantee_method:'none'`: la mesa nace
 * `open`, sin hold, sin 3DS y sin Stripe, y vive cinco horas. Este recorrido
 * ejercita lo que la persona ve — que el paso de garantía **no aparece** y que
 * igual llega a compartir la mesa —, no la forma del request.
 *
 * 🔴 **No duerme: declara su modo.** Con Q6 resuelta el default del mock es
 * `sandbox`, donde la mesa sin garantía **no existe** —el dueño la rechaza con
 * `409 guarantee_required`—, así que este recorrido fija `disabled` antes del
 * render. Es la misma regla que el resto: el corte se declara donde se prueba,
 * y así no depende de un default que puede cambiar.
 */
test.describe('C3 · mesa sin garantía', () => {
  test('el organizador abre mesa sin pasar por la garantía', async ({ page }) => {
    await conRielApagado(page);
    await ingresar(page);
    const mesa = await abrirMesaConLink(page, { sinGarantia: true });
    expect(mesa.code).toMatch(/^PA-/);

    // El testigo de que NO hubo garantía: la pantalla llegó a compartir sin que
    // apareciera ninguna de las dos superficies del hold.
    await expect(page.getByRole('heading', { name: 'Compartir la mesa' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Garantiza la mesa' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Tu banco pide confirmar' })).toHaveCount(0);
  });

  test('el comensal elige lo suyo y el recorrido termina en Mis ítems', async ({ page }) => {
    await conRielApagado(page);
    await ingresar(page);
    const mesa = await abrirMesaConLink(page, { sinGarantia: true });
    await page.goto(`/#/mesa/${mesa.code}`);

    // 🔴 EL TESTIGO POSITIVO de esta capability: el aviso sólo existe cuando el
    // riel es AUTORITATIVO y declara los pagos apagados. Con el config todavía
    // sin llegar no aparece, así que esperar por él acredita que el estado ya
    // se aplicó — y recién entonces afirmar una ausencia significa algo.
    await expect(page.getByText('Los pagos llegan pronto; tu selección queda registrada.')).toBeVisible();

    // Con el config aplicado: ninguna superficie de cobro.
    await expect(page.getByRole('heading', { name: 'Pagar mi parte' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Continuar', exact: true })).toHaveCount(0);
  });
});

/**
 * 🔴 **C3 · la pantalla de CIERRE, y este bloque existe porque tres mutantes
 * sobrevivieron a la suite entera.**
 *
 * `cerroSinCobros` estaba cubierta como función, pero sus tres USOS en la
 * pantalla no: invertir `!sinCobros` en la fila «Cubrió tu garantía», en el
 * párrafo «Tu garantía cubrió $X» o en el título dejaba **205 recorridos y 2206
 * unitarios en verde**. Y esas tres inversiones son exactamente la mentira sobre
 * dinero que C3 vino a impedir: afirmarle a alguien que su garantía cubrió un
 * faltante cuando esa mesa nunca tuvo garantía, y por el monto máximo posible.
 *
 * La causa del hueco era que **ningún recorrido llegaba a la pantalla de
 * cierre**: el cierre del mock es perezoso sobre `expires_at`, y nadie vencía
 * una mesa. Se vence acá adelantando el reloj de la mesa en el estado del mock
 * —no esperando cinco horas— y se afirma en las DOS direcciones, porque una
 * ausencia sola no distingue «no está» de «no llegué a la pantalla».
 */
async function vencerLaMesa(page: import('@playwright/test').Page, code: string): Promise<void> {
  await page.evaluate((c) => {
    const st = JSON.parse(localStorage.getItem('payme_mock_state_v1')!);
    const mesa = st.mesas.find((m: { code: string }) => m.code === c);
    if (!mesa) throw new Error(`mesa ${c} ausente en el estado del mock`);
    mesa.expires_at = new Date(Date.now() - 60_000).toISOString();
    localStorage.setItem('payme_mock_state_v1', JSON.stringify(st));
  }, code);
  /**
   * 🔴 **La recarga NO es decorativa y me costó una vuelta.** El mock mantiene
   * su estado en memoria y lo vuelca a `localStorage` en cada guardado, así que
   * escribir la clave sin recargar deja la mutación viva unos milisegundos y el
   * primer save la pisa: medido, `expires_at` volvía al futuro y la mesa seguía
   * `open`. Recargar obliga al store a rehidratarse desde la clave, y ahí sí el
   * cierre perezoso corre al leer.
   */
  await page.reload();
}

test.describe('C3 · la mesa cerrada no afirma una garantía que no existió', () => {
  test('sin garantía: el cierre lo dice, y NINGUNA superficie de garantía aparece', async ({ page }) => {
    await conRielApagado(page);
    await ingresar(page);
    const mesa = await abrirMesaConLink(page, { sinGarantia: true });

    await page.goto(`/#/mesa/${mesa.code}`);
    await vencerLaMesa(page, mesa.code);

    // EL TESTIGO POSITIVO: se llegó a la pantalla de cierre, y dice lo suyo.
    await expect(page.getByText('Esta mesa cerró sin cobros')).toBeVisible();

    // …y recién con la pantalla en mano, las dos ausencias significan algo.
    await expect(page.getByText('Cubrió tu garantía')).toHaveCount(0);
    await expect(page.getByText('Cubrió la garantía')).toHaveCount(0);
    await expect(page.getByText(/Tu garantía cubrió/)).toHaveCount(0);
    await expect(page.getByText('Se cerró por tiempo')).toHaveCount(0);
  });

  test('CON garantía: la misma pantalla SÍ la afirma — el contraste que da sentido a la ausencia', async ({ page }) => {
    await ingresar(page);
    const mesa = await abrirMesaConLink(page);

    await page.goto(`/#/mesa/${mesa.code}`);
    await vencerLaMesa(page, mesa.code);

    // La mesa garantizada vence por el camino monetario de siempre: la garantía
    // capturó el faltante y la pantalla lo dice, con el mismo código que arriba
    // calla. Sin este caso, invertir el gate en una sola dirección pasaría.
    await expect(page.getByText('Se cerró por tiempo')).toBeVisible();
    await expect(page.getByText('Cubrió tu garantía')).toBeVisible();
    await expect(page.getByText(/Tu garantía cubrió/)).toBeVisible();
    await expect(page.getByText('Esta mesa cerró sin cobros')).toHaveCount(0);
  });
});
