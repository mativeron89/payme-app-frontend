import type { Page } from '@playwright/test';

/**
 * D177 · la cámara simulada de la suite e2e.
 *
 * «Nueva» abre la cámara en vivo con `getUserMedia`. El Chromium de la suite no
 * tiene cámara, así que se reemplaza `navigator.mediaDevices.getUserMedia` antes
 * de que cargue la app:
 * - `concedida` (la de `ingresar()`, por defecto): un `MediaStream` de verdad,
 *   sacado de un canvas con ruido, para que el JPEG del disparador supere el
 *   piso de 10 KB del mock como lo haría una foto;
 * - `negada`: `NotAllowedError`, como cuando la persona dice que no;
 * - `sin_camara`: `NotFoundError`;
 * - `sin_soporte`: sin `navigator.mediaDevices`, como fuera de un contexto seguro.
 *
 * Cuenta los pedidos, guarda las restricciones y cada pista, para afirmar que la
 * luz de la cámara se apaga (pista en `ended`). Un test que quiere otro modo lo
 * pide ANTES de `ingresar()`: el primero que se instala gana.
 */
export type ModoCamara = 'concedida' | 'negada' | 'sin_camara' | 'sin_soporte';

interface Registro {
  modo: ModoCamara;
  pedidos: number;
  restricciones: unknown[];
  pistas: MediaStreamTrack[];
}

const instaladas = new WeakSet<Page>();

export async function camaraSimulada(page: Page, modo: ModoCamara = 'concedida'): Promise<void> {
  if (instaladas.has(page)) return;
  instaladas.add(page);
  await page.addInitScript((m: ModoCamara) => {
    const w = window as unknown as { __camara: Registro };
    w.__camara = { modo: m, pedidos: 0, restricciones: [], pistas: [] };
    if (m === 'sin_soporte') {
      Object.defineProperty(Navigator.prototype, 'mediaDevices', { configurable: true, get: () => undefined });
      return;
    }
    const dispositivos = navigator.mediaDevices;
    if (!dispositivos) return;
    dispositivos.getUserMedia = async (restricciones?: MediaStreamConstraints) => {
      w.__camara.pedidos += 1;
      w.__camara.restricciones.push(restricciones ?? null);
      if (m === 'negada') throw new DOMException('Permission denied', 'NotAllowedError');
      if (m === 'sin_camara') throw new DOMException('Requested device not found', 'NotFoundError');
      const lienzo = document.createElement('canvas');
      lienzo.width = 640;
      lienzo.height = 480;
      const ctx = lienzo.getContext('2d')!;
      const ruido = ctx.createImageData(lienzo.width, lienzo.height);
      for (let i = 0; i < ruido.data.length; i += 4) {
        const v = Math.floor(Math.random() * 256);
        ruido.data[i] = v;
        ruido.data[i + 1] = (v * 7) & 255;
        ruido.data[i + 2] = (v * 13) & 255;
        ruido.data[i + 3] = 255;
      }
      ctx.putImageData(ruido, 0, 0);
      // Algo que se mueve, para que el stream siga entregando cuadros.
      let x = 0;
      const tic = window.setInterval(() => {
        ctx.fillStyle = '#0fb5c9';
        ctx.fillRect(x % (lienzo.width - 30), 10, 30, 30);
        x += 7;
      }, 100);
      const stream = lienzo.captureStream(10);
      for (const pista of stream.getTracks()) {
        w.__camara.pistas.push(pista);
        const detener = pista.stop.bind(pista);
        pista.stop = () => {
          window.clearInterval(tic);
          detener();
        };
      }
      return stream;
    };
  }, modo);
}

/** Cuántas pistas de cámara siguen vivas (la luz encendida). */
export const pistasVivas = (page: Page) => page.evaluate(
  () => (window as unknown as { __camara: Registro }).__camara.pistas.filter((p) => p.readyState === 'live').length,
);

/** Cuántas veces se pidió la cámara, y con qué restricciones. */
export const registroDeCamara = (page: Page) => page.evaluate(() => {
  const r = (window as unknown as { __camara: Registro }).__camara;
  return { pedidos: r.pedidos, restricciones: r.restricciones, pistas: r.pistas.length };
});
