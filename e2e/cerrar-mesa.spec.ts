import { expect, test, type Page } from '@playwright/test';
import { abrirMesaConLink, ingresar } from './_app';

/**
 * AF-34 · n98 · «Cerrar mesa» para el organizador (dueño v2.113.0): mesa SIN
 * garantía, con los pagos apagados, confirmación antes de cerrar y sin reapertura.
 */

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (!dir) return;
  await page.screenshot({ path: `${dir}/${test.info().project.name}-${nombre}.png`, fullPage: true });
}

async function mesaSinGarantia(page: Page, costuras: Record<string, string> = {}): Promise<string> {
  await page.addInitScript((c) => {
    localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled');
    for (const [k, v] of Object.entries(c)) localStorage.setItem(k, v);
  }, costuras);
  await ingresar(page);
  const mesa = await abrirMesaConLink(page, { sinGarantia: true, modo: 'consumo' });
  await page.goto(`/#/mesa/${mesa.code}`);
  await expect(page.getByText('Los pagos llegan pronto; tu selección queda registrada.')).toHaveCount(0);
  return mesa.code;
}

async function pedidosDeCierre(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const path = '/src/api/mock/mockApi.ts';
    const mock = await import(/* @vite-ignore */ path) as { contarPedidosDeCierre(): number };
    return mock.contarPedidosDeCierre();
  });
}

const boton = (page: Page) => page.getByRole('button', { name: 'Cerrar mesa', exact: true });

/**
 * El botón queda al final de la mesa, debajo de la barra inferior hasta que se
 * hace scroll: el scroll es de `.flow-scroll`, y Playwright da por visible un
 * botón tapado por la barra (medido en AF-25). Se baja antes de tocar.
 */
async function tocarCerrar(page: Page): Promise<void> {
  await page.evaluate(() => { document.querySelector('.flow-scroll')?.scrollTo(0, 1e6); });
  await boton(page).click();
}
const hoja = (page: Page) => page.getByRole('dialog', { name: '¿Cerrar la mesa?' });

test.describe('AF-34 · cerrar la mesa', () => {
  test('con confirmación: la hoja dice qué pasa, y al confirmar la mesa queda cerrada por el organizador', async ({ page }) => {
    await mesaSinGarantia(page);
    await page.evaluate(() => { document.querySelector('.flow-scroll')?.scrollTo(0, 1e6); });
    await expect(boton(page)).toBeVisible();
    await capturar(page, 'cerrar-01-mesa-con-boton');

    // 🔴 Tocar el botón NO cierra: abre la confirmación.
    await tocarCerrar(page);
    await expect(hoja(page)).toBeVisible();
    await expect(hoja(page)).toContainText('La mesa se cierra para todos.');
    await expect(hoja(page)).toContainText('Lo que cada quien eligió queda como su consumo.');
    await expect(hoja(page)).toContainText('No se puede reabrir: para seguir, abre una mesa nueva.');
    expect(await pedidosDeCierre(page)).toBe(0);
    await capturar(page, 'cerrar-02-hoja-de-confirmacion');

    // «Volver» no cierra nada.
    await hoja(page).getByRole('button', { name: 'Volver', exact: true }).click();
    await expect(hoja(page)).toHaveCount(0);
    await expect(boton(page)).toBeVisible();
    expect(await pedidosDeCierre(page)).toBe(0);

    await tocarCerrar(page);
    await hoja(page).getByRole('button', { name: 'Sí, cerrar la mesa' }).click();
    await expect(page.getByText('Esta mesa cerró sin cobros')).toBeVisible();
    await expect(page.getByText('La cerraste tú.')).toBeVisible();
    // Sin garantía no hay garantía que haya cubierto nada.
    await expect(page.getByText('Cubrió tu garantía')).toHaveCount(0);
    await expect(page.getByText(/Tu garantía cubrió/)).toHaveCount(0);
    // 🔴 Y PayMe no le entregó nada al restaurante: la mesa se cobra en la terminal.
    await expect(page.getByText('Recibió el restaurante')).toHaveCount(0);
    expect(await pedidosDeCierre(page)).toBe(1);
    await capturar(page, 'cerrar-03-mesa-cerrada-por-el-organizador');
  });

  test('AF-36 · los tres botones llevan color: invitar lleno, copiar con borde, cerrar en gris; todos AA', async ({ page }) => {
    await mesaSinGarantia(page);
    await page.evaluate(() => { document.querySelector('.flow-scroll')?.scrollTo(0, 1e6); });
    await expect(boton(page)).toBeVisible();
    const colores = await page.evaluate(() => {
      const lum = (c: string) => {
        const [r, g, b] = (c.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number).map((v) => {
          const x = v / 255;
          return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const contraste = (a: string, b: string) => {
        const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
        return (x + 0.05) / (y + 0.05);
      };
      const de = (nombre: string) => {
        const b = [...document.querySelectorAll('.mesa-secondary-actions button')]
          .find((e) => e.textContent?.includes(nombre)) as HTMLElement;
        const cs = getComputedStyle(b);
        return { fondo: cs.backgroundColor, texto: cs.color, borde: cs.borderTopColor, contraste: contraste(cs.color, cs.backgroundColor) };
      };
      return { invitar: de('Invitar amigos de PayMe'), copiar: de('Copiar link de invitación'), cerrar: de('Cerrar mesa') };
    });
    // Turquesa lleno con texto blanco (el turquesa oscuro del diseño: el claro no llega a AA con blanco).
    expect(colores.invitar).toMatchObject({ fondo: 'rgb(10, 123, 128)', texto: 'rgb(255, 255, 255)' });
    // Borde y texto turquesa sobre blanco.
    expect(colores.copiar).toMatchObject({ fondo: 'rgb(255, 255, 255)', texto: 'rgb(10, 123, 128)', borde: 'rgb(10, 123, 128)' });
    // Gris: ni turquesa ni lleno, para que no compita.
    expect(colores.cerrar).toMatchObject({ fondo: 'rgb(255, 255, 255)', texto: 'rgb(71, 85, 105)', borde: 'rgb(203, 213, 225)' });
    for (const [nombre, c] of Object.entries(colores)) expect(c.contraste, nombre).toBeGreaterThanOrEqual(4.5);
    await capturar(page, 'botones-01-mesa-con-los-tres');
  });

  test('🔴 un doble toque en «Sí, cerrar» manda UN pedido', async ({ page }) => {
    await mesaSinGarantia(page);
    await tocarCerrar(page);
    await hoja(page).getByRole('button', { name: 'Sí, cerrar la mesa' }).dblclick();
    await expect(page.getByText('Esta mesa cerró sin cobros')).toBeVisible();
    expect(await pedidosDeCierre(page)).toBe(1);
  });

  test('🔴 a quien no organiza no se le ofrece', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled'));
    await ingresar(page);
    await page.goto('/#/mesa/PA-4520');
    await expect(page.getByRole('button', { name: /^Barco de sushi/ })).toBeVisible();
    await expect(boton(page)).toHaveCount(0);
  });

  test('🔴 la MISMA mesa sin garantía y abierta, vista por quien no la organiza: no se ofrece', async ({ page }) => {
    // El caso de arriba no discrimina el rol: PA-4520 tiene garantía, y eso solo
    // ya apaga el botón. Acá lo único que cambia es quién mira.
    const code = await mesaSinGarantia(page);
    await page.evaluate(() => { document.querySelector('.flow-scroll')?.scrollTo(0, 1e6); });
    await expect(boton(page)).toBeVisible();
    await page.evaluate(async (c) => {
      const storePath = '/src/api/mock/store.ts';
      const store = await import(/* @vite-ignore */ storePath) as {
        state: { mesas: Array<{ code: string; openedByUser: boolean }> };
      };
      store.state.mesas.find((x) => x.code === c)!.openedByUser = false;
      location.hash = '#/mesas';
    }, code);
    await page.evaluate((c) => { location.hash = `#/mesa/${c}`; }, code);
    await expect(page.getByText('Los pagos llegan pronto; tu selección queda registrada.')).toHaveCount(0);
    await expect(boton(page)).toHaveCount(0);
    // Testigo de que la vista SÍ cambió de rol (y no quedó la del organizador).
    await expect(page.getByRole('button', { name: 'Copiar link de invitación' })).toHaveCount(0);
  });

  test('en una mesa CON garantía no se ofrece (testigo: el organizador ve el resto)', async ({ page }) => {
    await ingresar(page);
    await page.goto('/#/mesa/PA-2847');
    await expect(page.getByRole('button', { name: 'Copiar link de invitación' })).toBeVisible();
    await expect(boton(page)).toHaveCount(0);
  });

  test('si ya estaba cerrada por otra cosa, lo dice y muestra su motivo', async ({ page }) => {
    const code = await mesaSinGarantia(page);
    await page.evaluate(async (c) => {
      const storePath = '/src/api/mock/store.ts';
      const store = await import(/* @vite-ignore */ storePath) as {
        state: { mesas: Array<{ code: string; status: string; closure_reason?: string | null }> };
      };
      const m = store.state.mesas.find((x) => x.code === c)!;
      m.status = 'expired';
      m.closure_reason = 'time';
    }, code);
    await tocarCerrar(page);
    await hoja(page).getByRole('button', { name: 'Sí, cerrar la mesa' }).click();
    await expect(page.getByText('La mesa ya estaba cerrada.')).toBeVisible();
    await expect(page.getByText('Venció el tiempo de la mesa.')).toBeVisible();
  });

  test('backend anterior (404): lo dice una vez y el botón se retira', async ({ page }) => {
    await mesaSinGarantia(page, { 'payme.app.mock.cerrar.v1': 'antiguo' });
    await tocarCerrar(page);
    await hoja(page).getByRole('button', { name: 'Sí, cerrar la mesa' }).click();
    await expect(page.getByText('Cerrar la mesa todavía no está disponible.')).toBeVisible();
    await expect(boton(page)).toHaveCount(0);
  });

  test('un error del servidor: texto neutro y el botón sigue', async ({ page }) => {
    await mesaSinGarantia(page, { 'payme.app.mock.cerrar.v1': 'error' });
    await tocarCerrar(page);
    await hoja(page).getByRole('button', { name: 'Sí, cerrar la mesa' }).click();
    await expect(page.getByText('No pudimos cerrar la mesa. Intenta de nuevo.')).toBeVisible();
    await expect(boton(page)).toBeVisible();
  });
});
