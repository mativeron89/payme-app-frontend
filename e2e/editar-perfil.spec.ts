import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { ingresar, irEnLaApp } from './_app';

/**
 * AF-LAPIZ-UNICO · decisión 110 de Mati: «dejar solo un lápiz que conglomere la
 * foto, el nombre y el @. Hoy hay un botón para la foto, otro para el nombre y
 * otro para el @».
 *
 * «Guardar» manda sólo lo que cambió: se cuentan las llamadas a los cuatro
 * endpoints de la fachada (`api`, envuelta en la página como `usuario-arroba`).
 */

const MUTACIONES = ['updateProfileIdentity', 'putUsername', 'putProfileAvatar', 'deleteProfileAvatar'] as const;
type Mutacion = (typeof MUTACIONES)[number];
const USUARIO_MOCK = 'a0000000-0000-4000-8000-000000000001';

async function espiar(page: Page, demoraMs = 0): Promise<void> {
  await page.evaluate(async ({ metodos, demora }) => {
    const ruta = '/src/api/index.ts';
    const { api } = await import(/* @vite-ignore */ ruta) as { api: Record<string, (...a: unknown[]) => Promise<unknown>> };
    const w = window as unknown as { __perfil: Record<string, number> };
    w.__perfil = {};
    for (const m of metodos) {
      const original = api[m]!.bind(api);
      w.__perfil[m] = 0;
      api[m] = async (...a: unknown[]) => {
        w.__perfil[m]! += 1;
        if (demora) await new Promise((r) => setTimeout(r, demora));
        return original(...a);
      };
    }
  }, { metodos: [...MUTACIONES], demora: demoraMs });
}

const llamadas = (page: Page) => page.evaluate(() => (window as unknown as { __perfil: Record<Mutacion, number> }).__perfil);

const form = (page: Page) => page.getByRole('form', { name: 'Editar perfil' });
const lapiz = (page: Page) => page.getByRole('button', { name: 'Editar perfil', exact: true });
const nombre = (page: Page) => form(page).getByLabel('Nombre', { exact: true });
const apellido = (page: Page) => form(page).getByLabel('Apellido', { exact: true });
const arroba = (page: Page) => form(page).getByLabel('Tu @usuario');
const guardar = (page: Page) => form(page).getByRole('button', { name: 'Guardar', exact: true });
const encabezado = (page: Page) => page.locator('.config-profile');

const FOTO = () => ({
  name: 'foto.jpg',
  mimeType: 'image/jpeg',
  buffer: readFileSync(resolve('landing/img/mesa-comida.jpg')),
});

async function capturar(page: Page, nombreCaptura: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (dir) await page.screenshot({ path: `${dir}/${test.info().project.name}-${nombreCaptura}.png`, fullPage: true });
}

/** Configuración con el @ ya leído (el lápiz depende de nombre/foto y del @). */
async function abrirConfiguracion(page: Page, demoraMs = 0): Promise<void> {
  await ingresar(page);
  await irEnLaApp(page, '/mas');
  await expect(page.locator('.profile-arroba')).toHaveText('@mativeron');
  await espiar(page, demoraMs);
}

async function abrirEditor(page: Page): Promise<void> {
  await lapiz(page).click();
  await expect(form(page)).toBeVisible();
  await expect(arroba(page)).toHaveValue('mativeron');
}

test.describe('AF-LAPIZ-UNICO · un solo lápiz para foto, nombre y @', () => {
  test('un solo lápiz en el encabezado, y abre los tres campos juntos', async ({ page }) => {
    await abrirConfiguracion(page);
    // En el encabezado del perfil hay UN botón: el lápiz. Ni cámara, ni lápiz del @.
    await expect(encabezado(page).getByRole('button')).toHaveCount(1);
    await expect(lapiz(page)).toBeVisible();
    await expect(page.getByRole('button', { name: /Editar nombre|Cambiar tu @|Cambiar foto de perfil|Eliminar foto/ })).toHaveCount(0);
    await expect(page.locator('input[type="file"]')).toHaveCount(0);
    await capturar(page, 'editar-perfil-01-encabezado');

    await abrirEditor(page);
    await expect(form(page).getByRole('button', { name: 'Cambiar foto de perfil' })).toBeVisible();
    await expect(nombre(page)).toHaveValue('Mati');
    await expect(apellido(page)).toBeVisible();
    // 16 px en los campos: por debajo, el iPhone agranda la pantalla al tocarlos.
    for (const campo of [nombre(page), apellido(page), arroba(page)]) {
      expect(await campo.evaluate((el) => getComputedStyle(el).fontSize)).toBe('16px');
    }
    // A 390 px sin cortes: nada del formulario desborda el ancho.
    const caja = await form(page).boundingBox();
    expect(caja!.x).toBeGreaterThanOrEqual(0);
    expect(caja!.x + caja!.width).toBeLessThanOrEqual(390);
    expect(await form(page).evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await capturar(page, 'editar-perfil-02-formulario');
  });

  test('sólo el nombre: se guarda el nombre y nada más', async ({ page }) => {
    await abrirConfiguracion(page);
    await abrirEditor(page);
    // Nombre y apellido se validan juntos, como antes (la cuenta demo no tiene apellido).
    await nombre(page).fill('Renata');
    await apellido(page).fill('Nueva');
    await guardar(page).click();
    await expect(page.getByText('Perfil actualizado ✓')).toBeVisible();
    await expect(form(page)).toHaveCount(0);
    await expect(encabezado(page).locator('.h2')).toHaveText('Renata Nueva');
    expect(await llamadas(page)).toEqual({ updateProfileIdentity: 1, putUsername: 0, putProfileAvatar: 0, deleteProfileAvatar: 0 });
  });

  test('sólo el @: se guarda el @ y nada más', async ({ page }) => {
    await abrirConfiguracion(page);
    await abrirEditor(page);
    await arroba(page).fill('mati.nuevo');
    await guardar(page).click();
    await expect(page.locator('.profile-arroba')).toHaveText('@mati.nuevo');
    await expect(form(page)).toHaveCount(0);
    expect(await llamadas(page)).toEqual({ updateProfileIdentity: 0, putUsername: 1, putProfileAvatar: 0, deleteProfileAvatar: 0 });
  });

  test('sólo la foto: se ve antes de guardar, se sube al guardar, y se quita desde el mismo lugar', async ({ page }) => {
    await abrirConfiguracion(page);
    await abrirEditor(page);
    await page.locator('input[type="file"]').setInputFiles(FOTO());
    // La vista previa, antes de guardar: nada salió todavía.
    await expect(form(page).getByRole('img', { name: 'Foto de perfil' })).toBeVisible();
    expect((await llamadas(page)).putProfileAvatar).toBe(0);
    await guardar(page).click();
    await expect(form(page)).toHaveCount(0);
    await expect(encabezado(page).getByRole('img', { name: 'Foto de perfil' })).toBeVisible();
    expect(await llamadas(page)).toEqual({ updateProfileIdentity: 0, putUsername: 0, putProfileAvatar: 1, deleteProfileAvatar: 0 });

    await abrirEditor(page);
    await form(page).getByRole('button', { name: 'Eliminar foto' }).click();
    await guardar(page).click();
    await expect(form(page)).toHaveCount(0);
    await expect(encabezado(page).getByRole('img', { name: 'Foto de perfil' })).toHaveCount(0);
    expect(await llamadas(page)).toEqual({ updateProfileIdentity: 0, putUsername: 0, putProfileAvatar: 1, deleteProfileAvatar: 1 });
  });

  test('los tres juntos, con un solo «Guardar»', async ({ page }) => {
    await abrirConfiguracion(page);
    await abrirEditor(page);
    await nombre(page).fill('Renata');
    await apellido(page).fill('Nueva');
    await arroba(page).fill('renata.nueva');
    await page.locator('input[type="file"]').setInputFiles(FOTO());
    await capturar(page, 'editar-perfil-03-los-tres');
    await guardar(page).click();
    await expect(page.getByText('Perfil actualizado ✓')).toBeVisible();
    await expect(encabezado(page).locator('.h2')).toHaveText('Renata Nueva');
    await expect(page.locator('.profile-arroba')).toHaveText('@renata.nueva');
    await expect(encabezado(page).getByRole('img', { name: 'Foto de perfil' })).toBeVisible();
    expect(await llamadas(page)).toEqual({ updateProfileIdentity: 1, putUsername: 1, putProfileAvatar: 1, deleteProfileAvatar: 0 });
  });

  test('@ ocupado: el error queda en el @, el nombre se guarda igual y lo escrito no se pierde', async ({ page }) => {
    await abrirConfiguracion(page);
    await abrirEditor(page);
    await nombre(page).fill('Renata');
    await apellido(page).fill('Nueva');
    await arroba(page).fill('mariana');
    await page.locator('input[type="file"]').setInputFiles(FOTO());
    await guardar(page).click();
    // El error queda EN el @ (su bloque), y es el único.
    await expect(form(page).locator('.arroba-edicion').getByRole('alert')).toHaveText('Ese @ no está disponible.');
    await expect(form(page).getByRole('alert')).toHaveCount(1);
    // El nombre y la foto se guardaron: la cabecera de la app, detrás del formulario, ya dice el nombre.
    await expect(page.locator('.hdr-user')).toHaveText('Renata Nueva');
    await expect(nombre(page)).toHaveValue('Renata');
    await expect(arroba(page)).toHaveValue('mariana');
    expect(await llamadas(page)).toEqual({ updateProfileIdentity: 1, putUsername: 1, putProfileAvatar: 1, deleteProfileAvatar: 0 });
    await capturar(page, 'editar-perfil-04-arroba-ocupado');

    // Reintentar manda sólo lo que falló: ni el nombre ni la foto otra vez.
    await arroba(page).fill('renata.v');
    await guardar(page).click();
    await expect(form(page)).toHaveCount(0);
    await expect(page.locator('.profile-arroba')).toHaveText('@renata.v');
    expect(await llamadas(page)).toEqual({ updateProfileIdentity: 1, putUsername: 2, putProfileAvatar: 1, deleteProfileAvatar: 0 });
  });

  test('@ en período de espera al guardar: el error queda en el @ con la fecha del dueño y el nombre se guarda igual', async ({ page }) => {
    await abrirConfiguracion(page);
    await abrirEditor(page);
    // Entre que se abrió y se guardó, el @ cambió en otro lado hace 2 días.
    await page.evaluate(([clave, id]) => {
      const cambio = new Date(Date.now() - 2 * 86_400_000).toISOString();
      localStorage.setItem(clave, JSON.stringify({ [id]: { username: 'mati.otro', changed_at: cambio } }));
    }, ['payme.app.mock.username_propio.v1', USUARIO_MOCK] as const);
    await nombre(page).fill('Renata');
    await apellido(page).fill('Nueva');
    await arroba(page).fill('mati.nuevo');
    await guardar(page).click();
    await expect(form(page).locator('.arroba-edicion').getByRole('alert'))
      .toHaveText(/^Puedes volver a cambiar tu @ desde el \d{1,2} de [a-z]+\.$/);
    await expect(form(page).getByRole('alert')).toHaveCount(1);
    await expect(arroba(page)).toHaveCount(0);
    await expect(page.locator('.hdr-user')).toHaveText('Renata Nueva');
    await expect(nombre(page)).toHaveValue('Renata');
  });

  test('«Cancelar» no cambia nada y no deja nada escrito', async ({ page }) => {
    await abrirConfiguracion(page);
    const antes = await encabezado(page).locator('.h2').textContent();
    await abrirEditor(page);
    await nombre(page).fill('Otro');
    await apellido(page).fill('Distinto');
    await arroba(page).fill('otro.nombre');
    await page.locator('input[type="file"]').setInputFiles(FOTO());
    await form(page).getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(form(page)).toHaveCount(0);
    await expect(encabezado(page).locator('.h2')).toHaveText(antes!);
    await expect(page.locator('.profile-arroba')).toHaveText('@mativeron');
    await expect(encabezado(page).getByRole('img', { name: 'Foto de perfil' })).toHaveCount(0);
    expect(await llamadas(page)).toEqual({ updateProfileIdentity: 0, putUsername: 0, putProfileAvatar: 0, deleteProfileAvatar: 0 });
    // Al volver a abrir, está lo de hoy, no lo que se escribió.
    await abrirEditor(page);
    await expect(nombre(page)).toHaveValue('Mati');
    await expect(form(page).getByRole('img', { name: 'Foto de perfil' })).toHaveCount(0);
  });

  test('doble toque en «Guardar»: guarda una sola vez, y mientras tanto dice «Guardando…»', async ({ page }) => {
    await abrirConfiguracion(page, 800);
    await abrirEditor(page);
    await nombre(page).fill('Renata');
    await apellido(page).fill('Nueva');
    await guardar(page).dblclick();
    await expect(form(page).getByRole('button', { name: 'Guardando…', exact: true })).toBeDisabled();
    await expect(form(page)).toHaveCount(0);
    await expect(encabezado(page).locator('.h2')).toHaveText('Renata Nueva');
    expect((await llamadas(page)).updateProfileIdentity).toBe(1);
  });

  test('dos envíos en el mismo instante (antes de que el botón se deshabilite): también guarda una sola vez', async ({ page }) => {
    await abrirConfiguracion(page, 300);
    await abrirEditor(page);
    await nombre(page).fill('Renata');
    await apellido(page).fill('Nueva');
    // Los dos en la misma tarea: React todavía no dibujó el `disabled`. Sólo la
    // guarda por ref los frena (un doble toque en un teléfono lento cae acá).
    await form(page).evaluate((f) => { (f as HTMLFormElement).requestSubmit(); (f as HTMLFormElement).requestSubmit(); });
    await expect(form(page)).toHaveCount(0);
    await expect(page.getByText('Perfil actualizado ✓')).toBeVisible();
    expect((await llamadas(page)).updateProfileIdentity).toBe(1);
  });
});
