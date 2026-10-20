import { expect, test, type Locator, type Page } from '@playwright/test';
import { ingresar, relojFueraDeLasFechasDeLosViajes } from './_app';
import type { DetalleViaje } from '../src/api/viajes';
import type { CargaDeViaje } from '../src/screens/viajes/ViajeScreen';

/**
 * D256 · Mati: «no permite borrar la mesa ni consumos en el histórico de viaje,
 * como en "Mesas" que desplazas hacia la izquierda y aparezca el botón de
 * eliminar». En Balance › Consumos, deslizar a la izquierda un ticket o un gasto
 * deja ver «Eliminar» en rojo, sólo donde el dueño dice `puede_eliminar` (quien
 * lo cargó o quien lo pagó, con el viaje abierto). D388 pide confirmación antes
 * de la misma operación; la cuenta sigue llegando calculada por el dueño.
 *
 * En la semilla del mock, de Cancún Mati pagó sólo «Bar La Ola» ($960).
 */

const CANCUN = 'd1000000-0000-4000-8000-000000000001';

test.use({ viewport: { width: 375, height: 812 } });

interface InstrumentoD388 {
  llamadas: [string, string][];
  pedidos: string[];
  ultimo: DetalleViaje | null;
  carga: CargaDeViaje | null;
  actor: { principal: string; familia: string } | null;
  efectos: { mostrar: number; refrescar: number; noDisponible: number };
  demorar: boolean;
  fallar: boolean;
  respuesta: DetalleViaje | null;
  resultado: DetalleViaje | null;
  terminadas: number;
  resolver: (() => void) | null;
  rechazar: (() => void) | null;
  restaurar: () => void;
}
type VentanaD388 = Window & { __d388?: InstrumentoD388 };

test.beforeEach(async ({ page }) => {
  await page.route('**/*', (route) => {
    const u = new URL(route.request().url());
    return (u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost'))
      ? route.fallback() : route.abort('blockedbyclient');
  });
});

/** Sólo instrumental: mismo objeto api importado por Balance; no contar HTTP del mock. */
async function espiarFachada(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const ruta = '/src/api/index.ts';
    const { api } = await import(/* @vite-ignore */ ruta) as typeof import('../src/api');
    const rutaHttp = '/src/api/http.ts';
    const { HttpError } = await import(/* @vite-ignore */ rutaHttp) as typeof import('../src/api/http');
    const eliminar = api.eliminarTicketDeViaje;
    const pedir = api.getViaje;
    const i: InstrumentoD388 = {
      llamadas: [], pedidos: [], ultimo: null, carga: null, actor: null,
      efectos: { mostrar: 0, refrescar: 0, noDisponible: 0 },
      demorar: false, fallar: false, respuesta: null, resultado: null, terminadas: 0, resolver: null, rechazar: null,
      restaurar: () => { api.eliminarTicketDeViaje = eliminar; api.getViaje = pedir; },
    };
    (window as VentanaD388).__d388 = i;
    api.getViaje = async (id) => {
      i.pedidos.push(id);
      const v = i.respuesta ?? await pedir(id);
      i.ultimo = v;
      return v;
    };
    api.eliminarTicketDeViaje = (id, ticketId) => {
      i.llamadas.push([id, ticketId]);
      const ejecutar = () => i.resultado ? Promise.resolve(i.resultado) : eliminar(id, ticketId);
      if (i.fallar) { i.terminadas++; return Promise.reject(new Error('timeout inventado D388')); }
      if (!i.demorar) return ejecutar().finally(() => { i.terminadas++; });
      return new Promise((resolve, reject) => {
        i.resolver = () => { void ejecutar().then(resolve, reject).finally(() => { i.terminadas++; }); };
        i.rechazar = () => { i.terminadas++; reject(new HttpError(409, { error: 'viaje_not_open' })); };
      });
    };
  });
}

/** Para carreras: entradas sintéticas de hooks; Balance, HojaModal y la fachada siguen siendo reales.
 * El original con query se carga intacto. La ruta exacta no intercepta esa query.
 * No se instala ningún seam en src ni se leen/cambian credenciales del almacenamiento.
 */
async function contextoControlado(page: Page): Promise<void> {
  for (const [archivo, codigo] of [
    ['screens/viajes/ViajeScreen.tsx', `
      export function useDetalleViaje(id) {
        const real = original.useDetalleViaje(id); revision();
        const i = window.__d388;
        return {...real, carga: i?.carga ?? real.carga,
          mostrar: (v) => { if(i) i.efectos.mostrar++; real.mostrar(v); },
          refrescar: () => { if(i) i.efectos.refrescar++; return real.refrescar(); },
          noDisponible: () => { if(i) i.efectos.noDisponible++; real.noDisponible(); }};
      }`],
    ['auth/AuthContext.tsx', `
      export function useAuth() {
        const real = original.useAuth(); revision();
        const actor = window.__d388?.actor;
        if (!actor || !real.session) return real;
        return {...real, session: new Proxy(real.session, {get(target, key) {
          if(key === 'principal_id') return actor.principal;
          if(key === 'family_id') return actor.familia;
          return Reflect.get(target, key);
        }})};
      }`],
  ] as const) {
    await page.route(`**/src/${archivo}`, async (route) => {
      const respuesta = await route.fetch();
      const fuente = await respuesta.text();
      // Únicamente resuelve el import React transformado por este Vite; no replica la lógica de Balance.
      const react = fuente.match(/from ["']([^"']*\/react\.js[^"']*)["']/)?.[1];
      if (!react) throw new Error(`No se pudo acreditar el import React de ${archivo}`);
      const original = `/src/${archivo}?d388-original=1`;
      await route.fulfill({ response: respuesta, contentType: 'application/javascript', body: `
        import React from ${JSON.stringify(react)};
        import * as original from ${JSON.stringify(original)};
        export * from ${JSON.stringify(original)};
        function revision() {
          const [, cambiar] = React.useState(0);
          React.useEffect(() => {
            const actualizar = () => cambiar(v => v + 1);
            window.addEventListener('d388-contexto', actualizar);
            return () => window.removeEventListener('d388-contexto', actualizar);
          }, []);
        }
        ${codigo}
      ` });
    });
  }
}

const llamadas = (page: Page) => page.evaluate(() => (window as VentanaD388).__d388!.llamadas);
const efectos = (page: Page) => page.evaluate(() => (window as VentanaD388).__d388!.efectos);
const hoja = (page: Page) => page.getByRole('dialog', { name: '¿Eliminar?', exact: true });
async function confirmar(page: Page): Promise<void> {
  await expect(hoja(page)).toBeVisible();
  await hoja(page).getByRole('button', { name: 'Eliminar', exact: true }).click();
}

/** Deja pasar el frame de restauración y observa el siguiente, sin una espera por tiempo. */
async function completarCicloDeFoco(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolver) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolver()));
  }));
}

test.afterEach(async ({ page }) => {
  await page.evaluate(() => { (window as VentanaD388).__d388?.restaurar(); });
});

async function conViajes(page: Page, extra: Record<string, string> = {}): Promise<void> {
  await page.addInitScript((seams) => {
    localStorage.setItem('payme.app.mock.viajes.v1', 'encendido');
    for (const [k, v] of Object.entries(seams)) localStorage.setItem(k, v);
  }, extra);
  // D276-1 · el día de la corrida no decide a dónde va «Nueva» (`_app.ts`).
  await relojFueraDeLasFechasDeLosViajes(page);
  await ingresar(page);
  await espiarFachada(page);
}

async function ir(page: Page, ruta: string): Promise<void> {
  await page.evaluate((u) => {
    history.pushState(null, '', u);
    dispatchEvent(new PopStateEvent('popstate'));
  }, ruta);
}

const consumo = (page: Page, lugar: string) => page.locator('.vjb-consumos > li').filter({ hasText: lugar });

/** Arrastra la fila con el puntero, a la izquierda. */
async function deslizar(page: Page, fila: Locator, dx = -120): Promise<void> {
  const caja = (await fila.boundingBox())!;
  const y = caja.y + caja.height / 2;
  const x = caja.x + caja.width - 40;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let k = 1; k <= 8; k += 1) await page.mouse.move(x + (dx * k) / 8, y);
  await page.mouse.up();
}

async function aConsumos(page: Page): Promise<void> {
  await ir(page, `/viaje-balance/${CANCUN}`);
  await expect(page.getByRole('tab', { name: 'Consumos', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(consumo(page, 'Bar La Ola')).toBeVisible();
}

test('🔴 D256 · deslizar «Bar La Ola» (lo pagué yo), «Eliminar» y la cuenta se recalcula', async ({ page }) => {
  await conViajes(page);
  await ir(page, `/viaje/${CANCUN}`);
  await expect(page.locator('.vjv-monto-deuda')).toHaveText(/^−\$542/);
  await aConsumos(page);
  const bar = consumo(page, 'Bar La Ola');
  await deslizar(page, bar);
  const eliminar = bar.getByRole('button', { name: 'Eliminar Bar La Ola', exact: true });
  await expect(bar.locator('.deslizable--abierta')).toHaveCount(1);
  await expect(eliminar).toBeInViewport({ ratio: 1 });
  await eliminar.click();
  await expect(hoja(page)).toBeVisible();
  expect(await llamadas(page)).toEqual([]);
  const id = await page.evaluate(() => (window as VentanaD388).__d388!.ultimo!.tickets.find((tk) => tk.puede_eliminar)!.id);
  await confirmar(page);
  await expect(page.getByText('Ticket eliminado', { exact: true })).toBeVisible();
  await expect(consumo(page, 'Bar La Ola')).toHaveCount(0);
  expect(await llamadas(page)).toEqual([[CANCUN, id]]);
  // La cuenta del dueño: ya no pagué nada, y el balance del viaje cambió.
  await page.getByRole('tab', { name: 'Miembros', exact: true }).click();
  await expect(page.locator('.vjb-fila').filter({ hasText: 'Tú' }).locator('.vjb-cifra')).toHaveText('$0');
  await ir(page, `/viaje/${CANCUN}`);
  await expect(page.getByRole('heading', { name: 'Cancún 2026' })).toBeVisible();
  // −$542 − ($960 que pagué − $240 que me tocaba, entre cuatro) = −$1,262.
  await expect(page.locator('.vjv-monto-deuda')).toHaveText(/^−\$1,262/);
});

test('🔴 D256 · lo que no cargué ni pagué no se desliza: no hay «Eliminar»', async ({ page }) => {
  await conViajes(page);
  await aConsumos(page);
  const mariscos = consumo(page, 'Mariscos El Faro');
  // Sin gesto: la fila de siempre. (Arrastrarla con el mouse es un clic que abre el ticket; con el dedo, un scroll.)
  await expect(mariscos.locator('.deslizable')).toHaveCount(0);
  await expect(mariscos.getByRole('button', { name: /^Eliminar / })).toHaveCount(0);
  // El único «Eliminar» de Consumos es el de lo que pagué.
  await expect(page.getByRole('button', { name: /^Eliminar / })).toHaveText(['Eliminar']);
  await expect(page.getByRole('button', { name: /^Eliminar / })).toHaveAccessibleName('Eliminar Bar La Ola');
});

test('🔴 D256 · un gasto a mano que cargué: «Gasto eliminado»', async ({ page }) => {
  await conViajes(page);
  await ir(page, `/viaje/${CANCUN}`);
  await page.getByRole('button', { name: 'Agregar gasto', exact: true }).click();
  await page.getByLabel('Descripción', { exact: true }).fill('Taxi al aeropuerto');
  await page.getByLabel('Monto', { exact: true }).fill('300');
  await page.getByRole('button', { name: 'Listo', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/viaje/${CANCUN}$`));
  await aConsumos(page);
  const taxi = consumo(page, 'Taxi al aeropuerto');
  await deslizar(page, taxi);
  await taxi.getByRole('button', { name: 'Eliminar Taxi al aeropuerto', exact: true }).click();
  expect(await llamadas(page)).toEqual([]);
  await confirmar(page);
  await expect(page.getByText('Gasto eliminado', { exact: true })).toBeVisible();
  await expect(consumo(page, 'Taxi al aeropuerto')).toHaveCount(0);
});

for (const [seam, aviso, sigue] of [
  ['ya_no_estaba', 'Ya no estaba', false],
  ['cerrado', 'El viaje ya no está abierto', true],
  ['prohibido', 'Sólo pueden eliminarlo quien lo cargó o quien lo pagó.', true],
] as const) {
  test(`🔴 D256 · el dueño contesta «${seam}»: «${aviso}», y la lista se vuelve a pedir`, async ({ page }, testInfo) => {
    await conViajes(page, { 'payme.app.mock.viajes.eliminar.v1': seam });
    await aConsumos(page);
    const bar = consumo(page, 'Bar La Ola');
    const pedidosAntes = await page.evaluate(() => (window as VentanaD388).__d388!.pedidos.length);
    await deslizar(page, bar);
    await bar.getByRole('button', { name: 'Eliminar Bar La Ola', exact: true }).click();
    expect(await llamadas(page)).toEqual([]);
    await confirmar(page);
    await expect(page.getByText(aviso, { exact: true })).toBeVisible();
    await expect(page.getByText('Ticket eliminado', { exact: true })).toHaveCount(0);
    // Con «ya no estaba» el dueño ya lo había sacado; si no, sigue en la lista.
    await expect(consumo(page, 'Bar La Ola')).toHaveCount(sigue ? 1 : 0);
    await expect(page.locator('.deslizable--abierta')).toHaveCount(0);
    expect(await llamadas(page)).toHaveLength(1);
    await expect.poll(() => page.evaluate(() => (window as VentanaD388).__d388!.pedidos.length)).toBeGreaterThan(pedidosAntes);
    await completarCicloDeFoco(page);
    await expect(page.locator('.deslizable--abierta')).toHaveCount(0);
    const balance = page.locator('.screen.has-appbar[tabindex="-1"]');
    await expect(balance).toBeFocused();
    console.log('PAYME_D388_FOCO_NEGATIVO_V1 ' + JSON.stringify({
      titulo: testInfo.title, proyecto: testInfo.project.name, retry: testInfo.retry, costura: seam,
      filas_abiertas: await page.locator('.deslizable--abierta').count(),
      foco_balance: await balance.evaluate((el) => el === document.activeElement),
      llamadas_fachada: (await llamadas(page)).length,
      pedidos_antes: pedidosAntes,
      pedidos_despues: await page.evaluate(() => (window as VentanaD388).__d388!.pedidos.length),
    }));
  });
}

test('🔴 D256 · el 404 del viaje (ya no es miembro) sigue el camino de siempre: «Este viaje ya no está disponible.»', async ({ page }) => {
  await conViajes(page, { 'payme.app.mock.viajes.eliminar.v1': 'sin_viaje' });
  await aConsumos(page);
  const bar = consumo(page, 'Bar La Ola');
  await deslizar(page, bar);
  await bar.getByRole('button', { name: 'Eliminar Bar La Ola', exact: true }).click();
  await confirmar(page);
  await expect(page.getByText('Este viaje ya no está disponible.', { exact: true })).toBeVisible();
  await expect(page.getByText('Ticket eliminado', { exact: true })).toHaveCount(0);
});

test('🔴 D256 · el aviso «eliminó un gasto» se ve en Notificaciones y abre el viaje', async ({ page }) => {
  await conViajes(page, { 'payme.app.mock.viajes.aviso_eliminado.v1': 'encendido' });
  await ir(page, '/avisos');
  const fila = page.getByText('Luis Pérez eliminó un gasto de Cancún 2026: Taxi al aeropuerto.', { exact: false });
  await expect(fila).toBeVisible();
  await fila.click();
  await expect(page).toHaveURL(new RegExp(`/viaje/${CANCUN}$`));
});

async function preguntarBar(page: Page): Promise<Locator> {
  const boton = consumo(page, 'Bar La Ola').getByRole('button', { name: 'Eliminar Bar La Ola', exact: true });
  // La alternativa de teclado revela la fila; el click siguiente también se prueba sin foco previo.
  await boton.focus();
  await boton.click();
  await expect(hoja(page)).toBeVisible();
  return boton;
}

for (const salida of ['Cancelar', 'Escape', 'velo', 'Back', 'navegación'] as const) {
  test(`D388 · ${salida} descarta sin llamar a la fachada`, async ({ page }) => {
    await conViajes(page);
    await aConsumos(page);
    const antes = await page.evaluate(() => (window as VentanaD388).__d388!.pedidos.length);
    const boton = await preguntarBar(page);
    expect(await llamadas(page)).toEqual([]);
    expect(await page.evaluate(() => (window as VentanaD388).__d388!.pedidos.length)).toBe(antes);
    await expect(hoja(page).getByRole('button', { name: 'Cancelar', exact: true })).toBeFocused();
    if (salida === 'Cancelar') await hoja(page).getByRole('button', { name: salida, exact: true }).click();
    else if (salida === 'Escape') await page.keyboard.press('Escape');
    else if (salida === 'velo') await page.locator('.sheet-overlay').click({ position: { x: 5, y: 5 } });
    else if (salida === 'Back') await page.goBack();
    else await ir(page, '/viajes/abiertos');
    await expect(hoja(page)).toHaveCount(0);
    expect(await llamadas(page)).toEqual([]);
    await expect(page.locator('.app')).not.toHaveAttribute('inert');
    if (salida === 'Back' || salida === 'navegación') {
      await aConsumos(page);
      await expect(hoja(page)).toHaveCount(0);
    } else {
      await expect(consumo(page, 'Bar La Ola')).toBeVisible();
      await expect(boton).toBeFocused();
    }
  });
}

test('D388 · segunda visita del lugar por id, sin borrar el grupo ni la primera', async ({ page }) => {
  await conViajes(page);
  await aConsumos(page);
  const id = 'd3880000-0000-4000-8000-000000000002';
  await page.evaluate((segundoId) => {
    const i = (window as VentanaD388).__d388!;
    const v = i.ultimo!;
    const bar = v.tickets.find((tk) => tk.lugar === 'Bar La Ola')!;
    // Orden contrario al de fecha: el identificador, nunca el índice, decide la visita.
    i.respuesta = { ...v, tickets: [{ ...bar, id: segundoId, fecha_ticket: '2026-01-01', cargado_en: '2026-01-01T12:00:00Z' }, ...v.tickets] };
    i.resultado = v;
  }, id);
  await ir(page, `/viaje/${CANCUN}`);
  await aConsumos(page);
  const grupo = consumo(page, 'Bar La Ola');
  await grupo.getByRole('button', { name: /Bar La Ola.*2 veces/ }).click();
  const visitas = grupo.locator('.vjb-visitas > li');
  await expect(visitas).toHaveCount(2);
  const segunda = visitas.nth(1).getByRole('button', { name: 'Eliminar Bar La Ola', exact: true });
  await segunda.focus();
  await segunda.click();
  await confirmar(page);
  await expect(page.getByText('Ticket eliminado', { exact: true })).toBeVisible();
  expect(await llamadas(page)).toEqual([[CANCUN, id]]);
  await expect(consumo(page, 'Bar La Ola')).toHaveCount(1);
  await expect(grupo.locator('.vjb-visitas')).toHaveCount(0);
});

test('D388 · gasto personal inventado usa la misma fachada una vez', async ({ page }) => {
  await conViajes(page);
  await aConsumos(page);
  const id = 'd3880000-0000-4000-8000-000000000003';
  await page.evaluate((ticketId) => {
    const i = (window as VentanaD388).__d388!;
    const v = i.ultimo!;
    const base = v.tickets.find((tk) => tk.puede_eliminar)!;
    i.respuesta = { ...v, tickets: [{ ...base, id: ticketId, lugar: 'Gasto personal inventado', origen: 'manual', personal: true }, ...v.tickets] };
    i.resultado = v;
  }, id);
  await ir(page, `/viaje/${CANCUN}`);
  await aConsumos(page);
  const boton = consumo(page, 'Gasto personal inventado').getByRole('button', { name: 'Eliminar Gasto personal inventado', exact: true });
  await boton.focus(); await boton.click();
  await confirmar(page);
  await expect(page.getByText('Gasto eliminado', { exact: true })).toBeVisible();
  expect(await llamadas(page)).toEqual([[CANCUN, id]]);
});

test('D388 · Enter y dos callbacks encolados confirman una sola vez', async ({ page }) => {
  await conViajes(page); await aConsumos(page);
  await page.evaluate(() => { (window as VentanaD388).__d388!.demorar = true; });
  await preguntarBar(page);
  await page.keyboard.press('Enter'); // Cancelar inicial, no Eliminar.
  expect(await llamadas(page)).toEqual([]);
  await preguntarBar(page);
  await hoja(page).getByRole('button', { name: 'Eliminar', exact: true }).evaluate((boton) => {
    if (!(boton instanceof HTMLButtonElement)) throw new Error('D388: la confirmación debe ser un botón');
    boton.click(); boton.click();
  });
  await expect.poll(() => llamadas(page)).toHaveLength(1);
  await page.evaluate(() => { (window as VentanaD388).__d388!.resolver!(); });
  await expect(page.getByText('Ticket eliminado', { exact: true })).toBeVisible();
  expect(await llamadas(page)).toHaveLength(1);
  // El disparador desapareció: el fallback local recibe foco.
  await expect(page.locator('.screen.has-appbar[tabindex="-1"]')).toBeFocused();
});

test('D388 · una respuesta pendiente no permite otra pregunta o envío', async ({ page }) => {
  await conViajes(page); await aConsumos(page);
  await page.evaluate(() => { (window as VentanaD388).__d388!.demorar = true; });
  await preguntarBar(page); await confirmar(page);
  await expect(hoja(page)).toHaveCount(0);
  await completarCicloDeFoco(page);
  await expect(page.locator('.screen.has-appbar[tabindex="-1"]')).toBeFocused();
  await expect(page.locator('.deslizable--abierta')).toHaveCount(0);
  expect(await llamadas(page)).toHaveLength(1);
  const boton = consumo(page, 'Bar La Ola').getByRole('button', { name: 'Eliminar Bar La Ola', exact: true });
  await boton.focus(); await boton.click();
  await expect(hoja(page)).toHaveCount(0);
  expect(await llamadas(page)).toHaveLength(1);
  const otraAccion = page.getByRole('tab', { name: 'Miembros', exact: true });
  await otraAccion.focus();
  await page.evaluate(() => { (window as VentanaD388).__d388!.resolver!(); });
  await expect(page.getByText('Ticket eliminado', { exact: true })).toBeVisible();
  expect(await llamadas(page)).toHaveLength(1);
  await completarCicloDeFoco(page);
  await expect(otraAccion).toBeFocused();
});

for (const cambio of ['retirado', 'permiso', 'cerrado'] as const) {
  test(`D388 · la última carga ${cambio} invalida una confirmación anterior`, async ({ page }) => {
    await contextoControlado(page); await conViajes(page); await aConsumos(page);
    await preguntarBar(page);
    // Se conserva el nodo del botón para disparar un callback anterior, aun si React ya retiró la hoja.
    await hoja(page).getByRole('button', { name: 'Eliminar', exact: true }).evaluate((boton) => {
      boton.dataset.anterior = 'd388';
      (window as unknown as { __botonAnterior: HTMLButtonElement }).__botonAnterior = boton as HTMLButtonElement;
    });
    await page.evaluate((c) => {
      const i = (window as VentanaD388).__d388!; const v = i.ultimo!;
      const ticketId = v.tickets.find((tk) => tk.puede_eliminar)!.id;
      const viaje = c === 'cerrado' ? { ...v, estado: 'cerrado' as const }
        : { ...v, tickets: c === 'retirado' ? v.tickets.filter((tk) => tk.id !== ticketId)
          : v.tickets.map((tk) => tk.id === ticketId ? { ...tk, puede_eliminar: false } : tk) };
      i.carga = { tipo: 'listo', viaje };
      dispatchEvent(new Event('d388-contexto'));
    }, cambio);
    await expect(hoja(page)).toHaveCount(0);
    await page.evaluate(() => { (window as unknown as { __botonAnterior: HTMLButtonElement }).__botonAnterior.click(); });
    expect(await llamadas(page)).toEqual([]);
    await expect(page.locator('.app')).not.toHaveAttribute('inert');
  });
}

test('D388 · otro actor/familia antes de confirmar descarta la selección', async ({ page }) => {
  await contextoControlado(page); await conViajes(page); await aConsumos(page);
  await preguntarBar(page);
  await page.evaluate(() => {
    (window as VentanaD388).__d388!.actor = { principal: 'actor-inventado-B', familia: 'familia-inventada-B' };
    dispatchEvent(new Event('d388-contexto'));
  });
  await expect(hoja(page)).toHaveCount(0);
  expect(await llamadas(page)).toEqual([]);
});

for (const resultado of ['éxito', 'rechazo'] as const) {
  test(`D388 · ${resultado} tardío no aplica efectos al actor nuevo`, async ({ page }) => {
    await contextoControlado(page); await conViajes(page); await aConsumos(page);
    await page.evaluate(() => { (window as VentanaD388).__d388!.demorar = true; });
    await preguntarBar(page); await confirmar(page);
    await page.evaluate(() => {
      (window as VentanaD388).__d388!.actor = { principal: 'actor-inventado-B', familia: 'familia-inventada-B' };
      dispatchEvent(new Event('d388-contexto'));
    });
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const focoNuevo = page.getByRole('tab', { name: 'Miembros', exact: true });
    await focoNuevo.focus();
    await page.evaluate((r) => {
      const i = (window as VentanaD388).__d388!;
      if (r === 'éxito') i.resolver!(); else i.rechazar!();
    }, resultado);
    await expect.poll(() => page.evaluate(() => (window as VentanaD388).__d388!.terminadas)).toBe(1);
    expect(await llamadas(page)).toHaveLength(1);
    expect(await efectos(page)).toEqual({ mostrar: 0, refrescar: 0, noDisponible: 0 });
    await expect(page.locator('[role="status"]').filter({ hasText: /Ticket eliminado|El viaje ya no está abierto|No pudimos eliminarlo/ })).toHaveCount(0);
    await completarCicloDeFoco(page);
    await expect(focoNuevo).toBeFocused();
  });
}

test('D388 · ir a otro viaje antes de confirmar descarta la selección', async ({ page }) => {
  await conViajes(page); await aConsumos(page); await preguntarBar(page);
  await ir(page, '/viaje-balance/d3880000-0000-4000-8000-000000000004');
  await expect(hoja(page)).toHaveCount(0);
  expect(await llamadas(page)).toEqual([]);
});

test('D388 · una respuesta del viaje anterior no actualiza el nuevo', async ({ page }) => {
  await contextoControlado(page); await conViajes(page); await aConsumos(page);
  await page.evaluate(() => { (window as VentanaD388).__d388!.demorar = true; });
  await preguntarBar(page); await confirmar(page);
  await ir(page, '/viaje-balance/d3880000-0000-4000-8000-000000000004');
  await expect(hoja(page)).toHaveCount(0);
  const focoNuevo = page.getByRole('tab', { name: 'Miembros', exact: true });
  await focoNuevo.focus();
  await page.evaluate(() => { (window as VentanaD388).__d388!.resolver!(); });
  await expect.poll(() => page.evaluate(() => (window as VentanaD388).__d388!.terminadas)).toBe(1);
  expect(await llamadas(page)).toHaveLength(1);
  expect(await efectos(page)).toEqual({ mostrar: 0, refrescar: 0, noDisponible: 0 });
  await expect(page.getByText('Ticket eliminado', { exact: true })).toHaveCount(0);
  await completarCicloDeFoco(page);
  await expect(focoNuevo).toBeFocused();
});

test('D388 · timeout sin retry automático; otro intento requiere confirmación humana', async ({ page }) => {
  await conViajes(page); await aConsumos(page);
  await page.evaluate(() => { (window as VentanaD388).__d388!.fallar = true; });
  await preguntarBar(page); await confirmar(page);
  await expect(page.getByText('No pudimos eliminarlo. Prueba de nuevo.', { exact: true })).toBeVisible();
  expect(await llamadas(page)).toHaveLength(1);
  await expect(consumo(page, 'Bar La Ola')).toBeVisible();
  await page.evaluate(() => { (window as VentanaD388).__d388!.fallar = false; });
  await preguntarBar(page);
  expect(await llamadas(page)).toHaveLength(1);
  await confirmar(page);
  await expect(page.getByText('Ticket eliminado', { exact: true })).toBeVisible();
  expect(await llamadas(page)).toHaveLength(2);
});

for (const [idioma, ancho] of [['es', 320], ['en', 375]] as const) {
  test(`D388 · hoja ${idioma}${ancho}, teclado/inert y texto ampliado sin solapes`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: ancho, height: 667 });
    await conViajes(page);
    if (idioma === 'en') {
      await ir(page, '/mas');
      await page.getByRole('button', { name: 'EN', exact: true }).click();
    }
    await ir(page, `/viaje-balance/${CANCUN}`);
    const boton = consumo(page, 'Bar La Ola').getByRole('button', { name: `${idioma === 'es' ? 'Eliminar' : 'Delete'} Bar La Ola`, exact: true });
    await boton.focus();
    await boton.evaluate((b) => b.blur());
    // Simula el click que no enfoca el botón, como el caso de riesgo Safari (sin atribuir Safari real).
    await boton.evaluate((b) => {
      if (!(b instanceof HTMLButtonElement)) throw new Error('D388: el disparador debe ser un botón');
      b.click();
    });
    const dialogo = page.getByRole('dialog', { name: idioma === 'es' ? '¿Eliminar?' : 'Remove?', exact: true });
    const cancelar = dialogo.getByRole('button', { name: idioma === 'es' ? 'Cancelar' : 'Cancel', exact: true });
    const eliminar = dialogo.getByRole('button', { name: idioma === 'es' ? 'Eliminar' : 'Remove', exact: true });
    await expect(cancelar).toBeFocused();
    const focoInicialCancelar = await cancelar.evaluate((el) => el === document.activeElement);
    await expect(page.locator('.app')).toHaveAttribute('inert', '');
    const atributoInert = await page.locator('.app').getAttribute('inert');
    await page.keyboard.press('Shift+Tab'); await expect(eliminar).toBeFocused();
    const focoShiftTabEliminar = await eliminar.evaluate((el) => el === document.activeElement);
    await page.keyboard.press('Tab'); await expect(cancelar).toBeFocused();
    const focoTabCancelar = await cancelar.evaluate((el) => el === document.activeElement);
    const fuentesAntes = await dialogo.locator('h2, button').evaluateAll((els) => els.map((el) => parseFloat(getComputedStyle(el).fontSize)));
    // Doble tamaño de texto de la hoja; no se presenta como zoom físico o safe-area real de iPhone.
    await dialogo.locator('h2, button').evaluateAll((els) => {
      for (const el of els) (el as HTMLElement).style.fontSize = `${parseFloat(getComputedStyle(el).fontSize) * 2}px`;
    });
    const fuentesDespues = await dialogo.locator('h2, button').evaluateAll((els) => els.map((el) => parseFloat(getComputedStyle(el).fontSize)));
    const c = await cancelar.boundingBox(); const e = await eliminar.boundingBox();
    expect(c).not.toBeNull(); expect(e).not.toBeNull();
    expect(c!.y + c!.height).toBeLessThanOrEqual(e!.y);
    await expect(cancelar).toBeInViewport({ ratio: 1 });
    await expect(eliminar).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const horizontal = await page.evaluate(() => ({ scroll_width: document.documentElement.scrollWidth, inner_width: innerWidth }));
    if (process.env.PAYME_D388_CAPTURAS) await page.screenshot({ path: `${process.env.PAYME_D388_CAPTURAS}/d388-${idioma}.png` });
    await page.keyboard.press('Escape');
    await expect(dialogo).toHaveCount(0);
    await expect(boton).toBeFocused();
    expect(await llamadas(page)).toEqual([]);
    const viewport = page.viewportSize();
    expect(viewport).toEqual({ width: ancho, height: 667 });
    console.log('PAYME_D388_GEOMETRIA_V1 ' + JSON.stringify({
      titulo: testInfo.title, idioma, viewport, proyecto: testInfo.project.name, retry: testInfo.retry,
      cancelar: c, eliminar: e, horizontal,
      foco_inicial_cancelar: focoInicialCancelar, inert: atributoInert,
      foco_shift_tab_eliminar: focoShiftTabEliminar, foco_tab_cancelar: focoTabCancelar,
      fuentes_antes_px: fuentesAntes, fuentes_despues_px: fuentesDespues,
      dialogos_despues_escape: await dialogo.count(),
      foco_disparador_despues_escape: await boton.evaluate((el) => el === document.activeElement),
      llamadas_fachada: (await llamadas(page)).length,
    }));
  });
}
