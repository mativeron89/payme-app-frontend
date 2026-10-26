/**
 * D300 · las imágenes de arranque del iPhone (`<link rel="apple-touch-startup-image">`).
 *
 * Mati vio la app instalada abrir en negro antes de la pantalla de carga. iOS, al abrir la app desde la pantalla de
 * inicio, muestra la imagen de arranque que coincide con el tamaño del teléfono hasta que la página pinta; sin ella, un
 * fondo vacío. Cada imagen es la pantalla de carga misma (D475), dibujada desde el `index.html` del repo, con una
 * diferencia a propósito: D476 (opción A) la quiere SIN la palabra «PayMe» —el fondo, la franja y las dos puntas—,
 * porque la palabra entra en la página con su fundido. Así aparece una sola vez: si la imagen la trajera, la palabra
 * desaparecería al pintar la página (nace casi transparente) y volvería, el parpadeo que D300 vino a evitar.
 *
 * Uso: `node scripts/imagenes-de-arranque.mjs` (escribe `public/arranque/`). Importarlo no dibuja nada: la tabla y los
 * nombres los leen las pruebas (`src/arranque/imagenesDeArranque.test.ts` y `e2e/splash.spec.ts`).
 *
 * Cómo dibuja, por tamaño:
 * - Chromium de Playwright, con el ancho, el alto y la densidad del iPhone, en vertical;
 * - el `index.html` sin su `<script>` y SIN RED: todo pedido se aborta (la pantalla de carga no pide nada);
 * - la franja de la barra de estado con el alto de ese iPhone, por `Emulation.setSafeAreaInsetsOverride` (en un
 *   navegador `env(safe-area-inset-top)` vale 0);
 * - la palabra (`#splash .carga__palabra`) oculta con `visibility: hidden` antes de capturar, explícito: no depende de
 *   que la captura caiga dentro de los 80 ms de su retardo;
 * - la captura, en píxeles del dispositivo.
 *
 * ⚠️ Lo que no está medido: el alto de cada barra de estado (`barra`) es el que conozco de cada modelo, no medido en un
 * iPhone. Si es otro, la franja y las puntas se corren unos píxeles respecto de la página; la imagen igual es la
 * pantalla de carga, no negro. Los iPhone posteriores a esta tabla no tienen imagen hasta sumarlos.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Cada tamaño de iPhone en vertical: puntos, densidad y el alto de su barra de estado (sin medir: ver arriba). */
export const DISPOSITIVOS = Object.freeze([
  { ancho: 375, alto: 667, dpr: 2, barra: 20, modelos: 'iPhone SE (2.ª y 3.ª generación)' },
  { ancho: 414, alto: 896, dpr: 2, barra: 48, modelos: 'iPhone 11 y XR' },
  { ancho: 375, alto: 812, dpr: 3, barra: 50, modelos: 'iPhone 12 mini y 13 mini (el 11 Pro, el X y el XS comparten el tamaño, con una barra de 44)' },
  { ancho: 414, alto: 896, dpr: 3, barra: 44, modelos: 'iPhone 11 Pro Max y XS Max' },
  { ancho: 390, alto: 844, dpr: 3, barra: 47, modelos: 'iPhone 12, 12 Pro, 13, 13 Pro, 14 y 16e' },
  { ancho: 428, alto: 926, dpr: 3, barra: 47, modelos: 'iPhone 12 Pro Max, 13 Pro Max y 14 Plus' },
  { ancho: 393, alto: 852, dpr: 3, barra: 59, modelos: 'iPhone 14 Pro, 15, 15 Pro y 16' },
  { ancho: 430, alto: 932, dpr: 3, barra: 59, modelos: 'iPhone 14 Pro Max, 15 Plus, 15 Pro Max y 16 Plus' },
  { ancho: 402, alto: 874, dpr: 3, barra: 62, modelos: 'iPhone 16 Pro, 17 y 17 Pro' },
  { ancho: 440, alto: 956, dpr: 3, barra: 62, modelos: 'iPhone 16 Pro Max y 17 Pro Max' },
  { ancho: 420, alto: 912, dpr: 3, barra: 62, modelos: 'iPhone Air' },
].map((d) => Object.freeze(d)));

/** El archivo de un tamaño, en píxeles del dispositivo: `arranque-1170x2532.png`. */
export function archivoDe(d) {
  return `arranque-${d.ancho * d.dpr}x${d.alto * d.dpr}.png`;
}

/** El `media` del `<link>`: iOS elige la imagen cuyo tamaño, densidad y orientación coinciden. */
export function mediaDe(d) {
  return `(device-width: ${d.ancho}px) and (device-height: ${d.alto}px) and (-webkit-device-pixel-ratio: ${d.dpr}) and (orientation: portrait)`;
}

/** El `href` del `<link>`, desde la raíz. */
export function hrefDe(d) {
  return `/arranque/${archivoDe(d)}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// PNG: lo justo para leer y escribir las imágenes, sin dependencias. La captura de Chromium sale RGB de 8 bits con una
// compresión rápida; reescrita con el mejor filtro por fila y deflate 9, pesa ~27 % menos con los MISMOS píxeles.
// ═══════════════════════════════════════════════════════════════════════════

const FIRMA = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** El predictor del filtro `f` (0 a 4) para un byte, dado el de la izquierda, el de arriba y el de arriba a la izquierda. */
function prediccion(f, a, b, c) {
  if (f === 1) return a;
  if (f === 2) return b;
  if (f === 3) return (a + b) >> 1;
  if (f === 4) return paeth(a, b, c);
  return 0;
}

/**
 * Lee un PNG de 8 bits, RGB (2) o RGBA (6), sin entrelazar: ancho, alto, canales y los píxeles crudos. Con `filas`, sólo
 * las primeras (des-filtrar es secuencial desde arriba). Cualquier otra forma falla: no se acredita lo que no se leyó.
 */
export function leerPng(bytes, filas = Infinity) {
  if (!bytes.subarray(0, 8).equals(FIRMA)) throw new Error('no es un PNG');
  const ancho = bytes.readUInt32BE(16);
  const alto = bytes.readUInt32BE(20);
  const profundidad = bytes[24];
  const color = bytes[25];
  const entrelazado = bytes[28];
  if (profundidad !== 8 || (color !== 2 && color !== 6) || entrelazado !== 0) {
    throw new Error(`PNG fuera de la forma leída: profundidad ${profundidad}, color ${color}, entrelazado ${entrelazado}`);
  }
  const canales = color === 6 ? 4 : 3;
  const idat = [];
  for (let off = 8; off + 12 <= bytes.length;) {
    const largo = bytes.readUInt32BE(off);
    if (bytes.subarray(off + 4, off + 8).toString('latin1') === 'IDAT') idat.push(bytes.subarray(off + 8, off + 8 + largo));
    off += 12 + largo;
  }
  const crudo = inflateSync(Buffer.concat(idat));
  const paso = ancho * canales;
  const leidas = Math.min(alto, filas);
  const pixeles = Buffer.alloc(paso * leidas);
  for (let y = 0; y < leidas; y += 1) {
    const f = crudo[y * (paso + 1)];
    if (f > 4) throw new Error(`filtro ${f} desconocido en la fila ${y}`);
    for (let x = 0; x < paso; x += 1) {
      const a = x >= canales ? pixeles[y * paso + x - canales] : 0;
      const b = y > 0 ? pixeles[(y - 1) * paso + x] : 0;
      const c = x >= canales && y > 0 ? pixeles[(y - 1) * paso + x - canales] : 0;
      pixeles[y * paso + x] = (crudo[y * (paso + 1) + 1 + x] + prediccion(f, a, b, c)) & 255;
    }
  }
  return { ancho, alto, canales, filas: leidas, pixeles };
}

const TABLA_CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = TABLA_CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function trozo(tipo, datos) {
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(datos.length);
  const cuerpo = Buffer.concat([Buffer.from(tipo, 'latin1'), datos]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(cuerpo));
  return Buffer.concat([largo, cuerpo, crc]);
}

/** Escribe un PNG RGB de 8 bits: por fila, el filtro con la menor suma de diferencias; deflate 9. Determinista. */
export function escribirPngRgb(ancho, alto, pixeles) {
  const paso = ancho * 3;
  if (pixeles.length !== paso * alto) throw new Error('los píxeles no son ancho × alto × 3');
  const salida = Buffer.alloc((paso + 1) * alto);
  const fila = Buffer.alloc(paso);
  for (let y = 0; y < alto; y += 1) {
    let mejor = 0;
    let menor = Infinity;
    for (let f = 0; f < 5; f += 1) {
      let suma = 0;
      for (let x = 0; x < paso && suma < menor; x += 1) {
        const a = x >= 3 ? pixeles[y * paso + x - 3] : 0;
        const b = y > 0 ? pixeles[(y - 1) * paso + x] : 0;
        const c = x >= 3 && y > 0 ? pixeles[(y - 1) * paso + x - 3] : 0;
        const v = (pixeles[y * paso + x] - prediccion(f, a, b, c)) & 255;
        suma += v < 128 ? v : 256 - v;
      }
      if (suma < menor) { menor = suma; mejor = f; }
    }
    for (let x = 0; x < paso; x += 1) {
      const a = x >= 3 ? pixeles[y * paso + x - 3] : 0;
      const b = y > 0 ? pixeles[(y - 1) * paso + x] : 0;
      const c = x >= 3 && y > 0 ? pixeles[(y - 1) * paso + x - 3] : 0;
      fila[x] = (pixeles[y * paso + x] - prediccion(mejor, a, b, c)) & 255;
    }
    salida[y * (paso + 1)] = mejor;
    fila.copy(salida, y * (paso + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0);
  ihdr.writeUInt32BE(alto, 4);
  ihdr[8] = 8; // profundidad
  ihdr[9] = 2; // RGB, sin canal alfa: la pantalla de carga es opaca
  return Buffer.concat([FIRMA, trozo('IHDR', ihdr), trozo('IDAT', deflateSync(salida, { level: 9, memLevel: 9 })), trozo('IEND', Buffer.alloc(0))]);
}

/** El `index.html` sin el módulo de la app: sólo la pantalla de carga. */
export function htmlDeLaPantallaDeCarga(index) {
  const script = '<script type="module" src="/src/main.tsx"></script>';
  if (index.split(script).length !== 2) throw new Error('index.html no tiene exactamente un <script> de la app');
  return index.replace(script, '');
}

async function generar() {
  const { chromium } = await import('@playwright/test');
  const html = htmlDeLaPantallaDeCarga(readFileSync(join(RAIZ, 'index.html'), 'utf8'));
  const destino = join(RAIZ, 'public/arranque');
  mkdirSync(destino, { recursive: true });
  const navegador = await chromium.launch();
  try {
    for (const d of DISPOSITIVOS) {
      const contexto = await navegador.newContext({
        viewport: { width: d.ancho, height: d.alto },
        deviceScaleFactor: d.dpr,
        isMobile: true,
        hasTouch: true,
      });
      // Sin red: la pantalla de carga no pide nada, y lo que el resto del <head> pediría no entra a la imagen.
      await contexto.route('**/*', (ruta) => ruta.abort());
      const pagina = await contexto.newPage();
      const cdp = await contexto.newCDPSession(pagina);
      await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: d.barra, topMax: d.barra } });
      await pagina.setContent(html, { waitUntil: 'load' });
      // D476 (opción A): la imagen de arranque no lleva la palabra; la palabra entra en la página.
      await pagina.evaluate(() => { document.querySelector('#splash .carga__palabra').style.visibility = 'hidden'; });
      await pagina.evaluate(() => new Promise((listo) => requestAnimationFrame(() => requestAnimationFrame(listo))));
      // La franja tiene que medir la barra de ese iPhone: si el override no tomó, la imagen no sería la de ese tamaño.
      const franja = await pagina.evaluate(() => document.querySelector('#splash .carga__franja').getBoundingClientRect().height);
      if (franja !== d.barra) throw new Error(`${archivoDe(d)}: la franja mide ${franja}, no ${d.barra}`);
      const captura = leerPng(await pagina.screenshot({ type: 'png' }));
      if (captura.ancho !== d.ancho * d.dpr || captura.alto !== d.alto * d.dpr || captura.canales !== 3) {
        throw new Error(`${archivoDe(d)}: la captura salió ${captura.ancho}×${captura.alto} con ${captura.canales} canales`);
      }
      const png = escribirPngRgb(captura.ancho, captura.alto, captura.pixeles);
      // Reescribir no puede cambiar un píxel: se relee lo escrito y se compara con la captura.
      if (!leerPng(png).pixeles.equals(captura.pixeles)) throw new Error(`${archivoDe(d)}: reescrito, cambió un píxel`);
      writeFileSync(join(destino, archivoDe(d)), png);
      await contexto.close();
      console.log(`${archivoDe(d)}  ${d.ancho}×${d.alto}@${d.dpr}  barra ${d.barra}  ${png.length} bytes  ${d.modelos}`);
    }
  } finally {
    await navegador.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await generar();
