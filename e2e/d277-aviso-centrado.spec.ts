import { expect, test, type Page } from '@playwright/test';
import { ingresar, relojFueraDeLasFechasDeLosViajes } from './_app';

/**
 * D277 · Mati, con una captura de 0.238.1: «No esta centrado el mensaje de “no tienes mesas..”», y eligió «En el
 * medio del espacio vacío». El aviso queda centrado de arriba a abajo en el espacio libre entre lo último de arriba
 * (la última burbuja de viaje o de restaurante pendiente; sin viajes, la tarjeta Ver pagos / Ver perfil) y el borde de
 * arriba de la barra, contando lo que sobresale el círculo de Nueva. Sin espacio suficiente, va debajo del contenido
 * con el aire mínimo, y nada queda tapado. A 375 y 390, con y sin viajes.
 */
const ESTADO_VIAJES = 'payme.app.mock.viajes.estado.v1';
/** El aire mínimo del aviso, arriba y abajo del texto (`.aviso-sin-mesas`, `--sp-6`). */
const AIRE = 24;

async function entrar(page: Page, { viajes }: { viajes: boolean }): Promise<void> {
  if (viajes) {
    await page.addInitScript(() => localStorage.setItem('payme.app.mock.viajes.v1', 'encendido'));
    await relojFueraDeLasFechasDeLosViajes(page);
  }
  await ingresar(page);
}

/**
 * Sin mesas abiertas: el estado del mock, editado y releído (el mock lo lee al cargar). Con Viajes, además sin
 * restaurantes pendientes: D275 §3 (1g, 0.242.1) no muestra el aviso con uno pendiente, y la semilla trae Mariscos El
 * Faro, donde Diego no eligió.
 */
async function sinMesas(page: Page, { viajes }: { viajes: boolean }): Promise<void> {
  // 🔴 0.245.1 · se edita desde `/privacy`, que no carga el mock, y se vuelve a donde estaba: dentro de la app, un pedido
  // del mock que salía en el medio guardaba su memoria encima y la edición se perdía (la clase de `viajes-notas`, 0.244.1).
  const donde = page.url();
  await page.goto('/privacy');
  await expect(page.getByRole('heading', { name: 'Aviso de privacidad' })).toBeVisible();
  await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem('payme_mock_state_v1')!);
    for (const m of st.mesas) m.openedByUser = false;
    st.joinedMesaCodes = [];
    localStorage.setItem('payme_mock_state_v1', JSON.stringify(st));
  });
  if (viajes) {
    await page.evaluate((k) => {
      type Ticket = { id: string; personas: Array<{ listo_en: string | null }> };
      const e = JSON.parse(localStorage.getItem(k)!) as { viajes: Array<{ id: string; tickets: Ticket[] }> };
      const cancun = e.viajes.find((v) => v.id === 'd1000000-0000-4000-8000-000000000001')!;
      for (const p of cancun.tickets.find((x) => x.id === 'd2000000-0000-4000-8000-000000000105')!.personas) {
        p.listo_en = p.listo_en ?? '2026-10-11T01:00:00.000Z';
      }
      localStorage.setItem(k, JSON.stringify(e));
    }, ESTADO_VIAJES);
  }
  await page.goto(donde);
  await expect(page.locator('.aviso-sin-mesas')).toBeVisible();
}

/** Lo que hace falta para ver si está centrado: lo último de arriba que ocupa lugar, el texto y el círculo de Nueva. */
function medir(page: Page) {
  return page.evaluate(() => {
    const aviso = document.querySelector('.aviso-sin-mesas')!;
    const caja = (e: Element) => e.getBoundingClientRect();
    let arriba = aviso.previousElementSibling;
    while (arriba && caja(arriba).height === 0) arriba = arriba.previousElementSibling;
    const titulo = caja(aviso.querySelector('.aviso-sin-mesas-titulo')!);
    const cuerpo = caja(aviso.querySelector('.aviso-sin-mesas-cuerpo')!);
    return {
      ultimo: arriba ? { clase: arriba.className, abajo: caja(arriba).bottom } : null,
      aviso: { arriba: caja(aviso).top },
      texto: { arriba: titulo.top, abajo: cuerpo.bottom, centro: (Math.min(titulo.left, cuerpo.left) + Math.max(titulo.right, cuerpo.right)) / 2 },
      circulo: caja(document.querySelector('.appbar-fab')!).top,
      barra: caja(document.querySelector('.appbar-block')!).top,
      ancho: document.documentElement.clientWidth,
    };
  });
}

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (!dir) return;
  await page.screenshot({ path: `${dir}/d277-${page.viewportSize()!.width}-${nombre}.png` });
}

for (const ancho of [375, 390]) {
  test.describe(`🔴 D277 · a ${ancho}`, () => {
    test.use({ viewport: { width: ancho, height: 812 } });

    for (const caso of [
      { nombre: 'sin viajes (lo último es la tarjeta)', viajes: false, ultimo: 'mounted-card' },
      { nombre: 'con viajes (lo último es el último viaje)', viajes: true, ultimo: 'home-viajes' },
    ] as const) {
      test(`🔴 ${caso.nombre}: el texto, en el medio del espacio libre hasta el círculo de Nueva`, async ({ page }) => {
        await entrar(page, { viajes: caso.viajes });
        await sinMesas(page, { viajes: caso.viajes });
        // Lo que la semilla trae y el prototipo no (la invitación y el aviso de la foto), oculto con CSS: con eso a la
        // vista, a 812 de alto ya no queda espacio libre (es el caso de abajo).
        await expect(page.locator('section[aria-label="Te invitaron"]')).toBeVisible();
        await expect(page.locator('.friend-avatar-notice')).toBeVisible();
        await page.addStyleTag({ content: 'section[aria-label="Te invitaron"], .friend-avatar-notice { display: none !important; }' });
        if (caso.viajes) await expect(page.locator('button.viaje-burbuja').first()).toBeVisible();
        const m = await medir(page);
        // La premisa de la cuenta: el círculo sobresale 26 px de la barra (`.appbar-fab`).
        expect(Math.round(m.barra - m.circulo)).toBe(26);
        expect(m.ultimo, 'hay algo arriba del aviso').not.toBeNull();
        expect(m.ultimo!.clase).toContain(caso.ultimo);
        const libreArriba = m.texto.arriba - m.ultimo!.abajo;
        const libreAbajo = m.circulo - m.texto.abajo;
        test.info().annotations.push({ type: 'espacio', description: `${Math.round(libreArriba)} px arriba y ${Math.round(libreAbajo)} px abajo del texto` });
        // Centrado de arriba a abajo (1 px de redondeo), con espacio de verdad (no el mínimo).
        expect(Math.abs(libreArriba - libreAbajo)).toBeLessThanOrEqual(1);
        expect(libreArriba).toBeGreaterThan(AIRE);
        // Y de izquierda a derecha.
        expect(Math.abs(m.texto.centro - m.ancho / 2)).toBeLessThanOrEqual(1);
        await capturar(page, caso.viajes ? 'con-viajes' : 'sin-viajes');
      });
    }

    for (const [viajes, inset] of [[true, 0], [true, 34], [false, 0]] as const) test(`🔴 sin espacio (${viajes ? 'con viajes, sin pendientes' : 'sin viajes, con la semilla'}, inset de abajo ${inset}): debajo del contenido, con el aire mínimo, y nada queda tapado`, async ({ page, browserName }) => {
      // El iPhone con indicador de inicio: la barra crece (`--appbar-pie`) y el aviso sube con ella. El inset se emula
      // por CDP, que es de Chromium (la suite corre en Chromium); sin `test.skip`, que `corteGuard` no permite.
      if (inset > 0 && browserName === 'chromium') {
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Emulation.setSafeAreaInsetsOverride', {
          insets: { top: 59, topMax: 59, bottom: inset, bottomMax: inset, left: 0, leftMax: 0, right: 0, rightMax: 0 },
        });
      }
      await entrar(page, { viajes });
      await sinMesas(page, { viajes });
      // Con la página llena: la invitación y el aviso de la foto de la semilla se quedan.
      await expect(page.locator('section[aria-label="Te invitaron"]')).toBeVisible();
      await expect(page.locator('.friend-avatar-notice')).toBeVisible();
      const desplazado = await page.locator('.scroll').first().evaluate(async (el) => {
        el.scrollTo(0, el.scrollHeight);
        await new Promise((r) => setTimeout(r, 200));
        return el.scrollTop;
      });
      // Control: si no hubiera nada que desplazar, esta prueba no probaría el caso sin espacio.
      expect(desplazado).toBeGreaterThan(0);
      const m = await medir(page);
      expect(m.ultimo!.clase).toContain(viajes ? 'home-viajes' : 'friend-avatar-notice');
      // Debajo del contenido, sin pisarlo, y el texto con el aire mínimo arriba y abajo hasta el círculo.
      expect(m.aviso.arriba).toBeGreaterThanOrEqual(m.ultimo!.abajo - 0.5);
      expect(Math.round(m.texto.arriba - m.ultimo!.abajo)).toBe(AIRE);
      expect(Math.round(m.circulo - m.texto.abajo)).toBe(AIRE);
      await capturar(page, `sin-espacio-${viajes ? 'viajes' : 'sin-viajes'}-inset-${inset}`);
    });

    test('nunca fijo (D256): se desplaza con el contenido', async ({ page }) => {
      await entrar(page, { viajes: true });
      await sinMesas(page, { viajes: true });
      await expect(page.locator('.aviso-sin-mesas')).not.toHaveCSS('position', 'fixed');
      await expect(page.locator('.aviso-sin-mesas')).not.toHaveCSS('position', 'absolute');
    });
  });
}
