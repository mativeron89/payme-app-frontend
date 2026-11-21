import { expect, test } from '@playwright/test';
import { hastaCompartir, pedidosDePropina, selectorDePropina } from './fixtures/mi-parte-d344';

const textos = {
  es: { mesa: 'Tu mesa', continuar: /^(Continuar|Listo)$/, reloj: /^\s*Vence en \d+[ \u00a0]h[ \u00a0]\d+[ \u00a0]min$/, aviso: 'Listo, quedó guardado', soltar: /^Soltar / },
  en: { mesa: 'Your table', continuar: /^(Continue|Done)$/, reloj: /^\s*Expires in \d+[ \u00a0]h[ \u00a0]\d+[ \u00a0]min$/, aviso: "Done, it's saved", soltar: /^Release / },
};

const restauranteLargo = "Taquería Los Compadres de la Colonia Roma";

for (const width of [320, 340, 360, 375, 390, 414]) {
  for (const height of [548, 553, 568, 600, 601, 667]) {
    for (const idioma of ['es', 'en'] as const) {
      for (const platos of [1, 6]) {
        const variantes = ['normal'];
        if (width <= 340 && platos === 6 && [548, 601].includes(height)) variantes.push('nombre de dos renglones');
        if (width <= 340 && platos === 6 && height === 548) variantes.push('cabecera de invitado');
        for (const variante of variantes) {
          const nombreLargo = variante === 'nombre de dos renglones';
          const invitado = variante === 'cabecera de invitado';
          test(`N0 · barrido ${width}×${height} ${idioma} ${platos === 1 ? '1 plato' : '6 platos'}${variante === 'normal' ? '' : ` · ${variante}`}`, async ({ page }, info) => {
            if (invitado) {
              // La ruta ya no monta invitados. Activa sólo su cabecera de
              // producción para medir el espacio, con una sesión mock.
              await page.route('**/src/screens/MesaScreen.tsx', async route => {
                const response = await route.fetch();
                const js = await response.text();
                const condicion = 'const guestHeader = isGuest &&';
                expect(js).toContain(condicion);
                await route.fulfill({ response, body: js.replace(condicion, 'const guestHeader = true &&') });
              });
            }
            await page.emulateMedia({ reducedMotion: 'reduce' });
            const code = await hastaCompartir(page, { ocr: 'descuento', modo: 'consumo' });
            await selectorDePropina(page).getByRole('button', { name: '10%', exact: true }).click();
            await expect.poll(() => pedidosDePropina(page)).toBe(1);
            await expect(selectorDePropina(page).getByRole('status')).toHaveCount(0);
            await page.getByRole('button', { name: 'Continuar', exact: true }).click();
            await expect(page.getByRole('heading', { name: 'Tu mesa', exact: true })).toBeVisible();
            if (idioma === 'en') {
              await page.evaluate(() => localStorage.setItem('payme.app.idioma.v1', 'en'));
              await page.reload();
            }

            if (nombreLargo) {
              await page.evaluate(async ({ code, nombre }) => {
                const ruta = '/src/api/mock/store.ts';
                const { findMesa, persist } = await import(/* @vite-ignore */ ruta) as typeof import('../src/api/mock/store');
                const mesa = findMesa(code);
                if (!mesa) throw new Error('Falta la mesa de prueba');
                mesa.restaurant.name = nombre;
                persist();
              }, { code, nombre: restauranteLargo });
              await page.reload();
            }
            await page.setViewportSize({ width, height });
            const texto = textos[idioma];
            await expect(page).toHaveURL(new RegExp(`/mesa/${code}$`));
            await expect(page.getByRole('heading', { name: texto.mesa, exact: true })).toBeVisible();
            if (invitado) {
              await expect(page.getByText(idioma === 'es' ? 'Te invitaron a' : "You've been invited to", { exact: true })).toBeVisible();
            }
            const filas = page.locator('.qc-renglon');
            const aviso = page.locator('.mesa-guardado');
            const lista = page.locator('.mesa-selection-scroll');
            const consumos = page.locator('.tus-consumos .desplegable-cabecera');
            const continuar = page.getByRole('button', { name: texto.continuar });
            const clicSinMoverAncestros = (el: HTMLElement) => el.click();
            await expect(page.locator('.mi-count')).toHaveText(texto.reloj);
            if (await consumos.getAttribute('aria-expanded') !== 'true') await consumos.evaluate(clicSinMoverAncestros);
            await expect(filas).toHaveCount(7);

            const guardarYMedir = async (numero: number) => {
              await lista.evaluate(el => { el.scrollTop = el.scrollHeight; });
              await expect(continuar).toBeEnabled();
              await continuar.evaluate(clicSinMoverAncestros);
              await expect(aviso.locator('strong')).toHaveText(texto.aviso);
              await expect(filas.locator('[data-estado="registrado"]')).toHaveCount(platos);
              if (height <= 620) await expect(page.locator('.mesa-con-accion-ancha > .hdr')).toHaveCSS('padding-bottom', '48px');
              const medidas = await aviso.evaluate(el => {
                const app = el.closest('.app')!;
                const lista = el.closest('.mesa-selection-scroll')!.getBoundingClientRect();
                const barra = app.querySelector('.appbar-block')!.getBoundingClientRect();
                const caja = el.getBoundingClientRect();
                const centroX = caja.left + caja.width / 2;
                const volver = app.querySelector('.hdr-back')!;
                const boton = volver.getBoundingClientRect();
                return {
                  scrollTop: app.scrollTop, excesoApp: app.scrollHeight - app.clientHeight,
                  diferenciaBarraVentana: barra.bottom - innerHeight,
                  inicioCabecera: app.querySelector('.hdr')!.getBoundingClientRect().top,
                  rellenoSuperior: getComputedStyle(el).paddingTop,
                  margenInferior: Math.min(barra.top, lista.bottom, innerHeight) - caja.bottom,
                  nombreRenglones: (() => {
                    const rango = document.createRange();
                    rango.selectNodeContents(app.querySelector('.mesa-selection-context-main')!);
                    return rango.getClientRects().length;
                  })(),
                  avisoVisible: caja.top >= Math.max(0, lista.top) && caja.left >= 0 && caja.right <= innerWidth
                    && [caja.top + 2, caja.top + caja.height / 2, caja.bottom - 2]
                      .every(y => el.contains(document.elementFromPoint(centroX, y))),
                  volverVisible: volver.contains(document.elementFromPoint(boton.x + boton.width / 2, boton.y + boton.height / 2)),
                };
              });
              await info.attach(`guardado-${numero}`, { body: JSON.stringify(medidas), contentType: 'application/json' });
              if (process.env.PAYME_E2E_CAPTURAS && height === 548 && platos === 6 && (width === 320 || width === 375)) {
                await page.locator('.hdr-user').evaluateAll(els => els.forEach(el => { el.textContent = 'Demo'; }));
                await page.screenshot({
                  path: `${process.env.PAYME_E2E_CAPTURAS}/n0-${width}x${height}-${idioma}-${platos}-${numero}.png`,
                  animations: 'disabled',
                });
              }
              return medidas;
            };

            for (let i = 1; i <= platos; i += 1) await filas.nth(i).locator('.qc-libre').evaluate(clicSinMoverAncestros);
            const primero = await guardarYMedir(1);
            await consumos.evaluate(clicSinMoverAncestros);
            await filas.nth(platos).getByRole('button', { name: texto.soltar }).evaluate(clicSinMoverAncestros);
            await expect(filas.nth(platos).locator('.qc-libre')).toBeEnabled();
            await filas.nth(platos === 6 ? 0 : 6).locator('.qc-libre').evaluate(clicSinMoverAncestros);
            await expect(aviso).toHaveCount(0);
            const segundo = await guardarYMedir(2);

            for (const [i, medidas] of [primero, segundo].entries()) {
              const mensaje = `guardado ${i + 1}: ${JSON.stringify(medidas)}`;
              expect(medidas, mensaje).toMatchObject({
                scrollTop: 0, excesoApp: 0, diferenciaBarraVentana: 0, inicioCabecera: 0, avisoVisible: true, volverVisible: true, rellenoSuperior: '12px',
              });
              expect(medidas.margenInferior, mensaje).toBeGreaterThanOrEqual(8);
              if (nombreLargo) expect(medidas.nombreRenglones, mensaje).toBe(2);
            }
          });
        }
      }
    }
  }
}
