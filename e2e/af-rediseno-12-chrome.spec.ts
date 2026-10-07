import { expect, test } from '@playwright/test';
import { ingresar } from './_app';
import { sacarFoto } from './_camara';

test.use({ viewport: { width: 375, height: 667 } });

test.describe('AF-REDISENO-12 · chrome compartido a 375 × 667', () => {
  /**
   * D177 · el paso 1 dejó de tener el chrome compartido: es la cámara a pantalla
   * completa. D212 · la cámara es la nativa del teléfono y este paso queda
   * debajo, a pantalla completa igual, con «Sacar foto» en lugar del disparador. Lo que este test fijaba ahí —el shell que no scrollea, los
   * tamaños táctiles y la campana navegable del flujo— se mide ahora en la
   * cámara (shell y toques) y en el paso siguiente (la campana). Las medidas
   * del chrome (cabecera 154, barra 64, círculo 56) las sigue fijando
   * `af-rediseno-12-censo-visual` en las demás superficies.
   */
  test('el shell exterior no scrollea y el flujo conserva geometría y campana navegable', async ({ page }) => {
    await ingresar(page);
    await page.getByRole('button', { name: 'Nueva', exact: true }).click();

    const disparador = page.getByRole('button', { name: 'Sacar foto', exact: true });
    await expect(disparador).toBeEnabled();
    const [volverBox, galeriaBox, disparadorBox, appBox, pantallaBox] = await Promise.all([
      page.locator('.camara-arriba').getByRole('button', { name: 'Volver', exact: true }).boundingBox(),
      page.getByRole('button', { name: 'Elegir de la galería o Drive', exact: true }).boundingBox(),
      disparador.boundingBox(),
      page.locator('.app').boundingBox(),
      page.locator('.screen.camara').boundingBox(),
    ]);
    expect(volverBox?.height).toBeGreaterThanOrEqual(44);
    expect(galeriaBox?.width).toBeGreaterThanOrEqual(44);
    expect(galeriaBox?.height).toBeGreaterThanOrEqual(44);
    expect(disparadorBox?.width).toBeGreaterThanOrEqual(64);
    expect(disparadorBox?.height).toBeGreaterThanOrEqual(64);
    // La pantalla llena la columna de la app, y los controles quedan adentro.
    expect(pantallaBox).toEqual(appBox);
    expect((disparadorBox?.y ?? 0) + (disparadorBox?.height ?? 0)).toBeLessThanOrEqual((appBox?.y ?? 0) + (appBox?.height ?? 0));
    // Sin la barra de navegación ni la campana: es pantalla completa.
    await expect(page.getByRole('navigation', { name: 'Navegación principal' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Avisos', exact: true })).toHaveCount(0);
    if (process.env.PAYME_E2E_CAPTURAS) {
      await page.screenshot({ path: `${process.env.PAYME_E2E_CAPTURAS}/u06-scan-camara.png`, fullPage: true });
    }

    const shell = await page.locator('.app').evaluate((node) => ({
      clientHeight: node.clientHeight,
      scrollHeight: node.scrollHeight,
    }));
    expect(shell.scrollHeight).toBe(shell.clientHeight);

    // El paso siguiente conserva el chrome del flujo y su campana navegable.
    await sacarFoto(page);
    const header = page.locator('.hdr-flow');
    await expect(header).toBeVisible();
    const bellBox = await header.getByRole('button', { name: 'Avisos', exact: true }).boundingBox();
    expect(bellBox?.width).toBeGreaterThanOrEqual(44);
    expect(bellBox?.height).toBeGreaterThanOrEqual(44);
    await header.getByRole('button', { name: 'Avisos', exact: true }).click();
    await expect(page).toHaveURL(/:\d+\/avisos$/);
  });

  test('Configuración muestra identidad, edita sólo nombre y foto, y sin cartel demo redundante', async ({ page }) => {
    await ingresar(page);
    await page.getByRole('button', { name: 'Más', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Configuración', exact: true })).toBeVisible();
    // AF-HIGIENE-ALTA · punto 3. Este test nació el 24/08 con la identidad de
    // perfil APAGADA y afirmaba «sin prometer edición»: cero botones de editar
    // y cero `input[type=file]`. Desde `6beab65` (25/08) el mock la sirve
    // encendida, como producción, y esas dos aserciones pasaban SÓLO porque se
    // evaluaban antes de que llegara la capability: un verde vacío. Hoy lo que
    // se afirma es lo servido, después de esperar la capability:
    //   - AF-LAPIZ-UNICO · decisión 110: UN solo lápiz, «Editar perfil», para la
    //     foto, el nombre y el @. Ningún campo a la vista ni input de archivo
    //     hasta tocarlo (el correo no es un campo);
    //   - apagada no hay edición: eso lo cubre `perfil-faltante-activado`
    //     (variante `off`) y, en unidad, `ProfileIdentityEditor.test.tsx`.
    await expect(page.getByRole('button', { name: 'Editar perfil', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /Editar|Cambiar/i })).toHaveCount(1);
    await expect(page.locator('input[type="file"]')).toHaveCount(0);
    await expect(page.locator('input:not([type="file"]), textarea, select, [contenteditable="true"]')).toHaveCount(0);
    await expect(page.getByText('Modo demo:', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Reiniciar la demo', exact: true })).toBeVisible();
    // AF-USERNAME-D104 · decisión 104: debajo del nombre, el @; el código, nunca.
    await expect(page.locator('.profile-arroba')).toHaveText('@mativeron');
    await expect(page.getByText(/payme_/)).toHaveCount(0);
  });

  test('Garantía deja la nota fija separada del círculo a 375 × 667', async ({ page }) => {
    await ingresar(page);
    await page.getByRole('button', { name: 'Nueva', exact: true }).click();
    await sacarFoto(page);
    await page.getByRole('radio', { name: /En partes iguales/ }).click();
    const sumar = page.getByRole('button', { name: 'Un comensal más' });
    for (let i = 0; i < 3; i += 1) await sumar.click();
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Garantiza la mesa', exact: true })).toBeVisible();

    const [noteBox, fabBox] = await Promise.all([
      page.locator('.gar-note-fixed').boundingBox(),
      page.locator('.appbar-fab').boundingBox(),
    ]);
    expect((noteBox?.y ?? Infinity) + (noteBox?.height ?? 0)).toBeLessThan(fabBox?.y ?? 0);
    await expect(page.locator('.gar-flow-scroll')).toHaveCSS('padding-bottom', '120px');
  });
});
