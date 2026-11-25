/** Conserva la edición anterior si el nuevo texto convertiría signos o letras en otro importe. */
export function textoDeMonto(nuevo: string, anterior: string): string {
  const sinEspacios = nuevo.replace(/\s/gu, '');
  return /^\$?[0-9.,]*$/u.test(sinEspacios) ? sinEspacios.replace(/^\$/, '') : anterior;
}
