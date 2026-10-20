import { expect, test, type Locator, type Page } from '@playwright/test';
import { abrirMesaConLink, ingresar, type MesaAbierta } from './_app';

/**
 * D372–D374 · «Te invitaron a una mesa», diseño base de Claude Design con las resoluciones de V (0.254.0). Los diez
 * estados de JoinMesaScreen contra el mock: A1, A2, B (alta e ingreso), C, D (con y sin restaurante), E1, E2, E3, F1
 * y F2, en 390 × 844, 375 × 667, en inglés y con el área segura emulada.
 *
 * C, F1 y F2 no los produce el mock: se reemplaza `api.acceptInvitationLink` en la página (el patrón de
 * `puerta-join`) y se navega DENTRO del documento (un `goto` recarga y pierde el reemplazo). Capturas sólo con
 * `PAYME_E2E_CAPTURAS`; `PAYME_E2E_CAPTURAS_SOLO` filtra por nombre. Toda ausencia lleva antes su control positivo.
 */
const NARANJA = 'rgb(240, 112, 60)'; // --brand
const BLANCO = 'rgb(255, 255, 255)'; // --brand-fg y --surface
const NAVY = 'rgb(16, 30, 59)'; // --action
const EXITO = 'rgb(4, 120, 87)'; // --success
const SIGNUP = 'signup-token-link-mesa-aaaaaaaa';
const A_SIN_SESION = '/#/mesa/PA-0001?t=tok-cualquiera-largo';
const A1_TXT = 'Para ver la mesa y pagar tu parte, necesitas una cuenta de PayMe';
const B_ALTA_TXT = 'Crea tu cuenta o entra para sumarte y pagar tu parte.';
const NOTA_E3 = 'Tu cuenta ya está lista — puedes abrir tu propia mesa cuando quieras.';

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (!dir) return;
  const solo = process.env.PAYME_E2E_CAPTURAS_SOLO?.split(',').map((n) => n.trim()).filter(Boolean);
  if (solo && !solo.includes(nombre)) return;
  await page.screenshot({ path: `${dir}/${nombre}.png`, animations: 'disabled' });
}

const titulo = (page: Page, t: string) => page.getByRole('heading', { level: 1, name: t, exact: true });
const tarjeta = (page: Page, t: string) => page.locator('.title-card', { has: titulo(page, t) });
const banda = (page: Page) => page.locator('header.hdr.hdr-compact');
const barra = (page: Page) => page.locator('.link-barra');
const pantalla = (page: Page) => page.locator('.link-screen');

async function caja(l: Locator) {
  const b = await l.boundingBox();
  expect(b, 'el elemento tiene caja').not.toBeNull();
  return b!;
}

/** Espera que terminen las animaciones finitas (la entrada de 200 ms); el aro de C gira para siempre y no cuenta. */
async function quietas(page: Page): Promise<void> {
  await page.evaluate(() => Promise.all(document.getAnimations()
    .filter((a) => a.effect?.getTiming().iterations !== Infinity)
    .map((a) => a.finished.catch(() => undefined))));
}

type Modo = 'normal' | 'colgar' | '503' | 'red';
interface Canje { modo: Modo; llamadas: number; pendientes: Array<() => void> }

async function espiarCanje(page: Page, modo: Modo): Promise<void> {
  await page.evaluate(async (m) => {
    const rutaApi = '/src/api/index.ts';
    const rutaHttp = '/src/api/http.ts';
    const { api } = await import(/* @vite-ignore */ rutaApi) as { api: Record<string, (...a: unknown[]) => Promise<unknown>> };
    const { HttpError } = await import(/* @vite-ignore */ rutaHttp) as { HttpError: new (s: number, b: unknown) => Error };
    const w = window as unknown as { __canje: Canje };
    w.__canje = { modo: m, llamadas: 0, pendientes: [] };
    const original = api.acceptInvitationLink!.bind(api);
    api.acceptInvitationLink = (...args: unknown[]) => {
      w.__canje.llamadas += 1;
      if (w.__canje.modo === 'colgar') {
        return new Promise((res, rej) => { w.__canje.pendientes.push(() => { original(...args).then(res, rej); }); });
      }
      if (w.__canje.modo === '503') return Promise.reject(new HttpError(503, { error: 'invitation_link_unavailable' }));
      if (w.__canje.modo === 'red') return Promise.reject(new TypeError('Failed to fetch'));
      return original(...args);
    };
  }, modo);
}
const canje = (page: Page) => page.evaluate(() => (window as unknown as { __canje: Canje }).__canje.llamadas);
const modoCanje = (page: Page, m: Modo) => page.evaluate((x) => { (window as unknown as { __canje: Canje }).__canje.modo = x; }, m);
const soltarCanje = (page: Page) => page.evaluate(() => {
  (window as unknown as { __canje: Canje }).__canje.pendientes.splice(0).forEach((f) => f());
});

async function getMesaQueFalla(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const rutaApi = '/src/api/index.ts';
    const { api } = await import(/* @vite-ignore */ rutaApi) as { api: Record<string, (...a: unknown[]) => Promise<unknown>> };
    const w = window as unknown as { __getMesa: { fallidas: number } };
    w.__getMesa = { fallidas: 0 };
    api.getMesa = () => {
      w.__getMesa.fallidas += 1;
      return Promise.reject(new TypeError('Failed to fetch'));
    };
  });
}

/** Al link, dentro del documento: un `goto` recargaría y perdería el reemplazo. */
const alLink = (page: Page, m: MesaAbierta) =>
  page.evaluate(([c, t]) => { window.location.hash = `#/mesa/${c}?t=${t}`; }, [m.code, m.token] as const);

/** La capability del alta ya se leyó (con éxito o no): recién ahí el color de «Entrar» es el definitivo. */
async function capacidadLeida(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(async () => {
    const ruta = '/src/api/socialAuth.ts';
    const m = await import(/* @vite-ignore */ ruta) as { socialAuthSnapshot: () => { status: string } };
    return m.socialAuthSnapshot().status;
  })).not.toBe('pending');
}

/** Lo naranja visible (por nombre) y, como control de que el barrido ve colores, los cuadros navy. */
async function colores(page: Page): Promise<{ naranjas: string[]; cuadrosNavy: number }> {
  return page.evaluate(([n, a]) => {
    const visibles = [...document.querySelectorAll<HTMLElement>('body *')].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    return {
      naranjas: visibles.filter((el) => getComputedStyle(el).backgroundColor === n)
        .map((el) => el.getAttribute('aria-label') ?? el.textContent?.trim() ?? ''),
      cuadrosNavy: visibles.filter((el) => el.classList.contains('title-card-cuadro') && getComputedStyle(el).backgroundColor === a).length,
    };
  }, [NARANJA, NAVY] as const);
}

/** Los botones que no llegan a 44 × 44 (en las DOS dimensiones). */
async function toquesChicos(raiz: Locator): Promise<string[]> {
  return raiz.getByRole('button').evaluateAll((bs) => bs.map((b) => {
    const r = b.getBoundingClientRect();
    return { n: b.getAttribute('aria-label') ?? b.textContent ?? '', w: r.width, h: r.height };
  }).filter((x) => x.w < 44 || x.h < 44).map((x) => x.n));
}

/** La barra reducida: abajo de todo, de borde a borde, con su alto; el círculo de 56 montado a −16 y sin nada encima. */
async function medirBarra(page: Page, nombre: string, alto: number) {
  await quietas(page);
  const vp = page.viewportSize()!;
  const [b, c] = await Promise.all([caja(barra(page)), caja(page.getByRole('button', { name: nombre, exact: true }))]);
  expect(Math.abs(b.y + b.height - vp.height), 'pegada abajo').toBeLessThanOrEqual(1);
  expect([Math.round(b.x), Math.round(b.width)], 'de borde a borde').toEqual([0, vp.width]);
  expect(Math.abs(b.height - alto), `alto ${alto}`).toBeLessThanOrEqual(1);
  await expect(barra(page)).toHaveCSS('border-top-left-radius', '24px');
  expect([Math.round(c.width), Math.round(c.height)]).toEqual([56, 56]);
  expect(Math.abs(c.y - b.y + 16), 'el círculo montado a −16').toBeLessThanOrEqual(1);
  const enElCentro = await page.evaluate(([x, y]) =>
    document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label') ?? null,
  [c.x + c.width / 2, c.y + c.height / 2] as const);
  expect(enElCentro, 'nada tapa el círculo').toBe(nombre);
  return b;
}

test.describe('A y B · sin sesión (390 × 844)', () => {
  test('🔴 A1: una tarjeta montada en la banda, dos botones adentro, un solo naranja, sin barra; el logo sigue a mano', async ({ page }) => {
    await page.goto(`${A_SIN_SESION}&signup_invitation=${SIGNUP}`);
    const t = tarjeta(page, 'Te invitaron a una mesa');
    await expect(t.getByText(A1_TXT, { exact: true })).toBeVisible();
    await capacidadLeida(page);
    await quietas(page);
    const botones = t.getByRole('button');
    await expect(botones).toHaveText(['Crear cuenta gratis', 'Ya tengo cuenta · Entrar']);
    await expect(botones.nth(0)).toHaveCSS('background-color', NARANJA);
    await expect(botones.nth(0)).toHaveCSS('color', BLANCO);
    await expect(botones.nth(1)).toHaveCSS('background-color', BLANCO);
    await expect(botones.nth(1)).toHaveCSS('color', NAVY);
    expect((await colores(page)).naranjas).toEqual(['Crear cuenta gratis']);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(t.locator('.title-card-cuadro')).toHaveAttribute('data-icono', 'persona-mas');
    await expect(page.locator('.hdr-compact .hdr-mark')).toHaveCSS('font-size', '22px');
    const [b, c, logo, cuerpo, b1, b2] = await Promise.all([caja(banda(page)), caja(t), caja(page.locator('.hdr-mark-toques')),
      caja(t.getByText(A1_TXT, { exact: true })), caja(botones.nth(0)), caja(botones.nth(1))]);
    expect(Math.round(b.height), 'la banda: 16 + 44 + 16 + 42 (sin área segura)').toBe(118);
    expect(Math.abs(c.y - (b.y + b.height) + 42), 'la tarjeta monta 42 sobre la banda').toBeLessThanOrEqual(1);
    expect([Math.round(c.x), Math.round(c.width)]).toEqual([16, 390 - 32]);
    expect(logo.y + logo.height, 'la tarjeta no tapa el logo').toBeLessThanOrEqual(c.y);
    expect(Math.abs(b1.y - (cuerpo.y + cuerpo.height) - 24), '24 entre el texto y los botones').toBeLessThanOrEqual(1);
    expect(Math.abs(b2.y - (b1.y + b1.height) - 12), '12 entre los botones').toBeLessThanOrEqual(1);
    for (const x of [b1, b2]) expect(x.height).toBeGreaterThanOrEqual(52);
    expect(await toquesChicos(pantalla(page))).toEqual([]);
    // Ausencias, después del control (la tarjeta está): sin barra inferior ni barra reducida.
    await expect(page.getByRole('button', { name: 'Escanear', exact: true })).toHaveCount(0);
    await expect(barra(page)).toHaveCount(0);
    await capturar(page, 'd372-01-a1');
    // El toque oculto del logo sigue: si la tarjeta lo tapara, el clic caería en ella.
    for (let i = 0; i < 5; i += 1) await page.locator('.hdr-mark-toques .hdr-mark').first().click();
    await expect(page.getByRole('dialog', { name: 'Diagnóstico de pantalla' })).toBeVisible();
  });

  test('🔴 A2 (D373): «Ya tengo cuenta · Entrar» solo, en naranja con letra blanca, el único naranja', async ({ page }) => {
    await page.goto(A_SIN_SESION);
    await capacidadLeida(page);
    const entrar = tarjeta(page, 'Te invitaron a una mesa').getByRole('button', { name: 'Ya tengo cuenta · Entrar', exact: true });
    await expect(entrar).toBeVisible();
    await expect(entrar).toHaveCSS('background-color', NARANJA);
    await expect(entrar).toHaveCSS('color', BLANCO); // 2,96:1, riesgo aceptado (D310) y declarado
    await expect(page.getByRole('button', { name: 'Crear cuenta gratis', exact: true })).toHaveCount(0);
    await quietas(page);
    expect((await colores(page)).naranjas).toEqual(['Ya tengo cuenta · Entrar']);
    await capturar(page, 'd372-02-a2');
  });

  test('🔴 D373 · nunca hay dos naranjas: con el alta pública abierta, «Entrar» no pasa por naranja mientras se lee la capability; control: en A2 el mismo espía lo ve', async ({ page }) => {
    // Un espía que, cuadro a cuadro desde que carga la página, anota el color de «Entrar» y cuántos botones naranjas
    // hay a la vez en la pantalla (el máximo de toda la carga).
    const espiarEntrar = () => page.addInitScript((naranja) => {
      const w = window as unknown as { __entrarNaranja: boolean; __entrarVisto: boolean; __maxNaranjas: number };
      w.__entrarNaranja = false;
      w.__entrarVisto = false;
      w.__maxNaranjas = 0;
      const mirar = () => {
        const botones = [...document.querySelectorAll('button')];
        const boton = botones.find((b) => b.textContent?.trim() === 'Ya tengo cuenta · Entrar');
        if (boton) {
          w.__entrarVisto = true;
          if (getComputedStyle(boton).backgroundColor === naranja) w.__entrarNaranja = true;
        }
        const naranjas = botones.filter((b) => getComputedStyle(b).backgroundColor === naranja).length;
        w.__maxNaranjas = Math.max(w.__maxNaranjas, naranjas);
        requestAnimationFrame(mirar);
      };
      requestAnimationFrame(mirar);
    }, NARANJA);
    const espia = () => page.evaluate(() => {
      const w = window as unknown as { __entrarNaranja: boolean; __entrarVisto: boolean; __maxNaranjas: number };
      return { visto: w.__entrarVisto, naranja: w.__entrarNaranja, maxNaranjas: w.__maxNaranjas };
    });
    await page.addInitScript(() => localStorage.setItem('payme.app.mock.public_signup.v1', 'true'));
    await espiarEntrar();
    await page.goto(A_SIN_SESION);
    await expect(page.getByRole('button', { name: 'Crear cuenta gratis', exact: true })).toBeVisible();
    await capacidadLeida(page);
    await quietas(page);
    expect(await espia()).toEqual({ visto: true, naranja: false, maxNaranjas: 1 });
    // Control positivo del espía: sin alta, el mismo espía ve el naranja. Se recarga (el espía arranca de nuevo); la
    // custodia vuelve a montar A.
    await page.addInitScript(() => localStorage.setItem('payme.app.mock.public_signup.v1', 'false'));
    await page.reload();
    await capacidadLeida(page);
    await expect(page.getByRole('button', { name: 'Ya tengo cuenta · Entrar', exact: true })).toHaveCSS('background-color', NARANJA);
    expect(await espia()).toEqual({ visto: true, naranja: true, maxNaranjas: 1 });
  });

  test('🔴 B alta (D374): la tarjeta suelta arriba, sin banda propia, a 16; el formulario de siempre debajo', async ({ page }) => {
    await page.goto(`${A_SIN_SESION}&signup_invitation=${SIGNUP}`);
    await page.getByRole('button', { name: 'Crear cuenta gratis', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Registrarme', exact: true })).toBeVisible();
    const t = tarjeta(page, 'Te invitaron a una mesa');
    await expect(t.getByText(B_ALTA_TXT, { exact: true })).toBeVisible();
    await expect(page.locator('.ingreso-hero')).toBeVisible();
    await quietas(page);
    // Ausencias con control: la tarjeta está, sin botones ni rótulos de formulario adentro, y sin la banda compacta.
    await expect(t.getByRole('button')).toHaveCount(0);
    await expect(t.getByRole('textbox')).toHaveCount(0);
    await expect(page.locator('header.hdr')).toHaveCount(0);
    await expect(t).toHaveCSS('box-shadow', 'rgba(16, 30, 59, 0.06) 0px 2px 8px 0px'); // --sh-2, la de 2s
    const [c, ingreso] = await Promise.all([caja(t), caja(page.locator('.ingreso'))]);
    expect([Math.round(c.x), Math.round(c.y), Math.round(c.width)]).toEqual([16, 16, 390 - 32]);
    expect(Math.abs(ingreso.y - (c.y + c.height) - 16), '16 hasta el formulario').toBeLessThanOrEqual(1);
    await capturar(page, 'd372-03-b-alta');
  });

  test('B ingreso: la tarjeta con el texto de A, sobre «Log in»', async ({ page }) => {
    await page.goto(A_SIN_SESION);
    await page.getByRole('button', { name: 'Ya tengo cuenta · Entrar', exact: true }).click();
    await expect(page.getByText('Log in', { exact: true })).toBeVisible();
    await expect(tarjeta(page, 'Te invitaron a una mesa').getByText(A1_TXT, { exact: true })).toBeVisible();
    await capturar(page, 'd372-04-b-ingreso');
  });
});

test.describe('C, D, E y F · con sesión (390 × 844)', () => {
  test('🔴 C: el aro dentro del cuadro navy, sin controles ni naranja; al soltar el canje, consumos directos', async ({ page }) => {
    await ingresar(page);
    const mesa = await abrirMesaConLink(page);
    await espiarCanje(page, 'colgar');
    await alLink(page, mesa);
    const t = tarjeta(page, 'Sumándote a la mesa…');
    await expect(t.getByRole('progressbar', { name: 'Sumándote a la mesa…' })).toBeVisible();
    await expect(t.getByText('Un segundo.', { exact: true })).toBeVisible();
    await expect(t).toHaveAttribute('aria-busy', 'true');
    expect(await canje(page), 'control: el canje está en vuelo').toBeGreaterThan(0);
    await quietas(page);
    const c = await colores(page);
    expect(c.cuadrosNavy, 'control: el barrido ve el cuadro navy del aro').toBe(1);
    expect(c.naranjas).toEqual([]);
    await expect(pantalla(page).getByRole('button')).toHaveCount(0);
    await expect(barra(page)).toHaveCount(0);
    await capturar(page, 'd372-05-c');
    await soltarCanje(page);
    await expect(page.getByRole('heading', { name: /^(Tu mesa|¿Qué consumiste\?)$/ })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/mesa/${mesa.code}$`));
  });

  test('C con «reducir movimiento»: el aro quieto (y sin reducir, gira)', async ({ page }) => {
    await ingresar(page);
    const mesa = await abrirMesaConLink(page);
    await espiarCanje(page, 'colgar');
    await alLink(page, mesa);
    const aro = page.getByRole('progressbar', { name: 'Sumándote a la mesa…' });
    await expect(aro).toBeVisible();
    expect(await aro.evaluate((el) => getComputedStyle(el).animationName), 'control: gira').toBe('spin');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect.poll(() => aro.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
    // La tarjeta entra sólo con opacidad.
    expect(await page.locator('.link-screen > .title-card').evaluate((el) => getComputedStyle(el).animationName)).toBe('link-entra-quieta');
  });

  test('🔴 D387 con restaurante: llega al detalle y muestra el aviso blanco sin confirmación intermedia', async ({ page }) => {
    await ingresar(page);
    const mesa = await abrirMesaConLink(page);
    await page.goto(`/#/mesa/${mesa.code}?t=${mesa.token}`);
    await expect(page.getByRole('heading', { name: /^(Tu mesa|¿Qué consumiste\?)$/ })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/mesa/${mesa.code}$`));
    const aviso = page.locator('.toast[role="status"]');
    await expect(aviso).toHaveText('Te sumaste a La Parolaccia');
    await expect(aviso).toHaveCSS('background-color', BLANCO);
    await expect(aviso.locator('.toast-ingreso-icono')).toHaveCSS('background-color', EXITO);
    await expect(page.getByRole('button', { name: 'Listo', exact: true })).toBeVisible();
    await capturar(page, 'd387-con-nombre');
  });

  test('D387 sin detalle: llega a la ruta y usa el aviso genérico, sin otro GET de Join', async ({ page }) => {
    await ingresar(page);
    const mesa = await abrirMesaConLink(page);
    await getMesaQueFalla(page);
    await alLink(page, mesa);
    await expect(page.getByText('No encontramos esta mesa. Puede que el link haya vencido o que ya se haya cerrado la cuenta.')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/mesa/${mesa.code}$`));
    await expect(page.locator('.toast[role="status"]')).toHaveText('Te sumaste a la mesa');
    expect(await page.evaluate(() => (window as unknown as { __getMesa: { fallidas: number } }).__getMesa.fallidas)).toBe(2);
    await capturar(page, 'd387-sin-nombre');
  });

  for (const [id, ruta, tit, cuerpo] of [
    ['08-e1', '/#/mesa/PA-0001?t=tok-inventado-por-cualquiera', 'Este link ya no funciona', 'Pídele a quien te invitó que te comparta uno nuevo.'],
    ['09-e2', '/#/mesa/PA-0001?t=corto', 'Este link está incompleto', 'Puede haberse cortado al copiarlo. Pide que te lo manden de nuevo y ábrelo entero.'],
  ] as const) {
    test(`${id}: «${tit}», el link cortado, un solo control (el círculo «Ir a PayMe»), sin «Reintentar»`, async ({ page }) => {
      await ingresar(page);
      await page.goto(ruta);
      const t = tarjeta(page, tit);
      await expect(t.getByText(cuerpo, { exact: true })).toBeVisible();
      await expect(t.locator('.title-card-cuadro')).toHaveAttribute('data-icono', 'link-cortado');
      const b = await medirBarra(page, 'Ir a PayMe', 64);
      const ct = await caja(t);
      expect(ct.y + ct.height).toBeLessThanOrEqual(b.y);
      await expect(pantalla(page).getByRole('button')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Reintentar', exact: true })).toHaveCount(0);
      expect((await colores(page)).naranjas).toEqual(['Ir a PayMe']);
      await capturar(page, `d372-${id}`);
    });
  }

  test('E3: la tienda, la nota FUERA de la tarjeta, centrada y arriba de la barra; el círculo lleva a Inicio', async ({ page }) => {
    await ingresar(page);
    const mesa = await abrirMesaConLink(page);
    await page.evaluate(async (code) => {
      const ruta = '/src/api/mock/store.ts';
      const { state, persist } = await import(/* @vite-ignore */ ruta) as {
        state: { mesas: Array<{ code: string; status: string }> };
        persist: () => void;
      };
      state.mesas.find((m) => m.code === code)!.status = 'settled';
      persist();
    }, mesa.code);
    await page.goto(`/#/mesa/${mesa.code}?t=${mesa.token}`);
    const t = tarjeta(page, 'Esta mesa ya cerró');
    await expect(t.locator('.title-card-cuadro')).toHaveAttribute('data-icono', 'tienda');
    const nota = page.getByText(NOTA_E3, { exact: true });
    await expect(nota).toBeVisible();
    await expect(t.getByText(NOTA_E3, { exact: true })).toHaveCount(0);
    await expect(nota).toHaveCSS('text-align', 'center');
    const b = await medirBarra(page, 'Ir a PayMe', 64);
    const cn = await caja(nota);
    expect(cn.y + cn.height).toBeLessThanOrEqual(b.y);
    await capturar(page, 'd372-10-e3');
    await page.getByRole('button', { name: 'Ir a PayMe', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Escanear', exact: true })).toBeVisible();
  });

  for (const [id, modo, tit] of [['11-f1', '503', 'No pudimos verificar el link'], ['12-f2', 'red', 'No pudimos sumarte']] as const) {
    test(`${id}: «Reintentar» con borde DENTRO de la tarjeta, sin barra ni naranja; reintentar canjea una vez`, async ({ page }) => {
      await ingresar(page);
      const mesa = await abrirMesaConLink(page);
      await espiarCanje(page, modo);
      await alLink(page, mesa);
      const t = tarjeta(page, tit);
      const reintentar = t.getByRole('button', { name: 'Reintentar', exact: true });
      await expect(reintentar).toBeVisible();
      await expect(t.locator('.title-card-cuadro')).toHaveAttribute('data-icono', 'reintentar');
      await expect(reintentar).toHaveCSS('background-color', BLANCO);
      await quietas(page);
      const c = await colores(page);
      expect(c.cuadrosNavy, 'control: el barrido ve el cuadro navy').toBe(1);
      expect(c.naranjas).toEqual([]);
      await expect(barra(page)).toHaveCount(0);
      await capturar(page, `d372-${id}`);
      const antes = await canje(page);
      await modoCanje(page, 'normal');
      await reintentar.click();
      await expect(page.getByRole('heading', { name: /^(Tu mesa|¿Qué consumiste\?)$/ })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/mesa/${mesa.code}$`));
      expect(await canje(page)).toBe(antes + 1);
    });
  }
});

test.describe('375 × 667', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('A1 entra entera', async ({ page }) => {
    await page.goto(`${A_SIN_SESION}&signup_invitation=${SIGNUP}`);
    const t = tarjeta(page, 'Te invitaron a una mesa');
    await expect(t.getByRole('button', { name: 'Crear cuenta gratis', exact: true })).toBeVisible();
    await quietas(page);
    await expect(t).toBeInViewport({ ratio: 1 });
    for (const n of ['Crear cuenta gratis', 'Ya tengo cuenta · Entrar']) {
      await expect(t.getByRole('button', { name: n, exact: true })).toBeInViewport({ ratio: 1 });
    }
    await capturar(page, 'd372-13-a1-375');
  });

  test('B alta: la tarjeta queda fija arriba cuando el formulario se desplaza (adenda c)', async ({ page }) => {
    await page.goto(`${A_SIN_SESION}&signup_invitation=${SIGNUP}`);
    await page.getByRole('button', { name: 'Crear cuenta gratis', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Registrarme', exact: true })).toBeVisible();
    const t = tarjeta(page, 'Te invitaron a una mesa');
    await quietas(page);
    const antes = (await caja(t)).y;
    const desplazado = await page.locator('.ingreso').evaluate((el) => { el.scrollTop = 400; return el.scrollTop; });
    expect(desplazado, 'control: el formulario se desplaza').toBeGreaterThan(0);
    expect((await caja(t)).y).toBe(antes);
    await page.locator('.ingreso').evaluate((el) => { el.scrollTop = 0; });
    await capturar(page, 'd372-14-b-alta-375');
  });

  test('E2 en inglés: el texto más largo, sin pasar abajo de la barra', async ({ page }) => {
    await ingresar(page);
    // El idioma se lee al cargar: después de `ingresar` (sus rótulos están en español), se recarga.
    await page.evaluate(() => localStorage.setItem('payme.app.idioma.v1', 'en'));
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await page.evaluate(() => { window.location.hash = '#/mesa/PA-0001?t=corto'; });
    const t = tarjeta(page, 'This link is incomplete');
    await expect(t.getByText('It may have gotten cut off when copied. Ask them to send it again and open it in full.', { exact: true })).toBeVisible();
    await expect(page.getByText('Este link está incompleto', { exact: true })).toHaveCount(0);
    const b = await medirBarra(page, 'Go to PayMe', 64);
    const ct = await caja(t);
    expect(ct.y + ct.height).toBeLessThanOrEqual(b.y);
    await capturar(page, 'd372-15-e2-en-375');
  });
});

test.describe('inglés (390 × 844)', () => {
  test('A1: los botones largos no se cortan (pasan a dos renglones si hace falta)', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('payme.app.idioma.v1', 'en'));
    await page.goto(`${A_SIN_SESION}&signup_invitation=${SIGNUP}`);
    const t = tarjeta(page, "You've been invited to a table");
    await expect(t.getByRole('button', { name: 'I already have an account · Log in', exact: true })).toBeVisible();
    const cortados = await t.getByRole('button').evaluateAll((bs) => bs.filter((b) => b.scrollWidth > b.clientWidth).length);
    expect(cortados).toBe(0);
    await capturar(page, 'd372-16-a1-en');
  });

  test('🔴 F1 pasa por t(): «We couldn\'t verify the link» y «Retry»', async ({ page }) => {
    await ingresar(page);
    const mesa = await abrirMesaConLink(page);
    await page.evaluate(() => localStorage.setItem('payme.app.idioma.v1', 'en'));
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await espiarCanje(page, '503');
    await alLink(page, mesa);
    const t = tarjeta(page, "We couldn't verify the link");
    await expect(t.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
    await expect(page.getByText('No pudimos verificar el link', { exact: true })).toHaveCount(0);
    await capturar(page, 'd372-17-f1-en');
  });
});

test.describe('área segura (CDP)', () => {
  test('la banda crece exactamente lo que el inset de arriba y el logo queda debajo', async ({ page }) => {
    await page.goto(A_SIN_SESION);
    await expect(titulo(page, 'Te invitaron a una mesa')).toBeVisible();
    const sin = (await caja(banda(page))).height;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: {
      top: 47, topMax: 47, bottom: 34, bottomMax: 34, left: 0, leftMax: 0, right: 0, rightMax: 0,
    } });
    await page.reload();
    await expect(titulo(page, 'Te invitaron a una mesa')).toBeVisible();
    expect(Math.abs((await caja(banda(page))).height - sin - 47)).toBeLessThanOrEqual(1);
    expect((await caja(page.locator('.hdr-mark-toques'))).y).toBeGreaterThanOrEqual(47);
  });

  test('la barra reducida sigue la regla del área segura de la barra principal (56 + inset − 12)', async ({ page }) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: {
      top: 0, topMax: 0, bottom: 34, bottomMax: 34, left: 0, leftMax: 0, right: 0, rightMax: 0,
    } });
    await ingresar(page);
    await page.goto('/#/mesa/PA-0001?t=tok-inventado-por-cualquiera');
    await expect(titulo(page, 'Este link ya no funciona')).toBeVisible();
    await medirBarra(page, 'Ir a PayMe', 56 + 34 - 12);
  });
});
