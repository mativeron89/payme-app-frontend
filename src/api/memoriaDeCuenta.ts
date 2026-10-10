import { ultimoVisto, type TurnoDeUltimoVisto, type UltimoVisto } from './ultimoVisto';

/**
 * C-07 (auditoría Codex completa) · un dato de UNA cuenta guardado en memoria
 * (el nombre del viaje que mostró su pantalla, lo que leyó la cámara): con el
 * mismo `turno()` de T-01, la cuenta y la generación del momento de guardar.
 *
 * - Se lee sólo con la misma cuenta y sin un cambio de sesión en el medio: un
 *   nombre recordado con A nunca aparece con B, ni reemplaza lo que dice el
 *   servidor.
 * - Se borra al cambiar la sesión (cerrar, entrar, otra cuenta): el mismo
 *   `vaciar` de lo último visto.
 * - Sin sesión, lo guardado nunca se lee (el turno no tiene dueño).
 */
export class MemoriaDeCuenta<T> {
  private guardado: { readonly turno: TurnoDeUltimoVisto; readonly valor: T } | null = null;

  constructor(private readonly cuenta: Pick<UltimoVisto, 'turno' | 'esDeAhora' | 'alVaciarse'> = ultimoVisto) {
    cuenta.alVaciarse(() => { this.guardado = null; });
  }

  guardar(valor: T): void {
    this.guardado = { turno: this.cuenta.turno(), valor };
  }

  /** Lo guardado con la cuenta de ahora, o `null` (y lo de otra se borra). */
  leer(): T | null {
    const g = this.guardado;
    if (g === null) return null;
    if (!this.cuenta.esDeAhora(g.turno)) {
      this.guardado = null;
      return null;
    }
    return g.valor;
  }

  olvidar(): void {
    this.guardado = null;
  }

  /** Sólo para tests: ¿no queda nada guardado (ni siquiera ilegible)? */
  vacia(): boolean {
    return this.guardado === null;
  }
}
