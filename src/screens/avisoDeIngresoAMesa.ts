/** P-3 · recibo efímero de un canje válido. Nunca contiene la credencial. */
export interface IngresoAMesa {
  readonly mesa_code: string;
}

export function crearAvisoDeIngresoAMesa() {
  let identidad: string | null = null;
  let destino: string | null = null;
  let pendiente: IngresoAMesa | null = null;
  return {
    contexto(cuentaYFamilia: string | null, mesa: string | null) {
      if (identidad !== cuentaYFamilia || (pendiente && mesa !== pendiente.mesa_code)) pendiente = null;
      identidad = cuentaYFamilia;
      destino = mesa;
    },
    preparar(mesa_code: string, cuentaYFamilia: string | null) {
      // El callback de Join captura su identidad: ni siquiera una respuesta
      // anterior al cleanup puede emitir una señal para la cuenta siguiente.
      if (identidad && identidad === cuentaYFamilia) pendiente = { mesa_code };
    },
    capturar(mesa_code: string): IngresoAMesa | null {
      return pendiente?.mesa_code === mesa_code ? pendiente : null;
    },
    consumir(recibo: IngresoAMesa | null): boolean {
      if (!recibo || pendiente !== recibo || !identidad || destino !== recibo.mesa_code) return false;
      pendiente = null;
      return true;
    },
  };
}

export type AvisoDeIngresoAMesa = ReturnType<typeof crearAvisoDeIngresoAMesa>;
