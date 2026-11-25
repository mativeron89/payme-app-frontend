import { expect, test, type Locator, type Page } from '@playwright/test';
import { ingresar, irEnLaApp } from './_app';

const nombres = ['Brisa Marina Luciérnaga', 'Luna Celeste Ventisca'] as const;
const usuarios = ['brisa.luz', 'luna.celeste'] as const;

async function preparar(page: Page, idioma: 'en' | 'es', ejemplos: readonly [string, string] = nombres) {
  await ingresar(page, { sinInvitaciones: true });
  if (idioma === 'en') {
    await page.evaluate(() => localStorage.setItem('payme.app.idioma.v1', 'en'));
    await page.reload();
  }
  await page.evaluate(async ({ nombres, usuarios }) => {
    const ruta = '/src/api/index.ts';
    const { api } = await import(/* @vite-ignore */ ruta) as typeof import('../src/api');
    const amigos = (await api.getFriends()).friends.slice(0, 2).map((f, i) => ({
      ...f, first_name: nombres[i]!.split(' ')[0]!, last_name: nombres[i]!.split(' ').slice(1).join(' '),
      full_name: nombres[i]!, username: usuarios[i]!,
    }));
    api.getFriends = async () => ({ friends: amigos });
    api.getBlockedUsers = async () => ({ blocked: amigos.map(f => ({ ...f, blocked_at: '2026-01-01' })) });
    const grupo = api.getGroup.bind(api);
    api.getGroup = async id => ({ ...(await grupo(id)), members: amigos });
    const invitar = api.inviteFriend.bind(api);
    api.inviteFriend = (...args) => {
      sessionStorage.setItem('prueba.invitaciones', '1');
      return invitar(...args);
    };
  }, { nombres: ejemplos, usuarios });
}

async function medir(page: Page, filas: Locator, pantalla: string, idioma: string, ejemplos: readonly [string, string] = nombres) {
  for (const width of [320, 360, 375, 390, 430]) {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
    await page.evaluate(() => document.fonts.ready);
    for (const nombre of ejemplos) {
      const fila = filas.filter({ hasText: nombre });
      await expect(fila).not.toContainText('@');
      const medida = await fila.locator('.fr-name .n').evaluate(el => {
        const rango = document.createRange();
        rango.selectNodeContents(el);
        const rects = [...rango.getClientRects()];
        const caja = el.closest('.fr-name')!.getBoundingClientRect();
        const frente = el.closest('.deslizable-frente')!;
        const boton = frente.querySelector('button')!.getBoundingClientRect();
        return {
          ancho: caja.width,
          lineas: new Set(rects.map(r => Math.round(r.top))).size,
          dentro: rects.every(r => r.left >= caja.left - 1 && r.right <= caja.right + 1),
          solape: rects.some(r => r.left < boton.right && r.right > boton.left && r.top < boton.bottom && r.bottom > boton.top),
          pagina: document.documentElement.scrollWidth,
        };
      });
      expect(medida.lineas).toBeGreaterThan(0);
      if (ejemplos === nombres) expect(medida.lineas).toBeLessThanOrEqual(2);
      expect(medida.dentro).toBe(true);
      expect(medida.solape).toBe(false);
      expect(medida.pagina).toBeLessThanOrEqual(width);
      await test.info().attach(pantalla + '-' + idioma + '-' + width + '-' + nombre,
        { body: JSON.stringify(medida), contentType: 'application/json' });
    }
    const dir = process.env.PAYME_E2E_CAPTURAS;
    if (dir && (width === 320 || width === 390)) {
      await filas.first().evaluate(el => el.scrollIntoView({ block: 'center' }));
      await page.screenshot({ path: `${dir}/${pantalla}-${idioma}-${width}.png` });
    }
  }
}

async function consultar(page: Page, teclado: boolean) {
  const nombre = nombres[0];
  const fila = page.locator('.persona-deslizable').filter({ hasText: nombre });
  const info = fila.getByRole('button', { name: /Información de |Information about / });
  if (teclado) {
    await fila.locator('.deslizable-frente button').focus();
    await page.keyboard.press('Tab');
    await expect(info).toBeFocused();
    await page.keyboard.press('Enter');
  } else {
    await fila.evaluate(el => el.scrollIntoView({ block: 'center' }));
    const rect = (await fila.boundingBox())!;
    const x = rect.x + rect.width - 24;
    const y = rect.y + rect.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x - 115, y, { steps: 8 });
    await page.mouse.up();
    await info.click();
  }
  const hoja = page.getByRole('dialog', { name: new RegExp(nombre) });
  await expect(hoja.getByText('@' + usuarios[0], { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(hoja).toHaveCount(0);
  await expect(info).toBeFocused();
}

for (const idioma of ['es', 'en'] as const) {
  test('Invitar amigos y miembros del grupo reservan el @ para Información · ' + idioma, async ({ page }) => {
    await preparar(page, idioma);
    await irEnLaApp(page, '/mesa/PA-2847');
    await page.getByRole('button', { name: /^(Configuración de la mesa|Table settings)$/ }).click();
    await page.getByRole('button', { name: /Invitar amigos de PayMe|Invite PayMe friends/ }).click();
    const filas = page.locator('.inv-row');
    await medir(page, filas, 'invitar-amigos', idioma);
    await consultar(page, false);
    await page.getByRole('tab', { name: /^(Grupos|Groups)$/ }).click();
    const familia = page.getByRole('button', { name: /Familia/ });
    await familia.click();
    await medir(page, filas, 'invitar-grupo', idioma);
    await consultar(page, true);
    expect(await page.evaluate(() => sessionStorage.getItem('prueba.invitaciones'))).toBeNull();
    // Tocar fuera de la fila la cierra. El botón de invitar conserva su envío individual.
    await page.locator('.invitar-busqueda input').focus();
    const invitar = filas.filter({ hasText: nombres[0] }).getByRole('button', { name: /^(Invitar|Invite)$/ });
    await invitar.click();
    expect(await page.evaluate(() => sessionStorage.getItem('prueba.invitaciones'))).toBe('1');
  });

  test('Bloqueados reserva el @ para Información y conserva la confirmación · ' + idioma, async ({ page }) => {
    await preparar(page, idioma);
    await irEnLaApp(page, '/mas');
    await page.getByRole('button', { name: /^(Bloqueados|Blocked people)$/ }).click();
    const filas = page.locator('li').filter({ has: page.getByRole('button', { name: /Desbloquear|Unblock/ }) });
    await medir(page, filas, 'bloqueados', idioma);
    let confirmaciones = 0;
    page.on('dialog', async dialog => {
      confirmaciones++;
      expect(dialog.type()).toBe('confirm');
      await dialog.dismiss();
    });
    await consultar(page, false);
    expect(confirmaciones).toBe(0);
    await page.getByRole('heading').click();
    await filas.filter({ hasText: nombres[0] }).getByRole('button', { name: /Desbloquear|Unblock/ }).click();
    expect(confirmaciones).toBe(1);
    await expect(filas).toHaveCount(2);
  });
}

for (const idioma of ['es', 'en'] as const) {
  test('Los nombres largos caben junto a Invitar y Desbloquear · ' + idioma, async ({ page }) => {
    const ejemplos = ['Luna Celeste de la Sierra del Valle de los Pinos', 'BrisaMarinaLuciérnagaDelBosque'] as const;
    await preparar(page, idioma, ejemplos);
    await irEnLaApp(page, '/mesa/PA-2847');
    await page.getByRole('button', { name: /^(Configuración de la mesa|Table settings)$/ }).click();
    await page.getByRole('button', { name: /Invitar amigos de PayMe|Invite PayMe friends/ }).click();
    await medir(page, page.locator('.inv-row'), 'invitar', idioma, ejemplos);
    await irEnLaApp(page, '/mas');
    await page.getByRole('button', { name: /^(Bloqueados|Blocked people)$/ }).click();
    await medir(page, page.locator('.bloqueado-fila'), 'bloqueados', idioma, ejemplos);
  });
}
