/**
 * D622 · AF-4 · m2 de E06 sobre AF-3 · el vencimiento del link del QR de la hoja
 * del engranaje. El dueño manda `expires_at` con la invitación; vencida, el QR no
 * se muestra y la próxima apertura de la hoja pide el link otra vez. Falla
 * cerrado: una fecha ilegible cuenta como vencida.
 */

/** El techo de `setTimeout` en los navegadores (2³¹ − 1 ms, unos 24 días). */
const TECHO_DEL_TEMPORIZADOR = 2 ** 31 - 1;

export function linkDelQrVigente(expiresAt: string | null | undefined, ahora: number): boolean {
  if (typeof expiresAt !== 'string' || expiresAt === '') return false;
  const vence = Date.parse(expiresAt);
  return Number.isFinite(vence) && vence > ahora;
}

/** Cuánto falta para que venza, para programar el temporizador que saca el QR (0 si ya venció o no se lee). */
export function msHastaQueVenza(expiresAt: string | null | undefined, ahora: number): number {
  if (!linkDelQrVigente(expiresAt, ahora)) return 0;
  return Math.min(TECHO_DEL_TEMPORIZADOR, Date.parse(expiresAt as string) - ahora);
}
