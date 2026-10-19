import { expect, test } from '@playwright/test';
import { camarasAbiertas } from './_camara';
import {
  abrirDesdeLaTarjeta, abrirUnaMesaReal, botonTutorial, burbuja, capaVisible, createMesaRealSinDatosDelEjemplo, ejemploSePrendio,
  entrar, espiarElEjemplo, espiarLaFachada, fase, hastaElTicket, hastaLaCamara, llamadas, pathname, tarjeta, TEXTO_2A, TEXTO_2B,
} from './_guia';

/**
 * D363 · revisión de V sobre ff5dec7 (a2b729e4…) · el MEDIO y lo que la revisión del diseño agregó.
 *
 * - El ejemplo arranca con la primera burbuja visible, no al abrir: con el motor caído nunca se prende, y Escanear da
 *   el flujo real sin rebotar a Inicio.
 * - El seguro de CreateMesaFlow: si el ejemplo se apaga con su ticket en pantalla, se vuelve a «Escanea el ticket» y
 *   no se pide nada.
 * - La prioridad (V, 2026-10-19): el toque en Tutorial les gana a las invitaciones; una ventana real hace esperar.
 * - Abrir con la guía abierta no hace nada; irse a una mesa real cierra la guía antes de que la mesa pida lo suyo; el
 *   foco va a la burbuja y vuelve.
 *
 * Todo contra el mock. Las costuras van rotuladas como tales en el nombre del test.
 */

const MOTOR = /\/src\/ayuda\/GuiaContenido\.tsx(\?|$)/;
const ESCANEAR = 'Escanear';

test.describe('revisión de V · el ejemplo arranca con la primera burbuja', () => {
  test('🔴 con el motor caído el ejemplo nunca se prende: el aviso, «Cerrar guía», y Escanear da el flujo real sin rebotar', async ({ page }) => {
    let abortos = 0;
    await page.route(MOTOR, (r) => { abortos += 1; return r.abort('failed'); });
    await entrar(page);
    await espiarLaFachada(page);
    await espiarElEjemplo(page);

    await botonTutorial(page).click();
    const aviso = page.locator('.guia-carga');
    await expect(aviso.getByRole('status')).toHaveText('No pudimos abrir la guía. Puedes seguir usando PayMe.');
    expect(abortos).toBeGreaterThan(0);
    await aviso.getByRole('button', { name: 'Cerrar guía', exact: true }).click();
    await expect(aviso).toHaveCount(0);
    await expect(botonTutorial(page)).toBeFocused();

    // Otra vez, y ahora Escanear: el aviso se va solo (la persona se fue de Inicio) y la cámara es la real.
    await botonTutorial(page).click();
    await expect(aviso.getByRole('status')).toHaveText(/No pudimos abrir la guía/);
    await page.getByRole('button', { name: ESCANEAR, exact: true }).click();
    await expect(aviso).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Escanea el ticket' })).toBeVisible();
    expect(await pathname(page)).toBe('/scan');
    await abrirUnaMesaReal(page);

    expect(await ejemploSePrendio(page)).toBe(false);
    await createMesaRealSinDatosDelEjemplo(page);
  });

  test('🔴 el seguro (costura: el ejemplo se descarta a mano con su ticket en pantalla): vuelve a «Escanea el ticket» y no pide nada', async ({ page }) => {
    await entrar(page);
    await espiarLaFachada(page);
    const journal = () => page.evaluate(() => Object.keys(localStorage)
      .filter((k) => k.startsWith('payme_money_journal')).sort().map((k) => [k, localStorage.getItem(k)]));
    const antes = await journal();
    await abrirDesdeLaTarjeta(page);
    await hastaLaCamara(page);
    await hastaElTicket(page);
    await expect(page.locator('.ticket-title-amount')).toHaveText('$600');

    await page.evaluate(async () => {
      const ruta = '/src/ayuda/ejemplo/estadoEjemplo.ts';
      const { ejemploLocal } = await import(/* @vite-ignore */ ruta) as { ejemploLocal: { descartar: () => void } };
      ejemploLocal.descartar();
    });
    await expect(page.getByRole('heading', { name: 'Escanea el ticket' })).toBeVisible();
    expect(await pathname(page)).toBe('/scan');
    await expect(page.getByText('Restaurante Ejemplo', { exact: true })).toHaveCount(0);
    await expect(page.locator('.ticket-title-amount')).toHaveCount(0);
    await expect(page.locator('.guia-capa')).toHaveCount(0);
    const prohibidos = ['resolveRestaurant', 'createMesa', 'createInvitation', 'getPaymentMethods', 'scanTicket'];
    expect((await llamadas(page)).filter((l) => prohibidos.includes(l.metodo))).toEqual([]);
    expect(await journal()).toEqual(antes);

    // Control positivo, en el mismo caso: el botón redondo vuelve a abrir la cámara y una foto real abre una mesa real.
    await page.getByRole('button', { name: 'Sacar foto', exact: true }).click();
    await abrirUnaMesaReal(page);
    await createMesaRealSinDatosDelEjemplo(page);
  });

  test('tocar Tutorial otra vez, o Más → Ayuda, con la guía abierta no la reinicia ni la deja a medias', async ({ page }) => {
    await entrar(page);
    await abrirDesdeLaTarjeta(page);
    expect(await fase(page)).toBe('foto');
    await botonTutorial(page).click();
    await expect(burbuja(page, TEXTO_2A)).toBeVisible();
    expect(await fase(page)).toBe('foto');
    // Más es del recorrido en la fase de la foto: la fila de Ayuda tampoco reabre.
    await page.getByRole('button', { name: 'Más', exact: true }).click();
    await expect.poll(() => pathname(page)).toBe('/mas');
    await page.getByRole('button', { name: 'Cómo usar PayMe' }).click();
    await expect(burbuja(page, TEXTO_2A)).toBeVisible();
    expect(await fase(page)).toBe('foto');
    await hastaLaCamara(page);
    expect(await pathname(page)).toBe('/scan');
    expect(await fase(page)).toBe('foto');
  });

  test('irse de la 2a a una mesa real cierra la guía antes de que la mesa pida lo suyo: nada se corta', async ({ page }) => {
    await entrar(page);
    await espiarLaFachada(page);
    await abrirDesdeLaTarjeta(page);
    await page.locator('button:has(.mesa-go)').first().click();
    await expect.poll(() => pathname(page)).toMatch(/^\/mesa\/PA-\d{4}$/);
    await expect(page.locator('.guia-capa')).toHaveCount(0);
    await expect.poll(async () => (await llamadas(page)).some((l) => l.metodo === 'getPaymentMethods')).toBe(true);
    expect((await llamadas(page)).filter((l) => l.rechazo === 'PedidoCortadoPorElEjemplo')).toEqual([]);
    expect(await fase(page)).toBe('apagado');
  });
});

test.describe('V, 2026-10-19 · la prioridad', () => {
  test('con una invitación pendiente, tocar Tutorial muestra la 2a enseguida, arranca el ejemplo y no tapa la invitación', async ({ page }) => {
    await entrar(page, { conservarInvitacion: true });
    const invitacion = page.getByRole('region', { name: 'Te invitaron', exact: true });
    await expect(invitacion).toBeVisible();
    await abrirDesdeLaTarjeta(page);
    await expect.poll(() => fase(page)).toBe('foto');
    await expect(invitacion).toBeVisible();
    const cajas = await page.evaluate(() => {
      const b = document.querySelector('.guia-capa[data-activa] .guia-burbuja')!.getBoundingClientRect();
      const i = document.querySelector('section[aria-label="Te invitaron"]')!.getBoundingClientRect();
      return { b: b.toJSON(), i: i.toJSON() };
    });
    const seTocan = !(cajas.b.bottom <= cajas.i.top || cajas.b.top >= cajas.i.bottom
      || cajas.b.right <= cajas.i.left || cajas.b.left >= cajas.i.right);
    expect(seTocan, JSON.stringify(cajas)).toBe(false);
  });

  test('una ventana que tapa la pantalla hace esperar a la guía (costura: un diálogo aria-modal agregado al DOM); al irse, aparece la 2a y arranca el ejemplo', async ({ page }) => {
    await entrar(page);
    await page.evaluate(() => {
      const d = document.createElement('div');
      d.id = 'ventana-de-prueba';
      d.setAttribute('role', 'dialog');
      d.setAttribute('aria-modal', 'true');
      d.setAttribute('aria-label', 'Ventana de prueba');
      d.style.cssText = 'position:fixed;top:0;left:0;width:24px;height:24px;background:#000';
      document.body.append(d);
    });
    await botonTutorial(page).click();
    // El motor está montado (la capa existe) y espera: sin burbuja a la vista y con el ejemplo apagado.
    await expect(page.locator('.guia-capa:not([data-activa])')).toHaveCount(1);
    await expect(capaVisible(page)).toHaveCount(0);
    expect(await fase(page)).toBe('apagado');
    // Control positivo: sin la ventana, aparece la 2a y el ejemplo arranca.
    await page.evaluate(() => document.getElementById('ventana-de-prueba')!.remove());
    await expect(burbuja(page, TEXTO_2A)).toBeVisible();
    await expect.poll(() => fase(page)).toBe('foto');
  });
});

test.describe('revisión de V · el foco', () => {
  test('va a la 2a y vuelve a Tutorial con «otro momento» y con Escape; la guía no abre la cámara sola; aria-describedby vuelve', async ({ page }) => {
    await entrar(page);
    const ancla = page.locator('[data-guia="camara"]');
    const describedAntes = await ancla.getAttribute('aria-describedby');
    const camaras = camarasAbiertas(page);
    const a2 = await abrirDesdeLaTarjeta(page);
    await expect(a2).toBeFocused();
    const id = await a2.getAttribute('aria-labelledby');
    expect(id).toBeTruthy();
    await expect(ancla).toHaveAttribute('aria-describedby', new RegExp(`(^| )${id!.replace(/[:]/g, '\\$&')}$`));
    expect(camarasAbiertas(page)).toBe(camaras);

    await a2.getByRole('button', { name: 'Realizar el tutorial en otro momento', exact: true }).click();
    await expect(capaVisible(page)).toHaveCount(0);
    await expect(botonTutorial(page)).toBeFocused();
    expect(await ancla.getAttribute('aria-describedby')).toBe(describedAntes);
    expect(await fase(page)).toBe('apagado');

    await abrirDesdeLaTarjeta(page);
    await page.keyboard.press('Escape');
    await expect(capaVisible(page)).toHaveCount(0);
    await expect(botonTutorial(page)).toBeFocused();
  });

  test('salir desde 2b vuelve a Inicio con el foco en Tutorial; desde Más, Escape lo devuelve a «Cómo usar PayMe»', async ({ page }) => {
    await entrar(page);
    await abrirDesdeLaTarjeta(page);
    await hastaLaCamara(page);
    await burbuja(page, TEXTO_2B).getByRole('button', { name: 'Cerrar guía', exact: true }).click();
    await expect.poll(() => pathname(page)).toBe('/home');
    await expect(tarjeta(page)).toBeVisible();
    await expect(botonTutorial(page)).toBeFocused();
    expect(await fase(page)).toBe('apagado');

    await page.getByRole('button', { name: 'Más', exact: true }).click();
    const fila = page.getByRole('button', { name: 'Cómo usar PayMe' });
    await fila.click();
    await expect(burbuja(page, TEXTO_2A)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(capaVisible(page)).toHaveCount(0);
    expect(await pathname(page)).toBe('/mas');
    await expect(fila).toBeFocused();
  });
});
