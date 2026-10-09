import { expect, test, type Page } from '@playwright/test';
import { abrirMesaConLink, ingresar } from './_app';
import { buscarTexto, cargasDesde, espiarCargas, marcaDeCargas } from './_senales';

/**
 * AF-PESTANAS-SIN-PARPADEO-20261008 · D237 · cambiar de pestaña sin pantalla
 * intermedia. Mati, en su video (0.224.0, cuadro por cuadro):
 * - Mesas mostraba 4 filas esqueleto y después eran 2 mesas;
 * - Inicio, una tarjeta esqueleto de mesa y después «No tienes mesas abiertas»;
 * - Amigos, «Cargando amigos…» antes de la lista;
 * - un recuadro gris sobre el ícono tocado de la barra.
 * Los datos llegaban en 100–200 ms: lo lento era volver a armar cada pestaña.
 *
 * Lo que se afirma acá:
 * - **la segunda visita** no muestra ningún estado de carga y tiene el contenido
 *   en los primeros cuadros (lo último visto, en memoria);
 * - **la primera visita** muestra un esqueleto sólo si tarda más de 300 ms, y
 *   ese esqueleto no promete: en Inicio no es una tarjeta de mesa, en Mesas son
 *   dos filas;
 * - lo guardado **se reemplaza** si cambió, **no sobrevive** a cerrar sesión, y
 *   **no se ve** después de cerrar una mesa.
 *
 * Las ausencias se afirman con un espía (`espiarCargas`), nunca esperando a que
 * algo desaparezca: la lección de los toasts de 0.224.0.
 */

const LATENCIA = 'payme.app.mock.latencia.v1';
/**
 * La sección de la mesa abierta de Inicio. 🔴 No `.home-mesa` a secas: la
 * invitación «Te invitaron» usa la misma clase, y una primera versión de estas
 * pruebas daba Inicio por «listo» con la invitación mientras la mesa todavía
 * cargaba (lo cazó el mutante que apaga lo último visto en Inicio).
 */
const MESA_ABIERTA = 'section.home-mesa[aria-label="Tu mesa abierta"]';
const SOLICITUDES = 'payme.app.mock.amigos.solicitudes.v1';

type Pestana = 'Inicio' | 'Mesas' | 'Amigos';

/** Toca la pestaña de la barra y cuenta los cuadros hasta que su contenido está. */
async function tocarYMedir(page: Page, pestana: Pestana): Promise<{ ms: number; cuadros: number }> {
  return page.evaluate(async (p) => {
    const listo = (): boolean => {
      if (p === 'Inicio') {
        const s = document.querySelector('section.home-mesa[aria-label="Tu mesa abierta"]');
        return !!s && s.children.length > 0 && !s.querySelector('.sk-neutro');
      }
      if (p === 'Mesas') return !!document.querySelector('.unirse') && (document.body.textContent ?? '').includes('$224.25');
      return !!document.querySelector('.friend-row');
    };
    const boton = [...document.querySelectorAll('nav.appbar button')]
      .find((b) => (b.querySelector('.appbar-label')?.textContent ?? '').trim() === p) as HTMLButtonElement;
    const t0 = performance.now();
    boton.click();
    let cuadros = 0;
    return new Promise<{ ms: number; cuadros: number }>((resolve) => {
      const tick = () => {
        if (listo()) resolve({ ms: Math.round(performance.now() - t0), cuadros });
        else { cuadros += 1; requestAnimationFrame(tick); }
      };
      requestAnimationFrame(tick);
    });
  }, pestana);
}

async function pasarPorLasTres(page: Page): Promise<Record<Pestana, { ms: number; cuadros: number }>> {
  const r = {} as Record<Pestana, { ms: number; cuadros: number }>;
  for (const p of ['Mesas', 'Amigos', 'Inicio'] as const) r[p] = await tocarYMedir(page, p);
  return r;
}

async function inicioListo(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
  await expect(page.locator(`${MESA_ABIERTA} > :not(.sk-neutro)`).first()).toBeVisible();
}

/**
 * Anota si alguna vez se dibujó algo que cumple cada selector (un
 * MutationObserver desde el primer cuadro). Un estado de carga dura unos pocos
 * cientos de milisegundos: afirmarlo con `toBeVisible` depende de que uno de los
 * sondeos de Playwright caiga en esa ventana, y bajo carga (CI con corridas en
 * paralelo, 37877762937) no cae. El espía lo ve siempre.
 */
async function espiarSelectores(page: Page, selectores: readonly string[]): Promise<void> {
  await page.addInitScript((sels: string[]) => {
    const w = window as unknown as { __selectoresVistos: Record<string, boolean> };
    w.__selectoresVistos = {};
    const anotar = () => {
      for (const s of sels) if (document.querySelector(s)) w.__selectoresVistos[s] = true;
    };
    const empezar = () => new MutationObserver(anotar).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    if (document.body) empezar(); else document.addEventListener('DOMContentLoaded', empezar);
  }, [...selectores]);
}

const selectoresVistos = (page: Page) =>
  page.evaluate(() => (window as unknown as { __selectoresVistos: Record<string, boolean> }).__selectoresVistos ?? {});

async function captura(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (dir) await page.screenshot({ path: `${dir}/${nombre}.png` });
}

test.describe('D237 · pestañas sin parpadeo', () => {
  test('🔴 segunda visita a Inicio, Mesas y Amigos: ningún estado de carga, y el contenido en los primeros cuadros', async ({ page }) => {
    await espiarCargas(page);
    await ingresar(page);
    await inicioListo(page);
    const primera = await pasarPorLasTres(page);

    const marca = await marcaDeCargas(page);
    const segunda = await pasarPorLasTres(page);
    console.log('SEGUNDA-VISITA', JSON.stringify({ primera, segunda }));

    expect(await cargasDesde(page, marca)).toEqual([]);
    for (const p of ['Inicio', 'Mesas', 'Amigos'] as const) {
      // Lo último visto se dibuja en el primer render: a lo sumo un par de cuadros.
      expect(segunda[p].cuadros, `${p}: ${JSON.stringify(segunda[p])}`).toBeLessThanOrEqual(2);
    }
  });

  test('primera visita rápida (100 ms): nunca se ve un esqueleto ni «Cargando…»', async ({ page }) => {
    await page.addInitScript(([k]) => localStorage.setItem(k!, '100'), [LATENCIA]);
    await espiarCargas(page);
    await ingresar(page);
    await inicioListo(page);
    await pasarPorLasTres(page);
    expect(await cargasDesde(page, 0)).toEqual([]);
  });

  test('🔴 primera visita lenta (800 ms): un esqueleto NEUTRO, que no promete', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.addInitScript(([k]) => localStorage.setItem(k!, '800'), [LATENCIA]);
    await espiarCargas(page);
    await ingresar(page);
    // Inicio: una línea neutra, no la silueta de una tarjeta de mesa.
    await expect(page.locator(`${MESA_ABIERTA} > :not(.sk-neutro)`).first()).toBeVisible({ timeout: 10_000 });
    // El esqueleto y «Cargando amigos…» se afirman con el espía, no con
    // `toBeVisible`: duran unos 500 ms y el sondeo los perdía bajo carga (CI
    // 37877762937; local, 6 de 48 con 8 workers, también en la base).
    const antesDeMesas = await marcaDeCargas(page);
    await page.getByRole('button', { name: 'Mesas', exact: true }).click();
    // La captura, si llega a tiempo (no es una aserción).
    await page.locator('.pago-row.sk').first().waitFor({ state: 'visible', timeout: 2000 })
      .then(() => captura(page, 'mesas-primera-lenta-375'), () => undefined);
    await expect(page.getByText('$224.25')).toBeVisible({ timeout: 10_000 });
    expect((await cargasDesde(page, antesDeMesas)).some((v) => v.startsWith('filas-sk:'))).toBe(true);
    const antesDeAmigos = await marcaDeCargas(page);
    await page.getByRole('button', { name: /^Amigos/ }).click();
    await expect(page.locator('.friend-row').first()).toBeVisible({ timeout: 10_000 });
    expect(await cargasDesde(page, antesDeAmigos)).toContain('cargando:Cargando amigos…');

    const vistas = await cargasDesde(page, 0);
    // Ni una vez la tarjeta de mesa como esqueleto.
    expect(vistas.filter((v) => v.includes('mesa-card'))).toEqual([]);
    // En Mesas, como mucho dos filas a la vez (antes, cuatro).
    const filas = vistas.filter((v) => v.startsWith('filas-sk:')).map((v) => Number(v.slice(9)));
    expect(Math.max(...filas)).toBeLessThanOrEqual(2);
    expect(Math.max(...filas)).toBeGreaterThanOrEqual(1);
  });

  test('Inicio lento: lo que se ve mientras carga es la línea neutra', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await espiarSelectores(page, [`${MESA_ABIERTA} .sk-neutro`, `${MESA_ABIERTA} .mesa-card.sk`]);
    await ingresar(page);
    await inicioListo(page);
    // Se recarga con el mock lento: la memoria se va con la recarga, así que
    // Inicio carga de cero y pasa el umbral de 300 ms.
    await page.evaluate(([k]) => localStorage.setItem(k!, '1500'), [LATENCIA]);
    await page.reload();
    await page.locator(`${MESA_ABIERTA} .sk-neutro`).waitFor({ state: 'visible', timeout: 3000 })
      .then(() => captura(page, 'inicio-primera-lenta-375'), () => undefined);
    await expect(page.locator(`${MESA_ABIERTA} > :not(.sk-neutro)`).first()).toBeVisible({ timeout: 10_000 });
    // Con el espía (desde la recarga): la línea neutra se dibujó, y la silueta
    // de la tarjeta de mesa nunca, ni un cuadro.
    const vistos = await selectoresVistos(page);
    expect(vistos[`${MESA_ABIERTA} .sk-neutro`]).toBe(true);
    expect(vistos[`${MESA_ABIERTA} .mesa-card.sk`]).toBeUndefined();
  });

  test('🔴 si los datos cambiaron, la segunda visita muestra lo último y lo reemplaza, sin pasar por la carga', async ({ page }) => {
    await page.addInitScript(([k]) => { if (!localStorage.getItem(k!)) localStorage.setItem(k!, '2'); }, [SOLICITUDES]);
    await espiarCargas(page);
    await ingresar(page);
    await page.getByRole('button', { name: /^Amigos/ }).click();
    await expect(page.locator('.btab-badge')).toHaveText('2');
    await page.getByRole('button', { name: 'Inicio', exact: true }).click();
    await inicioListo(page);

    // Llega una solicitud más mientras tanto.
    await page.evaluate(([k]) => localStorage.setItem(k!, '3'), [SOLICITUDES]);
    const marca = await marcaDeCargas(page);
    await page.getByRole('button', { name: /^Amigos/ }).click();
    await expect(page.locator('.btab-badge')).toHaveText('3');
    expect(await cargasDesde(page, marca)).toEqual([]);
  });

  test('🔴 cerrar sesión: lo de la cuenta anterior no se ve ni un cuadro al volver a entrar', async ({ page }) => {
    await page.addInitScript(([k]) => { if (!localStorage.getItem(k!)) localStorage.setItem(k!, '2'); }, [SOLICITUDES]);
    await espiarCargas(page);
    await ingresar(page);
    await page.getByRole('button', { name: /^Amigos/ }).click();
    await expect(page.locator('.btab-badge')).toHaveText('2');
    await buscarTexto(page, 'Persona 1 Prueba');

    // Cerrar sesión desde Más, SIN recargar la página: si se recargara, la
    // memoria se iría sola y la prueba no probaría nada.
    await page.getByRole('button', { name: 'Más', exact: true }).click();
    await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
    await page.evaluate(([k]) => localStorage.setItem(k!, '0'), [SOLICITUDES]);

    const marca = await marcaDeCargas(page);
    await page.getByLabel('Email', { exact: true }).fill('mati@payme.mx');
    await page.getByLabel('Contraseña', { exact: true }).fill('demo-e2e');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
    await page.getByRole('button', { name: /^Amigos/ }).click();
    await expect(page.locator('.friend-row').first()).toBeVisible();
    await page.getByRole('tab', { name: /^Solicitudes/ }).click();
    await expect(page.getByText('No tienes solicitudes pendientes.')).toBeVisible();
    // Ni el «2» de la pestaña ni las personas de la cuenta anterior.
    await expect(page.locator('.btab-badge')).toHaveCount(0);
    expect((await cargasDesde(page, marca)).filter((v) => v.startsWith('texto:'))).toEqual([]);
  });

  test('🔴 cerrar una mesa y volver a Inicio: la mesa cerrada no se ve ni un cuadro', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled'));
    await espiarCargas(page);
    await ingresar(page);
    const mesa = await abrirMesaConLink(page, { sinGarantia: true, modo: 'consumo' });
    // A Inicio por la barra (sin recargar): la mesa abierta queda vista.
    await page.getByRole('button', { name: 'Inicio', exact: true }).click();
    await expect(page.locator(MESA_ABIERTA).getByText(mesa.code)).toBeVisible();

    // A la mesa por la app, y se cierra.
    await page.locator(MESA_ABIERTA).getByText(mesa.code).click();
    await page.evaluate(() => { document.querySelector('.flow-scroll')?.scrollTo(0, 1e6); });
    await page.getByRole('button', { name: 'Cerrar mesa', exact: true }).click();
    await page.getByRole('dialog', { name: '¿Cerrar la mesa?' }).getByRole('button', { name: 'Sí, cerrar la mesa' }).click();
    await expect(page.getByText('Esta mesa cerró sin cobros')).toBeVisible();

    await buscarTexto(page, mesa.code);
    const marca = await marcaDeCargas(page);
    await page.getByRole('button', { name: 'Inicio', exact: true }).click();
    await inicioListo(page);
    await expect(page.locator(MESA_ABIERTA).getByText(mesa.code)).toHaveCount(0);
    expect((await cargasDesde(page, marca)).filter((v) => v === `texto:${mesa.code}`)).toEqual([]);
  });

  test('Amigos: la foto ya cargada no vuelve a pasar por las iniciales', async ({ page }) => {
    await espiarCargas(page, { conFoto: ['Sofía Fernández'] });
    await ingresar(page);
    await page.getByRole('button', { name: /^Amigos/ }).click();
    await expect(page.locator('.friend-row').filter({ hasText: 'Sofía Fernández' }).locator('.friend-avatar-image')).toBeVisible();
    await page.getByRole('button', { name: 'Inicio', exact: true }).click();
    await inicioListo(page);
    const marca = await marcaDeCargas(page);
    await page.getByRole('button', { name: /^Amigos/ }).click();
    await expect(page.locator('.friend-row').filter({ hasText: 'Sofía Fernández' }).locator('.friend-avatar-image')).toBeVisible();
    expect((await cargasDesde(page, marca)).filter((v) => v.startsWith('iniciales:'))).toEqual([]);
  });

  test('🔴 el toque en la barra: sin el recuadro gris de iOS', async ({ page }) => {
    await ingresar(page);
    const colores = await page.evaluate(() => [...document.querySelectorAll('nav.appbar .appbar-item, nav.appbar .appbar-center')]
      .map((b) => getComputedStyle(b).getPropertyValue('-webkit-tap-highlight-color')));
    expect(colores.length).toBe(5);
    for (const c of colores) expect(c).toBe('rgba(0, 0, 0, 0)');
  });
});
