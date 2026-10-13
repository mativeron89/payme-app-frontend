/**
 * Tipos de `imagenes-de-arranque.mjs` (D300): la tabla de tamaños y el PNG, sin efectos al importarse. El generador es
 * un `.mjs` porque se corre con `node`; sus tipos se declaran acá, como `aliasesLib.d.mts`.
 */

/** Un tamaño de iPhone en vertical. `barra`: el alto de su barra de estado, en puntos (sin medir en un iPhone). */
export interface Dispositivo {
  readonly ancho: number;
  readonly alto: number;
  readonly dpr: number;
  readonly barra: number;
  readonly modelos: string;
}

export const DISPOSITIVOS: readonly Dispositivo[];

/** `arranque-{ancho·dpr}x{alto·dpr}.png`. */
export function archivoDe(d: Dispositivo): string;

/** El `media` del `<link rel="apple-touch-startup-image">`. */
export function mediaDe(d: Dispositivo): string;

/** `/arranque/{archivo}`. */
export function hrefDe(d: Dispositivo): string;

/** El `index.html` sin el `<script>` de la app. */
export function htmlDeLaPantallaDeCarga(index: string): string;

export interface PngLeido {
  readonly ancho: number;
  readonly alto: number;
  /** 3 (RGB) o 4 (RGBA). */
  readonly canales: number;
  /** Cuántas filas se des-filtraron (todas, salvo que se pidieran menos). */
  readonly filas: number;
  readonly pixeles: Buffer;
}

/** Lee un PNG de 8 bits, RGB o RGBA, sin entrelazar; con `filas`, sólo las primeras. */
export function leerPng(bytes: Buffer, filas?: number): PngLeido;

/** Escribe un PNG RGB de 8 bits, determinista. */
export function escribirPngRgb(ancho: number, alto: number, pixeles: Buffer): Buffer;
