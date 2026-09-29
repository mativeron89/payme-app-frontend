import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';

/**
 * AF-INVITACION-INICIO · decisión 109 de Mati: «la invitación a la mesa tiene
 * que aparecer con una burbuja en el Inicio, no únicamente en notificaciones,
 * tiene que ser más sencillo y ahí ahorramos un click».
 *
 * El mock siembra UNA invitación pendiente (Sofía → Hanzo Sushi, PA-4520, mesa
 * viva). Los demás casos se arman sobre el estado guardado del mock, como
 * `mesa-cerrada-admision.spec.ts`.
 */

const ESTADO = 'payme_mock_state_v1';
const invitacion = (page: Page) => page.getByRole('region', { name: 'Te invitaron', exact: true });

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (dir) await page.screenshot({ path: `${dir}/${test.info().project.name}-${nombre}.png` });
}

/** Cambia el estado guardado del mock y recarga, para que el mock lo lea. */
async function conEstado(page: Page, cambio: (st: MockEstado) => void): Promise<void> {
  const st = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)!) as MockEstado, ESTADO);
  cambio(st);
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [ESTADO, JSON.stringify(st)] as const);
  await page.reload();
}

interface MockEstado {
  pendingInvitations: Array<Record<string, unknown> & { id: string; created_at: string }>;
  mesas: Array<{ code: string; status: string }>;
}

/**
 * 🔴 La AUSENCIA de la burbuja sólo prueba algo después de que la lista llegó:
 * un `toHaveCount(0)` apenas recargada pasa aunque la burbuja fuera a aparecer
 * medio segundo después. Testigo: el contenido de la mesa. El pedido de las
 * invitaciones sale ANTES que el de las mesas (el efecto del hijo corre antes
 * que el del padre) y el mock contesta los dos con la misma latencia, así que
 * con la mesa a la vista la lista de invitaciones ya llegó.
 */
async function yaLlegoLaLista(page: Page): Promise<void> {
  await expect(page.getByRole('region', { name: 'Tu mesa abierta', exact: true }).getByText('Ver mesa →')).toBeVisible();
}

/** Sin cortes a 390 px: la burbuja entra entera en el ancho y nada desborda adentro. */
async function sinCortes(page: Page): Promise<void> {
  const caja = await invitacion(page).boundingBox();
  expect(caja).not.toBeNull();
  expect(caja!.x).toBeGreaterThanOrEqual(0);
  expect(caja!.x + caja!.width).toBeLessThanOrEqual(390);
  const desborda = await invitacion(page).locator('.mesa-card').evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(desborda).toBe(false);
  await expect(invitacion(page).getByRole('button', { name: 'Sumarme', exact: true })).toBeInViewport();
}

test.describe('AF-INVITACION-INICIO · la invitación en Inicio', () => {
  test('con una invitación: la burbuja arriba de la mesa y «Sumarme» entra directo', async ({ page }) => {
    await page.clock.install();
    await ingresar(page);
    await expect(invitacion(page)).toBeVisible();
    await expect(invitacion(page).getByText('Sofía te invitó a', { exact: true })).toBeVisible();
    await expect(invitacion(page).getByText('Hanzo Sushi', { exact: true })).toBeVisible();
    // Arriba de la mesa abierta.
    const burbuja = await invitacion(page).boundingBox();
    const mesa = await page.getByRole('region', { name: 'Tu mesa abierta', exact: true }).boundingBox();
    expect(burbuja!.y + burbuja!.height).toBeLessThanOrEqual(mesa!.y);
    // Una sola: sin «+N».
    await expect(invitacion(page).locator('.mesa-more')).toHaveCount(0);
    await sinCortes(page);
    await capturar(page, 'invitacion-inicio-una');

    // Con el reloj en pausa, el pedido queda en vuelo: «Sumándote…» y sin segundo toque.
    const t0 = await page.evaluate(() => Date.now() + 5_000);
    await page.clock.pauseAt(t0);
    await invitacion(page).getByRole('button', { name: 'Sumarme', exact: true }).click();
    await expect(invitacion(page).getByRole('button', { name: 'Sumándote…', exact: true })).toBeDisabled();
    await page.clock.runFor(1_000);
    await expect(page.getByText('Te sumaste a la mesa ✓')).toBeVisible();
    await expect(page).toHaveURL(/:\d+\/mesa\/PA-4520$/);
    await page.clock.resume();
    // Aceptada, ya no está pendiente: al volver a Inicio no hay burbuja.
    await page.goto('/');
    await yaLlegoLaLista(page);
    await expect(invitacion(page)).toHaveCount(0);
  });

  test('con dos: la más nueva y «+1 invitación más», que lleva a Avisos', async ({ page }) => {
    await ingresar(page);
    await expect(invitacion(page)).toBeVisible();
    await conEstado(page, (st) => {
      const sofia = st.pendingInvitations[0]!;
      st.pendingInvitations.push({
        ...sofia,
        id: 'e2e-invitacion-luis',
        inviter_first_name: 'Luis',
        inviter_last_name: 'Cárdenas',
        inviter_payme_id: 'payme_mx_luis',
        // Más nueva que la de Sofía (8 min): el dueño la devuelve primero.
        created_at: new Date(Date.now() - 60_000).toISOString(),
      });
    });
    await expect(invitacion(page).getByText('Luis te invitó a', { exact: true })).toBeVisible();
    await expect(invitacion(page).getByText('Sofía te invitó a', { exact: true })).toHaveCount(0);
    const mas = invitacion(page).getByRole('button', { name: /^\+1 invitación más/ });
    await expect(mas).toBeVisible();
    await sinCortes(page);
    await capturar(page, 'invitacion-inicio-dos');
    await page.emulateMedia({ colorScheme: 'dark' });
    await sinCortes(page);
    await capturar(page, 'invitacion-inicio-dos-oscuro');
    await page.emulateMedia({ colorScheme: 'light' });

    await mas.click();
    await expect(page).toHaveURL(/:\d+\/avisos$/);
    await expect(page.getByText('Luis te invitó a', { exact: true })).toBeVisible();
    await expect(page.getByText('Sofía te invitó a', { exact: true })).toBeVisible();
  });

  test('la invitación a una mesa cerrada no aparece en Inicio (Avisos la sigue mostrando apagada)', async ({ page }) => {
    await ingresar(page);
    await expect(invitacion(page)).toBeVisible();
    await conEstado(page, (st) => { st.mesas.find((m) => m.code === 'PA-4520')!.status = 'settled'; });
    await yaLlegoLaLista(page);
    await expect(invitacion(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Sumarme', exact: true })).toHaveCount(0);
    await page.goto('/avisos');
    await expect(page.getByText('Sofía te invitó a', { exact: true })).toBeVisible();
    await expect(page.getByText('Esta mesa ya cerró', { exact: true })).toBeVisible();
  });

  test('sin invitaciones: Inicio queda como antes, sin burbuja ni «Sumarme»', async ({ page }) => {
    await ingresar(page);
    await expect(invitacion(page)).toBeVisible();
    await conEstado(page, (st) => { st.pendingInvitations = []; });
    await yaLlegoLaLista(page);
    await expect(invitacion(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Sumarme', exact: true })).toHaveCount(0);
    await expect(page.getByText(/te invitó a/)).toHaveCount(0);
    // `.mesa-card-group` no sirve de testigo: la mesa también lo usa con más de una.
    await expect(page.getByRole('button', { name: /invitaci(ón|ones) más/ })).toHaveCount(0);
    await capturar(page, 'invitacion-inicio-sin');
  });

  test('la mesa cierra entre la lectura y el toque: «Esta mesa ya cerró.» y la burbuja se va', async ({ page }) => {
    await ingresar(page);
    await expect(invitacion(page)).toBeVisible();
    // En memoria, sin recargar: la burbuja sigue a la vista con la mesa ya muerta.
    await page.evaluate(async () => {
      const ruta = '/src/api/mock/store.ts';
      const store = await import(/* @vite-ignore */ ruta) as {
        state: { mesas: Array<{ code: string; status: string }> };
        persist: () => void;
      };
      store.state.mesas.find((m) => m.code === 'PA-4520')!.status = 'settled';
      store.persist();
    });
    await invitacion(page).getByRole('button', { name: 'Sumarme', exact: true }).click();
    await expect(page.getByText('Esta mesa ya cerró.', { exact: true })).toBeVisible();
    await expect(invitacion(page)).toHaveCount(0);
    await expect(page).not.toHaveURL(/\/mesa\//);
  });

  test('Avisos acepta con la MISMA función: con la mesa cerrada en el medio, avisa y la tarjeta se apaga', async ({ page }) => {
    await ingresar(page);
    await page.goto('/avisos');
    const sumarme = page.getByRole('button', { name: 'Sumarme', exact: true });
    await expect(sumarme).toBeVisible();
    await page.evaluate(async () => {
      const ruta = '/src/api/mock/store.ts';
      const store = await import(/* @vite-ignore */ ruta) as {
        state: { mesas: Array<{ code: string; status: string }> };
        persist: () => void;
      };
      store.state.mesas.find((m) => m.code === 'PA-4520')!.status = 'settled';
      store.persist();
    });
    await sumarme.click();
    await expect(page.getByText('Esta mesa ya cerró.', { exact: true })).toBeVisible();
    // Recargó: la tarjeta sigue, apagada, con su copy y sin «Sumarme».
    await expect(page.getByText('Esta mesa ya cerró', { exact: true })).toBeVisible();
    await expect(sumarme).toHaveCount(0);
    await expect(page).toHaveURL(/:\d+\/avisos$/);
  });
});
