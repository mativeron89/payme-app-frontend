/**
 * D177 · decisión de Mati: «Nueva» abre la cámara directo. La cámara trasera en
 * vivo con `getUserMedia`; al disparar, el cuadro se convierte a JPEG (también
 * evita el HEIC del iPhone) y sigue el OCR de siempre.
 *
 * Acá viven las piezas sin React, para probarlas sin navegador: qué pedir, cómo
 * leer un error, cómo apagar y cómo convertir el cuadro respetando el tope.
 */

/** Por qué no hay cámara en vivo; cada uno termina en la galería con un aviso. */
export type SinCamara = 'negada' | 'sin_camara' | 'sin_soporte' | 'error';
export type EstadoCamara = 'apagada' | 'abriendo' | 'lista' | SinCamara;

/** ¿El paso 1 se queda sin cámara en vivo? Entonces va la galería con un aviso. */
export function sinCamaraEnVivo(estado: EstadoCamara): estado is SinCamara {
  return estado === 'negada' || estado === 'sin_camara' || estado === 'sin_soporte' || estado === 'error';
}

/** Cámara trasera, sin audio. `ideal` y no `exact`: una laptop sin trasera igual abre la que tenga. */
export const RESTRICCIONES: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: { ideal: 'environment' },
    width: { ideal: 1920 },
    height: { ideal: 1080 },
  },
};

/**
 * ¿Se puede pedir la cámara? Fuera de un contexto seguro (`https` o
 * `localhost`) el navegador no expone `mediaDevices`.
 */
export function camaraDisponible(win: Pick<Window, 'isSecureContext' | 'navigator'>): boolean {
  return win.isSecureContext === true && typeof win.navigator.mediaDevices?.getUserMedia === 'function';
}

/** El error de `getUserMedia`, por su nombre DOM. */
export function clasificarErrorDeCamara(error: unknown): SinCamara {
  const nombre = typeof error === 'object' && error !== null && 'name' in error
    ? String((error as { name: unknown }).name)
    : '';
  if (nombre === 'NotAllowedError' || nombre === 'SecurityError' || nombre === 'PermissionDeniedError') return 'negada';
  if (nombre === 'NotFoundError' || nombre === 'DevicesNotFoundError'
      || nombre === 'OverconstrainedError' || nombre === 'NotReadableError') return 'sin_camara';
  return 'error';
}

/** Apaga cada pista: sin esto la luz de la cámara queda encendida. */
export function apagar(stream: MediaStream | null | undefined): void {
  for (const pista of stream?.getTracks() ?? []) pista.stop();
}

/** El lado largo de la foto, como mucho: de sobra para leer un ticket. */
export const LADO_MAX = 2048;

/** El tamaño del lienzo: el del video, con el lado largo hasta `ladoMax`. */
export function tamanoDeCaptura(ancho: number, alto: number, ladoMax = LADO_MAX): { ancho: number; alto: number } | null {
  if (!(ancho > 0) || !(alto > 0)) return null;
  const escala = Math.min(1, ladoMax / Math.max(ancho, alto));
  return { ancho: Math.round(ancho * escala), alto: Math.round(alto * escala) };
}

/** De mejor a peor: la primera que entre en el tope. */
export const CALIDADES = [0.9, 0.8, 0.7, 0.6, 0.5] as const;

/**
 * Codifica con la mejor calidad que entra en `maxBytes`. Si ni la peor entra,
 * `null`: la pantalla lo trata como «la foto pesa más de 8 MB».
 */
export async function jpegDentroDelTope(
  codificar: (calidad: number) => Promise<Blob | null>,
  maxBytes: number,
): Promise<Blob | null> {
  for (const calidad of CALIDADES) {
    const blob = await codificar(calidad);
    if (blob && blob.size > 0 && blob.size <= maxBytes) return blob;
  }
  return null;
}

/** Lo que sale de disparar: la foto, o por qué no hay. */
export type Captura = Blob | 'sin_cuadro' | 'muy_grande';

/**
 * Saca el cuadro actual del video como JPEG. `sin_cuadro` si el video todavía no
 * tiene imagen; `muy_grande` si ni con la peor calidad entra en el tope.
 */
export async function capturarFoto(video: HTMLVideoElement, maxBytes: number): Promise<Captura> {
  const tamano = tamanoDeCaptura(video.videoWidth, video.videoHeight);
  if (!tamano) return 'sin_cuadro';
  const lienzo = video.ownerDocument.createElement('canvas');
  lienzo.width = tamano.ancho;
  lienzo.height = tamano.alto;
  const ctx = lienzo.getContext('2d');
  if (!ctx) return 'sin_cuadro';
  ctx.drawImage(video, 0, 0, tamano.ancho, tamano.alto);
  const blob = await jpegDentroDelTope(
    (calidad) => new Promise((resolver) => lienzo.toBlob(resolver, 'image/jpeg', calidad)),
    maxBytes,
  );
  return blob ?? 'muy_grande';
}
