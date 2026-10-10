import { extractApiError } from './errors';
import { loadSession, subscribeSession, type StoredSession } from './storage';

/**
 * E173-3 · decisión 175 de Mati · las fotos, en memoria mientras dure la sesión.
 *
 * Mati: las fotos de Amigos y de Configuración tardaban en cada entrada. El
 * diagnóstico de App Backend: el servidor responde en decenas de ms; la demora
 * es la cascada de viajes iPhone → Railway, repetida en cada entrada porque la
 * foto no quedaba guardada en ningún lado. Mati eligió, literal: «Sí, guardar en
 * memoria (Recomendada)», aceptando que una foto retirada se puede ver menos de
 * un segundo hasta que la app lo confirma.
 *
 * Qué garantiza este módulo:
 * - **Sólo memoria.** Un `Map` con `blob:` de esta pestaña. Nada va a
 *   localStorage, IndexedDB ni Cache API, y las respuestas siguen siendo
 *   `private, no-store`: el contrato no cambia.
 * - **Dueño = la sesión** (familia + principal). Un refresh de tokens conserva
 *   el caché; cerrar sesión, otra cuenta o una sesión vencida lo vacían, y una
 *   respuesta que llega después de ese cambio se descarta.
 * - **Revalidar no borra lo que se ve.** `cargar` siempre pide; lo guardado se
 *   sigue mostrando mientras tanto. Un 200 con los mismos bytes no toca nada;
 *   con bytes nuevos, reemplaza. **Sólo un 404 retira la foto.** Un error de red
 *   o un 5xx dejan la guardada: no prueban que la foto ya no se pueda ver.
 * - **Un `blob:` se revoca sólo al salir del caché** —por reemplazo, retiro,
 *   poda, límite o al vaciarlo—, nunca porque un componente se desmonte. Por
 *   eso volver a una pantalla la muestra al instante.
 * - **Tope de {@link MAXIMO_FOTOS_EN_MEMORIA}**, para que una sesión larga no
 *   acumule sin límite: sale la menos usada.
 *
 * Las claves las arman los consumidores: `amigo:<id>`, `propia:<revisión>`,
 * `participante:<mesa>\u0000<id>` e `invitador:<id de notificación>`.
 */

/** Holgado para la lista de amigos de una persona (el dueño prueba con 300). */
export const MAXIMO_FOTOS_EN_MEMORIA = 400;

/** Qué pasó con un `cargar`. Lo usan los tests y quien necesite re-pintar. */
export type ResultadoFoto = 'guardada' | 'igual' | 'retirada' | 'conservada' | 'descartada';

export interface DependenciasFotos {
  readonly crearUrl: (blob: Blob) => string;
  readonly revocarUrl: (url: string) => void;
  /** El dueño de la sesión vigente ({@link duenoDeSesion}), o `null` sin sesión. */
  readonly duenoVigente: () => string | null;
  readonly maximo?: number;
}

type IdentidadDeSesion = Pick<StoredSession, 'family_id' | 'principal_id'>;

/** Identidad del dueño del caché. Los tokens no entran: un refresh no lo vacía. */
export function duenoDeSesion(sesion: IdentidadDeSesion): string {
  return `${sesion.family_id}\u0000${sesion.principal_id}`;
}

interface Entrada {
  readonly url: string;
  readonly blob: Blob;
}

async function mismosBytes(a: Blob, b: Blob): Promise<boolean> {
  if (a.size !== b.size || a.type !== b.type) return false;
  const [x, y] = await Promise.all([a.arrayBuffer(), b.arrayBuffer()]);
  const va = new Uint8Array(x);
  const vb = new Uint8Array(y);
  for (let i = 0; i < va.length; i += 1) if (va[i] !== vb[i]) return false;
  return true;
}

export class FotosEnMemoria {
  private dueno: string | null = null;
  /** Sube al vaciar: una respuesta de antes ya no puede guardarse. */
  private generacion = 0;
  /**
   * H04 · la generación de cada clave: sube al retirarla o podarla, así un
   * pedido que ya estaba viajando no la vuelve a guardar. Sólo una carga
   * posterior a la invalidación puede guardar.
   */
  private readonly generacionDeClave = new Map<string, number>();
  /** El orden de inserción es el de uso: la primera es la menos usada. */
  private readonly entradas = new Map<string, Entrada>();
  private readonly enCurso = new Map<string, Promise<ResultadoFoto>>();
  private readonly oyentes = new Set<() => void>();
  private readonly maximo: number;

  constructor(private readonly deps: DependenciasFotos) {
    this.maximo = deps.maximo ?? MAXIMO_FOTOS_EN_MEMORIA;
  }

  /**
   * La URL guardada, o `null`. Sin efectos: sirve de `getSnapshot`. Una sesión
   * que no es la dueña del caché no ve nada.
   */
  ver(sesion: IdentidadDeSesion, clave: string): string | null {
    if (this.dueno !== duenoDeSesion(sesion)) return null;
    return this.entradas.get(clave)?.url ?? null;
  }

  tiene(sesion: IdentidadDeSesion, clave: string): boolean {
    return this.ver(sesion, clave) !== null;
  }

  /** Cuántas hay guardadas. Para los tests y el diagnóstico; no expone URLs. */
  get tamano(): number {
    return this.entradas.size;
  }

  suscribir = (oyente: () => void): (() => void) => {
    this.oyentes.add(oyente);
    return () => { this.oyentes.delete(oyente); };
  };

  /**
   * Pide la foto y actualiza el caché según la respuesta. Un pedido en curso
   * para la misma clave se comparte. Si la sesión ya no es la vigente, no pide.
   */
  cargar(sesion: IdentidadDeSesion, clave: string, pedir: () => Promise<Blob>): Promise<ResultadoFoto> {
    const dueno = duenoDeSesion(sesion);
    if (!this.adoptar(dueno)) return Promise.resolve('descartada');
    const previo = this.enCurso.get(clave);
    if (previo) return previo;
    const generacion = this.generacion;
    const deClave = this.generacionDeClave.get(clave) ?? 0;
    const pedido: Promise<ResultadoFoto> = Promise.resolve()
      .then(pedir)
      .then(
        (blob) => this.alLlegar(clave, blob, dueno, generacion, deClave),
        (error: unknown): ResultadoFoto => {
          if (!this.sigue(dueno, generacion, clave, deClave)) return 'descartada';
          if (extractApiError(error).status !== 404) return 'conservada';
          this.quitar(clave);
          return 'retirada';
        },
      )
      .finally(() => {
        if (this.enCurso.get(clave) === pedido) this.enCurso.delete(clave);
      });
    this.enCurso.set(clave, pedido);
    return pedido;
  }

  /**
   * Saca una foto (p. ej., `has_avatar: false`) e invalida el pedido en curso de
   * esa clave (H04): aunque no haya foto guardada, un 200 tardío ya no la guarda.
   * Devuelve si había una guardada. Sin efecto con otra sesión.
   */
  retirar(sesion: IdentidadDeSesion, clave: string): boolean {
    if (this.dueno !== duenoDeSesion(sesion)) return false;
    this.invalidar(clave);
    return this.quitar(clave);
  }

  /**
   * Saca las claves con ese prefijo cuyo resto no está en `conservar`. Ej.: al
   * traer la lista de amigos, las de quienes ya no están en ella.
   */
  podar(sesion: IdentidadDeSesion, prefijo: string, conservar: ReadonlySet<string>): void {
    if (this.dueno !== duenoDeSesion(sesion)) return;
    // H04 · también las que todavía están viajando: si no, un 200 tardío las guardaría.
    for (const clave of new Set([...this.entradas.keys(), ...this.enCurso.keys()])) {
      if (clave.startsWith(prefijo) && !conservar.has(clave.slice(prefijo.length))) {
        this.invalidar(clave);
        this.quitar(clave);
      }
    }
  }

  /** Revoca todo y olvida al dueño. Una respuesta en curso se descarta al llegar. */
  vaciar(): void {
    this.generacion += 1;
    this.enCurso.clear();
    this.generacionDeClave.clear();
    const habia = this.entradas.size > 0;
    for (const { url } of this.entradas.values()) this.deps.revocarUrl(url);
    this.entradas.clear();
    this.dueno = null;
    if (habia) this.avisar();
  }

  /**
   * Vacía el caché cuando la sesión deja de ser la dueña: cierre de sesión,
   * otra cuenta, sesión vencida, también desde otra pestaña. Un refresh de
   * tokens no cambia el dueño y no lo vacía.
   */
  vigilarSesion(suscribirSesion: (oyente: () => void) => () => void): () => void {
    return suscribirSesion(() => {
      if (this.dueno !== null && this.deps.duenoVigente() !== this.dueno) this.vaciar();
    });
  }

  private adoptar(dueno: string): boolean {
    const vigente = this.deps.duenoVigente();
    if (vigente !== dueno) return false;
    if (this.dueno !== dueno) {
      this.vaciar();
      this.dueno = dueno;
    }
    return true;
  }

  private sigue(dueno: string, generacion: number, clave: string, deClave: number): boolean {
    return this.generacion === generacion
      && (this.generacionDeClave.get(clave) ?? 0) === deClave
      && this.dueno === dueno
      && this.deps.duenoVigente() === dueno;
  }

  /** H04 · ningún pedido anterior de esta clave puede guardar; el próximo `cargar` pide de nuevo. */
  private invalidar(clave: string): void {
    this.generacionDeClave.set(clave, (this.generacionDeClave.get(clave) ?? 0) + 1);
    this.enCurso.delete(clave);
  }

  private async alLlegar(
    clave: string, blob: Blob, dueno: string, generacion: number, deClave: number,
  ): Promise<ResultadoFoto> {
    // Si la sesión cambió, `vaciar` ya sacó la previa: no hay con qué comparar.
    const previa = this.entradas.get(clave);
    if (previa && await mismosBytes(previa.blob, blob)) {
      if (!this.sigue(dueno, generacion, clave, deClave) || this.entradas.get(clave) !== previa) return 'descartada';
      this.entradas.delete(clave);
      this.entradas.set(clave, previa);
      return 'igual';
    }
    if (!this.sigue(dueno, generacion, clave, deClave)) return 'descartada';
    const url = this.deps.crearUrl(blob);
    const reemplazada = this.entradas.get(clave);
    this.entradas.delete(clave);
    this.entradas.set(clave, { url, blob });
    if (reemplazada) this.deps.revocarUrl(reemplazada.url);
    while (this.entradas.size > this.maximo) {
      const [masVieja, entrada] = this.entradas.entries().next().value as [string, Entrada];
      this.entradas.delete(masVieja);
      this.deps.revocarUrl(entrada.url);
    }
    this.avisar();
    return 'guardada';
  }

  private quitar(clave: string): boolean {
    const entrada = this.entradas.get(clave);
    if (!entrada) return false;
    this.entradas.delete(clave);
    this.deps.revocarUrl(entrada.url);
    this.avisar();
    return true;
  }

  private avisar(): void {
    for (const oyente of [...this.oyentes]) oyente();
  }
}

/** El caché de la app. Lo engancha a la sesión `AuthProvider` (`vigilarSesion`). */
export const fotosEnMemoria = new FotosEnMemoria({
  crearUrl: (blob) => URL.createObjectURL(blob),
  revocarUrl: (url) => URL.revokeObjectURL(url),
  duenoVigente: () => {
    const sesion = loadSession();
    return sesion ? duenoDeSesion(sesion) : null;
  },
});

/** Engancha el caché de la app a los cambios de sesión. Devuelve cómo soltarlo. */
export function vigilarFotosConLaSesion(): () => void {
  return fotosEnMemoria.vigilarSesion(subscribeSession);
}

export const claveAmigo = (friendId: string): string => `amigo:${friendId}`;
export const PREFIJO_AMIGO = 'amigo:';
export const clavePropia = (revision: string): string => `propia:${revision}`;
export const PREFIJO_PROPIA = 'propia:';
export const prefijoParticipantes = (mesaCode: string): string => `participante:${mesaCode}\u0000`;
export const claveParticipante = (mesaCode: string, participantId: string): string =>
  `${prefijoParticipantes(mesaCode)}${participantId}`;
export const PREFIJO_INVITADOR = 'invitador:';
export const claveInvitador = (notificationId: string): string => `${PREFIJO_INVITADOR}${notificationId}`;
/** D245 · la foto de un miembro de un viaje (App Backend 2.172.0), por viaje y miembro. */
export const prefijoMiembrosDeViaje = (viajeId: string): string => `miembro-viaje:${viajeId}\u0000`;
export const claveMiembroDeViaje = (viajeId: string, miembroId: string): string =>
  `${prefijoMiembrosDeViaje(viajeId)}${miembroId}`;
/** D255 · la foto de un viaje (App Backend 2.174.0, `GET /api/viajes/:id/foto`), por viaje. */
export const claveFotoDeViaje = (viajeId: string): string => `foto-viaje:${viajeId}`;
/** E174-3B · la misma foto, pedida por el id de la INVITACIÓN (otra ruta, otra clave). */
export const PREFIJO_INVITADOR_DE_INVITACION = 'invitacion-invitador:';
export const claveInvitadorDeInvitacion = (invitationId: string): string =>
  `${PREFIJO_INVITADOR_DE_INVITACION}${invitationId}`;

/**
 * E173-3 · al traer la lista de amigos: se quedan sólo las fotos de quienes
 * siguen en ella y tienen foto visible. Un `has_avatar` ausente (dueño previo a
 * v2.148.0) conserva la foto, como antes.
 */
export function podarFotosDeAmigos(
  sesion: IdentidadDeSesion,
  amigos: readonly { readonly id: string; readonly has_avatar?: boolean }[],
  cache: FotosEnMemoria = fotosEnMemoria,
): void {
  cache.podar(sesion, PREFIJO_AMIGO, new Set(amigos.filter((a) => a.has_avatar !== false).map((a) => a.id)));
}
