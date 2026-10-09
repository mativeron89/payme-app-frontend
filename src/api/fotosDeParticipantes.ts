import { claveParticipante, fotosEnMemoria, type FotosEnMemoria } from './fotosEnMemoria';
import type { Participante } from './participantes';
import type { StoredSession } from './storage';

/**
 * AF-32 · las fotos de «Quiénes se sumaron» (dueño v2.110.0), sólo para el
 * organizador. La pantalla no llama a la red: esta clase pide y lee.
 *
 * - Se pide SÓLO con `has_avatar: true` y un `participant_id`: nunca a ciegas.
 *   Con `has_avatar: false`, la guardada se retira.
 * - **Un pedido por persona cada vez que se entra a la mesa, sin reintentos.**
 *   Un 404 la retira; un error o una respuesta rara dejan lo que había (o las
 *   iniciales), sin mensaje y sin volver a pedir: un bucle de reintentos sobre
 *   una foto que no está es ruido y costo.
 * - E173-3 · decisión 175: la foto vive en el caché en memoria de la sesión
 *   (`fotosEnMemoria`), con clave por mesa y participante. Volver a la mesa la
 *   muestra al instante y la revalida en segundo plano. `dispose` (al desmontar
 *   o cambiar de mesa) ya NO revoca: el caché revoca al expulsar o al cerrar
 *   sesión. Nunca una `<img src>` a la ruta, nunca almacenamiento del navegador.
 * - Una respuesta que llega después de `dispose` igual se guarda si la sesión
 *   es la misma, pero ya no avisa a la pantalla.
 */
export class FotosDeParticipantes {
  private readonly pedidos = new Set<string>();
  private vivo = true;

  constructor(
    private readonly mesaCode: string,
    private readonly sesion: () => StoredSession | null,
    private readonly pedir: (participantId: string, sesion: StoredSession) => Promise<Blob>,
    private readonly alCambiar: () => void,
    private readonly cache: FotosEnMemoria = fotosEnMemoria,
  ) {}

  cargar(lista: readonly Participante[]): void {
    if (!this.vivo) return;
    const sesion = this.sesion();
    if (!sesion) return;
    for (const p of lista) {
      const id = p.participantId;
      if (id === null) continue;
      const clave = claveParticipante(this.mesaCode, id);
      if (!p.hasAvatar) {
        // H04 · siempre: también invalida un pedido en curso, aunque todavía no haya foto guardada.
        if (this.cache.retirar(sesion, clave)) this.alCambiar();
        continue;
      }
      if (this.pedidos.has(id)) continue;
      this.pedidos.add(id);
      void this.cache.cargar(sesion, clave, () => this.pedir(id, sesion))
        .then((resultado) => {
          if (this.vivo && (resultado === 'guardada' || resultado === 'retirada')) this.alCambiar();
        });
    }
  }

  url(participantId: string | null): string | null {
    const sesion = this.sesion();
    if (participantId === null || !sesion) return null;
    return this.cache.ver(sesion, claveParticipante(this.mesaCode, participantId));
  }

  /** Deja de avisar a la pantalla. No revoca: eso es del caché. */
  dispose(): void {
    this.vivo = false;
  }
}
