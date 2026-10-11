import { expect, test, type Page } from '@playwright/test';
import { ingresar, relojFueraDeLasFechasDeLosViajes } from './_app';

/**
 * D275 · la burbuja del viaje en Inicio con el diseño de Claude Design (`PANTALLA-burbuja-del-viaje.md`), D271 · el
 * restaurante con gente por elegir debajo de su viaje, y el aviso «No tienes mesas abiertas» al pie, sobre la barra.
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
const aviso = (page: Page) => page.locator('.appbar-aviso');

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

    test('las medidas: 28 debajo de la tarjeta, 20 entre viajes, el pendiente 8 abajo y 24 adentro; el aviso 40 sobre la barra', async ({ page }) => {
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
      expect(Math.round(p0.top - b0.bottom)).toBe(8);
      expect(Math.round(p0.left - b0.left)).toBe(24);
      expect(Math.round(b0.left)).toBe(16);
      expect(Math.round(ancho - b0.right)).toBe(16);
      expect(b0.height).toBeGreaterThanOrEqual(96);
      expect(p0.height).toBeGreaterThanOrEqual(60);
      // El texto del aviso, 40 px sobre el borde de arriba de la barra, centrado.
      const barra = await caja(page, '.appbar-block');
      const a = await caja(page, '.aviso-sin-mesas-cuerpo');
      expect(Math.round(barra.top - a.bottom)).toBe(40);
      expect(Math.abs(Math.round(a.left + a.width / 2 - ancho / 2))).toBeLessThanOrEqual(1);
      // La franja del aviso queda debajo de la barra, y es del color de la página.
      const capas = await page.evaluate(() => ({
        franja: Number(getComputedStyle(document.querySelector('.appbar-aviso')!).zIndex),
        barra: Number(getComputedStyle(document.querySelector('.appbar-block')!).zIndex),
        app: getComputedStyle(document.querySelector('.app')!).backgroundColor,
        franjaFondo: getComputedStyle(document.querySelector('.appbar-aviso')!).backgroundImage,
      }));
      expect(capas.franja).toBeLessThan(capas.barra);
      expect(capas.franjaFondo).toContain(capas.app);
      // El círculo de Nueva sobresale de la barra: cuánto queda entre él y el aviso (lo pidió el Bibliotecario).
      const fab = await caja(page, '.appbar-fab');
      const libre = Math.round(fab.top - a.bottom);
      test.info().annotations.push({ type: 'círculo de Nueva', description: `sobresale ${Math.round(barra.top - fab.top)} px de la barra; quedan ${libre} px hasta el aviso` });
      expect(libre).toBeGreaterThan(0);
      await capturar(page, 'medidas');
    });

    test('el aviso: sólo sin mesas, con la cámara; nunca en la pestaña Viajes ni con mesas abiertas', async ({ page }) => {
      await conViajes(page);
      // Con la mesa de la semilla abierta, no hay aviso.
      await expect(page.locator('.home-mesas .mesa-card').first()).toBeVisible();
      await expect(aviso(page)).toHaveCount(0);
      await sinMesas(page);
      await expect(aviso(page)).toHaveText('No tienes mesas abiertasToca elpara abrir una');
      await expect(aviso(page).getByRole('img', { name: 'ícono de cámara' })).toBeVisible();
      await expect(page.getByText('Toca el + para abrir una')).toHaveCount(0);
      await page.getByRole('tab', { name: 'Viajes', exact: true }).click();
      await expect(aviso(page)).toHaveCount(0);
      await page.getByRole('tab', { name: 'Cuenta', exact: true }).click();
      await expect(aviso(page)).toBeVisible();
      // La franja tapa lo que pasa por debajo: también toma sus toques, así nadie toca algo que no ve.
      const enLaFranja = await aviso(page).evaluate((el) => {
        const r = el.getBoundingClientRect();
        return el.contains(document.elementFromPoint(r.left + 8, r.top + r.height / 3));
      });
      expect(enLaFranja).toBe(true);
      await capturar(page, 'aviso');
    });

    for (const inset of [0, 34]) test(`🔴 nada queda tapado (inset de abajo ${inset}): al final del scroll, lo último queda encima del aviso, y el aviso encima de la barra`, async ({ page, browserName }) => {
      // El iPhone con indicador de inicio: la barra crece (`--appbar-pie`) y el aviso sube con ella. El inset se emula
      // por CDP, que es de Chromium (la suite corre en Chromium); sin `test.skip`, que `corteGuard` no permite.
      if (inset > 0 && browserName === 'chromium') {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Emulation.setSafeAreaInsetsOverride', {
          insets: { top: 59, topMax: 59, bottom: inset, bottomMax: inset, left: 0, leftMax: 0, right: 0, rightMax: 0 },
        });
      }
      await conViajes(page);
      await sinMesas(page);
      await editarViajes(page, 'dos-pendientes');
      // Con la página llena: la invitación y el aviso de la foto de la semilla se quedan, así hay que desplazar.
      // Se espera a que estén (llegan después) y a los dos pendientes, ANTES de ir al final.
      await expect(page.locator('section[aria-label="Te invitaron"]')).toBeVisible();
      await expect(page.locator('.friend-avatar-notice')).toBeVisible();
      await expect(pendientes(page)).toHaveCount(2);
      const desplazado = await page.locator('.scroll').first().evaluate(async (el) => {
        el.scrollTo(0, el.scrollHeight);
        await new Promise((r) => setTimeout(r, 200));
        return el.scrollTop;
      });
      // Control: si no hubiera nada que desplazar, esta prueba no probaría nada.
      expect(desplazado).toBeGreaterThan(0);
      const ultimo = await page.evaluate(() => {
        const s = document.querySelector('.scroll')!;
        const hijos = [...s.querySelectorAll('button, .state-error, .note')].filter((e) => (e as HTMLElement).getBoundingClientRect().height > 0);
        return Math.max(...hijos.map((e) => e.getBoundingClientRect().bottom));
      });
      // La franja del aviso empieza en su fundido: lo último del contenido termina antes.
      const franja = await caja(page, '.appbar-aviso');
      const a = await caja(page, '.aviso-sin-mesas-cuerpo');
      const barra = await caja(page, '.appbar-block');
      expect(ultimo, 'lo último del contenido, por encima de la franja del aviso').toBeLessThanOrEqual(franja.top);
      expect(Math.round(barra.top - a.bottom)).toBe(40);
      await capturar(page, `al-final-inset-${inset}`);
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
