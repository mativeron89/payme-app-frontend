import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

/**
 * 🔴 AF-PWA-INSTALLABILITY-DARK-A-01 · la metadata de instalación es un SEAM,
 * no una PWA.
 *
 * Lo que este archivo fija: manifest same-origin con `id`/`start_url`/`scope`
 * en la raíz, cuatro iconos locales con dimensiones exactas, y los DOS enlaces
 * de `index.html`. Y lo que fija con la misma fuerza: **lo que NO hay** —
 * service worker, Cache API, precache, claims de offline, URLs externas.
 *
 * ## Por qué se enumera lo permitido y no lo prohibido
 *
 * Una lista de lo malo falla abierta: la forma número N+1 pasa callada. Acá
 * los censos son de lo BUENO — qué `<link>` existen, qué archivos viven en
 * `public/`, qué claves tiene el manifest — y todo lo que no esté en el censo
 * pone el test en rojo, incluida la superficie autenticada de `index.html`
 * (un `<script>` exacto, el splash intacto). Los detectores de lo prohibido
 * existen ADEMÁS, como segunda línea, y cada uno tiene su caso positivo: un
 * detector sin sonda puede devolver «limpio» para siempre sin mirar nada.
 */

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..');

const MANIFEST = join(RAIZ, 'public/manifest.webmanifest');
const PWA_DIR = join(RAIZ, 'public/pwa');

// ═══════════════════════════════════════════════════════════════════════════
// Un lector de PNG suficiente: IHDR + el PRIMER pixel de la PRIMERA fila.
//
// El primer pixel es el único filter-independiente: para cualquier filtro
// 0–4 sus predictores (izquierda, arriba, Paeth) valen 0, así que sus bytes
// son el valor crudo. Cualquier otro pixel exigiría des-filtrar la imagen
// entera — por eso el IHDR de abajo exige `entrelazado: 0`: con Adam7 la
// primera fila del stream NO es la primera fila de la imagen y el truco
// dejaría de medir la esquina sin avisar.
// ═══════════════════════════════════════════════════════════════════════════

const FIRMA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function leerPng(bytes: Buffer) {
  if (!bytes.subarray(0, 8).equals(FIRMA_PNG)) throw new Error('la firma no es de PNG');
  const ancho = bytes.readUInt32BE(16);
  const alto = bytes.readUInt32BE(20);
  const profundidad = bytes[24]!;
  const color = bytes[25]!;
  const entrelazado = bytes[28]!;
  let off = 8;
  const idats: Buffer[] = [];
  while (off + 12 <= bytes.length) {
    const len = bytes.readUInt32BE(off);
    const tipo = bytes.subarray(off + 4, off + 8).toString('latin1');
    if (tipo === 'IDAT') idats.push(bytes.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const crudo = inflateSync(Buffer.concat(idats));
  const bpp = color === 6 ? 4 : 3; // 6 = RGBA · 2 = RGB opaco (sin canal alfa)
  const px = crudo.subarray(1, 1 + bpp); // byte 0 de la fila es el filtro
  const esquina = { r: px[0]!, g: px[1]!, b: px[2]!, a: color === 6 ? px[3]! : 255 };
  return { ancho, alto, profundidad, color, entrelazado, esquina };
}

/**
 * Decodifica todos los pixels para medir geometría, no sólo metadata/esquina.
 * Dark A sólo admite RGB/RGBA de 8 bits, sin Adam7: cualquier otra forma falla
 * antes de poder acreditar la safe zone.
 */
function leerRasterPng(bytes: Buffer) {
  const meta = leerPng(bytes);
  if (meta.profundidad !== 8 || ![2, 6].includes(meta.color) || meta.entrelazado !== 0) {
    throw new Error('PNG fuera del formato geométrico acreditado');
  }
  const bpp = meta.color === 6 ? 4 : 3;
  const stride = meta.ancho * bpp;
  let off = 8;
  const idats: Buffer[] = [];
  while (off + 12 <= bytes.length) {
    const len = bytes.readUInt32BE(off);
    const tipo = bytes.subarray(off + 4, off + 8).toString('latin1');
    if (tipo === 'IDAT') idats.push(bytes.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const crudo = inflateSync(Buffer.concat(idats));
  expect(crudo.length, 'scanlines PNG con longitud inesperada')
    .toBe(meta.alto * (stride + 1));
  const pixeles = Buffer.alloc(meta.alto * stride);
  const paeth = (left: number, up: number, upLeft: number): number => {
    const prediction = left + up - upLeft;
    const dl = Math.abs(prediction - left);
    const du = Math.abs(prediction - up);
    const dul = Math.abs(prediction - upLeft);
    return dl <= du && dl <= dul ? left : du <= dul ? up : upLeft;
  };
  let source = 0;
  for (let y = 0; y < meta.alto; y += 1) {
    const filtro = crudo[source++]!;
    expect(filtro, `filtro PNG desconocido en fila ${y}`).toBeLessThanOrEqual(4);
    for (let x = 0; x < stride; x += 1) {
      const raw = crudo[source++]!;
      const target = y * stride + x;
      const left = x >= bpp ? pixeles[target - bpp]! : 0;
      const up = y > 0 ? pixeles[target - stride]! : 0;
      const upLeft = y > 0 && x >= bpp ? pixeles[target - stride - bpp]! : 0;
      const predictor = filtro === 1
        ? left
        : filtro === 2
          ? up
          : filtro === 3
            ? Math.floor((left + up) / 2)
            : filtro === 4
              ? paeth(left, up, upLeft)
              : 0;
      pixeles[target] = (raw + predictor) & 0xff;
    }
  }
  return { ...meta, bpp, pixeles };
}

function contenidoFueraDeSafeZone(
  raster: ReturnType<typeof leerRasterPng>,
  fondo: readonly [number, number, number],
): Array<readonly [number, number]> {
  const centroX = (raster.ancho - 1) / 2;
  const centroY = (raster.alto - 1) / 2;
  // Maskable Icons fija como safe zone el círculo central de diámetro 80%.
  const radio = raster.ancho * 0.4;
  const fuera: Array<readonly [number, number]> = [];
  for (let y = 0; y < raster.alto; y += 1) {
    for (let x = 0; x < raster.ancho; x += 1) {
      const offset = (y * raster.ancho + x) * raster.bpp;
      const esFondo = raster.pixeles[offset] === fondo[0]
        && raster.pixeles[offset + 1] === fondo[1]
        && raster.pixeles[offset + 2] === fondo[2];
      if (!esFondo && Math.hypot(x - centroX, y - centroY) > radio) fuera.push([x, y]);
    }
  }
  return fuera;
}

/** Un PNG RGBA de 2×1 fabricado byte a byte, para probar que el lector LEE. */
function pngDePrueba(px: [number, number, number, number]): Buffer {
  const chunk = (tipo: string, datos: Buffer): Buffer => {
    const cabeza = Buffer.alloc(4);
    cabeza.writeUInt32BE(datos.length);
    // El CRC va en cero: el lector de arriba no lo verifica y esto es una
    // sonda del lector, no un PNG para un navegador.
    return Buffer.concat([cabeza, Buffer.from(tipo, 'latin1'), datos, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0); // ancho
  ihdr.writeUInt32BE(1, 4); // alto
  ihdr[8] = 8; // profundidad
  ihdr[9] = 6; // RGBA
  const fila = Buffer.from([0, ...px, 9, 9, 9, 9]); // filtro 0 + 2 pixels
  return Buffer.concat([FIRMA_PNG, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(fila)), chunk('IEND', Buffer.alloc(0))]);
}

describe('el lector de PNG lee de verdad (sonda del instrumento)', () => {
  it('🔴 dimensiones y esquina salen del binario, no de un default', () => {
    const png = leerPng(pngDePrueba([0x10, 0x1e, 0x3b, 0xff]));
    expect({ ancho: png.ancho, alto: png.alto }).toEqual({ ancho: 2, alto: 1 });
    expect(png.esquina).toEqual({ r: 0x10, g: 0x1e, b: 0x3b, a: 0xff });
    // Y con OTRO pixel da OTRA esquina — no está memorizando el caso feliz.
    expect(leerPng(pngDePrueba([1, 2, 3, 0])).esquina).toEqual({ r: 1, g: 2, b: 3, a: 0 });
  });

  it('🔴 un no-PNG se rechaza en vez de leerse en vacío', () => {
    expect(() => leerPng(Buffer.from('<svg xmlns="x"></svg>'))).toThrow(/firma/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Los cuatro iconos: existencia, MIME real (firma), dimensión exacta, esquina.
// ═══════════════════════════════════════════════════════════════════════════

const ICONOS = [
  // Full-bleed OPACO: iOS aplica su propia máscara y pinta de negro toda
  // transparencia, así que el touch icon lleva el tile hasta el borde.
  { archivo: 'icon-180.png', lado: 180, esquina: { r: 0x0f, g: 0xb5, b: 0xc9, a: 255 } },
  // `purpose: any`: el tile redondeado con las esquinas TRANSPARENTES.
  { archivo: 'icon-192.png', lado: 192, esquina: { a: 0 } },
  { archivo: 'icon-512.png', lado: 512, esquina: { a: 0 } },
  // `purpose: maskable`: fondo OPACO #101E3B de borde a borde; el tile vive
  // adentro de la safe zone (r = 40% del lado) para sobrevivir cualquier
  // recorte. La esquina opaca del color del fondo es lo que lo distingue de
  // un `any` renombrado.
  { archivo: 'icon-maskable-512.png', lado: 512, esquina: { r: 0x10, g: 0x1e, b: 0x3b, a: 255 } },
] as const;

describe('los iconos son PNG locales con dimensiones exactas', () => {
  for (const icono of ICONOS) {
    it(`🔴 ${icono.archivo}: ${icono.lado}×${icono.lado}, firma PNG y esquina correcta`, () => {
      const ruta = join(PWA_DIR, icono.archivo);
      expect(existsSync(ruta), `${icono.archivo} NO EXISTE`).toBe(true);
      const png = leerPng(readFileSync(ruta));
      expect({ ancho: png.ancho, alto: png.alto }).toEqual({ ancho: icono.lado, alto: icono.lado });
      expect(png.profundidad, 'profundidad de bits inesperada').toBe(8);
      expect(png.entrelazado, 'entrelazado: el truco del primer pixel no vale con Adam7').toBe(0);
      expect([2, 6], `tipo de color ${png.color} no contemplado`).toContain(png.color);
      if (icono.esquina.a === 0) {
        expect(png.color, 'sin canal alfa no puede haber esquina transparente').toBe(6);
        expect(png.esquina.a, 'la esquina dejó de ser transparente').toBe(0);
      } else {
        const { r, g, b, a } = png.esquina;
        expect({ r, g, b, a }).toEqual(icono.esquina);
      }
    });
  }

  it('🔴 censo de `public/pwa/`: los cuatro iconos y nada más', () => {
    expect(readdirSync(PWA_DIR).sort()).toEqual(ICONOS.map((i) => i.archivo).sort());
  });

  it('🔴 maskable: todo pixel de contenido cae dentro del círculo safe-zone de 80%', () => {
    const raster = leerRasterPng(readFileSync(join(PWA_DIR, 'icon-maskable-512.png')));
    const fondo = [0x10, 0x1e, 0x3b] as const;
    expect(contenidoFueraDeSafeZone(raster, fondo)).toEqual([]);

    // Sonda causal: el mismo instrumento debe acusar contenido agregado en
    // una esquina, fuera del círculo. Sin esto un detector vacío daría verde.
    const mutante = { ...raster, pixeles: Buffer.from(raster.pixeles) };
    mutante.pixeles[0] = 0x0f;
    mutante.pixeles[1] = 0xb5;
    mutante.pixeles[2] = 0xc9;
    expect(contenidoFueraDeSafeZone(mutante, fondo)).toContainEqual([0, 0]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// El manifest: JSON válido, raíz same-origin, y un censo de claves cerrado.
// ═══════════════════════════════════════════════════════════════════════════

/** Toda cadena hoja de un JSON, para pasarlas por el detector de externas. */
const cadenasDe = (v: unknown): string[] =>
  typeof v === 'string'
    ? [v]
    : Array.isArray(v)
      ? v.flatMap(cadenasDe)
      : v !== null && typeof v === 'object'
        ? Object.values(v).flatMap(cadenasDe)
        : [];

/** URL con esquema (`https:`, `data:`, …) o protocol-relative (`//cdn…`). */
const esExterna = (s: string): boolean => /^[a-z][a-z0-9+.-]*:/i.test(s) || s.startsWith('//');

describe('el manifest es same-origin y con alcance en la raíz', () => {
  const texto = readFileSync(MANIFEST, 'utf8');
  const manifest: Record<string, unknown> = JSON.parse(texto);

  it('🔴 censo de claves: exactamente las declaradas, sin `serviceworker` ni sorpresas', () => {
    expect(Object.keys(manifest).sort()).toEqual(
      ['background_color', 'description', 'dir', 'display', 'icons', 'id', 'lang', 'name', 'short_name', 'start_url', 'scope', 'theme_color'].sort(),
    );
  });

  it('🔴 id, start_url y scope son `/` — el alcance NO sale de la raíz', () => {
    expect(manifest.id).toBe('/');
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
  });

  it('🔴 standalone, es-MX y los colores ratificados', () => {
    expect(manifest.display).toBe('standalone');
    expect(manifest.lang).toBe('es-MX');
    expect(manifest.theme_color).toBe('#101E3B');
    expect(manifest.background_color).toBe('#101E3B');
  });

  it('🔴 ninguna cadena del manifest es una URL externa', () => {
    // Sonda primero: si el detector no detectara, lo de abajo pasaría en vacío.
    expect(esExterna('https://cdn.example/icon.png')).toBe(true);
    expect(esExterna('//cdn.example/icon.png')).toBe(true);
    expect(esExterna('data:image/png;base64,x')).toBe(true);
    expect(esExterna('/pwa/icon-192.png')).toBe(false);
    expect(cadenasDe(manifest).filter(esExterna)).toEqual([]);
  });

  it('🔴 cada icono declarado existe en disco y sus `sizes` son las REALES', () => {
    // El manifest podría decir 512 sobre un archivo de 300 y ningún navegador
    // lo denunciaría a tiempo: se compara la declaración contra el binario.
    const iconos = manifest.icons as Array<{ src: string; sizes: string; type: string; purpose: string }>;
    expect(iconos.map((i) => [i.src, i.sizes, i.type, i.purpose])).toEqual([
      ['/pwa/icon-192.png', '192x192', 'image/png', 'any'],
      ['/pwa/icon-512.png', '512x512', 'image/png', 'any'],
      ['/pwa/icon-maskable-512.png', '512x512', 'image/png', 'maskable'],
    ]);
    for (const icono of iconos) {
      const png = leerPng(readFileSync(join(RAIZ, 'public', icono.src)));
      expect(`${png.ancho}x${png.alto}`, `${icono.src}: sizes declara otra cosa`).toBe(icono.sizes);
    }
  });

  it('🔴 ni el manifest ni index.html reclaman offline', () => {
    expect(/\boffline\b/i.test(texto)).toBe(false);
    // En el HTML se mira el contenido EFECTIVO: los comentarios documentan
    // justamente que offline NO existe, y un comentario no ejecuta nada.
    expect(/\boffline\b/i.test(htmlEfectivo())).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// index.html: los enlaces nuevos y la superficie autenticada SIN tocar.
// ═══════════════════════════════════════════════════════════════════════════

const htmlCrudo = (): string => readFileSync(join(RAIZ, 'index.html'), 'utf8');
/** El HTML sin comentarios: lo único que un navegador ejecuta o pide. */
const htmlEfectivo = (): string => htmlCrudo().replace(/<!--[\s\S]*?-->/g, '');

describe('index.html enlaza la instalación sin cambiar la superficie autenticada', () => {
  it('🔴 censo de `<link>`: favicon, manifest y apple-touch-icon — exactamente', () => {
    const links = [...htmlEfectivo().matchAll(/<link\b[^>]*>/g)].map((m) => m[0]);
    const atributo = (tag: string, nombre: string): string | undefined =>
      tag.match(new RegExp(`${nombre}="([^"]*)"`))?.[1];
    expect(links.map((l) => [atributo(l, 'rel'), atributo(l, 'href')])).toEqual([
      ['icon', '/favicon.svg'],
      ['manifest', '/manifest.webmanifest'],
      ['apple-touch-icon', '/pwa/icon-180.png'],
    ]);
  });

  it('🔴 el manifest y el touch icon enlazados EXISTEN emitibles en `public/`', () => {
    expect(existsSync(MANIFEST)).toBe(true);
    expect(existsSync(join(PWA_DIR, 'icon-180.png'))).toBe(true);
  });

  it('🔴 la superficie autenticada sigue idéntica: un script, el splash, el theme-color', () => {
    const efectivo = htmlEfectivo();
    const scripts = [...efectivo.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
    expect(scripts).toEqual(['<script type="module" src="/src/main.tsx">']);
    expect(efectivo).toContain('<div id="splash" aria-hidden="true">');
    expect(efectivo).toContain('<meta name="theme-color" content="#101E3B" />');
    expect(efectivo).toContain('<div id="root"></div>');
  });

  it('🔴 todo `href`/`src` efectivo es root-relative — cero destinos externos', () => {
    const destinos = [...htmlEfectivo().matchAll(/\b(?:href|src)="([^"]*)"/g)].map((m) => m[1]!);
    // Sonda de población: si el parser dejara de encontrar destinos, el
    // filtro de abajo aprobaría un archivo que no leyó.
    expect(destinos.length).toBeGreaterThanOrEqual(4);
    expect(destinos.filter((d) => esExterna(d) || !d.startsWith('/'))).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PWA B1 (AF-PWA-INSTALLABILITY-STAGE-B-01, sub-orden B1, 2026-09-18): los
// tres `<meta name="apple-mobile-web-app-*">` que iOS lee para "Agregar a
// inicio". B1 es sólo metadata; el service worker llegó después con B2 y se
// fija más abajo.
// ═══════════════════════════════════════════════════════════════════════════

describe('index.html declara los tres metadatos iOS de instalación (B1)', () => {
  const atributo = (tag: string, nombre: string): string | undefined =>
    tag.match(new RegExp(`${nombre}="([^"]*)"`))?.[1];

  it('🔴 censo de `<meta apple-mobile-web-app-*>`: capable, status-bar-style, title — exactamente', () => {
    const metas = [...htmlEfectivo().matchAll(/<meta\b[^>]*name="apple-mobile-web-app-[^"]*"[^>]*>/g)]
      .map((m) => m[0]);
    expect(metas.map((m) => [atributo(m, 'name'), atributo(m, 'content')])).toEqual([
      ['apple-mobile-web-app-capable', 'yes'],
      ['apple-mobile-web-app-status-bar-style', 'black-translucent'],
      ['apple-mobile-web-app-title', 'PayMe'],
    ]);
  });

  it('🔴 el título iOS es EXACTAMENTE el `short_name` del manifest — no un texto aparte', () => {
    const manifest: Record<string, unknown> = JSON.parse(readFileSync(MANIFEST, 'utf8'));
    const tituloTag = [...htmlEfectivo().matchAll(/<meta\b[^>]*>/g)]
      .map((m) => m[0])
      .find((m) => atributo(m, 'name') === 'apple-mobile-web-app-title');
    expect(tituloTag, 'no se encontró el meta de título iOS').toBeDefined();
    expect(atributo(tituloTag!, 'content')).toBe(manifest.short_name);
  });

  /**
   * 🔴 MUTANTE: si el título iOS se separara del `short_name` del manifest
   * —alguien tipea "Pay Me" o "PayMe App" a mano en vez de repetir el
   * `short_name`—, el test de arriba tiene que cazarlo. Se prueba la MISMA
   * comparación sobre un HTML mutado, no sólo se afirma que "debería" fallar.
   */
  it('🔴 MUTANTE: un título iOS que se aparta del `short_name` rompe el test anterior', () => {
    const manifest: Record<string, unknown> = JSON.parse(readFileSync(MANIFEST, 'utf8'));
    const htmlMutado = htmlEfectivo().replace(
      '<meta name="apple-mobile-web-app-title" content="PayMe" />',
      '<meta name="apple-mobile-web-app-title" content="Pay Me App" />',
    );
    expect(htmlMutado, 'el reemplazo no encontró el tag original: el mutante no se plantó')
      .not.toBe(htmlEfectivo());
    const tituloMutado = [...htmlMutado.matchAll(/<meta\b[^>]*>/g)]
      .map((m) => m[0])
      .find((m) => atributo(m, 'name') === 'apple-mobile-web-app-title');
    expect(atributo(tituloMutado!, 'content')).not.toBe(manifest.short_name);
  });

  it('🔴 index.html no nombra el service worker: B1 es sólo metadata', () => {
    // B2 registra el service worker desde `main.tsx`, no desde el HTML: los
    // meta tags de iOS siguen sin ser una puerta de entrada al mecanismo.
    expect(MECANISMO_SW.some(([patron]) => patron.test(htmlEfectivo()))).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B2 · EXACTAMENTE ESTE service worker (APP-PWA-B2-SERVICE-WORKER-AF-15).
//
// Hasta 0.165.x este bloque prohibía el mecanismo entero: era la línea «Dark A,
// metadata sí, offline no». Mati eligió el 2026-09-18 «Sí, sólo para archivos
// estáticos (Recomendada)», y el bloque pasa de PROHIBIR a FIJAR la superficie:
//
//   · en qué archivos de `src/` puede vivir el mecanismo —censo de lo BUENO:
//     cualquier archivo nuevo que lo nombre pone esto en rojo—;
//   · que `/sw.js` nace del BUILD y no de una copia suelta en `public/`;
//   · que el build real lo emite y el mock NO;
//   · que `main.tsx` lo registra sólo desde la app privada;
//   · que `index.html` y el manifest siguen sin nombrarlo.
//
// Lo que el service worker HACE —qué cachea, qué deja pasar, cómo se retira— lo
// prueba `src/sw/serviceWorker.test.ts` contra el artefacto emitido.
//
// Se mira el CÓDIGO EFECTIVO, sin comentarios: un comentario que explica el
// service worker no es el mecanismo.
// ═══════════════════════════════════════════════════════════════════════════

const MECANISMO_SW: ReadonlyArray<readonly [RegExp, string]> = [
  [/service[\s_-]?worker/i, 'service worker (registro, archivo o clave de manifest)'],
  [/\bcaches\s*[.[]/, 'Cache API'],
  [/CacheStorage/i, 'Cache API (constructor)'],
  [/workbox/i, 'workbox'],
  [/precache/i, 'precache'],
  [/importScripts/i, 'importScripts (cuerpo de un worker)'],
];

/** Los ÚNICOS archivos de `src/` (sin tests) donde el mecanismo puede aparecer. */
const DONDE_VIVE_EL_SW = [
  'src/main.tsx', // lo registra, sólo desde la app privada
  'src/sw/artefacto.ts', // de la plantilla al /sw.js servido
  'src/sw/registrar.ts', // decide si corresponde registrar
  'src/sw/serviceWorker.js', // el service worker mismo (plantilla)
];

function codigoEfectivo(texto: string): string {
  return texto
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"\\])\/\/[^\n]*/gm, '$1');
}

function archivosBajo(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name));
}

describe('B2 · el service worker vive en un lugar y en ningún otro', () => {
  it('🔴 SONDA · el detector detecta las formas reales, y un comentario NO cuenta', () => {
    const casos = [
      'navigator.serviceWorker.register("/sw.js")',
      '"serviceworker": { "src": "sw.js" }',
      'caches.open("v1")',
      'self.importScripts("precache-manifest.js")',
    ];
    for (const caso of casos) {
      expect(MECANISMO_SW.some(([patron]) => patron.test(codigoEfectivo(caso))), `no cazó: ${caso}`).toBe(true);
    }
    const soloComentario = '/* acá no hay service worker */\n// ni caches.open\nconst x = 1;';
    expect(MECANISMO_SW.some(([patron]) => patron.test(codigoEfectivo(soloComentario)))).toBe(false);
  });

  it('🔴 censo: en `src/` el mecanismo aparece EXACTAMENTE en estos cuatro archivos', () => {
    const fuentes = archivosBajo(join(RAIZ, 'src'))
      .filter((r) => /\.(ts|tsx|js)$/.test(r) && !/\.test\.tsx?$/.test(r));
    // Sonda de población: `src/` tiene que haberse leído de verdad.
    expect(fuentes.length, 'el barrido no encontró casi nada: ¿se movió `src/`?').toBeGreaterThan(50);

    const con = fuentes
      .filter((r) => MECANISMO_SW.some(([patron]) => patron.test(codigoEfectivo(readFileSync(r, 'utf8')))))
      .map((r) => r.slice(RAIZ.length + 1))
      .sort();
    expect(con, 'el mecanismo apareció fuera de su lugar, o dejó de estar donde debía').toEqual(DONDE_VIVE_EL_SW);
  });

  it('🔴 ni el HTML efectivo ni `public/` contienen el mecanismo', () => {
    const EXTENSIONES_TEXTO = /\.(css|html|webmanifest|svg|txt|json|md)$/;
    const fuentes: Array<{ nombre: string; texto: string }> = [
      { nombre: 'index.html (efectivo)', texto: htmlEfectivo() },
      ...archivosBajo(join(RAIZ, 'public'))
        .filter((r) => EXTENSIONES_TEXTO.test(r))
        .map((r) => ({ nombre: r.slice(RAIZ.length + 1), texto: readFileSync(r, 'utf8') })),
    ];
    expect(fuentes.length, 'no se leyó `public/`').toBeGreaterThan(3);
    const hallazgos = fuentes.flatMap(({ nombre, texto }) =>
      MECANISMO_SW.filter(([patron]) => patron.test(texto)).map(([, etiqueta]) => `${nombre}: ${etiqueta}`));
    expect(hallazgos).toEqual([]);
  });

  it('🔴 `public/` no emite NINGÚN script — el sw.js nace del build, no de una copia suelta', () => {
    // Una copia en `public/` se sirve tal cual: la versión del caché tendría que
    // escribirse a mano en un segundo lugar y se desincronizaría sin avisar.
    const scripts = archivosBajo(join(RAIZ, 'public')).filter((r) => /\.(js|mjs|cjs)$/.test(r));
    expect(scripts).toEqual([]);
  });

  it('🔴 main.tsx toca el service worker SÓLO desde la app privada, nunca desde las páginas públicas', () => {
    // 🔴 No alcanza con ubicar la llamada a `registrarServiceWorker`: un
    // `navigator.serviceWorker.register(...)` escrito directo en la superficie
    // pública no la nombra, y `main.tsx` ya figura en el censo de arriba, así
    // que ése tampoco lo vería. Se ubica CADA rastro del mecanismo —y el import
    // de `./sw/`— y todos tienen que caer adentro de `arrancarPrivada`.
    const main = codigoEfectivo(readFileSync(join(RAIZ, 'src/main.tsx'), 'utf8'));
    const privada = main.indexOf('async function arrancarPrivada');
    const publica = main.indexOf('function montarSuperficiePublica');
    expect(privada, 'no se encontró arrancarPrivada').toBeGreaterThan(0);
    expect(publica, 'no se encontró montarSuperficiePublica').toBeGreaterThan(privada);

    const patrones = [...MECANISMO_SW.map(([p]) => p), /['"]\.\/sw\//];
    const posiciones = patrones.flatMap((p) =>
      [...main.matchAll(new RegExp(p.source, p.flags.includes('g') ? p.flags : `${p.flags}g`))].map((m) => m.index!));
    // Control positivo: si no hubiera nada que ubicar, el filtro de abajo pasaría en vacío.
    expect(posiciones.length, 'main.tsx no registra el service worker en ningún lado').toBeGreaterThan(0);
    const fuera = posiciones.filter((pos) => !(pos > privada && pos < publica));
    expect(fuera, 'hay rastros del service worker FUERA de arrancarPrivada').toEqual([]);
    expect([...main.matchAll(/registrarServiceWorker\s*\(/g)].length, 'se esperaba UNA llamada').toBe(1);
  });
});

describe('B2 · el build real emite /sw.js y el mock no', () => {
  interface PluginSW {
    name: string;
    config: (c: unknown, e: { mode: string }) => void;
    generateBundle: (this: { emitFile: (a: { type: string; fileName: string; source: string }) => void }) => void;
  }

  async function plugin(): Promise<PluginSW> {
    const { default: config } = await import('../vite.config');
    const plugins = (config as { plugins: unknown[] }).plugins.flat() as Array<{ name?: string }>;
    const p = plugins.find((x) => x?.name === 'payme-service-worker');
    expect(p, 'vite.config.ts no declara el plugin del service worker').toBeDefined();
    return p as unknown as PluginSW;
  }

  function emitidos(p: PluginSW, mode: string) {
    const out: Array<{ fileName: string; source: string }> = [];
    p.config({}, { mode });
    p.generateBundle.call({ emitFile: (a) => { out.push(a); } });
    return out;
  }

  it('🔴 build real: emite exactamente `sw.js`, con la versión del package.json', async () => {
    const { version } = JSON.parse(readFileSync(join(RAIZ, 'package.json'), 'utf8')) as { version: string };
    const out = emitidos(await plugin(), 'production');
    expect(out.map((a) => a.fileName)).toEqual(['sw.js']);
    expect(out[0]!.source).toContain(`const VERSION = '${version}';`);
  });

  it('🔴 build mock: NO emite nada — el riel de desarrollo no tiene service worker', async () => {
    expect(emitidos(await plugin(), 'mock')).toEqual([]);
  });
});
