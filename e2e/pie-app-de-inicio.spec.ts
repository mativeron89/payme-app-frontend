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
 * Acá se modela ese estado: un `transform` en `#root`, de alto `100lvh − 58px`, es el bloque contenedor de lo
 * `position: fixed` (como el viewport corto), y `.app` sigue midiendo `100lvh`. Es un modelo, no el iPhone: el desfase
 * de 58 es el medido en el de Mati; en los otros tamaños no está medido. Con desfase 0, el control.
 *
 * En cada pantalla con pie de acción, al final del desplazamiento:
 * - el pie termina donde termina `.app`;
 * - el último elemento queda entero arriba del pie;
 * - y se puede tocar: el punto de su centro es él.
 */

const CANCUN = 'd1000000-0000-4000-8000-000000000001';
const MARISCOS = 'd2000000-0000-4000-8000-000000000105';
/** Medido en el iPhone de Mati: `100lvh` 852 contra `innerHeight` 794. */
const DESFASE_MEDIDO = 58;
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

/** Cancún con 21 miembros y «Mariscos El Faro» con 20 renglones de más. El mock lee su estado al cargar: se recarga. */
async function sembrar(page: Page): Promise<void> {
  await ir(page, `/viaje/${CANCUN}`);
  await expect(page.getByRole('heading', { name: 'Cancún 2026' })).toBeVisible();
  const ok = await page.evaluate(({ viajeId, ticketId }) => {
    const k = 'payme.app.mock.viajes.estado.v1';
    const e = JSON.parse(localStorage.getItem(k) ?? 'null') as
      { viajes: Array<{ id: string; miembros: Array<Record<string, unknown>>; tickets: Array<{ id: string; items: Array<Record<string, unknown>> }> }> } | null;
    const v = e?.viajes.find((x) => x.id === viajeId);
    const t = v?.tickets.find((x) => x.id === ticketId);
    if (!e || !v || !t) return false;
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
  }, { viajeId: CANCUN, ticketId: MARISCOS });
  expect(ok).toBe(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Cancún 2026' })).toBeVisible();
}

interface Medida {
  pieBottom: number;
  appBottom: number;
  ultimoBottom: number;
  pieTop: number;
  tocable: boolean;
  nombre: string;
}

/** Desplaza hasta el final y mide el último elemento que se toca, contra el pie. */
async function alFinal(page: Page): Promise<Medida> {
  await page.locator('.app .scroll').first().evaluate((s) => { s.scrollTop = s.scrollHeight; });
  await page.waitForTimeout(150);
  return page.evaluate(() => {
    const s = document.querySelector('.app .scroll')!;
    const sel = 'button, input, select, textarea, [role="checkbox"], [role="radio"]';
    const todos = [...s.querySelectorAll<HTMLElement>(sel)].filter((x) => x.getBoundingClientRect().height > 0);
    const ultimo = todos[todos.length - 1]!;
    const r = ultimo.getBoundingClientRect();
    const pie = document.querySelector('.vj-pie')!.getBoundingClientRect();
    const app = document.querySelector('.app')!.getBoundingClientRect();
    const enElCentro = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
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

const PANTALLAS: Array<{ nombre: string; abrir: (page: Page) => Promise<void> }> = [
  {
    nombre: 'Carga manual con 21 miembros',
    abrir: async (page) => {
      await ir(page, `/viaje/${CANCUN}`);
      await page.getByRole('button', { name: 'Carga manual', exact: true }).click();
      await expect(page.getByRole('checkbox', { name: /Persona 17/ })).toBeAttached();
    },
  },
  {
    nombre: 'un ticket largo ya cargado («Te toca / Listo»)',
    abrir: async (page) => {
      await ir(page, `/viaje-balance/${CANCUN}`);
      await page.locator('.vjb-consumo').filter({ hasText: 'Mariscos El Faro' }).click();
      await expect(page.getByRole('button', { name: 'Plato largo 20', exact: true })).toBeAttached();
    },
  },
  {
    nombre: 'Ticket nuevo, en partes iguales entre 21',
    abrir: async (page) => {
      await ir(page, `/viaje/${CANCUN}`);
      await page.getByRole('button', { name: 'Escanear ticket para Cancún 2026', exact: true }).click();
      await sacarFoto(page);
      await expect(page).toHaveURL(new RegExp(`/viaje-ticket-nuevo/${CANCUN}$`));
      await page.getByRole('radio', { name: /En partes iguales/ }).click();
      await expect(page.getByRole('checkbox', { name: /Persona 17/ })).toBeAttached();
    },
  },
  {
    nombre: 'Crear viaje',
    abrir: async (page) => {
      await ir(page, '/viaje-nuevo');
      await expect(page.getByRole('button', { name: 'Crear viaje', exact: true })).toBeVisible();
    },
  },
];

for (const tamano of TAMANOS) {
  test.describe(`🔴 D256 · pie de acción en la app de inicio, a ${tamano.width} × ${tamano.height}, con el desfase medido`, () => {
    test.use({ viewport: tamano });
    for (const p of PANTALLAS) {
      test(`${p.nombre}: el último elemento se alcanza arriba del pie y se toca`, async ({ page }) => {
        await comoAppDeInicio(page, DESFASE_MEDIDO);
        await sembrar(page);
        await p.abrir(page);
        seAlcanza(await alFinal(page));
      });
    }
  });
}

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
