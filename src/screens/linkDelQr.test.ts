import { describe, expect, it } from 'vitest';
import { linkDelQrVigente, msHastaQueVenza } from './linkDelQr';

/**
 * D622 · AF-4 · m2 de E06 sobre AF-3: el QR de la hoja del engranaje respeta el
 * vencimiento de la invitación (`expires_at` de `POST /api/mesas/:code/invitations`).
 * Falla cerrado: sin una fecha legible no hay QR.
 */
const AHORA = Date.parse('2026-11-01T12:00:00.000Z');

describe('linkDelQrVigente', () => {
  it('🔴 antes del vencimiento sí; en el vencimiento o después, no', () => {
    expect(linkDelQrVigente('2026-11-01T12:00:01.000Z', AHORA)).toBe(true);
    expect(linkDelQrVigente('2026-11-01T12:00:00.000Z', AHORA)).toBe(false);
    expect(linkDelQrVigente('2026-11-01T11:00:00.000Z', AHORA)).toBe(false);
  });

  it('🔴 sin fecha o con una ilegible: no (no se muestra un link que puede haber vencido)', () => {
    for (const raro of [null, undefined, '', 'mañana', '2026-13-45']) expect(linkDelQrVigente(raro, AHORA), String(raro)).toBe(false);
  });
});

describe('msHastaQueVenza', () => {
  it('los milisegundos que faltan, con piso 0 y techo del temporizador del navegador', () => {
    expect(msHastaQueVenza('2026-11-01T12:00:05.000Z', AHORA)).toBe(5000);
    expect(msHastaQueVenza('2026-11-01T11:00:00.000Z', AHORA)).toBe(0);
    expect(msHastaQueVenza('2027-11-01T12:00:00.000Z', AHORA)).toBe(2 ** 31 - 1);
    expect(msHastaQueVenza('mañana', AHORA)).toBe(0);
  });
});
