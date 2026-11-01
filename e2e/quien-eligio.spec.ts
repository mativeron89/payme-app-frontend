import { expect, test, type Locator, type Page } from '@playwright/test';
import { abrirMesaConLink, ingresar } from './_app';
import { enTuMesaConLaLista } from './_mesa';

/**
 * D622 · AF-4 · mejoras 2 y 3 · D628 · D639 · quién eligió cada plato (iniciales) y «Se sumaron N de M», con
 * `members_version=1` (App Backend 2.210.0, `contract/mesa-miembros-v1.json`).
 *
 * Se mide en el mock, con los pagos apagados: la mesa del organizador (La Parolaccia, $840, 4 personas). El mock
 * tiene a quien mira y a «los demás» juntos (iniciales inventadas fijas, «AM»). Para más personas se reemplaza la
 * respuesta de la FACHADA (`api.getMesa`) con la forma exacta del contrato: así se prueba el decodificador y la
 * pantalla con lo que manda el dueño, no con lo que el mock sabe armar.
 *
 * 🔴 Lo que esto NO prueba: el dueño servido. Eso lo cierra la prueba de Mati en el iPhone (D63).
 *
 * Capturas a 390×844 (proyecto `movil`) sólo con `PAYME_E2E_CAPTURAS`, con datos de ejemplo (D542).
 */

async function capturar(page: Page, nombre: string, mostrar?: Locator): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (!dir) return;
  if (mostrar) await mostrar.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: `${dir}/${test.info().project.name}-${nombre}.png`, animations: 'disabled' });
}

async function abrirMesa(page: Page, opciones: { modo?: 'consumo' | 'igual'; antiguo?: boolean; idioma?: 'es' | 'en' } = {}): Promise<string> {
  await page.addInitScript((o) => {
    localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled');
    if (o.antiguo) localStorage.setItem('payme.app.mock.miembros.v1', 'antiguo');
  }, { antiguo: opciones.antiguo === true });
  await ingresar(page);
  const mesa = await abrirMesaConLink(page, { sinGarantia: true, modo: opciones.modo ?? 'consumo' });
  if (opciones.idioma === 'en') await page.evaluate(() => localStorage.setItem('payme.app.idioma.v1', 'en'));
  await page.goto(`/mesa/${mesa.code}`);
  if (opciones.idioma !== 'en') await enTuMesaConLaLista(page);
  return mesa.code;
}

/** «Los demás» (el mock: `who: 'other'`) tomaron ½ Pizza y el Tiramisú entero. */
async function plantarAjenos(page: Page, code: string): Promise<void> {
  await page.evaluate(async (c) => {
    const ruta = '/src/api/mock/store.ts';
    const store = await import(/* @vite-ignore */ ruta) as {
      state: { mesas: Array<{ code: string; items: Array<{ name: string; claims: unknown[] }> }> };
      persist: () => void;
    };
    const mesa = store.state.mesas.find((m) => m.code === c);
    if (!mesa) throw new Error(`mesa ${c} ausente`);
    mesa.items.find((i) => i.name === 'Pizza Margherita')!.claims = [
      { who: 'other', fraction_bps: 5000, amount_cents: null, status: 'locked' },
    ];
    mesa.items.find((i) => i.name === 'Tiramisú')!.claims = [
      { who: 'other', fraction_bps: 10000, amount_cents: null, status: 'locked' },
    ];
    store.persist();
    await new Promise<void>((r) => queueMicrotask(r));
  }, code);
  await page.reload();
}

type Ficha = { ordinal: number; initials: string; mine: boolean };
/**
 * Reemplaza lo que el dueño manda de «los de la mesa»: `members` y, por nombre de plato, `picked_by`/`picked_by_more`.
 * `null` en `members` y `porPlato: 'nulos'` imitan la invitación sin aceptar.
 */
async function respuestaDelDueno(page: Page, datos: {
  members: unknown;
  porPlato: Record<string, { picked_by: Ficha[] | null; picked_by_more: number | null }> | 'nulos';
}): Promise<void> {
  await page.evaluate(async (d) => {
    const ruta = '/src/api/index.ts';
    const { api } = await import(/* @vite-ignore */ ruta) as { api: Record<string, unknown> };
    const w = window as unknown as { __getMesaOriginal?: unknown };
    w.__getMesaOriginal ??= api.getMesa;
    const original = w.__getMesaOriginal as (...a: unknown[]) => Promise<{ mesa: { items: Array<Record<string, unknown>> } & Record<string, unknown> }>;
    api.getMesa = async (...a: unknown[]) => {
      const r = await original(...a);
      const items = r.mesa.items.map((i) => {
        if (d.porPlato === 'nulos') return { ...i, picked_by: null, picked_by_more: null };
        const p = d.porPlato[String(i.name)];
        return p ? { ...i, ...p } : i;
      });
      return { ...r, mesa: { ...r.mesa, items, members: d.members } };
    };
  }, datos);
  // La próxima lectura (al volver a la app) ya trae lo nuevo.
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
}

const renglon = (page: Page, nombre: string): Locator => page.locator(`.qc-renglon[data-plato="${nombre}"]`).first();
const f = (ordinal: number, initials: string, mine = false): Ficha => ({ ordinal, initials, mine });

test.describe('D622 · AF-4 · quién eligió cada plato', () => {
  test('🔴 con el dato del mock: «Lo eligió AM» en lugar de «Lo eligió otro», con su ficha y su precio, nunca un nombre', async ({ page }) => {
    const code = await abrirMesa(page);
    await plantarAjenos(page, code);
    await enTuMesaConLaLista(page);

    const tiramisu = renglon(page, 'Tiramisú').locator('[data-estado="tomado"]');
    await expect(tiramisu).toBeVisible();
    await expect(tiramisu.locator('.qc-quien .qc-etiqueta')).toHaveText('Lo eligió AM');
    await expect(tiramisu).not.toContainText('Lo eligió otro');
    await expect(tiramisu.locator('.qc-ficha')).toHaveText(['AM']);
    // D639 · el plato de una sola persona: sus iniciales y su precio.
    const precio = (await tiramisu.locator('.qc-precio').textContent())!;
    expect(precio).toMatch(/^\$/);
    await expect(tiramisu).toHaveAttribute('aria-label', `Tiramisú, ${precio}, Lo eligió AM`);
    // Las fichas son decorativas: el texto es lo que se lee.
    await expect(tiramisu.locator('.qc-fichas')).toHaveAttribute('aria-hidden', 'true');

    // A medias: la ficha debajo del nombre y la píldora «Queda ½», que se sigue pudiendo tocar.
    const pizza = renglon(page, 'Pizza Margherita');
    const libre = pizza.locator('[data-estado="queda"]');
    await expect(libre).toBeVisible();
    await expect(libre.locator('.qc-quien .qc-etiqueta')).toHaveText('Lo eligió AM');
    await expect(libre.locator('.qc-pildora--queda')).toHaveText('Queda ½');
    await expect(libre).toHaveAttribute('aria-label', 'Pizza Margherita, $185, Lo eligió AM, Queda ½');

    // Un plato que no eligió nadie: como siempre, sin fichas.
    await expect(renglon(page, 'Risotto ai Funghi').locator('.qc-ficha')).toHaveCount(0);
    // Ningún nombre de nadie en la lista: el del mock es «Matías» (quien mira) y los demás no tienen nombre.
    const lista = await page.locator('.qc-lista').innerText();
    expect(lista).not.toMatch(/Matías|Verón/);
    // El contraste de la ficha: blanco sobre su tono (lo mide `quienEligioView.test.ts`); acá, que el tono se aplique.
    const fondo = await tiramisu.locator('.qc-ficha').evaluate((e) => getComputedStyle(e).backgroundColor);
    expect(fondo).not.toBe('rgba(0, 0, 0, 0)');
    await capturar(page, 'quien-eligio-01-lista', pizza);
  });

  test('🔴 lo propio que comparte alguien más: «Tú» y las iniciales del otro en el renglón propio', async ({ page }) => {
    const code = await abrirMesa(page);
    await plantarAjenos(page, code);
    await enTuMesaConLaLista(page);
    // El borrador (todavía sin guardar): el dueño dice que la eligió AM.
    await renglon(page, 'Pizza Margherita').getByRole('button', { name: /^Pizza Margherita/ }).click();
    const mio = renglon(page, 'Pizza Margherita').locator('[data-estado="mio"]');
    await expect(mio).toBeVisible();
    await expect(mio.locator('.qc-quien .qc-etiqueta')).toHaveText('Lo eligió AM');
    // Guardado: quien mira tiene la otra mitad, registrada en la mesa (se planta en el mock y se relee).
    await page.evaluate(async (c) => {
      const ruta = '/src/api/mock/store.ts';
      const store = await import(/* @vite-ignore */ ruta) as {
        state: { mesas: Array<{ code: string; items: Array<{ name: string; claims: unknown[] }> }> };
        persist: () => void;
      };
      const mesa = store.state.mesas.find((m) => m.code === c)!;
      mesa.items.find((i) => i.name === 'Pizza Margherita')!.claims = [
        { who: 'other', fraction_bps: 5000, amount_cents: null, status: 'locked' },
        { who: 'user', fraction_bps: 5000, amount_cents: null, status: 'locked' },
      ];
      store.persist();
      await new Promise<void>((r) => queueMicrotask(r));
    }, code);
    await page.reload();
    await enTuMesaConLaLista(page);
    const registrado = renglon(page, 'Pizza Margherita').locator('[data-estado="registrado"]');
    await expect(registrado).toBeVisible();
    await expect(registrado.locator('.qc-quien .qc-etiqueta')).toHaveText('Lo eligieron tú y AM');
    await expect(registrado.locator('.qc-ficha')).toHaveText(['Tú', 'AM']);
    await expect(registrado.locator('.qc-ficha--tu')).toHaveText('Tú');
    await expect(registrado).toHaveAttribute('aria-label', /, Lo eligieron tú y AM$/);
    await capturar(page, 'quien-eligio-02-propio-compartido', registrado);
  });

  test('🔴 muchas personas en un plato: hasta 3 fichas y «+N»; el texto cuenta a todos', async ({ page }) => {
    const code = await abrirMesa(page);
    await plantarAjenos(page, code);
    await enTuMesaConLaLista(page);
    const seis = [f(1, 'AM'), f(2, 'LP'), f(3, 'JR'), f(4, 'SF'), f(5, 'MR'), f(6, 'L')];
    await respuestaDelDueno(page, {
      members: { joined_count: 9, expected_count: 10, list: [f(0, 'MV', true), ...seis, f(7, 'ÁÑ'), f(8, '?')], list_more: 0 },
      porPlato: { 'Tiramisú': { picked_by: seis, picked_by_more: 2 } },
    });
    const tiramisu = renglon(page, 'Tiramisú').locator('[data-estado="tomado"]');
    await expect(tiramisu.locator('.qc-quien .qc-etiqueta')).toHaveText('Lo eligieron AM, LP y 6 más');
    await expect(tiramisu.locator('.qc-ficha')).toHaveText(['AM', 'LP', 'JR', '+5']);
  });

  test('🔴 la tarjeta del estado: «Se sumaron N de M» con las fichas y un «?» por cada esperado que falta', async ({ page }) => {
    const code = await abrirMesa(page);
    await plantarAjenos(page, code);
    await enTuMesaConLaLista(page);
    const tarjeta = page.locator('.estado-mesa');
    await expect(tarjeta).toBeVisible();
    // Quien mira (organizador) y «los demás»: 2 de los 4 esperados.
    await expect(tarjeta.locator('.estado-mesa-personas-texto')).toHaveText('Se sumaron 2 de 4');
    await expect(tarjeta.locator('.estado-mesa-personas .qc-ficha')).toHaveText(['Tú', 'AM', '?', '?']);
    await expect(tarjeta.locator('.qc-ficha--falta')).toHaveCount(2);
    // Sólo el titular se anuncia.
    await expect(tarjeta.locator('[role="status"]')).toHaveCount(1);
    await capturar(page, 'quien-eligio-03-estado-de-la-mesa', tarjeta);
  });

  test('🔴 dueño anterior (sin las claves): «Lo eligió otro» y la tarjeta sin conteo, como en 0.272.0', async ({ page }) => {
    const code = await abrirMesa(page, { antiguo: true });
    await plantarAjenos(page, code);
    await enTuMesaConLaLista(page);
    const tiramisu = renglon(page, 'Tiramisú').locator('[data-estado="tomado"]');
    await expect(tiramisu).toContainText('Lo eligió otro');
    await expect(page.locator('.qc-ficha')).toHaveCount(0);
    await expect(page.locator('.estado-mesa')).toBeVisible();
    await expect(page.locator('.estado-mesa-personas')).toHaveCount(0);
  });

  test('🔴 invitación sin aceptar (el dueño manda null): «Lo eligió otro», sin fichas ni conteo', async ({ page }) => {
    const code = await abrirMesa(page);
    await plantarAjenos(page, code);
    await enTuMesaConLaLista(page);
    await respuestaDelDueno(page, { members: null, porPlato: 'nulos' });
    const tiramisu = renglon(page, 'Tiramisú').locator('[data-estado="tomado"]');
    await expect(tiramisu).toContainText('Lo eligió otro');
    await expect(page.locator('.qc-ficha')).toHaveCount(0);
    await expect(page.locator('.estado-mesa-personas')).toHaveCount(0);
  });

  test('🔴 un dato mal formado (una ficha con nombre) se ignora: «Lo eligió otro»', async ({ page }) => {
    const code = await abrirMesa(page);
    await plantarAjenos(page, code);
    await enTuMesaConLaLista(page);
    await respuestaDelDueno(page, {
      members: { joined_count: 2, expected_count: 4, list: [f(0, 'MV', true), { ...f(1, 'AM'), first_name: 'Ana' }], list_more: 0 },
      porPlato: { 'Tiramisú': { picked_by: [{ ...f(1, 'AM'), first_name: 'Ana' } as unknown as Ficha], picked_by_more: 0 } },
    });
    const tiramisu = renglon(page, 'Tiramisú').locator('[data-estado="tomado"]');
    await expect(tiramisu).toContainText('Lo eligió otro');
    await expect(page.locator('.estado-mesa-personas')).toHaveCount(0);
    expect(await page.locator('.screen').innerText()).not.toContain('Ana');
  });

  test('🔴 en partes iguales no hay dueño de un plato (D79): sin fichas aunque el dueño las mande', async ({ page }) => {
    await abrirMesa(page, { modo: 'igual' });
    await respuestaDelDueno(page, {
      members: { joined_count: 2, expected_count: 4, list: [f(0, 'MV', true), f(1, 'AM')], list_more: 0 },
      porPlato: { 'Tiramisú': { picked_by: [f(1, 'AM')], picked_by_more: 0 } },
    });
    await page.waitForTimeout(500);
    await expect(page.locator('.qc-quien')).toHaveCount(0);
  });

  test('EN · «AM picked it» y «2 of 4 have joined»', async ({ page }) => {
    const code = await abrirMesa(page, { idioma: 'en' });
    await plantarAjenos(page, code);
    await expect(page.getByRole('heading', { name: 'Your table', exact: true })).toBeVisible();
    const cabecera = page.getByRole('region', { name: 'Your items', exact: true }).locator('.desplegable-cabecera');
    if ((await cabecera.getAttribute('aria-expanded')) !== 'true') await cabecera.click();
    const tiramisu = renglon(page, 'Tiramisú').locator('[data-estado="tomado"]');
    await expect(tiramisu.locator('.qc-quien .qc-etiqueta')).toHaveText('AM picked it');
    await expect(page.locator('.estado-mesa-personas-texto')).toHaveText('2 of 4 have joined');
  });
});
