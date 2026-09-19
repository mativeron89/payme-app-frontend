import { AvatarObjectUrlLease } from './profileIdentity';
import type { Participante } from './participantes';

/**
 * AF-32 · las fotos de «Quiénes se sumaron» (dueño v2.110.0), sólo para el
 * organizador. La pantalla no llama a la red: esta clase pide, guarda y libera.
 *
 * - Se pide SÓLO con `has_avatar: true` y un `participant_id`: nunca a ciegas.
 * - **Un pedido por persona y por mesa, sin reintentos.** Un 404, un error o una
 *   respuesta rara dejan las iniciales, sin mensaje y sin volver a pedir: un
 *   bucle de reintentos sobre una foto que no está es ruido y costo.
 * - La foto vive como `blob:` en memoria, con un `AvatarObjectUrlLease` por
 *   persona. `dispose` (al desmontar o cambiar de mesa) revoca todas. Nunca una
 *   `<img src>` a la ruta, nunca caché ni almacenamiento.
 * - Una foto que llega después de `dispose` no crea URL: se descarta.
 */
export class FotosDeParticipantes {
  private readonly leases = new Map<string, AvatarObjectUrlLease>();
  private readonly urls = new Map<string, string>();
  private readonly pedidos = new Set<string>();
  private vivo = true;

  constructor(
    private readonly pedir: (participantId: string) => Promise<Blob>,
    private readonly alCambiar: () => void,
    private readonly nuevoLease: () => AvatarObjectUrlLease = () => new AvatarObjectUrlLease(),
  ) {}

  cargar(lista: readonly Participante[]): void {
    if (!this.vivo) return;
    for (const p of lista) {
      const id = p.participantId;
      if (!p.hasAvatar || id === null || this.pedidos.has(id)) continue;
      this.pedidos.add(id);
      this.pedir(id)
        .then((blob) => {
          if (!this.vivo) return;
          const lease = this.nuevoLease();
          this.leases.set(id, lease);
          this.urls.set(id, lease.replace(blob));
          this.alCambiar();
        })
        .catch(() => { /* iniciales, sin mensaje y sin reintento */ });
    }
  }

  url(participantId: string | null): string | null {
    return participantId === null ? null : this.urls.get(participantId) ?? null;
  }

  dispose(): void {
    this.vivo = false;
    for (const lease of this.leases.values()) lease.dispose();
    this.leases.clear();
    this.urls.clear();
  }
}
