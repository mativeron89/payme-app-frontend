import { expect, test, type Page } from '@playwright/test';
import { ingresar, irEnLaApp, relojFueraDeLasFechasDeLosViajes } from './_app';

/**
 * AF-AUDITORIA-CODEX-W01-W02-20261011 (0.242.1) · lo que la auditoría de Codex (D287) encontró contra decisiones
 * vigentes, a 375:
 * - W-01 · Balance ordena por la visita, no por la carga (D281, D278-1).
 * - W-02 · la precarga de la cámara no queda trabada al cambiar de cuenta (D276-1).
 * - D275 §3 (1g) · «No tienes mesas abiertas» no aparece con un restaurante del viaje pendiente. Mati lo vio en su
 *   iPhone: Holbox con «LAS HAMACAS · Falta 1 por elegir» y el aviso igual.
 *
 * La semilla del mock: «Cancún 2026» (5 al 11 de octubre) con Fonda Doña Mary (6/10 21:30), Bar La Ola (6/10 23:50),
 * Súper del Caribe (7/10 11:20), Café Caribe (7/10 17:45) y Mariscos El Faro (8/10 21:40, donde Diego no eligió). Cada
 * uno se cargó a la hora de su visita.
 */
const CANCUN = 'd1000000-0000-4000-8000-000000000001';
const MARISCOS = 'd2000000-0000-4000-8000-000000000105';
const ESTADO_VIAJES = 'payme.app.mock.viajes.estado.v1';

test.use({ viewport: { width: 375, height: 667 } });

async function conViajes(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('payme.app.mock.viajes.v1', 'encendido');
    localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled');
  });
  // D276-1 · el día de la corrida no decide a dónde va «Nueva» (`_app.ts`).
  await relojFueraDeLasFechasDeLosViajes(page);
  await ingresar(page);
}

type TicketSemilla = { id: string; lugar: string; fecha_ticket: string | null; hora_ticket: string | null; personas: Array<{ listo_en: string | null }> };

/** Cambia los tickets de Cancún en el estado del mock (el mock lo lee al cargar) y recarga. */
async function editarCancun(page: Page, cambio: 'mariscos-el-5' | 'mariscos-el-5-y-cafe-se-llama-mariscos' | 'eligieron-todos'): Promise<void> {
  await page.evaluate(({ k, cambio: c, cancun, mariscos }) => {
    const e = JSON.parse(localStorage.getItem(k)!) as { viajes: Array<{ id: string; tickets: TicketSemilla[] }> };
    const tickets = e.viajes.find((v) => v.id === cancun)!.tickets;
    const m = tickets.find((x) => x.id === mariscos)!;
    if (c === 'eligieron-todos') {
      // Diego toca «Listo» en Mariscos El Faro: ningún restaurante del viaje queda pendiente.
      for (const p of m.personas) p.listo_en = p.listo_en ?? '2026-10-11T01:00:00.000Z';
    } else {
      // Mariscos El Faro se visitó el primer día (sin hora impresa), pero se escaneó al final: el dueño lo manda primero.
      m.fecha_ticket = '2026-10-05';
      m.hora_ticket = null;
      if (c === 'mariscos-el-5-y-cafe-se-llama-mariscos') tickets.find((x) => x.lugar === 'Café Caribe')!.lugar = 'Mariscos El Faro';
    }
    localStorage.setItem(k, JSON.stringify(e));
  }, { k: ESTADO_VIAJES, cambio, cancun: CANCUN, mariscos: MARISCOS });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
}

/** Sin mesas abiertas: el estado del mock, editado y releído. */
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

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (dir) await page.screenshot({ path: `${dir}/w01-w02-375-${nombre}.png` });
}

// Los `import()` de módulos de la app van con la ruta `as string` y `@vite-ignore`: la sirve Vite en el navegador, y
// `tsc -p tsconfig.e2e.json` no la resuelve como un literal (Playwright no chequea tipos).

// ─── W-01 ────────────────────────────────────────────────────────────────

/**
 * Las filas de Consumos, de arriba a abajo: el nombre de cada lugar. Una fila que se puede eliminar va dentro de
 * `FilaDeslizable` (no es hija directa del `li`); las visitas de un lugar abierto llevan su fecha, no el lugar.
 */
const filasDeConsumos = (page: Page) => page.locator('.vjb-consumos > li .vjb-consumo-lugar');

async function abrirBalance(page: Page): Promise<void> {
  await irEnLaApp(page, `/viaje-balance/${CANCUN}`);
  await expect(filasDeConsumos(page).first()).toBeVisible();
}

test.describe('🔴 W-01 · Balance ordena por la visita, no por la carga', () => {
  test('dos lugares con la fecha impresa y la carga opuestas: el visitado el primer día va último', async ({ page }) => {
    await conViajes(page);
    await editarCancun(page, 'mariscos-el-5');
    await abrirBalance(page);
    // El dueño manda Mariscos primero (se cargó último); la visita fue el 5/10, sin hora: las 12:00 de ese día.
    await expect(filasDeConsumos(page)).toHaveText(['Café Caribe', 'Súper del Caribe', 'Bar La Ola', 'Fonda Doña Mary', 'Mariscos El Faro']);
    await capturar(page, 'balance-dos-lugares');
  });

  test('un solo lugar: adentro, de la visita más reciente a la más vieja; y un gasto a mano va por su carga', async ({ page }) => {
    await conViajes(page);
    await editarCancun(page, 'mariscos-el-5-y-cafe-se-llama-mariscos');
    // Un gasto a mano, sin fecha impresa: va por su carga (hoy, 13/10, con el reloj de la corrida), el más reciente.
    await page.evaluate(async (cancun) => {
      const { api, newIdempotencyKey } = await import(/* @vite-ignore */ '/src/api/index.ts' as string);
      // La fachada de Viajes necesita la capacidad: se lee la configuración primero.
      await api.getConfig();
      const d = await api.getViaje(cancun);
      await api.cargarGastoDeViaje(cancun, {
        descripcion: 'Taxi al aeropuerto', monto_cents: 45000, presentes: d.miembros.map((m: { id: string }) => m.id),
        idempotency_key: newIdempotencyKey(),
      });
    }, CANCUN);
    await abrirBalance(page);
    // «Mariscos El Faro» junta el de Mariscos (visita 5/10, cargado último) y el ex Café Caribe (visita 7/10 17:45). Su
    // fila va donde está su visita más reciente: después del taxi y antes del súper.
    await expect(filasDeConsumos(page)).toHaveText(['Taxi al aeropuerto', 'Mariscos El Faro', 'Súper del Caribe', 'Bar La Ola', 'Fonda Doña Mary']);
    const grupo = page.locator('button.vjb-lugar').filter({ hasText: 'Mariscos El Faro' });
    await grupo.click();
    // Adentro, la del 7/10 primero, aunque el dueño mande primero la del 5/10.
    await expect(page.locator('.vjb-visitas .vjb-visita-fecha')).toHaveText(['7 oct', '5 oct']);
    await capturar(page, 'balance-un-lugar');
  });
});

// ─── W-02 ────────────────────────────────────────────────────────────────

const B = 'b0000000-0000-4000-8000-000000000002';

/**
 * Desde Más (sin pasar por Inicio), con la precarga de la cuenta ya hecha: el reloj dentro de las fechas y cada pedido
 * de la lista de abiertos retenido, con la cuenta y el turno de quien lo pidió. Al soltarlo, la fachada anota lo que
 * «llegó» con ESE turno, como la real.
 */
async function prepararPrecargaRetenida(page: Page): Promise<void> {
  await conViajes(page);
  await page.evaluate(async () => { const { api } = await import(/* @vite-ignore */ '/src/api/index.ts' as string); await api.getConfig(); });
  await irEnLaApp(page, '/mas');
  await expect.poll(() => page.evaluate(async () => {
    const m = await import(/* @vite-ignore */ '/src/api/viajesDeHoy.ts' as string);
    return m.viajesAbiertosRecordados() !== null;
  })).toBe(true);
  await page.clock.setFixedTime(new Date('2026-10-09T18:00:00Z'));
  await page.evaluate(async () => {
    const { api } = await import(/* @vite-ignore */ '/src/api/index.ts' as string);
    const store = await import(/* @vite-ignore */ '/src/api/storage.ts' as string);
    const { olvidarViajesAbiertosRecordados, recordarViajesAbiertos } = await import(/* @vite-ignore */ '/src/api/viajesDeHoy.ts' as string);
    const { ultimoVisto } = await import(/* @vite-ignore */ '/src/api/ultimoVisto.ts' as string);
    const { precargarViajesAbiertos } = await import(/* @vite-ignore */ '/src/screens/viajes/useViajesDeHoy.ts' as string);
    const w = window as unknown as { pedidos: Array<{ quien: string | null; soltar: (nombre: string) => void }>; sesionA: unknown };
    w.pedidos = [];
    w.sesionA = store.loadSession();
    (api as unknown as { getViajes: () => Promise<unknown> }).getViajes = () => {
      const turno = ultimoVisto.turno();
      return new Promise((resolve) => {
        w.pedidos.push({
          quien: store.loadSession()?.principal_id ?? null,
          soltar: (nombre: string) => {
            const viaje = { id: `viaje-${nombre}`, nombre, estado: 'abierto', fecha_desde: '2026-10-01', fecha_hasta: '2026-10-20' };
            recordarViajesAbiertos(turno, [viaje] as never);
            resolve({ viajes: [], counts: { abiertos: 1, cerrados: 0 } });
          },
        });
      });
    };
    // La precarga de A, en vuelo.
    olvidarViajesAbiertosRecordados();
    precargarViajesAbiertos();
  });
  await expect.poll(() => page.evaluate(() => (window as unknown as { pedidos: unknown[] }).pedidos.length)).toBe(1);
}

/** Entra con la cuenta sintética B (otra familia), o vuelve a la de A. Sin navegar: se queda en Más. */
async function cambiarDeCuenta(page: Page, a: 'A' | 'B'): Promise<void> {
  await page.evaluate(async ({ a, idB }) => {
    const store = await import(/* @vite-ignore */ '/src/api/storage.ts' as string);
    // La sesión de A tal cual se guardó; para B, la misma con otra familia y otra persona.
    const w = window as unknown as { sesionA: { user: Record<string, unknown> } & Record<string, unknown> };
    if (a === 'A') store.saveSession(w.sesionA);
    else store.saveSession({ ...w.sesionA, family_id: 'familia-sintetica-b', principal_id: idB, user: { ...w.sesionA.user, id: idB } });
  }, { a, idB: B });
}

const quienes = (page: Page) => page.evaluate(() => (window as unknown as { pedidos: Array<{ quien: string | null }> }).pedidos.map((p) => p.quien));
const soltar = (page: Page, i: number, nombre: string) => page.evaluate(({ i, nombre }) => {
  (window as unknown as { pedidos: Array<{ soltar: (n: string) => void }> }).pedidos[i]!.soltar(nombre);
}, { i, nombre });
const camara = (page: Page) => page.locator('button.appbar-center');

test.describe('🔴 W-02 · la precarga de la cámara no queda trabada al cambiar de cuenta', () => {
  test('A→B desde Más: B pide la suya con la de A pendiente; la tardía de A no se muestra; la cámara va al viaje de B', async ({ page }) => {
    await prepararPrecargaRetenida(page);
    const a = (await quienes(page))[0];
    await cambiarDeCuenta(page, 'B');
    await expect(page).toHaveURL(/\/mas$/);
    // B pide la suya aunque la de A siga pendiente.
    await expect.poll(() => quienes(page)).toEqual([a, B]);
    await expect(camara(page)).toHaveAccessibleName('Nueva');
    // Llega tarde la de A, con un viaje de hoy: no se guarda bajo B ni la cámara lo nombra.
    await soltar(page, 0, 'Viaje de A');
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await expect(camara(page)).toHaveAccessibleName('Nueva');
    // Llega la de B: la cámara va a su viaje. Y nadie volvió a pedir (la de B seguía en vuelo).
    await soltar(page, 1, 'Viaje sintético B');
    await expect(camara(page)).toHaveAccessibleName('Escanear ticket para Viaje sintético B');
    expect(await quienes(page)).toEqual([a, B]);
    await capturar(page, 'camara-de-b');
  });

  test('A→B→A con las respuestas fuera de orden: sólo cuenta la de la última entrada', async ({ page }) => {
    await prepararPrecargaRetenida(page);
    const a = (await quienes(page))[0];
    await cambiarDeCuenta(page, 'B');
    await expect.poll(() => quienes(page)).toEqual([a, B]);
    await cambiarDeCuenta(page, 'A');
    // De vuelta en A es otra generación: pide de nuevo, no se cuelga del pedido viejo de A.
    await expect.poll(() => quienes(page)).toEqual([a, B, a]);
    // Al revés: primero la de B, después la primera de A. Ninguna es de la entrada de ahora.
    await soltar(page, 1, 'Viaje de B');
    await soltar(page, 0, 'Viaje viejo de A');
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await expect(camara(page)).toHaveAccessibleName('Nueva');
    await soltar(page, 2, 'Viaje de A');
    await expect(camara(page)).toHaveAccessibleName('Escanear ticket para Viaje de A');
    expect(await quienes(page)).toEqual([a, B, a]);
  });
});

// ─── El aviso «No tienes mesas abiertas» ─────────────────────────────────

const aviso = (page: Page) => page.locator('.aviso-sin-mesas');
const pendientes = (page: Page) => page.locator('button.viaje-pendiente');

test.describe('🔴 D275 §3 (1g) · el aviso no aparece con un restaurante del viaje pendiente', () => {
  test('sin mesas y sin pendientes se ve; con un restaurante pendiente, no', async ({ page }) => {
    await conViajes(page);
    await sinMesas(page);
    // La semilla: Diego no eligió en Mariscos El Faro. Leídos los pendientes, el aviso no está.
    await expect(pendientes(page)).toHaveText(['Mariscos El FaroFalta 1 por elegir']);
    await expect(page.locator('button.viaje-burbuja').first()).toBeVisible();
    await expect(aviso(page)).toHaveCount(0);
    await capturar(page, 'aviso-con-pendiente');
    // Eligió: no queda ninguno, y el aviso aparece.
    await editarCancun(page, 'eligieron-todos');
    await expect(page.locator('button.viaje-burbuja').first()).toBeVisible();
    await expect(pendientes(page)).toHaveCount(0);
    await expect(aviso(page)).toBeVisible();
    await capturar(page, 'aviso-sin-pendientes');
  });

  test('con una mesa abierta, no (aunque no haya pendientes)', async ({ page }) => {
    await conViajes(page);
    await editarCancun(page, 'eligieron-todos');
    await expect(page.locator('.home-mesas .mesa-card').first()).toBeVisible();
    await expect(page.locator('button.viaje-burbuja').first()).toBeVisible();
    await expect(aviso(page)).toHaveCount(0);
  });

  /**
   * Mientras se leen los pendientes, el aviso no se ve: no se afirma «no tienes» sin haber leído. Se retienen los
   * detalles de los viajes y se borra lo último visto de Viajes, así Inicio los pide de cero al entrar.
   */
  for (const final of ['llegan', 'fallan'] as const) {
    test(`mientras cargan los pendientes, no; si ${final === 'llegan' ? 'llegan sin ninguno, aparece' : 'fallan, tampoco'}`, async ({ page }) => {
      await conViajes(page);
      await sinMesas(page);
      await editarCancun(page, 'eligieron-todos');
      await expect(aviso(page)).toBeVisible();
      await irEnLaApp(page, '/mas');
      await page.evaluate(async () => {
        const { api } = await import(/* @vite-ignore */ '/src/api/index.ts' as string);
        const { olvidarLoDeViajes } = await import(/* @vite-ignore */ '/src/api/ultimoVisto.ts' as string);
        const w = window as unknown as { detalles: Array<{ seguir: () => void; fallar: () => void }> };
        w.detalles = [];
        const real = api.getViaje.bind(api);
        (api as unknown as { getViaje: typeof real }).getViaje = (...args: Parameters<typeof real>) => new Promise((resolve, reject) => {
          w.detalles.push({ seguir: () => { real(...args).then(resolve, reject); }, fallar: () => reject(new Error('sin red')) });
        });
        olvidarLoDeViajes();
      });
      await irEnLaApp(page, '/');
      // La lista de viajes ya llegó y el detalle de Cancún está retenido: el aviso no se ve.
      await expect(page.locator('button.viaje-burbuja').first()).toBeVisible();
      await expect.poll(() => page.evaluate(() => (window as unknown as { detalles: unknown[] }).detalles.length)).toBeGreaterThanOrEqual(1);
      await expect(aviso(page)).toHaveCount(0);
      await capturar(page, 'aviso-cargando');
      await page.evaluate((f) => {
        for (const d of (window as unknown as { detalles: Array<{ seguir: () => void; fallar: () => void }> }).detalles) {
          if (f === 'llegan') d.seguir(); else d.fallar();
        }
      }, final);
      if (final === 'llegan') {
        await expect(aviso(page)).toBeVisible();
      } else {
        // Falló el detalle: los pendientes de ese viaje no se leyeron. El aviso sigue sin verse, también un rato después.
        await page.waitForTimeout(300);
        await expect(aviso(page)).toHaveCount(0);
        await expect(page.locator('button.viaje-burbuja').first()).toBeVisible();
      }
    });
  }
});
