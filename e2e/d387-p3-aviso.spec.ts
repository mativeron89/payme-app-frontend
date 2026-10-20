import { expect, test, type Page } from '@playwright/test';
import { abrirMesaConLink, ingresar, type MesaAbierta } from './_app';

const aviso = (page: Page) => page.locator('.toast[role="status"]');
const detalle = (page: Page) => page.getByRole('heading', { name: /^(Tu mesa|¿Qué consumiste\?)$/ });
const alLink = (page: Page, mesa: MesaAbierta) => page.evaluate(([c, t]) => {
  window.location.hash = `#/mesa/${c}?t=${t}`;
}, [mesa.code, mesa.token] as const);

interface Sonda {
  canjes: number;
  detalles: Array<{ code: string; custodia: string | null; url: string }>;
  soltarCanje: () => void;
  soltarDetalle: () => void;
  modo: 'retenido' | 'normal' | 'nombre-vacio' | 'error' | 'detalle-retenido';
}

/** Costura sólo del test: usa las fachadas/fixtures existentes, nunca red real. */
async function instrumentar(page: Page, modo: Sonda['modo'], codeDevuelto?: string) {
  await page.evaluate(async ({ modo, codeDevuelto }) => {
    const ruta = '/src/api/index.ts';
    const { api } = await import(/* @vite-ignore */ ruta) as {
      api: {
        acceptInvitationLink: (token: string) => Promise<{ joined: true; mesa_code: string }>;
        getMesa: (code: string) => Promise<{ mesa: { code: string; my_role: string; restaurant: { name: string } } }>;
      };
    };
    const w = window as unknown as { __p3: Sonda };
    w.__p3 = { modo, canjes: 0, detalles: [], soltarCanje: () => undefined, soltarDetalle: () => undefined };
    const aceptar = api.acceptInvitationLink.bind(api);
    const getMesa = api.getMesa.bind(api);
    let codeOriginal: string | undefined;
    api.acceptInvitationLink = async (token) => {
      w.__p3.canjes += 1;
      if (w.__p3.modo === 'retenido') await new Promise<void>((r) => { w.__p3.soltarCanje = r; });
      const r = await aceptar(token);
      codeOriginal = r.mesa_code;
      return codeDevuelto ? { ...r, mesa_code: codeDevuelto } : r;
    };
    api.getMesa = async (code) => {
      w.__p3.detalles.push({ code, custodia: sessionStorage.getItem('payme_pending_invitation_link'), url: location.href });
      if (w.__p3.modo === 'detalle-retenido') await new Promise<void>((r) => { w.__p3.soltarDetalle = r; });
      if (w.__p3.modo === 'error') throw new TypeError('detalle sintético no disponible');
      const r = await getMesa(codeDevuelto && code === codeDevuelto ? codeOriginal! : code);
      return { ...r, mesa: { ...r.mesa, code, my_role: 'participant', restaurant: { ...r.mesa.restaurant, name: w.__p3.modo === 'nombre-vacio' ? '  ' : r.mesa.restaurant.name } } };
    };
  }, { modo, codeDevuelto });
}

const sonda = (page: Page) => page.evaluate(() => {
  const { canjes, detalles } = (window as unknown as { __p3: Sonda }).__p3;
  return { canjes, detalles };
});

test('D387 · ToastProvider real: 3000/120, defaults 2400, timer/variante/gesto reemplazados y swipe local', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  await page.evaluate(async () => {
    // Resolver las URLs EXACTAS transformadas por este servidor: con cacheDir
    // propio, usar /node_modules/.vite crearía una segunda copia de React.
    const uiPath = '/src/components/ui.tsx';
    const uiSource = await (await fetch(uiPath)).text();
    const mainSource = await (await fetch('/src/main.tsx')).text();
    const reactPath = /from\s*["']([^"']*\/react\.js(?:\?[^"']*)?)["']/.exec(uiSource)?.[1];
    const domPath = /from\s*["']([^"']*\/react-dom_client\.js(?:\?[^"']*)?)["']/.exec(mainSource)?.[1];
    if (!reactPath || !domPath) throw new Error('No se encontraron las dependencias transformadas de este runtime');
    const React = (await import(/* @vite-ignore */ reactPath) as { default: typeof import('react') }).default;
    const { createRoot } = (await import(/* @vite-ignore */ domPath) as { default: typeof import('react-dom/client') }).default;
    const { ToastProvider, useToast } = await import(/* @vite-ignore */ uiPath) as typeof import('../src/components/ui');
    function Probe() {
      (window as unknown as { __p3Toast: ReturnType<typeof useToast> }).__p3Toast = useToast();
      return React.createElement('div', { className: 'hdr-flow', style: { position: 'fixed', top: 0, left: 0, right: 0 } }, React.createElement('div', { className: 'hdr-row-2' }, 'Volver'));
    }
    const host = document.createElement('div');
    host.id = 'p3-probe';
    document.body.append(host);
    createRoot(host).render(React.createElement(ToastProvider, null, React.createElement(Probe)));
  });
  const status = page.locator('#p3-probe .toast');
  await expect(status).toHaveCount(1);
  const nodo = await status.elementHandle();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 100));
  const mostrar = (texto: string, opciones?: { ingresoAMesa?: boolean; sobreLaBarra?: boolean }) => page.evaluate(({ texto, opciones }) => {
    (window as unknown as { __p3Toast: (m: string, o?: typeof opciones) => void }).__p3Toast(texto, opciones);
  }, { texto, opciones });
  await mostrar('Ingreso sintético', { ingresoAMesa: true });
  await expect(status).toBeVisible();
  await page.clock.runFor(2990);
  await expect(status).toBeVisible();
  await page.clock.runFor(10);
  await expect(status).toHaveClass(/toast--saliendo/);
  await page.clock.runFor(120);
  await expect(status).toBeHidden();
  await mostrar('Ingreso siguiente', { ingresoAMesa: true });
  await expect(status).toHaveText('Ingreso siguiente');
  await page.clock.runFor(2000);
  await mostrar('Aviso común', { sobreLaBarra: true });
  await expect(status).toHaveClass(/toast--sobre-barra/);
  await expect(status).not.toHaveClass(/toast--ingreso-mesa|toast--saliendo/);
  await expect(page.locator('[data-ingreso-con-reserva]')).toHaveCount(0);
  await page.clock.runFor(1200); // el timer viejo de P-3 ya habría vencido
  await expect(status).toHaveText('Aviso común');
  await page.clock.runFor(1199);
  await expect(status).toBeVisible();
  await page.clock.runFor(1);
  await expect(status).toBeHidden();
  await mostrar('Deslizar arriba', { ingresoAMesa: true });
  await expect(status).toBeVisible();
  await page.clock.runFor(200);
  const caja = await status.boundingBox();
  const x = caja!.x + caja!.width / 2;
  const y = caja!.y + caja!.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 45, { steps: 5 });
  await page.mouse.up();
  await page.clock.runFor(120);
  await expect(status).toBeHidden();
  expect(await nodo!.evaluate((el) => el === document.querySelector('#p3-probe .toast'))).toBe(true);
  await mostrar('Default inferior');
  await expect(status).not.toHaveClass(/toast--sobre-barra|toast--ingreso-mesa/);
  await expect(page.locator('[data-ingreso-con-reserva]')).toHaveCount(0);
  await expect(status).toHaveCSS('bottom', '24px');
  await page.clock.runFor(2400);
  await expect(status).toBeHidden();
  await mostrar('Salida reemplazada', { ingresoAMesa: true });
  await expect(status).toHaveText('Salida reemplazada');
  await page.clock.runFor(3000);
  await expect(status).toHaveClass(/toast--saliendo/);
  await mostrar('Durante la salida');
  await expect(status).toHaveText('Durante la salida');
  await page.clock.runFor(120); // la salida anterior tampoco puede ocultar el siguiente
  await expect(status).toBeVisible();
  await page.clock.runFor(2280);
  await expect(status).toBeHidden();
});

test('D387 · 200 retenido no revela detalle; cierra ambas custodias antes de salir y usa el código devuelto', async ({ page }) => {
  await ingresar(page);
  const mesa = await abrirMesaConLink(page, { modo: 'consumo' });
  await instrumentar(page, 'retenido', 'P3-DEVUELTO');
  const nodo = await aviso(page).elementHandle();
  await alLink(page, mesa);
  await expect(page.getByRole('heading', { name: 'Sumándote a la mesa…' })).toBeVisible();
  expect((await sonda(page)).detalles).toEqual([]);
  await expect(aviso(page)).toHaveText('');
  await page.evaluate(() => (window as unknown as { __p3: Sonda }).__p3.soltarCanje());
  await expect(detalle(page)).toHaveText('¿Qué consumiste?');
  await expect(page).toHaveURL(/\/mesa\/P3-DEVUELTO$/);
  await expect(aviso(page)).toHaveText('Te sumaste a La Parolaccia');
  expect(await nodo!.evaluate((el) => el === document.querySelector('.toast[role="status"]'))).toBe(true);
  const r = await sonda(page);
  // StrictMode ejecuta dos veces el reload existente; el anterior queda invalidado.
  expect(r.detalles).toEqual(Array.from({ length: 2 }, () => ({ code: 'P3-DEVUELTO', custodia: null, url: page.url() })));
  expect(await page.evaluate(() => [
    'payme_pending_invitation_link', 'payme.app.retorno_mesa.v1', 'payme.app.retorno_mesa_modo.v1', 'payme.app.google_salida.v1',
  ].map((k) => sessionStorage.getItem(k)))).toEqual([null, null, null, null]);
  await expect(page.getByRole('button', { name: 'Tagliatelle Bolognese' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Listo', exact: true })).toBeVisible();
  await expect(page.locator('[data-guia-overlay]')).toHaveCount(0);
  await aviso(page).getByRole('button').click();
  await expect(aviso(page)).toBeHidden();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(async () => (await sonda(page)).detalles.length).toBeGreaterThan(r.detalles.length);
  await expect(aviso(page)).toHaveText('');
  expect((await sonda(page)).canjes).toBe(r.canjes);
});

for (const almacenamiento of ['lanza', 'no-persiste'] as const) {
  test(`D387 · storage ${almacenamiento}: mismo destino y EVENTO_RUTA, sin perder custodia antes del canje`, async ({ page }) => {
    await ingresar(page);
    const mesa = await abrirMesaConLink(page, { modo: 'consumo' });
    await instrumentar(page, 'retenido');
    await page.evaluate((modo) => {
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k: string, v: string) {
        if (this === sessionStorage && k === 'payme_pending_invitation_link') {
          if (modo === 'lanza') throw new DOMException('cuota sintética', 'QuotaExceededError');
          return;
        }
        set.call(this, k, v);
      };
    }, almacenamiento);
    await alLink(page, mesa);
    await expect(page.getByRole('heading', { name: 'Sumándote a la mesa…' })).toBeVisible();
    expect(page.url()).toContain(mesa.token);
    expect((await sonda(page)).detalles).toEqual([]);
    await page.evaluate(() => (window as unknown as { __p3: Sonda }).__p3.soltarCanje());
    await expect(detalle(page)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/mesa/${mesa.code}$`));
    await expect(aviso(page)).toHaveText('Te sumaste a La Parolaccia');
    expect((await sonda(page)).detalles.every((d) => d.custodia === null && !d.url.includes('?t='))).toBe(true);
  });
}

for (const modo of ['nombre-vacio', 'error'] as const) {
  test(`D387 · ${modo}: fallback único sin GET adicional ni reaviso al recargar`, async ({ page }) => {
    await ingresar(page);
    const mesa = await abrirMesaConLink(page, { modo: 'consumo' });
    await instrumentar(page, modo);
    await alLink(page, mesa);
    if (modo === 'error') await expect(page.getByText('No encontramos esta mesa. Puede que el link haya vencido o que ya se haya cerrado la cuenta.')).toBeVisible();
    else await expect(detalle(page)).toBeVisible();
    await expect(aviso(page)).toHaveText('Te sumaste a la mesa');
    expect((await sonda(page)).detalles).toHaveLength(2);
    await page.reload();
    await expect(detalle(page)).toBeVisible();
    await expect(aviso(page)).toHaveText('');
  });
}

test('D387 · abandonar mientras llega el nombre descarta la respuesta, también al volver con Back', async ({ page }) => {
  await ingresar(page);
  const mesa = await abrirMesaConLink(page, { modo: 'consumo' });
  await instrumentar(page, 'detalle-retenido');
  await alLink(page, mesa);
  await expect(page.getByText('Cargando mesa…')).toBeVisible();
  await expect.poll(async () => (await sonda(page)).detalles.length).toBe(2);
  await page.evaluate(async () => {
    const ruta = '/src/router.ts';
    const { navigate } = await import(/* @vite-ignore */ ruta) as { navigate: (page: string) => void };
    navigate('home');
  });
  await expect(page.getByRole('button', { name: 'Escanear', exact: true })).toBeVisible();
  await page.evaluate(() => {
    const s = (window as unknown as { __p3: Sonda }).__p3;
    s.modo = 'normal';
    s.soltarDetalle();
  });
  await expect(aviso(page)).toHaveText('');
  await page.goBack();
  await expect(detalle(page)).toBeVisible();
  await expect(aviso(page)).toHaveText('');
});

for (const [idioma, width, height] of [['es', 390, 844], ['en', 375, 667]] as const) {
  test(`D387 · geometría ${idioma} ${width}×${height}, nombre largo, descarte y región persistente`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await ingresar(page);
    const mesa = await abrirMesaConLink(page, { modo: 'consumo' });
    if (idioma === 'en') {
      await page.evaluate(() => localStorage.setItem('payme.app.idioma.v1', 'en'));
      await page.goto('/');
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await expect(page.getByRole('button', { name: 'Scan', exact: true })).toBeVisible();
    }
    await instrumentar(page, 'normal');
    await page.evaluate(async () => {
      const ruta = '/src/api/mock/store.ts';
      const { state, persist } = await import(/* @vite-ignore */ ruta) as { state: { mesas: Array<{ restaurant: { name: string } }> }; persist: () => void };
      state.mesas.forEach((m) => { m.restaurant.name = 'Restaurante de prueba Los Sabores del Parque y la Plaza Central'; });
      persist();
    });
    await page.emulateMedia({ reducedMotion: idioma === 'en' ? 'reduce' : 'no-preference' });
    await alLink(page, mesa);
    await expect(aviso(page)).toContainText(idioma === 'en' ? 'You joined ' : 'Te sumaste a ');
    if (idioma === 'en') await page.addStyleTag({ content: '.toast-ingreso-contenido { font-size:24px; line-height:1.4 } .hdr-flow { padding-top:39px; height:179px }' });
    // ResizeObserver entrega tras el layout. Esperar la relación visible,
    // también cuando una regla cambia sólo la posición de la fila observada.
    await expect.poll(() => page.evaluate(() => {
      const toast = document.querySelector('.toast')!.getBoundingClientRect();
      const volver = document.querySelector('.hdr-row-2')!.getBoundingClientRect();
      return Math.round(toast.top - volver.bottom);
    })).toBe(12);
    await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined))));
    const geometria = await page.evaluate(() => {
      const rect = (selector: string) => {
        const r = document.querySelector(selector)!.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom, right: r.right };
      };
      const boton = document.querySelector<HTMLButtonElement>('.qc-lista .qc-fila')!;
      const r = boton.getBoundingClientRect();
      const circulo = boton.querySelector('.qc-circulo')!.getBoundingClientRect();
      const puntos = [
        { x: r.x + 3, y: r.y + 3 },
        { x: r.x + r.width / 2, y: r.y + 3 },
        { x: circulo.x + circulo.width / 2, y: circulo.y + circulo.height / 2 },
        { x: r.x + r.width - 3, y: r.bottom - 3 },
      ].map((p) => ({ ...p, alcanzaBoton: boton.contains(document.elementFromPoint(p.x, p.y)) }));
      return { aviso: rect('.toast'), volver: rect('.hdr-row-2'), logo: rect('.hdr-row'), barra: rect('.appbar'), listo: rect('.appbar-fab'), primeraFila: rect('.qc-lista .qc-fila'), circulo: rect('.qc-lista .qc-fila .qc-circulo'), primeraEsBoton: boton.tagName === 'BUTTON', puntos, reserva: rect('.toast-ingreso-reserva').height, viewport: innerWidth, animation: getComputedStyle(document.querySelector('.toast')!).animationName };
    });
    await testInfo.attach('geometria', { body: JSON.stringify(geometria, null, 2), contentType: 'application/json' });
    // El workflow conserva logs, pero no sube el HTML/JSON de Playwright.
    // Duplicar esta fixture sintética permite recuperar la medición del CI.
    console.log('P3_GEOMETRIA_JSON ' + JSON.stringify({ idioma, ...geometria }));
    expect(geometria.aviso.x).toBe(16);
    expect(geometria.aviso.right).toBe(width - 16);
    expect(geometria.aviso.y - geometria.volver.bottom).toBeCloseTo(12, 0);
    expect(geometria.aviso.y).toBeGreaterThan(geometria.logo.bottom);
    expect(geometria.aviso.bottom).toBeLessThan(geometria.barra.y);
    expect(geometria.aviso.bottom).toBeLessThan(geometria.listo.y);
    expect(geometria.primeraEsBoton).toBe(true);
    expect(geometria.primeraFila.y).toBeGreaterThanOrEqual(geometria.aviso.bottom);
    expect(geometria.circulo.y).toBeGreaterThanOrEqual(geometria.aviso.bottom);
    expect(geometria.puntos.every((p) => p.alcanzaBoton)).toBe(true);
    expect(geometria.reserva).toBe(Math.max(0, Math.ceil(geometria.aviso.bottom - (geometria.primeraFila.y - geometria.reserva))));
    if (idioma === 'en') expect(geometria.reserva).toBeGreaterThan(0);
    // Dos frames adicionales no pueden volver a sumar el ajuste ya aplicado.
    const estable = await page.evaluate(() => new Promise<number>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(document.querySelector('.toast-ingreso-reserva')!.getBoundingClientRect().height)))));
    expect(estable).toBe(geometria.reserva);
    expect(geometria.animation).toBe(idioma === 'en' ? 'toast-ingreso-opacity-in' : 'toast-ingreso-in');
    if (process.env.PAYME_P3_CAPTURAS) await page.screenshot({ path: `${process.env.PAYME_P3_CAPTURAS}/p3-${process.env.PAYME_P3_RUN}-${idioma}-${width}.png` });
    const cerrar = aviso(page).getByRole('button');
    expect(await cerrar.evaluate((el) => el.contains(document.activeElement))).toBe(false);
    await cerrar.focus(); // sólo el test mueve foco; el producto no lo roba
    await page.keyboard.press(idioma === 'en' ? 'Space' : 'Enter');
    await expect(aviso(page)).toBeHidden();
    await expect(page.locator('[data-ingreso-con-reserva]')).toHaveCount(0);
    const trasDescarte = await page.evaluate(() => ({
      reserva: document.querySelector('.toast-ingreso-reserva')!.getBoundingClientRect().height,
      primeraY: document.querySelector('.qc-lista .qc-fila')!.getBoundingClientRect().top,
    }));
    expect(trasDescarte.reserva).toBe(0);
    expect(trasDescarte.primeraY).toBeCloseTo(geometria.primeraFila.y - geometria.reserva, 1);
    await page.evaluate(async () => {
      const ruta = '/src/router.ts';
      const { navigate } = await import(/* @vite-ignore */ ruta) as { navigate: (page: string) => void };
      navigate('home');
    });
    await expect(page.getByRole('button', { name: idioma === 'en' ? 'Scan' : 'Escanear', exact: true })).toBeVisible();
    await expect(page.locator('.toast-ingreso-reserva, [data-ingreso-con-reserva]')).toHaveCount(0);
    const limpieza = { idioma, geometria, estable, trasDescarte, otraPantallaSinReserva: true };
    await testInfo.attach('geometria-limpieza', { body: JSON.stringify(limpieza, null, 2), contentType: 'application/json' });
    console.log('P3_GEOMETRIA_LIMPIEZA_JSON ' + JSON.stringify(limpieza));
  });
}
