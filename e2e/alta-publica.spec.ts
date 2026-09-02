import { expect, test } from '@playwright/test';

/**
 * C2b · **alta pública, en sus DOS direcciones.**
 *
 * El dueño publica `features.signup.public_registration` en `GET /api/config` y
 * este front lo lee fail-closed: ausente, malformada o `false` ⇒ sólo
 * invitación, que es la conducta de siempre. Por eso el recorrido no alcanza con
 * probar que el alta aparece cuando está abierta: **lo que protege de verdad es
 * el caso cerrado**, donde una regresión abriría el registro a cualquiera sin
 * que ningún test lo note.
 *
 * ⚠️ **Los dos casos usan el mismo seam del mock y ninguno toca la app.** El
 * mock lee `payme.app.mock.public_signup.v1` de `localStorage`; el camino real
 * de la capability **no consulta storage en ningún punto** —su única fuente es
 * el config del dueño— y eso lo fija un test unitario, no este archivo.
 *
 * 🔴 **Este spec NO duerme con el corte de pagos.** El alta no es checkout: una
 * app pública sin cobros necesita registro, así que el recorrido tiene que
 * seguir vivo mientras el corte esté activo.
 */

/** Abre o cierra el alta ANTES de que el mock lea la capability. */
async function conAltaPublica(page: import('@playwright/test').Page, abierta: boolean): Promise<void> {
  await page.addInitScript((valor) => {
    localStorage.setItem('payme.app.mock.public_signup.v1', valor ? 'true' : 'false');
  }, abierta);
}

test('con el alta CERRADA no hay registro sin invitación: la conducta de siempre', async ({ page }) => {
  await conAltaPublica(page, false);
  await page.goto('/');

  // El formulario de ingreso está entero…
  await expect(page.getByPlaceholder('Email')).toBeVisible();
  await expect(page.getByPlaceholder('Contraseña')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();

  /**
   * 🔴 **EL TESTIGO POSITIVO, y sin él este test no probaba nada.**
   *
   * Lo escribí primero sin esta espera y un mutante lo demostró: publicando la
   * capability SIEMPRE abierta, el test seguía en verde. La razón es que
   * `toHaveCount(0)` se cumple **de inmediato**, antes de que `GET /api/config`
   * conteste — o sea que afirmaba «no está» sobre una pantalla que todavía no
   * había cargado nada, y habría pasado igual con el alta abierta.
   *
   * El botón de Google sólo se renderiza cuando la capability social llegó y se
   * aplicó. Esperarlo prueba que el config YA está en la pantalla, y recién ahí
   * la ausencia del registro significa algo.
   */
  await expect(page.getByRole('group', { name: 'Continuar con Google' })).toBeVisible();

  // …y ahora sí: con el config aplicado, la puerta al registro NO existe.
  await expect(page.getByRole('button', { name: /No tienes cuenta/ })).toHaveCount(0);
  await expect(page.getByPlaceholder('Nombre')).toHaveCount(0);
  await expect(page.getByPlaceholder('Apellido')).toHaveCount(0);
});

test('con el alta ABIERTA se puede crear cuenta sin invitación, y el formulario pide lo que el dueño exige', async ({ page }) => {
  await conAltaPublica(page, true);
  await page.goto('/');

  // 🔴 La pantalla NO nace en registro, y es deliberado: el alta abierta es una
  // puerta, no una intención. Quien entra puede tener cuenta hace meses. Lo que
  // sí aparece —y con el alta cerrada no— es la puerta al registro.
  await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /No tienes cuenta/ }).click();

  await expect(page.getByRole('button', { name: 'Registrarme', exact: true })).toBeVisible();
  await expect(page.getByPlaceholder('Nombre')).toBeVisible();
  await expect(page.getByPlaceholder('Apellido')).toBeVisible();
  await expect(page.getByPlaceholder('Email')).toBeVisible();
  await expect(page.getByPlaceholder('Contraseña')).toBeVisible();

  await page.getByPlaceholder('Nombre').fill('Mati');
  await page.getByPlaceholder('Apellido').fill('Verón');
  await page.getByPlaceholder('Email').fill('alta-publica@payme.mx');
  await page.getByPlaceholder('Contraseña').fill('sin-invitacion-1');
  await page.getByRole('button', { name: 'Registrarme', exact: true }).click();

  // Sesión creada: se ve la app, no un error de invitación.
  await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
});

test('el toggle vuelve al ingreso y el alta pública no rompe el camino de siempre', async ({ page }) => {
  await conAltaPublica(page, true);
  await page.goto('/');

  // Ida y vuelta por el toggle: la puerta abierta no rompe el ingreso de siempre.
  await page.getByRole('button', { name: /No tienes cuenta/ }).click();
  await expect(page.getByRole('button', { name: 'Registrarme', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Ya tengo cuenta/ }).click();

  await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
  await page.getByPlaceholder('Email').fill('mati@payme.mx');
  await page.getByPlaceholder('Contraseña').fill('demo-e2e');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
});
