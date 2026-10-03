import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';
import { REGION_COUNTRIES, zoneLabel, type CountryCode } from '../src/preferences/regionCatalog';

/** D158/D165 · mock sintético. Preparado estáticamente, NOT_RUN hasta D163. */
const KEY = 'payme.app.region.v1';
const panel = (page: Page) => page.getByRole('dialog', { name: 'Ubicación', exact: true });
const apply = (page: Page) => panel(page).getByRole('button', { name: 'Aplicar', exact: true });
const reset = (page: Page) => panel(page).getByRole('button', { name: 'Restablecer país y zona', exact: true });
const countryRow = (page: Page) => panel(page).getByRole('button', { name: /^País / });
const zoneRow = (page: Page) => panel(page).getByRole('button', { name: /^Huso horario / });
const zoneOption = (page: Page, zone: string) => panel(page).locator('button[data-region-zone="' + zone + '"]');
const stored = (page: Page) => page.evaluate((key) => localStorage.getItem(key), KEY);

async function abrir(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Ubicación', exact: true }).click();
  await expect(panel(page)).toBeVisible();
}
async function preparar(page: Page, options: {
  raw?: string; failure?: 'get' | 'set' | 'silent-set' | 'remove' | 'silent-remove';
} = {}): Promise<void> {
  await page.addInitScript(({ key, op }) => {
    localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled');
    if (op.raw !== undefined) localStorage.setItem(key, op.raw);
    const get = Storage.prototype.getItem, set = Storage.prototype.setItem, remove = Storage.prototype.removeItem;
    Storage.prototype.getItem = function (name: string) {
      if (name === key && op.failure === 'get') throw new DOMException('synthetic read', 'SecurityError');
      return get.call(this, name);
    };
    Storage.prototype.setItem = function (name: string, value: string) {
      if (name === key && op.failure === 'set') throw new DOMException('synthetic quota', 'QuotaExceededError');
      if (name === key && op.failure === 'silent-set') return;
      set.call(this, name, value);
    };
    Storage.prototype.removeItem = function (name: string) {
      if (name === key && op.failure === 'remove') throw new DOMException('synthetic reset', 'SecurityError');
      if (name === key && op.failure === 'silent-remove') return;
      remove.call(this, name);
    };
  }, { key: KEY, op: options });
  await ingresar(page); await page.goto('/#/mas'); await abrir(page);
}
async function seleccionarPais(page: Page, code: CountryCode): Promise<void> {
  await countryRow(page).click();
  const label = REGION_COUNTRIES.find((c) => c.code === code)!.label;
  await panel(page).getByRole('group', { name: 'País', exact: true })
    .getByRole('button', { name: label, exact: true }).click();
}
async function elegir(page: Page, code: CountryCode, zone?: string): Promise<void> {
  await seleccionarPais(page, code);
  if (zone) {
    if (!(await zoneOption(page, zone).isVisible())) await zoneRow(page).click();
    await zoneOption(page, zone).click();
  }
  await apply(page).click(); await expect(panel(page)).toBeHidden();
}

test.describe('D158/D165 · Ubicación y fechas personales locales', () => {
  test('fila debajoIdioma y panel inicial con ayuda compacta de navegador compartido', async ({ page }) => {
    await preparar(page);
    await expect(countryRow(page)).toContainText('México');
    await expect(zoneRow(page)).toContainText('Ciudad de México');
    await expect(panel(page)).toContainText('Cambia sólo cómo ves fechas y horas.');
    await panel(page).getByText('Sólo en este navegador', { exact: true }).click();
    await expect(panel(page)).toContainText('7 países y 62 zonas');
    await expect(panel(page)).toContainText('otra persona heredará esta selección');
    await expect(panel(page)).toContainText('No detectamos tu ubicación');
    expect(await stored(page)).toBeNull();
    expect(await page.locator('.region-settings-trigger').evaluate((row) =>
      row.previousElementSibling?.textContent?.includes('Idioma'))).toBe(true);
  });

  test('multizona exige elegir ciudad exacta, teclado aplica y check desaparece1,6s', async ({ page }) => {
    await preparar(page); await seleccionarPais(page, 'US');
    await expect(apply(page)).toBeDisabled();
    await expect(panel(page)).toContainText('elige una antes de aplicar');
    await expect(panel(page).locator('[data-region-zone]')).toHaveCount(29);
    await zoneOption(page, 'America/Phoenix').click();
    await apply(page).focus(); await page.keyboard.press('Enter');
    expect(JSON.parse((await stored(page))!)).toEqual({ country: 'US', timeZone: 'America/Phoenix' });
    await expect(page.locator('.region-settings-confirmation')).toBeVisible();
    await expect(page.locator('.region-settings-confirmation')).toBeHidden({ timeout: 2500 });
    await abrir(page); await expect(zoneRow(page)).toContainText('Phoenix');
  });

  test('7países/62ciudades individuales contrastadas con Intl REAL, no simulación Juárez/Coyhaique', async ({ page }) => {
    await preparar(page);
    for (const country of REGION_COUNTRIES) {
      await countryRow(page).click();
      const group = panel(page).getByRole('group', { name: 'País', exact: true });
      await expect(group.getByRole('button')).toHaveCount(7);
      await group.getByRole('button', { name: country.label, exact: true }).click();
      if (!(await panel(page).locator('[data-region-zone]').count())) await zoneRow(page).click();
      await expect(panel(page).locator('[data-region-zone]')).toHaveCount(country.zones.length);
      for (const zone of country.zones) {
        const supported = await page.evaluate((z) => {
          try { new Intl.DateTimeFormat('es', { timeZone: z }).format(0); return true; } catch { return false; }
        }, zone);
        const option = zoneOption(page, zone);
        await expect(option).toContainText(zoneLabel(zone));
        if (supported) await expect(option).toBeEnabled();
        else { await expect(option).toBeDisabled(); await expect(option).toContainText('No compatible'); }
      }
      await panel(page).getByRole('button', { name: 'Volver a Ubicación', exact: true }).click();
    }
    expect(await stored(page)).toBeNull();
  });

  test('CO/PE autoseleccionan; Argentina conserva12 IANA individuales', async ({ page }) => {
    await preparar(page); await seleccionarPais(page, 'CO');
    await expect(zoneRow(page)).toContainText('Bogotá'); await apply(page).click();
    expect(await stored(page)).toBe('{"country":"CO","timeZone":"America/Bogota"}');
    await abrir(page); await elegir(page, 'PE');
    expect(JSON.parse((await stored(page))!)).toEqual({ country: 'PE', timeZone: 'America/Lima' });
    await abrir(page); await seleccionarPais(page, 'AR');
    await expect(apply(page)).toBeDisabled(); await expect(panel(page).locator('[data-region-zone]')).toHaveCount(12);
    await zoneOption(page, 'America/Argentina/Ushuaia').click(); await apply(page).click();
    expect(JSON.parse((await stored(page))!)).toEqual({ country: 'AR', timeZone: 'America/Argentina/Ushuaia' });
  });

  for (const method of ['button', 'Escape', 'veil'] as const) {
    test('cancelar con ' + method + ' descarta borrador y restaura foco/scroll', async ({ page }) => {
      await preparar(page); await seleccionarPais(page, 'US'); await zoneOption(page, 'America/New_York').click();
      if (method === 'button') await panel(page).getByRole('button', { name: 'Cerrar Ubicación', exact: true }).click();
      else if (method === 'Escape') await page.keyboard.press('Escape');
      else await panel(page).click({ position: { x: 4, y: 4 } });
      await expect(panel(page)).toBeHidden(); expect(await stored(page)).toBeNull();
      await expect(page.getByRole('button', { name: 'Ubicación', exact: true })).toBeFocused();
      expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
      await abrir(page); await expect(zoneRow(page)).toContainText('Ciudad de México');
    });
  }

  test('modal conserva foco dentro; volver no escribe ni inventa selección', async ({ page }) => {
    await preparar(page); await expect(countryRow(page)).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    expect(await panel(page).evaluate((el) => el.contains(document.activeElement))).toBe(true);
    await seleccionarPais(page, 'US');
    await panel(page).getByRole('button', { name: 'Volver a Ubicación', exact: true }).click();
    await expect(apply(page)).toBeDisabled(); expect(await stored(page)).toBeNull();
  });

  test('reload conserva ciudad exacta; reset sóloOWN no afecta sesión ni otras claves', async ({ page }) => {
    await preparar(page); await page.evaluate(() => localStorage.setItem('synthetic.region.unrelated', 'retain'));
    await elegir(page, 'ES', 'Atlantic/Canary'); await page.reload(); await abrir(page);
    await expect(countryRow(page)).toContainText('España'); await expect(zoneRow(page)).toContainText('Islas Canarias');
    await reset(page).click(); await expect(zoneRow(page)).toContainText('Ciudad de México');
    expect(await stored(page)).toBeNull();
    expect(await page.evaluate(() => localStorage.getItem('synthetic.region.unrelated'))).toBe('retain');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Cerrar sesión', exact: true })).toBeVisible();
  });

  test('corrupto mantiene bytes anteriores y explica default', async ({ page }) => {
    await preparar(page, { raw: '{synthetic-corrupt' });
    await expect(zoneRow(page)).toContainText('Ciudad de México');
    await expect(panel(page)).toContainText('sin borrar el dato anterior');
    expect(await stored(page)).toBe('{synthetic-corrupt');
  });

  test('cancelar edición de un valor guardado conserva susbytes y ciudad exacta', async ({ page }) => {
    const raw = '{"country":"CO","timeZone":"America/Bogota"}';
    await preparar(page, { raw }); await seleccionarPais(page, 'US');
    await zoneOption(page, 'America/Phoenix').click(); await page.keyboard.press('Escape');
    expect(await stored(page)).toBe(raw); await abrir(page); await expect(zoneRow(page)).toContainText('Bogotá');
  });

  test('fallback sintético sóloMX no se guarda como MX/UTC ni simula catálogo enproducto', async ({ page }) => {
    // Oráculo negativo aislado; el caso Intl62 anterior NO usa este override.
    await page.addInitScript(() => {
      Intl.DateTimeFormat = new Proxy(Intl.DateTimeFormat, {
        construct(target, args, newTarget) {
          if (args[1]?.timeZone === 'America/Mexico_City') throw new RangeError('synthetic MX unsupported');
          return Reflect.construct(target, args, newTarget);
        },
      });
    });
    await preparar(page);
    await expect(panel(page)).toContainText('Fallback UTC'); await expect(apply(page)).toBeDisabled();
    await zoneRow(page).click(); await expect(zoneOption(page, 'America/Mexico_City')).toBeDisabled();
    expect(await stored(page)).toBeNull();
    await zoneOption(page, 'America/Cancun').click(); await apply(page).click();
    expect(JSON.parse((await stored(page))!)).toEqual({ country: 'MX', timeZone: 'America/Cancun' });
  });

  for (const failure of ['get', 'set', 'silent-set'] as const) {
    test('storage ' + failure + ': temporal visible tras cierre, sincheck ni falsoGuardado', async ({ page }) => {
      await preparar(page, { failure }); await elegir(page, 'CO');
      await expect(page.locator('.region-settings-warning')).toContainText('no se pudo confirmar el guardado');
      await expect(page.locator('.region-settings-confirmation')).toHaveCount(0);
      await abrir(page); await expect(zoneRow(page)).toContainText('Bogotá');
      await expect(panel(page)).not.toContainText('Guardado sólo en este navegador.');
      await page.reload(); await abrir(page); await expect(zoneRow(page)).toContainText('Ciudad de México');
    });
  }
  for (const failure of ['remove', 'silent-remove'] as const) {
    test('reset ' + failure + ': avisa que puedevolver el valoranterior', async ({ page }) => {
      const raw = '{"country":"CO","timeZone":"America/Bogota"}';
      await preparar(page, { raw, failure }); await reset(page).click();
      await expect(zoneRow(page)).toContainText('Ciudad de México');
      await expect(panel(page)).toContainText('no pudimos confirmar el borrado');
      expect(await stored(page)).toBe(raw);
    });
  }

  test('mismo instante cambia fecha/hora de visita, no importes/período compartido', async ({ page }) => {
    await preparar(page); await page.keyboard.press('Escape');
    // La costura vive en el módulo del documento actual: navegar por la UI
    // conserva ese módulo. Un goto a otra pathname recarga y pierde el parche.
    const irARestaurantes = async () => {
      await page.getByRole('navigation', { name: 'Navegación principal' })
        .getByRole('button', { name: 'Inicio', exact: true }).click();
      await page.getByRole('tab', { name: 'Estadísticas', exact: true }).click();
      await page.getByRole('button', { name: 'Ver mis estadísticas', exact: true }).click();
      await page.getByRole('button', { name: /^Tus restaurantes/ }).click();
      await expect(page).toHaveURL(/\/restaurantes$/);
    };
    await page.evaluate(async () => {
      const route = '/src/api/index.ts';
      const { api } = await import(/* @vite-ignore */ route) as typeof import('../src/api');
      const original = api.getStatsRestaurants.bind(api);
      api.getStatsRestaurants = async (period) => {
        const result = await original(period);
        if (!result.restaurants.find((r) => r.name === 'Hanzo Sushi')?.visits[0]) {
          throw new Error('D165: falta la visita testigo de Hanzo Sushi');
        }
        return { ...result, restaurants: result.restaurants.map((r) => ({ ...r,
          visits: r.visits.map((visit, i) => r.name === 'Hanzo Sushi' && i === 0 ? { ...visit, createdAt: '2026-01-01T04:30:00Z' } : visit),
        })) };
      };
    });
    await irARestaurantes();
    const card = page.getByRole('region', { name: 'Hanzo Sushi', exact: true });
    await card.getByRole('button').first().click();
    await expect(card.locator('.rest-visita').first()).toContainText('Mié 31/12');
    await expect(card.locator('.rest-visita').first()).toContainText('22:30');
    const shared = await page.locator('.stat-burbuja').textContent();
    await page.getByRole('navigation', { name: 'Navegación principal' })
      .getByRole('button', { name: 'Más', exact: true }).click();
    await abrir(page); await elegir(page, 'ES', 'Europe/Madrid');
    await irARestaurantes(); await card.getByRole('button').first().click();
    await expect(card.locator('.rest-visita').first()).toContainText('Jue 01/01');
    await expect(card.locator('.rest-visita').first()).toContainText('05:30');
    await expect(page.locator('.stat-burbuja')).toHaveText(shared!);
    await expect(page.getByText('Fechas mostradas en Europe/Madrid; no indican la zona original.', { exact: true })).toBeVisible();
  });

  test('otra sesiónmock hereda selección; inglés no cambia país/clave/payload', async ({ page }) => {
    await preparar(page); await elegir(page, 'CO');
    await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
    await page.getByLabel('Email', { exact: true }).fill('synthetic-second@example.invalid');
    await page.getByLabel('Contraseña', { exact: true }).fill('synthetic-password');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
    await page.goto('/#/mas'); await abrir(page); await expect(countryRow(page)).toContainText('Colombia');
    await page.keyboard.press('Escape'); await page.evaluate(() => localStorage.setItem('payme.app.idioma.v1', 'en'));
    await page.reload(); await page.getByRole('button', { name: 'Location', exact: true }).click();
    const english = page.getByRole('dialog', { name: 'Location', exact: true });
    await english.getByRole('button', { name: /^Country / }).click();
    await english.getByRole('button', { name: 'Peru', exact: true }).click();
    await english.getByRole('button', { name: 'Apply', exact: true }).click();
    expect(JSON.parse((await stored(page))!)).toEqual({ country: 'PE', timeZone: 'America/Lima' });
    expect(await page.evaluate(() => localStorage.getItem('payme.app.idioma.v1'))).toBe('en');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });

  for (const width of [320, 375, 390, 430]) {
    test('panel' + width + 'px: sin overflow, targets44/48 y reducedmotion', async ({ page }) => {
      await page.setViewportSize({ width, height: 720 }); await page.emulateMedia({ reducedMotion: 'reduce' });
      await preparar(page); await seleccionarPais(page, 'US');
      expect(await panel(page).locator('.region-settings-sheet').evaluate((el) => {
        const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 64;
      })).toBe(true);
      expect(await panel(page).locator('button').evaluateAll((buttons) =>
        buttons.every((b) => b.getBoundingClientRect().height >= 44))).toBe(true);
      expect((await apply(page).boundingBox())!.height).toBeGreaterThanOrEqual(48);
      await zoneOption(page, 'Pacific/Honolulu').scrollIntoViewIfNeeded();
      await zoneOption(page, 'Pacific/Honolulu').click(); await apply(page).click();
      await expect(page.locator('.region-settings-confirmation')).toHaveCSS('animation-name', 'none');
    });
  }

  test('ruta pública no lee/escribe/borra clave nueva', async ({ page }) => {
    await page.addInitScript((key) => {
      const calls: string[] = [], get = Storage.prototype.getItem, set = Storage.prototype.setItem, remove = Storage.prototype.removeItem;
      Storage.prototype.getItem = function (n) { if (n === key) calls.push('get'); return get.call(this, n); };
      Storage.prototype.setItem = function (n, v) { if (n === key) calls.push('set'); set.call(this, n, v); };
      Storage.prototype.removeItem = function (n) { if (n === key) calls.push('remove'); remove.call(this, n); };
      (window as unknown as { regionStorageCalls: string[] }).regionStorageCalls = calls;
    }, KEY);
    await page.goto('/privacy'); await expect(page.getByRole('heading').first()).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { regionStorageCalls: string[] }).regionStorageCalls)).toEqual([]);
  });
});
