import { describe, expect, it } from 'vitest';
import { GUARDAR_TARJETA_DEFAULT } from './saveCardView';

/**
 * G-11 · ratificado por Mati el 2026-08-06: el checkbox "Guardar esta tarjeta"
 * NACE DESMARCADO. Mientras el backend no cumpla `save_payment_method` en
 * direct charges, la UI no puede prometer de oficio algo que el riel
 * incumple: la promesa sólo existe si alguien la elige.
 *
 * El test es deliberadamente literal: la constante es LA fuente de las dos
 * superficies y del reset por mesa, así que volverla `true` acá es volver a
 * hacer la promesa de oficio en todas partes a la vez. Las superficies se
 * afirman en `e2e/guardar-tarjeta-default.spec.ts`, incluida la dirección
 * contraria (marcarlo sigue funcionando).
 */
describe('GUARDAR_TARJETA_DEFAULT', () => {
  it('es false: la promesa de guardado no se hace de oficio (G-11)', () => {
    expect(GUARDAR_TARJETA_DEFAULT).toBe(false);
  });
});
