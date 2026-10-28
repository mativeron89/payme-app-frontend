import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';
import { sacarFoto } from './_camara';
import { configurarTicketSinQr, estadoN179 } from './fixtures/ticket-sin-qr';

/**
 * D504 · D507 · D511 · la dirección del local (App Backend 2.201.0). La lectura de una mesa negocia
 * `local_address_version=1` y el front reenvía `merchant.address`, tal cual, como `address` a
 * `POST /api/restaurants/resolve`, que la guarda en el restaurante privado y no la devuelve.
 *
 * 🔴 Aviso 3.1.0 §6 · es identificación interna: no se ve en ninguna pantalla, ni como texto ni como atributo. El mock
 * del dueño no la publica nunca; acá la publica el seam `payme.app.mock.ocr.direccion.v1` con una dirección ficticia,
 * para buscarla en pantalla en cada paso.
 */

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

const DIRECCION = {
  street: 'Calle de Ejemplo', number: '123-B', neighborhood: 'Colonia Prueba', postal_code: '01234',
  city: 'Ciudad Ficticia', state: 'Estado de Muestra',
};

/** Ninguno de los seis datos en el texto visible ni en el HTML (atributos, `aria-label`, `title`). */
async function sinDireccion(page: Page, paso: string): Promise<void> {
  const texto = await page.locator('body').innerText();
  const html = await page.content();
  for (const dato of Object.values(DIRECCION)) {
    expect(texto, `${paso}: «${dato}» a la vista`).not.toContain(dato);
    expect(html, `${paso}: «${dato}» en el HTML`).not.toContain(dato);
  }
}

/** Los pedidos que llegan al resolver, copiados antes de que salgan. */
async function espiarResolver(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const ruta = '/src/api/index.ts';
    const { api } = await import(/* @vite-ignore */ ruta) as { api: Record<string, (...a: unknown[]) => Promise<unknown>> };
    const pedidos: unknown[] = [];
    (window as unknown as { __resolver: unknown[] }).__resolver = pedidos;
    const resolver = api.resolveRestaurant.bind(api);
    api.resolveRestaurant = async (...args: unknown[]) => {
      pedidos.push(JSON.parse(JSON.stringify(args[0])));
      return resolver(...args);
    };
  });
}

const pedidosAlResolver = (page: Page) => page.evaluate(() => (window as unknown as { __resolver: unknown[] }).__resolver);
const direccionesGuardadas = (page: Page) => page.evaluate(() => (
  JSON.parse(localStorage.getItem('payme_mock_state_v1') ?? '{}').restaurantLocalAddresses ?? {}
) as Record<string, unknown>);

async function escanear(page: Page, modo: 'con_direccion' | 'solo_direccion'): Promise<void> {
  await page.addInitScript((m) => localStorage.setItem('payme.app.mock.ocr.direccion.v1', m), modo);
  await configurarTicketSinQr(page);
  await ingresar(page);
  await page.getByRole('button', { name: 'Escanear', exact: true }).click();
  await espiarResolver(page);
  await sacarFoto(page);
  await expect(page.getByRole('heading', { name: '¿Cómo dividen?', exact: true })).toBeVisible();
}

test('🔴 con la dirección: se reenvía tal cual al resolver, se guarda en el privado y no se ve en ningún paso', async ({ page }) => {
  await escanear(page, 'con_direccion');
  await expect.poll(() => pedidosAlResolver(page)).toHaveLength(1);
  expect((await pedidosAlResolver(page))[0]).toMatchObject({ name: 'Tacos El Güero', rfc: 'TEG010101AB1', address: DIRECCION });
  await sinDireccion(page, '¿Cómo dividen?');

  // El ticket leído, abierto.
  await page.getByRole('button', { name: /Ver el ticket/ }).click();
  const hoja = page.getByRole('dialog', { name: /Ticket ·/ });
  await expect(hoja).toBeVisible();
  await sinDireccion(page, 'el ticket');
  await hoja.getByRole('button', { name: /Cerrar/ }).first().click();

  // Hasta abrir la mesa.
  await page.getByRole('radio', { name: /Por lo que pidió cada uno/ }).click();
  const sumar = page.getByRole('button', { name: 'Un comensal más' });
  await sumar.click();
  await sumar.click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Compartir la mesa', exact: true })).toBeVisible();
  await sinDireccion(page, 'Compartir la mesa');

  const { privateRestaurantIds, mesas } = await estadoN179(page);
  expect(mesas).toHaveLength(1);
  expect(await direccionesGuardadas(page)).toEqual({ [privateRestaurantIds[0]!]: DIRECCION });
});

test('un ticket con sólo la dirección: va al resolver con la clave de respaldo, y tampoco se ve', async ({ page }) => {
  await escanear(page, 'solo_direccion');
  await expect.poll(() => pedidosAlResolver(page)).toHaveLength(1);
  const [pedido] = await pedidosAlResolver(page) as Array<Record<string, unknown>>;
  expect(Object.keys(pedido!).sort()).toEqual(['address', 'fallback_key']);
  expect(pedido!.address).toEqual(DIRECCION);
  await sinDireccion(page, '¿Cómo dividen?');
});
