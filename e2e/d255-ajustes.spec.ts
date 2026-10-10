import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';

/**
 * AF-CACHE-Y-AJUSTES-1010-20261010 · D255 · los ajustes que pidió Mati al
 * probar 0.233.0 en su iPhone (tramo 1), medidos en el navegador: lo que el
 * CSS hace, no lo que dice. A 375 de ancho, como el plan.
 *
 * 🔴 Lo que esto NO prueba: el rebote del iPhone al arrastrar (punto 5) no
 * existe en Chromium; acá se lee que el scroll no rebote (`overscroll-behavior`)
 * en toda pantalla con pestañas. Si la burbuja ya no se parte lo dice el iPhone
 * de Mati (D63).
 */
const CANCUN = 'd1000000-0000-4000-8000-000000000001';

async function conViajes(page: Page): Promise<void> {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.addInitScript(() => localStorage.setItem('payme.app.mock.viajes.v1', 'encendido'));
  await ingresar(page);
}

async function ir(page: Page, ruta: string): Promise<void> {
  await page.evaluate((u) => {
    history.pushState(null, '', u);
    dispatchEvent(new PopStateEvent('popstate'));
  }, ruta);
}

const caja = async (page: Page, selector: string) => (await page.locator(selector).first().boundingBox())!;

test.describe('D255 · tramo 1', () => {
  test('🔴 2 · Viajes: lo elegido es la mitad exacta de la tarjeta, sin espacio con la otra, y en negrita', async ({ page }) => {
    await conViajes(page);
    await page.getByRole('tab', { name: 'Viajes', exact: true }).click();
    for (const i of [0, 1]) {
      await page.locator('button.vj-lanzador').nth(i).click();
      await expect(page.locator('button.vj-lanzador').nth(i)).toHaveAttribute('aria-pressed', 'true');
      const m = await page.evaluate((elegido) => {
        const tarjeta = document.querySelector('.mounted-card')!.getBoundingClientRect();
        const [a, b] = [...document.querySelectorAll('button.vj-lanzador')].map((x) => x.getBoundingClientRect());
        const e = document.querySelectorAll('button.vj-lanzador')[elegido]!;
        const cs = getComputedStyle(e);
        return {
          tarjeta: { izq: tarjeta.left, der: tarjeta.right, abajo: tarjeta.bottom, arriba: tarjeta.top },
          a: { izq: a!.left, der: a!.right, arriba: a!.top, abajo: a!.bottom },
          b: { izq: b!.left, der: b!.right, arriba: b!.top, abajo: b!.bottom },
          radioAbajo: elegido === 0 ? cs.borderBottomLeftRadius : cs.borderBottomRightRadius,
          radioTarjeta: getComputedStyle(document.querySelector('.mounted-card')!).borderBottomLeftRadius,
          bordeAncho: cs.borderTopWidth,
          sombra: cs.boxShadow,
          fondo: cs.backgroundColor,
          negrita: [...document.querySelectorAll('.vj-lanzador .launch-label')].map((x) => getComputedStyle(x).fontWeight),
        };
      }, i);
      // Sin espacio entre las dos, y cada una llega a los bordes de la tarjeta.
      expect(m.a.der).toBe(m.b.izq);
      expect(m.a.izq).toBe(m.tarjeta.izq);
      expect(m.b.der).toBe(m.tarjeta.der);
      expect(m.a.abajo).toBe(m.tarjeta.abajo);
      expect(m.a.arriba).toBe(m.tarjeta.arriba);
      // El recuadro sigue la esquina de la tarjeta, sin borde propio.
      expect(m.radioAbajo).toBe(m.radioTarjeta);
      expect(m.bordeAncho).toBe('0px');
      expect(m.sombra).toContain('inset');
      expect(m.fondo).toBe('rgb(228, 251, 252)');
      expect(m.negrita).toEqual(['700', '700']);
    }
  });

  test('🔴 3 · Balance: las pestañas en la cabecera, pegadas a la tarjeta; logo y «Volver» donde están en el viaje', async ({ page }) => {
    await conViajes(page);
    await ir(page, `/viaje/${CANCUN}`);
    await expect(page.getByText('Ver balance del viaje', { exact: true })).toBeVisible();
    const enElViaje = { logo: await caja(page, 'header.hdr .hdr-mark'), volver: await caja(page, 'header.hdr .hdr-back') };
    await page.getByText('Ver balance del viaje', { exact: true }).click();
    const consumos = page.locator('header.hdr').getByRole('tab', { name: 'Consumos', exact: true });
    await expect(consumos).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('heading', { name: 'Balance' })).toHaveCount(0);
    const tab = await consumos.boundingBox();
    const tarjeta = await caja(page, '.mounted-card');
    expect(Math.abs(tarjeta.y - (tab!.y + tab!.height))).toBeLessThanOrEqual(1);
    expect(Math.abs(tarjeta.x - tab!.x)).toBeLessThanOrEqual(1);
    expect(await caja(page, 'header.hdr .hdr-mark')).toEqual(enElViaje.logo);
    expect(await caja(page, 'header.hdr .hdr-back')).toEqual(enElViaje.volver);
    // A medias: cada pestaña, la mitad de la fila.
    const miembros = await page.locator('header.hdr').getByRole('tab', { name: 'Miembros', exact: true }).boundingBox();
    expect(Math.abs(miembros!.width - tab!.width)).toBeLessThanOrEqual(1);
    await page.locator('header.hdr').getByRole('tab', { name: 'Miembros', exact: true }).click();
    await expect(page.locator('.mounted-card.seam-right')).toBeVisible();
  });

  test('🔴 5 · sin rebote en toda pantalla con pestañas en la cabecera; el viaje, sin pestañas, como siempre', async ({ page }) => {
    await conViajes(page);
    const rebote = () => page.evaluate(() => getComputedStyle(document.querySelector('.scroll')!).overscrollBehaviorY);
    expect(await rebote()).toBe('none');
    await page.getByRole('button', { name: /^Amigos/ }).click();
    await expect(page.getByRole('button', { name: 'Nuevo amigo' })).toBeVisible();
    expect(await rebote()).toBe('none');
    await ir(page, `/viaje-balance/${CANCUN}`);
    await expect(page.getByRole('tab', { name: 'Consumos', exact: true })).toBeVisible();
    expect(await rebote()).toBe('none');
    await ir(page, `/viaje/${CANCUN}`);
    await expect(page.getByText('Ver balance del viaje', { exact: true })).toBeVisible();
    expect(await rebote()).toBe('auto');
  });

  test('🔴 7 · el viaje: monto centrado, «Configuración» debajo de «Ver balance», «Cerrar viaje» rojo clarito y el pie arriba del círculo', async ({ page }) => {
    await conViajes(page);
    // Alto, para que sobre lugar y el pie se vea abajo.
    await page.setViewportSize({ width: 375, height: 1000 });
    await ir(page, `/viaje/${CANCUN}`);
    await expect(page.getByText('Ver balance del viaje', { exact: true })).toBeVisible();
    const m = await page.evaluate(() => {
      const r = (s: string) => document.querySelector(s)!.getBoundingClientRect();
      const titulo = r('.title-card'); const monto = r('.vjv-monto'); const miembros = r('.vjv-miembros');
      return {
        arriba: monto.top - titulo.bottom,
        abajo: miembros.top - monto.bottom,
        balance: r('.vjv-ver-balance:not(.vjv-configuracion)'),
        configuracion: r('.vjv-configuracion'),
        cerrar: r('.vjv-cerrar'),
        salir: r('.vjv-salir'),
        circulo: r('.appbar-fab'),
        fondoCerrar: getComputedStyle(document.querySelector('.vjv-cerrar')!).backgroundColor,
        colorCerrar: getComputedStyle(document.querySelector('.vjv-cerrar')!).color,
      };
    });
    expect(Math.abs(m.arriba - m.abajo)).toBeLessThanOrEqual(2);
    expect(m.configuracion.top).toBeGreaterThan(m.balance.bottom);
    expect(m.configuracion.top - m.balance.bottom).toBeLessThanOrEqual(16);
    // El pie va abajo: lo que sobra queda entre «Configuración» y «Cerrar viaje».
    expect(m.cerrar.top - m.configuracion.bottom).toBeGreaterThan(60);
    expect(m.salir.top).toBeGreaterThan(m.cerrar.bottom);
    // Un poco por encima de la barra: 12 sobre el círculo.
    expect(Math.round(m.circulo.top - m.salir.bottom)).toBe(12);
    expect(m.fondoCerrar).toBe('rgb(254, 242, 242)');
    expect(m.colorCerrar).toBe('rgb(180, 35, 24)');
  });

  test('🔴 8 · Configuración: agregar a un amigo lo invita en el acto; quien ya está va sin «Agregar»; «Volver» regresa al viaje', async ({ page }) => {
    await conViajes(page);
    await ir(page, `/viaje/${CANCUN}`);
    await page.getByRole('button', { name: 'Configuración' }).click();
    await expect(page.getByRole('heading', { name: 'Configuración', level: 1 })).toBeVisible();
    // Un solo título: sin el nombre del viaje debajo.
    await expect(page.locator('.title-card')).toHaveText('Configuración');
    expect(page.url()).toMatch(new RegExp(`/viaje/${CANCUN}$`));
    const buscar = page.getByLabel('Busca en Amigos o escribe @usuario', { exact: true });
    await buscar.fill('sofi');
    const sofia = page.locator('.vjc-fila').filter({ hasText: 'Sofía Fernández' });
    await sofia.getByRole('button', { name: 'Agregar', exact: true }).click();
    await expect(page.getByText('Le mandamos la invitación a Sofía Fernández.', { exact: true })).toBeVisible();
    // Ya invitada (con su @ en la respuesta): «Ya están en el viaje», sin botón.
    await expect(page.getByText('Ya están en el viaje', { exact: true })).toBeVisible();
    await expect(page.locator('.vjc-fila').filter({ hasText: 'Sofía Fernández' }).getByRole('button')).toHaveCount(0);
    // Sin buscar: entre los invitados, que faltan aceptar.
    await buscar.fill('');
    await expect(page.locator('.vjc-fila').filter({ hasText: 'Sofía Fernández' })).toContainText('Falta que acepte');
    // Al volver a entrar, igual: lo dice el viaje, no la memoria de la pantalla.
    await page.getByRole('button', { name: 'Volver', exact: true }).click();
    await page.getByRole('button', { name: 'Configuración' }).click();
    await page.getByLabel('Busca en Amigos o escribe @usuario', { exact: true }).fill('sofi');
    await expect(page.getByText('Ya están en el viaje', { exact: true })).toBeVisible();
    await expect(page.locator('.vjc-fila').filter({ hasText: 'Sofía Fernández' }).getByRole('button')).toHaveCount(0);
    // Tramo 2: armado y apagado.
    await expect(page.locator('button.vjcfg-fila')).toHaveCount(3);
    for (const b of await page.locator('button.vjcfg-fila').all()) await expect(b).toBeDisabled();
    await page.getByRole('button', { name: 'Volver', exact: true }).click();
    await expect(page.getByText('Ver balance del viaje', { exact: true })).toBeVisible();
    expect(page.url()).toMatch(new RegExp(`/viaje/${CANCUN}$`));
  });
});
