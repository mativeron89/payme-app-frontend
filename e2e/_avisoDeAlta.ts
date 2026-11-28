import { expect, type Page } from '@playwright/test';
import { MOCK_USER } from '../src/api/mock/seedData';
import { omitirGuiaEnFixture } from './_app';

/** Dos revisiones sintéticas del Aviso. El reintento usa el par que acepta el mock de AF. */
export async function prepararCambioDeAviso(page: Page, sinCredencial = false) {
  await omitirGuiaEnFixture(page);
  await page.addInitScript(({ id, sinCredencial }) => {
    if (sessionStorage.getItem('e2e.avisoDeAlta')) return;
    sessionStorage.setItem('e2e.avisoDeAlta', 'anterior');
    if (sinCredencial) sessionStorage.setItem('e2e.popupSinCredencial', '1');
    localStorage.setItem('payme.app.mock.sugerencias.v1', 'encendido');
    localStorage.setItem('payme.app.mock.username.v1', 'true');
    localStorage.setItem('payme.app.mock.username_propio.v1', JSON.stringify({ [id]: null }));
    localStorage.setItem('payme.app.mock.legal_aceptado.v1', JSON.stringify([id]));
  }, { id: MOCK_USER.id, sinCredencial });
  await page.route('**/src/main.tsx', async ruta => {
    const respuesta = await ruta.fetch();
    await ruta.fulfill({ response: respuesta, body: "import '/e2e/_permisosGoogleMock.ts';\n" + await respuesta.text() });
  });
}

export const fotoOpcional = (page: Page) => page.getByRole('checkbox', { name: 'Mostrar mi foto', exact: true });
export const analisisOpcional = (page: Page) => page.getByRole('checkbox', { name: 'Análisis interno', exact: true });

export async function elegirAmbosPermisos(page: Page) {
  await fotoOpcional(page).check();
  await analisisOpcional(page).check();
}

export async function confirmarLecturaDelAvisoNuevo(page: Page) {
  await expect(page.getByRole('alert')).toContainText('Actualizamos los documentos');
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('e2e.lecturaAviso'))).toBe('vigente');
  await expect(fotoOpcional(page)).toBeChecked({ checked: false });
  await expect(analisisOpcional(page)).toBeChecked({ checked: false });
}

export async function terminarAltaYLeerEventos(page: Page) {
  const arroba = page.getByRole('textbox', { name: 'Tu @usuario', exact: true });
  await arroba.fill('ejemplolocal');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Escanear', exact: true })).toBeVisible();
  return page.evaluate(async () => {
    const ruta = '/e2e/_permisosGoogleMock.ts';
    return (await import(/* @vite-ignore */ ruta)).operaciones() as string[];
  });
}
