/**
 * H02 · después de salir de un viaje se vuelve a Inicio › Viajes. Inicio no
 * tiene ruta por pestaña: el pedido vive en memoria, Inicio lo lee al montar y
 * lo olvida en un efecto (leerlo y olvidarlo en el inicializador lo perdería con
 * el doble render de StrictMode).
 */
let inicioEnViajes = false;

export function pedirInicioEnViajes(): void {
  inicioEnViajes = true;
}

export function inicioPideViajes(): boolean {
  return inicioEnViajes;
}

export function olvidarInicioEnViajes(): void {
  inicioEnViajes = false;
}
