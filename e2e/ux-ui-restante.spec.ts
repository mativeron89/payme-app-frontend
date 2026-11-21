import { cerrarAntesDelFrame } from './_foco';
import { expect, test, type Page } from '@playwright/test';
import { hastaCompartir } from './fixtures/mi-parte-d344';
import { ingresar } from './_app';
import type { Api } from '../src/api';

async function idioma(page: Page, lang: 'en' | 'es') {
  await page.addInitScript((value) => localStorage.setItem('payme.app.idioma.v1', value), lang);
}

async function mesaSemilla(page: Page, lang: 'es' | 'en') {
  // El helper de ingreso espera textos ES. Se cambia el idioma al salir.
  await page.addInitScript(() => localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled'));
  await ingresar(page);
  await idioma(page, lang);
  await page.goto('/#/mesa/PA-2847');
  await page.reload();
  await expect(page.locator('.mesa-selection-title')).toBeVisible();
}

async function captura(page: Page, nombre: string) {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (!dir) return;
  await page.locator('.hdr-user').evaluateAll((els) => els.forEach(el => { el.textContent = 'Demo'; }));
  await page.screenshot({ path: `${dir}/${nombre}.png`, animations: 'disabled' });
}

for (const lang of ['es', 'en'] as const) {
  const en = lang === 'en';
  test(`U3 · Tu parte entra cerrada (${lang})`, async ({ page }) => {
    const code = await hastaCompartir(page, { modo: 'igual', ocr: 'descuento' });
    await idioma(page, lang);
    await page.goto(`/#/mesa/${code}`);
    await page.reload();
    const parte = page.getByRole('button', { name: en ? 'Your share' : 'Tu parte', exact: true });
    await expect(parte).toHaveAttribute('aria-expanded', 'false');
  });

  test(`U4 · del cero al cierre confirmado (${lang})`, async ({ page }) => {
    await mesaSemilla(page, lang);
    const continuar = page.getByRole('button', { name: en ? 'Continue' : 'Continuar', exact: true });
    const comprobando = page.getByText(en ? "Checking the table's status…" : 'Estamos comprobando el estado de la mesa…');
    await expect(comprobando).toHaveCount(0);
    const habilitado = await continuar.isEnabled();
    const venceEn = await page.locator('.mi-count').innerText();
    expect(venceEn.trim()).toMatch(/\d+:\d+|(?:Vence en|Expires in) \d+[ \u00a0](?:h|min)/);
    await page.evaluate(() => {
      const original = Date.now;
      const adelantada = original() + 30 * 24 * 60 * 60 * 1000;
      // Mueve sólo el reloj cliente de presentación. El dueño sigue abierto.
      const RealDate = Date;
      globalThis.Date = new Proxy(RealDate, {
        construct(target, args) { return Reflect.construct(target, args.length ? args : [adelantada]); },
      });
    });
    await expect(comprobando).toBeVisible();
    expect(await continuar.isEnabled()).toBe(habilitado);
    if (!en) await captura(page, 'mesa-comprobando');
    await page.evaluate(async () => {
      const ruta = '/src/api/mock/store.ts';
      const { state } = await import(/* @vite-ignore */ ruta) as typeof import('../src/api/mock/store');
      const mesa = state.mesas.find((fila) => fila.code === 'PA-2847')!;
      mesa.status = 'expired';
      window.dispatchEvent(new Event('focus'));
    });
    await expect(comprobando).toHaveCount(0);
  });

  test(`U5 · seguir, guardar y volver sin aviso (${lang})`, async ({ page }) => {
    await mesaSemilla(page, lang);
    const volver = page.getByRole('button', { name: en ? 'Back' : 'Volver', exact: true });
    const dialogo = page.getByRole('dialog', { name: en ? 'You have unsaved changes' : 'Tienes cambios sin guardar' });
    const consumos = page.locator('.tus-consumos .desplegable-cabecera');
    if (await consumos.getAttribute('aria-expanded') !== 'true') await consumos.click();
    await page.locator('.qc-renglon .qc-libre').first().click();
    await volver.click();
    await expect(dialogo).toBeVisible();
    await expect(dialogo.getByRole('button', { name: en ? 'Keep editing' : 'Seguir editando' })).toBeFocused();
    const peligro = await dialogo.evaluate(el => getComputedStyle(el).getPropertyValue('--danger').trim());
    const descartar = dialogo.getByRole('button', { name: en ? 'Leave without saving' : 'Salir sin guardar' });
    await expect(descartar).toHaveCSS('color', await page.evaluate(color => {
      const muestra = document.createElement('span');
      muestra.style.color = color;
      document.body.append(muestra);
      const resultado = getComputedStyle(muestra).color;
      muestra.remove();
      return resultado;
    }, peligro));
    if (!en) await captura(page, 'mesa-cambios-sin-guardar');
    await dialogo.getByRole('button', { name: en ? 'Keep editing' : 'Seguir editando' }).click();
    await expect(volver).toBeFocused();
    await expect(dialogo).toHaveCount(0);
    await volver.click();
    await cerrarAntesDelFrame(page, dialogo.getByRole('button', { name: en ? 'Keep editing' : 'Seguir editando' }),
      dialogo, page.getByRole('button', { name: en ? 'Continue' : 'Continuar', exact: true }));
    await volver.click();
    await dialogo.getByRole('button', { name: en ? 'Save' : 'Guardar', exact: true }).click();
    await expect(page).toHaveURL(/\/mesas$/);
    await expect(dialogo).toHaveCount(0);
    // D879 vuelve al confirmar. Al reabrir, el ítem debe seguir registrado.
    await page.goto('/#/mesa/PA-2847');
    if (await consumos.getAttribute('aria-expanded') !== 'true') await consumos.click();
    await expect(page.locator('.qc-renglon').first().locator('[data-estado="registrado"]')).toBeVisible();
    await volver.click();
    await expect(page).toHaveURL(/\/mesas$/);
    await expect(dialogo).toHaveCount(0);
  });

  test(`U5 · salir sin guardar descarta el borrador (${lang})`, async ({ page }) => {
    await mesaSemilla(page, lang);
    const consumos = page.locator('.tus-consumos .desplegable-cabecera');
    if (await consumos.getAttribute('aria-expanded') !== 'true') await consumos.click();
    await page.locator('.qc-renglon .qc-libre').first().click();
    await page.getByRole('button', { name: en ? 'Back' : 'Volver', exact: true }).click();
    await page.evaluate(async () => {
      const ruta = '/src/api/index.ts';
      const { api } = await import(/* @vite-ignore */ ruta) as { api: Api };
      const { body } = document;
      body.dataset.preparacionesDeGuardado = '0';
      body.dataset.escriturasDeSeleccion = '0';
      const leer = api.getMesa.bind(api);
      const lock = api.lockItems.bind(api);
      const reemplazar = api.replaceInformativeSelection.bind(api);
      api.getMesa = (...args) => {
        if (args[0] === 'PA-2847' && document.querySelector('[role="dialog"]')) {
          body.dataset.preparacionesDeGuardado = String(Number(body.dataset.preparacionesDeGuardado) + 1);
        }
        return leer(...args);
      };
      api.lockItems = (...args) => {
        body.dataset.escriturasDeSeleccion = String(Number(body.dataset.escriturasDeSeleccion) + 1);
        return lock(...args);
      };
      api.replaceInformativeSelection = (...args) => {
        body.dataset.escriturasDeSeleccion = String(Number(body.dataset.escriturasDeSeleccion) + 1);
        return reemplazar(...args);
      };
    });
    await page.getByRole('button', { name: en ? 'Leave without saving' : 'Salir sin guardar' }).click();
    await expect(page).not.toHaveURL(/mesa\/PA-2847$/);
    await expect(page.locator('body')).toHaveAttribute('data-preparaciones-de-guardado', '0');
    await expect(page.locator('body')).toHaveAttribute('data-escrituras-de-seleccion', '0');
    await page.goto('/#/mesa/PA-2847');
    await expect(page.getByRole('heading', { name: en ? 'Your table' : 'Tu mesa', exact: true })).toBeVisible();
    await expect(page.locator('.qc-renglon').first().locator('.qc-libre')).toBeVisible();
  });

  test(`U7 · la modalidad en la mesa usa el mismo nombre (${lang})`, async ({ page }) => {
    await mesaSemilla(page, lang);
    await expect(page.locator('.mesa-selection-context strong')).toHaveText(en ? 'Everyone their own' : 'cada uno lo suyo');
    if (en) {
      await page.setViewportSize({ width: 375, height: 667 });
      const nombre = 'Tacos El Güero';
      await page.evaluate(async (nombre) => {
        const ruta = '/src/api/mock/store.ts';
        const { findMesa, persist } = await import(/* @vite-ignore */ ruta) as typeof import('../src/api/mock/store');
        const mesa = findMesa('PA-2847');
        if (!mesa) throw new Error('Falta la mesa de ejemplo');
        mesa.restaurant = { ...mesa.restaurant, name: nombre };
        persist();
      }, nombre);
      await page.reload();
      const restaurante = page.locator('.mesa-selection-context-main');
      await expect(restaurante).toHaveText(nombre);
      await expect.poll(() => restaurante.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
    }
  });

  test(`U5 · quitar un plato guardado cuenta como cambio (${lang})`, async ({ page }) => {
    const code = await hastaCompartir(page, { modo: 'igual', ocr: 'descuento' });
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    const continuar = page.getByRole('button', { name: 'Continuar', exact: true });
    const consumos = page.locator('.tus-consumos .desplegable-cabecera');
    await expect(continuar).toBeEnabled();
    if (await consumos.getAttribute('aria-expanded') !== 'true') await consumos.click();
    const plato = page.locator('.qc-renglon').filter({ hasText: 'Tagliatelle Bolognese' });
    await plato.getByRole('button', { name: 'Tagliatelle Bolognese, $195', exact: true }).click();
    await continuar.click();
    await expect(page.locator('.mesa-guardado')).toBeVisible();
    if (en) {
      await idioma(page, lang);
      await page.reload();
    }
    await expect(page.getByRole('button', { name: en ? 'Continue' : 'Continuar', exact: true })).toBeEnabled();
    await expect(page).toHaveURL(new RegExp(`mesa/${code}$`));
    if (await consumos.getAttribute('aria-expanded') !== 'true') await consumos.click();
    await plato.locator('button.qc-circulo--marcado').click();
    await expect(plato.locator('button.qc-circulo--marcado')).toHaveCount(0);
    await page.getByRole('button', { name: en ? 'Back' : 'Volver', exact: true }).click();
    await expect(page.getByRole('dialog', { name: en ? 'You have unsaved changes' : 'Tienes cambios sin guardar' })).toBeVisible();
  });

  test(`U8 · quitar el tutorial devuelve el foco y muestra dónde encontrarlo (${lang})`, async ({ page }) => {
    await ingresar(page, { sinInvitaciones: true, tutorial: 'inicio' });
    if (en) {
      await idioma(page, lang);
      await page.reload();
    }
    const notice = page.getByLabel(en ? 'Privacy Notice update' : 'Actualización del Aviso de Privacidad');
    await notice.getByRole('button', { name: en ? 'Got it' : 'Entendido', exact: true }).click();
    await expect(notice).toHaveCount(0);
    const quitar = page.locator('.tarjeta-tutorial-quitar');
    await quitar.press('Enter');
    await expect(quitar).toHaveCount(0);
    await expect.poll(() => page.locator('.toast--sobre-barra').textContent())
      .toBe(en ? "You'll find it under More › Help" : 'Lo encuentras en Más › Ayuda');
    await expect(page.locator('.appbar-center')).toBeFocused();
    if (!en) await captura(page, 'inicio-tutorial-quitado');
  });
}

for (const lang of ['es', 'en'] as const) {
  test(`U9 · acciones visibles sólo para mesas terminadas y foco al cancelar (${lang})`, async ({ page }) => {
    const en = lang === 'en';
    await page.addInitScript(() => localStorage.setItem('payme.app.mock.mis_mesas.v1', 'sin_cobro'));
    await ingresar(page);
    if (en) {
      await idioma(page, lang);
      await page.reload();
    }
    await page.evaluate(async () => {
      const ruta = '/src/api/index.ts';
      const { api } = await import(/* @vite-ignore */ ruta) as typeof import('../src/api/index');
      const cargar = api.getMyMesas;
      api.getMyMesas = async (...args) => {
        const lista = await cargar(...args);
        const ejemplo = lista.mesas[0];
        if (!ejemplo) throw new Error('Falta la mesa terminada de ejemplo');
        return {
          ...lista, mesas: [...lista.mesas, {
            ...ejemplo, id: 'c221-mesa-abierta', code: 'PA-90210', restaurante: 'Restaurante Ejemplo Activo', status: 'open',
          }],
        };
      };
    });
    await page.goto('/#/mesas');
    const etiqueta = en ? /^More actions for / : /^Más acciones de /;
    const acciones = page.locator('.tu-mesa').getByRole('button', { name: etiqueta });
    const primera = acciones.first();
    await expect(acciones).toHaveCount(3);
    await expect(primera).toBeVisible();
    const size = await primera.boundingBox();
    expect(size?.width).toBeGreaterThanOrEqual(44);
    expect(size?.height).toBeGreaterThanOrEqual(44);
    await expect(page.locator('[data-mesa="PA-90210"]').getByRole('button', { name: etiqueta })).toHaveCount(0);
    await primera.click();
    await expect(primera).toHaveAttribute('aria-expanded', 'true');
    await acciones.nth(1).click();
    await expect(primera).toHaveAttribute('aria-expanded', 'false');
    await primera.click();
    if (!en) await captura(page, 'tus-mesas-acciones');
    await page.locator('.tu-mesa .deslizable--abierta .deslizable-eliminar').click();
    const dialogo = page.getByRole('dialog');
    await expect(dialogo).toBeVisible();
    await dialogo.getByRole('button', { name: en ? 'Close' : 'Cerrar', exact: true }).click();
    await expect(primera).toBeFocused();
  });
}

async function entrarConFalloDeInvitaciones(page: Page) {
  await page.goto('/');
  await page.evaluate(async () => {
    const ruta = '/src/api/index.ts';
    const { api } = await import(/* @vite-ignore */ ruta);
    api.getPendingInvitations = async () => { throw new Error('Falla simulada'); };
  });
  await page.getByLabel('Email', { exact: true }).fill('mati@payme.mx');
  await page.getByLabel('Contraseña', { exact: true }).fill('demo-e2e');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
}

test('U17 · el Aviso de privacidad sigue visible si falla la consulta de invitaciones', async ({ page }) => {
  await entrarConFalloDeInvitaciones(page);
  await expect(page.getByLabel('Actualización del Aviso de Privacidad')).toBeVisible();
  await captura(page, 'inicio-actualizacion-privacidad');
});

test('U17 · el Aviso de privacidad reaparece al volver a Inicio si no se acusó', async ({ page }) => {
  await entrarConFalloDeInvitaciones(page);
  const aviso = page.getByLabel('Actualización del Aviso de Privacidad');
  await expect(aviso).toBeVisible();
  await page.getByRole('button', { name: 'Mesas', exact: true }).click();
  await expect(aviso).toHaveCount(0);
  await page.getByRole('button', { name: 'Inicio', exact: true }).click();
  await expect(aviso).toBeVisible();
});

test('U18 · una cuenta suspendida no recibe el aviso de cuenta lista al canjear', async ({ page }) => {
  await ingresar(page);
  await page.evaluate(async () => {
    const ruta = '/src/api/index.ts';
    const { api } = await import(/* @vite-ignore */ ruta);
    const errores = '/src/api/mock/mockApi.ts';
    const { MockApiError } = await import(/* @vite-ignore */ errores);
    api.acceptInvitationLink = async () => { throw new MockApiError(403, 'user_suspended'); };
  });
  await page.goto('/#/mesa/PA-0001?t=token-de-prueba');
  await expect(page.getByText('Tu cuenta está suspendida. Escríbenos.', { exact: true })).toBeVisible();
  await expect(page.getByText(/Tu cuenta ya está lista/)).toHaveCount(0);
  await captura(page, 'link-cuenta-suspendida');
});
