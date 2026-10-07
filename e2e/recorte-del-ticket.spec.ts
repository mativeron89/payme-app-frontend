import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';
import { camarasAbiertas, conOrientacion, sacarFoto, type ArchivoDeFoto } from './_camara';

/**
 * AF-RECORTE-BURBUJA · D222, primera elección de Mati: «Siempre, con el marco
 * abierto (Recomendada)» — «Después de sacar o elegir la foto, aparece con un
 * marco que se mueve desde las esquinas. Si no lo movés, va la foto entera. Un
 * toque en «Usar foto» y sigue.» Su pedido: «el ticket es muy angosto y cuando
 * es largo tengo que alejar el celular y queda en la foto MUCHO espacio que nada
 * tiene que ver al ticket».
 *
 * La foto es sintética: una mesa marrón con grano y, en el medio, un ticket
 * angosto y largo, blanco, con una franja AZUL arriba y una VERDE abajo. Lo que
 * se sube se lee en la fachada (`api.scanTicket`, como `camara-nativa.spec`):
 * medidas y colores en puntos fijos. Recortado al ticket, los costados son
 * papel blanco y las puntas, azul y verde; sin recortar, los costados son mesa.
 *
 * A 375×667, el iPhone SE: el teléfono más chico donde el marco tiene que andar.
 */
test.use({ viewport: { width: 375, height: 667 } });

const ANCHO = 1200;
const ALTO = 1600;
/** El ticket en la foto, en píxeles: 300×1400 en el medio. */
const TICKET = { x: 450, y: 100, ancho: 300, alto: 1400 };

type Color = [number, number, number];

/** La foto de la mesa con el ticket, armada en el navegador. */
async function ticketEnLaMesa(page: Page, nombre = 'IMG_0700.jpg'): Promise<ArchivoDeFoto> {
  const b64 = await page.evaluate(async ([w, h, t]) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#8b5a2b';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#f4f4f4';
    ctx.fillRect(t.x, t.y, t.ancho, t.alto);
    const franja = Math.round(t.alto * 0.08);
    ctx.fillStyle = '#0000ff';
    ctx.fillRect(t.x, t.y, t.ancho, franja);
    ctx.fillStyle = '#00c000';
    ctx.fillRect(t.x, t.y + t.alto - franja, t.ancho, franja);
    ctx.fillStyle = '#222';
    ctx.font = '22px monospace';
    for (let y = t.y + franja + 40; y < t.y + t.alto - franja - 20; y += 44) {
      ctx.fillText('1 TACO  $45', t.x + 40, y);
    }
    // Grano en toda la foto: le da peso al JPEG sin cambiar los colores.
    const d = ctx.getImageData(0, 0, w, h);
    for (let i = 0; i < d.data.length; i += 4) {
      for (let k = 0; k < 3; k += 1) d.data[i + k] = d.data[i + k]! + Math.round((Math.random() - 0.5) * 30);
    }
    ctx.putImageData(d, 0, 0);
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.9));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
  }, [ANCHO, ALTO, TICKET] as const);
  return { name: nombre, mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') };
}

/** 1200×600 acostada, mitad izquierda roja y derecha azul, con grano. */
async function rojoAzul(page: Page): Promise<ArchivoDeFoto> {
  const b64 = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 1200;
    c.height = 600;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, 0, 600, 600);
    ctx.fillStyle = '#0000ff';
    ctx.fillRect(600, 0, 600, 600);
    const d = ctx.getImageData(0, 0, 1200, 600);
    for (let i = 0; i < d.data.length; i += 4) {
      for (let k = 0; k < 3; k += 1) d.data[i + k] = d.data[i + k]! + Math.round((Math.random() - 0.5) * 36);
    }
    ctx.putImageData(d, 0, 0);
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.9));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
  });
  return { name: 'IMG_0701.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') };
}

/** Guarda cada imagen que la fachada recibe para leer. */
async function espiarOcr(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const ruta = '/src/api/index.ts';
    const { api } = await import(/* @vite-ignore */ ruta) as {
      api: Record<string, (...a: unknown[]) => Promise<unknown>>;
    };
    const w = window as unknown as { __subidas: Blob[] };
    w.__subidas = [];
    const original = api.scanTicket!.bind(api);
    api.scanTicket = (...args: unknown[]) => {
      if (args[0] instanceof Blob) w.__subidas.push(args[0]);
      return original(...args);
    };
  });
}

const cantidadDeSubidas = (page: Page) => page.evaluate(
  () => (window as unknown as { __subidas: Blob[] }).__subidas.length,
);

/**
 * La subida `i`: medidas y el color promedio (5×5) en cinco puntos, en
 * proporciones: arriba y abajo al centro, el medio, y los dos costados.
 */
async function subida(page: Page, i = 0) {
  await expect.poll(() => cantidadDeSubidas(page)).toBeGreaterThan(i);
  return page.evaluate(async (n) => {
    const blob = (window as unknown as { __subidas: Blob[] }).__subidas[n]!;
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    const color = (fx: number, fy: number) => {
      const x = Math.max(0, Math.min(bmp.width - 5, Math.floor(fx * bmp.width) - 2));
      const y = Math.max(0, Math.min(bmp.height - 5, Math.floor(fy * bmp.height) - 2));
      const d = ctx.getImageData(x, y, 5, 5).data;
      const suma = [0, 0, 0];
      for (let k = 0; k < d.length; k += 4) for (let j = 0; j < 3; j += 1) suma[j]! += d[k + j]!;
      return suma.map((v) => Math.round(v / 25)) as [number, number, number];
    };
    return {
      tipo: blob.type,
      ancho: bmp.width,
      alto: bmp.height,
      arriba: color(0.5, 0.03),
      abajo: color(0.5, 0.97),
      medio: color(0.5, 0.5),
      izquierda: color(0.06, 0.5),
      derecha: color(0.94, 0.5),
    };
  }, i);
}

const AZUL = (c: Color) => c[2] > 170 && c[0] < 90 && c[1] < 90;
const VERDE = (c: Color) => c[1] > 140 && c[0] < 90 && c[2] < 90;
const ROJO = (c: Color) => c[0] > 190 && c[1] < 80 && c[2] < 80;
const PAPEL = (c: Color) => c.every((v) => v > 200);
const MESA = (c: Color) => c[0] > 100 && c[0] < 190 && c[0] - c[2] > 50 && c[1] > 50 && c[1] < 130;

const marco = (page: Page) => page.getByRole('group', { name: 'Marco del recorte' });
const usar = (page: Page) => page.getByRole('button', { name: 'Usar foto', exact: true });
const ticketListo = (page: Page) => page.getByRole('radiogroup', { name: '¿Cómo dividen?' });
const NOMBRES = [
  'Esquina de arriba a la izquierda',
  'Esquina de arriba a la derecha',
  'Esquina de abajo a la izquierda',
  'Esquina de abajo a la derecha',
  'Borde de arriba',
  'Borde de abajo',
  'Borde de la izquierda',
  'Borde de la derecha',
] as const;

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (dir) await page.screenshot({ path: `${dir}/${nombre}.png` });
}

/** «Nueva», la foto de la cámara y el marco en pantalla. */
async function conLaFoto(page: Page, foto: ArchivoDeFoto): Promise<void> {
  await ingresar(page);
  await espiarOcr(page);
  await page.getByRole('button', { name: 'Nueva', exact: true }).click();
  // El piso del dueño publicado antes de la foto (ver `camara-nativa.spec`).
  await expect(page.locator('.camara-controles input[type="file"]')).toHaveAttribute('accept', /image\/heic/);
  await sacarFoto(page, foto, { usar: false });
  await expect(marco(page)).toBeVisible();
}

/** La foto en pantalla, en px de la página. */
async function fotoEnPantalla(page: Page) {
  return (await page.locator('.recorte-foto').boundingBox())!;
}

/** Arrastra el asa `nombre` desde su centro hasta el punto (en px de la página). */
async function arrastrar(page: Page, nombre: string, x: number, y: number): Promise<void> {
  const b = (await page.getByRole('button', { name: nombre, exact: true }).boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 8 });
  await page.mouse.up();
}

/** El marco dibujado, en px de la página. */
async function marcoEnPantalla(page: Page) {
  return (await page.locator('.recorte-marco').boundingBox())!;
}

test.describe('D222 · el marco para recortar la foto del ticket', () => {
  test('🔴 la foto llega con el marco en sus bordes; sin tocarlo, «Usar foto» sube la foto ENTERA', async ({ page }) => {
    await conLaFoto(page, await ticketEnLaMesa(page));
    await expect(page.locator('.camara-sub')).toHaveText('Ajusta el marco para dejar sólo el ticket');
    // Nada se sube hasta «Usar foto».
    expect(await cantidadDeSubidas(page)).toBe(0);
    // El marco arranca en los bordes de la foto.
    const foto = await fotoEnPantalla(page);
    const m = await marcoEnPantalla(page);
    expect(Math.abs(m.x - foto.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(m.y - foto.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(m.width - foto.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(m.height - foto.height)).toBeLessThanOrEqual(1);
    // Las ocho zonas: botones con nombre, de al menos 44 px.
    for (const nombre of NOMBRES) {
      const zona = page.getByRole('button', { name: nombre, exact: true });
      await expect(zona).toBeVisible();
      const b = (await zona.boundingBox())!;
      expect(Math.max(b.width, b.height), nombre).toBeGreaterThanOrEqual(44);
    }
    for (const nombre of NOMBRES.slice(0, 4)) {
      const b = (await page.getByRole('button', { name: nombre, exact: true }).boundingBox())!;
      expect([b.width, b.height], nombre).toEqual([44, 44]);
    }
    await expect(page.getByRole('img', { name: 'Foto del ticket' })).toBeVisible();
    // «Sacar otra» (vino de la cámara) y «Usar foto», enteros en pantalla; sin
    // el botón redondo ni la galería.
    const otra = page.getByRole('button', { name: 'Sacar otra', exact: true });
    await expect(otra).toBeVisible();
    await expect(usar(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sacar foto', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Elegir de la galería o Drive', exact: true })).toHaveCount(0);
    for (const boton of [otra, usar(page)]) {
      const b = (await boton.boundingBox())!;
      expect(b.height).toBeGreaterThanOrEqual(44);
      expect(b.y + b.height).toBeLessThanOrEqual(667);
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(375);
    }
    // El marco y las zonas no se meten en los botones de abajo.
    const zonaAbajo = (await page.getByRole('button', { name: 'Esquina de abajo a la derecha', exact: true }).boundingBox())!;
    expect(zonaAbajo.y + zonaAbajo.height).toBeLessThanOrEqual((await otra.boundingBox())!.y);
    await capturar(page, 'recorte-sin-tocar-375');

    await usar(page).click();
    await expect(ticketListo(page)).toBeVisible();
    const s = await subida(page);
    expect(s.tipo).toBe('image/jpeg');
    expect([s.ancho, s.alto]).toEqual([ANCHO, ALTO]);
    expect(MESA(s.izquierda), `izquierda: ${s.izquierda}`).toBe(true);
    expect(MESA(s.derecha), `derecha: ${s.derecha}`).toBe(true);
    expect(await cantidadDeSubidas(page)).toBe(1);
  });

  test('🔴 un ticket angosto y largo: arrastrando dos esquinas se sube SÓLO el ticket', async ({ page }) => {
    await conLaFoto(page, await ticketEnLaMesa(page));
    const foto = await fotoEnPantalla(page);
    const px = (x: number, y: number) => [foto.x + (x / ANCHO) * foto.width, foto.y + (y / ALTO) * foto.height] as const;
    await arrastrar(page, 'Esquina de arriba a la izquierda', ...px(TICKET.x, TICKET.y));
    await arrastrar(page, 'Esquina de abajo a la derecha', ...px(TICKET.x + TICKET.ancho, TICKET.y + TICKET.alto));
    // El marco quedó sobre el ticket.
    const m = await marcoEnPantalla(page);
    expect(Math.abs(m.width - (TICKET.ancho / ANCHO) * foto.width)).toBeLessThanOrEqual(2);
    expect(Math.abs(m.height - (TICKET.alto / ALTO) * foto.height)).toBeLessThanOrEqual(2);
    await capturar(page, 'recorte-recortado-375');

    await usar(page).click();
    await expect(ticketListo(page)).toBeVisible();
    const s = await subida(page);
    // Las medidas del recorte (±una vuelta de redondeo de la pantalla a la foto).
    expect(Math.abs(s.ancho - TICKET.ancho), `ancho ${s.ancho}`).toBeLessThanOrEqual(10);
    expect(Math.abs(s.alto - TICKET.alto), `alto ${s.alto}`).toBeLessThanOrEqual(10);
    // Los costados son papel, no mesa; las puntas, las franjas del ticket.
    expect(PAPEL(s.izquierda), `izquierda: ${s.izquierda}`).toBe(true);
    expect(PAPEL(s.derecha), `derecha: ${s.derecha}`).toBe(true);
    expect(AZUL(s.arriba), `arriba: ${s.arriba}`).toBe(true);
    expect(VERDE(s.abajo), `abajo: ${s.abajo}`).toBe(true);
  });

  test('🔴 orientación EXIF 6: el recorte es de la foto YA GIRADA, como se ve', async ({ page }) => {
    // Los píxeles acostados (1200×600, rojo a la izquierda) y la marca 6: se ve
    // vertical, 600×1200, con el rojo ARRIBA.
    await conLaFoto(page, conOrientacion(await rojoAzul(page), 6));
    const foto = await fotoEnPantalla(page);
    expect(foto.height).toBeGreaterThan(foto.width);
    // El borde de abajo hasta la mitad: queda la mitad de arriba.
    await arrastrar(page, 'Borde de abajo', foto.x + foto.width / 2, foto.y + foto.height / 2);
    await usar(page).click();
    await expect(ticketListo(page)).toBeVisible();
    const s = await subida(page);
    expect(Math.abs(s.ancho - 600)).toBeLessThanOrEqual(2);
    expect(Math.abs(s.alto - 600)).toBeLessThanOrEqual(8);
    // Todo rojo: arriba, en el medio y abajo. Sin girar, la mitad sería azul.
    for (const punto of [s.arriba, s.medio, s.abajo, s.izquierda, s.derecha]) {
      expect(ROJO(punto), `${punto}`).toBe(true);
    }
  });

  test('🔴 el marco no sale de la foto, y no baja de 64 px de lado', async ({ page }) => {
    await conLaFoto(page, await ticketEnLaMesa(page));
    const foto = await fotoEnPantalla(page);
    // Hacia afuera: queda en el borde.
    await arrastrar(page, 'Esquina de arriba a la izquierda', foto.x - 60, foto.y - 60);
    let m = await marcoEnPantalla(page);
    expect(Math.abs(m.x - foto.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(m.y - foto.y)).toBeLessThanOrEqual(1);
    // La esquina de abajo, hasta pasar la de arriba: se frena en el mínimo.
    await arrastrar(page, 'Esquina de abajo a la derecha', foto.x - 40, foto.y - 40);
    m = await marcoEnPantalla(page);
    expect(Math.abs(m.width - 64)).toBeLessThanOrEqual(1);
    expect(Math.abs(m.height - 64)).toBeLessThanOrEqual(1);
    expect(Math.abs(m.x - foto.x)).toBeLessThanOrEqual(1);
    // Lo que se sube es ese cuadrado, en píxeles de la foto.
    await usar(page).click();
    const s = await subida(page);
    const lado = (64 / foto.width) * ANCHO;
    expect(Math.abs(s.ancho - lado), `ancho ${s.ancho} vs ${lado}`).toBeLessThanOrEqual(6);
    expect(Math.abs(s.alto - (64 / foto.height) * ALTO)).toBeLessThanOrEqual(6);
  });

  test('🔴 «Sacar otra» abre la cámara en el mismo toque; si se cancela, la foto sigue con su marco y no se sube nada', async ({ page }) => {
    await conLaFoto(page, await ticketEnLaMesa(page));
    const antes = camarasAbiertas(page);
    const [selector] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('button', { name: 'Sacar otra', exact: true }).click(),
    ]);
    expect(await selector.element().getAttribute('capture')).toBe('environment');
    await expect.poll(() => camarasAbiertas(page)).toBe(antes + 1);
    // Cancelada: la foto y el marco siguen; nada se subió.
    await expect(marco(page)).toBeVisible();
    await page.waitForTimeout(300);
    expect(await cantidadDeSubidas(page)).toBe(0);
    // Con otra foto, el marco vuelve a la foto entera.
    await arrastrar(page, 'Borde de arriba', 187, 300);
    await sacarFoto(page, await ticketEnLaMesa(page, 'IMG_0702.jpg'), { usar: false });
    await expect.poll(async () => {
      const f = await fotoEnPantalla(page);
      const m = await marcoEnPantalla(page);
      return Math.abs(m.y - f.y) <= 1 && Math.abs(m.height - f.height) <= 1;
    }).toBe(true);
    expect(await cantidadDeSubidas(page)).toBe(0);
  });

  test('🔴 de la galería: «Elegir otra» abre el selector SIN `capture`, y tampoco sube nada', async ({ page }) => {
    await ingresar(page);
    await espiarOcr(page);
    await page.getByRole('button', { name: 'Nueva', exact: true }).click();
    const input = page.locator('.camara-controles input[type="file"]');
    await expect(input).toHaveAttribute('accept', /image\/heic/);
    await input.setInputFiles(await ticketEnLaMesa(page, 'IMG_0703.jpg'));
    await expect(marco(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sacar otra', exact: true })).toHaveCount(0);
    const [selector] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('button', { name: 'Elegir otra', exact: true }).click(),
    ]);
    expect(await selector.element().getAttribute('capture')).toBeNull();
    await expect(marco(page)).toBeVisible();
    await page.waitForTimeout(300);
    expect(await cantidadDeSubidas(page)).toBe(0);
    // Y la de la galería, sin tocar el marco, también va entera.
    await usar(page).click();
    const s = await subida(page);
    expect([s.ancho, s.alto]).toEqual([ANCHO, ALTO]);
  });

  test('🔴 si el lienzo no puede con el recorte: se sube la foto ENTERA, saneada, y se avisa sin ámbar', async ({ page }) => {
    // El `drawImage` con rectángulo de origen (nueve argumentos) falla; el de
    // la foto entera (cinco), no.
    await page.addInitScript(() => {
      const dibujar = CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage = function (this: CanvasRenderingContext2D, ...args: unknown[]) {
        if (args.length === 9) throw new Error('lienzo sin memoria');
        return (dibujar as (...a: unknown[]) => void).apply(this, args);
      } as typeof dibujar;
    });
    await conLaFoto(page, await ticketEnLaMesa(page));
    await arrastrar(page, 'Borde de la izquierda', 120, 300);
    await usar(page).click();
    const aviso = page.getByRole('status').filter({ hasText: 'No pudimos recortar la foto. Mandamos la foto entera.' });
    await expect(aviso).toBeVisible();
    await expect(aviso).not.toHaveClass(/warn|orange|warning/);
    const s = await subida(page);
    expect(s.tipo).toBe('image/jpeg');
    expect([s.ancho, s.alto]).toEqual([ANCHO, ALTO]);
    await expect(ticketListo(page)).toBeVisible();
  });

  test('🔴 un segundo dedo durante el arrastre no mueve el marco', async ({ page }) => {
    await conLaFoto(page, await ticketEnLaMesa(page));
    const antes = await marcoEnPantalla(page);
    await page.evaluate(() => {
      const zona = (nombre: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${nombre}"]`)!;
      const centro = (b: HTMLButtonElement) => {
        const r = b.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      };
      const evento = (tipo: string, b: HTMLButtonElement, id: number, dx: number, dy: number) => {
        const c = centro(b);
        b.dispatchEvent(new PointerEvent(tipo, {
          bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch', isPrimary: id === 1,
          clientX: c.x + dx, clientY: c.y + dy,
        }));
      };
      const uno = zona('Esquina de arriba a la izquierda');
      const dos = zona('Esquina de abajo a la derecha');
      evento('pointerdown', uno, 1, 0, 0);
      // Control: el primer dedo sí mueve su esquina, 20 px hacia adentro.
      evento('pointermove', uno, 1, 20, 20);
      // El segundo dedo, en otra esquina, mientras el primero arrastra.
      evento('pointerdown', dos, 2, 0, 0);
      evento('pointermove', dos, 2, -40, -40);
      evento('pointermove', uno, 2, -40, -40);
      evento('pointerup', dos, 2, -40, -40);
      evento('pointerup', uno, 1, 0, 0);
    });
    const despues = await marcoEnPantalla(page);
    // La esquina del primer dedo se movió (el control); la del segundo, no.
    expect(Math.abs(despues.x - (antes.x + 20))).toBeLessThanOrEqual(1);
    expect(Math.abs(despues.y - (antes.y + 20))).toBeLessThanOrEqual(1);
    expect(Math.abs(despues.x + despues.width - (antes.x + antes.width))).toBeLessThanOrEqual(0.5);
    expect(Math.abs(despues.y + despues.height - (antes.y + antes.height))).toBeLessThanOrEqual(0.5);
  });

  test('🔴 con el teclado: cada zona tiene nombre y las flechas la mueven un 2%', async ({ page }) => {
    await conLaFoto(page, await ticketEnLaMesa(page));
    const foto = await fotoEnPantalla(page);
    const esquina = page.getByRole('button', { name: 'Esquina de arriba a la izquierda', exact: true });
    await esquina.focus();
    for (let i = 0; i < 5; i += 1) await page.keyboard.press('ArrowRight');
    for (let i = 0; i < 5; i += 1) await page.keyboard.press('ArrowDown');
    const borde = page.getByRole('button', { name: 'Borde de la derecha', exact: true });
    await borde.focus();
    // Una flecha que no mueve ese borde no hace nada.
    await page.keyboard.press('ArrowUp');
    for (let i = 0; i < 5; i += 1) await page.keyboard.press('ArrowLeft');
    const m = await marcoEnPantalla(page);
    expect(Math.abs(m.x - (foto.x + 0.1 * foto.width))).toBeLessThanOrEqual(1);
    expect(Math.abs(m.y - (foto.y + 0.1 * foto.height))).toBeLessThanOrEqual(1);
    expect(Math.abs(m.width - 0.8 * foto.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(m.height - 0.9 * foto.height)).toBeLessThanOrEqual(1);
    await usar(page).click();
    const s = await subida(page);
    expect([s.ancho, s.alto]).toEqual([0.8 * ANCHO, 0.9 * ALTO]);
  });
});
