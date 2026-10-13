import { expect, test, type Locator, type Page } from '@playwright/test';
import { ingresar, relojFueraDeLasFechasDeLosViajes } from './_app';
import { sacarFoto } from './_camara';
import { enTuMesaConLaLista } from './_mesa';

/**
 * 🔴 D285 · la tarjeta de título blanca con ícono, medida en las 41 pantallas (las 40 del inventario de 0.239.0 y
 * «Corregir ticket», que agregó 0.241.0), a 390, contra el mock. Por pantalla se miden los estilos computados del
 * contenedor, el cuadro y su ícono (el de la tabla de `PANTALLA-tarjeta-de-titulo-blanca.md`), y el título alineado a la
 * izquierda del cuadro. Los casos especiales (¡Listo! naranja, el viaje con su foto o su color, Estadísticas sin título,
 * el ticket con las siluetas, la campana «Avisos», el chip y el contenido extra) llevan su propia aserción.
 */
test.use({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Mexico_City' });

const CANCUN = 'd1000000-0000-4000-8000-000000000001';
const MONTERREY = 'd1000000-0000-4000-8000-000000000002';
const OAXACA = 'd1000000-0000-4000-8000-000000000003';
const MARISCOS = 'd2000000-0000-4000-8000-000000000105';
const NO_EXISTE = 'd1000000-0000-4000-8000-000000000999';
const TICKET_NO_EXISTE = 'd2000000-0000-4000-8000-000000000999';

async function costuras(page: Page, seams: Record<string, string>): Promise<void> {
  await page.addInitScript((s) => {
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
  }, seams);
}

/** Viajes encendido y el reloj fuera de las fechas de Cancún: «Nueva» abre una mesa, como en los e2e. */
async function entrar(page: Page, seams: Record<string, string> = {}): Promise<void> {
  await costuras(page, { 'payme.app.mock.viajes.v1': 'encendido', ...seams });
  await relojFueraDeLasFechasDeLosViajes(page);
  await ingresar(page);
}

async function ir(page: Page, ruta: string): Promise<void> {
  await page.evaluate((u) => {
    history.pushState(null, '', u);
    dispatchEvent(new PopStateEvent('popstate'));
  }, ruta);
}

const NAVY = 'rgb(16, 30, 59)';
const NARANJA = 'rgb(240, 112, 60)';
const TURQUESA = 'rgb(15, 118, 110)';

interface Esperado {
  /** El ícono de la tabla; `viaje` = el cuadro del viaje (foto o inicial). */
  readonly icono: string;
  /** El fondo del cuadro; por defecto, navy. */
  readonly fondo?: string;
  /** El título visible; `null` = sin título visible (Estadísticas, el ticket cargando). */
  readonly titulo: string | RegExp | null;
}

/** Mide la tarjeta y su fila del título; devuelve la medida para las aserciones propias de cada pantalla. */
async function medir(page: Page, fila: string, tarjeta: Locator, e: Esperado) {
  await expect(tarjeta, fila).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const m = await tarjeta.evaluate((el) => {
    const cs = getComputedStyle(el);
    const caja = (n: Element | null) => (n ? n.getBoundingClientRect() : null);
    const cuadro = el.querySelector<HTMLElement>('.title-card-cuadro');
    const ccs = cuadro ? getComputedStyle(cuadro) : null;
    const titulo = el.querySelector<HTMLElement>('.title-card-title, .ingreso-burbuja-titulo');
    const tcs = titulo ? getComputedStyle(titulo) : null;
    const svg = cuadro?.querySelector('svg');
    return {
      fondo: cs.backgroundColor,
      borde: `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`,
      radio: cs.borderTopLeftRadius,
      margen: [cs.marginTop, cs.marginRight, cs.marginLeft],
      padding: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft],
      minAlto: cs.minHeight,
      sombra: cs.boxShadow,
      tarjetaX: caja(el)!.left,
      cuadro: cuadro && ccs ? {
        w: caja(cuadro)!.width, h: caja(cuadro)!.height, radio: ccs.borderTopLeftRadius, fondo: ccs.backgroundColor,
        icono: cuadro.dataset.icono ?? (cuadro.classList.contains('vj-cuadro') ? 'viaje' : null),
        x: caja(cuadro)!.left, derecha: caja(cuadro)!.right,
        trazo: svg?.getAttribute('stroke-width') ?? null, svg: svg ? [svg.getAttribute('width'), svg.querySelectorAll('path').length] : null,
        img: !!cuadro.querySelector('img'),
      } : null,
      titulo: titulo && tcs ? {
        texto: titulo.textContent?.trim() ?? '', tamano: tcs.fontSize, peso: tcs.fontWeight, alto: tcs.lineHeight,
        alineacion: tcs.textAlign, x: caja(titulo)!.left, visible: caja(titulo)!.width > 1,
      } : null,
    };
  });
  // El contenedor (D285): blanco, borde, radio 22, -42 sobre la cabecera, padding 16 18, alto mínimo 83, sombra --sh-mounted (D310).
  expect(m.fondo, fila).toBe('rgb(255, 255, 255)');
  expect(m.borde, fila).toBe('1px solid rgb(227, 233, 240)');
  expect(m.radio, fila).toBe('22px');
  expect(m.margen, fila).toEqual(['-42px', '16px', '16px']);
  expect(m.padding, fila).toEqual(['16px', '18px', '16px', '18px']);
  expect(m.minAlto, fila).toBe('83px');
  expect(m.sombra, fila).toBe('rgba(16, 30, 59, 0.1) 0px 4px 16px 0px');
  // El cuadro: 48 × 48, radio 14, a la izquierda (pegado al padding), con su ícono.
  expect(m.cuadro, fila).not.toBeNull();
  expect([m.cuadro!.w, m.cuadro!.h, m.cuadro!.radio], fila).toEqual([48, 48, '14px']);
  expect(m.cuadro!.x - m.tarjetaX, fila).toBeCloseTo(19, 0);
  expect(m.cuadro!.icono, fila).toBe(e.icono);
  if (e.icono !== 'viaje') {
    expect(m.cuadro!.fondo, fila).toBe(e.fondo ?? NAVY);
    expect(m.cuadro!.svg, fila).toEqual(['22', 1]);
    expect(m.cuadro!.trazo, fila).toBe(e.fondo === NARANJA ? '2.6' : '1.7');
  }
  // El título: Plus Jakarta Sans 22/800, a la izquierda, después del cuadro.
  if (e.titulo === null) {
    expect(m.titulo === null || !m.titulo.visible, fila).toBe(true);
  } else {
    expect(m.titulo, fila).not.toBeNull();
    if (typeof e.titulo === 'string') expect(m.titulo!.texto, fila).toBe(e.titulo);
    else expect(m.titulo!.texto, fila).toMatch(e.titulo);
    expect([m.titulo!.tamano, m.titulo!.peso, m.titulo!.alto], fila).toEqual(['22px', '800', '26.4px']);
    expect(m.titulo!.alineacion, fila).toBe('left');
    expect(m.titulo!.x - m.cuadro!.derecha, fila).toBeCloseTo(14, 0);
  }
  return m;
}

/** Una pieza del contenido extra: su caja y algunos estilos, contra la caja del cuadro de la misma tarjeta. */
async function pieza(tarjeta: Locator, selector: string) {
  return tarjeta.evaluate((el, sel) => {
    const n = el.querySelector<HTMLElement>(sel);
    if (!n) return null;
    const r = n.getBoundingClientRect();
    const c = el.querySelector('.title-card-cuadro')!.getBoundingClientRect();
    const t = el.getBoundingClientRect();
    const cs = getComputedStyle(n);
    return {
      izquierda: r.left - c.left, derecha: t.right - r.right, ancho: r.width, alto: r.height, abajoDelCuadro: r.top >= c.bottom - 0.5,
      tamano: cs.fontSize, peso: cs.fontWeight, color: cs.color, fondo: cs.backgroundColor, radio: cs.borderTopLeftRadius,
      anchoTarjeta: t.width,
    };
  }, selector);
}

const ESPERADO: Record<string, Esperado> = {
  '01': { icono: 'dividir', titulo: '¿Cómo dividen?' },
  '02': { icono: 'dividir', titulo: '¿Cómo dividen?' },
  '03': { icono: 'escudo', titulo: 'Garantiza la mesa' },
  '04': { icono: 'banco', titulo: 'Tu banco pide confirmar' },
  '05': { icono: 'compartir', titulo: 'Compartir la mesa' },
  '06': { icono: 'tienda', titulo: 'Tu mesa' },
  '07': { icono: 'cubiertos', titulo: '¿Qué consumiste?' },
  '08': { icono: 'tarjeta', titulo: 'Pagar mi parte' },
  '09': { icono: 'check', fondo: NARANJA, titulo: '¡Listo!' },
  '10': { icono: 'mesa', titulo: 'Mesas' },
  '11': { icono: 'maleta', titulo: 'Viajes abiertos' },
  '12': { icono: 'archivo', titulo: 'Viajes cerrados' },
  '13': { icono: 'maleta-mas', titulo: 'Crear viaje' },
  '14': { icono: 'viaje', titulo: 'Cancún 2026' },
  '14b': { icono: 'viaje', titulo: 'Cancún 2026' },
  '14c': { icono: 'viaje', titulo: 'Cancún 2026' },
  '15': { icono: 'viaje', titulo: 'Monterrey fin de semana' },
  '16': { icono: 'maleta', titulo: 'Viajes' },
  '17': { icono: 'engranaje', titulo: 'Configuración' },
  '18': { icono: 'recibo', titulo: 'Ticket nuevo' },
  '19': { icono: 'escanear', titulo: 'Escanear ticket' },
  '20': { icono: 'recibo', titulo: 'Mariscos El Faro' },
  '20b': { icono: 'recibo', titulo: /./ },
  '21': { icono: 'recibo', titulo: null },
  '22': { icono: 'lapiz', titulo: 'Carga manual' },
  '23': { icono: 'lapiz', titulo: 'Carga manual' },
  '24': { icono: 'viaje', titulo: 'Oaxaca puente' },
  '25': { icono: 'archivo', titulo: 'Viajes cerrados' },
  '26': { icono: 'barras', titulo: null },
  '27': { icono: 'barras', titulo: 'Mis estadísticas' },
  '28': { icono: 'tienda', titulo: null },
  '29': { icono: 'tienda', titulo: 'Tus restaurantes' },
  '30': { icono: 'cubiertos', titulo: null },
  '31': { icono: 'cubiertos', titulo: 'Qué comes' },
  '32': { icono: 'tendencia', titulo: null },
  '33': { icono: 'tendencia', titulo: null },
  '34': { icono: 'recibo-de-pagos', titulo: 'Mis pagos' },
  '35': { icono: 'tarjeta', titulo: 'Mis tarjetas' },
  '36': { icono: 'engranaje', titulo: 'Configuración' },
  '37': { icono: 'controles', titulo: 'Notificaciones' },
  '38': { icono: 'campana', titulo: 'Avisos' },
  '39': { icono: 'entrar', titulo: 'Log in' },
  '40': { icono: 'persona-mas', titulo: 'Crea tu cuenta' },
  '41': { icono: 'lapiz', titulo: 'Corregir ticket' },
  '41b': { icono: 'lapiz', titulo: 'Corregir gasto' },
};

const tarjeta = (page: Page) => page.locator('.title-card').first();

// ─── Mesa ───────────────────────────────────────────────────────────────

test('mesa · ticket → garantía → 3DS → compartir → tu mesa', async ({ page }) => {
  await entrar(page);
  await page.getByRole('button', { name: 'Nueva', exact: true }).click();
  await sacarFoto(page);
  await expect(page.getByRole('radio', { name: /Pagar el total/ })).toBeVisible();
  await medir(page, '01', tarjeta(page), ESPERADO['01']!);
  // El contenido extra, debajo de la fila y a la izquierda: el total (32/800) y «Ver el ticket».
  const total = (await pieza(tarjeta(page), '.ticket-title-amount'))!;
  expect([total.izquierda, total.tamano, total.peso, total.abajoDelCuadro]).toEqual([0, '32px', '800', true]);
  const ver = (await pieza(tarjeta(page), '.ticket-title-fold'))!;
  expect([ver.izquierda, ver.abajoDelCuadro]).toEqual([0, true]);
  await page.getByRole('radio', { name: /Por lo que pidió cada uno/ }).click();
  const masUno = page.getByRole('button', { name: 'Un comensal más' });
  for (let i = 0; i < 4; i += 1) await masUno.click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByRole('heading', { name: 'Garantiza la mesa' })).toBeVisible();
  await medir(page, '03', tarjeta(page), ESPERADO['03']!);
  await page.getByRole('button', { name: 'Garantizar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tu banco pide confirmar' })).toBeVisible();
  await medir(page, '04', tarjeta(page), ESPERADO['04']!);
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Compartir la mesa' })).toBeVisible();
  await medir(page, '05', tarjeta(page), ESPERADO['05']!);
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await enTuMesaConLaLista(page);
  await medir(page, '06', tarjeta(page), ESPERADO['06']!);
  // La barra a todo el ancho de la tarjeta (menos el padding y el borde) y, debajo, el reloj en --brand-ink.
  const barra = (await pieza(tarjeta(page), '.mi-progress'))!;
  expect([barra.izquierda, barra.alto, barra.fondo, barra.abajoDelCuadro]).toEqual([0, 8, 'rgb(227, 233, 240)', true]);
  expect(barra.ancho).toBeCloseTo(barra.anchoTarjeta - 2 * 18 - 2, 0);
  const reloj = (await pieza(tarjeta(page), '.mi-count'))!;
  expect([reloj.color, reloj.peso]).toEqual(['rgb(194, 65, 12)', '700']);
});

test('mesa · ¿Qué consumiste? (quien no es titular)', async ({ page }) => {
  await entrar(page);
  await page.goto('/mesa/PA-4520');
  await expect(page.getByRole('heading', { name: '¿Qué consumiste?', exact: true })).toBeVisible();
  await medir(page, '07', tarjeta(page), ESPERADO['07']!);
});

test('mesa · pagar mi parte → ¡Listo!', async ({ page }) => {
  await entrar(page);
  await page.evaluate(async () => {
    const storePath = '/src/api/mock/store.ts';
    const store = await import(/* @vite-ignore */ storePath) as {
      state: { mesas: Array<{ code: string; original_participants?: number | null }> };
      persist: () => void;
    };
    store.state.mesas.find((m) => m.code === 'PA-3121')!.original_participants = 4;
    store.persist();
  });
  await page.goto('/#/mesa/PA-3121');
  await enTuMesaConLaLista(page);
  await page.getByRole('button', { name: 'Omakase para dos', exact: true }).click();
  await page.getByRole('radiogroup', { name: 'Porción de Omakase para dos' }).getByRole('radio', { name: '⅓', exact: true }).click();
  await page.getByRole('button', { name: 'Listo', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pagar mi parte' })).toBeVisible();
  await medir(page, '08', page.locator('.title-card.pay-title'), ESPERADO['08']!);
  await page.getByRole('radio', { name: '0%', exact: true }).click();
  await page.getByRole('radio', { name: /Santander.*4532/ }).click();
  await page.getByRole('button', { name: 'Pagar', exact: true }).click();
  await expect(page.getByText('¡Listo!')).toBeVisible();
  await medir(page, '09', page.locator('.title-card.recibo-cierre'), ESPERADO['09']!);
});

// ─── Mesas ──────────────────────────────────────────────────────────────

test('mesas · historial y Unirme con código', async ({ page }) => {
  await entrar(page);
  await ir(page, '/mesas');
  await expect(page.getByRole('heading', { name: 'Mesas', exact: true })).toBeVisible();
  await medir(page, '10', tarjeta(page), ESPERADO['10']!);
});

// ─── Viajes ─────────────────────────────────────────────────────────────

test('viajes · listas, crear, viaje abierto, configuración', async ({ page }) => {
  await entrar(page);
  await ir(page, '/viajes/abiertos');
  await expect(page.getByRole('heading', { name: 'Viajes abiertos' })).toBeVisible();
  await medir(page, '11', tarjeta(page), ESPERADO['11']!);
  await ir(page, '/viajes/cerrados');
  await expect(page.getByRole('heading', { name: 'Viajes cerrados' })).toBeVisible();
  await medir(page, '12', tarjeta(page), ESPERADO['12']!);
  await ir(page, '/viaje-nuevo');
  await expect(page.getByRole('heading', { name: 'Crear viaje' })).toBeVisible();
  await medir(page, '13', tarjeta(page), ESPERADO['13']!);
  await ir(page, `/viaje/${CANCUN}`);
  await expect(page.getByRole('heading', { name: 'Cancún 2026' })).toBeVisible();
  const abierto = await medir(page, '14', tarjeta(page), ESPERADO['14']!);
  // Sin color ni foto: la inicial blanca sobre el turquesa de la paleta.
  expect([abierto.cuadro!.fondo, abierto.cuadro!.img]).toEqual([TURQUESA, false]);
  await expect(tarjeta(page).locator('.vj-cuadro')).toHaveText('C');
  await expect(tarjeta(page).locator('.vj-cuadro')).toHaveCSS('color', 'rgb(255, 255, 255)');
  await page.getByRole('button', { name: 'Configuración del viaje', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Configuración', level: 1 })).toBeVisible();
  await medir(page, '17', tarjeta(page), ESPERADO['17']!);
});

test('viajes · esperando pagos y no disponible', async ({ page }) => {
  await entrar(page);
  await ir(page, `/viaje/${MONTERREY}`);
  await expect(page.getByRole('heading', { name: 'Monterrey fin de semana' })).toBeVisible();
  await medir(page, '15', tarjeta(page), ESPERADO['15']!);
  // El chip «Esperando pagos · faltan {n}»: celeste con el texto teal 14/700, debajo de la fila y a la izquierda.
  const chip = (await pieza(tarjeta(page), '.vjv-titulo-chip'))!;
  expect([chip.izquierda, chip.fondo, chip.color, chip.tamano, chip.peso, chip.radio, chip.abajoDelCuadro])
    .toEqual([0, 'rgb(228, 247, 248)', 'rgb(10, 123, 128)', '14px', '700', '9999px', true]);
  await expect(tarjeta(page).locator('.vjv-titulo-chip')).toHaveText(/^Esperando pagos · faltan \d+$/);
  await ir(page, `/viaje/${NO_EXISTE}`);
  await expect(page.getByRole('heading', { name: 'Viajes', exact: true })).toBeVisible();
  await medir(page, '16', tarjeta(page), ESPERADO['16']!);
});

test('viajes · ticket nuevo y escanear ticket (duplicado)', async ({ page }) => {
  await entrar(page, { 'payme.app.mock.viajes.huella.v1': 'huella-inventario' });
  const circulo = page.getByRole('button', { name: 'Escanear ticket para Cancún 2026', exact: true });
  await ir(page, `/viaje/${CANCUN}`);
  await circulo.click();
  await sacarFoto(page);
  await expect(page.getByRole('heading', { name: 'Ticket nuevo', level: 1 })).toBeVisible();
  await medir(page, '18', tarjeta(page), ESPERADO['18']!);
  await page.getByRole('button', { name: 'Compartir con el viaje', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/viaje-ticket/${CANCUN}\\.`));
  await ir(page, `/viaje/${CANCUN}`);
  await circulo.click();
  await sacarFoto(page);
  await expect(page.getByText('Este ticket ya está en el viaje', { exact: true })).toBeVisible();
  await medir(page, '19', tarjeta(page), ESPERADO['19']!);
});

test('viajes · ticket del viaje y ticket no disponible', async ({ page }) => {
  await entrar(page);
  await ir(page, `/viaje-ticket/${CANCUN}.${MARISCOS}`);
  await expect(page.getByRole('heading', { name: 'Mariscos El Faro' })).toBeVisible();
  await medir(page, '20', tarjeta(page), ESPERADO['20']!);
  await ir(page, `/viaje-ticket/${CANCUN}.${TICKET_NO_EXISTE}`);
  await expect(page.locator('.vjt-aviso')).toBeVisible();
  await medir(page, '21', tarjeta(page), ESPERADO['21']!);
  // El recibo y las dos siluetas en lugar de la tarjeta vacía.
  const siluetas = await tarjeta(page).locator('.title-card-silueta').evaluateAll((ns) => ns.map((n) => {
    const r = n.getBoundingClientRect();
    const cs = getComputedStyle(n);
    return [r.width, r.height, cs.borderTopLeftRadius, cs.backgroundColor];
  }));
  expect(siluetas).toEqual([[170, 16, '8px', 'rgb(227, 233, 240)'], [110, 12, '6px', 'rgb(227, 233, 240)']]);
  await expect(tarjeta(page).locator('h1')).toHaveCount(0);
});

test('viajes · carga manual y su estado sin viaje', async ({ page }) => {
  await entrar(page);
  await ir(page, `/viaje-gasto/${CANCUN}`);
  await expect(page.getByLabel('Descripción')).toBeVisible();
  await medir(page, '22', tarjeta(page), ESPERADO['22']!);
  await ir(page, `/viaje-gasto/${NO_EXISTE}`);
  await expect(page.getByText('Este viaje ya no está disponible.')).toBeVisible();
  await medir(page, '23', tarjeta(page), ESPERADO['23']!);
});

test('viajes · viaje cerrado, su no disponible y el ticket de un viaje cerrado', async ({ page }) => {
  await entrar(page);
  await ir(page, `/viaje-cerrado/${OAXACA}`);
  await expect(page.getByRole('heading', { name: 'Oaxaca puente' })).toBeVisible();
  await medir(page, '24', tarjeta(page), ESPERADO['24']!);
  // El ticket de un viaje cerrado (V-02): la misma tarjeta, sólo para ver.
  const idsDeOaxaca = await page.evaluate(async (vid) => {
    const ruta = '/src/api/mock/viajes.ts';
    const m = await import(/* @vite-ignore */ ruta) as { mockDetalleViaje: (id: string, o: { version: number }) => unknown };
    try {
      const r = await m.mockDetalleViaje(vid, { version: 6 }) as { viaje?: { tickets?: Array<{ id: string }> } };
      return (r.viaje?.tickets ?? []).map((t) => t.id);
    } catch (e) {
      return [`error: ${String((e as { code?: string }).code ?? e)}`];
    }
  }, OAXACA);
  if (idsDeOaxaca[0] && !idsDeOaxaca[0].startsWith('error')) {
    await ir(page, `/viaje-ticket/${OAXACA}.${idsDeOaxaca[0]}`);
    await page.waitForTimeout(1500);
    await medir(page, '20b', tarjeta(page), ESPERADO['20b']!);
  }
  await ir(page, `/viaje-cerrado/${NO_EXISTE}`);
  await expect(page.getByRole('heading', { name: 'Viajes cerrados' })).toBeVisible();
  await medir(page, '25', tarjeta(page), ESPERADO['25']!);
});

// ─── Cuenta y Configuración ─────────────────────────────────────────────

test('estadísticas · con consumo', async ({ page }) => {
  await entrar(page);
  await ir(page, '/estadisticas');
  await expect(page.locator('.est-total')).toBeVisible();
  await medir(page, '26', tarjeta(page), ESPERADO['26']!);
  // Estadísticas: sin título visible (queda para lectores de pantalla); el período junto al cuadro y el total a la derecha.
  await expect(tarjeta(page).locator('h1.stat-oculto')).toHaveText('Mis estadísticas');
  const periodo = (await pieza(tarjeta(page), '.stat-burbuja-periodo'))!;
  expect(periodo.izquierda).toBeCloseTo(48 + 14, 0);
  expect([periodo.tamano, periodo.peso]).toEqual(['18px', '700']);
  const totalEst = (await pieza(tarjeta(page), '.est-total'))!;
  expect(totalEst.derecha).toBeCloseTo(18 + 1, 0);
  expect([totalEst.tamano, totalEst.peso]).toEqual(['26px', '800']);
});

test('estadísticas · sin consumo del mes publicado', async ({ page }) => {
  await entrar(page, { 'payme.app.mock.stats.v1': 'ausente' });
  await ir(page, '/estadisticas');
  await expect(page.getByRole('heading', { name: 'Mis estadísticas' })).toBeVisible();
  await page.waitForTimeout(1000);
  await medir(page, '27', tarjeta(page), ESPERADO['27']!);
});

test('estadísticas · tus restaurantes, qué comes y evolución', async ({ page }) => {
  await entrar(page);
  await ir(page, '/restaurantes');
  await expect(page.locator('.stat-burbuja-total')).toBeVisible();
  await medir(page, '28', tarjeta(page), ESPERADO['28']!);
  const datoRest = (await pieza(tarjeta(page), '.stat-burbuja-dato'))!;
  expect(datoRest.derecha).toBeCloseTo(18 + 1, 0);
  const contexto = (await pieza(tarjeta(page), '.stat-burbuja-contexto'))!;
  expect([contexto.tamano, contexto.color]).toEqual(['13px', 'rgb(91, 107, 130)']);
  await ir(page, '/platos');
  await expect(page.locator('.stat-burbuja-total')).toBeVisible();
  await medir(page, '30', tarjeta(page), ESPERADO['30']!);
  await ir(page, '/evolucion');
  await expect(page.locator('.stat-burbuja-total')).toBeVisible();
  await medir(page, '32', tarjeta(page), ESPERADO['32']!);
});

test('estadísticas · errores: restaurantes, platos, evolución', async ({ page }) => {
  await entrar(page, {
    'payme.app.mock.restaurantes.v1': 'error',
    'payme.app.mock.platos.v1': 'error',
    'payme.app.mock.evolucion.v1': 'error',
  });
  await ir(page, '/restaurantes');
  await expect(page.getByRole('heading', { name: 'Tus restaurantes' })).toBeVisible();
  await page.waitForTimeout(1000);
  await medir(page, '29', tarjeta(page), ESPERADO['29']!);
  await ir(page, '/platos');
  await expect(page.getByRole('heading', { name: 'Qué comes' })).toBeVisible();
  await page.waitForTimeout(1000);
  await medir(page, '31', tarjeta(page), ESPERADO['31']!);
  await ir(page, '/evolucion');
  await page.waitForTimeout(1500);
  await medir(page, '33', tarjeta(page), ESPERADO['33']!);
});

test('cuenta · mis pagos, mis tarjetas, configuración, notificaciones', async ({ page }) => {
  await entrar(page);
  await ir(page, '/pagos');
  await expect(page.getByRole('heading', { name: 'Mis pagos' })).toBeVisible();
  await medir(page, '34', tarjeta(page), ESPERADO['34']!);
  await ir(page, '/tarjetas');
  await expect(page.getByRole('heading', { name: 'Mis tarjetas' })).toBeVisible();
  await medir(page, '35', tarjeta(page), ESPERADO['35']!);
  await ir(page, '/mas');
  await expect(page.getByRole('heading', { name: 'Configuración' })).toBeVisible();
  await medir(page, '36', tarjeta(page), ESPERADO['36']!);
  await ir(page, '/notificaciones');
  await expect(page.getByRole('heading', { name: 'Notificaciones' })).toBeVisible();
  await medir(page, '37', tarjeta(page), ESPERADO['37']!);
});

// ─── Otros ──────────────────────────────────────────────────────────────

test('otros · avisos de la campana', async ({ page }) => {
  await entrar(page);
  await ir(page, '/avisos');
  await expect(page.getByRole('heading', { level: 1, name: 'Avisos', exact: true })).toBeVisible();
  await medir(page, '38', tarjeta(page), ESPERADO['38']!);
});

test('otros · ingreso: Log in y Crea tu cuenta', async ({ page }) => {
  await costuras(page, { 'payme.app.mock.public_signup.v1': 'true' });
  await page.goto('/');
  await expect(page.locator('.ingreso-burbuja')).toBeVisible();
  await medir(page, '39', page.locator('.ingreso-burbuja'), ESPERADO['39']!);
  await page.getByRole('button', { name: 'Crea tu cuenta', exact: true }).click();
  await expect(page.locator('.ingreso-burbuja-titulo')).toHaveText('Crea tu cuenta');
  await medir(page, '40', page.locator('.ingreso-burbuja'), ESPERADO['40']!);
});

test('mesa · ¿Cómo dividen? con la nota del IVA agregado', async ({ page }) => {
  await entrar(page, { 'payme.app.mock.n179.ocr.v1': 'iva_agregado' });
  await page.getByRole('button', { name: 'Nueva', exact: true }).click();
  await sacarFoto(page);
  await expect(page.locator('.ticket-title-iva')).toBeVisible();
  await medir(page, '02', tarjeta(page), ESPERADO['02']!);
  // La nota del IVA: el ícono ⓘ de 15 y DM Sans 13.5, a la izquierda, entre el total y «Ver el ticket».
  const nota = (await pieza(tarjeta(page), '.ticket-title-iva'))!;
  expect([nota.izquierda, nota.tamano, nota.abajoDelCuadro]).toEqual([0, '13.5px', true]);
  expect(await tarjeta(page).locator('.ticket-title-iva svg').getAttribute('width')).toBe('15');
});

// ─── 0.241.0 · la fila 41: «Corregir ticket» y «Corregir gasto» ─────────────

test('viajes · corregir ticket y corregir gasto (fila 41)', async ({ page }) => {
  await entrar(page);
  await ir(page, `/viaje/${CANCUN}`);
  await expect(page.getByRole('heading', { name: 'Cancún 2026' })).toBeVisible();
  await page.evaluate(([v, t]) => {
    const k = 'payme.app.mock.viajes.estado.v1';
    const e = JSON.parse(localStorage.getItem(k)!);
    const viaje = e.viajes.find((x: { id: string }) => x.id === v);
    const tk = viaje.tickets.find((x: { id: string }) => x.id === t);
    tk.lugar = 'NATAMBRE';
    tk.cargado_por = viaje.creado_por;
    localStorage.setItem(k, JSON.stringify(e));
  }, [CANCUN, MARISCOS]);
  await page.reload();
  await ir(page, `/viaje-ticket/${CANCUN}.${MARISCOS}`);
  await expect(page.getByRole('heading', { name: 'NATAMBRE', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Corregir ticket', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Corregir ticket', level: 1 })).toBeVisible();
  await medir(page, '41', tarjeta(page), ESPERADO['41']!);
  await ir(page, `/viaje-gasto/${CANCUN}`);
  await page.getByLabel('Descripción', { exact: true }).fill('Gasolina');
  await page.getByLabel('Monto', { exact: true }).fill('900');
  await page.getByRole('button', { name: 'Listo', exact: true }).click();
  await expect(page.getByText('Cargaste el gasto.', { exact: true })).toBeVisible();
  await ir(page, `/viaje-balance/${CANCUN}`);
  await page.locator('.vjb-consumo').filter({ hasText: 'Gasolina' }).click();
  await page.getByRole('button', { name: 'Corregir gasto', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Corregir gasto', level: 1 })).toBeVisible();
  await medir(page, '41b', tarjeta(page), ESPERADO['41b']!);
});

// ─── El viaje con color y con foto (filas 14 y 24) ─────────────────────────

test('viajes · el viaje con color y con foto', async ({ page }) => {
  await entrar(page);
  await ir(page, `/viaje/${CANCUN}`);
  await expect(page.getByRole('heading', { name: 'Cancún 2026' })).toBeVisible();
  await page.evaluate((v) => {
    const k = 'payme.app.mock.viajes.estado.v1';
    const e = JSON.parse(localStorage.getItem(k)!);
    e.viajes.find((x: { id: string }) => x.id === v).color = 'violeta';
    localStorage.setItem(k, JSON.stringify(e));
  }, CANCUN);
  await page.reload();
  await ir(page, `/viaje/${CANCUN}`);
  await expect(page.getByRole('heading', { name: 'Cancún 2026' })).toBeVisible();
  const conColor = await medir(page, '14b', tarjeta(page), ESPERADO['14b']!);
  // D285 · la tarjeta queda blanca (lo mide `medir`); el color del viaje va sólo en el cuadro.
  expect([conColor.fondo, conColor.cuadro!.fondo, conColor.cuadro!.img]).toEqual(['rgb(255, 255, 255)', 'rgb(109, 40, 217)', false]);
  await page.evaluate(async (v) => {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const g = c.getContext('2d')!;
    g.fillStyle = '#0FB5C9'; g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#FF6B35'; g.fillRect(0, 32, 64, 32);
    const blob = await new Promise<Blob>((ok) => c.toBlob((b) => ok(b!), 'image/png'));
    const ruta = '/src/api/mock/viajes.ts';
    const m = await import(/* @vite-ignore */ ruta) as { mockSubirFotoDeViaje: (id: string, foto: Blob) => Promise<unknown> };
    await m.mockSubirFotoDeViaje(v, blob);
  }, CANCUN);
  await ir(page, '/viajes/abiertos');
  await ir(page, `/viaje/${CANCUN}`);
  await expect(page.locator('.title-card img')).toBeVisible();
  const conFoto = await medir(page, '14c', tarjeta(page), ESPERADO['14c']!);
  // Con foto: la foto llena el cuadro.
  expect(conFoto.cuadro!.img).toBe(true);
  await expect(tarjeta(page).locator('.vj-cuadro img')).toHaveCSS('object-fit', 'cover');
  const foto = (await pieza(tarjeta(page), '.vj-cuadro img'))!;
  expect([foto.ancho, foto.alto]).toEqual([48, 48]);
});

// ─── D285-2 · la campana «Avisos», también en inglés ──────────────────────

test('la campana es «Avisos» («Alerts» en inglés); las preferencias siguen «Notificaciones» («Notifications»)', async ({ page }) => {
  await entrar(page);
  await ir(page, '/avisos');
  await expect(page.getByRole('heading', { level: 1, name: 'Avisos', exact: true })).toBeVisible();
  await ir(page, '/notificaciones');
  await expect(page.getByRole('heading', { level: 1, name: 'Notificaciones', exact: true })).toBeVisible();
  await page.evaluate(() => localStorage.setItem('payme.app.idioma.v1', 'en'));
  await page.reload();
  await ir(page, '/avisos');
  await expect(page.getByRole('heading', { level: 1, name: 'Alerts', exact: true })).toBeVisible();
  await ir(page, '/notificaciones');
  await expect(page.getByRole('heading', { level: 1, name: 'Notifications', exact: true })).toBeVisible();
});
