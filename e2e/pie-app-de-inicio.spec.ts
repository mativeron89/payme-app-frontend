import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';
import { sacarFoto } from './_camara';

/**
 * D256, segundo caso · Mati, en la app de inicio de iOS, en «Carga manual» (0.236.0): «En ésta foto tampoco me deja
 * schrollear hacia abajo». El primer miembro entero, el segundo cortado por el pie «Listo», y no desplaza.
 *
 * El mecanismo, con los números del iPhone de Mati (captura 11, E179b, en `src/appDeInicio.ts`): WebKit arranca la app
 * de inicio con el viewport de layout corto (`innerHeight` 794) mientras `100lvh` ya mide 852. `.app` mide `100lvh`, y
 * la barra de abajo, `absolute` dentro de `.app`, termina en 852. El pie de acción era `position: fixed`: se anclaba al
 * viewport corto, 58 pt más arriba. El contenedor que desplaza termina en 852, así que el final del contenido quedaba
 * detrás del pie, y, si el contenido entraba en esos 852, no había nada que desplazar.
 *
 * El panel de diagnóstico de Mati desde esta pantalla (0.236.0) lo confirmó: `.app` 852, `documentElement.clientHeight`
 * (el bloque contenedor inicial, donde se ancla lo fijo) 793, y el `.scroll` con `clientHeight` = `scrollHeight` = 598:
 * el contenido entraba, no había nada que desplazar, y lo último quedaba detrás del pie.
 *
 * Acá se modela ese estado: un `transform` en `#root`, de alto `100lvh − desfase`, es el bloque contenedor de lo
 * `position: fixed` (como el viewport corto), y `.app` sigue midiendo `100lvh`. Es un modelo, no el iPhone. El desfase
 * no se fija en un número: se prueba con los dos medidos (58 en la captura 11, 59 en el panel). Con 0, el control.
 *
 * En cada pantalla con pie de acción, al final del desplazamiento:
 * - el pie termina donde termina `.app`;
 * - el último elemento queda entero arriba del pie;
 * - y se puede tocar: el punto de su centro es él.
 */

const CANCUN = 'd1000000-0000-4000-8000-000000000001';
const MARISCOS = 'd2000000-0000-4000-8000-000000000105';
/** Medidos en el iPhone de Mati: 852 contra 794 (captura 11, E179b) y 852 contra 793 (el panel, D256). */
const DESFASES_MEDIDOS = [58, 59] as const;
const TAMANOS = [
  { width: 375, height: 667 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
] as const;

async function comoAppDeInicio(page: Page, desfase: number): Promise<void> {
  await page.addInitScript((d) => {
    localStorage.setItem('payme.app.mock.viajes.v1', 'encendido');
    Object.defineProperty(Navigator.prototype, 'standalone', { configurable: true, get: () => true });
    if (d > 0) {
      document.addEventListener('DOMContentLoaded', () => {
        const s = document.createElement('style');
        s.textContent = `html.app-de-inicio-ios #root { transform: translateZ(0); height: calc(100lvh - ${d}px) !important; }`;
        document.head.appendChild(s);
      });
    }
  }, desfase);
  await ingresar(page);
  await expect(page.locator('html')).toHaveClass(/\bapp-de-inicio-ios\b/);
}

async function ir(page: Page, ruta: string): Promise<void> {
  await page.evaluate((u) => {
    history.pushState(null, '', u);
    dispatchEvent(new PopStateEvent('popstate'));
  }, ruta);
}

/**
 * Cancún con 21 miembros y «Mariscos El Faro» con 20 renglones de más. Los casos cortos de los paneles: con `soloYo`,
 * Cancún sólo conmigo (los demás salieron); con `ticketCorto`, «Mariscos El Faro» con sus 4 primeros renglones. El mock
 * lee su estado al cargar: se recarga.
 */
async function sembrar(page: Page, { soloYo = false, ticketCorto = false }: { soloYo?: boolean; ticketCorto?: boolean } = {}): Promise<void> {
  await ir(page, `/viaje/${CANCUN}`);
  await expect(page.getByRole('heading', { name: 'Cancún 2026' })).toBeVisible();
  const ok = await page.evaluate(({ viajeId, ticketId, soloYo: corto, ticketCorto: pocos }) => {
    const k = 'payme.app.mock.viajes.estado.v1';
    const e = JSON.parse(localStorage.getItem(k) ?? 'null') as
      { viajes: Array<{ id: string; miembros: Array<Record<string, unknown>>;
        tickets: Array<{ id: string; items: Array<Record<string, unknown>>; selecciones: Array<{ item_id: string }> }> }> } | null;
    const v = e?.viajes.find((x) => x.id === viajeId);
    const t = v?.tickets.find((x) => x.id === ticketId);
    if (!e || !v || !t) return false;
    if (corto) {
      for (const m of v.miembros.filter((x) => x.estado === 'activo').slice(1)) m.estado = 'salio';
      localStorage.setItem(k, JSON.stringify(e));
      return true;
    }
    if (pocos) {
      t.items = t.items.slice(0, 4);
      const ids = new Set(t.items.map((i) => i.id));
      t.selecciones = t.selecciones.filter((x) => ids.has(x.item_id));
      localStorage.setItem(k, JSON.stringify(e));
      return true;
    }
    for (let i = 0; i < 17; i++) {
      const n = String(i).padStart(12, '0');
      v.miembros.push({ id: `d4ffffff-0000-4000-8000-${n}`, user_id: `c9ffffff-0000-4000-8000-${n}`, estado: 'activo',
        invitado_por: null, invitado_en: null, created_at: '2026-10-05T12:00:00.000Z', first_name: `Persona ${i + 1}`,
        last_name: 'Prueba', username: `persona.${i + 1}`, eliminada: false });
    }
    for (let i = 0; i < 20; i++) {
      t.items.push({ id: `d3ffffff-0000-4000-8000-${String(i).padStart(12, '0')}`, nombre: `Plato largo ${i + 1}`, price_cents: 10000 + i * 100, quantity: 1 });
    }
    localStorage.setItem(k, JSON.stringify(e));
    return true;
  }, { viajeId: CANCUN, ticketId: MARISCOS, soloYo, ticketCorto });
  expect(ok).toBe(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Cancún 2026' })).toBeVisible();
}

interface Medida {
  scrollHeight: number;
  clientHeight: number;
  pieBottom: number;
  appBottom: number;
  ultimoBottom: number;
  pieTop: number;
  tocable: boolean;
  nombre: string;
}

/**
 * Desplaza hasta el final y mide el último elemento, contra el pie: lo último que se toca o el último renglón de un
 * ticket (`.qc-fila`; «Lo eligió otro» no se toca, pero tiene que verse).
 */
async function alFinal(page: Page): Promise<Medida> {
  await page.locator('.app .scroll').first().evaluate((s) => { s.scrollTop = s.scrollHeight; });
  await page.waitForTimeout(150);
  return page.evaluate(() => {
    const s = document.querySelector('.app .scroll')!;
    const sel = 'button, input, select, textarea, [role="checkbox"], [role="radio"], .qc-fila';
    const todos = [...s.querySelectorAll<HTMLElement>(sel)].filter((x) => x.getBoundingClientRect().height > 0);
    const ultimo = todos[todos.length - 1]!;
    const r = ultimo.getBoundingClientRect();
    const pie = document.querySelector('.vj-pie')!.getBoundingClientRect();
    const app = document.querySelector('.app')!.getBoundingClientRect();
    const enElCentro = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      scrollHeight: s.scrollHeight,
      clientHeight: s.clientHeight,
      pieBottom: pie.bottom,
      appBottom: app.bottom,
      ultimoBottom: r.bottom,
      pieTop: pie.top,
      tocable: enElCentro !== null && (enElCentro === ultimo || ultimo.contains(enElCentro)),
      nombre: (ultimo.getAttribute('aria-label') ?? ultimo.textContent ?? '').trim().slice(0, 40),
    };
  });
}

function seAlcanza(m: Medida): void {
  expect(Math.abs(m.pieBottom - m.appBottom), `el pie termina en ${m.pieBottom} y .app en ${m.appBottom}`).toBeLessThan(1);
  expect(m.ultimoBottom, `el pie tapa «${m.nombre}»`).toBeLessThanOrEqual(m.pieTop + 0.5);
  expect(m.tocable, `«${m.nombre}» no recibe el toque`).toBe(true);
}

/** D263 · «¿Quién pagó?» también tiene casillas con los nombres: la de «¿Quiénes estuvieron?», por su grupo. */
const presentes = (page: Page) => page.getByRole('group', { name: '¿Quiénes estuvieron?', exact: true });

const PANTALLAS: Array<{ nombre: string; largo: boolean; abrir: (page: Page) => Promise<void> }> = [
  {
    nombre: 'Carga manual con 21 miembros',
    largo: true,
    abrir: async (page) => {
      await ir(page, `/viaje/${CANCUN}`);
      await page.getByRole('button', { name: 'Carga manual', exact: true }).click();
      await expect(presentes(page).getByRole('checkbox', { name: /Persona 17/ })).toBeAttached();
    },
  },
  {
    nombre: 'un ticket largo ya cargado («Te toca / Listo»)',
    largo: true,
    abrir: async (page) => {
      await ir(page, `/viaje-balance/${CANCUN}`);
      await page.locator('.vjb-consumo').filter({ hasText: 'Mariscos El Faro' }).click();
      await expect(page.getByRole('button', { name: 'Plato largo 20', exact: true })).toBeAttached();
    },
  },
  {
    nombre: 'Ticket nuevo, en partes iguales entre 21',
    largo: true,
    abrir: async (page) => {
      await ir(page, `/viaje/${CANCUN}`);
      await page.getByRole('button', { name: 'Escanear ticket para Cancún 2026', exact: true }).click();
      await sacarFoto(page);
      await expect(page).toHaveURL(new RegExp(`/viaje-ticket-nuevo/${CANCUN}$`));
      await page.getByRole('radio', { name: /En partes iguales/ }).click();
      await expect(presentes(page).getByRole('checkbox', { name: /Persona 17/ })).toBeAttached();
    },
  },
  {
    nombre: 'Crear viaje',
    largo: false,
    abrir: async (page) => {
      await ir(page, '/viaje-nuevo');
      await expect(page.getByRole('button', { name: 'Crear viaje', exact: true })).toBeVisible();
    },
  },
];

/** Lo largo tiene que desbordar el contenedor: si no, no hay nada que desplazar. */
function desborda(m: Medida, largo: boolean): void {
  if (largo) expect(m.scrollHeight, 'el contenido no desborda: no hay nada que desplazar').toBeGreaterThan(m.clientHeight);
}

for (const desfase of DESFASES_MEDIDOS) {
  for (const tamano of TAMANOS) {
    test.describe(`🔴 D256 · pie de acción en la app de inicio, a ${tamano.width} × ${tamano.height}, con desfase ${desfase}`, () => {
      test.use({ viewport: tamano });
      for (const p of PANTALLAS) {
        test(`${p.nombre}: el último elemento se alcanza arriba del pie y se toca`, async ({ page }) => {
          await comoAppDeInicio(page, desfase);
          await sembrar(page);
          await p.abrir(page);
          const m = await alFinal(page);
          seAlcanza(m);
          desborda(m, p.largo);
        });
      }
    });
  }
}

/**
 * El caso del panel de Mati, en su iPhone (393 × 852, insets 59/34, desfase 59): en la base el `.scroll` mide 598 de
 * alto (como en el panel) y, con un solo miembro, el contenido entra (`scrollHeight` = `clientHeight` = 598): no hay
 * scroll y el miembro queda detrás del pie. Los insets se emulan con CDP, que sólo tiene Chromium (la CI). En otro
 * navegador (la corrida local en WebKit) corre sin ellos: lo que se afirma no depende de los insets. Sin `test.skip`:
 * la guarda del corte sólo admite el del corte de pagos (`corteGuard.test.ts`).
 */
test.describe('🔴 D256 · los casos de los paneles de Mati: 393 × 852, insets 59/34, desfase 59', () => {
  test.use({ viewport: { width: 393, height: 852 } });
  test('el contenido que «entra» igual se alcanza: el miembro no queda detrás del pie', async ({ page, browserName }) => {
    if (browserName === 'chromium') {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setSafeAreaInsetsOverride', {
        insets: { top: 59, topMax: 59, bottom: 34, bottomMax: 34, left: 0, leftMax: 0, right: 0, rightMax: 0 },
      });
    }
    await comoAppDeInicio(page, 59);
    await sembrar(page, { soloYo: true });
    await ir(page, `/viaje/${CANCUN}`);
    await page.getByRole('button', { name: 'Carga manual', exact: true }).click();
    await expect(presentes(page).getByRole('checkbox')).toHaveCount(1);
    seAlcanza(await alFinal(page));
  });

  /**
   * El segundo panel de Mati: el ticket ya cargado de un restaurante, con pocos renglones. En la base el `.scroll` mide
   * 597 y el contenido entra (`scrollHeight` = `clientHeight`, como el 578 = 578 del panel): no hay scroll, y el cuarto
   * renglón termina detrás del pie («Te toca / Listo»).
   */
  test('el ticket ya cargado con pocos renglones: el último renglón no queda detrás del pie', async ({ page, browserName }) => {
    if (browserName === 'chromium') {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setSafeAreaInsetsOverride', {
        insets: { top: 59, topMax: 59, bottom: 34, bottomMax: 34, left: 0, leftMax: 0, right: 0, rightMax: 0 },
      });
    }
    await comoAppDeInicio(page, 59);
    await sembrar(page, { ticketCorto: true });
    await ir(page, `/viaje-ticket/${CANCUN}.${MARISCOS}`);
    await expect(page.locator('.qc-fila')).toHaveCount(4);
    seAlcanza(await alFinal(page));
  });
});

test.describe('control · sin desfase (Safari, o la app de inicio ya acomodada), a 390 × 844', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  for (const p of PANTALLAS) {
    test(`${p.nombre}: también se alcanza`, async ({ page }) => {
      await comoAppDeInicio(page, 0);
      await sembrar(page);
      await p.abrir(page);
      seAlcanza(await alFinal(page));
    });
  }
});
