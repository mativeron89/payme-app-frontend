import { expect, test, type Locator, type Page } from '@playwright/test';
import { abrirMesaConLink, ingresar, irEnLaApp } from './_app';
import { enTuMesaConLaLista } from './_mesa';

/**
 * AF-TANDA-CHICA-0810-20261008 · D240 · los siete arreglos de la lista de Mati
 * del 08/10, a 375×667 (el ancho del plan). Uno o más casos por punto:
 *   3  el listado al elegir: letra y tamaño del sistema, nombre en dos líneas,
 *      renglones de 56 y la cantidad antes del nombre;
 *   5  la campana con el número;
 *   8  la hoja antes del cierre: «Cerrar mesa» y el «Listo» que completa la mesa;
 *   12 «Cerrar sesión» en rojo clarito;
 *   13 la flecha de Notificaciones como la de Zona horaria;
 *   14 la burbuja del detalle de Mesas separada de la línea;
 *   16 los ítems iguales juntos en el detalle de Mesas.
 * Con `PAYME_E2E_CAPTURAS` deja las capturas para la prueba de Mati.
 */

test.use({ viewport: { width: 375, height: 667 } });

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (dir) await page.screenshot({ path: `${dir}/${test.info().project.name}-tanda0810-${nombre}.png` });
}

/** Cada hoja que aparece, por su nombre: una ausencia se afirma con esto, no esperando. */
async function espiarHojas(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __hojas: string[] };
    w.__hojas = [];
    new MutationObserver((cambios) => {
      for (const c of cambios) {
        for (const n of c.addedNodes) {
          if (!(n instanceof Element)) continue;
          for (const d of [n, ...n.querySelectorAll('[role="dialog"]')]) {
            if (d.getAttribute('role') === 'dialog') w.__hojas.push(d.getAttribute('aria-label') ?? '');
          }
        }
      }
    }).observe(document, { childList: true, subtree: true });
  });
}
const hojasVistas = (page: Page) => page.evaluate(() => (window as unknown as { __hojas: string[] }).__hojas);

async function abrirMesa(page: Page, modo: 'consumo' | 'igual' = 'consumo'): Promise<string> {
  await page.addInitScript(() => localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled'));
  await ingresar(page);
  const mesa = await abrirMesaConLink(page, { sinGarantia: true, modo });
  await page.goto(`/mesa/${mesa.code}`);
  await enTuMesaConLaLista(page);
  return mesa.code;
}

const renglon = (page: Page, nombre: string, n = 0): Locator => page.locator(`.qc-renglon[data-plato="${nombre}"]`).nth(n);

/** Toca el plato y, si se abre el selector de porción, deja «Entero». */
async function elegirEntero(fila: Locator): Promise<void> {
  await fila.locator('button.qc-libre').click();
  const entero = fila.getByRole('radio', { name: 'Entero' });
  if (await entero.count()) await entero.click();
}

async function elegirTodo(page: Page): Promise<void> {
  const filas = page.locator('.qc-renglon');
  const n = await filas.count();
  for (let k = 0; k < n; k += 1) {
    if (await filas.nth(k).locator('button.qc-libre').count()) await elegirEntero(filas.nth(k));
  }
}

/** Las llamadas a un método de la API, desde que se instala. */
async function contarLlamadas(page: Page, metodo: 'lockItems' | 'closeMesa'): Promise<void> {
  await page.evaluate(async (nombre) => {
    const w = window as unknown as { __llamadas: Record<string, number> };
    w.__llamadas = { ...(w.__llamadas ?? {}), [nombre]: 0 };
    const route = '/src/api/index.ts';
    const module = await import(/* @vite-ignore */ route) as { api: Record<string, (...a: unknown[]) => Promise<unknown>> };
    const original = module.api[nombre].bind(module.api);
    module.api[nombre] = async (...args: unknown[]) => { w.__llamadas[nombre] += 1; return original(...args); };
  }, metodo);
}
const llamadas = (page: Page, metodo: string) => page.evaluate((m) => (window as unknown as { __llamadas: Record<string, number> }).__llamadas[m], metodo);

const listo = (page: Page) => page.getByRole('button', { name: 'Listo', exact: true });

async function tocarCerrarMesa(page: Page): Promise<void> {
  await page.evaluate(() => { document.querySelector('.flow-scroll')?.scrollTo(0, 1e6); });
  await page.getByRole('button', { name: 'Cerrar mesa', exact: true }).click();
}

test.describe('D240 punto 3 · el listado al elegir', () => {
  test('letra y tamaño del sistema; el nombre largo elegido se lee entero en dos líneas; todos los renglones miden 56', async ({ page }) => {
    await abrirMesa(page);
    const tagliatelle = renglon(page, 'Tagliatelle Bolognese');
    const libre = await tagliatelle.locator('.qc-nombre').evaluate((e) => {
      const s = getComputedStyle(e);
      return { familia: s.fontFamily, tamano: s.fontSize, peso: s.fontWeight };
    });
    expect(libre.familia).toMatch(/^"?DM Sans/);
    expect(libre).toMatchObject({ tamano: '16px', peso: '500' });
    const precio = await tagliatelle.locator('.qc-precio').evaluate((e) => {
      const s = getComputedStyle(e);
      return { familia: s.fontFamily, tamano: s.fontSize, peso: s.fontWeight };
    });
    expect(precio.familia).toMatch(/^"?Plus Jakarta Sans/);
    expect(precio).toMatchObject({ tamano: '16px', peso: '700' });
    expect(await tagliatelle.locator('.qc-fila').evaluate((e) => e.getBoundingClientRect().height)).toBeCloseTo(56, 0);

    // Regla 1: elegir no mueve la lista. Se mide dónde empieza cada renglón
    // antes y después de elegirlos todos (con dos líneas de nombre incluidas).
    // Respecto de la lista: el scroll que hace cada toque no cuenta.
    const tops = () => page.locator('.qc-lista').evaluate((l) => {
      const base = l.getBoundingClientRect().top;
      return [...l.querySelectorAll('.qc-renglon')].map((r) => r.getBoundingClientRect().top - base);
    });
    const antes = await tops();
    await elegirTodo(page);
    const despues = await tops();
    expect(despues).toHaveLength(antes.length);
    despues.forEach((top, k) => expect(Math.abs(top - antes[k]!), `renglón ${k}`).toBeLessThanOrEqual(2));
    const filas = await page.locator('.qc-renglon').evaluateAll((rs) => rs.map((r) => {
      const n = r.querySelector('.qc-nombre') as HTMLElement;
      const f = r.querySelector('.qc-fila') as HTMLElement;
      return {
        plato: r.getAttribute('data-plato'),
        // El renglón propio: 50 + 3 + 3 de margen = los 56 del libre.
        alto: f.getBoundingClientRect().height,
        // El nombre entero: nada queda escondido por el recorte de dos líneas.
        entero: n.scrollHeight <= n.clientHeight + 1 && n.scrollWidth <= n.clientWidth + 1,
        lineas: Math.round(n.getBoundingClientRect().height / parseFloat(getComputedStyle(n).lineHeight)),
        peso: getComputedStyle(n).fontWeight,
      };
    }));
    expect(filas.length).toBeGreaterThan(5);
    for (const f of filas) {
      expect(f.alto, `${f.plato}`).toBeCloseTo(50, 0);
      expect(f.entero, `${f.plato}`).toBe(true);
      expect(f.peso, `${f.plato}`).toBe('600');
    }
    // El caso medido antes: «Tagliatelle Bolognese» no entraba en una línea.
    expect(filas.find((f) => f.plato === 'Tagliatelle Bolognese')?.lineas).toBe(2);
    await page.locator('.qc-lista').evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await capturar(page, '03-todos-elegidos');
  });

  test('regla 1 a 375: elegir, cambiar la porción o soltar no mueve el renglón siguiente', async ({ page }) => {
    await abrirMesa(page);
    const siguiente = renglon(page, 'Risotto ai Funghi');
    const arriba = () => siguiente.evaluate((e) => e.getBoundingClientRect().top - e.closest('.qc-lista')!.getBoundingClientRect().top);
    const antes = await arriba();
    const tagliatelle = renglon(page, 'Tagliatelle Bolognese');
    await tagliatelle.locator('button.qc-libre').click();
    expect(Math.abs((await arriba()) - antes)).toBeLessThanOrEqual(2);
    if (await tagliatelle.getByRole('radio', { name: '½' }).count()) {
      await tagliatelle.getByRole('radio', { name: '½' }).click();
      expect(Math.abs((await arriba()) - antes)).toBeLessThanOrEqual(2);
    }
    await tagliatelle.getByRole('button', { name: 'Soltar Tagliatelle Bolognese' }).click();
    expect(Math.abs((await arriba()) - antes)).toBeLessThanOrEqual(2);
  });

  test('la cantidad va ANTES del nombre, en gris y fuera del recorte; lo que eligió otro sigue en una línea y en 56', async ({ page }) => {
    const code = await abrirMesa(page);
    await page.evaluate(async (c) => {
      const ruta = '/src/api/mock/store.ts';
      const store = await import(/* @vite-ignore */ ruta) as {
        state: { mesas: Array<{ code: string; items: Array<{ name: string; quantity: number; claims: unknown[] }> }> };
        persist: () => void;
      };
      const mesa = store.state.mesas.find((m) => m.code === c)!;
      mesa.items.find((i) => i.name === 'Vino tinto (copa)')!.quantity = 2;
      mesa.items.find((i) => i.name === 'Tiramisú')!.claims = [
        { who: 'guest', fraction_bps: 10000, amount_cents: null, status: 'locked' },
      ];
      store.persist();
    }, code);
    await page.reload();
    await enTuMesaConLaLista(page);

    const vino = renglon(page, 'Vino tinto (copa)');
    await expect(vino.locator('.qc-cant')).toHaveText('2 ×');
    await expect(vino.getByRole('button', { name: 'Vino tinto (copa) por 2', exact: true })).toBeVisible();
    const pos = await vino.evaluate((r) => {
      const c = r.querySelector('.qc-cant')!.getBoundingClientRect();
      const n = r.querySelector('.qc-nombre')!.getBoundingClientRect();
      return { cantFin: c.right, nombreInicio: n.left, color: getComputedStyle(r.querySelector('.qc-cant')!).color };
    });
    expect(pos.cantFin).toBeLessThanOrEqual(pos.nombreInicio);
    expect(pos.color).toBe('rgb(91, 107, 130)');

    const tomado = page.locator('.qc-renglon [data-estado="tomado"]').first();
    await expect(tomado).toContainText('Lo eligió otro');
    expect(await tomado.evaluate((e) => e.getBoundingClientRect().height)).toBeCloseTo(56, 0);
    expect(await tomado.locator('.qc-nombre').evaluate((e) => getComputedStyle(e).whiteSpace)).toBe('nowrap');
    await vino.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await capturar(page, '03-cantidad-y-tomado');
  });
});

async function sembrarAvisos(page: Page, n: number): Promise<void> {
  await page.evaluate(async (cuantos) => {
    const ruta = '/src/api/mock/store.ts';
    const { state } = await import(/* @vite-ignore */ ruta) as { state: { notifications: unknown[] } };
    state.notifications = Array.from({ length: cuantos }, (_, i) => ({
      id: `t0810-${i}`, body: `Aviso ${i}`, read_at: null, type: 'generic', title: null, payload: null,
      related_entity_type: null, related_entity_id: null,
      created_at: new Date(Date.now() - (i + 1) * 60_000).toISOString(),
    }));
  }, n);
}

const campana = (page: Page) => page.locator('.screen > .hdr').first().locator('.hdr-bell');

/** `useSinLeer` consulta al montar: se pasa por Mesas y se vuelve a Inicio. */
async function inicioConAvisos(page: Page, n: number): Promise<void> {
  await sembrarAvisos(page, n);
  await irEnLaApp(page, '/mesas');
  await expect(page.getByRole('heading', { name: 'Mesas', exact: true })).toBeVisible();
  await irEnLaApp(page, '/');
  await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
}

test.describe('D240 punto 5 · la campana con el número', () => {
  for (const [n, texto] of [[1, '1'], [9, '9'], [10, '9+'], [23, '9+']] as const) {
    test(`Inicio con ${n} sin leer: la burbuja roja dice «${texto}» y la campana se llama «Avisos, ${n} sin leer»`, async ({ page }) => {
      await ingresar(page);
      await inicioConAvisos(page, n);
      const burbuja = campana(page).locator('.hdr-badge');
      await expect(burbuja).toHaveText(texto);
      await expect(burbuja).toHaveCSS('background-color', 'rgb(180, 35, 24)');
      await expect(burbuja).toHaveCSS('color', 'rgb(255, 255, 255)');
      // El número SE VE: el punto de antes tenía el texto con font-size 0.
      await expect(burbuja).toHaveCSS('font-size', '11px');
      const caja = await burbuja.evaluate((e) => {
        const b = e.getBoundingClientRect();
        const s = e.closest('.hdr-bell')!.querySelector('svg')!.getBoundingClientRect();
        return { b: { x: b.x, y: b.y, w: b.width, h: b.height }, centroX: s.x + s.width / 2, centroY: s.y + s.height / 2 };
      });
      expect(caja.b.h).toBeCloseTo(18, 0);
      expect(caja.b.x + caja.b.w / 2).toBeGreaterThan(caja.centroX);
      expect(caja.b.y + caja.b.h / 2).toBeLessThan(caja.centroY);
      expect(caja.b.x + caja.b.w).toBeLessThanOrEqual(375);
      await expect(campana(page)).toHaveAccessibleName(`Avisos, ${n} sin leer`);
      if (n === 23) await capturar(page, '05-campana-23');
    });
  }

  test('Mesas también lleva el número; con 0 no hay burbuja y la campana se llama «Avisos»', async ({ page }) => {
    await ingresar(page);
    await sembrarAvisos(page, 3);
    await irEnLaApp(page, '/mesas');
    await expect(page.getByRole('heading', { name: 'Mesas', exact: true })).toBeVisible();
    await expect(campana(page).locator('.hdr-badge')).toHaveText('3');
    await expect(campana(page).locator('.hdr-badge')).toHaveCSS('background-color', 'rgb(180, 35, 24)');
    await expect(campana(page)).toHaveAccessibleName('Avisos, 3 sin leer');
    await capturar(page, '05-campana-mesas');

    await sembrarAvisos(page, 0);
    await irEnLaApp(page, '/');
    await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Avisos', exact: true })).toBeVisible();
    await expect(campana(page).locator('.hdr-badge')).toHaveCount(0);
  });

  test('en inglés: «Notifications, 3 unread»', async ({ page }) => {
    await ingresar(page);
    await page.evaluate(() => localStorage.setItem('payme.app.idioma.v1', 'en'));
    await page.reload();
    await expect(page.getByRole('button', { name: 'New', exact: true })).toBeVisible();
    await inicioConAvisosEn(page, 3);
    await expect(campana(page)).toHaveAccessibleName('Notifications, 3 unread');
  });

  test('a 320 px con «9+» la burbuja no se sale de la pantalla', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await ingresar(page);
    await inicioConAvisos(page, 23);
    const b = await campana(page).locator('.hdr-badge').evaluate((e) => e.getBoundingClientRect().right);
    expect(b).toBeLessThanOrEqual(320);
  });
});

async function inicioConAvisosEn(page: Page, n: number): Promise<void> {
  await sembrarAvisos(page, n);
  await irEnLaApp(page, '/mesas');
  await expect(page.getByRole('heading', { name: 'Tables', exact: true })).toBeVisible();
  await irEnLaApp(page, '/');
  await expect(page.getByRole('button', { name: 'New', exact: true })).toBeVisible();
}

test.describe('D240 punto 8 · avisar antes de que la mesa se cierre', () => {
  test('«Cerrar mesa» con algo marcado sin «Listo»: lo dice, y «Revisar» lleva a la lista sin cerrar', async ({ page }) => {
    await abrirMesa(page);
    await contarLlamadas(page, 'closeMesa');
    await page.getByRole('button', { name: 'Tagliatelle Bolognese', exact: true }).click();
    await tocarCerrarMesa(page);
    const hoja = page.getByRole('dialog', { name: '¿Cerrar la mesa?' });
    await expect(hoja.getByText('Revisa lo que elegiste: después de cerrar ya no se puede modificar.')).toBeVisible();
    await expect(hoja.getByText('Todavía no elegiste nada.')).toBeVisible();
    await expect(hoja.getByText('Marcaste consumos sin tocar «Listo»: si cierras ahora, no quedan registrados.')).toBeVisible();
    await expect(hoja.getByRole('button', { name: 'Revisar', exact: true })).toBeFocused();
    await expect(hoja.getByRole('button', { name: 'Volver', exact: true })).toHaveCount(0);
    await capturar(page, '08-cerrar-sin-listo');

    await hoja.getByRole('button', { name: 'Revisar', exact: true }).click();
    await expect(hoja).toHaveCount(0);
    await expect(page.locator('.qc-lista')).toBeInViewport();
    await expect(page.locator('.qc-lista :focus')).toHaveCount(1);
    expect(await llamadas(page, 'closeMesa')).toBe(0);
  });

  test('«Cerrar mesa» con lo guardado: muestra lo elegido con los iguales juntos y cierra con «Sí, cerrar la mesa»', async ({ page }) => {
    const code = await abrirMesa(page);
    await elegirEntero(renglon(page, 'Tiramisú', 0));
    await elegirEntero(renglon(page, 'Tiramisú', 1));
    await renglon(page, 'Agua mineral').locator('button.qc-libre').click();
    await renglon(page, 'Agua mineral').getByRole('radio', { name: '½' }).click();
    await listo(page).click();
    await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
    await page.goto(`/mesa/${code}`);
    await enTuMesaConLaLista(page);
    await tocarCerrarMesa(page);
    const hoja = page.getByRole('dialog', { name: '¿Cerrar la mesa?' });
    await expect(hoja.locator('.cerrar-mesa-mios li')).toHaveText(['2 × Tiramisú', 'Agua mineral · ½']);
    await expect(hoja.locator('.cerrar-mesa-sin-guardar')).toHaveCount(0);
    await expect(hoja.getByText('No se puede reabrir: para seguir, abre una mesa nueva.')).toBeVisible();
    await capturar(page, '08-cerrar-guardado');
    await hoja.getByRole('button', { name: 'Sí, cerrar la mesa', exact: true }).click();
    await expect(page.getByText('La cerraste tú.')).toBeVisible();
  });

  test('el «Listo» que completa la mesa avisa ANTES de enviar; «Revisar» no envía nada; «Guardar y cerrar» la cierra', async ({ page }) => {
    await abrirMesa(page);
    await contarLlamadas(page, 'lockItems');
    await elegirTodo(page);
    await listo(page).click();
    const hoja = page.getByRole('dialog', { name: 'Con esto se cierra la mesa' });
    await expect(hoja).toBeVisible();
    await expect(hoja.getByText('Con tu selección ya se eligió todo lo de la mesa.')).toBeVisible();
    await expect(hoja.locator('.cerrar-mesa-mios li')).toHaveText([
      'Tagliatelle Bolognese', 'Risotto ai Funghi', 'Pizza Margherita', '2 × Tiramisú', 'y 2 más',
    ]);
    await expect(hoja.getByRole('button', { name: 'Revisar', exact: true })).toBeFocused();
    expect(await llamadas(page, 'lockItems')).toBe(0);
    await capturar(page, '08-listo-que-cierra');

    await hoja.getByRole('button', { name: 'Revisar', exact: true }).click();
    await expect(hoja).toHaveCount(0);
    await expect(page.locator('.qc-lista :focus')).toHaveCount(1);
    await expect(page).toHaveURL(/\/mesa\//);
    expect(await llamadas(page, 'lockItems')).toBe(0);

    await listo(page).click();
    await hoja.getByRole('button', { name: 'Guardar y cerrar', exact: true }).click();
    await expect(page.getByText('Se eligieron todos los consumos.')).toBeVisible();
    expect(await llamadas(page, 'lockItems')).toBe(1);
    // La mesa quedó cerrada de verdad (no sólo la pantalla que lee la respuesta):
    // al volver a verla, el dueño (acá el mock) la da por cerrada.
    await page.getByRole('button', { name: 'Ver la mesa', exact: true }).click();
    await expect(page.getByText('Esta mesa cerró sin cobros')).toBeVisible();
    await expect(page).toHaveURL(/\/mesa\//);
  });

  test('Escape en la hoja del «Listo» vuelve el foco a «Listo», sin enviar nada', async ({ page }) => {
    await abrirMesa(page);
    await contarLlamadas(page, 'lockItems');
    await elegirTodo(page);
    await listo(page).click();
    await expect(page.getByRole('dialog', { name: 'Con esto se cierra la mesa' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(listo(page)).toBeFocused();
    expect(await llamadas(page, 'lockItems')).toBe(0);
  });

  test('un «Listo» que no completa la mesa guarda y vuelve a Inicio sin ninguna hoja', async ({ page }) => {
    await espiarHojas(page);
    await abrirMesa(page);
    await contarLlamadas(page, 'lockItems');
    await elegirEntero(renglon(page, 'Tagliatelle Bolognese'));
    await listo(page).click();
    await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
    expect(await llamadas(page, 'lockItems')).toBe(1);
    expect(await hojasVistas(page)).toEqual([]);
  });
});

test.describe('D240 puntos 12 y 13 · Configuración', () => {
  test('«Cerrar sesión» en el rojo clarito del sistema; «Reiniciar la demo» sigue gris; no queda bajo la barra', async ({ page }) => {
    await ingresar(page);
    await page.goto('/#/mas');
    await expect(page.getByRole('heading', { name: 'Configuración', exact: true })).toBeVisible();
    await page.locator('.scroll').evaluate((el) => { el.scrollTop = el.scrollHeight; });
    const salir = page.getByRole('button', { name: 'Cerrar sesión', exact: true });
    await expect(salir).toHaveCSS('background-color', 'rgb(254, 242, 242)');
    await expect(salir).toHaveCSS('color', 'rgb(180, 35, 24)');
    await expect(salir).toHaveCSS('border-top-style', 'solid');
    expect(parseFloat(await salir.evaluate((e) => getComputedStyle(e).borderTopWidth))).toBeGreaterThan(0);
    const demo = page.getByRole('button', { name: 'Reiniciar la demo', exact: true });
    await expect(demo).toHaveCSS('background-color', 'rgb(241, 245, 249)');
    await expect(demo).toHaveCSS('color', 'rgb(16, 30, 59)');
    const s = await salir.boundingBox();
    const barra = await page.locator('.appbar-block').boundingBox();
    expect(s!.y + s!.height).toBeLessThanOrEqual(barra!.y);
    await capturar(page, '12-cerrar-sesion');
  });

  test('la flecha de Notificaciones (y de Mis tarjetas) es la misma de Zona horaria', async ({ page }) => {
    await ingresar(page);
    await page.goto('/#/mas');
    await expect(page.getByRole('heading', { name: 'Configuración', exact: true })).toBeVisible();
    const firma = (fila: Locator) => fila.locator(':scope > :last-child').evaluate((ultimo) => {
      const svg = (ultimo.tagName.toLowerCase() === 'svg' ? ultimo : ultimo.querySelector('svg')) as SVGElement | null;
      if (!svg) return null;
      const r = svg.getBoundingClientRect();
      const b = svg.closest('button')!.getBoundingClientRect();
      return {
        d: [...svg.querySelectorAll('path')].map((p) => p.getAttribute('d')),
        ancho: r.width,
        alto: r.height,
        color: getComputedStyle(svg).color,
        derecha: Math.round(b.right - r.right) + 0,
        // `+ 0`: Math.round(-0.2) es -0, y -0 no es 0 para toEqual.
        centro: Math.round((r.top + r.height / 2) - (b.top + b.height / 2)) + 0,
      };
    });
    const zona = page.getByRole('button', { name: 'Zona horaria', exact: true });
    const notif = page.getByRole('button', { name: 'Notificaciones', exact: true });
    await expect(notif).not.toContainText('→');
    const referencia = await firma(zona);
    expect(referencia).toMatchObject({
      d: ['M4.5 12h15', 'M13 5.5l6.5 6.5-6.5 6.5'], ancho: 16, alto: 16, color: 'rgb(16, 30, 59)', centro: 0,
    });
    expect(await firma(notif)).toEqual(referencia);
    const tarjetas = page.getByRole('button', { name: 'Mis tarjetas', exact: true });
    if (await tarjetas.count()) expect(await firma(tarjetas)).toEqual(referencia);
    await capturar(page, '13-flechas');
  });
});

/** Arriba, a los costados y abajo de la burbuja, dentro de la tarjeta abierta. */
async function separacion(item: Locator): Promise<{ arriba: number; izq: number; der: number; abajo: number }> {
  return item.evaluate((el) => {
    const row = el.querySelector('.hist-row')!.getBoundingClientRect();
    const det = el.querySelector('.hist-detail')!.getBoundingClientRect();
    const card = el.getBoundingClientRect();
    return { arriba: det.top - row.bottom, izq: det.left - card.left, der: card.right - det.right, abajo: card.bottom - det.bottom };
  });
}

function doceEnLosCuatroLados(g: { arriba: number; izq: number; der: number; abajo: number }): void {
  expect(Math.abs(g.arriba - 12)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(g.arriba - g.izq)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(g.izq - g.der)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(g.der - g.abajo)).toBeLessThanOrEqual(0.5);
}

test.describe('D240 punto 14 · la burbuja del detalle, separada de la línea', () => {
  test('en el historial: 12 px de la línea, igual que los costados y el pie; la línea sigue', async ({ page }) => {
    await ingresar(page);
    await page.goto('/#/mesas');
    const fila = page.getByRole('button', { name: /\$224\.25/ });
    await fila.click();
    const item = page.locator('.hist-item').filter({ has: fila });
    await expect(item.locator('.hist-detail')).toContainText('Tagliatelle Bolognese');
    doceEnLosCuatroLados(await separacion(item));
    await expect(item.locator('.hist-row')).toHaveCSS('border-bottom-style', 'solid');
    await expect(item.locator('.hist-row')).toHaveCSS('border-bottom-width', '1px');
    await expect(item.locator('.hist-detail')).toHaveCSS('background-color', 'rgb(248, 250, 252)');
    await fila.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await capturar(page, '14-historial');
  });

  test('en «Tus mesas»: la misma separación', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('payme.app.mock.mis_mesas.v1', 'sin_cobro'));
    await ingresar(page);
    await page.goto('/#/mesas');
    const mesa = page.locator('.tu-mesa').filter({ hasText: 'Tacos El Güero' });
    // AF-BORRAR-MESAS · la tarjeta tiene además «Eliminar»: el botón de la tarjeta.
    await mesa.locator('button.hist-row').click();
    await expect(mesa.locator('.hist-detail')).toBeVisible();
    doceEnLosCuatroLados(await separacion(mesa));
    await expect(mesa.locator('.hist-row')).toHaveCSS('border-bottom-style', 'solid');
  });
});

test.describe('D240 punto 16 · los ítems iguales juntos en el detalle de Mesas', () => {
  test('el camino real: dos Tiramisú elegidos, la mesa cerrada, y en «Tus mesas» un renglón «2 × Tiramisú $140»', async ({ page }) => {
    const code = await abrirMesa(page);
    await elegirEntero(renglon(page, 'Tiramisú', 0));
    await elegirEntero(renglon(page, 'Tiramisú', 1));
    await elegirEntero(renglon(page, 'Tagliatelle Bolognese'));
    await listo(page).click();
    await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
    await page.goto(`/mesa/${code}`);
    await enTuMesaConLaLista(page);
    await tocarCerrarMesa(page);
    await page.getByRole('dialog', { name: '¿Cerrar la mesa?' }).getByRole('button', { name: 'Sí, cerrar la mesa', exact: true }).click();
    await expect(page.getByText('La cerraste tú.')).toBeVisible();
    await irEnLaApp(page, '/mesas');
    const tuMesa = page.locator('.tu-mesa').filter({ has: page.locator('button.hist-row') }).first();
    await expect(tuMesa).toContainText('Elegiste 3 ítems');
    await tuMesa.locator('button.hist-row').click();
    const filas = tuMesa.locator('.hist-detail-row');
    await expect(filas).toHaveCount(2);
    await expect(filas.filter({ hasText: '2 × Tiramisú' })).toContainText('$140');
    await expect(filas.filter({ hasText: 'Tagliatelle Bolognese' })).toContainText('$195');
    await tuMesa.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await capturar(page, '16-tus-mesas');
  });

  test('el historial junta los iguales dentro del pago y la propina queda igual', async ({ page }) => {
    await ingresar(page);
    await page.evaluate(async () => {
      const ruta = '/src/api/mock/store.ts';
      const { state, persist } = await import(/* @vite-ignore */ ruta) as {
        state: { movementDetails: Record<string, { mesa: { code: string }; items: unknown[] }> };
        persist: () => void;
      };
      const detalle = Object.values(state.movementDetails).find((d) => d.mesa.code === 'PA-8712');
      if (!detalle) throw new Error('PA-8712 ausente');
      const agua = { name: 'Agua mineral', price_cents: 4000, quantity: 1, category: 'drinks', amount_cents: 4000, fraction_bps: 10000, declared_fraction_bps: null };
      detalle.items = [
        agua,
        { name: 'Tagliatelle Bolognese', price_cents: 11500, quantity: 1, category: 'pasta', amount_cents: 11500, fraction_bps: 10000, declared_fraction_bps: null },
        { ...agua },
      ];
      persist();
    });
    await page.reload();
    await page.goto('/#/mesas');
    const fila = page.getByRole('button', { name: /\$224\.25/ });
    await fila.click();
    const item = page.locator('.hist-item').filter({ has: fila });
    const filas = item.locator('.hist-detail-row:not(.hist-detail-tip)');
    await expect(filas).toHaveCount(2);
    await expect(filas.filter({ hasText: '2 × Agua mineral' })).toContainText('$80');
    await expect(filas.filter({ hasText: 'Tagliatelle Bolognese' })).toContainText('$115');
    await expect(item.locator('.hist-detail-tip')).toContainText('$29.25');
  });
});
