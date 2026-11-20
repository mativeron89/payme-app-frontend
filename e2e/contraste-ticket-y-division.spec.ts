import { expect, test, type Locator, type Page } from '@playwright/test';
import { ingresar, irEnLaApp } from './_app';
import { sacarFoto } from './_camara';
import { configurarTicketSinQr } from './fixtures/ticket-sin-qr';

test.beforeEach(async ({ context, baseURL }) => {
  await context.route(/^https?:\/\//, route => new URL(route.request().url()).origin === baseURL
    ? route.continue() : route.abort());
  await context.addInitScript(() => {
    if (location.protocol === 'http:') localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled');
  });
});

async function cargar(page: Page, idioma: 'es' | 'en', correccion: boolean) {
  await configurarTicketSinQr(page, correccion ? { ocr: 'no_merchant' } : {});
  await ingresar(page);
  if (idioma === 'en') {
    await irEnLaApp(page, '/mas');
    await page.getByRole('button', { name: 'EN', exact: true }).click();
    await irEnLaApp(page, '/');
  }
  if (correccion) await page.evaluate(async () => {
    const ruta = '/src/api/index.ts';
    const { api } = await import(/* @vite-ignore */ ruta) as typeof import('../src/api');
    const original = api.scanTicket.bind(api);
    api.scanTicket = async (...args) => ({ ...await original(...args), total_detected_cents: 84001 });
  });
  await page.getByRole('button', { name: /^(Escanear|Scan)$/ }).click();
  await sacarFoto(page, undefined, { usar: false });
  await page.getByRole('button', { name: /^(Usar foto|Use photo)$/ }).click();
}

async function estilo(control: Locator, radio = false) {
  return control.evaluate((el, radio) => {
    const borde = getComputedStyle(el);
    const fondo = radio ? getComputedStyle(el.closest('.div-card')!).backgroundColor : borde.backgroundColor;
    const elementoFoco = radio ? el.closest('.div-card')! : el;
    const foco = getComputedStyle(elementoFoco);
    function alrededor(nodo: Element): string {
      for (let p = nodo.parentElement; p; p = p.parentElement) {
        const color = getComputedStyle(p).backgroundColor;
        if (color.startsWith('rgb(')) return color;
      }
      return fondo;
    }
    const fondoBordeExterior = alrededor(el);
    const punto = getComputedStyle(el, '::after');
    function canales(color: string) {
      const rgb = color.match(/\d+(?:\.\d+)?/g)?.map(Number);
      if (!rgb || (rgb.length !== 3 && rgb.length !== 4) || !color.startsWith('rgb')) {
        throw Error('Color no RGB: ' + color);
      }
      return rgb;
    }
    function luz(rgb: number[]) {
      const lineales = rgb.slice(0, 3).map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return lineales[0] * 0.2126 + lineales[1] * 0.7152 + lineales[2] * 0.0722;
    }
    function contraste(a: string, b: string) {
      const fondo = canales(b);
      const figura = canales(a);
      const alfa = figura[3] ?? 1;
      const compuesta = figura.slice(0, 3).map((v, i) => v * alfa + fondo[i] * (1 - alfa));
      const [x, y] = [luz(compuesta), luz(fondo)].sort((x, y) => y - x);
      return (x + 0.05) / (y + 0.05);
    }
    return {
      borde: borde.borderTopColor, fondo, fondoBordeExterior,
      ratioBorde: Math.min(contraste(borde.borderTopColor, fondo), contraste(borde.borderTopColor, fondoBordeExterior)),
      punto: punto.content === 'none' ? null : punto.backgroundColor,
      ratioPunto: punto.content === 'none' ? null : contraste(punto.backgroundColor, fondo),
      estiloFoco: foco.outlineStyle, anchoFoco: parseFloat(foco.outlineWidth),
      colorFoco: foco.outlineColor, fondoFoco: alrededor(elementoFoco), ratioFoco: contraste(foco.outlineColor, alrededor(elementoFoco)),
    };
  }, radio);
}

for (const [idioma, ancho] of [['es', 320], ['en', 390]] as const) {
  test(`contraste de División (${idioma}, ${ancho} px)`, async ({ page }) => {
    await page.setViewportSize({ width: ancho, height: 812 });
    await cargar(page, idioma, false);
    const grupo = page.getByRole('radiogroup', { name: /^(¿Cómo dividen\?|How are you splitting\?)$/ });
    const radios = grupo.getByRole('radio');
    await expect(radios).toHaveCount(3);
    await expect(radios.nth(0)).toHaveAccessibleName(/Cada uno lo suyo|Everyone their own/);
    await expect(radios.nth(1)).toHaveAccessibleName(/En partes iguales|Split evenly/);
    await expect(radios.nth(2)).toHaveAccessibleName(/Pagar el total|Pay the whole bill/);
    const seleccionada = radios.nth(0);
    const otra = radios.nth(1);
    await expect(seleccionada).toHaveAttribute('aria-checked', 'true');
    await expect(otra).toHaveAttribute('aria-checked', 'false');
    const marca = (r: Locator) => r.locator('.div-radio');
    const reposo = await estilo(marca(otra), true);
    const elegida = await estilo(marca(seleccionada), true);
    const tarjeta = await seleccionada.evaluate(el => {
      const css = getComputedStyle(el);
      return { borde: css.borderColor, fondo: css.backgroundColor };
    });
    const ver = page.getByRole('button', { name: /^(Ver el ticket|View the receipt)$/ });
    await ver.focus();
    await page.keyboard.press('Tab');
    await expect(seleccionada).toBeFocused();
    const teclado = await estilo(marca(seleccionada), true);
    await page.keyboard.press('Tab'); // Ayuda de la primera opción.
    await page.keyboard.press('Tab');
    await expect(otra).toBeFocused();
    await page.keyboard.press('Space');
    await expect(otra).toHaveAttribute('aria-checked', 'true');
    await expect(seleccionada).toHaveAttribute('aria-checked', 'false');
    await page.emulateMedia({ forcedColors: 'active', colorScheme: 'light' });
    const forzados = await estilo(marca(otra), true);
    await page.emulateMedia({ forcedColors: 'active', colorScheme: 'dark' });
    const forzadosOscuros = await estilo(marca(otra), true);
    console.log(JSON.stringify({ caso:'division', idioma, ancho, tarjeta, reposo, elegida, teclado, forzados, forzadosOscuros }));
    expect(reposo.ratioBorde).toBeGreaterThanOrEqual(3);
    expect(elegida.ratioBorde).toBeGreaterThanOrEqual(3);
    expect(elegida.ratioPunto).toBeGreaterThanOrEqual(3);
    expect(teclado.anchoFoco).toBeGreaterThanOrEqual(1);
    expect(teclado.estiloFoco).not.toBe('none');
    expect(teclado.ratioFoco).toBeGreaterThanOrEqual(3);
    for (const variante of [forzados, forzadosOscuros]) {
      expect(variante.ratioPunto).toBeGreaterThanOrEqual(3);
      expect(variante.ratioBorde).toBeGreaterThanOrEqual(3);
    }
  });

  test(`contraste al corregir el ticket (${idioma}, ${ancho} px)`, async ({ page }) => {
    await page.setViewportSize({ width: ancho, height: 812 });
    await cargar(page, idioma, true);
    const hoja = page.getByRole('dialog', { name: /^(Ticket|Receipt) ·/ });
    const continuar = page.getByRole('button', { name: /^(Continuar|Continue)$/ });
    await expect(continuar).toBeDisabled();
    const editarRestaurante = hoja.getByRole('button', { name: /^(Editar el nombre del restaurante|Edit the restaurant name)$/ });
    await editarRestaurante.press('Enter');
    const nombreLocal = hoja.locator('.tk-nombre-input');
    await expect(nombreLocal).toBeFocused();
    await expect(nombreLocal).toHaveAccessibleName(/restaurante|restaurant/i);
    const nombreLocalFoco = await estilo(nombreLocal);
    await page.keyboard.press('Tab');
    const nombreLocalReposo = await estilo(nombreLocal);
    await hoja.getByRole('button', { name: /^(Cancelar|Cancel)$/ }).press('Enter');
    await hoja.getByRole('button', { name: /^(Corregir a mano|Fix it manually)$/ }).press('Enter');
    await hoja.getByRole('button', { name: /^(Modificar|Edit) Tagliatelle Bolognese$/ }).press('Enter');
    const precio = hoja.getByLabel(/^(Precio por unidad|Price per unit)$/);
    const consumo = hoja.getByLabel(/^(Consumo|Item)$/);
    await expect(precio).toBeFocused();
    await expect(precio).toHaveValue('195.00');
    const precioFoco = await estilo(precio);
    await page.keyboard.press('Shift+Tab');
    await expect(consumo).toBeFocused();
    const precioReposo = await estilo(precio);
    const consumoFoco = await estilo(consumo);
    await page.keyboard.press('Tab');
    await expect(precio).toBeFocused();
    const consumoReposo = await estilo(consumo);
    await page.emulateMedia({ forcedColors: 'active', colorScheme: 'light' });
    const forzados = await estilo(precio);
    await page.emulateMedia({ forcedColors: 'active', colorScheme: 'dark' });
    const forzadosOscuros = await estilo(precio);
    console.log(JSON.stringify({ caso:'corrector', idioma, ancho, nombreLocalFoco, nombreLocalReposo, precioFoco, precioReposo, consumoFoco, consumoReposo, forzados, forzadosOscuros }));
    await expect(continuar).toBeDisabled();
    for (const medicion of [nombreLocalReposo, precioReposo, consumoReposo, forzados, forzadosOscuros]) {
      expect(medicion.ratioBorde).toBeGreaterThanOrEqual(3);
    }
    for (const foco of [nombreLocalFoco, precioFoco, consumoFoco, forzados, forzadosOscuros]) {
      expect(foco.estiloFoco).not.toBe('none');
      expect(foco.anchoFoco).toBeGreaterThanOrEqual(1);
      expect(foco.ratioFoco).toBeGreaterThanOrEqual(3);
    }
  });
}
