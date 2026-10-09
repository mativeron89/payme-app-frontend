import { claveMiembroDeViaje, fotosEnMemoria, type FotosEnMemoria } from './fotosEnMemoria';
import type { StoredSession } from './storage';

/**
 * D245 · las fotos de «Miembros» de un viaje (App Backend 2.172.0), con las
 * mismas reglas que las de quienes se sumaron a una mesa (`FotosDeParticipantes`):
 *
 * - Se pide SÓLO con `has_avatar: true` (la regla n164 del dueño: un menor
 *   nunca); con `has_avatar: false`, la guardada se retira.
 * - **Un pedido por miembro cada vez que se entra, sin reintentos.** Un 404 la
 *   retira; un error deja lo que había (o las iniciales), sin mensaje.
 * - La foto vive en el caché en memoria de la sesión (`fotosEnMemoria`), con
 *   clave por viaje y miembro: nunca una `<img src>` a la ruta, nunca
 *   almacenamiento del navegador. `dispose` no revoca: eso es del caché.
 */
export class FotosDeMiembrosDeViaje {
  private readonly pedidos = new Set<string>();
  private vivo = true;

  constructor(
    private readonly viajeId: string,
    private readonly sesion: () => StoredSession | null,
    private readonly pedir: (miembroId: string, sesion: StoredSession) => Promise<Blob>,
    private readonly alCambiar: () => void,
    private readonly cache: FotosEnMemoria = fotosEnMemoria,
  ) {}

  cargar(miembros: ReadonlyArray<{ readonly id: string; readonly has_avatar: boolean }>): void {
    if (!this.vivo) return;
    const sesion = this.sesion();
    if (!sesion) return;
    for (const m of miembros) {
      const clave = claveMiembroDeViaje(this.viajeId, m.id);
      if (!m.has_avatar) {
        // H04 · siempre: también invalida un pedido en curso, aunque todavía no haya foto guardada.
        if (this.cache.retirar(sesion, clave)) this.alCambiar();
        continue;
      }
      if (this.pedidos.has(m.id)) continue;
      this.pedidos.add(m.id);
      void this.cache.cargar(sesion, clave, () => this.pedir(m.id, sesion))
        .then((resultado) => {
          if (this.vivo && (resultado === 'guardada' || resultado === 'retirada')) this.alCambiar();
        });
    }
  }

  url(miembroId: string): string | null {
    const sesion = this.sesion();
    if (!sesion) return null;
    return this.cache.ver(sesion, claveMiembroDeViaje(this.viajeId, miembroId));
  }

  /** Deja de avisar a la pantalla. No revoca: eso es del caché. */
  dispose(): void {
    this.vivo = false;
  }
}
