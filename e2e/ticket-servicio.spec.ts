import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';
import { sacarFoto } from './_camara';
import { configurarTicketSinQr } from './fixtures/ticket-sin-qr';

/**
 * AF-SERVICIO-APARTE-VISIBLE-20261008 · n327 · D224 («Aparte, sin repartir») ·
 * D237. El cargo por servicio impreso, en su propia línea, como el descuento
 * (D218) y el IVA (D209/D215), y sin repartir (App Backend 2.168.0,
 * `ticket_adjustments_v2`, con `adjustments_version=2`).
 *
 * El mock del dueño no lo emite; los seams `servicio`, `servicio_descuento`,
 * `servicio_iva` y `servicio_dudoso` de `payme.app.mock.n179.ocr.v1` lo hacen
 * sobre el ticket de siempre ($840 en platos): servicio $85 → impreso $925; con
 * descuento $50 → $875; con IVA agregado $134.40 → $1,059.40; el dudoso no
 * publica el cargo (`total_mismatch`). Lo que se divide sigue siendo $840.
 *
 * A 375×667, el ancho que pidió el Bibliotecario para las capturas.
 */
test.use({ viewport: { width: 375, height: 667 } });

const MENOS = '−';
type Lectura = 'servicio' | 'servicio_descuento' | 'servicio_iva' | 'servicio_dudoso';

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (!dir) return;
  const desglose = page.locator('.tk-desglose, .ticket-digital-total').first();
  if (await desglose.count()) await desglose.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${dir}/servicio-${nombre}-375.png` });
}

async function hastaElTicket(page: Page, ocr: Lectura): Promise<void> {
  await configurarTicketSinQr(page, { ocr });
  await ingresar(page);
  await page.getByRole('button', { name: 'Nueva', exact: true }).click();
  await sacarFoto(page);
  await expect(page.getByRole('radio', { name: /Pagar el total/ })).toBeVisible();
}

const hoja = (page: Page) => page.getByRole('dialog').filter({ has: page.locator('.tk-list') });
const nota = (page: Page) => page.locator('.ticket-title-iva');
const avisoAmbar = (page: Page) => page.locator('.title-card-note.warn');

async function abrirHoja(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Ver el ticket' }).click();
  await expect(hoja(page)).toBeVisible();
}

const filas = (page: Page) => hoja(page).locator('.tk-desglose > div').evaluateAll((divs) =>
  divs.map((d) => (d as HTMLElement).innerText.replace(/\s+/g, ' ').trim()));

/** Los platos de la hoja: el cargo nunca es uno (seis, los de siempre). */
async function platosSinElCargo(page: Page): Promise<void> {
  await expect(hoja(page).locator('.tk-row')).toHaveCount(6);
  await expect(hoja(page).locator('.tk-list')).not.toContainText(/servicio/i);
}

test.describe('D224 · «¿Cómo dividen?» y su hoja con el cargo por servicio aparte', () => {
  test('🔴 servicio: la línea en la hoja, el total impreso, la nota, y no es un plato ni se reparte', async ({ page }) => {
    await hastaElTicket(page, 'servicio');
    await expect(page.locator('.ticket-title-amount')).toHaveText('$840');
    await expect(nota(page)).toHaveText('Lo que paga cada uno todavía no incluye el cargo por servicio ($85)');
    await expect(avisoAmbar(page)).toHaveCount(0);
    await capturar(page, 'nota');
    await abrirHoja(page);
    expect(await filas(page)).toEqual(['Cargo por servicio $85', 'Total del ticket $925']);
    await platosSinElCargo(page);
    await capturar(page, 'hoja');
    await page.getByRole('button', { name: 'Cerrar hoja del ticket' }).click();
    // Abre la mesa como siempre: nada se frena.
    await page.getByRole('radio', { name: /En partes iguales/ }).click();
    await page.getByRole('button', { name: 'Un comensal más' }).click();
    await page.getByRole('button', { name: 'Continuar' }).click();
    await expect(page.getByRole('heading', { name: 'Compartir la mesa' })).toBeVisible();
  });

  test('🔴 descuento y servicio: el servicio antes del descuento y una sola nota con los dos', async ({ page }) => {
    await hastaElTicket(page, 'servicio_descuento');
    await expect(page.locator('.ticket-title-amount')).toHaveText('$840');
    await expect(nota(page)).toHaveCount(1);
    await expect(nota(page)).toHaveText(
      `Lo que paga cada uno todavía no incluye el cargo por servicio ($85) ni el descuento (${MENOS}$50)`,
    );
    await abrirHoja(page);
    expect(await filas(page)).toEqual(['Cargo por servicio $85', `Descuento ${MENOS}$50`, 'Total del ticket $875']);
    await platosSinElCargo(page);
    await capturar(page, 'descuento-hoja');
  });

  test('🔴 IVA agregado y servicio: Subtotal, IVA, Cargo por servicio y Total, en el orden de la cuenta', async ({ page }) => {
    await hastaElTicket(page, 'servicio_iva');
    await expect(page.locator('.ticket-title-amount')).toHaveText('$840');
    await expect(nota(page)).toHaveText('Lo que paga cada uno todavía no incluye el IVA ($134.40) ni el cargo por servicio ($85)');
    await abrirHoja(page);
    expect(await filas(page)).toEqual([
      'Subtotal $840', 'IVA $134.40', 'Cargo por servicio $85', 'Total del ticket $1,059.40',
    ]);
    await capturar(page, 'iva-hoja');
  });

  test('🔴 servicio dudoso: como hoy, el aviso de que el total no cierra y ningún cargo inventado', async ({ page }) => {
    await hastaElTicket(page, 'servicio_dudoso');
    await expect(avisoAmbar(page)).toBeVisible();
    await expect(nota(page)).toHaveCount(0);
    await expect(page.getByText('Cargo por servicio')).toHaveCount(0);
    await capturar(page, 'dudoso');
  });

  test('🔴 la mesa creada con servicio: el dueño guarda los ajustes v2 y el cargo no es un plato de la mesa', async ({ page }) => {
    await hastaElTicket(page, 'servicio');
    await page.getByRole('radio', { name: /En partes iguales/ }).click();
    await page.getByRole('button', { name: 'Un comensal más' }).click();
    await page.getByRole('button', { name: 'Continuar' }).click();
    await expect(page.getByRole('heading', { name: 'Compartir la mesa' })).toBeVisible();
    const code = (await page.locator('body').innerText()).match(/PA-\d{4,}/)?.[0];
    expect(code).toBeTruthy();
    // Lo que publica el detalle con `adjustments_version=2`, por la fachada.
    const detalle = await page.evaluate(async (c) => {
      const ruta = '/src/api/index.ts';
      const { api } = await import(/* @vite-ignore */ ruta) as {
        api: { getMesa: (code: string) => Promise<{ mesa: Record<string, unknown> & { items: Array<{ name: string }>; total_cents: number } }> };
      };
      const { mesa } = await api.getMesa(c!);
      return { ajustes: mesa.ticket_adjustments, totales: mesa.ticket_totals, total: mesa.total_cents, platos: mesa.items.map((i) => i.name) };
    }, code);
    expect(detalle.ajustes).toEqual([{ kind: 'service_charge', amount_cents: 8500 }]);
    expect(detalle.totales).toBeUndefined();
    // El total de la mesa es la suma de los platos: el cargo no se reparte.
    expect(detalle.total).toBe(84000);
    expect(detalle.platos.some((n) => /servicio/i.test(n))).toBe(false);
  });
});

test.describe('D224 · el ticket digital de una mesa con cargo por servicio', () => {
  /**
   * El ticket digital se abre desde «Tus restaurantes», sobre visitas del
   * modelo del mock (no pasan por el alta): se envuelve `getMesa` de la fachada
   * para que conteste lo que publicaría el dueño en `mesa_detail` con una fila
   * v2. Lo que se prueba es el decoder del visor y lo que dibuja.
   */
  async function abrirTicketDigital(
    page: Page, caso: 'servicio' | 'servicio_iva' | 'no_cierra' | 'v1',
  ): Promise<ReturnType<Page['getByRole']>> {
    await ingresar(page);
    await page.goto('/restaurantes');
    await page.evaluate(async (c) => {
      const ruta = '/src/api/index.ts';
      const { api } = await import(/* @vite-ignore */ ruta) as {
        api: { getMesa: (...a: unknown[]) => Promise<{ mesa: { total_cents: number } & Record<string, unknown> }> };
      };
      const original = api.getMesa.bind(api);
      api.getMesa = async (...args: unknown[]) => {
        const r = await original(...args);
        const total = r.mesa.total_cents;
        const servicio = [{ kind: 'service_charge', amount_cents: 5000 }];
        const mesa = c === 'servicio' ? { ...r.mesa, ticket_adjustments: servicio }
          : c === 'servicio_iva' ? { ...r.mesa, ticket_adjustments: servicio, ticket_totals: { subtotal_cents: total, tax_cents: Math.round(total * 0.16) } }
            // Totales que no cierran con nada: no hay un impreso que deducir.
            : c === 'no_cierra' ? { ...r.mesa, ticket_adjustments: servicio, ticket_totals: { subtotal_cents: Math.round(total / 2) } }
              : { ...r.mesa, ticket_adjustments: [{ kind: 'discount', amount_cents: 5000 }] };
        return { mesa };
      };
    }, caso);
    const parolaccia = page.getByRole('region', { name: 'La Parolaccia', exact: true });
    await parolaccia.getByRole('button', { name: /^La Parolaccia/ }).click();
    const visita = parolaccia.locator('.rest-visita').first();
    await visita.locator('.rest-visita-fila').click();
    await visita.getByRole('button', { name: 'Ver ticket completo', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Detalle digital del ticket' });
    await expect(dialog.locator('.ticket-digital-total')).toBeVisible();
    return dialog;
  }

  const montos = (dialog: ReturnType<Page['getByRole']>) => dialog.evaluate((d) => {
    const centavos = (t: string) => Math.round(Number(t.replace(/[^0-9.]/g, '')) * 100);
    const filas = [...d.querySelectorAll('.ticket-digital-desglose > div')].map((x) => ({
      rotulo: x.querySelector('dt')?.textContent ?? '', cents: centavos(x.querySelector('dd')?.textContent ?? ''),
    }));
    return { filas, total: centavos(d.querySelector('.ticket-digital-total strong')?.textContent ?? ''),
      rotuloTotal: d.querySelector('.ticket-digital-total span')?.textContent ?? '' };
  });

  test('🔴 sin totales: «Cargo por servicio», el total impreso (platos + servicio) y la nota', async ({ page }) => {
    const dialog = await abrirTicketDigital(page, 'servicio');
    await expect(dialog.getByText('No pudimos cargar el detalle')).toHaveCount(0);
    const m = await montos(dialog);
    expect(m.filas.map((f) => f.rotulo)).toEqual(['Cargo por servicio']);
    expect(m.rotuloTotal).toBe('Total del ticket');
    expect(m.filas[0]!.cents).toBe(5000);
    await expect(dialog.locator('.ticket-digital-nota')).toHaveText('El cargo por servicio no se reparte.');
    await capturar(page, 'ticket-digital');
  });

  test('🔴 con IVA agregado: Subtotal, IVA, Cargo por servicio y Total = S + IVA + servicio', async ({ page }) => {
    const dialog = await abrirTicketDigital(page, 'servicio_iva');
    const m = await montos(dialog);
    expect(m.filas.map((f) => f.rotulo)).toEqual(['Subtotal', 'IVA', 'Cargo por servicio']);
    expect(m.filas[0]!.cents + m.filas[1]!.cents + m.filas[2]!.cents).toBe(m.total);
    await expect(dialog.locator('.ticket-digital-nota')).toHaveText(/^Lo que paga cada uno todavía no incluye el IVA \(\$.+\) ni el cargo por servicio \(\$50\)$/);
  });

  test('🔴 si no cierra: «Total de los consumos» y las líneas aparte, sin un total inventado', async ({ page }) => {
    const dialog = await abrirTicketDigital(page, 'no_cierra');
    await expect(dialog.locator('.ticket-digital-total span')).toHaveText('Total de los consumos');
    await expect(dialog.getByText('Total del ticket')).toHaveCount(0);
    await expect(dialog.locator('.ticket-digital-desglose')).toHaveText(/Cargo por servicio\s*\$50/);
    await expect(dialog.locator('.ticket-digital-nota')).toHaveText('El cargo por servicio no se reparte.');
  });

  test('control · una mesa v1 (sólo descuento) se ve igual que hoy', async ({ page }) => {
    const dialog = await abrirTicketDigital(page, 'v1');
    await expect(dialog.locator('.ticket-digital-total span')).toHaveText('Total de los consumos');
    await expect(dialog.locator('.ticket-digital-descuento')).toHaveText(new RegExp(`Descuento\\s*${MENOS}\\$50`));
    await expect(dialog.locator('.ticket-digital-nota')).toHaveText('El descuento no se reparte.');
    await expect(dialog.getByText('Cargo por servicio')).toHaveCount(0);
  });
});
