import { expect, test, type Page } from '@playwright/test';
import { ingresar, irEnLaApp } from './_app';

/**
 * Decisión 32 (Mati, 2026-09-24) · «Listo» guarda y vuelve a Inicio. Estas
 * pruebas miran lo guardado, así que reentran a la misma mesa después.
 */
async function listoYVolver(page: Page): Promise<void> {
  // n130 · la ruta vive en el path, no en el fragmento.
  const enMesa = await page.evaluate(() => location.pathname);
  await page.getByRole('button', { name: 'Listo', exact: true }).click();
  await expect.poll(() => page.evaluate(() => location.pathname)).toBe('/home');
  await page.goto(enMesa);
}

/**
 * AF-MESA-D79 · desde la decisión 79 la fila de «igual» puede llevar su etiqueta
 * («Queda ½», «Lo eligió otro») en el nombre accesible, como en consumo. Se
 * ancla en el nombre del plato: nunca matchea «Soltar …» ni otro plato.
 */
function plato(nombre: string): RegExp {
  return new RegExp(`^${nombre}(,|$)`);
}

/**
 * AF-QUE-CONSUMISTE · decisión 90 · el renglón del plato. Lo elegido ya no es
 * un botón pulsado (`aria-pressed`): es el renglón propio en teal
 * (`data-estado="mio"`) con la píldora de su porción. Lo que D79 cuida —qué se
 * guardó, qué se bloquea, qué se rehidrata— se mide igual sobre él.
 */
function renglon(page: Page, nombre: string) {
  return page.locator(`.qc-renglon[data-plato="${nombre}"]`).first();
}
function mio(page: Page, nombre: string) {
  return renglon(page, nombre).locator('[data-estado="mio"]');
}

type Forma = 'En partes iguales' | 'Pagar el total';

async function abrirInformativa(page: Page, forma: Forma, participantes: number): Promise<string> {
  await page.addInitScript(() => localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled'));
  await ingresar(page);
  await page.getByRole('button', { name: 'Nueva', exact: true }).click();
  await page.getByRole('button', { name: 'Capturar' }).click();
  const opcion = page.getByRole('radio', { name: new RegExp(forma) });
  await expect(opcion).toBeVisible();
  await opcion.click();
  // La opción UI se acredita ANTES de mapearse al único contrato `igual`.
  await expect(opcion).toHaveAttribute('aria-checked', 'true');

  const mas = page.getByRole('button', { name: 'Un comensal más' });
  const toques = forma === 'Pagar el total' ? participantes : Math.max(1, participantes - 1);
  for (let i = 0; i < toques; i += 1) await mas.click();
  await expect(page.getByRole('group', { name: /¿Cuántos pagan\?/ })).toContainText(String(participantes));
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Compartir la mesa' })).toBeVisible();

  const href = await page.getByRole('link', { name: 'WhatsApp', exact: true }).getAttribute('href');
  const shared = decodeURIComponent(new URL(href!).searchParams.get('text') ?? '');
  const code = /#\/mesa\/(PA-[A-Za-z0-9]+)/.exec(shared)?.[1];
  expect(code).toBeTruthy();

  const created = await page.evaluate((mesaCode) => {
    const st = JSON.parse(localStorage.getItem('payme_mock_state_v1')!);
    const mesa = st.mesas.find((candidate: { code: string }) => candidate.code === mesaCode);
    return { code: mesa.code as string, mode: mesa.division_mode, n: mesa.expected_participants };
  }, code);
  expect(created).toMatchObject({ mode: 'igual', n: participantes });
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByRole('heading', { name: '¿Qué consumiste?' })).toBeVisible();
  return created.code;
}

test.describe('Listo · selección informativa v2', () => {
  test('En partes iguales N≥2 guarda pares exactos, reconcilia respuesta incierta y rehidrata', async ({ page }) => {
    const code = await abrirInformativa(page, 'En partes iguales', 2);
    const first = page.getByRole('button', { name: plato('Tagliatelle Bolognese') });
    await first.click();
    // Con N=2 el selector ofrece Entero y ½ (decisión 90, limitado por N).
    await expect(renglon(page, 'Tagliatelle Bolognese').getByRole('radio')).toHaveText(['Entero', '½']);
    await page.getByRole('radio', { name: '½', exact: true }).click();

    // La mutación llega al mock, pero su respuesta se pierde. La pantalla sólo
    // puede declarar éxito si el GET propio devuelve exactamente el intento.
    await page.evaluate(async () => {
      const route = '/src/api/index.ts';
      const module = await import(/* @vite-ignore */ route);
      const original = module.api.replaceInformativeSelection.bind(module.api);
      module.api.replaceInformativeSelection = async (...args: Parameters<typeof original>) => {
        await original(...args);
        throw new Error('respuesta_perdida');
      };
    });
    await listoYVolver(page);
    await expect(page.getByText('Tu selección quedó guardada.')).toBeVisible();
    await page.reload();
    await expect(mio(page, 'Tagliatelle Bolognese')).toBeVisible();
    await expect(mio(page, 'Tagliatelle Bolognese').locator('.qc-pildora')).toHaveText('½');
    expect(await page.evaluate((mesaCode) => {
      const st = JSON.parse(localStorage.getItem('payme_mock_state_v1')!);
      const mesa = st.mesas.find((candidate: { code: string }) => candidate.code === mesaCode);
      const row = Object.entries(st.informativeSelections)
        .find(([key]) => key.startsWith(`${mesa.id}:`))?.[1] as { items: unknown[] } | undefined;
      return row?.items;
    }, code)).toEqual([expect.objectContaining({ declared_fraction_bps: 5000 })]);
  });

  test('Pagar el total N=1 mapea a igual y Listo envía reemplazo vacío', async ({ page }) => {
    await abrirInformativa(page, 'Pagar el total', 1);
    await page.evaluate(async () => {
      const route = '/src/api/index.ts';
      const module = await import(/* @vite-ignore */ route);
      const original = module.api.replaceInformativeSelection.bind(module.api);
      module.api.replaceInformativeSelection = async (...args: Parameters<typeof original>) => {
        localStorage.setItem('payme.app.e2e.informative-put.v2', JSON.stringify(args[1]));
        return original(...args);
      };
    });
    await listoYVolver(page);
    // Vacío→vacío es replay exacto sin fila en el dueño: al reentrar no hay nada
    // guardado que mostrar (sin `updated_at`), así que el círculo vuelve a ser
    // «Listo». El éxito lo acreditó la vuelta a Inicio (decisión 32).
    await expect(page.getByRole('button', { name: 'Listo', exact: true })).toBeEnabled();
    expect(await page.evaluate(() => JSON.parse(
      localStorage.getItem('payme.app.e2e.informative-put.v2') ?? 'null',
    ))).toEqual({ items: [], confirm_closure: true });
  });

  test('Pagar el total N>1 mapea a igual y conserva fracción declarada', async ({ page }) => {
    await abrirInformativa(page, 'Pagar el total', 3);
    await page.getByRole('button', { name: plato('Risotto ai Funghi') }).click();
    // Con N=3: Entero, ½ y ⅓; ¾ ya no es una opción (decisión 90).
    await expect(renglon(page, 'Risotto ai Funghi').getByRole('radio')).toHaveText(['Entero', '½', '⅓']);
    await page.getByRole('radio', { name: '⅓', exact: true }).click();
    await listoYVolver(page);
    await expect(page.getByText('Tu selección quedó guardada.')).toBeVisible();
    await page.reload();
    await expect(mio(page, 'Risotto ai Funghi').locator('.qc-pildora')).toHaveText('⅓');
  });

  test('capability ausente muestra incompatibilidad y nunca finge guardado', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled'));
    await ingresar(page);
    await page.evaluate(async () => {
      const route = '/src/api/index.ts';
      const module = await import(/* @vite-ignore */ route);
      const original = module.api.getMesa.bind(module.api);
      module.api.getMesa = async (...args: Parameters<typeof original>) => {
        const result = await original(...args);
        delete result.mesa.informative_selection_capability;
        return result;
      };
    });
    await page.goto('/#/mesa/PA-3121');
    await expect(page.getByText('Esta versión del servicio no puede guardar la selección informativa. Nada se marcó como guardado.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Listo', exact: true })).toBeDisabled();
    await expect(page.locator('.qc-libre').first()).toBeDisabled();
    await expect(page.getByText('Tu selección quedó guardada.')).toHaveCount(0);
  });

  test('cerrar por cobertura deja Mis ítems visible, readonly y durable al reingresar', async ({ page }) => {
    await abrirInformativa(page, 'En partes iguales', 2);
    const rows = page.locator('.qc-renglon');
    const total = await rows.count();
    expect(total).toBeGreaterThan(0);
    for (let index = 0; index < total; index += 1) await rows.nth(index).locator('.qc-libre').click();
    await expect(page.locator('.qc-renglon [data-estado="mio"]')).toHaveCount(total);

    // El guardado responde OK y CIERRA la mesa. F-2 (decisión 80): en vez de
    // volver mudo a Inicio se dice «La mesa se cerró»; «Ver la mesa» lleva a
    // la vista de sólo lectura.
    const enMesa = await page.evaluate(() => location.pathname);
    await page.getByRole('button', { name: 'Listo', exact: true }).click();
    await expect(page.getByText('La mesa se cerró', { exact: true })).toBeVisible();
    await expect(page.getByText('Se eligieron todos los consumos.')).toBeVisible();
    expect(await page.evaluate(() => location.pathname)).toBe(enMesa);
    await page.getByRole('button', { name: 'Ver la mesa', exact: true }).click();
    await expect(page.getByText('Esta mesa ya cerró. Lo guardado es sólo de lectura.')).toBeVisible();
    await expect(page.getByRole('heading', { name: '¿Qué consumiste?' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Pagar mi parte' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Listo', exact: true })).toBeDisabled();
    await expect(rows).toHaveCount(total);
    // Sólo lectura: cada renglón es propio y no queda nada tocable adentro.
    for (let index = 0; index < total; index += 1) {
      await expect(rows.nth(index).locator('[data-estado="mio"]')).toBeVisible();
      await expect(rows.nth(index).locator('button:enabled')).toHaveCount(0);
    }

    await page.reload();
    await expect(page.getByText('Esta mesa ya cerró. Lo guardado es sólo de lectura.')).toBeVisible();
    await expect(page.locator('.qc-renglon [data-estado="mio"]')).toHaveCount(total);
  });

  test('reentrada tras cierre por tiempo muestra sólo la selección propia sin afirmar cobros', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled'));
    await ingresar(page);
    await page.evaluate(async () => {
      const route = '/src/api/mock/store.ts';
      const module = await import(/* @vite-ignore */ route);
      const mesa = module.state.mesas.find((candidate: { code: string }) => candidate.code === 'PA-3121');
      mesa.status = 'expired';
      mesa.guarantee_mode = false;
      mesa.guarantee_method = 'none';
      mesa.closure_reason = 'time';
      const item = mesa.items[0];
      module.state.informativeSelections[`${mesa.id}:${module.state.user.id}`] = {
        items: [{ item_id: item.id, declared_fraction_bps: 5000 }],
        updated_at: new Date().toISOString(),
      };
      module.persist();
      location.hash = '#/mesa/PA-3121';
    });

    await expect(page.getByText('Esta mesa ya cerró. Lo guardado es sólo de lectura.')).toBeVisible();
    const saved = mio(page, 'Omakase para dos');
    await expect(saved).toBeVisible();
    await expect(saved.locator('.qc-pildora')).toHaveText('½');
    await expect(renglon(page, 'Omakase para dos').locator('button:enabled')).toHaveCount(0);
    await expect(page.getByText(/Cubrió.*garantía/)).toHaveCount(0);
    await expect(page.getByText('Recibió el restaurante')).toHaveCount(0);
  });

  test('GET inicial fallido bloquea PUT; recuperar habilita un vaciado deliberado', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled'));
    await ingresar(page);
    await page.evaluate(async () => {
      const storeRoute = '/src/api/mock/store.ts';
      const store = await import(/* @vite-ignore */ storeRoute);
      const mesa = store.state.mesas.find((candidate: { code: string }) => candidate.code === 'PA-3121');
      mesa.status = 'open';
      mesa.expires_at = new Date(Date.now() + 60 * 60_000).toISOString();
      mesa.guarantee_mode = false;
      mesa.guarantee_method = 'none';
      mesa.closure_reason = null;
      store.state.informativeSelections[`${mesa.id}:${store.state.user.id}`] = {
        items: [{ item_id: mesa.items[0].id, declared_fraction_bps: 5000 }],
        updated_at: new Date().toISOString(),
      };
      store.persist();

      const apiRoute = '/src/api/index.ts';
      const module = await import(/* @vite-ignore */ apiRoute);
      const originalGet = module.api.getInformativeSelection.bind(module.api);
      const originalPut = module.api.replaceInformativeSelection.bind(module.api);
      let failOnce = true;
      module.api.getInformativeSelection = async (...args: Parameters<typeof originalGet>) => {
        if (failOnce) {
          failOnce = false;
          throw new Error('lectura_inicial_fallida');
        }
        return originalGet(...args);
      };
      module.api.replaceInformativeSelection = async (...args: Parameters<typeof originalPut>) => {
        const calls = Number(localStorage.getItem('payme.app.e2e.r2.puts') ?? '0') + 1;
        localStorage.setItem('payme.app.e2e.r2.puts', String(calls));
        localStorage.setItem('payme.app.e2e.r2.body', JSON.stringify(args[1]));
        return originalPut(...args);
      };
      location.hash = '#/mesa/PA-3121';
    });

    await expect(page.getByText('No pudimos leer tu selección guardada. No vamos a reemplazarla sin recuperarla primero.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Listo', exact: true })).toBeDisabled();
    await expect(page.locator('.qc-libre').first()).toBeDisabled();
    expect(await page.evaluate(() => localStorage.getItem('payme.app.e2e.r2.puts'))).toBeNull();

    await page.getByRole('button', { name: 'Reintentar lectura', exact: true }).click();
    await expect(mio(page, 'Omakase para dos')).toBeVisible();
    // Regla 7 · se suelta tocando el círculo marcado.
    const soltar = page.getByRole('button', { name: 'Soltar Omakase para dos', exact: true });
    await expect(soltar).toBeEnabled();
    await soltar.click();
    await listoYVolver(page);
    // El vaciado borra la fila del dueño: al reentrar no queda `updated_at` ni
    // nota; el éxito lo acreditó la vuelta a Inicio y el PUT medido abajo.
    await expect(renglon(page, 'Omakase para dos').locator('[data-estado="libre"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Listo', exact: true })).toBeEnabled();
    expect(await page.evaluate(() => ({
      calls: localStorage.getItem('payme.app.e2e.r2.puts'),
      body: JSON.parse(localStorage.getItem('payme.app.e2e.r2.body') ?? 'null'),
    }))).toEqual({ calls: '1', body: { items: [], confirm_closure: true } });
  });

  test('GET, PUT y recarga diferidos mantienen editores bloqueados hasta su respuesta', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled'));
    await ingresar(page);
    await page.evaluate(async () => {
      const storeRoute = '/src/api/mock/store.ts';
      const store = await import(/* @vite-ignore */ storeRoute);
      const mesa = store.state.mesas.find((candidate: { code: string }) => candidate.code === 'PA-3121');
      mesa.status = 'open';
      mesa.expires_at = new Date(Date.now() + 60 * 60_000).toISOString();
      mesa.guarantee_mode = false;
      mesa.guarantee_method = 'none';
      mesa.closure_reason = null;
      delete store.state.informativeSelections[`${mesa.id}:${store.state.user.id}`];
      store.persist();

      const apiRoute = '/src/api/index.ts';
      const module = await import(/* @vite-ignore */ apiRoute);
      const originalGet = module.api.getInformativeSelection.bind(module.api);
      const originalPut = module.api.replaceInformativeSelection.bind(module.api);
      let getCalls = 0;
      module.api.getInformativeSelection = async (...args: Parameters<typeof originalGet>) => {
        getCalls += 1;
        const phase = getCalls === 1 ? 'initial' : 'reload';
        localStorage.setItem(`payme.app.e2e.r3.${phase}.waiting`, '1');
        return new Promise((resolve, reject) => {
          (window as unknown as Record<string, unknown>)[`release_${phase}`] = () => {
            void originalGet(...args).then(resolve, reject);
          };
        });
      };
      module.api.replaceInformativeSelection = async (...args: Parameters<typeof originalPut>) => {
        const saved = await originalPut(...args);
        localStorage.setItem('payme.app.e2e.r3.put.waiting', '1');
        localStorage.setItem('payme.app.e2e.r3.put.body', JSON.stringify(args[1]));
        return new Promise((resolve) => {
          (window as unknown as Record<string, unknown>).release_put = () => resolve(saved);
        });
      };
      location.hash = '#/mesa/PA-3121';
    });

    const first = page.getByRole('button', { name: plato('Omakase para dos') });
    const second = page.getByRole('button', { name: plato('Sashimi mixto') });
    await expect(page.getByText('Estamos leyendo tu selección guardada…')).toBeVisible();
    await expect(first).toBeDisabled();
    await page.evaluate(() => ((window as unknown as Record<string, () => void>).release_initial)());
    await expect(first).toBeEnabled();

    await first.click();
    await page.getByRole('button', { name: 'Listo', exact: true }).click();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('payme.app.e2e.r3.put.waiting'))).toBe('1');
    await expect(second).toBeDisabled();
    await page.evaluate(() => ((window as unknown as Record<string, () => void>).release_put)());
    // Decisión 32 · con el PUT OK se vuelve a Inicio; la lectura diferida que
    // antes era la recarga es ahora la del reingreso, y bloquea igual.
    await expect.poll(() => page.evaluate(() => location.pathname)).toBe('/home');
    // n130 · sin recargar: el `api` parchado en memoria tiene que seguir vivo.
    await irEnLaApp(page, '/mesa/PA-3121');

    await expect.poll(() => page.evaluate(() => localStorage.getItem('payme.app.e2e.r3.reload.waiting'))).toBe('1');
    await expect(second).toBeDisabled();
    await page.evaluate(() => ((window as unknown as Record<string, () => void>).release_reload)());
    await expect(second).toBeEnabled();
    await expect(mio(page, 'Omakase para dos')).toBeVisible();
    await expect(renglon(page, 'Sashimi mixto').locator('[data-estado="libre"]')).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(
      localStorage.getItem('payme.app.e2e.r3.put.body') ?? 'null',
    ))).toEqual({
      items: [expect.objectContaining({ declared_fraction_bps: 10000 })],
      confirm_closure: true,
    });
  });

  /**
   * P1 (`AF-LISTO-CONFIRMACION-FRACCIONES-HEADER-CLAUDE-20260922`) · en
   * producción el éxito sólo dejaba un toast de 2,4 s y la persona tocaba
   * «Listo» cuatro veces. Ahora lo guardado queda a la vista: nota fija y
   * círculo «Guardado» deshabilitado, sin navegar; la recarga lo conserva y la
   * primera edición devuelve «Listo».
   */
  test('Listo deja una confirmación fija y «Guardado» hasta editar; la recarga la conserva', async ({ page }) => {
    await abrirInformativa(page, 'En partes iguales', 2);
    const first = page.getByRole('button', { name: plato('Tagliatelle Bolognese') });
    const second = page.getByRole('button', { name: plato('Risotto ai Funghi') });
    const nota = page.getByText('Tu selección quedó guardada. Si cambias algo, vuelve a tocar «Listo».');
    const guardado = page.getByRole('button', { name: 'Guardado', exact: true });
    const listo = page.getByRole('button', { name: 'Listo', exact: true });

    await expect(nota).toHaveCount(0);
    await first.click();
    await listoYVolver(page);
    await expect(nota).toBeVisible();
    // Decisión 32 · «Guardado» sigue tocable: lleva a Inicio sin reenviar lo mismo.
    await expect(guardado).toBeEnabled();
    await expect(listo).toHaveCount(0);
    // De vuelta en la mesa, con la fila guardada a la vista.
    await expect(page.getByRole('heading', { name: '¿Qué consumiste?' })).toBeVisible();
    await expect(mio(page, 'Tagliatelle Bolognese')).toBeVisible();
    // Una sola señal: no hay toast además de la nota.
    await expect(page.locator('.toast:not(.toast-hidden)')).toHaveCount(0);

    await page.reload();
    await expect(nota).toBeVisible();
    await expect(guardado).toBeEnabled();
    await expect(mio(page, 'Tagliatelle Bolognese')).toBeVisible();

    // La primera edición vuelve a «Listo» y retira la nota: lo que se ve ya no es lo guardado.
    await second.click();
    await expect(nota).toHaveCount(0);
    await expect(guardado).toHaveCount(0);
    await expect(listo).toBeEnabled();
  });

  /**
   * v2.124.0 (AB-FRACCIONES-IGUAL, Decisión de Mati e9aa0450…) · en «igual»
   * bajo el corte, con N conocido, las porciones las limita N. La decisión 90
   * (2026-09-26) dejó el selector en Entero · ½ · ⅓ · ¼, sin «Otro»: con N=5
   * se ofrecen las cuatro. Un rechazo del dueño por N se sigue viendo con su
   * copy, no como fallo genérico.
   */
  test('N=5 ofrece Entero · ½ · ⅓ · ¼ sin «Otro»; ¼ guarda 2500 y un rechazo por N es visible', async ({ page }) => {
    const code = await abrirInformativa(page, 'En partes iguales', 5);
    await page.getByRole('button', { name: plato('Tagliatelle Bolognese') }).click();
    const fracciones = page.getByRole('radiogroup', { name: 'Porción de Tagliatelle Bolognese' });
    await expect(fracciones.getByRole('radio')).toHaveText(['Entero', '½', '⅓', '¼']);
    await expect(page.getByRole('radio', { name: 'Otro', exact: true })).toHaveCount(0);
    await expect(fracciones.getByRole('radio', { name: 'Entero', exact: true })).toHaveAttribute('aria-checked', 'true');
    await fracciones.getByRole('radio', { name: '¼', exact: true }).click();

    await page.evaluate(async () => {
      const route = '/src/api/index.ts';
      const module = await import(/* @vite-ignore */ route);
      const original = module.api.replaceInformativeSelection.bind(module.api);
      module.api.replaceInformativeSelection = async (...args: Parameters<typeof original>) => {
        localStorage.setItem('payme.app.e2e.n5.body', JSON.stringify(args[1]));
        return original(...args);
      };
    });
    await listoYVolver(page);
    await expect(page.getByText('Tu selección quedó guardada.')).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('payme.app.e2e.n5.body') ?? 'null')))
      .toEqual({ items: [expect.objectContaining({ declared_fraction_bps: 2500 })], confirm_closure: true });

    // Lo guardado vuelve con su porción en la píldora.
    await page.reload();
    await expect(mio(page, 'Tagliatelle Bolognese').locator('.qc-pildora')).toHaveText('¼');

    // El dueño rechaza por N (400): el front lo dice con su copy y conserva lo guardado.
    await page.getByRole('button', { name: plato('Risotto ai Funghi') }).click();
    await page.evaluate(async () => {
      const route = '/src/api/index.ts';
      const module = await import(/* @vite-ignore */ route);
      const original = module.api.replaceInformativeSelection.bind(module.api);
      module.api.replaceInformativeSelection = async (code: string, req: { items: Array<{ item_id: string; declared_fraction_bps: number }>; confirm_closure: true }) => {
        const forzado = { ...req, items: req.items.map((item) => ({ ...item, declared_fraction_bps: 1666 })) };
        return original(code, forzado as Parameters<typeof original>[1]);
      };
    });
    await page.getByRole('button', { name: 'Listo', exact: true }).click();
    await expect(page.getByText('Esa porción no es válida para esta mesa.')).toBeVisible();
    expect(await page.evaluate((mesaCode) => {
      const st = JSON.parse(localStorage.getItem('payme_mock_state_v1')!);
      const mesa = st.mesas.find((candidate: { code: string }) => candidate.code === mesaCode);
      const row = Object.entries(st.informativeSelections)
        .find(([key]) => key.startsWith(`${mesa.id}:`))?.[1] as { items: Array<{ declared_fraction_bps: number }> } | undefined;
      return row?.items.map((item) => item.declared_fraction_bps);
    }, code)).toEqual([2500]);
  });
});
