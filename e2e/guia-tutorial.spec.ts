import { expect, test, type Locator, type Page } from '@playwright/test';
import { relojFueraDeLasFechasDeLosViajes } from './_app';
import { camaraSimulada, sacarFoto } from './_camara';
import { enTuMesaConLaLista } from './_mesa';

/**
 * D363–D367 · el tutorial «Tu turno», de punta a punta, contra el mock.
 *
 * Reemplaza a guia-opcional-d326.spec.ts (la guía de D327/D328, que ya no
 * existe: P4). La guía arranca sólo desde la tarjeta Tutorial de Inicio o desde
 * Más → Ayuda (D364), recorre una mesa de ejemplo 100 % local (D367) y se va al
 * terminar. Las capturas (datos inventados del mock) salen sólo con
 * `PAYME_E2E_CAPTURAS`.
 */

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (!dir) return;
  // `PAYME_E2E_CAPTURAS_SOLO` (nombres separados por coma): sólo esas, para no gastar la reserva repitiendo las demás.
  const solo = process.env.PAYME_E2E_CAPTURAS_SOLO?.split(',').map((n) => n.trim()).filter(Boolean);
  if (solo && !solo.includes(nombre)) return;
  // `animations: 'disabled'` termina la entrada de la burbuja (200 ms): la captura va con la burbuja quieta.
  await page.screenshot({ path: `${dir}/${nombre}.png`, animations: 'disabled' });
}

interface Opciones { readonly idioma?: 'es' | 'en'; readonly noVolverAMostrar?: boolean; readonly enFechasDeViaje?: boolean }

/** Ingresa sin invitaciones pendientes y con el aviso de fotos pospuesto: la guía no compite con ellos. */
async function entrar(page: Page, o: Opciones = {}): Promise<void> {
  if (o.enFechasDeViaje) await page.clock.setFixedTime(new Date('2026-10-08T18:00:00Z'));
  else await relojFueraDeLasFechasDeLosViajes(page);
  await page.addInitScript((op) => {
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
    localStorage.setItem('payme.app.mock.viajes.v1', 'encendido');
    localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled');
    if (op.idioma === 'en') localStorage.setItem('payme.app.idioma.v1', 'en');
  }, o);
  await camaraSimulada(page);
  await page.goto('/');
  await page.evaluate(async () => {
    const ruta = '/src/api/mock/store.ts';
    const { state, persist } = await import(/* @vite-ignore */ ruta) as { state: { pendingInvitations: unknown[] }; persist: () => void };
    state.pendingInvitations = []; persist();
  });
  if (o.noVolverAMostrar) {
    // D328 · la marca vieja de «No volver a mostrar», como la dejó la guía anterior: hash + 1 por cuenta.
    await page.evaluate(async () => {
      const ruta = '/src/api/mock/store.ts';
      const { state } = await import(/* @vite-ignore */ ruta) as { state: { user: { id: string } } };
      const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`auth:${state.user.id}`));
      const hash = [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem(`payme.app.guia.optout.v2.mock.${hash}`, '1');
    });
  }
  const en = o.idioma === 'en';
  await page.getByLabel('Email', { exact: true }).fill('mati@payme.mx');
  // Expresiones regulares y no texto entre comillas: la auditoría de secretos lee «'clave' : 'valor'» como un valor.
  await page.getByLabel(en ? /^Password$/ : /^Contraseña$/).fill('demo-e2e');
  await page.getByRole('button', { name: en ? 'Log in' : 'Entrar', exact: true }).click();
  await expect(page.getByRole('button', { name: en ? /^Scan/ : /^Escanear/ }).first()).toBeVisible();
  // El aviso de fotos se pospone, como hace la persona: con el aviso pendiente la tarjeta Tutorial no aparece
  // (enmienda 10). Lo que pasa con el aviso lo prueba guia-motor-y-seguro.spec.ts.
  const aviso = page.getByRole('complementary', { name: en ? 'Privacy Notice update' : 'Actualización del Aviso de Privacidad', exact: true });
  await expect(aviso).toBeVisible();
  await aviso.getByRole('button', { name: en ? 'Not now' : 'Ahora no', exact: true }).click();
  await expect(aviso).toHaveCount(0);
}

const tarjeta = (page: Page) => page.locator('[data-guia="tarjeta-tutorial"]');
const burbuja = (page: Page, nombre: string | RegExp) => page.getByRole('dialog', { name: nombre });
const capaVisible = (page: Page) => page.locator('.guia-capa[data-activa]');
const fase = (page: Page) => page.evaluate(async () => {
  const ruta = '/src/ayuda/ejemplo/estadoEjemplo.ts';
  const { ejemploLocal } = await import(/* @vite-ignore */ ruta) as { ejemploLocal: { leer: () => { activo: boolean; fase: string } } };
  const e = ejemploLocal.leer();
  return e.activo ? e.fase : 'apagado';
});

/**
 * La geometría de la ficha: la burbuja entra entera en la ventana, no tapa el
 * control ni su anillo, el control sigue tocable y cada botón tiene 44 de alto.
 * Coordenadas de ventana (P5): también para la burbuja montada dentro de la hoja.
 */
async function geometria(page: Page, ancla: string): Promise<void> {
  await expect(async () => {
    const m = await page.evaluate((a) => {
      const b = document.querySelector<HTMLElement>('.guia-capa[data-activa] .guia-burbuja')!.getBoundingClientRect();
      const anillo = document.querySelector<HTMLElement>('.guia-capa[data-activa] .guia-anillo')!.getBoundingClientRect();
      const control = Array.from(document.querySelectorAll<HTMLElement>(`[data-guia="${a}"]`)).find((e) => e.getClientRects().length > 0)!;
      const fab = control.querySelector('.appbar-fab') ?? control;
      const r = fab.getBoundingClientRect();
      const tocable = (e: Element) => {
        const q = e.getBoundingClientRect();
        const hit = document.elementFromPoint((q.left + q.right) / 2, (q.top + q.bottom) / 2);
        return hit === e || (hit !== null && e.contains(hit));
      };
      return {
        dentro: b.left >= 0 && b.right <= window.innerWidth && b.top >= 0 && b.bottom <= window.innerHeight,
        noTapa: b.bottom <= anillo.top || b.top >= anillo.bottom,
        anilloRodea: anillo.left <= r.left && anillo.right >= r.right && anillo.top <= r.top && anillo.bottom >= r.bottom,
        controlTocable: tocable(fab),
        botones: Array.from(document.querySelectorAll('.guia-capa[data-activa] .guia-burbuja button')).map((e) => e.getBoundingClientRect().height),
        burbuja: b.toJSON(), anillo: anillo.toJSON(), control: r.toJSON(),
      };
    }, ancla);
    const d = JSON.stringify(m);
    expect(m.dentro, d).toBe(true);
    expect(m.noTapa, d).toBe(true);
    expect(m.anilloRodea, d).toBe(true);
    expect(m.controlTocable, d).toBe(true);
    for (const alto of m.botones) expect(alto, d).toBeGreaterThanOrEqual(44);
  }).toPass({ timeout: 10000 });
}

interface Llamada { readonly metodo: string; readonly clase: string; readonly codigo: string | null }
async function espiarLaFachada(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const rutaApi = '/src/api/index.ts';
    const rutaClases = '/src/ayuda/ejemplo/apiEjemplo.ts';
    const { api } = await import(/* @vite-ignore */ rutaApi) as { api: Record<string, (...a: unknown[]) => unknown> };
    const { CLASIFICACION_DEL_EJEMPLO } = await import(/* @vite-ignore */ rutaClases) as { CLASIFICACION_DEL_EJEMPLO: Record<string, string> };
    const w = window as unknown as { __llamadas: Llamada[] };
    w.__llamadas = [];
    for (const [metodo, clase] of Object.entries(CLASIFICACION_DEL_EJEMPLO)) {
      const original = api[metodo]!;
      api[metodo] = (...args: unknown[]) => {
        w.__llamadas.push({ metodo, clase, codigo: typeof args[0] === 'string' ? args[0] : null });
        return original(...args);
      };
    }
  });
}
const llamadas = (page: Page) => page.evaluate(() => (window as unknown as { __llamadas: Llamada[] }).__llamadas);
const mesasDelMock = (page: Page) => page.evaluate(async () => {
  const ruta = '/src/api/mock/store.ts';
  const { state } = await import(/* @vite-ignore */ ruta) as { state: { mesas: unknown[] } };
  return JSON.stringify(state.mesas);
});

/** 2f → 2a. */
async function abrirDesdeLaTarjeta(page: Page): Promise<Locator> {
  await expect(tarjeta(page)).toBeVisible();
  await tarjeta(page).getByRole('button', { name: 'Tutorial', exact: true }).click();
  const b = burbuja(page, '¿Cómo divido la cuenta?');
  await expect(b).toBeVisible();
  return b;
}
/** 2a → 2b. */
async function hastaLaCamara(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Escanear', exact: true }).click();
  await expect(burbuja(page, 'Saca o elige una foto: te mostraremos un ticket de ejemplo.')).toBeVisible();
}
/** 2b → 3a. */
async function hastaElTicket(page: Page): Promise<void> {
  await sacarFoto(page, undefined, { usar: false });
  await expect(burbuja(page, 'Este es el ticket de ejemplo.')).toBeVisible();
}
/** 3a → 2c (Siguiente). */
async function hastaDividir(page: Page): Promise<void> {
  await burbuja(page, 'Este es el ticket de ejemplo.').getByRole('button', { name: 'Siguiente', exact: true }).click();
  await expect(page.getByRole('dialog', { name: /Ticket/ })).toHaveCount(0);
  await expect(capaVisible(page)).toHaveCount(0);
  expect(await fase(page)).toBe('dividir');
}
/** 2c → 2d. */
async function hastaCompartir(page: Page, forma: RegExp = /Por lo que pidió cada uno/, toques = 1): Promise<void> {
  await page.getByRole('radio', { name: forma }).click();
  for (let i = 0; i < toques; i += 1) await page.getByRole('button', { name: 'Un comensal más' }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(burbuja(page, 'Aquí invitarás a tus amigos a sumarse a la mesa.')).toBeVisible();
}
/** 2d (1 de 2 → 2 de 2) → 2e. */
async function hastaTuMesa(page: Page): Promise<void> {
  await burbuja(page, 'Aquí invitarás a tus amigos a sumarse a la mesa.').getByRole('button', { name: 'Siguiente', exact: true }).click();
  await expect(burbuja(page, 'Toca Continuar para elegir lo tuyo.')).toBeVisible();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await enTuMesaConLaLista(page);
}

test.describe('D363 · el recorrido', () => {
  test('🔴 de la tarjeta a «Terminar guía», por lo que pidió cada uno, sin pedir nada ni crear nada', async ({ page }) => {
    await entrar(page);
    await espiarLaFachada(page);
    const antes = await mesasDelMock(page);
    await capturar(page, 'd363-2f-tarjeta');

    const a2 = await abrirDesdeLaTarjeta(page);
    await expect(a2.getByRole('button', { name: 'Cerrar guía' })).toHaveCount(0);
    await expect(a2.getByRole('button', { name: 'Realizar el tutorial en otro momento' })).toBeVisible();
    await expect(page.locator('.guia-capa[data-activa] .guia-flecha')).toBeVisible();
    await geometria(page, 'camara');
    await capturar(page, 'd363-2a-escanear');

    await hastaLaCamara(page);
    await geometria(page, 'foto');
    // 2b · la leyenda va a 12 arriba de la galería: no la tapa (ficha, recorrido 2).
    const galeria = await page.evaluate(() => ({
      burbuja: document.querySelector('.guia-capa[data-activa] .guia-burbuja')!.getBoundingClientRect().bottom,
      galeria: document.querySelector('[data-guia="galeria"]')!.getBoundingClientRect().top,
    }));
    expect(galeria.burbuja).toBeLessThanOrEqual(galeria.galeria);
    await capturar(page, 'd363-2b-camara');

    await hastaElTicket(page);
    // 3a · la hoja se abrió sola, la burbuja vive DENTRO de la hoja (aria-modal) y va arriba de ella.
    const hoja = page.getByRole('dialog', { name: /Ticket · 3 consumos/ });
    await expect(hoja).toHaveAttribute('data-guia-convive', '');
    await expect(hoja.locator('.guia-burbuja')).toHaveCount(1);
    await expect(page.locator('.guia-capa[data-activa] .guia-punta')).toBeVisible();
    await geometria(page, 'hoja-ticket');
    // P5 · coordenadas de ventana: ya quietas la hoja y la burbuja (sus entradas duran 280 y 200 ms), la burbuja
    // dentro del diálogo mide lo mismo que su estilo fijo: ningún ancestro con transform la corre.
    const p5 = await page.evaluate(async () => {
      const hojaAnimada = document.querySelector<HTMLElement>('.ticket-sheet-layer') ?? document.querySelector<HTMLElement>('.ticket-sheet')!;
      await Promise.all(hojaAnimada.getAnimations({ subtree: true }).map((a) => a.finished));
      const b = document.querySelector<HTMLElement>('.ticket-sheet .guia-burbuja')!;
      const r = b.getBoundingClientRect();
      return { left: r.left, top: r.top, estiloLeft: Number.parseFloat(b.style.left), estiloTop: Number.parseFloat(b.style.top),
        hojaTop: document.querySelector('.ticket-sheet')!.getBoundingClientRect().top };
    });
    expect(Math.abs(p5.left - p5.estiloLeft)).toBeLessThan(1);
    expect(Math.abs(p5.top - p5.estiloTop)).toBeLessThan(1);
    expect(p5.top).toBeLessThan(p5.hojaTop);
    await capturar(page, 'd363-3a-ticket');

    await hastaDividir(page);
    await capturar(page, 'd363-2c-dividir');

    await hastaCompartir(page);
    // V · en el ejemplo no aparece el panel de invitar debajo de la burbuja.
    await expect(page.getByRole('tablist', { name: 'Elegir a quién invitar' })).toHaveCount(0);
    await expect(burbuja(page, 'Aquí invitarás a tus amigos a sumarse a la mesa.').getByText('1 de 2')).toBeVisible();
    await geometria(page, 'compartir');
    await capturar(page, 'd363-2d-invitar');

    await hastaTuMesa(page);
    const e2 = burbuja(page, 'Selecciona lo que consumiste únicamente.');
    await expect(e2).toBeVisible();
    await geometria(page, 'consumos');
    await capturar(page, 'd363-2e-tu-mesa');

    await page.locator('.qc-lista .qc-renglon').filter({ hasText: 'Tagliatelle Bolognese' }).getByRole('button').first().click();
    await page.getByRole('button', { name: 'Listo', exact: true }).click();
    await expect.poll(() => page.evaluate(() => location.pathname)).toBe('/home');

    // 4a · la mesa de ejemplo en el lugar de la tarjeta, con lo elegido.
    const mesaEjemplo = page.locator('[data-guia="mesa-ejemplo"]');
    await expect(mesaEjemplo).toBeVisible();
    await expect(mesaEjemplo).toContainText('Ejemplo');
    await expect(mesaEjemplo.locator('.mesa-paid')).toHaveText(/\$195/);
    await expect(tarjeta(page)).toHaveCount(0);
    const a4 = burbuja(page, 'Así queda tu mesa.');
    await expect(a4).toBeVisible();
    await geometria(page, 'mesa-ejemplo');
    await capturar(page, 'd363-4a-final');

    await a4.getByRole('button', { name: 'Terminar guía', exact: true }).click();
    await expect(mesaEjemplo).toHaveCount(0);
    await expect(tarjeta(page)).toHaveCount(0);
    expect(await fase(page)).toBe('apagado');

    // Cero: nada cortado, lo local sólo de PA-1224, ninguna mesa nueva en el mock.
    const lista = await llamadas(page);
    expect(lista.filter((l) => l.clase === 'cortado')).toEqual([]);
    expect(lista.filter((l) => l.clase === 'local' && l.codigo?.toUpperCase() !== 'PA-1224')).toEqual([]);
    expect(lista.some((l) => l.metodo === 'lockItems' && l.codigo === 'PA-1224')).toBe(true);
    expect(await mesasDelMock(page)).toBe(antes);

    // La tarjeta no vuelve: terminar la guía la oculta para esta cuenta y este dispositivo (Q1). Con el aviso de fotos
    // respondido otra vez después de recargar (su «Ahora no» vive en memoria): si no, la tarjeta faltaría por el aviso
    // (enmienda 10) y esta ausencia no diría nada de Q1.
    await page.reload();
    await expect(page.getByRole('button', { name: 'Escanear', exact: true })).toBeVisible();
    const aviso = page.getByRole('complementary', { name: 'Actualización del Aviso de Privacidad', exact: true });
    await aviso.getByRole('button', { name: 'Ahora no', exact: true }).click();
    await expect(aviso).toHaveCount(0);
    await expect(tarjeta(page)).toHaveCount(0);
  });

  test('Q10 · en «Pagar el total», 2e usa el texto de selección opcional', async ({ page }) => {
    await entrar(page);
    await abrirDesdeLaTarjeta(page);
    await hastaLaCamara(page);
    await hastaElTicket(page);
    await hastaDividir(page);
    await hastaCompartir(page, /Pagar el total/);
    await hastaTuMesa(page);
    await expect(burbuja(page, 'Marca lo que consumiste, si quieres.')).toBeVisible();
  });
});

test.describe('D363 · salir en cualquier paso', () => {
  test('2a · «otro momento» cierra sin borrar la tarjeta; Escape también', async ({ page }) => {
    await entrar(page);
    const a2 = await abrirDesdeLaTarjeta(page);
    await a2.getByRole('button', { name: 'Realizar el tutorial en otro momento' }).click();
    await expect(capaVisible(page)).toHaveCount(0);
    await expect(tarjeta(page)).toBeVisible();
    expect(await fase(page)).toBe('apagado');
    await abrirDesdeLaTarjeta(page);
    await page.keyboard.press('Escape');
    await expect(capaVisible(page)).toHaveCount(0);
    await expect(tarjeta(page)).toBeVisible();
  });

  test('2b y 3a · la ✕ vuelve a Inicio; en 3a Escape cierra primero la hoja y no la guía', async ({ page }) => {
    await entrar(page);
    const antes = await mesasDelMock(page);
    await abrirDesdeLaTarjeta(page);
    await hastaLaCamara(page);
    await burbuja(page, 'Saca o elige una foto: te mostraremos un ticket de ejemplo.').getByRole('button', { name: 'Cerrar guía' }).click();
    await expect.poll(() => page.evaluate(() => location.pathname)).toBe('/home');
    await expect(tarjeta(page)).toBeVisible();

    await abrirDesdeLaTarjeta(page);
    await hastaLaCamara(page);
    await hastaElTicket(page);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: /Ticket/ })).toHaveCount(0);
    expect(await fase(page)).toBe('dividir');
    // 2c sin burbuja ni ✕ (Q7): se sale yéndose. «Volver» cierra la guía y descarta la mesa de ejemplo.
    await page.getByRole('button', { name: 'Volver', exact: true }).click();
    await expect.poll(() => fase(page)).toBe('apagado');
    await expect(tarjeta(page)).toBeVisible();
    expect(await mesasDelMock(page)).toBe(antes);
  });

  test('2d y 2e · la ✕ vuelve a Inicio sin crear nada', async ({ page }) => {
    await entrar(page);
    const antes = await mesasDelMock(page);
    await abrirDesdeLaTarjeta(page);
    await hastaLaCamara(page);
    await hastaElTicket(page);
    await hastaDividir(page);
    await hastaCompartir(page);
    await burbuja(page, 'Aquí invitarás a tus amigos a sumarse a la mesa.').getByRole('button', { name: 'Cerrar guía' }).click();
    await expect.poll(() => page.evaluate(() => location.pathname)).toBe('/home');
    expect(await fase(page)).toBe('apagado');

    await abrirDesdeLaTarjeta(page);
    await hastaLaCamara(page);
    await hastaElTicket(page);
    await hastaDividir(page);
    await hastaCompartir(page);
    await hastaTuMesa(page);
    await burbuja(page, 'Selecciona lo que consumiste únicamente.').getByRole('button', { name: 'Cerrar guía' }).click();
    await expect.poll(() => page.evaluate(() => location.pathname)).toBe('/home');
    expect(await fase(page)).toBe('apagado');
    await expect(tarjeta(page)).toBeVisible();
    expect(await mesasDelMock(page)).toBe(antes);
  });
});

test.describe('D363 · la tarjeta y Más → Ayuda', () => {
  test('Q1 · la ✕ roja la quita y no vuelve; Ayuda a medias la trae de vuelta', async ({ page }) => {
    await entrar(page);
    await tarjeta(page).getByRole('button', { name: 'Quitar el tutorial de Inicio' }).click();
    await expect(tarjeta(page)).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Escanear', exact: true })).toBeVisible();
    // El «Ahora no» del aviso de fotos vive en memoria: la recarga lo trae de vuelta, y con el aviso pendiente la
    // tarjeta espera (enmienda 10). Se responde otra vez, como haría la persona.
    const aviso = page.getByRole('complementary', { name: 'Actualización del Aviso de Privacidad', exact: true });
    await aviso.getByRole('button', { name: 'Ahora no', exact: true }).click();
    await expect(aviso).toHaveCount(0);
    await expect(tarjeta(page)).toHaveCount(0);
    // 1o · Más → Ayuda abre 2a (sobre Escanear, en Más) y crea otra mesa de ejemplo.
    await page.getByRole('button', { name: 'Más', exact: true }).click();
    const fila = page.getByRole('button', { name: 'Cómo usar PayMe' });
    await expect(fila).toBeEnabled();
    await capturar(page, 'd363-1o-ayuda');
    await fila.click();
    await expect(burbuja(page, '¿Cómo divido la cuenta?')).toBeVisible();
    await burbuja(page, '¿Cómo divido la cuenta?').getByRole('button', { name: 'Realizar el tutorial en otro momento' }).click();
    await page.getByRole('button', { name: 'Inicio', exact: true }).click();
    await expect(tarjeta(page)).toBeVisible();
  });

  test('D364 · quien marcó «No volver a mostrar» no ve la tarjeta, y le queda Más → Ayuda', async ({ page }) => {
    await entrar(page, { noVolverAMostrar: true });
    await page.getByRole('button', { name: 'Más', exact: true }).click();
    await page.getByRole('button', { name: 'Cómo usar PayMe' }).click();
    const a2 = burbuja(page, '¿Cómo divido la cuenta?');
    await expect(a2).toBeVisible();
    await a2.getByRole('button', { name: 'Realizar el tutorial en otro momento' }).click();
    // Para acá la guía ya leyó las dos marcas: si no hay tarjeta, es por el «No volver a mostrar» (control: el test de arriba).
    await page.getByRole('button', { name: 'Inicio', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Escanear', exact: true })).toBeVisible();
    await expect(tarjeta(page)).toHaveCount(0);
  });

  test('D365 · Q9 · dentro de las fechas de un viaje no hay tarjeta y la fila de Ayuda dice por qué', async ({ page }) => {
    await entrar(page, { enFechasDeViaje: true });
    await expect(page.getByRole('button', { name: /^Escanear ticket para/ })).toBeVisible();
    await expect(tarjeta(page)).toHaveCount(0);
    await page.getByRole('button', { name: 'Más', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Cómo usar PayMe' })).toBeDisabled();
    await expect(page.getByText('Disponible fuera de las fechas de un viaje')).toBeVisible();
  });
});

test.describe('D363 · 375 × 667 y en inglés', () => {
  test('4c · a 375 × 667 entran la burbuja de apertura, la de 3a, la de 2d y la de 2e', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await entrar(page);
    await abrirDesdeLaTarjeta(page);
    await geometria(page, 'camara');
    await capturar(page, 'd363-4c-375-apertura');
    await hastaLaCamara(page);
    await hastaElTicket(page);
    await geometria(page, 'hoja-ticket');
    await capturar(page, 'd363-375-3a');
    await hastaDividir(page);
    await hastaCompartir(page);
    await geometria(page, 'compartir');
    await capturar(page, 'd363-375-2d');
    await hastaTuMesa(page);
    await geometria(page, 'consumos');
    await capturar(page, 'd363-375-2e');
  });

  test('en inglés: la tarjeta y la burbuja de apertura', async ({ page }) => {
    await entrar(page, { idioma: 'en' });
    await expect(tarjeta(page)).toBeVisible();
    await capturar(page, 'd363-en-2f');
    await tarjeta(page).getByRole('button', { name: 'Tutorial', exact: true }).click();
    const a2 = burbuja(page, 'How do I split the bill?');
    await expect(a2).toBeVisible();
    await expect(a2.getByRole('button', { name: 'Do the tutorial another time' })).toBeVisible();
    await geometria(page, 'camara');
    await capturar(page, 'd363-en-2a');
  });
});
