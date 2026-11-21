import { expect, test, type Page } from '@playwright/test';
import { ingresar, irEnLaApp } from './_app';

async function preparar(page: Page, idioma: 'es' | 'en') {
  await page.clock.install({ time: new Date('2026-10-13T18:00:00Z') });
  await ingresar(page, { sinInvitaciones: true });
  if (idioma === 'en') {
    await irEnLaApp(page, '/mas');
    await page.getByRole('button', { name: 'EN', exact: true }).click();
  }
}

for (const idioma of ['es', 'en'] as const) {
  const en = idioma === 'en';
  for (const mensaje of ['Load failed', 'NetworkError when attempting to fetch resource.', 'Connection lost'] as const) {
    test(`una lectura interrumpida (${mensaje}) se reintenta por la misma ruta (${idioma})`, async ({ page }) => {
      await preparar(page, idioma);
      await page.evaluate(async mensaje => {
        const ruta = '/src/api/index.ts';
        const rutaHttp = '/src/api/http.ts';
        const { api } = await import(/* @vite-ignore */ ruta) as typeof import('../src/api');
        const { httpPublicRequest } = await import(/* @vite-ignore */ rutaHttp) as typeof import('../src/api/http');
        const leer = api.getMesa.bind(api);
        const fetchOriginal = window.fetch.bind(window);
        window.fetch = async (input, init) => {
          if (typeof input === 'string' && input.endsWith('/api/mesas/PA-2847')) {
            throw new TypeError(mensaje);
          }
          return fetchOriginal(input, init);
        };
        let recuperada = false;
        document.addEventListener('restablecer-lectura', () => { recuperada = true; }, { once: true });
        api.getMesa = async (...args) => {
          if (args[0] === 'PA-2847' && !recuperada) return httpPublicRequest('GET', '/mesas/PA-2847');
          return leer(...args);
        };
      }, mensaje);
      await irEnLaApp(page, '/mesa/PA-2847');
      await expect(page.locator('.empty')).toContainText(en ? "We couldn't load your table" : 'No pudimos cargar tu mesa');
      await expect(page.locator('.empty')).toContainText(en ? 'Check your connection and try again.' : 'Revisa tu conexión y vuelve a intentarlo.');
      await page.evaluate(() => document.dispatchEvent(new Event('restablecer-lectura')));
      await page.getByRole('button', { name: en ? 'Retry' : 'Reintentar', exact: true }).click();
      await expect(page.getByRole('heading', { name: en ? 'Your table' : 'Tu mesa', exact: true })).toBeVisible();
      await expect(page).toHaveURL(/mesa\/PA-2847$/);
    });
  }

  test(`el timeout se reintenta por la misma ruta (${idioma})`, async ({ page }) => {
    await preparar(page, idioma);
    await page.evaluate(async () => {
      const ruta = '/src/api/index.ts';
      const { api } = await import(/* @vite-ignore */ ruta) as typeof import('../src/api');
      const leer = api.getMesa.bind(api);
      let recuperada = false;
      document.addEventListener('restablecer-lectura', () => { recuperada = true; }, { once: true });
      api.getMesa = async (...args) => {
        if (args[0] === 'PA-2847' && !recuperada) throw new DOMException('aborted', 'AbortError');
        return leer(...args);
      };
    });
    await irEnLaApp(page, '/mesa/PA-2847');
    await expect(page.locator('.empty')).toContainText(en ? "We couldn't load your table" : 'No pudimos cargar tu mesa');
    await expect(page.locator('.empty')).toContainText(en ? 'Check your connection and try again.' : 'Revisa tu conexión y vuelve a intentarlo.');
    await page.evaluate(() => document.dispatchEvent(new Event('restablecer-lectura')));
    await page.getByRole('button', { name: en ? 'Retry' : 'Reintentar', exact: true }).click();
    await expect(page.getByRole('heading', { name: en ? 'Your table' : 'Tu mesa', exact: true })).toBeVisible();
    await expect(page).toHaveURL(/mesa\/PA-2847$/);
  });

  for (const falla of [401, 403, 404, 408, 429, 500, 503, 'TypeError'] as const) {
    test(`el error de carga ${falla} conserva su mensaje (${idioma})`, async ({ page }) => {
      await preparar(page, idioma);
      await page.evaluate(async falla => {
        const rutaApi = '/src/api/index.ts';
        const rutaMock = '/src/api/mock/mockApi.ts';
        const { api } = await import(/* @vite-ignore */ rutaApi) as typeof import('../src/api');
        const { MockApiError } = await import(/* @vite-ignore */ rutaMock) as typeof import('../src/api/mock/mockApi');
        const leer = api.getMesa.bind(api);
        api.getMesa = async (...args) => {
          if (args[0] !== 'PA-2847') return leer(...args);
          if (falla === 'TypeError') throw new TypeError('Load failed');
          throw new MockApiError(falla, 'error_de_prueba');
        };
      }, falla);
      await irEnLaApp(page, '/mesa/PA-2847');
      const panel = page.locator('.empty');
      const conexion = en ? 'Check your connection and try again.' : 'Revisa tu conexión y vuelve a intentarlo.';
      const servidor = falla === 500 || falla === 503;
      if (servidor || falla === 'TypeError') {
        await expect(panel).toContainText(en ? "We couldn't load your table" : 'No pudimos cargar tu mesa');
        await expect(panel.locator('.state-error-body')).toHaveText(servidor
          ? conexion : en ? 'Try again.' : 'Intenta de nuevo.');
        await expect(panel).not.toContainText('Load failed');
      } else {
        await expect(panel).toContainText(en
          ? "We couldn't find this table. The link may have expired, or the bill may already be closed."
          : 'No encontramos esta mesa. Puede que el link haya vencido o que ya se haya cerrado la cuenta.');
        await expect(panel).not.toContainText(conexion);
      }
      const reintentar = panel.getByRole('button', { name: en ? 'Retry' : 'Reintentar', exact: true });
      await expect(reintentar).toBeVisible();
      if (falla === 503) expect((await reintentar.boundingBox())?.height).toBe(44);
    });
  }

  test(`la mesa inexistente conserva el mensaje de 404 (${idioma})`, async ({ page }) => {
    await preparar(page, idioma);
    await irEnLaApp(page, '/mesa/inexistente');
    await expect(page.locator('.empty')).toContainText(en
      ? "We couldn't find this table. The link may have expired, or the bill may already be closed."
      : 'No encontramos esta mesa. Puede que el link haya vencido o que ya se haya cerrado la cuenta.');
    await expect(page.locator('.empty')).not.toContainText(en
      ? 'Check your connection and try again.' : 'Revisa tu conexión y vuelve a intentarlo.');
  });

  test(`el detalle cambia de reloj largo a minutos y segundos (${idioma})`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 780 });
    await preparar(page, idioma);
    await page.evaluate(async () => {
      const ruta = '/src/api/mock/store.ts';
      const { findMesa } = await import(/* @vite-ignore */ ruta) as typeof import('../src/api/mock/store');
      const mesa = findMesa('PA-2847');
      if (!mesa) throw new Error('Falta la mesa de ejemplo');
      mesa.expires_at = '2026-10-13T22:59:50Z';
    });
    await irEnLaApp(page, '/mesa/PA-2847');
    const reloj = page.locator('.mi-count');
    const prefijo = en ? 'Expires in' : 'Vence en';
    await expect(reloj).toHaveText(`${prefijo} 4 h 59 min`);
    await expect.poll(() => reloj.textContent()).toContain(`${prefijo} 4\u00a0h\u00a059\u00a0min`);
    expect(await reloj.evaluate(el => {
      const texto = Array.from(el.childNodes).find(n => n.textContent?.includes('4\u00a0h'));
      if (!texto) return 0;
      const inicio = texto.textContent!.indexOf('4\u00a0h');
      const duracion = document.createRange();
      duracion.setStart(texto, inicio);
      duracion.setEnd(texto, inicio + '4\u00a0h\u00a059\u00a0min'.length);
      return duracion.getClientRects().length;
    })).toBe(1);

    await expect(reloj).not.toHaveClass(/\burgent\b/);
    const sinDesborde = await reloj.evaluate((el) => {
      const fila = el.parentElement!;
      return fila.scrollWidth <= fila.clientWidth + 1
        && el.getBoundingClientRect().left >= fila.querySelector('.mi-meta-amt')!.getBoundingClientRect().right - 1;
    });
    expect(sinDesborde).toBe(true);

    const saltarA = async (hora: string) => {
      const diferencia = await page.evaluate((valor) => new Date(valor).getTime() - Date.now(), hora);
      await page.clock.fastForward(diferencia);
    };
    await saltarA('2026-10-13T21:59:44Z');
    await expect(reloj).not.toHaveClass(/\burgent\b/);
    await saltarA('2026-10-13T21:59:52Z');
    await expect(reloj).toHaveClass(/\burgent\b/);
    await saltarA('2026-10-13T22:49:45Z');
    await expect(reloj).toHaveText(`${prefijo} 10 min`);
    await saltarA('2026-10-13T22:49:52Z');
    await expect(reloj).toHaveText(/^\s*9:5[0-9]\s*$/);
    await saltarA('2026-10-13T22:59:51Z');
    await expect(page.getByRole('heading', { name: en ? 'Closing completed' : 'Cierre completado' })).toBeVisible();
    await expect(reloj).toHaveCount(0);
  });
}
