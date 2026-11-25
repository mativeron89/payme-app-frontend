import { expect, test, type Page } from '@playwright/test';
import { omitirGuiaEnFixture, relojFueraDeLasFechasDeLosViajes } from './_app';
import { camaraSimulada } from './_camara';

async function inicioSinMesas(page: Page, idioma: 'es' | 'en' = 'es') {
  await page.setViewportSize({ width: 375, height: 812 });
  await relojFueraDeLasFechasDeLosViajes(page);
  await omitirGuiaEnFixture(page);
  await camaraSimulada(page);
  await page.addInitScript((lengua) => localStorage.setItem('payme.app.idioma.v1', lengua), idioma);
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill('aviso@example.test');
  await page.getByLabel({ es: 'Contraseña', en: 'Password' }[idioma], { exact: true }).fill('fixture-e2e');
  await page.getByRole('button', { name: idioma === 'es' ? 'Entrar' : 'Log in', exact: true }).click();
  await expect(page.getByRole('button', { name: idioma === 'es' ? 'Escanear' : 'Scan', exact: true })).toBeVisible();
  // Fuera de la app, ningún pedido del mock puede sobrescribir la fixture vacía.
  await page.goto('/privacy');
  await expect(page.getByRole('heading', { name: 'Aviso de privacidad', exact: true })).toBeVisible();
  await page.evaluate(() => {
    const estado = JSON.parse(localStorage.getItem('payme_mock_state_v1')!) as { mesas: { openedByUser: boolean }[]; joinedMesaCodes: string[] };
    for (const mesa of estado.mesas) mesa.openedByUser = false;
    estado.joinedMesaCodes = [];
    localStorage.setItem('payme_mock_state_v1', JSON.stringify(estado));
  });
  await page.goto('/home');
  await expect(page.getByText(idioma === 'es' ? 'No tienes mesas abiertas' : 'You have no open tables', { exact: true })).toBeVisible();
}

for (const control of ['aviso', 'centro'] as const) {
  test(`K6 · ${control} abre Escanear sin mesas`, async ({ page }) => {
    await inicioSinMesas(page);
    await page.getByRole('button', { name: control === 'aviso' ? 'No tienes mesas abiertas. Escanear un ticket' : 'Escanear', exact: true }).click();
    await expect(page).toHaveURL(/\/scan$/);
    await expect(page.getByRole('heading', { name: 'Escanea el ticket', exact: true })).toBeVisible();
  });
}

for (const idioma of ['es', 'en'] as const) {
  for (const tecla of ['Enter', 'Space']) {
    test(`K4 · ${idioma} ${tecla} activa el aviso con foco visible`, async ({ page }) => {
      await inicioSinMesas(page, idioma);
      const aviso = page.getByRole('button', { name: idioma === 'es' ? 'No tienes mesas abiertas. Escanear un ticket' : 'You have no open tables. Scan a receipt', exact: true });
      const dir = process.env.PAYME_E2E_CAPTURAS;
      await page.locator('.scroll').first().evaluate((el) => el.scrollTo({ top: el.scrollHeight, behavior: 'instant' }));
      if (dir && idioma === 'es' && tecla === 'Enter') await page.screenshot({ path: `${dir}/inicio-reposo-375.png`, fullPage: true });
      await expect(aviso).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await expect(aviso).toHaveCSS('-webkit-tap-highlight-color', 'rgba(0, 0, 0, 0)');
      // Tab real hasta el aviso: no click que borre la modalidad del teclado.
      for (let i = 0; i < 40 && !(await aviso.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab');
      await expect(aviso).toBeFocused();
      expect(await aviso.evaluate((el) => el.matches(':focus-visible') && getComputedStyle(el).outlineStyle !== 'none')).toBe(true);
      await page.locator('.scroll').first().evaluate((el) => el.scrollTo({ top: el.scrollHeight, behavior: 'instant' }));
      if (dir && idioma === 'es' && tecla === 'Enter') await page.screenshot({ path: `${dir}/inicio-foco-375.png`, fullPage: true });
      await page.keyboard.press(tecla);
      await expect(page).toHaveURL(/\/scan$/);
    });
  }
}

for (const flag of ['disabled', 'busy'] as const) {
  test(`K3 · ${flag} impide click y teclado, con control habilitado`, async ({ page }) => {
    await inicioSinMesas(page);
    await page.evaluate(async (estado) => {
      const ruta = '/e2e/fixtures/montar-aviso.tsx';
      const { montarAviso } = await import(ruta) as typeof import('./fixtures/montar-aviso');
      const prueba = document.createElement('div');
      prueba.id = 'aviso-fixture';
      prueba.dataset.llamadas = '0';
      prueba.style.cssText = 'position:fixed;inset:0;background:white;z-index:99999';
      document.body.append(prueba);
      const habilitarAviso = montarAviso(prueba, estado);
      const habilitar = document.createElement('button');
      habilitar.textContent = 'Habilitar fixture';
      habilitar.style.cssText = 'position:fixed;top:0;left:0;z-index:100000';
      habilitar.onclick = habilitarAviso;
      document.body.append(habilitar);
    }, flag);
    const fixture = page.locator('#aviso-fixture');
    const aviso = fixture.getByRole('button');
    await expect(aviso).toBeDisabled();
    await aviso.click({ force: true });
    await page.keyboard.press('Enter');
    await page.keyboard.press('Space');
    await expect(fixture).toHaveAttribute('data-llamadas', '0');
    await page.getByRole('button', { name: 'Habilitar fixture', exact: true }).click({ force: true });
    await expect(aviso).toBeEnabled();
    await aviso.click();
    await expect(fixture).toHaveAttribute('data-llamadas', '1');
  });
}
