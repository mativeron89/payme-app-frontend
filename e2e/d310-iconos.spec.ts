import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ingresar, irEnLaApp, relojFueraDeLasFechasDeLosViajes } from './_app';

const KEY = 'payme.app.icons.v1';
async function configuracion(page: Page) {
  await relojFueraDeLasFechasDeLosViajes(page);
  await ingresar(page);
  await page.getByRole('navigation', { name: 'Navegación principal' }).getByRole('button', { name: 'Más', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Configuración', exact: true })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}
async function captura(page: Page, info: TestInfo, name: string) {
  if (!process.env.AF_CAPTURES_DIR) return;
  mkdirSync(process.env.AF_CAPTURES_DIR, { recursive: true });
  const path = join(process.env.AF_CAPTURES_DIR, name + '.png');
  await page.screenshot({ path, animations: 'disabled' });
  await info.attach(name, { path, contentType: 'image/png' });
}
const trigger = (page: Page) => page.getByRole('button', { name: /^Íconos (Grandes|Medianos|Chicos)$/ });
const sheet = (page: Page) => page.getByRole('dialog', { name: 'Íconos', exact: true });
async function stored(page: Page) { return page.evaluate((key) => localStorage.getItem(key), KEY); }

test('D310 · preview independiente, Escape/cerrar, Aplicar y recarga sin requests nuevos', async ({ page }) => {
  await configuracion(page);
  await expect(trigger(page)).toHaveText('ÍconosMedianos');
  expect(await stored(page)).toBeNull();
  const nav = page.locator('.screen .appbar .icon-scalable--footer').first();
  await expect(nav).toHaveCSS('width', '24px');
  const requests: string[] = [];
  page.on('request', (request) => { if (/\/api\//.test(request.url())) requests.push(request.url()); });
  const before = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
  await trigger(page).click();
  await sheet(page).getByRole('radio', { name: /^Grandes/ }).check();
  await expect(sheet(page).locator('.icon-preview .icon-scalable--footer').first()).toHaveCSS('width', '28px');
  await expect(nav).toHaveCSS('width', '24px');
  expect(await stored(page)).toBeNull();
  await page.keyboard.press('Escape');
  await expect(sheet(page)).toHaveCount(0);
  await expect(trigger(page)).toBeFocused();
  await trigger(page).click();
  await expect(sheet(page).getByRole('radio', { name: /^Medianos/ })).toBeChecked();
  await sheet(page).getByRole('radio', { name: /^Chicos/ }).check();
  await sheet(page).getByRole('button', { name: 'Cerrar íconos' }).click();
  expect(await stored(page)).toBeNull();
  await trigger(page).click();
  await sheet(page).getByRole('radio', { name: /^Grandes/ }).check();
  await sheet(page).getByRole('button', { name: 'Aplicar', exact: true }).click();
  await expect(nav).toHaveCSS('width', '28px');
  expect(await stored(page)).toBe('grandes');
  const after = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
  delete after[KEY];
  expect(after).toEqual(before);
  expect(requests).toEqual([]);
  await page.reload();
  await expect(trigger(page)).toHaveText('ÍconosGrandes');
  await expect(nav).toHaveCSS('width', '28px');
});

test('D310 · valor corrupto y storage bloqueado son honestos y no borran la preferencia', async ({ page }) => {
  await page.addInitScript((key) => {
    localStorage.setItem(key, 'valor inválido');
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === key) throw new DOMException('Blocked', 'QuotaExceededError');
      return original.call(this, k, v);
    };
  }, KEY);
  await configuracion(page);
  await expect(page.getByRole('status').filter({ hasText: 'El tamaño guardado no es válido.' })).toBeVisible();
  await expect(trigger(page)).toHaveText('ÍconosMedianos');
  expect(await stored(page)).toBe('valor inválido');
  await trigger(page).click();
  await sheet(page).getByRole('radio', { name: /^Chicos/ }).check();
  await sheet(page).getByRole('button', { name: 'Aplicar', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'El tamaño se aplica temporalmente.' })).toBeVisible();
  await expect(page.locator('.screen .appbar .icon-scalable--footer').first()).toHaveCSS('width', '20px');
  expect(await stored(page)).toBe('valor inválido');
  await page.reload();
  await expect(trigger(page)).toHaveText('ÍconosMedianos');
});

test('D310 · lectura de storage bloqueada deja la hoja utilizable', async ({ page }) => {
  await page.addInitScript((key) => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = function (k) {
      if (k === key) throw new DOMException('Blocked', 'SecurityError');
      return original.call(this, k);
    };
  }, KEY);
  await configuracion(page);
  await expect(page.getByRole('status').filter({ hasText: 'No pudimos leer la preferencia local.' })).toBeVisible();
  await trigger(page).click();
  await sheet(page).getByRole('radio', { name: /^Grandes/ }).check();
  await sheet(page).getByRole('button', { name: 'Aplicar', exact: true }).click();
  await expect(trigger(page)).toHaveText('ÍconosGrandes');
  await expect(page.getByRole('status').filter({ hasText: 'El tamaño se aplica temporalmente.' })).toBeVisible();
});

for (const viewport of [{ width: 320, height: 568, inset: 0 }, { width: 375, height: 667, inset: 0 }, { width: 393, height: 852, inset: 34 }]) {
  test(`D310 · matriz, texto y hitboxes/exclusiones a ${viewport.width}, inset ${viewport.inset}`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    if (viewport.inset) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 59, topMax: 59, bottom: 34, bottomMax: 34, left: 0, leftMax: 0, right: 0, rightMax: 0 } });
    }
    await configuracion(page);
    const measure = () => page.locator('.screen').evaluate((screen) => {
      const dimensions = (selector: string) => {
        const el = screen.querySelector(selector)!;
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return [r.width, r.height, s.fontSize, s.strokeWidth];
      };
      return {
        footer: dimensions('.appbar .icon-scalable--footer'), titleBox: dimensions('.title-card-cuadro'),
        titleGlyph: dimensions('.title-card-cuadro svg'), bell: dimensions('.hdr-bell svg'), config: dimensions('.icon-settings-trigger > svg'),
        fixed: ['.hdr-back svg', '.hdr-symbol', '.appbar-fab', '.region-settings-trigger > svg:last-child'].map(dimensions),
        fonts: ['.title-card-title', '.appbar-label', '.icon-settings-label'].map((selector) => getComputedStyle(screen.querySelector(selector)!).fontSize),
        hitboxes: Array.from(screen.querySelectorAll('.appbar button, .hdr-bell, .hdr-back, .icon-settings-trigger')).map((el) => { const r = el.getBoundingClientRect(); return [r.width, r.height]; }),
        horizontal: screen.scrollWidth - screen.clientWidth,
      };
    });
    const baseline = await measure();
    for (const [name, value, footer, box, title, bell, config, stroke] of [
      ['Grandes', 'grandes', 28, 56, 26, 26, 22, '1.5px'], ['Chicos', 'chicos', 20, 40, 18, 18, 16, '2px'], ['Medianos', 'medianos', 24, 48, 22, 22, 18, '1.7px'],
    ] as const) {
      await trigger(page).click();
      await sheet(page).getByRole('radio', { name: new RegExp('^' + name) }).check();
      const radio = sheet(page).getByRole('radio', { name: new RegExp('^' + name) });
      await expect(radio).toHaveCSS('width', '22px');
      await expect(sheet(page).locator('.icon-preview .title-card-cuadro')).toHaveCSS('width', box + 'px');
      await expect(sheet(page).locator('.icon-preview .icon-preview-list-box')).toHaveCSS('width', (box - 8) + 'px');
      const close = sheet(page).getByRole('button', { name: 'Cerrar íconos' });
      expect((await close.boundingBox())!.width).toBe(44);
      const apply = sheet(page).getByRole('button', { name: 'Aplicar', exact: true });
      await apply.scrollIntoViewIfNeeded();
      const a = (await apply.boundingBox())!;
      expect(a.height).toBeGreaterThanOrEqual(44);
      expect(a.y + a.height).toBeLessThanOrEqual(viewport.height - viewport.inset);
      await captura(page, info, `iconos-preview-${value}-${viewport.width}`);
      await apply.click();
      const actual = await measure();
      expect(actual.footer[0]).toBe(footer); expect(actual.titleBox[0]).toBe(box);
      expect(actual.titleGlyph[0]).toBe(title); expect(actual.titleGlyph[3]).toBe(stroke);
      expect(actual.bell[0]).toBe(bell); expect(actual.config[0]).toBe(config);
      // Sólo medidas geométricas de excluidos y medidas tipográficas de textos.
      expect(actual.fixed).toEqual(baseline.fixed);
      expect(actual.fonts).toEqual(baseline.fonts);
      expect(actual.hitboxes).toEqual(baseline.hitboxes);
      expect(actual.horizontal).toBe(0);
      await captura(page, info, `iconos-aplicados-${value}-${viewport.width}`);
    }
  });
}

for (const photo of [false, true]) {
  test(`D310 · inicial del viaje escala y foto/inline/chevrons se conservan, foto ${photo}`, async ({ page }, info) => {
    await page.addInitScript(() => localStorage.setItem('payme.app.mock.viajes.v1', 'encendido'));
    await configuracion(page);
    if (photo) await page.evaluate(async () => {
      const source = '/src/api/index.ts';
      const { api } = await import(/* @vite-ignore */ source) as { api: {
        getViaje: (...args: unknown[]) => Promise<{ has_photo: boolean }>;
        getFotoDeViaje: (...args: unknown[]) => Promise<{ blob: Blob }>;
      } };
      const original = api.getViaje.bind(api);
      api.getViaje = async (...args) => ({ ...await original(...args), has_photo: true });
      api.getFotoDeViaje = async () => ({ blob: new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="#1D4ED8"/></svg>'], { type: 'image/svg+xml' }) });
    });
    const path = '/viaje/d1000000-0000-4000-8000-000000000001';
    for (const [size, box, font] of [['Grandes', 56, 26], ['Chicos', 40, 18]] as const) {
      await irEnLaApp(page, '/mas');
      await trigger(page).click();
      await sheet(page).getByRole('radio', { name: new RegExp('^' + size) }).check();
      await sheet(page).getByRole('button', { name: 'Aplicar', exact: true }).click();
      await irEnLaApp(page, path);
      await expect(page.getByRole('heading', { name: 'Cancún 2026', exact: true })).toBeVisible();
      const badge = page.locator('.screen .vj-cuadro');
      if (photo) {
        await expect(badge.locator('img')).toBeVisible();
        await expect(badge).toHaveCSS('width', '48px');
      } else {
        await expect(badge).toHaveText('C');
        await expect(badge).toHaveCSS('width', box + 'px');
        await expect(badge).toHaveCSS('font-size', font + 'px');
      }
      await expect(page.locator('.vjv-aviso-cargar .aviso-sin-mesas-camara svg')).toHaveCSS('width', '20px');
      await expect(page.locator('.vjv-ver-balance .vjv-chev')).toHaveCSS('width', '18px');
      await expect(page.getByRole('button', { name: 'Carga manual', exact: true }).locator('svg')).toHaveCSS('width', size === 'Grandes' ? '22px' : '16px');
      await captura(page, info, `iconos-viaje-${size}-foto-${photo}`);
      await irEnLaApp(page, '/');
      // El fixture actual muestra el restaurante pendiente dentro del viaje;
      // «Unirme con código» no está en Inicio. Se mide el control que existe.
      const pending = page.getByRole('button', { name: 'Mariscos El Faro, falta 1 por elegir', exact: true });
      await expect(pending).toBeVisible();
      expect((await pending.boundingBox())!.height).toBe(60);
      await expect(pending.locator('.viaje-pendiente-ico')).toHaveCSS('width', (box - 8) + 'px');
      // Campana con el badge de los avisos actuales del mock (sin cambiar su API).
      const unread = page.locator('.hdr-badge');
      await expect(unread).toBeVisible();
      const notice = await page.locator('.hdr-bell').evaluate((bell) => {
        const b = bell.getBoundingClientRect();
        const badge = bell.querySelector('.hdr-badge')!.getBoundingClientRect();
        return { width: b.width, height: b.height, right: badge.right, text: bell.getAttribute('aria-label') };
      });
      expect(notice.width).toBe(44); expect(notice.height).toBe(44);
      expect(notice.right).toBeLessThanOrEqual(390);
      expect(notice.text).toMatch(/sin leer/);
      await captura(page, info, `iconos-inicio-${size}-foto-${photo}`);
    }
  });
}
