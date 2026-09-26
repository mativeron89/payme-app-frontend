import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';

/**
 * AF2 · ORDEN MAESTRA LEGAL-3.0.0-20260925 · decisiones 40-47 de Mati.
 * El riel mock replica al dueño con el paquete APAGADO por defecto; la bandera
 * `payme.app.mock.legal_3_0_0.v1 = 'on'` lo enciende. Así se miden los DOS
 * estados que el front tiene que tolerar: el de hoy y el del día de publicación.
 */
const FLAG = 'payme.app.mock.legal_3_0_0.v1';
const HASH_MOCK_AVISO = '5847ec0aff8247258d0763bc75ac6cd82ea553ae78b0ff06128ab43927085bd5';

async function conPaquete(page: Page, encendido: boolean, altaPublica = true): Promise<void> {
  await page.addInitScript(([flag, on, alta]) => {
    if (on === 'on') localStorage.setItem(flag, 'on'); else localStorage.removeItem(flag);
    localStorage.setItem('payme.app.mock.public_signup.v1', alta);
  }, [FLAG, encendido ? 'on' : 'off', altaPublica ? 'true' : 'false'] as const);
}

async function capturarRegistro(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const route = '/src/api/index.ts';
    const module = await import(/* @vite-ignore */ route) as { api: Record<string, (...a: unknown[]) => Promise<unknown>> };
    const original = module.api.register.bind(module.api);
    module.api.register = async (...args: unknown[]) => {
      localStorage.setItem('payme.app.e2e.legal.register', JSON.stringify(args[0]));
      return original(...args);
    };
  });
}

async function irAlAlta(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Crea tu cuenta', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Registrarme', exact: true })).toBeVisible();
  await page.getByLabel('Nombre', { exact: true }).fill('Mati');
  await page.getByLabel('Apellido', { exact: true }).fill('Verón');
  await page.getByLabel('Email', { exact: true }).fill('legal-3@payme.mx');
  await page.getByLabel('Contraseña', { exact: true }).fill('paquete-legal-1');
}

test.describe('alta con correo', () => {
  test('paquete APAGADO (hoy): el alta de siempre, sin casillas y con el aviso completo', async ({ page }) => {
    await conPaquete(page, false);
    await irAlAlta(page);
    await expect(page.getByLabel('Aviso de privacidad')).toBeVisible();
    await expect(page.getByLabel('Aviso de Privacidad Simplificado')).toHaveCount(0);
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Registrarme', exact: true })).toBeEnabled();
  });

  test('paquete ENCENDIDO: dos casillas sin marcar, simplificado en vez del completo, y el alta viaja con legal_acceptance', async ({ page }) => {
    await conPaquete(page, true);
    await irAlAlta(page);
    await capturarRegistro(page);
    const mayor = page.getByRole('checkbox', { name: 'Declaro que tengo 18 años o más.' });
    const terminos = page.getByRole('checkbox', { name: /He leído y acepto los/ });
    await expect(mayor).not.toBeChecked();
    await expect(terminos).not.toBeChecked();
    await expect(page.getByRole('link', { name: 'Términos de Uso' })).toHaveAttribute('href', '/terminos');
    await expect(page.getByRole('link', { name: 'Aviso de Privacidad', exact: true })).toHaveAttribute('href', '/privacy');
    await expect(page.getByLabel('Aviso de Privacidad Simplificado')).toContainText('AVISO SIMPLIFICADO DE DEMOSTRACIÓN');
    await expect(page.getByLabel('Aviso de privacidad', { exact: true })).toHaveCount(0);
    const registrarme = page.getByRole('button', { name: 'Registrarme', exact: true });
    await expect(registrarme).toBeDisabled();
    await mayor.check();
    await expect(registrarme).toBeDisabled();
    await terminos.check();
    await expect(registrarme).toBeEnabled();
    await registrarme.click();
    await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
    const cuerpo = await page.evaluate(() => JSON.parse(localStorage.getItem('payme.app.e2e.legal.register') ?? 'null')) as Record<string, unknown>;
    expect(cuerpo.legal_acceptance).toEqual({
      aviso_version: '2.5.5', aviso_hash: HASH_MOCK_AVISO,
      terminos_version: '1.0.0', terminos_hash: 'd'.repeat(64),
      adult_declaration: true,
    });
  });
});

/**
 * AF-NOTA-ALTA · observación 3 de R-AF. «Al entrar aceptas el Aviso» sobra en el
 * alta con casillas: ahí se acepta marcándolas. Se mide la nota por su texto
 * exacto y, en el caso que la saca, junto con las casillas que la reemplazan:
 * una ausencia sin el testigo de al lado pasaría también con la pantalla vacía.
 */
test.describe('nota «Al entrar aceptas el Aviso»', () => {
  const nota = (page: Page) => page.locator('p.ingreso-legal', { hasText: 'Al entrar aceptas el' });

  test('paquete ENCENDIDO, «Crea tu cuenta»: con las casillas, sin la nota', async ({ page }) => {
    await conPaquete(page, true);
    await irAlAlta(page);
    await expect(page.getByRole('checkbox', { name: 'Declaro que tengo 18 años o más.' })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: /He leído y acepto los/ })).toBeVisible();
    await expect(nota(page)).toHaveCount(0);
  });

  test('paquete ENCENDIDO, «entrar»: la nota sigue como hoy, y sin casillas (decisión 73)', async ({ page }) => {
    await conPaquete(page, true);
    // AF-LOGIN-D73 · las casillas ya no están en «Entrar», así que dejaron de
    // servir de testigo de carga. En su lugar, observación SOSTENIDA desde antes
    // de cargar: la nota no puede desaparecer mientras llega el paquete (el mock
    // publica `google_continue` y el paquete se pide igual en «Entrar»). Sin esto,
    // ocultarla también acá sobrevivía (medido en AF-NOTA-ALTA).
    await page.addInitScript(() => {
      const w = window as unknown as { __notaSeFue: number; __notaVista: boolean };
      w.__notaSeFue = 0; w.__notaVista = false;
      new MutationObserver(() => {
        const hay = [...document.querySelectorAll('p.ingreso-legal')].some((p) => (p.textContent ?? '').includes('Al entrar aceptas el'));
        if (hay) w.__notaVista = true; else if (w.__notaVista) w.__notaSeFue += 1;
      }).observe(document, { subtree: true, childList: true, characterData: true });
    });
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
    await expect(nota(page)).toBeVisible();
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => (window as unknown as { __notaSeFue: number }).__notaSeFue),
      'la nota se fue de «entrar» cuando llegó el paquete').toBe(0);
    await expect(page.getByRole('checkbox'), 'decisión 73: en «Entrar» no hay casillas').toHaveCount(0);
    await expect(nota(page)).toBeVisible();
    await expect(nota(page).getByRole('link', { name: 'Aviso de privacidad', exact: true })).toHaveAttribute('href', '/privacy');
  });

  test('paquete APAGADO: la nota sigue en «entrar» y en «Crea tu cuenta»', async ({ page }) => {
    await conPaquete(page, false);
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
    await expect(nota(page)).toBeVisible();
    await irAlAlta(page);
    // Testigo: el aviso completo se dibuja cuando la carga resolvió «sin paquete».
    await expect(page.getByLabel('Aviso de privacidad', { exact: true })).toBeVisible();
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    await expect(nota(page)).toBeVisible();
  });
});

test.describe('puerta para quien ya tiene cuenta', () => {
  test('paquete APAGADO: no hay puerta', async ({ page }) => {
    await conPaquete(page, false);
    await ingresar(page);
    await expect(page.getByText('Actualizamos nuestros documentos')).toHaveCount(0);
  });

  test('paquete ENCENDIDO: la puerta bloquea, exige las dos casillas, acepta y no vuelve al recargar', async ({ page }) => {
    await conPaquete(page, true);
    await page.goto('/');
    await page.getByLabel('Email', { exact: true }).fill('mati@payme.mx');
    await page.getByLabel('Contraseña', { exact: true }).fill('demo-e2e');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    const puerta = page.getByRole('dialog', { name: 'Actualizamos nuestros documentos' });
    await expect(puerta).toBeVisible();
    await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toHaveCount(0);
    const continuar = puerta.getByRole('button', { name: 'Continuar', exact: true });
    await expect(continuar).toBeDisabled();
    await puerta.getByRole('checkbox', { name: 'Declaro que tengo 18 años o más.' }).check();
    await expect(continuar).toBeDisabled();
    await puerta.getByRole('checkbox', { name: /He leído y acepto los/ }).check();
    await expect(continuar).toBeEnabled();
    await continuar.click();
    await expect(puerta).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
    // Decisión 45: aceptar el paquete registró también el «Entendido» de fotos.
    await expect(page.getByLabel('Actualización del Aviso de Privacidad')).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
    await expect(page.getByText('Actualizamos nuestros documentos')).toHaveCount(0);
  });

  test('paquete ENCENDIDO: «Cerrar sesión» sale sin aceptar', async ({ page }) => {
    await conPaquete(page, true);
    await page.goto('/');
    await page.getByLabel('Email', { exact: true }).fill('mati@payme.mx');
    await page.getByLabel('Contraseña', { exact: true }).fill('demo-e2e');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    const puerta = page.getByRole('dialog', { name: 'Actualizamos nuestros documentos' });
    await expect(puerta).toBeVisible();
    await puerta.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
    await expect(puerta).toHaveCount(0);
  });
});

test.describe('Configuración › Notificaciones (E1/E2)', () => {
  test('la fila lleva a la pantalla; un interruptor se guarda por fila y sobrevive la recarga', async ({ page }) => {
    await ingresar(page);
    await page.goto('/#/mas');
    await page.getByRole('button', { name: /^Notificaciones/ }).click();
    await expect(page).toHaveURL(/:\d+\/notificaciones$/);
    await expect(page.getByRole('heading', { name: 'Notificaciones', exact: true })).toBeVisible();
    // Decisión 75: la leyenda «Elige qué avisos…» (que era lo único que mostraba el
    // correo) ya no está; el testigo positivo de que la pantalla cargó es la lista.
    await expect(page.getByText('Siempre por correo').first()).toBeVisible();
    await expect(page.getByText(/Elige qué avisos/)).toHaveCount(0);
    // Decisión 78: sin el grupo «Pagos» mientras los pagos estén apagados.
    await expect(page.getByRole('region', { name: 'Pagos' })).toHaveCount(0);
    await expect(page.getByText('Disponible cuando haya pagos')).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Mesas' })).toBeVisible();
    await expect(page.getByText('Disponible con el próximo Aviso')).toBeVisible();
    await expect(page.getByText(/WhatsApp|SMS/)).toHaveCount(0);
    const invitacion = page.getByRole('switch', { name: 'Correo: Te invitan a una mesa' });
    await expect(invitacion).toBeChecked();
    await invitacion.click();
    await expect(invitacion).not.toBeChecked();
    await page.reload();
    await expect(page.getByRole('switch', { name: 'Correo: Te invitan a una mesa' })).not.toBeChecked();
    await expect(page.getByRole('switch', { name: 'Correo: Una mesa tuya se cierra' })).toBeChecked();
    // «Siempre por correo» explica, no apaga.
    await page.getByText('Siempre por correo').first().click();
    await expect(page.getByRole('status').filter({ hasText: 'no se puede apagar' })).toBeVisible();
  });
});
