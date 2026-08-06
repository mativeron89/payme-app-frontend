/**
 * Pequeña compuerta para respuestas async ligadas a una identidad/vista.
 * No cancela la red por sí sola, pero impide que una respuesta vieja escriba
 * estado de un token, usuario o recurso que ya fue reemplazado.
 */
export class RequestEpoch {
  private value = 0;

  next(): number {
    this.value += 1;
    return this.value;
  }

  capture(): number {
    return this.value;
  }

  isCurrent(epoch: number): boolean {
    return epoch === this.value;
  }
}
