import { expect, test, type Page } from '@playwright/test';
import { omitirGuiaEnFixture } from './_app';
import { camaraSimulada, camarasAbiertas, sacarFoto } from './_camara';

/**
 * D276 · Mati: «siempre que estes dentro de las fechas del viaje y seleccionas la cámara para escanear ticket, por
 * default se tiene que ir a los gastos del viaje», «¿Quiénes estuvieron?» con todos marcados en las tres formas, el
 * gasto personal («si pones solo vos y no seleccionas a nadie más quiere decir que es un gasto personal») y el que no
 * estuvo, que no elige.
 *
 * El reloj va FIJO en cada caso y en la hora de México (sin horario de verano desde 2022): «Cancún 2026», el viaje
 * abierto del mock, va del 5 al 11 de octubre de 2026. Los bordes se prueban de noche, donde la fecha local y la UTC
 * no coinciden: si la app mirara UTC, fallarían.
 */
test.use({ viewport: { width: 375, height: 812 }, timezoneId: 'America/Mexico_City' });

const CANCUN = 'd1000000-0000-4000-8000-000000000001';
const TULUM = 'd1000000-0000-4000-8000-000000000099';
const MARISCOS = 'd2000000-0000-4000-8000-000000000105';
const ESTADO_VIAJES = 'payme.app.mock.viajes.estado.v1';
const PERSONAL = 'Es un gasto personal: sólo lo ves tú y no suma al total del viaje.';

/** Un instante de la Ciudad de México. */
const mx = (s: string) => new Date(`${s}-06:00`);
/** Dentro de Cancún y después del último ticket de la semilla (9 oct): lo que cargo es lo más nuevo de Consumos. */
const DENTRO = mx('2026-10-10T14:00:00');

/**
 * Entra con Viajes encendido y el reloj en `instante`. No usa `ingresar()`: ése espera «Nueva» como nombre
 * accesible, y dentro de las fechas el círculo se llama «Escanear ticket para Cancún 2026».
 */
async function entrar(page: Page, instante: Date, extra: Record<string, string> = {}): Promise<void> {
  await omitirGuiaEnFixture(page);
  await page.addInitScript((seams) => {
    localStorage.setItem('payme.app.mock.viajes.v1', 'encendido');
    for (const [k, v] of Object.entries(seams)) localStorage.setItem(k, v);
  }, extra);
  await page.clock.setFixedTime(instante);
  await camaraSimulada(page);
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill('mati@payme.mx');
  await page.getByLabel('Contraseña', { exact: true }).fill('demo-e2e');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(circulo(page)).toBeVisible();
}

const circulo = (page: Page) => page.locator('button.appbar-center');
const alViaje = (page: Page, nombre = 'Cancún 2026') =>
  page.getByRole('button', { name: `Escanear ticket para ${nombre}`, exact: true });
/** Inicio ya tiene la lista de abiertos (la misma pedida que recuerda la barra): la burbuja del viaje se ve. */
const burbuja = (page: Page, nombre: string) => page.locator('button.viaje-burbuja').filter({ hasText: nombre });

/** Navegación de la app sin recargar (lo escaneado vive en memoria). */
async function ir(page: Page, ruta: string): Promise<void> {
  await page.evaluate((u) => {
    history.pushState(null, '', u);
    dispatchEvent(new PopStateEvent('popstate'));
  }, ruta);
}

/** Cambia el estado de los viajes del mock y recarga (el mock lo lee al cargar). */
/**
 * 🔴 0.245.0 · la edición se hace desde una página pública (`/privacy`), que no carga el mock, y después se vuelve a
 * Inicio. Antes se editaba dentro de la app y se recargaba: un pedido del mock que salía en el medio guardaba su
 * memoria encima y la edición se perdía («Tulum 2026» no aparecía). Medido con 10 workers y 40 repeticiones: 5 y 1 de
 * 40 en la base `4651793`, 6 y 7 en el candidato. La misma clase que `editarEstado` de `viajes-notas` (0.244.1).
 */
async function editarViajes(page: Page, cambio: 'sin-fecha-hasta' | 'dos-viajes' | 'monterrey-hoy'): Promise<void> {
  await page.goto('/privacy');
  await expect(page.getByRole('heading', { name: 'Aviso de privacidad' })).toBeVisible();
  await page.evaluate(({ k, cambio: c, tulum }) => {
    const e = JSON.parse(localStorage.getItem(k)!) as { viajes: Array<Record<string, unknown> & { id: string; nombre: string }> };
    const cancun = e.viajes.find((v) => v.id === 'd1000000-0000-4000-8000-000000000001')!;
    if (c === 'sin-fecha-hasta') cancun.fecha_hasta = null;
    else if (c === 'monterrey-hoy') {
      // «Monterrey fin de semana» sigue esperando pagos, pero con fechas que también cubren el 10 de octubre.
      const monterrey = e.viajes.find((v) => v.id === 'd1000000-0000-4000-8000-000000000002')!;
      monterrey.fecha_desde = '2026-10-09';
      monterrey.fecha_hasta = '2026-10-12';
    } else e.viajes.push({ ...structuredClone(cancun), id: tulum, nombre: 'Tulum 2026', tickets: [], transferencias: [] });
    localStorage.setItem(k, JSON.stringify(e));
  }, { k: ESTADO_VIAJES, cambio, tulum: TULUM });
  await page.goto('/home');
  await expect(circulo(page)).toBeVisible();
}

const presentes = (page: Page) => page.getByRole('group', { name: '¿Quiénes estuvieron?', exact: true }).getByRole('checkbox');
const presente = (page: Page, nombre: RegExp) => presentes(page).filter({ hasText: nombre });

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (!dir) return;
  await page.screenshot({ path: `${dir}/d276-375-${nombre}.png` });
}

/** Desde Inicio, la cámara del viaje y la foto: «Ticket nuevo». */
async function escanearEnCancun(page: Page): Promise<void> {
  await alViaje(page).click();
  await expect(page).toHaveURL(new RegExp(`/scan/${CANCUN}$`));
  await sacarFoto(page);
  await expect(page.getByRole('heading', { name: 'Ticket nuevo', level: 1 })).toBeVisible();
}

test.describe('🔴 D276-1 · la cámara de Nueva por las fechas del viaje', () => {
  test('dentro de las fechas, desde Inicio: la cámara se abre en el toque y escanea para el viaje', async ({ page }) => {
    await entrar(page, DENTRO);
    await expect(alViaje(page)).toBeVisible();
    // A la vista sigue diciendo «Nueva»; el lector de pantalla oye a dónde va.
    await expect(circulo(page)).toHaveText('Escanear');
    const antes = camarasAbiertas(page);
    await alViaje(page).click();
    await expect(page).toHaveURL(new RegExp(`/scan/${CANCUN}$`));
    await expect(page.getByRole('heading', { name: 'Ticket para Cancún 2026', level: 1 })).toBeVisible();
    await expect.poll(() => camarasAbiertas(page)).toBe(antes + 1);
  });

  test('🔴 la lista se precarga con la sesión: en una pantalla SIN barra, y la barra nace ya con el viaje', async ({ page }) => {
    await entrar(page, DENTRO);
    // «Carga manual» no tiene barra: la única que puede pedir la lista ahí es la precarga de la sesión (`App`).
    await page.goto(`/viaje-gasto/${CANCUN}`);
    await expect(page.getByRole('heading', { name: 'Agregar gasto', level: 1 })).toBeVisible();
    await expect(circulo(page)).toHaveCount(0);
    // La memoria de la cuenta tiene la lista (el mismo módulo que lee la barra, servido por Vite).
    // (La ruta en una variable: con una literal, `tsc` del e2e busca ese módulo y no lo encuentra.)
    await expect.poll(() => page.evaluate(async (ruta) => {
      const m = (await import(/* @vite-ignore */ ruta)) as { viajesAbiertosRecordados(): Array<{ nombre: string }> | null };
      return m.viajesAbiertosRecordados()?.map((v) => v.nombre) ?? null;
    }, '/src/api/viajesDeHoy.ts')).toContain('Cancún 2026');
    // Y al ir a una pantalla con barra, el círculo NACE como el del viaje: la cámara decide antes del toque.
    const primera = await page.evaluate(() => new Promise<string | null>((listo) => {
      const leer = () => document.querySelector('button.appbar-center')?.getAttribute('aria-label') ?? null;
      const obs = new MutationObserver(() => {
        const a = document.querySelector('button.appbar-center');
        if (a) { obs.disconnect(); listo(leer()); }
      });
      obs.observe(document.body, { childList: true, subtree: true });
      history.pushState(null, '', '/mesas');
      dispatchEvent(new PopStateEvent('popstate'));
    }));
    expect(primera).toBe('Escanear ticket para Cancún 2026');
  });

  for (const [caso, instante, adentro] of [
    ['el primer día, recién empezado (en UTC ya es el 5)', mx('2026-10-05T00:30:00'), true],
    ['el último día, de noche (en UTC ya es el 12)', mx('2026-10-11T23:30:00'), true],
    ['el día antes, de noche (en UTC ya es el 5)', mx('2026-10-04T23:30:00'), false],
    ['el día después, recién empezado', mx('2026-10-12T00:30:00'), false],
  ] as const) {
    test(`🔴 bordes con la fecha LOCAL: ${caso}`, async ({ page }) => {
      await entrar(page, instante);
      // La lista de abiertos llegó. D302 · Monterrey (esperando pagos) está siempre en Inicio; Cancún, sólo desde el 5.
      await expect(burbuja(page, 'Monterrey fin de semana')).toBeVisible();
      if (adentro) {
        await expect(alViaje(page)).toBeVisible();
      } else {
        await expect(circulo(page)).toHaveAccessibleName('Escanear');
        await circulo(page).click();
        await expect(page).toHaveURL(/\/scan$/);
        await expect(page.getByRole('heading', { name: 'Escanea el ticket', level: 1 })).toBeVisible();
      }
    });
  }

  test('🔴 un viaje sin las dos fechas no cambia la cámara', async ({ page }) => {
    await entrar(page, DENTRO);
    await editarViajes(page, 'sin-fecha-hasta');
    await expect(burbuja(page, 'Cancún 2026')).toBeVisible();
    await expect(circulo(page)).toHaveAccessibleName('Escanear');
    await circulo(page).click();
    await expect(page).toHaveURL(/\/scan$/);
  });

  test('🔴 esperando pagos no cuenta, aunque sus fechas cubran hoy', async ({ page }) => {
    // Solo: «Monterrey fin de semana» (19 al 21 de septiembre) espera pagos. La cámara de siempre.
    await entrar(page, mx('2026-09-20T12:00:00'));
    // D302 · el 20 de septiembre Cancún todavía no empezó: no está en Inicio. Monterrey sí.
    await expect(burbuja(page, 'Monterrey fin de semana')).toBeVisible();
    await expect(burbuja(page, 'Cancún 2026')).toHaveCount(0);
    await expect(circulo(page)).toHaveAccessibleName('Escanear');
    await circulo(page).click();
    await expect(page).toHaveURL(/\/scan$/);
  });

  test('🔴 con Cancún abierto y Monterrey esperando pagos cubriendo hoy: va a Cancún, sin preguntar', async ({ page }) => {
    await entrar(page, DENTRO);
    await editarViajes(page, 'monterrey-hoy');
    await expect(burbuja(page, 'Monterrey fin de semana')).toBeVisible();
    await expect(alViaje(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Escanear ticket para un viaje', exact: true })).toHaveCount(0);
  });

  test('🔴 dos viajes que cubren hoy: «¿Para qué viaje?», y la cámara se abre en el toque que elige', async ({ page }) => {
    await entrar(page, DENTRO);
    await editarViajes(page, 'dos-viajes');
    await expect(burbuja(page, 'Tulum 2026')).toBeVisible();
    const nueva = page.getByRole('button', { name: 'Escanear ticket para un viaje', exact: true });
    const antes = camarasAbiertas(page);
    await nueva.click();
    const hoja = page.getByRole('dialog', { name: '¿Para qué viaje?', exact: true });
    await expect(hoja).toBeVisible();
    // Un botón por viaje, en el orden de la lista de abiertos: se afirma el conjunto.
    await expect(hoja.locator('button.vj-hoja-viaje')).toHaveCount(2);
    expect((await hoja.locator('button.vj-hoja-viaje').allInnerTexts()).sort()).toEqual(['Cancún 2026', 'Tulum 2026']);
    // Abrir la hoja no abre la cámara.
    expect(camarasAbiertas(page)).toBe(antes);
    await capturar(page, 'hoja-para-que-viaje');
    // Escape cierra y el foco vuelve al círculo.
    await page.keyboard.press('Escape');
    await expect(hoja).toHaveCount(0);
    await expect(nueva).toBeFocused();
    // Cambiar de pantalla la cierra (no queda abierta encima de otra).
    await nueva.click();
    await expect(hoja).toBeVisible();
    await ir(page, '/mesas');
    await expect(hoja).toHaveCount(0);
    await ir(page, '/');
    // Elegir Tulum: la cámara en ese toque y el escaneo de Tulum.
    await nueva.click();
    await hoja.getByRole('button', { name: 'Tulum 2026', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/scan/${TULUM}$`));
    await expect(hoja).toHaveCount(0);
    await expect.poll(() => camarasAbiertas(page)).toBe(antes + 1);
    await expect(page.getByRole('heading', { name: 'Ticket para Tulum 2026', level: 1 })).toBeVisible();
    // Adentro de un viaje manda el círculo de ESE viaje (D250), no la hoja.
    await ir(page, `/viaje/${TULUM}`);
    await expect(alViaje(page, 'Tulum 2026')).toBeVisible();
  });
});

test.describe('🔴 D276-2 · «¿Quiénes estuvieron?» al cargar', () => {
  test('en las tres formas, con todos marcados al arrancar', async ({ page }) => {
    await entrar(page, DENTRO);
    await escanearEnCancun(page);
    for (const forma of [/Por lo que pidió cada uno/, /En partes iguales/, /Pagar el total/]) {
      await page.getByRole('radio', { name: forma }).click();
      await expect(presentes(page)).toHaveCount(4);
      for (const c of await presentes(page).all()) await expect(c).toHaveAttribute('aria-checked', 'true');
    }
    await page.getByRole('radio', { name: /Por lo que pidió cada uno/ }).click();
    await expect(page.getByText('Sólo eligen los que estuvieron. Desmarca a quien no estuvo.', { exact: true })).toBeVisible();
    await capturar(page, 'ticket-nuevo-consumo');
  });

  test('desmarcar a Diego en «Por lo que pidió cada uno»: no figura entre los que eligen', async ({ page }) => {
    await entrar(page, DENTRO);
    await escanearEnCancun(page);
    await presente(page, /Diego Torres/).click();
    await expect(presente(page, /Diego Torres/)).toHaveAttribute('aria-checked', 'false');
    await page.getByRole('button', { name: 'Compartir con el viaje', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/viaje-ticket/${CANCUN}\\.[0-9a-f-]{36}$`));
    await expect(page.getByText('Quién ya eligió', { exact: true })).toBeVisible();
    await expect(page.locator('.vjt-chips--eleccion')).not.toContainText('Diego');
    await expect(page.locator('.vjt-chips--eleccion')).toContainText('Luis');
  });

  test('🔴 D276-3 · sólo yo y pagué yo: la línea del gasto personal; guardarlo no suma al viaje y lleva «Personal»', async ({ page }) => {
    await entrar(page, DENTRO);
    await ir(page, `/viaje/${CANCUN}`);
    // Mi balance en el viaje: si el gasto sumara, al pagarlo yo subiría.
    const balance = page.locator('.vjv-monto-deuda');
    await expect(balance).toHaveText(/^\u2212\$542/);
    await circuloEnElViaje(page);
    for (const n of [/Luis Pérez/, /Sofía Ramírez/, /Diego Torres/]) await presente(page, n).click();
    const linea = page.getByText(PERSONAL, { exact: true });
    await expect(linea).toBeVisible();
    // Justo arriba del botón.
    const boton = page.getByRole('button', { name: 'Compartir con el viaje', exact: true });
    expect((await linea.boundingBox())!.y).toBeLessThan((await boton.boundingBox())!.y);
    await capturar(page, 'linea-gasto-personal');
    await boton.click();
    await expect(page).toHaveURL(new RegExp(`/viaje/${CANCUN}$`));
    await expect(page.getByText('Guardaste el gasto personal.', { exact: true })).toBeVisible();
    await expect(balance).toHaveText(/^\u2212\$542/);
    // En Balance › Consumos, el chip; y su detalle lo dice.
    await ir(page, `/viaje-balance/${CANCUN}`);
    const fila = page.locator('.vjb-consumo').first();
    await expect(fila.locator('.vjv-chip-personal')).toHaveText('Personal');
    await expect(page.locator('.vjv-chip-personal')).toHaveCount(1);
    await capturar(page, 'balance-chip-personal');
    await fila.click();
    await expect(page.getByText('Es tu gasto personal: sólo lo ves tú y no suma al total del viaje.', { exact: true })).toBeVisible();
    await expect(page.getByText('Quién ya eligió', { exact: true })).toHaveCount(0);
    await expect(page.getByText('¿Qué consumiste?', { exact: true })).toHaveCount(0);
    await capturar(page, 'detalle-gasto-personal');
  });

  test('sólo yo marcado, pero pagó Luis: no es personal (es una deuda) y no hay línea', async ({ page }) => {
    await entrar(page, DENTRO);
    await escanearEnCancun(page);
    for (const n of [/Luis Pérez/, /Sofía Ramírez/, /Diego Torres/]) await presente(page, n).click();
    await expect(page.getByText(PERSONAL, { exact: true })).toBeVisible();
    const grupo = page.getByRole('group', { name: '¿Quién pagó?', exact: true });
    const casilla = (quien: string) => grupo.getByRole('checkbox', { name: new RegExp(`^${quien}( |$)`) });
    await casilla('Luis Pérez').click();
    await casilla('Tú').click();
    await expect(grupo.locator('[role="checkbox"][aria-checked="true"]')).toHaveText(['Luis Pérez']);
    await expect(page.getByText(PERSONAL, { exact: true })).toHaveCount(0);
  });
});

/** Dentro del viaje, el círculo del viaje y la foto: «Ticket nuevo». */
async function circuloEnElViaje(page: Page): Promise<void> {
  await alViaje(page).click();
  await sacarFoto(page);
  await expect(page.getByRole('heading', { name: 'Ticket nuevo', level: 1 })).toBeVisible();
}

test.describe('🔴 D276-2 · cambiar quiénes estuvieron en el detalle', () => {
  test('«Por lo que pidió cada uno»: a quien ya eligió no se lo desmarca (409); a quien no, sí', async ({ page }) => {
    await entrar(page, DENTRO);
    await escanearEnCancun(page);
    await page.getByRole('button', { name: 'Compartir con el viaje', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/viaje-ticket/${CANCUN}\\.[0-9a-f-]{36}$`));
    const detalle = new URL(page.url()).pathname;
    // Elijo algo: ya elegí. «Listo» vuelve atrás (acá, a Inicio).
    await page.getByText('Tagliatelle Bolognese', { exact: true }).click();
    await page.getByRole('button', { name: 'Listo', exact: true }).click();
    await expect(page.getByText('Guardamos lo que consumiste.', { exact: true })).toBeVisible();
    await ir(page, detalle);
    await expect(page.getByRole('heading', { name: '¿Quiénes estuvieron?' })).toBeVisible();
    await expect(page.getByText('Sólo eligen los que estuvieron. Desmarca a quien no estuvo.', { exact: true })).toBeVisible();
    const guardar = page.getByRole('button', { name: 'Guardar', exact: true });
    await expect(guardar).toBeDisabled();
    // Desmarcarme a mí, que ya elegí: el dueño lo rechaza y se dice.
    await presente(page, /^Tú/).click();
    await guardar.click();
    await expect(page.getByText('Ya elegiste: no te puedes desmarcar.', { exact: true })).toBeVisible();
    await expect(presente(page, /^Tú/)).toHaveAttribute('aria-checked', 'true');
    // Diego no eligió nada: sí.
    await presente(page, /Diego Torres/).click();
    await guardar.click();
    await expect(page.getByText('Guardamos quiénes estuvieron.', { exact: true })).toBeVisible();
    await expect(page.locator('.vjt-chips--eleccion')).not.toContainText('Diego');
  });

  test('«Pagar el total»: también se cambia, sin texto de ayuda', async ({ page }) => {
    await entrar(page, DENTRO);
    await escanearEnCancun(page);
    await page.getByRole('radio', { name: /Pagar el total/ }).click();
    await page.getByRole('button', { name: 'Compartir con el viaje', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/viaje/${CANCUN}$`));
    await ir(page, `/viaje-balance/${CANCUN}`);
    await page.locator('.vjb-consumo').first().click();
    await expect(page.getByRole('heading', { name: '¿Quiénes estuvieron?' })).toBeVisible();
    await expect(page.locator('.vjt-texto--ayuda')).toHaveCount(0);
    await presente(page, /Diego Torres/).click();
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(page.getByText('Guardamos quiénes estuvieron.', { exact: true })).toBeVisible();
    await expect(presente(page, /Diego Torres/)).toHaveAttribute('aria-checked', 'false');
  });
});

test.describe('🔴 D276-4 · el que no estuvo', () => {
  test('me desmarcaron mientras elegía: al tocar «Listo», la línea y el ticket de nuevo, sin pantalla de error', async ({ page }) => {
    await entrar(page, DENTRO, { 'payme.app.mock.viajes.seleccion.v1': 'me_desmarcaron' });
    await ir(page, `/viaje-ticket/${CANCUN}.${MARISCOS}`);
    await expect(page.getByText('¿Qué consumiste?', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Listo', exact: true }).click();
    // El aviso del toque y, en el ticket recargado, la línea fija.
    await expect(page.locator('.vjt-aviso-ticket')).toHaveText('No estuviste en este ticket: no eliges nada.');
    await expect(page.getByRole('button', { name: 'Listo', exact: true })).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/viaje-ticket/${CANCUN}\\.${MARISCOS}$`));
    await capturar(page, 'detalle-no-presente');
  });
});
