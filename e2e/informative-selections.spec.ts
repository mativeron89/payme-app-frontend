import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';

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
    const first = page.getByRole('button', { name: 'Tagliatelle Bolognese', exact: true });
    await first.click();
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
    await page.getByRole('button', { name: 'Listo', exact: true }).click();
    await expect(page.getByText('Tu selección quedó guardada.')).toBeVisible();
    await page.reload();
    await expect(first).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('radio', { name: '½', exact: true })).toHaveAttribute('aria-checked', 'true');
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
    await page.getByRole('button', { name: 'Listo', exact: true }).click();
    await expect(page.getByText('Tu selección quedó guardada.')).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(
      localStorage.getItem('payme.app.e2e.informative-put.v2') ?? 'null',
    ))).toEqual({ items: [], confirm_closure: true });
  });

  test('Pagar el total N>1 mapea a igual y conserva fracción declarada', async ({ page }) => {
    await abrirInformativa(page, 'Pagar el total', 3);
    await page.getByRole('button', { name: 'Risotto ai Funghi', exact: true }).click();
    await page.getByRole('radio', { name: '¾', exact: true }).click();
    await page.getByRole('button', { name: 'Listo', exact: true }).click();
    await expect(page.getByText('Tu selección quedó guardada.')).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Risotto ai Funghi', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('radio', { name: '¾', exact: true })).toHaveAttribute('aria-checked', 'true');
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
    await page.getByRole('button', { name: 'Listo', exact: true }).click();
    await expect(page.getByText('Guardar esta selección todavía no está disponible.')).toBeVisible();
    await expect(page.getByText('Tu selección quedó guardada.')).toHaveCount(0);
  });
});
