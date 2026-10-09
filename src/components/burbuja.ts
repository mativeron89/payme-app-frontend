/**
 * D230 · la burbuja muestra hasta 9; desde 10 dice «9+». Módulo puro: la usan
 * la barra de abajo («Amigos») y la cabecera (la campana, D240 punto 5), y la
 * cabecera no tiene que arrastrar los módulos de la barra.
 */
export function textoDeLaBurbuja(cantidad: number): string {
  return cantidad > 9 ? '9+' : String(cantidad);
}
