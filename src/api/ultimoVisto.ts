import { useEffect, useState } from 'react';
import { duenoDeSesion } from './fotosEnMemoria';
import { loadSession, subscribeSession } from './storage';

/**
 * D237 · «Pestañas sin parpadeo»: lo ÚLTIMO QUE SE VIO en cada pestaña, para
 * que al volver se muestre enseguida mientras se pide de nuevo por detrás.
 *
 * Mati, en su video: cada pestaña se armaba de cero y volvía a mostrar el
 * estado de carga (esqueletos, «Cargando amigos…») aunque los datos llegaran en
 * 100–200 ms. Lo lento no era el servidor sino volver a empezar.
 *
 * 🔴 **Límites que no se mueven:**
 * - **Sólo en memoria.** Nunca `localStorage`, `sessionStorage` ni IndexedDB:
 *   son datos personales. Se pierde al recargar la página, a propósito.
 * - **Es de UNA cuenta.** Se guarda con el dueño de la sesión (familia y
 *   principal) y se vacía en cuanto la sesión cambia: al cerrar sesión, al
 *   entrar con otra cuenta o si otra pestaña del navegador cambia la sesión.
 *   Leer con otra cuenta adentro no devuelve nada.
 * - **Es sólo para MOSTRAR.** Ningún camino de acción (pagar, cerrar la mesa,
 *   aceptar, rechazar, unirse) lo lee: esos piden lo suyo. La guarda
 *   `ultimoVisto.test.ts` lista los únicos archivos que lo leen.
 * - **Siempre se vuelve a pedir.** Esto decide qué se ve en el primer cuadro,
 *   nunca reemplaza el pedido.
 * - 🔴 **T-01 (auditoría Codex total, ALTA): la cuenta se toma AL PEDIR.** Antes
 *   `guardar` tomaba la cuenta vigente cuando llegaba la respuesta: una tardía
 *   de la cuenta A se guardaba bajo la B. Ahora quien pide saca un `turno()`
 *   (la cuenta y la generación de ese momento) y `guardar(turno, …)` descarta
 *   la respuesta si cualquiera de las dos cambió: no se guarda ni se muestra
 *   (devuelve `null`). La generación sube con cada `vaciar`.
 */

/** T-01 · quién pidió: la cuenta y la generación del caché en el momento de pedir. */
export interface TurnoDeUltimoVisto {
  readonly dueno: string | null;
  readonly generacion: number;
}

export type ClaveUltimoVisto =
  | 'inicio.mesasAbiertas'
  | 'inicio.invitaciones'
  | 'inicio.avisoFoto'
  | 'sinLeer'
  | 'mesas.tusMesas'
  | 'mesas.historial'
  | 'amigos.amigos'
  | 'amigos.grupos'
  | 'amigos.solicitudes';

/** Lo que depende de las mesas: se borra después de cualquier acción sobre una mesa. */
export const CLAVES_DE_MESAS: readonly ClaveUltimoVisto[] = [
  'inicio.mesasAbiertas',
  'inicio.invitaciones',
  'mesas.tusMesas',
  'mesas.historial',
];

/** Lo de Amigos: se borra después de aceptar, rechazar, cancelar, bloquear o tocar grupos. */
export const CLAVES_DE_AMIGOS: readonly ClaveUltimoVisto[] = ['amigos.amigos', 'amigos.grupos', 'amigos.solicitudes'];

interface Entrada {
  readonly valor: unknown;
  /** El JSON del valor: para saber si lo nuevo es igual sin recorrerlo. */
  readonly json: string;
}

function duenoVigente(): string | null {
  const sesion = loadSession();
  return sesion ? duenoDeSesion(sesion) : null;
}

export class UltimoVisto {
  private dueno: string | null = null;
  /** T-01 · sube con cada `vaciar`: lo pedido antes ya no se guarda. */
  private generacion = 0;
  private readonly entradas = new Map<ClaveUltimoVisto, Entrada>();
  /** C-07 · las memorias por cuenta (`MemoriaDeCuenta`) se borran con cada `vaciar`. */
  private readonly alVaciar = new Set<() => void>();

  constructor(private readonly vigente: () => string | null = duenoVigente) {}

  /** Lo último visto con la cuenta de ahora, o `undefined`. */
  leer<T>(clave: ClaveUltimoVisto): T | undefined {
    const ahora = this.vigente();
    if (ahora === null || ahora !== this.dueno) {
      // Otra cuenta, o ninguna: lo guardado no es de quien mira.
      if (this.dueno !== null) this.soltar();
      return undefined;
    }
    return this.entradas.get(clave)?.valor as T | undefined;
  }

  /** T-01 · se saca ANTES de pedir: la cuenta y la generación de este momento. */
  turno(): TurnoDeUltimoVisto {
    return { dueno: this.vigente(), generacion: this.generacion };
  }

  /**
   * ¿Lo pedido con este turno sigue siendo de la cuenta de ahora, y nada se
   * vació desde entonces? Quien llama lo usa también en el error: un fallo
   * tardío de otra cuenta no borra ni muestra nada.
   */
  esDeAhora(turno: TurnoDeUltimoVisto): boolean {
    return this.sigue(turno);
  }

  private sigue(turno: TurnoDeUltimoVisto): boolean {
    return turno.dueno !== null && turno.dueno === this.vigente() && turno.generacion === this.generacion;
  }

  /**
   * Guarda lo que llegó y devuelve lo que hay que mostrar: si es IGUAL a lo
   * guardado, el MISMO objeto de antes, así React no vuelve a dibujar nada.
   *
   * 🔴 T-01 · `null` si ya no es de quien lo pidió (otra cuenta, sin sesión o
   * un `vaciar` en el medio): no se guarda y el que llama NO lo muestra.
   */
  guardar<T>(turno: TurnoDeUltimoVisto, clave: ClaveUltimoVisto, valor: T): { readonly valor: T } | null {
    if (!this.sigue(turno)) return null;
    if (turno.dueno !== this.dueno) {
      // La primera vez con esta cuenta (o la sesión cambió sin aviso): lo de otra no queda.
      if (this.dueno !== null) this.soltar();
      this.dueno = turno.dueno;
    }
    let json: string;
    try {
      json = JSON.stringify(valor);
    } catch {
      return { valor };
    }
    const antes = this.entradas.get(clave);
    if (antes && antes.json === json) return { valor: antes.valor as T };
    this.entradas.set(clave, { valor, json });
    return { valor };
  }

  /**
   * D237 · llegó el sin leer: si SUBIÓ respecto de lo guardado, puede haber
   * llegado un aviso de una mesa (te aceptaron, te invitaron, se cerró) y lo de
   * las mesas se borra. Devuelve lo que hay que mostrar, o `null` (T-01).
   */
  registrarSinLeer(turno: TurnoDeUltimoVisto, ahora: number): { readonly valor: number } | null {
    if (!this.sigue(turno)) return null;
    if (subioSinLeer(this.leer<number>('sinLeer'), ahora)) this.olvidar(...CLAVES_DE_MESAS);
    return this.guardar(turno, 'sinLeer', ahora);
  }

  olvidar(...claves: readonly ClaveUltimoVisto[]): void {
    for (const clave of claves) this.entradas.delete(clave);
  }

  /** Todo afuera, y lo pedido hasta ahora ya no se guarda (T-01). */
  vaciar(): void {
    this.soltar();
    this.generacion += 1;
    for (const oyente of [...this.alVaciar]) oyente();
  }

  /** C-07 · avisa cada `vaciar` (cambio de cuenta o de sesión). */
  alVaciarse(oyente: () => void): () => void {
    this.alVaciar.add(oyente);
    return () => this.alVaciar.delete(oyente);
  }

  /**
   * Suelta lo de una cuenta que ya no es la de ahora, SIN subir la generación:
   * lo que la cuenta de ahora ya pidió es suyo y tiene que poder llegar (si no,
   * su pantalla se quedaría esperando). Lo de la otra cuenta lo frena el dueño
   * del turno.
   */
  private soltar(): void {
    this.entradas.clear();
    this.dueno = null;
  }

  /**
   * Se engancha a la sesión: si cambia el dueño (o no hay), se vacía todo.
   * C-07 · también con la caché vacía: cada cambio de dueño (cerrar sesión,
   * entrar, otra cuenta) sube la generación, así ningún turno anterior vale y
   * las memorias por cuenta se borran. Un refresco de tokens no cambia el dueño.
   */
  vigilarSesion(suscribir: (oyente: () => void) => () => void): () => void {
    let visto = this.vigente();
    return suscribir(() => {
      const ahora = this.vigente();
      if (ahora !== visto || (this.dueno !== null && ahora !== this.dueno)) {
        visto = ahora;
        this.vaciar();
      }
    });
  }

  /** Sólo para tests. */
  tamano(): number {
    return this.entradas.size;
  }
}

/** El de la app. Lo engancha a la sesión `AuthProvider` (`vigilarUltimoVistoConLaSesion`). */
export const ultimoVisto = new UltimoVisto();

export function vigilarUltimoVistoConLaSesion(): () => void {
  return ultimoVisto.vigilarSesion(subscribeSession);
}

/** Borra todo lo que depende de las mesas (después de una acción sobre una mesa). */
export function olvidarLoDeMesas(): void {
  ultimoVisto.olvidar(...CLAVES_DE_MESAS);
}

/** Borra todo lo de Amigos (después de responder, bloquear o tocar grupos). */
export function olvidarLoDeAmigos(): void {
  ultimoVisto.olvidar(...CLAVES_DE_AMIGOS);
}

/**
 * D237 · el sin leer subió respecto de lo último visto: puede haber llegado un
 * aviso de una mesa (te aceptaron, te invitaron, se cerró), así que lo de las
 * mesas guardado puede estar viejo.
 */
export function subioSinLeer(antes: number | undefined, ahora: number): boolean {
  return antes !== undefined && ahora > antes;
}

/** Cuánto se espera, en la PRIMERA carga, antes de mostrar un esqueleto o «Cargando…». */
export const ESPERA_ANTES_DEL_ESQUELETO_MS = 300;

/**
 * D237 · `true` recién cuando `cargando` lleva {@link ESPERA_ANTES_DEL_ESQUELETO_MS}
 * seguidos. Si los datos llegan antes —lo habitual, 100–200 ms— el esqueleto no
 * se ve nunca: un parpadeo de 100 ms no informa nada y promete una forma que
 * capaz no es la de lo que llega.
 */
export function useEsperaVisible(cargando: boolean, ms: number = ESPERA_ANTES_DEL_ESQUELETO_MS): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!cargando) {
      setVisible(false);
      return undefined;
    }
    const id = setTimeout(() => setVisible(true), ms);
    return () => clearTimeout(id);
  }, [cargando, ms]);
  return cargando && visible;
}
