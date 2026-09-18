import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ingresar } from './_app';

/**
 * APP-LINK-ACCOUNT-AF-09-20260918 · «Cuentas conectadas», recorrido y VISTA PREVIA.
 *
 * Corre contra el riel mock: es el único donde `social.google.linking` está
 * encendido. En producción hoy Google está apagado y la sección no existe.
 *
 * Es recorrido Y foto. Cada paso AFIRMA lo que tiene que estar antes de sacar la
 * captura, así este spec no se pudre en silencio cuando nadie está mirando PNG:
 * sin `AF_CAPTURES_DIR` igual corre y verifica.
 *
 * ## La contraseña incorrecta se fuerza parcheando la fachada
 *
 * El mock no guarda contraseñas —su login acepta cualquiera—, así que no tiene
 * un camino natural a `reauthentication_failed`. Inventar uno le enseñaría a la
 * demo una regla que el producto no tiene. Se reemplaza `api.googleLink` por una
 * que rechaza con el `MockApiError` REAL y el componente recorre su camino de
 * verdad: `enviar` → `catch` → `claseDeErrorDeVinculo` → el mensaje. Mismo
 * idioma que `af-diseno-02` y la vista previa del ingreso.
 */

const CAPTURES_DIR = process.env.AF_CAPTURES_DIR;
const MOVIL = { width: 390, height: 844 };
const ESCRITORIO = { width: 1280, height: 900 };
const CONTRASENA = 'contrasena-sintetica';

async function capturar(page: Page, nombre: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  if (!CAPTURES_DIR) return;
  mkdirSync(CAPTURES_DIR, { recursive: true });
  // La sección vive abajo en Configuración: se centra antes de la foto.
  await page.locator('.cuentas-conectadas').scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(CAPTURES_DIR, nombre), fullPage: false, animations: 'disabled' });
}

const seccion = (page: Page) => page.locator('section.cuentas-conectadas');

async function abrirConfiguracion(page: Page): Promise<void> {
  await page.goto('/#/mas');
  await expect(page.getByRole('heading', { name: 'Configuración', exact: true })).toBeVisible();
}

async function hastaContrasena(page: Page): Promise<void> {
  await seccion(page).getByRole('button', { name: 'Vincular Google', exact: true }).click();
  // El botón de Google del mock es el stand-in de GIS: vive en el mismo contenedor.
  await seccion(page).getByRole('button', { name: 'Continuar con Google', exact: true }).click();
  await expect(seccion(page).getByLabel('Contraseña', { exact: true })).toBeVisible();
}

for (const [medida, viewport] of [['movil', MOVIL], ['escritorio', ESCRITORIO]] as const) {
  test.describe(`cuentas conectadas · ${medida}`, () => {
    test.use({ viewport, deviceScaleFactor: 2 });

    test('vincular desde la cuenta: No vinculada → Google → contraseña → Vinculada', async ({ page }) => {
      await ingresar(page);
      await abrirConfiguracion(page);

      // ① Entró con contraseña: Google NO está vinculado, y se ofrece vincular.
      await expect(seccion(page).getByText('No vinculada', { exact: true })).toBeVisible();
      await capturar(page, `cuentas-01-no-vinculada-${medida}.png`);

      // ② Elegir Google: explicación + botón de Google + Cancelar.
      await seccion(page).getByRole('button', { name: 'Vincular Google', exact: true }).click();
      await expect(seccion(page).getByText(
        'Elige tu cuenta de Google. Después te pedimos tu contraseña de PayMe una sola vez.',
        { exact: true },
      )).toBeVisible();
      await capturar(page, `cuentas-02-elegir-google-${medida}.png`);

      // ③ Google devolvió su credencial: se pide la contraseña UNA vez.
      await seccion(page).getByRole('button', { name: 'Continuar con Google', exact: true }).click();
      const campo = seccion(page).getByLabel('Contraseña', { exact: true });
      await expect(campo).toBeVisible();
      await expect(campo).toHaveAttribute('autocomplete', 'current-password');
      await expect(campo).toHaveValue('');
      await capturar(page, `cuentas-03-contrasena-${medida}.png`);

      // ④ Vincular ⇒ `{linked:true}` del mock ⇒ estado «Vinculada».
      await campo.fill(CONTRASENA);
      await seccion(page).getByRole('button', { name: 'Vincular', exact: true }).click();
      await expect(seccion(page).getByText('Vinculada', { exact: true })).toBeVisible();
      await expect(seccion(page).getByText('Listo: ya puedes entrar con Google.', { exact: true })).toBeVisible();
      // La contraseña no sobrevive a su paso: el campo ya no existe.
      await expect(seccion(page).getByLabel('Contraseña', { exact: true })).toHaveCount(0);
      await capturar(page, `cuentas-04-vinculada-${medida}.png`);

      // ⑤ El estado es del DUEÑO, no de la pantalla: sobrevive a volver a entrar.
      await page.reload();
      await abrirConfiguracion(page);
      await expect(seccion(page).getByText('Vinculada', { exact: true })).toBeVisible();
      await expect(seccion(page).getByRole('button', { name: 'Vincular Google', exact: true })).toHaveCount(0);
    });

    test('🔴 contraseña incorrecta: mensaje opaco, y se reintenta SIN volver a elegir Google', async ({ page }) => {
      await ingresar(page);
      await abrirConfiguracion(page);
      await hastaContrasena(page);

      await page.evaluate(async () => {
        const ruta = '/src/api/index.ts';
        const rutaMock = '/src/api/mock/mockApi.ts';
        const modulo = await import(/* @vite-ignore */ ruta);
        const { MockApiError } = await import(/* @vite-ignore */ rutaMock);
        // Firma real: MockApiError(status, error). Invertirla hizo pasar un test
        // por la causa equivocada en la vista previa del ingreso (AF-02); no se repite.
        modulo.api.googleLink = async () => { throw new MockApiError(403, 'reauthentication_failed'); };
      });

      const campo = seccion(page).getByLabel('Contraseña', { exact: true });
      await campo.fill('contrasena-equivocada');
      await seccion(page).getByRole('button', { name: 'Vincular', exact: true }).click();

      await expect(seccion(page).getByText('La contraseña no es correcta.', { exact: true })).toBeVisible();
      // Control que discrimina: el error del PROVEEDOR es otro texto, y no aparece.
      await expect(seccion(page).getByText(
        'No pudimos vincular esa cuenta de Google. Inténtalo de nuevo.', { exact: true },
      )).toHaveCount(0);
      // Sigue en el paso de contraseña —el id_token no se consumió— y el campo queda marcado.
      await expect(campo).toBeVisible();
      await expect(campo).toHaveAttribute('aria-invalid', 'true');
      await expect(seccion(page).getByRole('button', { name: 'Continuar con Google', exact: true })).toHaveCount(0);
      await capturar(page, `cuentas-05-contrasena-incorrecta-${medida}.png`);

      // 🔴 Con la sección en su estado más ALTO, «Cerrar sesión» tiene que seguir
      // alcanzable sobre la barra de cinco. `toBeVisible()` no ve un elemento
      // TAPADO: se miden las cajas.
      await page.locator('.scroll').evaluate((el) => { el.scrollTop = el.scrollHeight; });
      const salir = await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).boundingBox();
      const barra = await page.locator('.appbar-block').boundingBox();
      expect(salir, 'no se encontró «Cerrar sesión»').not.toBeNull();
      expect(barra, 'no se encontró la barra').not.toBeNull();
      expect(salir!.y + salir!.height, '«Cerrar sesión» queda debajo de la barra').toBeLessThanOrEqual(barra!.y);
    });

    test('🔴 cancelar deja todo limpio: de vuelta a «No vinculada», sin campo ni botón de Google', async ({ page }) => {
      await ingresar(page);
      await abrirConfiguracion(page);
      await hastaContrasena(page);
      await seccion(page).getByLabel('Contraseña', { exact: true }).fill(CONTRASENA);

      await seccion(page).getByRole('button', { name: 'Cancelar', exact: true }).click();

      await expect(seccion(page).getByText('No vinculada', { exact: true })).toBeVisible();
      await expect(seccion(page).getByLabel('Contraseña', { exact: true })).toHaveCount(0);
      await expect(seccion(page).getByRole('button', { name: 'Continuar con Google', exact: true })).toHaveCount(0);
      // Y no vinculó nada por el camino: al volver a entrar sigue sin vincular.
      await page.reload();
      await abrirConfiguracion(page);
      await expect(seccion(page).getByText('No vinculada', { exact: true })).toBeVisible();
    });

    test('quien entró con Google ya aparece vinculado, sin que se le ofrezca vincular', async ({ page }) => {
      await page.goto('/');
      await page.getByRole('button', { name: 'Continuar con Google', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
      await abrirConfiguracion(page);

      await expect(seccion(page).getByText('Vinculada', { exact: true })).toBeVisible();
      await expect(seccion(page).getByRole('button', { name: 'Vincular Google', exact: true })).toHaveCount(0);
      await capturar(page, `cuentas-06-entro-con-google-${medida}.png`);
    });
  });
}
