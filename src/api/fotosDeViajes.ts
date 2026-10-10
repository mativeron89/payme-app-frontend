import { claveFotoDeViaje, fotosEnMemoria, type FotosEnMemoria } from './fotosEnMemoria';
import type { StoredSession } from './storage';

/**
 * D255 · la foto de cada viaje (App Backend 2.174.0), con las reglas de las
 * fotos de los miembros (`FotosDeMiembrosDeViaje`):
 *
 * - Se pide SÓLO con `has_photo: true`; con `false`, la guardada se retira
 *   (también un pedido en curso: H04).
 * - Un pedido por viaje cada vez que se entra, sin reintentos. Un 404 la retira;
 *   un error deja lo que había (o la inicial), sin mensaje.
 * - `recargar(id)` la vuelve a pedir aunque ya se haya pedido: después de subir
 *   una foto nueva desde Configuración.
 * - Vive en el caché en memoria de la sesión (`fotosEnMemoria`): nunca una
 *   `<img src>` a la ruta, nunca almacenamiento del navegador.
 */
export class FotosDeViajes {
  private readonly pedidos = new Set<string>();
  private vivo = true;

  constructor(
    private readonly sesion: () => StoredSession | null,
    private readonly pedir: (viajeId: string, sesion: StoredSession) => Promise<Blob>,
    private readonly alCambiar: () => void,
    private readonly cache: FotosEnMemoria = fotosEnMemoria,
  ) {}

  cargar(viajes: ReadonlyArray<{ readonly id: string; readonly has_photo: boolean }>): void {
    if (!this.vivo) return;
    const sesion = this.sesion();
    if (!sesion) return;
    for (const v of viajes) {
      const clave = claveFotoDeViaje(v.id);
      if (!v.has_photo) {
        this.pedidos.delete(v.id);
        if (this.cache.retirar(sesion, clave)) this.alCambiar();
        continue;
      }
      if (this.pedidos.has(v.id)) continue;
      this.pedidos.add(v.id);
      void this.cache.cargar(sesion, clave, () => this.pedir(v.id, sesion))
        .then((resultado) => {
          if (this.vivo && (resultado === 'guardada' || resultado === 'retirada')) this.alCambiar();
        });
    }
  }

  /** La próxima `cargar` vuelve a pedir la de ese viaje (una foto nueva). */
  recargar(viajeId: string): void {
    this.pedidos.delete(viajeId);
  }

  url(viajeId: string): string | null {
    const sesion = this.sesion();
    if (!sesion) return null;
    return this.cache.ver(sesion, claveFotoDeViaje(viajeId));
  }

  /** Deja de avisar a la pantalla. No revoca: eso es del caché. */
  dispose(): void {
    this.vivo = false;
  }
}
