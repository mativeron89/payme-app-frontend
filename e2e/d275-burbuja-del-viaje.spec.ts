import { expect, test, type Page } from '@playwright/test';
import { ingresar, relojFueraDeLasFechasDeLosViajes } from './_app';

/**
 * D275 · la burbuja del viaje en Inicio con el diseño de Claude Design (`PANTALLA-burbuja-del-viaje.md`), D271 · el
 * restaurante con gente por elegir debajo de su viaje, y cuándo se ve el aviso «No tienes mesas abiertas» (su lugar,
 * centrado en el espacio libre, es de D277: `d277-aviso-centrado.spec.ts`).
 * A 375 y a 390: el paquete mezcla los dos anchos y D275 pide que funcione en ambos.
 *
 * La semilla del mock: «Cancún 2026» abierto (debes $542) con «Mariscos El Faro», donde Diego no eligió (yo sí);
 * «Monterrey fin de semana» esperando pagos.
 */
const CANCUN = 'd1000000-0000-4000-8000-000000000001';
const MONTERREY = 'd1000000-0000-4000-8000-000000000002';
const MARISCOS = 'd2000000-0000-4000-8000-000000000105';
const ESTADO_VIAJES = 'payme.app.mock.viajes.estado.v1';
const MENOS = '−';

async function conViajes(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('payme.app.mock.viajes.v1', 'encendido');
    localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled');
  });
  // D276-1 · el día de la corrida no decide a dónde va «Nueva» (`_app.ts`).
  await relojFueraDeLasFechasDeLosViajes(page);
  await ingresar(page);
}

/** Sin mesas abiertas: el estado del mock, editado y releído (el mock lo lee al cargar). */
async function sinMesas(page: Page): Promise<void> {
  await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem('payme_mock_state_v1')!);
    for (const m of st.mesas) m.openedByUser = false;
    st.joinedMesaCodes = [];
    localStorage.setItem('payme_mock_state_v1', JSON.stringify(st));
  });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
}

type Persona = { user_id: string; listo_en: string | null };
type Ticket = { id: string; lugar: string; forma: string; created_at: string; personas: Persona[] };

/** Cambia el estado de los viajes del mock y recarga. */
async function editarViajes(page: Page, cambio: string): Promise<void> {
  await page.evaluate(({ k, cambio: c }) => {
    const e = JSON.parse(localStorage.getItem(k)!) as { viajes: Array<{ id: string; tickets: Ticket[] }> };
    const cancun = e.viajes.find((v) => v.id === 'd1000000-0000-4000-8000-000000000001')!;
    if (c === 'eligieron-todos') {
      // Diego toca «Listo» en Mariscos El Faro.
      const t = cancun.tickets.find((x) => x.id === 'd2000000-0000-4000-8000-000000000105')!;
      for (const p of t.personas) p.listo_en = p.listo_en ?? '2026-10-11T01:00:00.000Z';
    } else if (c === 'dos-pendientes') {
      // En «Fonda Doña Mary» (más vieja que Mariscos) faltan dos.
      const t = cancun.tickets.find((x) => x.lugar === 'Fonda Doña Mary')!;
      for (const p of t.personas.slice(1, 3)) p.listo_en = null;
    }
    localStorage.setItem(k, JSON.stringify(e));
  }, { k: ESTADO_VIAJES, cambio });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
}

const burbuja = (page: Page, nombre: string) => page.locator('button.viaje-burbuja').filter({ hasText: nombre });
const pendientes = (page: Page) => page.locator('button.viaje-pendiente');
const aviso = (page: Page) => page.locator('.aviso-sin-mesas');

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (!dir) return;
  await page.screenshot({ path: `${dir}/d275-${page.viewportSize()!.width}-${nombre}.png` });
}

type Caja = { top: number; bottom: number; left: number; right: number; width: number; height: number };
const caja = (page: Page, selector: string, i = 0): Promise<Caja> => page.locator(selector).nth(i).evaluate((el) => {
  const r = el.getBoundingClientRect();
  return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
});

for (const ancho of [375, 390]) {
  test.describe(`🔴 D275 · a ${ancho}`, () => {
    test.use({ viewport: { width: ancho, height: 812 } });

    test('la burbuja del viaje: sólo la foto o la inicial, el nombre y el monto; esperando pagos se ve igual', async ({ page }) => {
      await conViajes(page);
      const cancun = burbuja(page, 'Cancún 2026');
      await expect(cancun).toHaveAttribute('aria-label', 'Cancún 2026, debes $542');
      await expect(cancun).toHaveText(`CCancún 2026${MENOS}$542`);
      await expect(cancun.locator('.viaje-burbuja-monto')).toHaveCSS('color', 'rgb(180, 35, 24)');
      const monterrey = burbuja(page, 'Monterrey fin de semana');
      await expect(monterrey).toHaveAttribute('aria-label', /^Monterrey fin de semana, te deben \$[\d,.]+$/);
      await expect(monterrey.locator('.viaje-burbuja-monto')).toHaveCSS('color', 'rgb(4, 120, 87)');
      await expect(page.locator('.home-viajes')).not.toContainText(/Tu viaje abierto|Ver viaje|Esperando pagos|Te deben|saldo/i);
      // La insignia: cuadrada redondeada de 64.
      const ins = await caja(page, 'button.viaje-burbuja .vj-insignia');
      expect([Math.round(ins.width), Math.round(ins.height)]).toEqual([64, 64]);
      await expect(page.locator('button.viaje-burbuja .vj-insignia').first()).toHaveCSS('border-radius', '18px');
      await cancun.click();
      await expect(page).toHaveURL(new RegExp(`/viaje/${CANCUN}$`));
    });

    test('las medidas: 28 debajo de la tarjeta, 20 entre viajes, «+ Gasto» y el pendiente 8 abajo, 24 adentro (también con el aviso)', async ({ page }) => {
      await conViajes(page);
      await sinMesas(page);
      // Lo de arriba que la semilla trae y el prototipo no (la invitación y el aviso de la foto) se oculta, para medir
      // contra la tarjeta como el prototipo. Con CSS: sacarlos del DOM pelearía con React.
      await expect(page.locator('section[aria-label="Te invitaron"]')).toBeVisible();
      await expect(page.locator('.friend-avatar-notice')).toBeVisible();
      await page.addStyleTag({ content: 'section[aria-label="Te invitaron"], .friend-avatar-notice { display: none !important; }' });
      await expect(burbuja(page, 'Cancún 2026')).toBeVisible();
      const tarjeta = await caja(page, '.mounted-card');
      const g0 = await caja(page, '.viaje-grupo', 0);
      const g1 = await caja(page, '.viaje-grupo', 1);
      const b0 = await caja(page, 'button.viaje-burbuja', 0);
      const gasto0 = await caja(page, 'button.viaje-gasto', 0);
      const p0 = await caja(page, 'button.viaje-pendiente', 0);
      const enIntermedios = await page.evaluate(() => {
        const t = document.querySelector('.mounted-card')!;
        const v = document.querySelector('.home-viajes')!;
        // Lo que hay entre la tarjeta y los viajes, y ocupa lugar.
        const out: string[] = [];
        for (let n = t.nextElementSibling; n && n !== v; n = n.nextElementSibling) {
          if ((n as HTMLElement).getBoundingClientRect().height > 0) out.push(n.className);
        }
        return out;
      });
      expect(enIntermedios, 'entre la tarjeta y los viajes no ocupa lugar nada').toEqual([]);
      expect(Math.round(g0.top - tarjeta.bottom)).toBe(28);
      expect(Math.round(g1.top - g0.bottom)).toBe(20);
      // D280 · «+ Gasto» 8 px debajo de la burbuja, a la derecha; el pendiente, 8 px debajo de ella.
      expect(Math.round(gasto0.top - b0.bottom)).toBe(8);
      expect(Math.round(b0.right - gasto0.right)).toBe(0);
      expect(Math.round(gasto0.height)).toBe(44);
      expect(Math.round(p0.top - gasto0.bottom)).toBe(8);
      expect(Math.round(p0.left - b0.left)).toBe(24);
      expect(Math.round(b0.left)).toBe(16);
      expect(Math.round(ancho - b0.right)).toBe(16);
      expect(b0.height).toBeGreaterThanOrEqual(96);
      expect(p0.height).toBeGreaterThanOrEqual(60);
      // D275 §3 (1g, 0.242.1) · con el restaurante pendiente, el aviso no aparece.
      await expect(aviso(page)).toHaveCount(0);
      await capturar(page, 'medidas');
      // Sin pendientes, con el aviso: la columna de D277 no cambia ninguna de estas medidas (sus márgenes no colapsan).
      await editarViajes(page, 'eligieron-todos');
      await page.addStyleTag({ content: 'section[aria-label="Te invitaron"], .friend-avatar-notice { display: none !important; }' });
      await expect(aviso(page)).toBeVisible();
      const tarjeta2 = await caja(page, '.mounted-card');
      const g0b = await caja(page, '.viaje-grupo', 0);
      const g1b = await caja(page, '.viaje-grupo', 1);
      const b0b = await caja(page, 'button.viaje-burbuja', 0);
      const gasto0b = await caja(page, 'button.viaje-gasto', 0);
      expect(Math.round(g0b.top - tarjeta2.bottom)).toBe(28);
      expect(Math.round(g1b.top - g0b.bottom)).toBe(20);
      expect(Math.round(gasto0b.top - b0b.bottom)).toBe(8);
      expect(Math.round(b0b.right - gasto0b.right)).toBe(0);
      expect(Math.round(b0b.left)).toBe(16);
      await capturar(page, 'medidas-con-aviso');
    });

    test('el aviso: sólo sin mesas, con la cámara; nunca en la pestaña Viajes, con mesas abiertas ni con un restaurante pendiente', async ({ page }) => {
      await conViajes(page);
      // Con la mesa de la semilla abierta, no hay aviso.
      await expect(page.locator('.home-mesas .mesa-card').first()).toBeVisible();
      await expect(aviso(page)).toHaveCount(0);
      await sinMesas(page);
      // D275 §3 (1g, 0.242.1) · con el restaurante pendiente de la semilla (Mariscos El Faro), tampoco.
      await expect(pendientes(page)).toHaveCount(1);
      await expect(aviso(page)).toHaveCount(0);
      await editarViajes(page, 'eligieron-todos');
      await expect(pendientes(page)).toHaveCount(0);
      await expect(aviso(page)).toHaveText('No tienes mesas abiertasToca elpara abrir una');
      await expect(aviso(page).getByRole('img', { name: 'ícono de cámara' })).toBeVisible();
      await expect(page.getByText('Toca el + para abrir una')).toHaveCount(0);
      await page.getByRole('tab', { name: 'Viajes', exact: true }).click();
      await expect(aviso(page)).toHaveCount(0);
      await page.getByRole('tab', { name: 'Cuenta', exact: true }).click();
      await expect(aviso(page)).toBeVisible();
      // D277 · va en el contenido, no colgado de la barra.
      await expect(page.locator('.scroll .aviso-sin-mesas')).toHaveCount(1);
      await expect(page.locator('.appbar-block .aviso-sin-mesas')).toHaveCount(0);
      await capturar(page, 'aviso');
    });

    test('🔴 el restaurante pendiente: lo ve quien ya eligió, abre ESE ticket, varios del más reciente al más viejo, y se va', async ({ page }) => {
      await conViajes(page);
      // Diego no eligió en Mariscos El Faro; yo sí: igual lo veo (D271, «Todos, hasta que elijan todos»).
      await expect(pendientes(page)).toHaveCount(1);
      await expect(pendientes(page).first()).toHaveAttribute('aria-label', 'Mariscos El Faro, falta 1 por elegir');
      await expect(pendientes(page).first()).toHaveText('Mariscos El FaroFalta 1 por elegir');
      // Debajo de SU viaje, no del de Monterrey.
      await expect(page.locator('.viaje-grupo').filter({ hasText: 'Cancún 2026' }).locator('button.viaje-pendiente')).toHaveCount(1);
      await expect(page.locator('.viaje-grupo').filter({ hasText: 'Monterrey' }).locator('button.viaje-pendiente')).toHaveCount(0);
      await capturar(page, 'pendiente');
      await pendientes(page).first().click();
      await expect(page).toHaveURL(new RegExp(`/viaje-ticket/${CANCUN}\\.${MARISCOS}$`));

      // Varios: del más reciente al más viejo.
      await page.goto('/');
      await editarViajes(page, 'dos-pendientes');
      await expect(pendientes(page)).toHaveText(['Mariscos El FaroFalta 1 por elegir', 'Fonda Doña MaryFaltan 2 por elegir']);
      await capturar(page, 'dos-pendientes');

      // Eligieron todos en Mariscos: se va; Fonda sigue.
      await editarViajes(page, 'eligieron-todos');
      await expect(pendientes(page)).toHaveText(['Fonda Doña MaryFaltan 2 por elegir']);
      // Y Monterrey, esperando pagos, nunca tiene pendientes.
      await expect(page.locator('.viaje-grupo').filter({ hasText: 'Monterrey' }).locator('button.viaje-pendiente')).toHaveCount(0);
      expect(MONTERREY).toBeTruthy();
    });
  });
}
