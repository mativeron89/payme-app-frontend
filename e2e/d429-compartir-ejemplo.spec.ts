import { expect, test } from '@playwright/test';
import {
  abrirDesdeLaTarjeta, burbuja, contarLaRed, entrar, escrito, espiarLaFachada, fase,
  geometria, hastaCompartir, hastaDividir, hastaElTicket, hastaLaCamara, llamadas,
  SONDAS_DE_RED, sondearLaRed, TEXTO_2D,
} from './_guia';

/** D429 · gestos reales sobre los cinco botones, con oráculos de efectos y red que tienen controles positivos. */
test('D429 · copiar, WhatsApp y los amigos sólo explican en dos tamaños de teléfono', async ({ page, context }) => {
  await entrar(page);
  await espiarLaFachada(page);
  await page.evaluate(() => {
    const efectos: string[] = [];
    Object.assign(window, { __efectosD429: efectos });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async () => { efectos.push('clipboard'); },
    } });
    document.execCommand = () => { efectos.push('execCommand'); return true; };
    window.open = () => { efectos.push('open'); return null; };
  });
  const efectos = () => page.evaluate(() => (window as unknown as { __efectosD429: string[] }).__efectosD429);
  const antes = await escrito(page);
  const red = await contarLaRed(page);
  const paginas = context.pages().length;
  await abrirDesdeLaTarjeta(page);
  await hastaLaCamara(page);
  await hastaElTicket(page);
  await hastaDividir(page);
  await hastaCompartir(page);
  const url = page.url();

  for (const viewport of [{ width: 390, height: 844 }, { width: 375, height: 667 }]) {
    await page.setViewportSize(viewport);
    const amigos = page.getByRole('region', { name: 'Amigos de ejemplo' });
    await expect(amigos.getByRole('button', { name: 'Invitar', exact: true })).toHaveCount(3);
    for (const nombre of ['Lucía Sol', 'Diego Luna', 'Ana Ríos']) await expect(amigos.getByText(nombre, { exact: true })).toBeVisible();
    const acciones = [
      { boton: page.getByRole('button', { name: 'Copiar link', exact: true }), texto: /^En tu mesa, Copiar link/, ancla: 'ejemplo-copiar' },
      { boton: page.getByRole('button', { name: 'WhatsApp', exact: true }), texto: /^En tu mesa, WhatsApp/, ancla: 'ejemplo-whatsapp' },
      ...['amigo-lucia', 'amigo-diego', 'amigo-ana'].map((id) => ({
        boton: page.locator(`[data-guia="ejemplo-${id}"]`), texto: /^En tu mesa, Invitar/, ancla: `ejemplo-${id}`,
      })),
    ];
    for (const [i, accion] of acciones.entries()) {
      // Desplazamiento real antes del toque: también deja libres las filas junto al pie fijo del teléfono chico.
      await accion.boton.evaluate((boton) => boton.scrollIntoView({ block: 'center' }));
      await accion.boton.click();
      const explicacion = burbuja(page, accion.texto);
      await expect(explicacion).toBeVisible();
      await expect(page.locator('.guia-capa[data-activa] [role="dialog"]')).toHaveCount(1);
      await geometria(page, accion.ancla);
      await expect(page).toHaveURL(url);
      expect(context.pages().length).toBe(paginas);
      expect(await efectos()).toEqual([]);
      expect(await fase(page)).toBe('compartir');
      // Sólo dos capturas explícitas para toda la tarea; la config local apaga las automáticas.
      if (i === 2 && process.env.D429_CAPTURAS_DIR) {
        await page.screenshot({ path: `${process.env.D429_CAPTURAS_DIR}/compartir-${viewport.width}.png`, animations: 'disabled' });
      }
      if (i % 2 === 0) await explicacion.getByRole('button', { name: 'Cerrar guía' }).click();
      else await page.keyboard.press('Escape');
      await expect(burbuja(page, TEXTO_2D)).toBeVisible();
    }
  }

  // Teclado y subpaso 2: abrir/cerrar una explicación conserva el punto de la guía.
  await burbuja(page, TEXTO_2D).getByRole('button', { name: 'Siguiente', exact: true }).click();
  const segundo = burbuja(page, 'Toca Continuar para elegir lo tuyo.');
  await expect(segundo).toBeVisible();
  await page.getByRole('button', { name: 'Copiar link', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(burbuja(page, /^En tu mesa, Copiar link/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(segundo).toBeVisible();
  expect(await efectos()).toEqual([]);
  expect((await llamadas(page)).filter((l) => l.clase === 'cortado')).toEqual([]);
  expect((await llamadas(page)).filter((l) => /getFriends|getGroups|getGroup|getFriendAvatar|createInvitation/.test(l.metodo))).toEqual([]);
  await segundo.getByRole('button', { name: 'Cerrar guía' }).click();
  await expect(page).toHaveURL(/\/home$/);
  expect(await fase(page)).toBe('apagado');
  expect(await escrito(page)).toEqual(antes);

  await sondearLaRed(page);
  const pedidos = await red.cerrar();
  expect(pedidos.contados.sort()).toEqual([...SONDAS_DE_RED].sort());
  expect(pedidos.websockets).toEqual([]);
  // Si estos controles no disparan los espías, «cero» arriba no sería evidencia.
  await page.evaluate(async () => {
    await navigator.clipboard.writeText('sonda-d429');
    document.execCommand('copy');
    window.open('about:blank');
  });
  expect(await efectos()).toEqual(['clipboard', 'execCommand', 'open']);
});
