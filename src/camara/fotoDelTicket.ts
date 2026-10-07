/**
 * D212 · la foto del ticket, preparada para el OCR con la máxima definición que
 * entra en el tope del dueño.
 *
 * Mati: «no se usa toda la cámara para escanear el ticket sino que un recuadro
 * muy pequeño». La cámara en vivo de D177 mandaba un cuadro del video (ideal
 * 1920×1080) reducido a 2048 de lado largo, y los tickets largos llegaban con la
 * letra diminuta: las fotos que fallaron pesaban de 0,36 a 0,93 MB. Ahora la
 * foto sale de la cámara nativa del teléfono (12 MP en un iPhone) y acá se
 * prepara sin tirar píxeles que el OCR necesita:
 *
 * - **Lado largo hasta 4096.** 4032×3024 pasa entera; 24 a 50 MP bajan a
 *   4096×3072. 4096² (16.777.216 px) es además el lienzo más grande que Safari
 *   de iPhone dibuja: con 4096 de lado largo entra con cualquier proporción.
 * - **Hasta 8 MiB**, el `fileSize` del dueño (`MAX_TICKET_IMAGE_BYTES`), que es
 *   el tope duro y no cambia.
 * - **Objetivo de 5.000.000 bytes** (AF-D212-SEGUIMIENTO, punto 2): la
 *   documentación de Textract se contradice entre 5 MB y 10 MB para
 *   `Document.Bytes`. Gana el primer paso de la escalera que pesa eso o menos;
 *   si ninguno, el mejor que entra en el tope, que se manda igual.
 * - **Primero baja la calidad y después los píxeles**: para leer, pesa más la
 *   resolución que la compresión. 0,75 es el piso de calidad. Medido en
 *   Chromium: un ticket de 12 MP sale entero a 0,92 en 4,14 MB, debajo del
 *   objetivo; sólo el ruido puro (el peor caso) baja a 3277×2458 a 0,75.
 * - **Siempre a JPEG, derecho y sin metadatos.** Se decodifica con `<img>`,
 *   que aplica la orientación EXIF, y se dibuja en un lienzo: el HEIC del
 *   iPhone sale JPEG (el proveedor acepta jpeg y png) y no viaja ningún dato de
 *   la foto, tampoco la ubicación GPS.
 * - **Nada sin sanear** (AF-D212-SEGUIMIENTO, punto 1): si el navegador no puede
 *   decodificar la foto (un HEIC fuera de Safari, un archivo dañado) o no puede
 *   dibujar ningún lienzo, sale `'sin_preparar'` y no se sube nada: el original
 *   podría llevar metadatos, incluida la ubicación. Antes se mandaba el original.
 *   Si Safari no puede con el lienzo de 4096², la escalera baja al lado
 *   siguiente antes de rendirse.
 *
 * La lógica no toca el DOM: decodificar y codificar se inyectan, y los tests
 * corren sin navegador. `prepararEnNavegador` es la versión real.
 */

/** El lado largo de la foto, como mucho. */
export const LADO_MAX = 4096;

/** Lo que se busca pesar, dentro del tope del dueño. */
export const OBJETIVO_BYTES = 5_000_000;

/** Las calidades al tamaño completo, de mejor a peor. */
export const CALIDADES = [0.92, 0.85, 0.75] as const;

/** Si ninguna calidad entra, el lado se achica por estos factores, con estas calidades. */
export const ESCALAS_DE_RESPALDO = [0.8, 0.64, 0.5] as const;
export const CALIDADES_DE_RESPALDO = [0.85, 0.75] as const;

/** El tamaño del lienzo: el de la foto, con el lado largo hasta `ladoMax`. */
export function tamanoObjetivo(ancho: number, alto: number, ladoMax = LADO_MAX): { ancho: number; alto: number } | null {
  if (!(ancho > 0) || !(alto > 0) || !Number.isFinite(ancho) || !Number.isFinite(alto)) return null;
  const escala = Math.min(1, ladoMax / Math.max(ancho, alto));
  return { ancho: Math.max(1, Math.round(ancho * escala)), alto: Math.max(1, Math.round(alto * escala)) };
}

export interface Paso {
  readonly ancho: number;
  readonly alto: number;
  readonly calidad: number;
}

/**
 * Los intentos, en orden: el tamaño objetivo con cada calidad y después el lado
 * achicado. Nunca agranda: una foto chica se codifica a su tamaño.
 */
export function escalera(ancho: number, alto: number): Paso[] {
  const base = tamanoObjetivo(ancho, alto);
  if (!base) return [];
  const pasos: Paso[] = CALIDADES.map((calidad) => ({ ...base, calidad }));
  for (const factor of ESCALAS_DE_RESPALDO) {
    const lado = tamanoObjetivo(base.ancho, base.alto, Math.round(Math.max(base.ancho, base.alto) * factor));
    if (!lado) continue;
    for (const calidad of CALIDADES_DE_RESPALDO) pasos.push({ ...lado, calidad });
  }
  return pasos;
}

/** Una foto decodificada: sus medidas ya orientadas, y cómo soltar lo que retiene. */
export interface FotoDecodificada<F> {
  readonly ancho: number;
  readonly alto: number;
  readonly fuente: F;
  soltar(): void;
}

export interface Herramientas<F> {
  decodificar(foto: Blob): Promise<FotoDecodificada<F> | null>;
  /** El JPEG de `fuente` a ese tamaño y calidad; `null` si el lienzo no pudo. */
  codificar(fuente: F, paso: Paso): Promise<Blob | null>;
  /** Suelta el lienzo al terminar (en Safari la memoria de lienzos es chica). */
  terminar(): void;
}

/**
 * - un JPEG preparado: lo único que se sube;
 * - `'muy_grande'`: hubo JPEG, pero ninguno entra en el tope;
 * - `'sin_preparar'`: no se pudo decodificar ni dibujar. No se sube nada.
 */
export type FotoPreparada = Blob | 'muy_grande' | 'sin_preparar';

/**
 * La foto lista para subir: el primer JPEG de la escalera que pesa hasta
 * `objetivo`; si ninguno, el primero (el de más píxeles y calidad) que entra en
 * `maxBytes`. Sin decodificar o sin ningún lienzo, `'sin_preparar'`.
 */
export async function prepararFotoDelTicket<F>(
  original: Blob,
  maxBytes: number,
  herramientas: Herramientas<F>,
  objetivo = Math.min(OBJETIVO_BYTES, maxBytes),
): Promise<FotoPreparada> {
  let foto: FotoDecodificada<F> | null = null;
  try {
    foto = await herramientas.decodificar(original);
  } catch {
    foto = null;
  }
  if (!foto) return 'sin_preparar';
  let algunLienzo = false;
  let mejorEnElTope: Blob | null = null;
  try {
    for (const paso of escalera(foto.ancho, foto.alto)) {
      let jpeg: Blob | null = null;
      try {
        jpeg = await herramientas.codificar(foto.fuente, paso);
      } catch {
        jpeg = null;
      }
      if (!jpeg || jpeg.size <= 0) continue;
      algunLienzo = true;
      if (jpeg.size <= objetivo) return jpeg;
      mejorEnElTope ??= jpeg.size <= maxBytes ? jpeg : null;
    }
  } finally {
    foto.soltar();
    herramientas.terminar();
  }
  if (mejorEnElTope) return mejorEnElTope;
  // Ningún lienzo funcionó (Safari sin memoria para 4096²... ni para 2048):
  // no se sube nada. Si hubo JPEG y ninguno entró, es que no entra.
  return algunLienzo ? 'muy_grande' : 'sin_preparar';
}

/** Las herramientas del navegador: `<img>` para decodificar, un lienzo para el JPEG. */
export function herramientasDelNavegador(doc: Document = document): Herramientas<HTMLImageElement> {
  let lienzo: HTMLCanvasElement | null = null;
  let dibujado = '';
  return {
    async decodificar(foto) {
      const url = URL.createObjectURL(foto);
      const img = doc.createElement('img');
      img.decoding = 'async';
      img.src = url;
      try {
        await img.decode();
      } catch {
        URL.revokeObjectURL(url);
        return null;
      }
      // `naturalWidth/Height` ya vienen orientadas: el `<img>` aplica el EXIF.
      if (!(img.naturalWidth > 0) || !(img.naturalHeight > 0)) {
        URL.revokeObjectURL(url);
        return null;
      }
      return {
        ancho: img.naturalWidth,
        alto: img.naturalHeight,
        fuente: img,
        soltar: () => {
          img.removeAttribute('src');
          URL.revokeObjectURL(url);
        },
      };
    },
    async codificar(img, paso) {
      lienzo ??= doc.createElement('canvas');
      const clave = `${paso.ancho}x${paso.alto}`;
      if (dibujado !== clave) {
        lienzo.width = paso.ancho;
        lienzo.height = paso.alto;
        const ctx = lienzo.getContext('2d');
        if (!ctx) return null;
        // Un PNG con transparencia sería negro en JPEG: papel blanco debajo.
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, paso.ancho, paso.alto);
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, paso.ancho, paso.alto);
        dibujado = clave;
      }
      const destino = lienzo;
      return new Promise<Blob | null>((resolver) => destino.toBlob(resolver, 'image/jpeg', paso.calidad));
    },
    terminar() {
      if (lienzo) {
        lienzo.width = 0;
        lienzo.height = 0;
      }
      lienzo = null;
      dibujado = '';
    },
  };
}

/** La versión real, con el `document` de la app. */
export function prepararEnNavegador(original: Blob, maxBytes: number): Promise<FotoPreparada> {
  return prepararFotoDelTicket(original, maxBytes, herramientasDelNavegador());
}
