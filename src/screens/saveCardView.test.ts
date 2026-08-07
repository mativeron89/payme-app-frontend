import { describe, expect, it } from 'vitest';
import { GUARDAR_TARJETA_DEFAULT } from './saveCardView';

/**
 * G-11 · el checkbox "Guardar esta tarjeta" NACE DESMARCADO (Mati,
 * 2026-08-06) — y la decisión SOBREVIVIÓ al cierre de G-11 (v2.46.0): una
 * promesa por defecto es una promesa que nadie pidió, cumplible o no. Lo que
 * cambió con el cierre es que marcarlo GUARDA DE VERDAD, también en direct
 * charge.
 *
 * El test es deliberadamente literal: la constante es LA fuente de las dos
 * superficies y del reset por mesa, así que volverla `true` acá es volver a
 * hacer la promesa de oficio en todas partes a la vez. Las superficies se
 * afirman en `e2e/guardar-tarjeta-default.spec.ts`, con las TRES direcciones
 * (desmarcado de nacimiento · marcado guarda · sin marcar no aparece).
 */
describe('GUARDAR_TARJETA_DEFAULT', () => {
  it('es false: la promesa de guardado no se hace de oficio (G-11)', () => {
    expect(GUARDAR_TARJETA_DEFAULT).toBe(false);
  });
});
