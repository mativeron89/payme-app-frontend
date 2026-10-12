import { expect, test, type Locator, type Page } from '@playwright/test';
import { ingresar, irEnLaApp, relojFueraDeLasFechasDeLosViajes } from './_app';

/**
 * AF-VIAJES-NOTAS-20261012 (0.244.0) · D290: el pizarrón de notas del viaje, contra el mock del dueño 2.183.0.
 *
 * Mati: «Todos ven, cada uno escribe el suyo», «Texto y listas con tildes», «Los del diseño» (500 por nota, 30 ítems
 * de 80, título de 80), «Punto naranja en la fila» y «Debajo de «Lugares visitados»». La especificación manda
 * (`PANTALLA-notas-del-viaje.md`); el prototipo, turno 2 (2a–2h).
 *
 * La semilla: en «Cancún 2026» (abierto, 4 personas) Luis dejó una nota larga y Sofía la lista «Súper del lunes» (2 de
 * 5); el mío y el de Diego, vacíos, y nunca abrí el pizarrón (hay algo nuevo). En «Oaxaca puente» (cerrado el 18 ago)
 * tengo una nota y la lista «Para llevar» (2 de 3), y Carla una nota. «Monterrey fin de semana» espera pagos.
 */
const CANCUN = 'd1000000-0000-4000-8000-000000000001';
const MONTERREY = 'd1000000-0000-4000-8000-000000000002';
const OAXACA = 'd1000000-0000-4000-8000-000000000003';
const ESTADO = 'payme.app.mock.viajes.estado.v1';
const SEAM = 'payme.app.mock.viajes.notas.v1';
const LATENCIA = 'payme.app.mock.latencia.v1';

async function conViajes(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('payme.app.mock.viajes.v1', 'encendido');
    localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled');
  });
  await relojFueraDeLasFechasDeLosViajes(page);
  await ingresar(page);
}

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (dir) await page.screenshot({ path: `${dir}/d290-${page.viewportSize()!.width}-${nombre}.png` });
}

const fila = (page: Page) => page.locator('button.nts-fila');
const mio = (page: Page) => page.getByRole('region', { name: 'Tu apartado', exact: true });
const de = (page: Page, nombre: string) => page.getByRole('region', { name: `Apartado de ${nombre}`, exact: true });
const hoja = (page: Page, nombre: string) => page.getByRole('dialog', { name: nombre, exact: true });
const toast = (page: Page) => page.locator('.toast');

async function alViaje(page: Page, id: string): Promise<void> {
  await irEnLaApp(page, `/viaje/${id}`);
  await expect(fila(page)).toBeVisible();
}

async function alPizarron(page: Page, id: string = CANCUN): Promise<void> {
  await irEnLaApp(page, `/viaje-notas/${id}`);
  await expect(page.getByRole('heading', { name: 'Notas', exact: true, level: 1 })).toBeVisible();
  await expect(page.locator('.nts-apartado').first()).toBeVisible();
}

/**
 * Cambia el estado del dueño en el mock y vuelve a Inicio (el mock lo relee al cargar la página). `yo` es mi cuenta del
 * mock.
 *
 * 🔴 La edición se hace desde una página pública (`/privacy`), que no carga el mock: si se hacía dentro de la app, un
 * pedido del mock que arrancaba después guardaba su estado en memoria encima y la edición se perdía. Pasó en la e2e
 * completa de 0.244.1, con carga: «4 personas» en vez de 7, y Oaxaca seguía cerrado.
 */
async function editarEstado(page: Page, fn: string, arg: unknown = null): Promise<void> {
  await page.goto('/privacy');
  await expect(page.getByRole('heading', { name: 'Aviso de privacidad' })).toBeVisible();
  await page.evaluate(({ k, fn: f, arg: a }) => {
    const e = JSON.parse(localStorage.getItem(k)!);
    const yo = JSON.parse(localStorage.getItem('payme_mock_state_v1')!).user.id;
    // eslint-disable-next-line no-new-func
    new Function('e', 'a', 'yo', f)(e, a, yo);
    localStorage.setItem(k, JSON.stringify(e));
  }, { k: ESTADO, fn, arg });
  await page.goto('/home');
  await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
}

async function seam(page: Page, valor: string): Promise<void> {
  await page.evaluate(({ k, v }) => localStorage.setItem(k, v), { k: SEAM, v: valor });
}

/** Los textos de mis entradas, en orden. */
const misTextos = (page: Page) => mio(page).locator('.nts-nota-texto, .nts-lista-titulo').allTextContents();

for (const ancho of [375, 390] as const) {
  test.describe(`D290 · a ${ancho}`, () => {
    test.use({ viewport: { width: ancho, height: ancho === 375 ? 667 : 844 } });

    test('🔴 la fila «Notas»: debajo de «Ver balance» (D297: «Configuración» pasó a la tarjeta), con «2 de 4 escribieron» y el punto, que se apaga al abrir', async ({ page }) => {
      await conViajes(page);
      await alViaje(page, CANCUN);
      const textos = await page.locator('.vjv-scroll-abierto > button').allTextContents();
      const i = textos.findIndex((x) => x.startsWith('Ver balance del viaje'));
      expect(textos.slice(i).map((x) => x.replace(/\s+/g, ' ').trim()))
        .toEqual(['Ver balance del viaje', 'Notas2 de 4 escribieron']);
      await expect(fila(page).getByRole('img', { name: 'Hay notas nuevas', exact: true })).toBeVisible();
      await expect(fila(page)).toHaveAccessibleName('Notas Hay notas nuevas 2 de 4 escribieron');
      await capturar(page, 'fila-con-punto');
      // Medidas de la especificación (§1): 56 de alto, a todo el ancho, el punto de 8 naranja.
      const m = await fila(page).evaluate((b) => {
        const r = b.getBoundingClientRect();
        const p = b.querySelector('.nts-punto')!;
        const cs = getComputedStyle(b);
        return { alto: r.height, radio: cs.borderRadius, color: cs.color, punto: getComputedStyle(p).backgroundColor,
          anchoPunto: p.getBoundingClientRect().width, doc: document.documentElement.scrollWidth };
      });
      // D293 · el radio de su vecina, «Ver balance del viaje»: 22. (D297: «Configuración» pasó al engranaje de la tarjeta.)
      const vecinas = await page.locator('.vjv-ver-balance').evaluateAll((xs) => xs.map((x) => getComputedStyle(x).borderRadius));
      expect(vecinas).toEqual(['22px']);
      expect(m).toMatchObject({ alto: 56, radio: '22px', color: 'rgb(10, 123, 128)', punto: 'rgb(255, 107, 53)', anchoPunto: 8 });
      expect(m.doc).toBeLessThanOrEqual(ancho);
      await fila(page).click();
      await expect(page).toHaveURL(new RegExp(`/viaje-notas/${CANCUN}$`));
      await expect(mio(page)).toBeVisible();
      // «Volver» regresa al viaje, y abrir el pizarrón marcó la visita: el punto ya no está.
      await page.getByRole('button', { name: 'Volver', exact: true }).click();
      await expect(fila(page)).toHaveAccessibleName('Notas 2 de 4 escribieron');
      await expect(fila(page).locator('.nts-punto')).toHaveCount(0);
    });

    test('🔴 el pizarrón: el mío primero y vacío; Luis con 4 líneas y «Ver todo»; la lista de Sofía; Diego sin nada', async ({ page }) => {
      await conViajes(page);
      await alPizarron(page);
      await expect(page.locator('.title-card-sub')).toHaveText('Cancún 2026 · 4 personas');
      const orden = await page.locator('.nts-apartado').evaluateAll((xs) => xs.map((x) => x.getAttribute('aria-label')));
      expect(orden).toEqual(['Tu apartado', 'Apartado de Luis Pérez', 'Apartado de Sofía Ramírez', 'Apartado de Diego Torres']);
      await expect(mio(page).getByText('Todavía no anotaste nada', { exact: true })).toBeVisible();
      await expect(mio(page).getByRole('button', { name: 'Escribir nota', exact: true })).toBeVisible();
      await expect(mio(page).getByRole('button', { name: 'Armar lista', exact: true })).toBeVisible();
      // Luis: 4 líneas a 16/1.5 (96 px) y «Ver todo».
      const nota = de(page, 'Luis Pérez').locator('.nts-nota-texto');
      expect(await nota.evaluate((p) => p.getBoundingClientRect().height)).toBeCloseTo(96, 0);
      await expect(de(page, 'Luis Pérez').getByRole('button', { name: 'Ver todo', exact: true })).toBeVisible();
      await expect(de(page, 'Sofía Ramírez').locator('.nts-lista-cuenta')).toHaveText('2 de 5');
      await expect(de(page, 'Diego Torres')).toContainText('Todavía no anotó nada');
      // Los de los demás no tienen ningún control: ni menú, ni casillas tocables, ni botones de escribir.
      for (const n of ['Luis Pérez', 'Sofía Ramírez', 'Diego Torres']) {
        await expect(de(page, n).getByRole('checkbox')).toHaveCount(0);
        await expect(de(page, n).getByRole('button', { name: /Editar|Nota|Lista/ })).toHaveCount(0);
      }
      await expect(page.getByRole('heading', { name: 'Notas', level: 1 })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(ancho);
      await capturar(page, 'pizarron');
    });

    test('🔴 escribir una nota: la hoja con el contador, Guardar, y queda en mi apartado («3 de 4 escribieron»)', async ({ page }) => {
      await conViajes(page);
      await alPizarron(page);
      await mio(page).getByRole('button', { name: 'Escribir nota', exact: true }).click();
      const h = hoja(page, 'Nota nueva');
      await expect(h).toBeVisible();
      await expect(h.getByRole('button', { name: 'Guardar', exact: true })).toBeDisabled();
      await h.getByRole('textbox', { name: 'Nota', exact: true }).fill('El sábado reservo la lancha');
      await expect(h.locator('.nts-contador')).toHaveText('27 / 500');
      await expect(h.locator('.nts-contador')).not.toHaveClass(/nts-contador-cerca/);
      await expect(h.getByText('La ven todos los del viaje.', { exact: true })).toBeVisible();
      await capturar(page, 'hoja-nota');
      await h.getByRole('button', { name: 'Guardar', exact: true }).click();
      await expect(h).toHaveCount(0);
      await expect(toast(page)).toContainText('Nota agregada');
      expect(await misTextos(page)).toEqual(['El sábado reservo la lancha']);
      await expect(mio(page).locator('.nts-resumen')).toHaveText('Tu apartado · 1 nota');
      await expect(mio(page).getByRole('button', { name: 'Nota nueva', exact: true })).toBeVisible();
      await expect(mio(page).getByRole('button', { name: 'Lista nueva', exact: true })).toBeVisible();
      await capturar(page, 'con-mi-nota');
      await page.getByRole('button', { name: 'Volver', exact: true }).click();
      await expect(fila(page)).toHaveAccessibleName('Notas 3 de 4 escribieron');
    });

    test('🔴 armar una lista y tildarla tocando todo el renglón; queda al volver a entrar', async ({ page }) => {
      await conViajes(page);
      await alPizarron(page);
      await mio(page).getByRole('button', { name: 'Armar lista', exact: true }).click();
      const h = hoja(page, 'Lista nueva');
      await h.getByRole('textbox', { name: 'Título de la lista', exact: true }).fill('Para llevar');
      const nuevo = h.getByRole('textbox', { name: 'Agregar ítem', exact: true });
      await nuevo.fill('Protector solar');
      await nuevo.press('Enter');
      await nuevo.fill('Gorra');
      await h.getByRole('button', { name: 'Agregar', exact: true }).click();
      await nuevo.fill('Efectivo');
      await nuevo.press('Enter');
      await expect(h.getByRole('textbox', { name: /^Ítem \d+$/ })).toHaveCount(3);
      await expect(h.locator('.nts-hoja-pie .nts-contador')).toHaveText('3 / 30 ítems');
      await expect(h.getByText('Las tildas después, en tu apartado.', { exact: true })).toBeVisible();
      await capturar(page, 'hoja-lista');
      await h.getByRole('button', { name: 'Guardar', exact: true }).click();
      await expect(h).toHaveCount(0);
      await expect(toast(page)).toContainText('Lista agregada');
      const lista = mio(page).locator('.nts-lista');
      await expect(lista.locator('.nts-lista-cuenta')).toHaveText('0 de 3');
      const gorra = lista.getByRole('checkbox', { name: 'Gorra', exact: true });
      // Todo el renglón es el blanco: 44 de alto, a todo el ancho de la lista.
      const caja = await gorra.boundingBox();
      expect(caja!.height).toBeGreaterThanOrEqual(44);
      await gorra.click({ position: { x: caja!.width - 20, y: caja!.height / 2 } });
      await expect(gorra).toHaveAttribute('aria-checked', 'true');
      await expect(lista.locator('.nts-lista-cuenta')).toHaveText('1 de 3');
      await expect(gorra.locator('.nts-item-texto')).toHaveCSS('text-decoration-line', 'line-through');
      await capturar(page, 'lista-tildada');
      // Se vuelve a pedir el pizarrón: la tilde es del dueño, no de la pantalla.
      await page.getByRole('button', { name: 'Volver', exact: true }).click();
      await fila(page).click();
      await expect(mio(page).getByRole('checkbox', { name: 'Gorra', exact: true })).toHaveAttribute('aria-checked', 'true');
      await expect(mio(page).getByRole('checkbox', { name: 'Efectivo', exact: true })).toHaveAttribute('aria-checked', 'false');
    });

    test('🔴 leer el apartado de otro: todo el texto, sólo para leer, con anterior y siguiente', async ({ page }) => {
      await conViajes(page);
      await alPizarron(page);
      await de(page, 'Luis Pérez').getByRole('button', { name: 'Ver todo', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Luis Pérez', level: 1 })).toBeVisible();
      await expect(page.locator('.title-card-sub')).toHaveText('Notas · Cancún 2026');
      const texto = de(page, 'Luis Pérez').locator('.nts-nota-texto');
      await expect(texto).toContainText('le guardo el asiento de adelante.');
      // Entera: sin el recorte de 4 líneas.
      expect(await texto.evaluate((p) => p.scrollHeight <= p.clientHeight + 1 && getComputedStyle(p).webkitLineClamp !== '4')).toBe(true);
      await expect(page.getByText('Sólo Luis puede escribir en su apartado.', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: /Editar|Escribir|Armar|Nota nueva|Lista nueva/ })).toHaveCount(0);
      const anterior = page.getByRole('button', { name: 'Tú', exact: true });
      const siguiente = page.getByRole('button', { name: 'Sofía', exact: true });
      await expect(anterior).toBeVisible();
      await expect(siguiente).toBeVisible();
      expect((await anterior.boundingBox())!.height).toBe(48);
      await capturar(page, 'apartado-de-luis');
      await siguiente.click();
      await expect(page.getByRole('heading', { name: 'Sofía Ramírez', level: 1 })).toBeVisible();
      await expect(de(page, 'Sofía Ramírez').locator('.nts-lista-cuenta')).toHaveText('2 de 5');
      await expect(de(page, 'Sofía Ramírez').getByRole('checkbox')).toHaveCount(0);
      // «Volver» regresa al pizarrón (anterior y siguiente no se apilan).
      await page.getByRole('button', { name: 'Volver', exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/viaje-notas/${CANCUN}$`));
      await expect(mio(page)).toBeVisible();
    });
  });
}

test.describe('D290 · los límites, a la vista (a 390)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('🔴 la nota: el contador pasa a «Te quedan» desde el 80 % y en 500 ya no deja escribir', async ({ page }) => {
    await conViajes(page);
    await alPizarron(page);
    await mio(page).getByRole('button', { name: 'Escribir nota', exact: true }).click();
    const h = hoja(page, 'Nota nueva');
    const campo = h.getByRole('textbox', { name: 'Nota', exact: true });
    await campo.fill('a'.repeat(399));
    await expect(h.locator('.nts-contador')).toHaveText('399 / 500');
    await campo.fill('a'.repeat(400));
    await expect(h.locator('.nts-contador')).toHaveText('Te quedan 100');
    await expect(h.locator('.nts-contador')).toHaveClass(/nts-contador-cerca/);
    await expect(h.locator('.nts-contador')).toHaveCSS('background-color', 'rgb(255, 251, 235)');
    await capturar(page, 'nota-cerca');
    await campo.fill('a'.repeat(500));
    await expect(h.locator('.nts-contador')).toHaveText('Llegaste a 500');
    await campo.press('End');
    await campo.pressSequentially('bcd');
    expect((await campo.inputValue()).length).toBe(500);
    // Pegar de más tampoco pasa el tope.
    await campo.fill('');
    await campo.evaluate((t: HTMLTextAreaElement) => { t.focus(); });
    await page.keyboard.insertText('x'.repeat(600));
    expect((await campo.inputValue()).length).toBe(500);
  });

  test('🔴 la lista: título e ítems de 80, 30 ítems y ya no deja agregar', async ({ page }) => {
    await conViajes(page);
    await alPizarron(page);
    await mio(page).getByRole('button', { name: 'Armar lista', exact: true }).click();
    const h = hoja(page, 'Lista nueva');
    const titulo = h.getByRole('textbox', { name: 'Título de la lista', exact: true });
    await titulo.fill('t'.repeat(90));
    expect((await titulo.inputValue()).length).toBe(80);
    await expect(h.locator('.nts-contador').first()).toHaveText('Llegaste a 80');
    const nuevo = h.getByRole('textbox', { name: 'Agregar ítem', exact: true });
    await nuevo.fill('i'.repeat(90));
    expect((await nuevo.inputValue()).length).toBe(80);
    for (let k = 1; k <= 30; k += 1) {
      await nuevo.fill(`Cosa ${k}`);
      await nuevo.press('Enter');
    }
    await expect(h.getByRole('textbox', { name: /^Ítem \d+$/ })).toHaveCount(30);
    await expect(h.locator('.nts-hoja-pie .nts-contador')).toHaveText('Llegaste a 30 ítems');
    await expect(nuevo).toBeDisabled();
    await expect(h.getByRole('button', { name: 'Agregar', exact: true })).toBeDisabled();
    await capturar(page, 'lista-llena');
    await h.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(mio(page).locator('.nts-lista-cuenta')).toHaveText('0 de 30');
  });

  test('🔴 20 notas y listas: + Nota y + Lista se apagan con el aviso del tope', async ({ page }) => {
    await conViajes(page);
    await editarEstado(page, `
      const v = e.viajes.find((x) => x.id === a.cancun);
      for (let k = 0; k < 20; k += 1) v.notas.push({ id: 'd9000000-0000-4000-8000-0000000002' + String(k).padStart(2, '0'), user_id: yo,
        tipo: 'nota', texto: 'Nota ' + k, titulo: null, items: [], version: 1, creado_en: '2026-10-10T00:00:00.000Z',
        actualizado_en: '2026-10-10T00:00:00.000Z', idempotency_key: 'semilla-' + k, pedido_hash: 'semilla' });
    `, { cancun: CANCUN });
    await alPizarron(page);
    await expect(mio(page).getByRole('button', { name: 'Nota nueva', exact: true })).toBeDisabled();
    await expect(mio(page).getByRole('button', { name: 'Lista nueva', exact: true })).toBeDisabled();
    await expect(mio(page).getByText('Llegaste al tope de 20 notas y listas. Borra una para sumar otra.', { exact: true })).toBeVisible();
  });
});

test.describe('D290 · cerrado y esperando pagos: todo para leer', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('🔴 cerrado: la fila va debajo de «Lugares visitados»; el candado y ningún control, ni en lo mío; las tildes como estaban', async ({ page }) => {
    await conViajes(page);
    await irEnLaApp(page, `/viaje-cerrado/${OAXACA}`);
    await expect(fila(page)).toBeVisible();
    const orden = await page.locator('.vj-scroll > *').evaluateAll((xs) => xs.map((x) => x.className));
    const lugares = orden.findIndex((c) => c === 'vjd-lugares');
    expect(orden[lugares + 1]).toBe('nts-fila');
    await expect(fila(page)).toContainText('2 de 5 escribieron');
    await capturar(page, 'cerrado-fila');
    await fila(page).click();
    await expect(page.locator('.nts-candado')).toHaveText('El viaje se cerró el 18 ago. Las notas quedan para leer; ya nadie puede editarlas.');
    await expect(mio(page).locator('.nts-resumen')).toHaveText('Tu apartado · 1 nota, 1 lista');
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Editar o borrar|Nota nueva|Lista nueva|Escribir nota|Armar lista/ })).toHaveCount(0);
    await expect(mio(page).locator('.nts-lista-cuenta')).toHaveText('2 de 3');
    await expect(mio(page).locator('.nts-casilla-tildada')).toHaveCount(2);
    // 2h · cerrado, los que no escribieron van juntos en una línea.
    await expect(page.locator('.nts-sin-notas-texto')).toHaveText('Luis, Sofía y Pablo no dejaron notas');
    await capturar(page, 'cerrado-pizarron');
  });

  test('esperando pagos: la fila antes de «Salir del viaje» y el pizarrón para leer', async ({ page }) => {
    await conViajes(page);
    await alViaje(page, MONTERREY);
    const textos = (await page.locator('.vj-scroll > button').allTextContents()).map((x) => x.replace(/\s+/g, ' ').trim());
    expect(textos.slice(-2)).toEqual(['Notas0 de 3 escribieron', 'Salir del viaje']);
    await fila(page).click();
    await expect(page.locator('.nts-candado')).toContainText('El viaje se cerró el 22 sep.');
    await expect(mio(page).getByText('Todavía no anotaste nada', { exact: true })).toBeVisible();
    await expect(mio(page).getByRole('button', { name: 'Escribir nota', exact: true })).toHaveCount(0);
  });
});

test.describe('D290 · el menú ⋯: editar y borrar lo mío', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  async function conMiNota(page: Page): Promise<void> {
    await conViajes(page);
    await alPizarron(page);
    await mio(page).getByRole('button', { name: 'Escribir nota', exact: true }).click();
    await hoja(page, 'Nota nueva').getByRole('textbox', { name: 'Nota', exact: true }).fill('Llevo la bocina');
    await hoja(page, 'Nota nueva').getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(mio(page).locator('.nts-nota-texto')).toHaveText('Llevo la bocina');
  }

  test('editar: la hoja con lo que había; Guardar lo cambia', async ({ page }) => {
    await conMiNota(page);
    await mio(page).getByRole('button', { name: 'Editar o borrar la nota', exact: true }).click();
    await capturar(page, 'menu');
    await hoja(page, 'Tu nota').getByRole('button', { name: 'Editar nota', exact: true }).click();
    const h = hoja(page, 'Editar nota');
    await expect(h.getByRole('textbox', { name: 'Nota', exact: true })).toHaveValue('Llevo la bocina');
    await h.getByRole('textbox', { name: 'Nota', exact: true }).fill('Llevo la bocina y el cargador grande.');
    await h.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(toast(page)).toContainText('Nota guardada');
    await expect(mio(page).locator('.nts-nota-texto')).toHaveText('Llevo la bocina y el cargador grande.');
  });

  test('borrar: desde el menú, y mi apartado vuelve a estar vacío', async ({ page }) => {
    await conMiNota(page);
    await mio(page).getByRole('button', { name: 'Editar o borrar la nota', exact: true }).click();
    await hoja(page, 'Tu nota').getByRole('button', { name: 'Borrar nota', exact: true }).click();
    await expect(toast(page)).toContainText('Nota borrada');
    await expect(mio(page).getByText('Todavía no anotaste nada', { exact: true })).toBeVisible();
  });

  test('editar una lista: el título y los ítems, conservando la tilde de los que quedan', async ({ page }) => {
    await conViajes(page);
    // Cerrado no se edita: se reabre Oaxaca en el mock para tener mi lista con tildes en un viaje abierto.
    await editarEstado(page, `const v = e.viajes.find((x) => x.id === a); v.estado = 'abierto';`, OAXACA);
    await alPizarron(page, OAXACA);
    await mio(page).getByRole('button', { name: 'Editar o borrar la lista', exact: true }).click();
    await hoja(page, 'Para llevar').getByRole('button', { name: 'Editar lista', exact: true }).click();
    const h = hoja(page, 'Editar lista');
    await expect(h.getByRole('textbox', { name: /^Ítem \d+$/ })).toHaveCount(3);
    await h.getByRole('button', { name: 'Quitar Efectivo', exact: true }).click();
    await h.getByRole('textbox', { name: 'Agregar ítem', exact: true }).fill('Toalla');
    await h.getByRole('textbox', { name: 'Agregar ítem', exact: true }).press('Enter');
    await h.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(toast(page)).toContainText('Lista guardada');
    const cajas = mio(page).locator('.nts-lista').getByRole('checkbox');
    expect(await cajas.evaluateAll((xs) => xs.map((x) => `${x.textContent}:${x.getAttribute('aria-checked')}`)))
      .toEqual(['Protector solar:true', 'Gorra:true', 'Toalla:false']);
  });
});

test.describe('🔴 D290 · concurrencia y doble toque', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('doble toque en Guardar: una sola nota', async ({ page }) => {
    await conViajes(page);
    await alPizarron(page);
    await page.evaluate((k) => localStorage.setItem(k, '600'), LATENCIA);
    await mio(page).getByRole('button', { name: 'Escribir nota', exact: true }).click();
    const h = hoja(page, 'Nota nueva');
    await h.getByRole('textbox', { name: 'Nota', exact: true }).fill('Una sola');
    await h.getByRole('button', { name: 'Guardar', exact: true }).dblclick();
    await expect(h).toHaveCount(0);
    expect(await misTextos(page)).toEqual(['Una sola']);
    await page.evaluate((k) => localStorage.setItem(k, '0'), LATENCIA);
    await page.reload();
    await expect(mio(page).locator('.nts-nota-texto')).toHaveCount(1);
  });

  test('la respuesta que no llega: reintentar con lo mismo es la MISMA nota (la clave de idempotencia)', async ({ page }) => {
    await conViajes(page);
    await alPizarron(page);
    await seam(page, 'respuesta_perdida');
    await mio(page).getByRole('button', { name: 'Escribir nota', exact: true }).click();
    const h = hoja(page, 'Nota nueva');
    await h.getByRole('textbox', { name: 'Nota', exact: true }).fill('Reintento');
    await h.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(h.getByRole('alert')).toHaveText('No pudimos guardarla. Prueba de nuevo.');
    await h.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(h).toHaveCount(0);
    expect(await misTextos(page)).toEqual(['Reintento']);
  });

  test('doble toque en un ítem: un solo efecto (queda tildado)', async ({ page }) => {
    await conViajes(page);
    await editarEstado(page, `const v = e.viajes.find((x) => x.id === a); v.estado = 'abierto';`, OAXACA);
    await alPizarron(page, OAXACA);
    await page.evaluate((k) => localStorage.setItem(k, '600'), LATENCIA);
    const efectivo = mio(page).getByRole('checkbox', { name: 'Efectivo', exact: true });
    await efectivo.dblclick();
    await expect(efectivo).toHaveAttribute('aria-checked', 'true');
    await page.evaluate((k) => localStorage.setItem(k, '0'), LATENCIA);
    await page.reload();
    await expect(mio(page).getByRole('checkbox', { name: 'Efectivo', exact: true })).toHaveAttribute('aria-checked', 'true');
  });

  test('🔴 409 de versión: otra pestaña la cambió; la hoja sigue con lo mío y el pizarrón muestra la de ahora; Guardar la reemplaza', async ({ page }) => {
    await conViajes(page);
    await alPizarron(page);
    await mio(page).getByRole('button', { name: 'Escribir nota', exact: true }).click();
    await hoja(page, 'Nota nueva').getByRole('textbox', { name: 'Nota', exact: true }).fill('Primera');
    await hoja(page, 'Nota nueva').getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(mio(page).locator('.nts-nota-texto')).toHaveText('Primera');
    await seam(page, 'otra_pestana');
    await mio(page).getByRole('button', { name: 'Editar o borrar la nota', exact: true }).click();
    await hoja(page, 'Tu nota').getByRole('button', { name: 'Editar nota', exact: true }).click();
    const h = hoja(page, 'Editar nota');
    await h.getByRole('textbox', { name: 'Nota', exact: true }).fill('Mía');
    await h.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(h.getByRole('alert')).toHaveText('Esta nota cambió en otro lado. Si guardas, reemplazas esa versión.');
    await expect(h.getByRole('textbox', { name: 'Nota', exact: true })).toHaveValue('Mía');
    await expect(mio(page).locator('.nts-nota-texto')).toHaveText('Primera (editada en otra pestaña)');
    await capturar(page, 'conflicto');
    await h.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(h).toHaveCount(0);
    await expect(mio(page).locator('.nts-nota-texto')).toHaveText('Mía');
  });
});

test.describe('🔴 D290 · los errores del dueño, explicados', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  async function conMiNota(page: Page): Promise<Locator> {
    await conViajes(page);
    await alPizarron(page);
    await mio(page).getByRole('button', { name: 'Escribir nota', exact: true }).click();
    await hoja(page, 'Nota nueva').getByRole('textbox', { name: 'Nota', exact: true }).fill('Mi nota');
    await hoja(page, 'Nota nueva').getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(mio(page).locator('.nts-nota-texto')).toHaveText('Mi nota');
    return mio(page).getByRole('button', { name: 'Editar o borrar la nota', exact: true });
  }

  test('404 de la nota (otra pestaña la borró): «Ya no estaba» y el pizarrón al día', async ({ page }) => {
    const menu = await conMiNota(page);
    await seam(page, 'ya_no_estaba');
    await menu.click();
    await hoja(page, 'Tu nota').getByRole('button', { name: 'Borrar nota', exact: true }).click();
    await expect(toast(page)).toContainText('Ya no estaba');
    await expect(mio(page).getByText('Todavía no anotaste nada', { exact: true })).toBeVisible();
  });

  test('409 viaje_not_open (se cerró en el medio): el aviso y el pizarrón pasa a sólo lectura', async ({ page }) => {
    const menu = await conMiNota(page);
    await seam(page, 'se_cerro');
    await menu.click();
    await hoja(page, 'Tu nota').getByRole('button', { name: 'Editar nota', exact: true }).click();
    await hoja(page, 'Editar nota').getByRole('textbox', { name: 'Nota', exact: true }).fill('Otra');
    await hoja(page, 'Editar nota').getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(toast(page)).toContainText('El viaje ya no está abierto');
    await expect(page.locator('.nts-candado')).toContainText('El viaje se cerró el 13 oct.');
    await expect(mio(page).getByRole('button', { name: 'Editar o borrar la nota', exact: true })).toHaveCount(0);
    await expect(mio(page).locator('.nts-nota-texto')).toHaveText('Mi nota');
  });

  test('403 user_suspended y viaje_nota_not_yours: el aviso de cada uno', async ({ page }) => {
    const menu = await conMiNota(page);
    await seam(page, 'suspendida');
    await menu.click();
    await hoja(page, 'Tu nota').getByRole('button', { name: 'Borrar nota', exact: true }).click();
    await expect(toast(page)).toContainText('Tu cuenta está suspendida. Escríbenos.');
    await seam(page, 'no_es_tuya');
    await mio(page).getByRole('button', { name: 'Editar o borrar la nota', exact: true }).click();
    await hoja(page, 'Tu nota').getByRole('button', { name: 'Borrar nota', exact: true }).click();
    await expect(toast(page)).toContainText('Sólo puedes cambiar lo tuyo.');
    await expect(mio(page).locator('.nts-nota-texto')).toHaveText('Mi nota');
  });

  test('400 con su mensaje: en la hoja, que sigue abierta con lo escrito', async ({ page }) => {
    await conViajes(page);
    await alPizarron(page);
    await seam(page, 'invalido');
    await mio(page).getByRole('button', { name: 'Escribir nota', exact: true }).click();
    const h = hoja(page, 'Nota nueva');
    await h.getByRole('textbox', { name: 'Nota', exact: true }).fill('Texto');
    await h.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(h.getByRole('alert')).toHaveText('Hay un carácter que no se puede guardar. Bórralo y prueba de nuevo.');
    await expect(h.getByRole('textbox', { name: 'Nota', exact: true })).toHaveValue('Texto');
  });

  test('409 viaje_notas_limit (llegó al tope en otra pestaña): el aviso en la hoja', async ({ page }) => {
    await conViajes(page);
    await alPizarron(page);
    await mio(page).getByRole('button', { name: 'Escribir nota', exact: true }).click();
    // Otra pestaña completó las 20 mientras esta hoja estaba abierta.
    await page.evaluate(({ k, cancun }) => {
      const e = JSON.parse(localStorage.getItem(k)!);
      const v = e.viajes.find((x: { id: string }) => x.id === cancun);
      const yo = JSON.parse(localStorage.getItem('payme_mock_state_v1')!).user.id;
      for (let n = 0; n < 20; n += 1) v.notas.push({ id: `d9000000-0000-4000-8000-0000000003${String(n).padStart(2, '0')}`, user_id: yo,
        tipo: 'nota', texto: `Nota ${n}`, titulo: null, items: [], version: 1, creado_en: '2026-10-10T00:00:00.000Z',
        actualizado_en: '2026-10-10T00:00:00.000Z', idempotency_key: `otra-${n}`, pedido_hash: 'otra' });
      localStorage.setItem(k, JSON.stringify(e));
    }, { k: ESTADO, cancun: CANCUN });
    await page.evaluate(async () => {
      const r = '/src/api/mock/viajes.ts';
      (await import(/* @vite-ignore */ r)).olvidarViajesMockParaTests();
    });
    const h = hoja(page, 'Nota nueva');
    await h.getByRole('textbox', { name: 'Nota', exact: true }).fill('La 21');
    await h.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(h.getByRole('alert')).toHaveText('Llegaste al tope de 20 notas y listas. Borra una para sumar otra.');
  });
});

/**
 * El dueño de la sesión es la familia más la persona (`duenoDeSesion`). Con otra familia, `AuthProvider` remonta la app
 * entera; con otra persona de la misma familia NO la remonta: ahí cuidan las guardas de la pantalla (el turno de cada
 * pedido y `alVaciarse`). Se prueban las dos.
 */
const CAMBIOS = {
  'otra familia': { family_id: 'familia-sintetica-b', principal_id: 'cuenta-b' },
  'otra persona de la misma familia': { principal_id: 'cuenta-b' },
} as const;

async function cambiarDeCuenta(page: Page, cambio: (typeof CAMBIOS)[keyof typeof CAMBIOS], latenciaDeB: string): Promise<void> {
  await page.evaluate(async ({ k, lat, c }) => {
    localStorage.setItem(k, lat);
    const r = '/src/api/storage.ts';
    const store = await import(/* @vite-ignore */ r);
    const a = store.loadSession();
    store.saveSession({ ...a, ...c, user: { ...a.user, id: c.principal_id } });
  }, { k: LATENCIA, lat: latenciaDeB, c: cambio });
}

for (const [nombre, cambio] of Object.entries(CAMBIOS)) {
  test.describe(`🔴 D290 · privacidad, con ${nombre}: nada de las notas de A queda a la vista de B`, () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('A con el pizarrón abierto → entra B: las notas desaparecen en el acto, antes de que llegue nada', async ({ page }) => {
      await conViajes(page);
      await alPizarron(page);
      await expect(de(page, 'Luis Pérez').locator('.nts-nota-texto')).toContainText('Llegamos el domingo');
      await cambiarDeCuenta(page, cambio, '5000');
      await expect(page.locator('.nts-nota-texto')).toHaveCount(0);
      await expect(page.locator('.nts-apartado')).toHaveCount(0);
      await expect(page.getByText('Llegamos el domingo')).toHaveCount(0);
    });

    test('A pide el pizarrón (en vuelo) → entra B: lo de A, al llegar, se descarta; el pedido de B se muestra', async ({ page }) => {
      await conViajes(page);
      await alViaje(page, CANCUN);
      // El pedido de A tarda 3 s; el de B, 5 s desde el cambio: hay una ventana en la que sólo llegó lo de A.
      await page.evaluate((k) => localStorage.setItem(k, '3000'), LATENCIA);
      await fila(page).click();
      await expect(page.locator('[aria-busy="true"]')).toBeVisible();
      const t0 = Date.now();
      await page.waitForTimeout(1000);
      await cambiarDeCuenta(page, cambio, '5000');
      // Ya llegó lo de A (a los 3 s) y todavía no lo de B (a los ~6 s): no se ve nada de A.
      await page.waitForTimeout(Math.max(0, 4300 - (Date.now() - t0)));
      await expect(page.locator('.nts-apartado')).toHaveCount(0);
      await expect(page.locator('[aria-busy="true"]')).toBeVisible();
      // Llega lo de B: la pantalla no quedó trabada.
      await expect(page.locator('.nts-apartado').first()).toBeVisible({ timeout: 10_000 });
    });
  });
}

test.describe('D290 · con 6 o más personas (a 390)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('la tira fija arriba, «Con notas» (el último que escribió primero) y «Sin notas todavía»', async ({ page }) => {
    await conViajes(page);
    await editarEstado(page, `
      const v = e.viajes.find((x) => x.id === a);
      const base = v.miembros[0];
      const nombres = [['Marta', 'Gil'], ['Andrés', 'Soto'], ['Rosa', 'Díaz']];
      nombres.forEach(([n, ap], k) => v.miembros.push({ ...base, id: 'd4000000-0000-4000-8000-0000000009' + k + '0',
        user_id: 'c1000000-0000-4000-8000-0000000009' + k + '0', first_name: n, last_name: ap, username: null,
        created_at: '2026-10-02T00:00:0' + k + '.000Z', estado: 'activo' }));
      v.notas.push({ id: 'd9000000-0000-4000-8000-000000000990', user_id: 'c1000000-0000-4000-8000-000000000900', tipo: 'nota',
        texto: 'Gracias por organizar.', titulo: null, items: [], version: 1, creado_en: '2026-10-10T10:00:00.000Z',
        actualizado_en: '2026-10-10T10:00:00.000Z', idempotency_key: 'marta', pedido_hash: 'semilla' });
    `, CANCUN);
    await alPizarron(page);
    await expect(page.locator('.title-card-sub')).toHaveText('Cancún 2026 · 7 personas');
    const tira = page.getByRole('navigation', { name: 'Personas del viaje', exact: true });
    await expect(tira).toBeVisible();
    expect(await tira.locator('.nts-tira-nombre').allTextContents()).toEqual(['Tú', 'Marta', 'Luis', 'Sofía', 'Diego', 'Andrés', 'Rosa']);
    await expect(page.getByRole('heading', { name: 'Con notas · 3', exact: true })).toBeVisible();
    expect(await page.locator('.nts-fila-persona .nts-nombre').allTextContents()).toEqual(['Marta Gil', 'Luis Pérez', 'Sofía Ramírez']);
    await expect(page.getByRole('heading', { name: 'Sin notas todavía · 3', exact: true })).toBeVisible();
    await expect(page.locator('.nts-sin-notas-texto')).toHaveText('Diego, Andrés y Rosa');
    await capturar(page, 'muchos');
    // Fija: al bajar, la tira sigue arriba.
    await page.locator('.nts-scroll').evaluate((s) => { s.scrollTop = s.scrollHeight; });
    const antes = await tira.boundingBox();
    expect(antes!.y).toBeLessThan(260);
    await expect(tira).toBeInViewport();
    await capturar(page, 'muchos-abajo');
    // Una fila abre su apartado.
    await page.locator('.nts-fila-persona').filter({ hasText: 'Marta Gil' }).click();
    await expect(page.getByRole('heading', { name: 'Marta Gil', level: 1 })).toBeVisible();
  });
});
