import { expect, test, type Page } from '@playwright/test';
import { ingresar, irEnLaApp } from './_app';

const nombres = ['Luna Celeste Ventisca', 'Brisa Marina Luciérnaga'] as const;

async function amigos(page: Page, idioma = 'es', ejemplos: readonly [string, string] = nombres) {
  await ingresar(page, { sinInvitaciones: true });
  if (idioma === 'en') {
    await page.evaluate(() => localStorage.setItem('payme.app.idioma.v1', 'en'));
    await page.reload();
  }
  await page.evaluate(async ([miembro, disponible]) => {
    const ruta = '/src/api/index.ts';
    const { api } = await import(/* @vite-ignore */ ruta) as typeof import('../src/api');
    const amigos = api.getFriends.bind(api);
    const grupo = api.getGroup.bind(api);
    api.getFriends = async () => {
      const { friends } = await amigos();
      return { friends: friends.map(f => f.username === 'juan.lopez' ? { ...f, full_name: disponible }
        : f.username === 'sofi.fernandez' ? { ...f, full_name: miembro } : f) };
    };
    api.getGroup = async id => {
      const result = await grupo(id);
      return { ...result, members: result.members.map(m => m.username === 'sofi.fernandez'
        ? { ...m, first_name: miembro, last_name: '' } : m) };
    };
  }, ejemplos);
  await irEnLaApp(page, '/amigos');
}

async function familia(page: Page) {
  await page.getByRole('tab', { name: /^(Grupos|Groups)$/ }).click();
  await page.getByRole('button', { name: /Familia/ }).click();
}

for (const idioma of ['es', 'en']) {
  for (const width of [320, 360, 375, 390, 430]) {
    test(`Filas legibles a ${width} px en ${idioma}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
      await amigos(page, idioma);
      await page.getByRole('button', { name: /^(Nuevo amigo|New friend)$/ }).click();
      for (const pantalla of ['nuevo', 'grupo']) {
        if (pantalla === 'grupo') await familia(page);
        await expect(page.locator('.friend-row .n', { hasText: nombres[1] })).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        for (const nombre of nombres) {
          const medida = await page.locator('.friend-row .n', { hasText: nombre }).evaluate(el => {
            const fila = el.closest('.friend-row')!.getBoundingClientRect();
            const caja = el.closest('.fr-name')!.getBoundingClientRect();
            const texto = document.createRange();
            texto.selectNodeContents(el);
            const rects = [...texto.getClientRects()];
            return {
              lineas: new Set(rects.map(r => Math.round(r.top))).size,
              ancho: caja.width,
              contenido: rects.every(r => r.left >= caja.left - 1 && r.right <= caja.right + 1
                && r.top >= fila.top && r.bottom <= fila.bottom),
              dentro: fila.left >= 0 && fila.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth,
            };
          });
          await test.info().attach(pantalla + '-' + nombre, { body: JSON.stringify(medida), contentType: 'application/json' });
          expect(medida.lineas).toBeGreaterThan(0);
          expect(medida.lineas).toBeLessThanOrEqual(2);
          expect(medida.contenido).toBe(true);
          expect(medida.dentro).toBe(true);
        }
        await expect(page.locator('.friend-row').getByRole('button')).toHaveCount(0);
        const dir = process.env.PAYME_E2E_CAPTURAS;
        if (dir && (width === 320 || width === 390)) await page.screenshot({ path: `${dir}/${pantalla}-${idioma}-${width}.png` });
      }
    });
  }
}

test('Grupos permite consultar, sumar y quitar sólo tras confirmar', async ({ page }) => {
  await amigos(page);
  await familia(page);
  const miembros = () => page.evaluate(async () => {
    const ruta = '/src/api/index.ts';
    const { api } = await import(/* @vite-ignore */ ruta) as typeof import('../src/api');
    const familia = (await api.getGroups()).groups.find(g => g.name === 'Familia')!;
    return (await api.getGroup(familia.id)).members.map(m => m.id).sort();
  });
  const inicial = await miembros();
  const sumar = page.getByRole('button', { name: 'Sumar a ' + nombres[1] + ' al grupo' });
  const info = page.getByRole('button', { name: 'Información de ' + nombres[1] });
  // Deslizar sobre el botón de sumar tampoco debe activar su toque.
  await sumar.evaluate(el => el.scrollIntoView({ block: 'center' }));
  const caja = (await sumar.boundingBox())!;
  const x = caja.x + caja.width - 24;
  const y = caja.y + caja.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 112, y, { steps: 8 });
  await page.mouse.up();
  await expect(sumar.locator('xpath=ancestor::*[contains(@class, "deslizable-frente")][1]')).toHaveCSS('transform', 'matrix(1, 0, 0, 1, -96, 0)');
  await info.click();
  const hoja = page.getByRole('dialog');
  await expect(hoja.getByText('@juan.lopez', { exact: true })).toBeVisible();
  await hoja.getByRole('button', { name: 'Cerrar' }).click();
  await expect(info).toBeFocused();
  expect(await miembros()).toEqual(inicial);
  await expect(sumar).toHaveCount(1);
  // Con la fila abierta el primer toque sobre el frente la vuelve a cerrar.
  await page.getByText('Agregar del listado de amigos', { exact: true }).click();
  await sumar.tap();
  await expect(sumar).toHaveCount(0);
  const quitar = page.getByRole('button', { name: 'Quitar a Juan López del grupo' });
  const conUnoMas = await miembros();
  expect(conUnoMas).toHaveLength(inicial.length + 1);
  await expect(quitar).toHaveText('Quitar');
  await quitar.focus();
  await page.keyboard.press('Tab');
  const infoMiembro = page.getByRole('button', { name: 'Información de Juan López' });
  await expect(infoMiembro).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(hoja.getByText('@juan.lopez', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(infoMiembro).toBeFocused();
  await expect(quitar).toHaveCount(1);
  await quitar.press('Enter');
  const cancelar = hoja.getByRole('button', { name: 'Cancelar' });
  await expect(cancelar).toBeFocused();
  expect(await miembros()).toEqual(conUnoMas);
  await cancelar.click();
  await expect(quitar).toBeFocused();
  await expect(sumar).toHaveCount(0);
  await quitar.press('Enter');
  await hoja.getByRole('button', { name: 'Quitar', exact: true }).click();
  await expect(sumar).toBeVisible();
  await expect(quitar).toHaveCount(0);
  expect(await miembros()).toEqual(inicial);
});

for (const idioma of ['es', 'en']) {
  test('Grupos muestra el nombre largo completo en su columna · ' + idioma, async ({ page }) => {
    const ejemplos = ['Luna Celeste de la Sierra del Valle de los Pinos', 'BrisaMarinaLuciérnagaDelBosque'] as const;
    await amigos(page, idioma, ejemplos);
    await familia(page);
    for (const width of [320, 360, 375, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate(() => document.fonts.ready);
      for (const nombre of ejemplos) {
        const texto = page.locator('.grupo-deslizable .fr-name .n', { hasText: nombre });
        await expect(texto).toBeVisible();
        expect(await texto.evaluate(el => {
          const caja = el.getBoundingClientRect();
          const rango = document.createRange();
          rango.selectNodeContents(el);
          return [...rango.getClientRects()].every(r => r.left >= caja.left - 1 && r.right <= caja.right + 1
            && r.top >= caja.top - 1 && r.bottom <= caja.bottom + 1);
        })).toBe(true);
      }
    }
  });
}
