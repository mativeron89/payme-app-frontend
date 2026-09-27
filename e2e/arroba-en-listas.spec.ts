import { expect, test, type Locator, type Page } from '@playwright/test';
import { ingresar, irEnLaApp } from './_app';

/**
 * AF-USERNAME-D104 · decisión 104 de Mati: «que el usuario esté abajo del
 * nombre, oculta el ID que se le asigna, no hace falta mostrarlo» («Sí, en toda
 * la app»). Wire: App Backend v2.139.0 (`7f080cd5`),
 * `docs/USERNAME_EN_LISTAS_D104_WIRE.md`.
 *
 * Las cuatro pantallas de la orden —Amigos (lista, grupos y solicitudes),
 * invitar amigos a una mesa, detalle de la mesa y Configuración— con los tres
 * dueños posibles:
 *
 * - **AB nuevo** (v2.139.0, default del mock): las listas traen `username`.
 * - **AB viejo** (el servido `96634167`): el @ encendido, las listas SIN la
 *   clave (`payme.app.mock.listas_sin_arroba.v1 = 'true'`). Este AF se publica
 *   antes del deploy del dueño: tiene que funcionar igual con este.
 * - **Apagado** (`payme.app.mock.username.v1 = 'false'`): sin @ en ningún lado.
 *
 * En los tres, «payme_» no aparece en pantalla, ni como texto ni como ejemplo
 * de un campo. Fixture del mock: Sofía, Juan y María tienen @; Leo Paz no
 * (amigo sin @); Valentina manda la solicitud entrante; en PA-2847 se sumaron
 * Luis (con @) y Renata (sin @).
 */

const CLAVE_LISTAS_SIN_ARROBA = 'payme.app.mock.listas_sin_arroba.v1';
const CLAVE_FLAG = 'payme.app.mock.username.v1';

type Dueno = 'nuevo' | 'viejo' | 'apagado';

async function comoDueno(page: Page, dueno: Dueno): Promise<void> {
  if (dueno === 'viejo') {
    await page.addInitScript((clave) => localStorage.setItem(clave, 'true'), CLAVE_LISTAS_SIN_ARROBA);
  }
  if (dueno === 'apagado') {
    await page.addInitScript((clave) => localStorage.setItem(clave, 'false'), CLAVE_FLAG);
  }
}

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (dir) await page.screenshot({ path: `${dir}/${test.info().project.name}-${nombre}.png` });
}

async function entrar(page: Page): Promise<void> {
  await ingresar(page);
  const aviso = page.getByLabel('Actualización del Aviso de Privacidad');
  await aviso.getByRole('button', { name: 'Entendido', exact: true }).click();
  await expect(aviso).toHaveCount(0);
}

/**
 * «payme_» no aparece en pantalla: ni en el texto visible, ni en el texto del
 * documento (aunque esté oculto), ni como ejemplo de un campo.
 */
async function sinCodigo(page: Page): Promise<void> {
  const visible = await page.locator('body').innerText();
  expect(visible).not.toContain('payme_');
  const documento = await page.evaluate(() => document.body.textContent ?? '');
  expect(documento).not.toContain('payme_');
  const ejemplos = await page.locator('[placeholder]').evaluateAll(
    (campos) => campos.map((c) => c.getAttribute('placeholder') ?? ''),
  );
  expect(ejemplos.join('\n')).not.toContain('payme_');
}

const fila = (page: Page, selector: string, nombre: string): Locator =>
  page.locator(selector).filter({ hasText: nombre });

/** Debajo del nombre, el @ exacto; `null` = no va NADA (ni la línea vacía). */
async function debajo(row: Locator, arroba: string | null): Promise<void> {
  await expect(row).toBeVisible();
  if (arroba === null) await expect(row.locator('.fr-name .id')).toHaveCount(0);
  else await expect(row.locator('.fr-name .id')).toHaveText(arroba);
}

async function irAAmigos(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Amigos', exact: true }).click();
  await expect(page.getByText('Sofía Fernández', { exact: true })).toBeVisible();
}

async function abrirInvitar(page: Page): Promise<void> {
  await page.goto('/#/mesa/PA-2847');
  await page.getByRole('button', { name: 'Invitar amigos de PayMe' }).click();
  await expect(fila(page, '.inv-row', 'Sofía Fernández')).toBeVisible();
}

const seccionQuienes = (page: Page) => page.getByRole('region', { name: 'Quiénes se sumaron' });

/** Costura del mock: dos cuentas vivas SIN nombre en PA-2847, una con @ y otra sin. */
async function participantesSinNombre(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('payme.app.mock.participantes.v1', 'sin_nombre'));
}

// ─── AB nuevo (v2.139.0) ─────────────────────────────────────────────────

test.describe('AF-USERNAME-D104 · AB nuevo: debajo del nombre, el @', () => {
  test('Amigos: la lista, el filtro por @ y el campo de agregar', async ({ page }) => {
    await entrar(page);
    await irAAmigos(page);
    await debajo(fila(page, '.friend-row', 'Sofía Fernández'), '@sofi.fernandez');
    await debajo(fila(page, '.friend-row', 'Juan López'), '@juan.lopez');
    await debajo(fila(page, '.friend-row', 'Leo Paz'), null);
    await sinCodigo(page);
    await capturar(page, 'd104-amigos');

    // El filtro busca por lo que se ve: el @, con o sin «@».
    const filtro = page.getByLabel('Buscar entre tus amigos');
    await filtro.fill('@juan.l');
    await expect(fila(page, '.friend-row', 'Juan López')).toBeVisible();
    await expect(fila(page, '.friend-row', 'Sofía Fernández')).toHaveCount(0);
    await filtro.fill('sofi.fer');
    await expect(fila(page, '.friend-row', 'Sofía Fernández')).toBeVisible();
    await expect(fila(page, '.friend-row', 'Juan López')).toHaveCount(0);
    // Por el código, que ya no se ve, no encuentra a nadie.
    await filtro.fill('payme_mx');
    await expect(page.getByText('Sin resultados para esa búsqueda.')).toBeVisible();
    await filtro.fill('');

    await page.getByRole('button', { name: 'Nuevo amigo' }).click();
    await expect(page.getByPlaceholder('Email', { exact: true })).toBeVisible();
    await sinCodigo(page);
  });

  test('Amigos: las solicitudes recibidas', async ({ page }) => {
    await entrar(page);
    await irAAmigos(page);
    await page.getByRole('tab', { name: /Solicitudes/ }).click();
    await debajo(fila(page, '.friend-row', 'Valentina Ríos'), '@valentina.rios');
    await sinCodigo(page);
    await capturar(page, 'd104-solicitudes');
  });

  test('Amigos: el detalle de un grupo y «Agregar del listado de amigos»', async ({ page }) => {
    await entrar(page);
    await irAAmigos(page);
    await page.getByRole('tab', { name: 'Grupos', exact: true }).click();
    await page.getByText('Familia', { exact: false }).first().click();
    await expect(page.getByText('Agregar del listado de amigos')).toBeVisible();
    await debajo(fila(page, '.friend-row', 'Sofía Fernández'), '@sofi.fernandez');
    await debajo(fila(page, '.friend-row', 'Leo Paz'), null);
    await debajo(fila(page, '.friend-row', 'Juan López'), '@juan.lopez');
    await sinCodigo(page);
    await capturar(page, 'd104-grupo');
  });

  test('invitar amigos a una mesa: amigos, búsqueda y grupos', async ({ page }) => {
    await entrar(page);
    await abrirInvitar(page);
    await debajo(fila(page, '.inv-row', 'Sofía Fernández'), '@sofi.fernandez');
    await debajo(fila(page, '.inv-row', 'Leo Paz'), null);
    await sinCodigo(page);
    await capturar(page, 'd104-invitar');

    const buscar = page.getByPlaceholder('Buscar por nombre o @', { exact: true });
    await buscar.fill('juan.l');
    await expect(fila(page, '.inv-row', 'Juan López')).toBeVisible();
    await expect(fila(page, '.inv-row', 'Sofía Fernández')).toHaveCount(0);
    await buscar.fill('');

    await page.getByRole('tab', { name: 'Grupos', exact: true }).click();
    await page.getByRole('button', { name: /Familia/ }).click();
    await debajo(fila(page, '.inv-row', 'Sofía Fernández'), '@sofi.fernandez');
    await debajo(fila(page, '.inv-row', 'Leo Paz'), null);
    await sinCodigo(page);
  });

  test('detalle de la mesa: «Quiénes se sumaron»', async ({ page }) => {
    await entrar(page);
    await page.goto('/#/mesa/PA-2847');
    const lista = seccionQuienes(page);
    await expect(lista.getByText('Luis Cárdenas', { exact: true })).toBeVisible();
    await expect(lista.locator('.quien').filter({ hasText: 'Luis Cárdenas' }).locator('.quien-id'))
      .toHaveText('@luis.cardenas');
    await expect(lista.locator('.quien').filter({ hasText: 'Renata Ortiz' }).locator('.quien-id')).toHaveCount(0);
    await sinCodigo(page);
  });

  test('«Quiénes se sumaron» sin nombre: el @ en su lugar; sin @, «Sin nombre». El código, nunca', async ({ page }) => {
    await participantesSinNombre(page);
    await entrar(page);
    await page.goto('/#/mesa/PA-2847');
    const lista = seccionQuienes(page);
    await expect(lista.getByText('Luis Cárdenas', { exact: true })).toBeVisible();
    await expect(lista.locator('.quien-nombre').filter({ hasText: /^@solo\.arroba$/ })).toHaveCount(1);
    await expect(lista.locator('.quien-nombre').filter({ hasText: /^Sin nombre$/ })).toHaveCount(1);
    await sinCodigo(page);
  });

  test('Configuración: el @ propio debajo del nombre, a 390 px, y sigue al cambio', async ({ page }) => {
    await entrar(page);
    await irEnLaApp(page, '/mas');
    await expect(page.getByRole('heading', { name: 'Configuración' })).toBeVisible();
    await expect(page.locator('.profile-arroba')).toHaveText('@mativeron');
    await sinCodigo(page);
    expect(page.viewportSize()?.width).toBe(390);
    await capturar(page, 'd104-configuracion');

    // Decisión 106: el cambio sale del lápiz junto al @, y se ve ahí sin recargar.
    await page.getByRole('button', { name: 'Cambiar tu @', exact: true }).click();
    await page.getByLabel('Nuevo @usuario').fill('mati.nuevo');
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(page.locator('.profile-arroba')).toHaveText('@mati.nuevo');
    await sinCodigo(page);
  });
});

// ─── AB viejo y apagado: nada debajo del nombre, y todo funciona ────────────

for (const dueno of ['viejo', 'apagado'] as const) {
  test.describe(`AF-USERNAME-D104 · AB ${dueno}: sin @ debajo del nombre, nunca el código`, () => {
    test('Amigos: lista, solicitudes y grupo', async ({ page }) => {
      await comoDueno(page, dueno);
      await entrar(page);
      await irAAmigos(page);
      for (const nombre of ['Sofía Fernández', 'Juan López', 'Leo Paz']) {
        await debajo(fila(page, '.friend-row', nombre), null);
      }
      await sinCodigo(page);
      await capturar(page, `d104-${dueno}-amigos`);

      await page.getByRole('tab', { name: /Solicitudes/ }).click();
      await debajo(fila(page, '.friend-row', 'Valentina Ríos'), null);
      await sinCodigo(page);

      await page.getByRole('tab', { name: 'Grupos', exact: true }).click();
      await page.getByText('Familia', { exact: false }).first().click();
      await expect(page.getByText('Agregar del listado de amigos')).toBeVisible();
      await debajo(fila(page, '.friend-row', 'Sofía Fernández'), null);
      await debajo(fila(page, '.friend-row', 'Juan López'), null);
      await sinCodigo(page);
    });

    test('invitar amigos a una mesa y «Quiénes se sumaron»', async ({ page }) => {
      await comoDueno(page, dueno);
      await entrar(page);
      await abrirInvitar(page);
      await debajo(fila(page, '.inv-row', 'Sofía Fernández'), null);
      await debajo(fila(page, '.inv-row', 'Leo Paz'), null);
      await sinCodigo(page);

      await page.goto('/#/mesa/PA-2847');
      const lista = seccionQuienes(page);
      await expect(lista.getByText('Luis Cárdenas', { exact: true })).toBeVisible();
      await expect(lista.getByText('Renata Ortiz', { exact: true })).toBeVisible();
      await expect(lista.locator('.quien-id')).toHaveCount(0);
      await expect(page.getByText('No pudimos cargar quiénes se sumaron.')).toHaveCount(0);
      await sinCodigo(page);
    });

    test('«Quiénes se sumaron» sin nombre: «Sin nombre», nunca el código', async ({ page }) => {
      await comoDueno(page, dueno);
      await participantesSinNombre(page);
      await entrar(page);
      await page.goto('/#/mesa/PA-2847');
      const lista = seccionQuienes(page);
      await expect(lista.getByText('Luis Cárdenas', { exact: true })).toBeVisible();
      await expect(lista.locator('.quien-nombre').filter({ hasText: /^Sin nombre$/ })).toHaveCount(2);
      await sinCodigo(page);
    });

    test('Configuración', async ({ page }) => {
      await comoDueno(page, dueno);
      await entrar(page);
      await irEnLaApp(page, '/mas');
      await expect(page.getByRole('heading', { name: 'Configuración' })).toBeVisible();
      if (dueno === 'viejo') {
        // El @ propio no depende de las listas: el dueño anterior ya lo sirve.
        await expect(page.locator('.profile-arroba')).toHaveText('@mativeron');
      } else {
        await expect(page.locator('.profile-name-line')).toBeVisible();
        await expect(page.locator('.profile-arroba')).toHaveCount(0);
        await expect(page.getByText('Tu @usuario')).toHaveCount(0);
      }
      await sinCodigo(page);
      await capturar(page, `d104-${dueno}-configuracion`);
    });
  });
}
