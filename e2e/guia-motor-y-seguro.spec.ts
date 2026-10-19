import { expect, test } from '@playwright/test';
import { camarasAbiertas } from './_camara';
import {
  abrirDesdeLaTarjeta, abrirUnaMesaReal, botonTutorial, burbuja, capaVisible, createMesaRealSinDatosDelEjemplo, ejemploSePrendio,
  entrar, espiarElEjemplo, espiarLaFachada, fase, hastaCompartir, hastaDividir, hastaElTicket, hastaLaCamara, hastaTuMesa, llamadas,
  pathname, tarjeta, TEXTO_2A, TEXTO_2B, transicionesDelEjemplo,
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
    await espiarElEjemplo(page);
    await abrirDesdeLaTarjeta(page);
    expect(await fase(page)).toBe('foto');
    await botonTutorial(page).click();
    await expect(burbuja(page, TEXTO_2A)).toBeVisible();
    expect(await fase(page)).toBe('foto');
    // Más es del recorrido en la fase de la foto: la fila de Ayuda tampoco reabre.
    await page.getByRole('button', { name: 'Más', exact: true }).click();
    await expect.poll(() => pathname(page)).toBe('/mas');
    // Costura: en Más la 2a va arriba de la barra y, según la disposición del runner, tapa la fila de Ayuda (el CI de
    // main sobre 12de695 lo vio en sus tres intentos: el toque físico no llega). Se dispara el click sobre la fila, que
    // es lo que se prueba: su handler, con la guía abierta, no hace nada. El no-op lo fija también el unitario de
    // abrirLaGuia.
    await page.getByRole('button', { name: 'Cómo usar PayMe' }).dispatchEvent('click');
    await expect(burbuja(page, TEXTO_2A)).toBeVisible();
    expect(await fase(page)).toBe('foto');
    await hastaLaCamara(page);
    expect(await pathname(page)).toBe('/scan');
    expect(await fase(page)).toBe('foto');
    // Un solo arranque y ningún descarte: ni reinició ni se cerró y se volvió a abrir.
    expect(await transicionesDelEjemplo(page)).toEqual({ arranques: 1, descartes: 0 });
  });

  test('irse de la 2a a una mesa real cierra la guía antes de que la mesa pida lo suyo: nada se corta', async ({ page }) => {
    await entrar(page);
    await espiarLaFachada(page);
    await abrirDesdeLaTarjeta(page);
    // Control del espía: con el ejemplo activo, una llamada cortada queda anotada con su rechazo.
    await page.evaluate(async () => {
      const ruta = '/src/api/index.ts';
      const { api } = await import(/* @vite-ignore */ ruta) as { api: { getPaymentMethods: () => Promise<unknown> } };
      await api.getPaymentMethods().catch(() => undefined);
    });
    await expect.poll(async () => (await llamadas(page)).filter((l) => l.metodo === 'getPaymentMethods').map((l) => l.rechazo))
      .toEqual(['PedidoCortadoPorElEjemplo']);
    await page.evaluate(() => { (window as unknown as { __llamadas: unknown[] }).__llamadas = []; });
    await page.locator('button:has(.mesa-go)').first().click();
    await expect.poll(() => pathname(page)).toMatch(/^\/mesa\/PA-\d{4}$/);
    await expect(page.locator('.guia-capa')).toHaveCount(0);
    await expect.poll(async () => (await llamadas(page)).some((l) => l.metodo === 'getPaymentMethods')).toBe(true);
    expect((await llamadas(page)).filter((l) => l.rechazo === 'PedidoCortadoPorElEjemplo')).toEqual([]);
    expect(await fase(page)).toBe('apagado');
  });
});

test.describe('V, 2026-10-19 · la prioridad', () => {
  for (const tamano of [{ width: 390, height: 844 }, { width: 375, height: 667 }]) {
    test(`con una invitación pendiente (${tamano.width} × ${tamano.height}), tocar Tutorial muestra la 2a enseguida, arranca el ejemplo y no tapa la invitación`, async ({ page }) => {
      await page.setViewportSize(tamano);
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
  }

  // Enmienda 10 (V, 19/10): un aviso de privacidad no puede quedar tapado nunca. Midió que la 2a tapaba el aviso
  // «Tu foto entre amigos» (a 390 × 844, también sus botones): mientras está pendiente, la guía no se ofrece.
  for (const { tamano, respuesta } of [
    { tamano: { width: 390, height: 844 }, respuesta: 'Ahora no' },
    { tamano: { width: 375, height: 667 }, respuesta: 'Entendido' },
  ] as const) {
    test(`enmienda 10 · con el aviso «Tu foto entre amigos» pendiente (${tamano.width} × ${tamano.height}) no hay tarjeta y Más → Ayuda espera; con «${respuesta}» vuelven las dos`, async ({ page }) => {
      await page.setViewportSize(tamano);
      await entrar(page, { dejarElAvisoDeFotos: true });
      const aviso = page.getByRole('complementary', { name: 'Actualización del Aviso de Privacidad', exact: true });
      await expect(aviso).toBeVisible();
      // El aviso a la vista es el aviso consultado y pendiente: desde ahí, la tarjeta no está.
      await expect(tarjeta(page)).toHaveCount(0);
      await page.getByRole('button', { name: 'Más', exact: true }).click();
      const fila = page.getByRole('button', { name: 'Cómo usar PayMe' });
      await expect(fila).toBeDisabled();
      await expect(page.getByText('Primero responde el aviso «Tu foto entre amigos» en Inicio.', { exact: true })).toBeVisible();

      await page.getByRole('button', { name: 'Inicio', exact: true }).click();
      await aviso.getByRole('button', { name: respuesta, exact: true }).click();
      await expect(aviso).toHaveCount(0);
      // Control positivo: respondido el aviso, vuelven la fila y la tarjeta, y la 2a aparece.
      await page.getByRole('button', { name: 'Más', exact: true }).click();
      await expect(fila).toBeEnabled();
      await expect(page.getByText('Primero responde el aviso «Tu foto entre amigos» en Inicio.', { exact: true })).toHaveCount(0);
      await page.getByRole('button', { name: 'Inicio', exact: true }).click();
      await abrirDesdeLaTarjeta(page);
      await expect.poll(() => fase(page)).toBe('foto');
      await expect(aviso).toHaveCount(0);
    });
  }

  test('enmienda 10 · lo que lleva data-guia-espera esconde la burbuja mientras se ve (costura: un aside marcado agregado al DOM con la 2a a la vista)', async ({ page }) => {
    await entrar(page);
    await abrirDesdeLaTarjeta(page);
    // E10-2 · sin esperar un cuadro: en el mismo tick en que aparece el aside, la capa ya no se pinta (el CSS); antes, sí.
    const visibilidad = await page.evaluate(() => {
      const capa = document.querySelector<HTMLElement>('.guia-capa[data-activa]')!;
      const burbujaDeLaCapa = capa.querySelector<HTMLElement>('.guia-burbuja')!;
      const antes = getComputedStyle(burbujaDeLaCapa).visibility;
      const a = document.createElement('aside');
      a.id = 'aviso-de-prueba';
      a.setAttribute('data-guia-espera', '');
      a.style.cssText = 'position:fixed;top:0;left:0;width:24px;height:24px;background:#000';
      document.body.append(a);
      return { antes, despues: getComputedStyle(burbujaDeLaCapa).visibility, capa: getComputedStyle(capa).visibility };
    });
    expect(visibilidad).toEqual({ antes: 'visible', despues: 'hidden', capa: 'hidden' });
    await expect(capaVisible(page)).toHaveCount(0);
    await expect(page.locator('.guia-capa:not([data-activa])')).toHaveCount(1);
    // Control: sin el aside, la 2a vuelve; el ejemplo siguió encendido.
    await page.evaluate(() => document.getElementById('aviso-de-prueba')!.remove());
    await expect(burbuja(page, TEXTO_2A)).toBeVisible();
    expect(await fase(page)).toBe('foto');
  });

  test('T5 · un dialog[open] con la 2a a la vista esconde la burbuja; al cerrarse vuelve (costura: un dialog agregado al DOM)', async ({ page }) => {
    await entrar(page);
    await abrirDesdeLaTarjeta(page);
    await page.evaluate(() => {
      const d = document.createElement('dialog');
      d.id = 'dialogo-de-prueba';
      d.textContent = 'Prueba';
      document.body.append(d);
      d.show();
    });
    await expect(capaVisible(page)).toHaveCount(0);
    await expect(page.locator('.guia-capa:not([data-activa])')).toHaveCount(1);
    // Control: cerrado el dialog, la 2a vuelve.
    await page.evaluate(() => (document.getElementById('dialogo-de-prueba') as HTMLDialogElement).close());
    await expect(burbuja(page, TEXTO_2A)).toBeVisible();
    expect(await fase(page)).toBe('foto');
  });

  test('T5 · el aviso real «Tu foto entre amigos» aparece con la guía en curso (desde Más, recién entrada): la 4a no lo tapa y vuelve al responderlo', async ({ page }) => {
    await entrar(page, { dejarElAvisoDeFotos: true });
    const aviso = page.getByRole('complementary', { name: 'Actualización del Aviso de Privacidad', exact: true });
    await expect(aviso).toBeVisible();
    // Entrar directo a Más: Inicio no se monta, el aviso queda sin saber y la fila de Ayuda no se traba.
    await page.goto('/mas');
    const fila = page.getByRole('button', { name: 'Cómo usar PayMe' });
    await expect(fila).toBeEnabled();
    await fila.click();
    await expect(burbuja(page, TEXTO_2A)).toBeVisible();
    await hastaLaCamara(page);
    await hastaElTicket(page);
    await hastaDividir(page);
    await hastaCompartir(page);
    await hastaTuMesa(page);
    await page.locator('.qc-lista .qc-renglon').first().getByRole('button').first().click();
    await page.getByRole('button', { name: 'Listo', exact: true }).click();
    await expect.poll(() => pathname(page)).toBe('/home');
    // Inicio se monta en 4a y recién ahí aparece el aviso: la capa no se pinta y los botones del aviso se tocan.
    await expect(aviso).toBeVisible();
    await expect(capaVisible(page)).toHaveCount(0);
    const m = await page.evaluate(() => {
      const asideDelAviso = document.querySelector('aside[aria-label="Actualización del Aviso de Privacidad"]')!;
      asideDelAviso.scrollIntoView({ block: 'center' });
      return {
        capas: Array.from(document.querySelectorAll<HTMLElement>('.guia-capa')).map((c) => getComputedStyle(c).visibility),
        botones: Array.from(asideDelAviso.querySelectorAll('button')).map((e) => {
          const r = e.getBoundingClientRect();
          const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
          return hit === e || (hit !== null && e.contains(hit));
        }),
      };
    });
    expect(m.capas.every((v) => v === 'hidden'), JSON.stringify(m)).toBe(true);
    expect(m.botones.length).toBeGreaterThan(0);
    expect(m.botones.every(Boolean), JSON.stringify(m)).toBe(true);
    // Control positivo: respondido el aviso, la 4a aparece.
    await aviso.getByRole('button', { name: 'Ahora no', exact: true }).click();
    await expect(aviso).toHaveCount(0);
    await expect(burbuja(page, 'Así queda tu mesa.')).toBeVisible();
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
