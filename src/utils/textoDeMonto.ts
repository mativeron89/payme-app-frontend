/** Conserva la edición anterior si el nuevo texto convertiría signos o letras en otro importe. */
export function textoDeMonto(nuevo: string, anterior: string): string {
  return /[^0-9.,$\s]/u.test(nuevo) ? anterior : nuevo.replace(/[$\s]/gu, '');
}
