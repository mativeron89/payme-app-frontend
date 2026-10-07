import { describe, expect, it } from 'vitest';
import {
  CALIDADES,
  escalera,
  LADO_MAX,
  prepararFotoDelTicket,
  tamanoObjetivo,
  type Herramientas,
  type Paso,
} from './fotoDelTicket';

/** El tope del dueño: `fileSize: 8 * 1024 * 1024` en `routes/ocr.js`. */
const TOPE = 8 * 1024 * 1024;
const MiB = 1024 * 1024;
/** MiB a bytes enteros. */
const mib = (n: number) => Math.round(n * MiB);

const blob = (bytes: number, type = 'image/jpeg') => new Blob([new Uint8Array(Math.round(bytes))], { type });

/**
 * Herramientas falsas: la foto decodificada mide `ancho×alto` y cada JPEG pesa
 * lo que diga `pesar(paso)` (`null` = el lienzo no pudo). Anota cada paso.
 */
function falsas(
  ancho: number,
  alto: number,
  pesar: (paso: Paso) => number | null,
  opciones: { decodifica?: boolean | 'tira' } = {},
) {
  const pasos: Paso[] = [];
  const registro = { soltada: 0, terminada: 0 };
  const h: Herramientas<string> = {
    async decodificar() {
      if (opciones.decodifica === 'tira') throw new Error('no se pudo');
      if (opciones.decodifica === false) return null;
      return { ancho, alto, fuente: 'foto', soltar: () => { registro.soltada += 1; } };
    },
    async codificar(_fuente, paso) {
      pasos.push(paso);
      const bytes = pesar(paso);
      return bytes === null ? null : blob(bytes);
    },
    terminar() {
      registro.terminada += 1;
    },
  };
  return { h, pasos, registro };
}

describe('D212 · tamanoObjetivo: el lado largo hasta 4096, sin agrandar', () => {
  it('una foto de 12 MP del iPhone (4032×3024) pasa entera, horizontal o vertical', () => {
    expect(tamanoObjetivo(4032, 3024)).toEqual({ ancho: 4032, alto: 3024 });
    expect(tamanoObjetivo(3024, 4032)).toEqual({ ancho: 3024, alto: 4032 });
  });

  it('24, 48 o 50 MP bajan a 4096 de lado largo, con la misma proporción', () => {
    expect(tamanoObjetivo(8160, 6120)).toEqual({ ancho: 4096, alto: 3072 });
    expect(tamanoObjetivo(5712, 4284)).toEqual({ ancho: 4096, alto: 3072 });
    expect(tamanoObjetivo(6120, 8160)).toEqual({ ancho: 3072, alto: 4096 });
    expect(tamanoObjetivo(6000, 4500)).toEqual({ ancho: 4096, alto: 3072 });
  });

  it('4096² es el lienzo más grande de Safari en iPhone: ningún tamaño lo pasa', () => {
    expect(LADO_MAX).toBe(4096);
    for (const [a, b] of [[8000, 8000], [10000, 1000], [4097, 4097], [20000, 15000]] as const) {
      const t = tamanoObjetivo(a, b)!;
      expect(Math.max(t.ancho, t.alto)).toBeLessThanOrEqual(4096);
      expect(t.ancho * t.alto).toBeLessThanOrEqual(4096 * 4096);
    }
  });

  it('una foto chica no se agranda', () => {
    expect(tamanoObjetivo(1920, 1080)).toEqual({ ancho: 1920, alto: 1080 });
  });

  it('medidas inválidas: null', () => {
    expect(tamanoObjetivo(0, 100)).toBeNull();
    expect(tamanoObjetivo(100, -1)).toBeNull();
    expect(tamanoObjetivo(Number.NaN, 100)).toBeNull();
    expect(tamanoObjetivo(Number.POSITIVE_INFINITY, 100)).toBeNull();
  });
});

describe('D212 · escalera: primero baja la calidad, después el lado', () => {
  const pasos = escalera(4032, 3024);

  it('al tamaño completo, 0,92 → 0,85 → 0,75', () => {
    expect(CALIDADES).toEqual([0.92, 0.85, 0.75]);
    expect(pasos.slice(0, 3)).toEqual([
      { ancho: 4032, alto: 3024, calidad: 0.92 },
      { ancho: 4032, alto: 3024, calidad: 0.85 },
      { ancho: 4032, alto: 3024, calidad: 0.75 },
    ]);
  });

  it('después, el lado ×0,8, ×0,64 y ×0,5, cada uno con 0,85 y 0,75', () => {
    const resto = pasos.slice(3);
    expect(resto.map((p) => Math.max(p.ancho, p.alto))).toEqual([3226, 3226, 2580, 2580, 2016, 2016]);
    expect(resto.map((p) => p.calidad)).toEqual([0.85, 0.75, 0.85, 0.75, 0.85, 0.75]);
  });

  it('el lado nunca crece de un paso al siguiente y ninguno pasa 4096', () => {
    const grande = escalera(8160, 6120);
    expect(grande[0]).toEqual({ ancho: 4096, alto: 3072, calidad: 0.92 });
    for (let i = 1; i < grande.length; i += 1) {
      expect(grande[i]!.ancho).toBeLessThanOrEqual(grande[i - 1]!.ancho);
    }
  });

  it('sin medidas, sin pasos', () => {
    expect(escalera(0, 0)).toEqual([]);
  });
});

describe('D212 · prepararFotoDelTicket', () => {
  it('🔴 el ticket de 12 MP entra al primer paso: 4032×3024 a 0,92, sin reducir', async () => {
    const { h, pasos, registro } = falsas(4032, 3024, () => mib(3.61));
    const foto = await prepararFotoDelTicket(blob(2.7 * MiB), TOPE, h);
    expect(foto).not.toBe('muy_grande');
    expect((foto as Blob).type).toBe('image/jpeg');
    expect(pasos).toEqual([{ ancho: 4032, alto: 3024, calidad: 0.92 }]);
    expect(registro).toEqual({ soltada: 1, terminada: 1 });
  });

  it('🔴 la primera calidad que entra en 8 MiB, sin bajar píxeles', async () => {
    const pesos: Record<number, number> = { 0.92: mib(10.5), 0.85: mib(8.55), 0.75: mib(6.87) };
    const { h, pasos } = falsas(4096, 3072, (p) => pesos[p.calidad] ?? 1);
    const foto = await prepararFotoDelTicket(blob(1000), TOPE, h);
    expect((foto as Blob).size).toBe(mib(6.87));
    expect(pasos.map((p) => [p.ancho, p.calidad])).toEqual([[4096, 0.92], [4096, 0.85], [4096, 0.75]]);
  });

  it('justo 8 MiB entra; un byte más no', async () => {
    const enElTope = falsas(4032, 3024, () => TOPE);
    expect(((await prepararFotoDelTicket(blob(10), TOPE, enElTope.h)) as Blob).size).toBe(TOPE);
    const unoMas = falsas(4032, 3024, (p) => (p.ancho === 4032 ? TOPE + 1 : 100));
    const foto = await prepararFotoDelTicket(blob(10), TOPE, unoMas.h);
    expect(unoMas.pasos[3]).toEqual({ ancho: 3226, alto: 2420, calidad: 0.85 });
    expect((foto as Blob).size).toBe(100);
  });

  it('si ningún paso entra: «muy_grande»', async () => {
    const { h, pasos, registro } = falsas(4032, 3024, () => 9 * MiB);
    expect(await prepararFotoDelTicket(blob(1000), TOPE, h)).toBe('muy_grande');
    expect(pasos).toHaveLength(9);
    expect(registro).toEqual({ soltada: 1, terminada: 1 });
  });

  it('🔴 un HEIC que el navegador decodifica sale JPEG, aunque el original ya entre en el tope', async () => {
    const heic = blob(1.8 * MiB, 'image/heic');
    const { h, pasos } = falsas(4032, 3024, () => 3 * MiB);
    const foto = await prepararFotoDelTicket(heic, TOPE, h);
    expect(foto).not.toBe(heic);
    expect((foto as Blob).type).toBe('image/jpeg');
    expect(pasos).toHaveLength(1);
  });

  it('🔴 un JPEG que ya entra también se vuelve a codificar: sale derecho y sin metadatos', async () => {
    const jpeg = blob(2.7 * MiB, 'image/jpeg');
    const { h, pasos } = falsas(3024, 4032, () => 3 * MiB);
    const foto = await prepararFotoDelTicket(jpeg, TOPE, h);
    expect(foto).not.toBe(jpeg);
    expect(pasos).toEqual([{ ancho: 3024, alto: 4032, calidad: 0.92 }]);
  });

  describe('respaldo, como antes de D212', () => {
    it('🔴 sin decodificar (HEIC fuera de Safari, archivo dañado): el original si entra en el tope', async () => {
      const heic = blob(2 * MiB, 'image/heic');
      const { h, pasos } = falsas(1, 1, () => 1, { decodifica: false });
      expect(await prepararFotoDelTicket(heic, TOPE, h)).toBe(heic);
      expect(pasos).toEqual([]);
    });

    it('si decodificar tira, igual', async () => {
      const original = blob(1000);
      const { h } = falsas(1, 1, () => 1, { decodifica: 'tira' });
      expect(await prepararFotoDelTicket(original, TOPE, h)).toBe(original);
    });

    it('sin decodificar y más grande que el tope: «muy_grande»', async () => {
      const { h } = falsas(1, 1, () => 1, { decodifica: false });
      expect(await prepararFotoDelTicket(blob(TOPE + 1), TOPE, h)).toBe('muy_grande');
    });

    it('🔴 Safari sin lienzo de 4096²: baja al lado siguiente', async () => {
      const { h, pasos } = falsas(4096, 3072, (p) => (p.ancho === 4096 ? null : 2 * MiB));
      const foto = await prepararFotoDelTicket(blob(1000), TOPE, h);
      expect((foto as Blob).size).toBe(2 * MiB);
      expect(pasos.map((p) => p.ancho)).toEqual([4096, 4096, 4096, 3277]);
    });

    it('🔴 sin ningún lienzo: el original si entra, y se sueltan foto y lienzo', async () => {
      const original = blob(2.7 * MiB);
      const { h, pasos, registro } = falsas(4032, 3024, () => null);
      expect(await prepararFotoDelTicket(original, TOPE, h)).toBe(original);
      expect(pasos).toHaveLength(9);
      expect(registro).toEqual({ soltada: 1, terminada: 1 });
    });

    it('un JPEG vacío cuenta como lienzo fallido', async () => {
      const original = blob(1000);
      const { h } = falsas(4032, 3024, () => 0);
      expect(await prepararFotoDelTicket(original, TOPE, h)).toBe(original);
    });

    it('si codificar tira, sigue con el paso siguiente y suelta todo', async () => {
      let n = 0;
      const { h, registro } = falsas(4032, 3024, () => 500);
      const codificar = h.codificar.bind(h);
      h.codificar = async (f, p) => {
        n += 1;
        if (n === 1) throw new Error('lienzo');
        return codificar(f, p);
      };
      expect(((await prepararFotoDelTicket(blob(10), TOPE, h)) as Blob).size).toBe(500);
      expect(registro).toEqual({ soltada: 1, terminada: 1 });
    });
  });
});
