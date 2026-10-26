import { expect, test, type Page } from '@playwright/test';
import { ingresar, irEnLaApp, relojFueraDeLasFechasDeLosViajes } from './_app';

/**
 * AF-RESTAURANTES-DE-VIAJE-EN-MESAS-20261012 (0.245.0) · D293: los restaurantes de mis viajes también en Mesas, contra
 * el mock del dueño 2.184.0 (`GET /api/viajes/visitas`).
 *
 * Mati eligió «Un restaurante de un viaje» y «Sí, con el nombre del viaje (Recomendada)». Mesas es UNA lista por fecha, en
 * sus grupos por mes: mis mesas, mis restaurantes de viaje y mis pagos. Cada lista pagina con su cursor (los pagos llegan
 * completos) y la mezcla nunca saltea ni repite; si una falla, las otras se siguen viendo con su aviso.
 *
 * La semilla de Viajes (sólo lo mío, la regla de Estadísticas): «Cancún 2026» (abierto) con Mariscos El Faro, Bar La Ola y
 * Fonda Doña Mary; «Monterrey fin de semana» (esperando pagos) y «Oaxaca puente» y «Valle de Bravo» (cerrados). El reloj
 * queda fijo y la zona en México: las fechas y los meses no dependen del día ni de la máquina.
 */
const CANCUN = 'd1000000-0000-4000-8000-000000000001';
const OAXACA = 'd1000000-0000-4000-8000-000000000003';
const MARISCOS = 'd2000000-0000-4000-8000-000000000105';
const ESTADO = 'payme.app.mock.viajes.estado.v1';
const VISITAS = 'payme.app.mock.viajes.visitas.v1';
const MIS_MESAS = 'payme.app.mock.mis_mesas.v1';
const LATENCIA = 'payme.app.mock.latencia.v1';

test.use({ timezoneId: 'America/Mexico_City' });

async function entrar(page: Page, seams: Record<string, string> = {}, viajes = true): Promise<void> {
  await page.addInitScript(({ s, v }) => {
    if (v) localStorage.setItem('payme.app.mock.viajes.v1', 'encendido');
    localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled');
    for (const [k, x] of Object.entries(s)) localStorage.setItem(k, x);
  }, { s: seams, v: viajes });
  await relojFueraDeLasFechasDeLosViajes(page);
  await ingresar(page);
}

async function aMesas(page: Page): Promise<void> {
  await irEnLaApp(page, '/mesas');
  await expect(page.getByRole('heading', { name: 'Mesas', exact: true, level: 1 })).toBeVisible();
}

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (dir) await page.screenshot({ path: `${dir}/d293-${page.viewportSize()!.width}-${nombre}.png` });
}

/**
 * Cambia el estado del dueño de Viajes en el mock desde una página pública (que no carga el mock: un pedido en vuelo no
 * la pisa) y vuelve a Inicio.
 */
async function editarEstado(page: Page, fn: string): Promise<void> {
  await page.goto('/privacy');
  await expect(page.getByRole('heading', { name: 'Aviso de privacidad' })).toBeVisible();
  await page.evaluate(({ k, f }) => {
    const e = JSON.parse(localStorage.getItem(k)!);
    // eslint-disable-next-line no-new-func
    new Function('e', f)(e);
    localStorage.setItem(k, JSON.stringify(e));
  }, { k: ESTADO, f: fn });
  await page.goto('/home');
  await expect(page.getByRole('button', { name: 'Escanear', exact: true })).toBeVisible();
}

const lista = (page: Page) => page.getByRole('region', { name: 'Tus mesas', exact: true });
// D481 · las mesas y los restaurantes de viaje usan la fila nueva (`.fila-ticket-nombre`); los pagos, la de siempre.
const NOMBRE = '.hist-rest, .fila-ticket-nombre';
const nombres = (page: Page) => lista(page).locator(NOMBRE).allTextContents();
const meses = (page: Page) => lista(page).locator('h2.mes-sticky').allTextContents();
const deViaje = (page: Page, lugar: string) => lista(page).locator('.vj-visita').filter({ hasText: lugar });
const verMas = (page: Page) => lista(page).getByRole('button', { name: 'Ver más mesas', exact: true });

/** La lista entera por fecha (las mesas de «sin_cobro», los pagos del mock y mis visitas de viaje), de la más nueva a la más vieja. */
const MEZCLA = [
  'La Parolaccia', 'Tacos El Güero', 'La Parolaccia', 'Mariscos El Faro', 'Café Tacuba', 'Bar La Ola', 'Fonda Doña Mary',
  'Hanzo Sushi', 'La Parolaccia', 'Café Barrio Antiguo', 'El Rey del Cabrito', 'Café Brújula Bar', 'Tlayudas Libres',
  'Mezcalería Los Amantes', 'La Olla', 'Los Pericos',
];

for (const ancho of [375, 390] as const) {
  test.describe(`D293 · a ${ancho}`, () => {
    test.use({ viewport: { width: ancho, height: ancho === 375 ? 667 : 844 } });

    test('🔴 la mezcla: mesas, pagos y restaurantes de viaje en una lista por fecha, en sus meses', async ({ page }) => {
      await entrar(page, { [MIS_MESAS]: 'sin_cobro' });
      await aMesas(page);
      await expect(lista(page).locator('.vj-visita')).toHaveCount(10);
      expect(await nombres(page)).toEqual(MEZCLA);
      expect(await meses(page)).toEqual(['octubre de 2026', 'septiembre de 2026', 'agosto de 2026', 'julio de 2026']);
      // Los meses incluyen los viajes: Mariscos El Faro va en octubre, entre la mesa del 10 y la del 7.
      const octubre = lista(page).getByRole('region', { name: 'octubre de 2026', exact: true });
      await expect(octubre.locator('.vj-visita')).toHaveCount(3);
      await expect(lista(page).getByRole('region', { name: 'julio de 2026', exact: true }).locator(NOMBRE)).toHaveText(['Los Pericos']);
      // Nada se desborda a lo ancho.
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(ancho);
      await capturar(page, 'mezcla');
    });

    // D481 · 8 · la misma fila que una mesa: el lugar, la marca con el nombre del viaje y «Te toca»; sin la fecha ni el tipo.
    test('🔴 el renglón: el lugar, la marca con el nombre del viaje y «Te toca»', async ({ page }) => {
      await entrar(page, { [MIS_MESAS]: 'sin_cobro' });
      await editarEstado(page, `e.viajes.find((v) => v.id === '${CANCUN}').color = 'violeta';`);
      await aMesas(page);
      const r = deViaje(page, 'Mariscos El Faro');
      await expect(r.locator('.fila-ticket-nombre')).toHaveText('Mariscos El Faro');
      await expect(r.locator('.hist-meta')).toHaveCount(0);
      await expect(r.locator('.vj-visita-viaje')).toHaveText('CCancún 2026');
      await expect(r.locator('.fila-ticket-rotulo')).toHaveText('Te toca');
      await expect(r.locator('.fila-ticket-monto')).toHaveText('$530');
      await expect(deViaje(page, 'Bar La Ola').locator('.fila-ticket-nombre')).toHaveText('Bar La Ola');
      await expect(deViaje(page, 'Café Barrio Antiguo').locator('.vj-visita-viaje')).toHaveText('MMonterrey fin de semana');
      const marca = r.locator('.vj-insignia');
      const m = await marca.evaluate((el) => {
        const b = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return { ancho: b.width, alto: b.height, fondo: cs.backgroundColor, radio: cs.borderRadius, color: cs.color };
      });
      // La inicial blanca sobre el color del viaje, cuadrada redondeada (D275: el círculo es de las personas).
      expect(m).toEqual({ ancho: 18, alto: 18, fondo: 'rgb(109, 40, 217)', radio: '5px', color: 'rgb(255, 255, 255)' });
      // Sin color, el de la app.
      expect(await deViaje(page, 'La Olla').locator('.vj-insignia').evaluate((el) => getComputedStyle(el).backgroundColor))
        .not.toBe('rgb(109, 40, 217)');
      // 🔴 Un renglón de viaje no se oculta: sin el gesto de «Eliminar».
      await expect(r.getByRole('button', { name: 'Eliminar', exact: true })).toHaveCount(0);
      await expect(lista(page).locator('.vj-visita .deslizable')).toHaveCount(0);
      // Control: las mesas que se pueden borrar sí lo tienen (el selector encuentra el gesto cuando está).
      expect(await lista(page).locator('.tu-mesa .deslizable').count()).toBeGreaterThan(0);
      // El renglón entero es un blanco cómodo.
      expect((await r.locator('button.fila-ticket').boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await capturar(page, 'renglon');
    });

    test('🔴 tocarlo abre el ticket dentro del viaje, con lo mismo que me toca; también en un viaje cerrado', async ({ page }) => {
      await entrar(page);
      await aMesas(page);
      await deViaje(page, 'Mariscos El Faro').locator('button.fila-ticket').click();
      await expect(page).toHaveURL(new RegExp(`/viaje-ticket/${CANCUN}\\.${MARISCOS}$`));
      await expect(page.getByRole('heading', { name: 'Mariscos El Faro', exact: true, level: 1 })).toBeVisible();
      // Abierto y «por lo que pidió cada uno»: «Te toca» va en el pie, con lo elegido.
      await expect(page.locator('.vjt-pie-fila .vjt-pie-rotulo')).toHaveText('Te toca');
      await expect(page.locator('.vjt-pie-fila .vjt-monto')).toHaveText('$530');
      await page.goBack();
      await expect(deViaje(page, 'La Olla')).toBeVisible();
      await deViaje(page, 'La Olla').locator('button.fila-ticket').click();
      await expect(page).toHaveURL(new RegExp(`/viaje-ticket/${OAXACA}\\.d2000000-[0-9a-f-]+$`));
      await expect(page.getByRole('heading', { name: 'La Olla', exact: true, level: 1 })).toBeVisible();
      // Cerrado: «Te toca» en los totales.
      await expect(page.locator('.vjt-total-fila--toca')).toHaveText('Te toca$480');
    });
  });
}

test.describe('D293 · la marca con la foto del viaje (a 390)', () => {
  test('con foto, la foto en la marca', async ({ page }) => {
    await entrar(page);
    await page.evaluate(async (v) => {
      const c = document.createElement('canvas');
      c.width = 64; c.height = 64;
      const g = c.getContext('2d')!;
      g.fillStyle = '#0FB5C9'; g.fillRect(0, 0, 64, 64);
      const blob = await new Promise<Blob>((ok) => c.toBlob((b) => ok(b!), 'image/png'));
      const ruta = '/src/api/mock/viajes.ts';
      const m = await import(/* @vite-ignore */ ruta) as { mockSubirFotoDeViaje: (id: string, foto: Blob) => Promise<unknown> };
      await m.mockSubirFotoDeViaje(v, blob);
    }, CANCUN);
    await aMesas(page);
    await expect(deViaje(page, 'Mariscos El Faro').locator('.vj-insignia img.vj-insignia-foto')).toBeVisible();
    await expect(deViaje(page, 'La Olla').locator('.vj-insignia img')).toHaveCount(0);
  });
});

test.describe('🔴 D293 · las dos paginaciones (a 390)', () => {
  test('mesas y visitas de a 20, mezcladas: «Ver más» nunca saltea ni repite, y lo que se veía no se mueve', async ({ page }) => {
    await entrar(page, { [MIS_MESAS]: 'muchas', [VISITAS]: 'muchas' });
    await aMesas(page);
    // Una mesa cada hora desde hace 1 h y una visita cada hora desde hace media hora: la primera página de visitas
    // termina a las 19 h 30 y frena ahí (la mesa de las 20 h espera, la página siguiente de visitas podría ir antes).
    const v = (k: number) => `Restaurante de viaje ${k}`;
    const m = (k: number) => `Mesa de prueba ${k}`;
    const alternadas = (hasta: number) => Array.from({ length: hasta }, (_, i) => [v(i + 1), m(i + 1)]).flat();
    await expect(lista(page).locator('.hist-item')).toHaveCount(39);
    const primera = await nombres(page);
    expect(primera).toEqual(alternadas(20).slice(0, 39));
    await verMas(page).click();
    // Llegó la página 2 de visitas: ahora frenan las mesas (la de las 20 h se ve; la de las 21 h, todavía no).
    await expect(lista(page).locator('.hist-item')).toHaveCount(40);
    const segunda = await nombres(page);
    expect(segunda.slice(0, 39)).toEqual(primera);
    expect(segunda[39]).toBe(m(20));
    await verMas(page).click();
    // Todo: 23 mesas, 35 visitas (25 + las 10 de la semilla) y los 3 pagos del mock.
    await expect(lista(page).locator('.hist-item')).toHaveCount(61);
    await expect(verMas(page)).toHaveCount(0);
    const todas = await nombres(page);
    expect(todas.slice(0, 40)).toEqual(segunda);
    expect(todas.slice(0, 48)).toEqual([...alternadas(23), v(24), v(25)]);
    expect(new Set(todas.filter((x) => x.startsWith('Mesa de prueba') || x.startsWith('Restaurante de viaje'))).size).toBe(48);
    expect(todas.slice(48)).toEqual(['La Parolaccia', 'Mariscos El Faro', 'Bar La Ola', 'Fonda Doña Mary', 'Hanzo Sushi', 'La Parolaccia',
      'Café Barrio Antiguo', 'El Rey del Cabrito', 'Café Brújula Bar', 'Tlayudas Libres', 'Mezcalería Los Amantes', 'La Olla', 'Los Pericos']);
  });

  test('si falla una página de «Ver más», lo que se veía queda y el botón reintenta', async ({ page }) => {
    await entrar(page, { [MIS_MESAS]: 'muchas', [VISITAS]: 'muchas' });
    await aMesas(page);
    await expect(lista(page).locator('.hist-item')).toHaveCount(39);
    const antes = await nombres(page);
    await page.evaluate((k) => localStorage.setItem(k, 'error'), VISITAS);
    await verMas(page).click();
    await expect(lista(page).getByRole('alert')).toHaveText('No pudimos cargar más. Prueba de nuevo.');
    expect(await nombres(page)).toEqual(antes);
    await expect(page.getByText('No pudimos cargar los restaurantes de tus viajes')).toHaveCount(0);
    await page.evaluate((k) => localStorage.setItem(k, 'muchas'), VISITAS);
    await verMas(page).click();
    await expect(lista(page).locator('.hist-item')).toHaveCount(40);
    await expect(lista(page).getByRole('alert')).toHaveCount(0);
  });
});

test.describe('D293 · sin la config (a 390)', () => {
  test('si la config no llega, Mesas no se queda esperando: las mesas y los pagos, sin viajes y sin aviso', async ({ page }) => {
    await entrar(page, { [MIS_MESAS]: 'sin_cobro', 'payme.app.mock.config.v1': 'error' });
    await aMesas(page);
    await expect(lista(page).locator('.tu-mesa')).toHaveCount(3);
    await expect(lista(page).locator('.vj-visita')).toHaveCount(0);
    await expect(page.getByText('No pudimos cargar los restaurantes de tus viajes')).toHaveCount(0);
  });
});

/** Arrastra la tarjeta a la izquierda con el puntero (el gesto de «Eliminar», D239). */
async function abrirYEliminar(page: Page, tarjeta: ReturnType<Page['locator']>): Promise<void> {
  const caja = (await tarjeta.boundingBox())!;
  const y = caja.y + Math.min(30, caja.height / 2);
  const x = caja.x + caja.width - 40;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let k = 1; k <= 8; k += 1) await page.mouse.move(x - (120 * k) / 8, y);
  await page.mouse.up();
  await expect(tarjeta.locator('.deslizable--abierta')).toHaveCount(1);
  await tarjeta.locator('.deslizable-eliminar').click();
}

const pedidosDeVisitas = (page: Page) => page.evaluate(async () => {
  const r = '/src/api/mock/viajes.ts';
  return (await import(/* @vite-ignore */ r) as { pedidosDeVisitasMock: () => number }).pedidosDeVisitasMock();
});

test.describe('D293 · ocultar una mesa (a 390)', () => {
  test('después de ocultar una mesa, las visitas se vuelven a pedir (ocultar la mesa de un recibo vuelve visita a su ticket)', async ({ page }) => {
    await entrar(page, { [MIS_MESAS]: 'sin_cobro' });
    await aMesas(page);
    await expect(lista(page).locator('.vj-visita')).toHaveCount(10);
    const antes = await pedidosDeVisitas(page);
    const guero = lista(page).locator('.tu-mesa').filter({ hasText: 'Tacos El Güero' });
    await abrirYEliminar(page, guero);
    await page.getByRole('dialog', { name: '¿Borrar también su historial?' })
      .getByRole('button', { name: 'No, sólo la mesa', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Borraste la mesa de tu app.' })).toBeVisible();
    await expect.poll(() => pedidosDeVisitas(page)).toBeGreaterThan(antes);
    await expect(lista(page).locator('.vj-visita')).toHaveCount(10);
  });
});

test.describe('🔴 D293 · una fuente que falla (a 390)', () => {
  test('fallan los restaurantes de viaje: su aviso y «Reintentar»; las mesas y los pagos se siguen viendo', async ({ page }) => {
    await entrar(page, { [MIS_MESAS]: 'sin_cobro', [VISITAS]: 'error' });
    await aMesas(page);
    await expect(page.getByRole('alert').filter({ hasText: 'No pudimos cargar los restaurantes de tus viajes' })).toBeVisible();
    await expect(lista(page).locator('.vj-visita')).toHaveCount(0);
    expect(await nombres(page)).toEqual(MEZCLA.filter((x) => ['La Parolaccia', 'Tacos El Güero', 'Café Tacuba', 'Hanzo Sushi'].includes(x)));
    await expect(page.getByText('Todavía no cerraste ninguna mesa.')).toHaveCount(0);
    await capturar(page, 'fallan-los-viajes');
    await page.evaluate((k) => localStorage.removeItem(k), VISITAS);
    await page.getByRole('alert').filter({ hasText: 'No pudimos cargar los restaurantes de tus viajes' })
      .getByRole('button', { name: 'Reintentar', exact: true }).click();
    await expect(lista(page).locator('.vj-visita')).toHaveCount(10);
    expect(await nombres(page)).toEqual(MEZCLA);
    await expect(page.getByText('No pudimos cargar los restaurantes de tus viajes')).toHaveCount(0);
  });

  test('fallan las mesas: su aviso; los restaurantes de viaje y los pagos se siguen viendo', async ({ page }) => {
    await entrar(page, { [MIS_MESAS]: 'error' });
    await aMesas(page);
    await expect(page.getByText('No pudimos cargar tus mesas')).toBeVisible();
    await expect(lista(page).locator('.vj-visita')).toHaveCount(10);
    await expect(lista(page).locator('.tu-mesa')).toHaveCount(0);
    expect(await nombres(page)).toEqual(MEZCLA.filter((x) => !['Tacos El Güero', 'Café Tacuba'].includes(x)).slice(1));
  });

  test('sin mesas ni pagos y con los viajes en falla: el aviso, nunca «Todavía no cerraste ninguna mesa»', async ({ page }) => {
    await entrar(page, { [MIS_MESAS]: 'vacio', [VISITAS]: 'error' });
    await page.goto('/privacy');
    await expect(page.getByRole('heading', { name: 'Aviso de privacidad' })).toBeVisible();
    await page.evaluate(() => {
      const st = JSON.parse(localStorage.getItem('payme_mock_state_v1')!);
      st.history = [];
      localStorage.setItem('payme_mock_state_v1', JSON.stringify(st));
    });
    await page.goto('/home');
    await expect(page.getByRole('button', { name: 'Escanear', exact: true })).toBeVisible();
    await aMesas(page);
    await expect(page.getByRole('alert').filter({ hasText: 'No pudimos cargar los restaurantes de tus viajes' })).toBeVisible();
    await expect(page.locator('.hist-item')).toHaveCount(0);
    await expect(page.getByText('Todavía no cerraste ninguna mesa.')).toHaveCount(0);
    // Control: al reintentar sin la falla llegan los restaurantes de viaje (lo que el vacío habría negado).
    await page.evaluate((k) => localStorage.removeItem(k), VISITAS);
    await page.getByRole('alert').filter({ hasText: 'No pudimos cargar los restaurantes de tus viajes' })
      .getByRole('button', { name: 'Reintentar', exact: true }).click();
    await expect(lista(page).locator('.vj-visita')).toHaveCount(10);
  });

  test('con Viajes apagado, Mesas queda como antes: sin renglones de viaje y sin aviso', async ({ page }) => {
    await entrar(page, { [MIS_MESAS]: 'sin_cobro' }, false);
    await aMesas(page);
    await expect(lista(page).locator('.tu-mesa')).toHaveCount(3);
    await expect(lista(page).locator('.vj-visita')).toHaveCount(0);
    await expect(page.getByText('No pudimos cargar los restaurantes de tus viajes')).toHaveCount(0);
  });
});

/**
 * El dueño de la sesión es la familia más la persona (`duenoDeSesion`). Con otra familia, `AuthProvider` remonta la app
 * entera; con otra persona de la misma familia NO la remonta: ahí cuidan la pantalla `alVaciarse` y el turno de cada
 * pedido. Se prueban las dos.
 */
const CAMBIOS = {
  'otra familia': { family_id: 'familia-sintetica-b', principal_id: 'cuenta-b' },
  'otra persona de la misma familia': { principal_id: 'cuenta-b' },
} as const;

/**
 * B tiene su @ (`payme.app.mock.username_propio.v1`): sin él, la puerta «Elige tu @usuario» tapa la app entera a los
 * pocos segundos, y un «no se ve nada de A» pasaría por la causa equivocada.
 */
async function cambiarDeCuenta(page: Page, cambio: (typeof CAMBIOS)[keyof typeof CAMBIOS], latenciaDeB: string): Promise<void> {
  await page.evaluate(async ({ k, lat, c }) => {
    localStorage.setItem('payme.app.mock.username_propio.v1', JSON.stringify({
      ...JSON.parse(localStorage.getItem('payme.app.mock.username_propio.v1') ?? '{}'),
      [c.principal_id]: { username: 'cuenta.b', changed_at: null },
    }));
    localStorage.setItem(k, lat);
    const r = '/src/api/storage.ts';
    const store = await import(/* @vite-ignore */ r);
    const a = store.loadSession();
    store.saveSession({ ...a, ...c, user: { ...a.user, id: c.principal_id } });
  }, { k: LATENCIA, lat: latenciaDeB, c: cambio });
}

/**
 * B no tiene viajes: el estado de Viajes del mock queda vacío (y sin las visitas sintéticas), así lo que sea de A se
 * distingue de lo de B. Un pedido de A que ya salió trae lo de A: el mock arma la respuesta al pedir.
 */
async function bSinViajes(page: Page): Promise<void> {
  await page.evaluate(async ({ k, s }) => {
    // El módulo se trae ANTES de editar: la edición y el olvido de la memoria del mock quedan en un tramo sin esperas,
    // así ningún pedido del medio guarda la memoria vieja encima.
    const r = '/src/api/mock/viajes.ts';
    const m = await import(/* @vite-ignore */ r) as { olvidarViajesMockParaTests: () => void };
    const e = JSON.parse(localStorage.getItem(k)!);
    e.viajes = [];
    localStorage.setItem(k, JSON.stringify(e));
    localStorage.removeItem(s);
    m.olvidarViajesMockParaTests();
  }, { k: ESTADO, s: VISITAS });
}

for (const [nombre, cambio] of Object.entries(CAMBIOS)) {
  test.describe(`🔴 D293 · T-01, con ${nombre}: nada de las visitas de A queda a la vista de B (a 390)`, () => {
    test('A con Mesas abierta → entra B: los renglones de A desaparecen en el acto, antes de que llegue nada', async ({ page }) => {
      await entrar(page, { [MIS_MESAS]: 'sin_cobro' });
      await aMesas(page);
      await expect(deViaje(page, 'Mariscos El Faro')).toBeVisible();
      await cambiarDeCuenta(page, cambio, '5000');
      await expect(page.locator('.vj-visita')).toHaveCount(0);
      await expect(page.getByText('Mariscos El Faro')).toHaveCount(0);
      await expect(page.getByText('Cancún 2026')).toHaveCount(0);
      // Tampoco sus mesas ni sus pagos.
      await expect(page.locator('.hist-item')).toHaveCount(0);
    });

    test('A pide las visitas (en vuelo) → entra B: lo de A, al llegar, se descarta; lo de B se muestra', async ({ page }) => {
      await entrar(page, { [MIS_MESAS]: 'sin_cobro' });
      // Los pedidos de A tardan 3 s; los de B, 5 s desde el cambio: hay una ventana en la que sólo llegó lo de A.
      await page.evaluate((k) => localStorage.setItem(k, '3000'), LATENCIA);
      await aMesas(page);
      await expect(page.locator('[aria-busy="true"]')).toBeVisible();
      const t0 = Date.now();
      await page.waitForTimeout(1000);
      await cambiarDeCuenta(page, cambio, '5000');
      // Ya llegó lo de A (a los 3 s) y todavía no lo de B (a los ~6 s): no se ve nada de A.
      await page.waitForTimeout(Math.max(0, 4300 - (Date.now() - t0)));
      await expect(page.locator('.vj-visita')).toHaveCount(0);
      await expect(page.locator('.hist-item')).toHaveCount(0);
      await expect(page.locator('[aria-busy="true"]')).toBeVisible();
      // Llega lo de B: la pantalla no quedó trabada.
      await expect(page.locator('.vj-visita').first()).toBeVisible({ timeout: 10_000 });
    });

    test('A pide las visitas (5 s) → entra B, que no tiene viajes y recibe lo suyo enseguida: lo de A, al llegar tarde, no aparece', async ({ page }) => {
      await entrar(page, { [MIS_MESAS]: 'sin_cobro' });
      await page.evaluate((k) => localStorage.setItem(k, '5000'), LATENCIA);
      await aMesas(page);
      await page.waitForTimeout(500);
      await bSinViajes(page);
      await cambiarDeCuenta(page, cambio, '100');
      await expect(lista(page).locator('.tu-mesa')).toHaveCount(3);
      await expect(lista(page).locator('.vj-visita')).toHaveCount(0);
      // Ya llegó lo de A (a los 5 s del pedido): no se ve. Control: la lista de B sigue a la vista.
      await page.waitForTimeout(5500);
      await expect(lista(page).locator('.tu-mesa')).toHaveCount(3);
      await expect(lista(page).locator('.vj-visita')).toHaveCount(0);
      await expect(page.getByText('Mariscos El Faro')).toHaveCount(0);
    });

    test('A pide más visitas (5 s) → entra B sin viajes: la página de A no se pega a la lista de B', async ({ page }) => {
      await entrar(page, { [MIS_MESAS]: 'sin_cobro', [VISITAS]: 'muchas' });
      await aMesas(page);
      await expect(lista(page).locator('.vj-visita')).toHaveCount(20);
      await page.evaluate((k) => localStorage.setItem(k, '5000'), LATENCIA);
      await verMas(page).click();
      await page.waitForTimeout(300);
      await bSinViajes(page);
      await cambiarDeCuenta(page, cambio, '100');
      await expect(lista(page).locator('.tu-mesa')).toHaveCount(3);
      await expect(lista(page).locator('.vj-visita')).toHaveCount(0);
      await page.waitForTimeout(5500);
      await expect(lista(page).locator('.tu-mesa')).toHaveCount(3);
      await expect(lista(page).locator('.vj-visita')).toHaveCount(0);
    });

    test('A pide más mesas (5 s) → entra B: la página de A no se pega a la lista de B', async ({ page }) => {
      await entrar(page, { [MIS_MESAS]: 'muchas' });
      await aMesas(page);
      await expect(lista(page).locator('.tu-mesa')).toHaveCount(20);
      await page.evaluate((k) => localStorage.setItem(k, '5000'), LATENCIA);
      await verMas(page).click();
      await page.waitForTimeout(300);
      await cambiarDeCuenta(page, cambio, '100');
      // B ve su primera página (el mock le contesta lo mismo), con su «Ver más».
      await expect(lista(page).locator('.tu-mesa')).toHaveCount(20);
      await expect(verMas(page)).toBeVisible();
      await page.waitForTimeout(5500);
      await expect(lista(page).locator('.tu-mesa')).toHaveCount(20);
      await expect(verMas(page)).toBeVisible();
    });
  });
}
