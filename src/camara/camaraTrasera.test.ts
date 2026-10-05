import { describe, expect, it } from 'vitest';
import {
  apagar,
  CALIDADES,
  camaraDisponible,
  clasificarErrorDeCamara,
  jpegDentroDelTope,
  LADO_MAX,
  RESTRICCIONES,
  sinCamaraEnVivo,
  tamanoDeCaptura,
} from './camaraTrasera';

/**
 * D177 · las piezas de la cámara sin React. El ciclo de vida en el navegador
 * (abrir, apagar al salir o en segundo plano, volver a abrir) lo prueba
 * `e2e/camara-directa.spec.ts` con `getUserMedia` simulado.
 */
const error = (name: string) => Object.assign(new Error(name), { name });

describe('D177 · cámara trasera', () => {
  it('🔴 pide la trasera, sin audio, y con `ideal`: una laptop sin trasera igual abre la que tenga', () => {
    expect(RESTRICCIONES.audio).toBe(false);
    expect(RESTRICCIONES.video).toMatchObject({ facingMode: { ideal: 'environment' } });
  });

  it('🔴 sólo en contexto seguro y con getUserMedia', () => {
    const con = { getUserMedia: () => Promise.resolve({} as MediaStream) };
    expect(camaraDisponible({ isSecureContext: true, navigator: { mediaDevices: con } as unknown as Navigator })).toBe(true);
    expect(camaraDisponible({ isSecureContext: false, navigator: { mediaDevices: con } as unknown as Navigator })).toBe(false);
    expect(camaraDisponible({ isSecureContext: true, navigator: {} as Navigator })).toBe(false);
  });

  it.each([
    ['NotAllowedError', 'negada'],
    ['SecurityError', 'negada'],
    ['NotFoundError', 'sin_camara'],
    ['OverconstrainedError', 'sin_camara'],
    ['NotReadableError', 'sin_camara'],
    ['AbortError', 'error'],
    ['TypeError', 'error'],
  ] as const)('%s → %s', (nombre, esperado) => {
    expect(clasificarErrorDeCamara(error(nombre))).toBe(esperado);
  });

  it('un error sin nombre, o que no es un error, es «error»', () => {
    expect(clasificarErrorDeCamara('no')).toBe('error');
    expect(clasificarErrorDeCamara(null)).toBe('error');
  });

  it('🔴 sin cámara en vivo ⇒ galería: negada, sin cámara, sin soporte o error; no al abrir ni lista', () => {
    for (const e of ['negada', 'sin_camara', 'sin_soporte', 'error'] as const) expect(sinCamaraEnVivo(e)).toBe(true);
    for (const e of ['apagada', 'abriendo', 'lista'] as const) expect(sinCamaraEnVivo(e)).toBe(false);
  });

  it('🔴 apagar para TODAS las pistas (si no, queda la luz encendida)', () => {
    const paradas: string[] = [];
    const stream = {
      getTracks: () => ['video', 'otra'].map((id) => ({ stop: () => paradas.push(id) })),
    } as unknown as MediaStream;
    apagar(stream);
    expect(paradas).toEqual(['video', 'otra']);
    expect(() => apagar(null)).not.toThrow();
  });

  it('el tamaño de la foto: el del video, con el lado largo hasta 2048', () => {
    expect(LADO_MAX).toBe(2048);
    expect(tamanoDeCaptura(1920, 1080)).toEqual({ ancho: 1920, alto: 1080 });
    expect(tamanoDeCaptura(4032, 3024)).toEqual({ ancho: 2048, alto: 1536 });
    expect(tamanoDeCaptura(3024, 4032)).toEqual({ ancho: 1536, alto: 2048 });
    expect(tamanoDeCaptura(0, 1080)).toBeNull();
    expect(tamanoDeCaptura(Number.NaN, 1080)).toBeNull();
  });

  it('🔴 el JPEG: la mejor calidad que entra en el tope; si ninguna entra, null', async () => {
    const pesos: Record<number, number> = { 0.9: 900, 0.8: 700, 0.7: 500, 0.6: 300, 0.5: 100 };
    const pedidas: number[] = [];
    const codificar = async (q: number) => {
      pedidas.push(q);
      return new Blob([new Uint8Array(pesos[q]!)], { type: 'image/jpeg' });
    };
    expect((await jpegDentroDelTope(codificar, 1000))!.size).toBe(900);
    expect((await jpegDentroDelTope(codificar, 600))!.size).toBe(500);
    expect(await jpegDentroDelTope(codificar, 50)).toBeNull();
    expect(pedidas.slice(-CALIDADES.length)).toEqual([...CALIDADES]);
  });

  it('un toBlob que no devuelve nada no cuenta como foto', async () => {
    expect(await jpegDentroDelTope(async () => null, 1000)).toBeNull();
  });
});
