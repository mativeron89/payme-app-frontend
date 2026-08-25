import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { ingresar } from './_app';

const CAPTURE_DIR = process.env.RUNNER_TEMP || '/private/tmp';
const CONFIG_CAPTURE = resolve(CAPTURE_DIR, 'payme-app-fe-configuracion-390x844.png');
const NOTIFICATIONS_CAPTURE = resolve(CAPTURE_DIR, 'payme-app-fe-notificaciones-390x844.png');

test.use({ viewport: { width: 390, height: 844 } });

async function applyPrivateVariant(
  page: import('@playwright/test').Page,
  variant: 'off' | 'absent' | 'malformed' | 'superseded_notice' | 'unknown_notice',
): Promise<void> {
  await page.evaluate(async (selected) => {
    const apiPath = '/src/api/index.ts';
    const featurePath = '/src/api/privateFeatures.ts';
    const [{ api }, feature] = await Promise.all([
      import(/* @vite-ignore */ apiPath),
      import(/* @vite-ignore */ featurePath),
    ]) as [
      { api: { getConfig(): Promise<Record<string, unknown>> } },
      { applyPrivateFeatureConfig(config: unknown): void },
    ];
    if (selected === 'absent') {
      feature.applyPrivateFeatureConfig({ features: {} });
      return;
    }
    if (selected === 'malformed') {
      feature.applyPrivateFeatureConfig({
        features: { profile_identity: 'on', settlement_shortfall_detail: [] },
      });
      return;
    }
    const config = await api.getConfig();
    const features = config.features as Record<string, Record<string, unknown>>;
    if (selected === 'off') {
      feature.applyPrivateFeatureConfig({
        ...config,
        features: {
          ...features,
          profile_identity: {
            ...features.profile_identity,
            enabled: false,
            notice_version: null,
            activation_blocker: 'disabled_for_browser_negative',
          },
          settlement_shortfall_detail: {
            ...features.settlement_shortfall_detail,
            enabled: false,
            notice_version: null,
            activation_blocker: 'disabled_for_browser_negative',
          },
        },
      });
      return;
    }
    const noticeVersion = selected === 'superseded_notice' ? '2.2.0' : '9.9.9';
    feature.applyPrivateFeatureConfig({
      ...config,
      features: {
        ...features,
        profile_identity: { ...features.profile_identity, notice_version: noticeVersion },
        settlement_shortfall_detail: {
          ...features.settlement_shortfall_detail,
          notice_version: noticeVersion,
        },
      },
    });
  }, variant);
}

test('Configuración edita nombre/foto y propaga el nombre a reload y otra pestaña', async ({ context, page }) => {
  await ingresar(page);
  const sibling = await context.newPage();
  await sibling.goto('/');
  await expect(sibling.locator('.hdr-user')).toHaveText('Mati');

  await page.getByRole('button', { name: 'Más', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Configuración' })).toBeVisible();
  await page.getByRole('button', { name: 'Editar nombre' }).click();
  await page.getByLabel('Nombre').fill('Renata');
  await page.getByLabel('Apellido').fill('Nueva');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();

  await expect(page.getByText('Nombre actualizado ✓')).toBeVisible();
  await expect(page.locator('.hdr-user')).toHaveText('Renata Nueva');
  await expect(page.locator('.profile-payme-id')).toHaveText('payme_mx_mati');
  await expect(page.locator('.hdr')).not.toContainText('payme_mx_mati');
  await expect(sibling.locator('.hdr-user')).toHaveText('Renata Nueva');

  const phonePhoto = Buffer.concat([
    readFileSync(resolve('landing/img/mesa-comida.jpg')),
    Buffer.alloc(100 * 1024),
  ]);
  expect(phonePhoto.byteLength).toBeGreaterThan(256 * 1024);
  await page.locator('input[type="file"]').setInputFiles({
    name: 'foto-de-telefono.jpg',
    mimeType: 'image/jpeg',
    buffer: phonePhoto,
  });
  const photoToast = page.getByText('Foto actualizada ✓');
  await expect(photoToast).toBeVisible();
  await expect(page.getByRole('img', { name: 'Foto de perfil' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Eliminar foto' })).toBeVisible();
  await expect(photoToast).toBeHidden();
  await page.screenshot({ path: CONFIG_CAPTURE, animations: 'disabled' });

  await page.reload();
  await expect(page.locator('.hdr-user')).toHaveText('Renata Nueva');
  await expect(page.getByRole('button', { name: 'Editar nombre' })).toBeVisible();
  await expect(page.locator('.profile-payme-id')).toHaveText('payme_mx_mati');
});

test('Notificaciones abre sólo el detalle acreditado y presenta el residual legacy literal', async ({ page }) => {
  await ingresar(page);
  await page.getByRole('button', { name: 'Avisos' }).click();
  await expect(page.getByRole('heading', { name: 'Notificaciones' })).toBeVisible();

  const toggle = page.getByRole('button', { name: 'Quién no pagó' });
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(page.getByText('Luis Cárdenas')).toBeVisible();
  await expect(page.getByText('$130.00')).toBeVisible();
  await expect(page.getByText('Sin asignar')).toBeVisible();
  await expect(page.getByText('$80.00')).toBeVisible();

  const guarantee = page.locator('.aviso-row--guarantee');
  await expect(guarantee).not.toContainText(/propina/i);
  await expect(guarantee).not.toContainText(/[0-9a-f]{8}-[0-9a-f-]{27,}/i);
  await page.screenshot({ path: NOTIFICATIONS_CAPTURE, animations: 'disabled' });
});

test('OFF, ausente, malformado, 2.2.0 supersedido y aviso desconocido apagan ambas superficies', async ({ page }) => {
  await ingresar(page);
  await page.getByRole('button', { name: 'Más', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Editar nombre' })).toBeVisible();

  for (const variant of ['off', 'absent', 'malformed', 'superseded_notice', 'unknown_notice'] as const) {
    await applyPrivateVariant(page, variant);
    await expect(page.getByRole('button', { name: 'Editar nombre' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Cambiar foto de perfil' })).toHaveCount(0);
  }

  await page.getByRole('button', { name: 'Avisos' }).click();
  await expect(page.getByRole('heading', { name: 'Notificaciones' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Quién no pagó' })).toHaveCount(0);
  await expect(page.getByText('Se cobró el faltante de la mesa ($210.00) a tu garantía.')).toBeVisible();
});
