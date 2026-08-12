import { describe, expect, it } from 'vitest';
import { MAX_TICKET_IMAGE_BYTES } from './index';

/**
 * §1.6 · el techo de la foto del ticket, atado al contrato y no a un número
 * escrito de memoria.
 *
 * ## Por qué existe
 *
 * La pantalla de Escanear avisa **antes de subir** que la foto pesa de más, y
 * dice el límite en castellano: *"La foto pesa más de 8 MB"*. Ese cartel es una
 * promesa sobre lo que el backend va a aceptar, y el backend es su dueño:
 * `routes/ocr.js` monta multer con `limits: { fileSize: 8 * 1024 * 1024 }` y
 * contesta **413 `image_too_large`** cuando se pasa.
 *
 * Si el emisor mueve ese techo y este front no se entera, pasa una de dos, y
 * las dos son mentiras en la mesa:
 *
 *  - el front frena una foto que el backend hubiera aceptado, o
 *  - el front deja subir 12 MB por una conexión de restaurante para que el
 *    backend los rechace al final.
 *
 * El número duplicado no se evita: se **verifica**. Esto lo lee del espejo.
 *
 * ## Límite declarado
 *
 * Lee `contract-mirror/`, que es una copia — no el backend corriendo. Que el
 * espejo esté fresco lo acredita `scripts/verificar-mirror.mjs`, no este test.
 */

const espejo = import.meta.glob('/contract-mirror/routes/ocr.js', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const ocr = espejo['/contract-mirror/routes/ocr.js'];

const espejoRespuesta = import.meta.glob('/contract-mirror/services/ocrResponseContract.js', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const contratoRespuesta = espejoRespuesta['/contract-mirror/services/ocrResponseContract.js'];

/** `limits: { fileSize: 8 * 1024 * 1024 }` → 8388608. */
const LIMITE = /limits:\s*\{\s*fileSize:\s*(\d+)\s*\*\s*(\d+)\s*\*\s*(\d+)\s*\}/;

describe('el techo de la imagen del OCR sale del contrato', () => {
  it('el espejo de routes/ocr.js está y se puede leer', () => {
    // Sin esto, un glob que no matchea dejaría pasar todo lo de abajo en vacío.
    expect(ocr, 'no se pudo leer contract-mirror/routes/ocr.js').toBeTypeOf('string');
    expect(ocr).toContain('multer');
  });

  it('el multipart sigue declarando su límite con la forma que este test lee', () => {
    // Si el backend lo escribe de otra manera —un `require` de constante, otro
    // orden—, esto se pone rojo en vez de comparar contra `null` y aprobar.
    expect(LIMITE.test(ocr)).toBe(true);
  });

  it('MAX_TICKET_IMAGE_BYTES es exactamente el techo del contrato', () => {
    const m = LIMITE.exec(ocr)!;
    const delContrato = Number(m[1]) * Number(m[2]) * Number(m[3]);
    expect(delContrato).toBe(8 * 1024 * 1024);
    expect(MAX_TICKET_IMAGE_BYTES).toBe(delContrato);
  });

  it('el rechazo del contrato sigue siendo 413 image_too_large', () => {
    // El cartel de "foto muy grande" también se prende con la respuesta del
    // backend, no sólo con el chequeo local: si el código de error cambia, el
    // front cae al cartel genérico de "no pudimos leer el ticket", que es otra
    // cosa y manda a la persona a sacar la foto de nuevo por nada.
    expect(contratoRespuesta, 'no se pudo leer el contrato de respuesta OCR').toBeTypeOf('string');
    expect(contratoRespuesta).toMatch(/image_too_large:\s*413/);
    expect(ocr).toContain("errorOcr('image_too_large')");
  });
});
