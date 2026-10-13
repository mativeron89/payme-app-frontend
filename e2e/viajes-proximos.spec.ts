import { expect, test, type Page } from '@playwright/test';

/**
 * 🔴 D302 · los viajes que todavía no empezaron. En Inicio, la burbuja de un viaje aparece desde el día de su «desde»
 * en hora de México: un viaje futuro no se ve, ni sus restaurantes pendientes, ni su «+ Gasto», y el aviso de mesas se
 * calcula sin él. En la pestaña Viajes, «Próximos» (entre «Crear viaje» y «Cerrados») los lista, del más cercano al más
 * lejano, y tocar uno entra al viaje. Abiertos sin «desde» y esperando pagos, en Inicio como hoy.
 *
 * La semilla del mock: «Cancún 2026» abierto, del 5 al 11 de octubre de 2026, con «Mariscos El Faro» pendiente (Diego
 * no eligió); «Monterrey fin de semana» esperando pagos (19 al 21 de septiembre). Con el reloj el 4 de octubre, Cancún
 * es un viaje que empieza mañana.
 *
 * El reloj va FIJO, y el huso del teléfono a propósito NO es el de México en los bordes: si la app mirara la fecha del
 * teléfono, los casos de medianoche fallarían.
 */
const CANCUN = 'd1000000-0000-4000-8000-000000000001';
const MONTERREY = 'd1000000-0000-4000-8000-000000000002';
const ESTADO_VIAJES = 'payme.app.mock.viajes.estado.v1';

/** Un instante de la Ciudad de México (UTC−6 fijo, como el contrato). */
const mx = (s: string) => new Date(`${s}-06:00`);
const VISPERA = mx('2026-10-04T12:00:00');

/**
 * Entra con Viajes encendido. No usa `ingresar()`: espera «Nueva» como nombre accesible, y la cámara de D276 decide el
 * nombre con la fecha del teléfono (en un huso distinto de México puede ser «Escanear ticket para Cancún 2026»).
 */
async function entrar(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('payme.app.mock.viajes.v1', 'encendido'));
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill('mati@payme.mx');
  await page.getByLabel('Contraseña', { exact: true }).fill('demo-e2e');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.locator('button.appbar-center')).toBeVisible();
  // La lista de abiertos ya llegó: Monterrey (esperando pagos) está siempre en Inicio.
  await expect(burbuja(page, 'Monterrey fin de semana')).toBeVisible();
}

const burbuja = (page: Page, nombre: string) => page.locator('button.viaje-burbuja').filter({ hasText: nombre });
const gasto = (page: Page, nombre: string) => page.getByRole('button', { name: `Cargar un gasto a mano en ${nombre}`, exact: true });
const pendientes = (page: Page) => page.locator('button.viaje-pendiente');
const aviso = (page: Page) => page.locator('.aviso-sin-mesas');
const lanzador = (page: Page, nombre: string) => page.locator('button.vj-lanzador').filter({ hasText: nombre });
const listaDeProximos = (page: Page) => page.getByRole('list', { name: 'Viajes próximos', exact: true });

/** Sin mesas abiertas: el estado del mock, editado y releído. */
async function sinMesas(page: Page): Promise<void> {
  await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem('payme_mock_state_v1')!);
    for (const m of st.mesas) m.openedByUser = false;
    st.joinedMesaCodes = [];
    localStorage.setItem('payme_mock_state_v1', JSON.stringify(st));
  });
  await page.reload();
  await expect(burbuja(page, 'Monterrey fin de semana')).toBeVisible();
}

/**
 * Cambia el estado de los viajes del mock desde una página pública (`/privacy`, que no carga el mock) y vuelve a Inicio:
 * editarlo dentro de la app compite con los pedidos del mock en vuelo (la clase de 0.245.0).
 */
async function editarViajes(page: Page, cambio: 'tres-proximos' | 'monterrey-futuro'): Promise<void> {
  await page.goto('/privacy');
  await expect(page.getByRole('heading', { name: 'Aviso de privacidad' })).toBeVisible();
  await page.evaluate(({ k, cambio: c }) => {
    type V = Record<string, unknown> & { id: string; nombre: string; fecha_desde: string | null; fecha_hasta: string | null };
    const e = JSON.parse(localStorage.getItem(k)!) as { viajes: V[] };
    const cancun = e.viajes.find((v) => v.id === 'd1000000-0000-4000-8000-000000000001')!;
    if (c === 'tres-proximos') {
      // Dos más, abiertos y sin tickets: Oaxaca en noviembre y Puebla el 7 (después de Cancún, antes de Oaxaca). Y uno
      // abierto sin fechas, que no es próximo.
      const nuevo = (id: string, nombre: string, desde: string | null, hasta: string | null): V =>
        ({ ...structuredClone(cancun), id, nombre, fecha_desde: desde, fecha_hasta: hasta, tickets: [], transferencias: [] });
      e.viajes.push(nuevo('d1000000-0000-4000-8000-000000000097', 'Oaxaca de noviembre', '2026-11-02', '2026-11-05'));
      e.viajes.push(nuevo('d1000000-0000-4000-8000-000000000098', 'Puebla', '2026-10-07', '2026-10-09'));
      e.viajes.push(nuevo('d1000000-0000-4000-8000-000000000099', 'Sin fechas', null, null));
    } else {
      // Monterrey sigue esperando pagos, pero con su «desde» en el futuro.
      const monterrey = e.viajes.find((v) => v.id === 'd1000000-0000-4000-8000-000000000002')!;
      monterrey.fecha_desde = '2026-10-20';
      monterrey.fecha_hasta = '2026-10-22';
    }
    localStorage.setItem(k, JSON.stringify(e));
  }, { k: ESTADO_VIAJES, cambio });
  await page.goto('/home');
  await expect(page.locator('button.appbar-center')).toBeVisible();
}

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (dir) await page.screenshot({ path: `${dir}/d302-${page.viewportSize()!.width}-${nombre}.png` });
}

for (const ancho of [375, 390] as const) {
  test.describe(`🔴 D302 · a ${ancho}`, () => {
    test.use({ viewport: { width: ancho, height: ancho === 375 ? 667 : 844 }, timezoneId: 'America/Mexico_City' });

    test('🔴 un viaje que empieza mañana no está en Inicio (ni su «+ Gasto», ni su pendiente) y sí en «Próximos»', async ({ page }) => {
      await page.clock.setFixedTime(VISPERA);
      await entrar(page);
      await expect(burbuja(page, 'Cancún 2026')).toHaveCount(0);
      await expect(gasto(page, 'Cancún 2026')).toHaveCount(0);
      await expect(pendientes(page)).toHaveCount(0);
      // Monterrey, esperando pagos, como hoy: sin «+ Gasto».
      await expect(gasto(page, 'Monterrey fin de semana')).toHaveCount(0);
      await capturar(page, 'inicio');

      await page.getByRole('tab', { name: 'Viajes', exact: true }).click();
      await expect(page.locator('button.vj-lanzador')).toHaveText(['Crear viaje', 'Próximos', 'Cerrados']);
      await expect(lanzador(page, 'Próximos')).toHaveAttribute('aria-pressed', 'false');
      await lanzador(page, 'Próximos').click();
      await expect(lanzador(page, 'Próximos')).toHaveAttribute('aria-pressed', 'true');
      await expect(listaDeProximos(page).getByRole('button')).toHaveText(['CCancún 2026']);
      await capturar(page, 'proximos');
      // Tocar uno entra al viaje (abierto).
      await listaDeProximos(page).getByRole('button', { name: /Cancún 2026/ }).click();
      await expect(page).toHaveURL(new RegExp(`/viaje/${CANCUN}$`));
    });

    test('🔴 sin mesas: el aviso aparece, aunque el viaje que no empezó tenga un restaurante pendiente', async ({ page }) => {
      await page.clock.setFixedTime(VISPERA);
      await entrar(page);
      await sinMesas(page);
      await expect(aviso(page)).toBeVisible();
      await expect(pendientes(page)).toHaveCount(0);
    });

    test('🔴 en su día pasa a Inicio, con su pendiente y su «+ Gasto»; «Próximos» queda vacío', async ({ page }) => {
      await page.clock.setFixedTime(mx('2026-10-05T00:00:00'));
      await entrar(page);
      await expect(burbuja(page, 'Cancún 2026')).toBeVisible();
      await expect(gasto(page, 'Cancún 2026')).toBeVisible();
      await expect(pendientes(page)).toHaveText(['Mariscos El FaroFalta 1 por elegir']);
      await page.getByRole('tab', { name: 'Viajes', exact: true }).click();
      await lanzador(page, 'Próximos').click();
      await expect(page.locator('.vj-inicio-lista-vacia')).toHaveText('No tienes viajes próximos');
      await expect(listaDeProximos(page)).toHaveCount(0);
    });

    test('«Próximos»: del más cercano al más lejano; uno abierto sin fechas, en Inicio', async ({ page }) => {
      await page.clock.setFixedTime(VISPERA);
      await entrar(page);
      await editarViajes(page, 'tres-proximos');
      await expect(burbuja(page, 'Sin fechas')).toBeVisible();
      for (const futuro of ['Cancún 2026', 'Puebla', 'Oaxaca de noviembre']) await expect(burbuja(page, futuro)).toHaveCount(0);
      await page.getByRole('tab', { name: 'Viajes', exact: true }).click();
      await lanzador(page, 'Próximos').click();
      await expect(listaDeProximos(page).getByRole('button')).toHaveText(['CCancún 2026', 'PPuebla', 'OOaxaca de noviembre']);
    });

    test('🔴 uno esperando pagos con su «desde» en el futuro sigue en Inicio, y no va a «Próximos»', async ({ page }) => {
      await page.clock.setFixedTime(mx('2026-10-13T12:00:00'));
      await entrar(page);
      await editarViajes(page, 'monterrey-futuro');
      await expect(burbuja(page, 'Monterrey fin de semana')).toBeVisible();
      await expect(burbuja(page, 'Cancún 2026')).toBeVisible();
      await page.getByRole('tab', { name: 'Viajes', exact: true }).click();
      await lanzador(page, 'Próximos').click();
      await expect(page.locator('.vj-inicio-lista-vacia')).toHaveText('No tienes viajes próximos');
      expect(MONTERREY).toBeTruthy();
    });

    test('«Próximos» y «Cerrados» no se abren a la vez; al salir de la pestaña, se ocultan', async ({ page }) => {
      await page.clock.setFixedTime(VISPERA);
      await entrar(page);
      await page.getByRole('tab', { name: 'Viajes', exact: true }).click();
      await lanzador(page, 'Próximos').click();
      await expect(listaDeProximos(page)).toBeVisible();
      await lanzador(page, 'Cerrados').click();
      await expect(lanzador(page, 'Cerrados')).toHaveAttribute('aria-pressed', 'true');
      await expect(lanzador(page, 'Próximos')).toHaveAttribute('aria-pressed', 'false');
      await expect(listaDeProximos(page)).toHaveCount(0);
      await expect(page.locator('.vj-inicio-lista')).toHaveCount(1);
      await lanzador(page, 'Próximos').click();
      await expect(lanzador(page, 'Cerrados')).toHaveAttribute('aria-pressed', 'false');
      await expect(page.locator('.vj-inicio-lista')).toHaveCount(1);
      await expect(listaDeProximos(page)).toBeVisible();
      // Al salir y volver, oculta.
      await page.getByRole('tab', { name: 'Cuenta', exact: true }).click();
      await page.getByRole('tab', { name: 'Viajes', exact: true }).click();
      await expect(lanzador(page, 'Próximos')).toHaveAttribute('aria-pressed', 'false');
      await expect(listaDeProximos(page)).toHaveCount(0);
    });

    test('las tres burbujas entran en una fila, del mismo ancho, con su palabra en una línea y sin desbordar', async ({ page }) => {
      await page.clock.setFixedTime(VISPERA);
      await entrar(page);
      await page.getByRole('tab', { name: 'Viajes', exact: true }).click();
      await expect(page.locator('button.vj-lanzador')).toHaveCount(3);
      const m = await page.evaluate(() => {
        const botones = [...document.querySelectorAll<HTMLElement>('button.vj-lanzador')].map((b) => {
          const r = b.getBoundingClientRect();
          const l = b.querySelector('.launch-label')!;
          return { top: r.top, ancho: r.width, alto: r.height, lineas: Math.round(l.getBoundingClientRect().height / parseFloat(getComputedStyle(l).lineHeight)), peso: getComputedStyle(l).fontWeight };
        });
        return { botones, doc: document.documentElement.scrollWidth };
      });
      expect(new Set(m.botones.map((b) => Math.round(b.top))).size).toBe(1);
      // El mismo ancho, salvo el divisor de 1 px que separa cada burbuja de la anterior (`.launch + .launch`).
      expect(Math.max(...m.botones.map((b) => b.ancho)) - Math.min(...m.botones.map((b) => b.ancho))).toBeLessThanOrEqual(1.5);
      for (const b of m.botones) {
        expect(b.lineas).toBe(1);
        expect(b.alto).toBeGreaterThanOrEqual(84);
        expect(b.peso).toBe('700');
      }
      expect(m.doc).toBeLessThanOrEqual(ancho);
    });
  });
}

test.describe('🔴 D302 · la medianoche de México, no la del teléfono', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test.describe('con el teléfono en Buenos Aires (3 h adelante de México)', () => {
    test.use({ timezoneId: 'America/Argentina/Buenos_Aires' });

    test('a las 23:00 del 4 en México (ya el 5 en Buenos Aires): Cancún todavía no está en Inicio', async ({ page }) => {
      await page.clock.setFixedTime(mx('2026-10-04T23:00:00'));
      await entrar(page);
      await expect(burbuja(page, 'Cancún 2026')).toHaveCount(0);
    });
  });

  test.describe('con el teléfono en Los Ángeles (1 h atrás de México)', () => {
    test.use({ timezoneId: 'America/Los_Angeles' });

    test('a las 00:30 del 5 en México (todavía el 4 en Los Ángeles): Cancún ya está en Inicio', async ({ page }) => {
      await page.clock.setFixedTime(mx('2026-10-05T00:30:00'));
      await entrar(page);
      await expect(burbuja(page, 'Cancún 2026')).toBeVisible();
    });
  });

  test.describe('con la app abierta', () => {
    test.use({ timezoneId: 'America/Mexico_City' });

    test('🔴 al cruzar la medianoche de México, Cancún entra a Inicio y sale de «Próximos» sin recargar', async ({ page }) => {
      await page.clock.install({ time: mx('2026-10-04T23:58:00') });
      await entrar(page);
      await expect(burbuja(page, 'Cancún 2026')).toHaveCount(0);
      await page.clock.fastForward('03:00');
      await expect(burbuja(page, 'Cancún 2026')).toBeVisible();
      await expect(pendientes(page)).toHaveText(['Mariscos El FaroFalta 1 por elegir']);
      await page.getByRole('tab', { name: 'Viajes', exact: true }).click();
      await lanzador(page, 'Próximos').click();
      await expect(page.locator('.vj-inicio-lista-vacia')).toHaveText('No tienes viajes próximos');
    });
  });
});
