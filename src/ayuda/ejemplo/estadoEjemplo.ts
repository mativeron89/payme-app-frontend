import { useSyncExternalStore } from 'react';
import { MAX_PERSONAS } from '../../api/mesaPresentation';
import { pisoDe, type ModoUI } from '../../screens/divisionModo';

/**
 * D363 · D367 · el estado de la mesa de ejemplo del tutorial, 100 % en memoria.
 *
 * Plan técnico §4.1 (`PLAN_TECNICO_D363_TUTORIAL_NUEVO.md`, 5358aac7…): un solo
 * objeto del módulo y suscripción con `useSyncExternalStore`, **sin
 * `localStorage`, `sessionStorage`, IndexedDB ni el store del mock** (el
 * guardarraíl `sinRed.test.ts` lo vigila sobre todo `src/ayuda/ejemplo/`).
 * Vive hasta `descartar()`: al salir del ejemplo, al terminar la guía, al cambiar
 * de cuenta (el provider se remonta por cuenta y familia) y al recargar, porque
 * es memoria.
 *
 * Nada de acá llama a la red: lo que el ejemplo «guarda» queda en este objeto, y
 * lo que las pantallas le piden a la fachada lo contesta `apiEjemplo.ts` desde
 * acá.
 */

/** Por dónde va la persona: Escanear, el ticket, ¿Cómo dividen?, Compartir, Tu mesa y el final en Inicio. */
export type FaseEjemplo = 'foto' | 'ticket' | 'dividir' | 'compartir' | 'mesa' | 'listo';
export type ExplicacionCompartir = 'copiar' | 'whatsapp' | 'amigo-lucia' | 'amigo-tomas' | 'amigo-ana';

export interface EstadoDelEjemplo {
  readonly activo: boolean;
  readonly fase: FaseEjemplo;
  /** D429 · sólo explica el control tocado; no genera ni envía invitaciones. */
  readonly explicacionCompartir: ExplicacionCompartir | null;
  /** La forma de dividir que eligió en ¿Cómo dividen?; `null` hasta armar la mesa. */
  readonly division: ModoUI | null;
  /** El N del contador; `null` hasta armar la mesa. */
  readonly personas: number | null;
  /**
   * Lo elegido, en bps por plato. En «por lo que pidió cada uno» es lo
   * reservado (`items/lock`); en las otras dos, lo declarado (selección
   * informativa). Una sola persona: todo es propio.
   */
  readonly seleccion: ReadonlyMap<string, number>;
  /** Cuándo se armó la mesa (ms); `null` hasta tocar Continuar en ¿Cómo dividen?. */
  readonly armadaEn: number | null;
  /** Cuándo se guardó la selección por última vez (ms); `null` sin nada guardado. */
  readonly guardadaEn: number | null;
}

const SIN_SELECCION: ReadonlyMap<string, number> = new Map();

export const EJEMPLO_APAGADO: EstadoDelEjemplo = {
  activo: false,
  fase: 'foto',
  explicacionCompartir: null,
  division: null,
  personas: null,
  seleccion: SIN_SELECCION,
  armadaEn: null,
  guardadaEn: null,
};

/** El estado con la mesa ya armada: forma, N y hora conocidos. */
export type EstadoArmado = EstadoDelEjemplo & {
  readonly division: ModoUI;
  readonly personas: number;
  readonly armadaEn: number;
};

/** ¿Ya existe la mesa de ejemplo? (desde Continuar en ¿Cómo dividen? hasta salir). */
export function mesaArmada(estado: EstadoDelEjemplo): estado is EstadoArmado {
  return estado.activo && estado.division !== null && estado.personas !== null && estado.armadaEn !== null;
}

/**
 * 4a · la mesa de ejemplo está en Inicio: después del «Listo» y hasta terminar o
 * salir. Ocupa el lugar de la tarjeta Tutorial y cuenta como mesa para el aviso
 * «No tienes mesas abiertas» (enmienda 2 de `d363_front`).
 */
export function mesaDeEjemploEnInicio(estado: EstadoDelEjemplo): boolean {
  return mesaArmada(estado) && estado.fase === 'listo';
}

export class EjemploLocal {
  private estado: EstadoDelEjemplo = EJEMPLO_APAGADO;
  private readonly oyentes = new Set<() => void>();

  readonly leer = (): EstadoDelEjemplo => this.estado;

  readonly suscribir = (oyente: () => void): (() => void) => {
    this.oyentes.add(oyente);
    return () => { this.oyentes.delete(oyente); };
  };

  private fijar(nuevo: EstadoDelEjemplo): void {
    if (nuevo === this.estado) return;
    this.estado = nuevo;
    for (const oyente of [...this.oyentes]) oyente();
  }

  /** Arranca de cero, aunque hubiera un ejemplo a medias: el recorrido empieza en Escanear. */
  empezar(): void {
    this.fijar({ ...EJEMPLO_APAGADO, activo: true, seleccion: new Map() });
  }

  /** Mueve la fase. Con el ejemplo apagado no hace nada: nadie lo prende moviendo una fase. */
  irA(fase: FaseEjemplo): void {
    if (!this.estado.activo || this.estado.fase === fase) return;
    this.fijar({ ...this.estado, fase, explicacionCompartir: null });
  }

  /** Una explicación local, sólo mientras está en Compartir. Cerrar conserva el paso de la guía. */
  explicarCompartir(explicacionCompartir: ExplicacionCompartir | null): void {
    if (!this.estado.activo || this.estado.fase !== 'compartir' || this.estado.explicacionCompartir === explicacionCompartir) return;
    this.fijar({ ...this.estado, explicacionCompartir });
  }

  /**
   * Continuar en ¿Cómo dividen?: arma la mesa y pasa a Compartir. Rechaza un N
   * que la pantalla real tampoco dejaría pasar (el piso de cada forma y el tope
   * de 50, D375): el ejemplo no puede tener una mesa que la app no podría abrir.
   */
  armarMesa(division: ModoUI, personas: number, ahora: number = Date.now()): void {
    if (!this.estado.activo) return;
    if (!Number.isSafeInteger(personas) || personas < pisoDe(division) || personas > MAX_PERSONAS) {
      throw new Error('ejemplo_personas_invalidas');
    }
    this.fijar({
      ...this.estado, fase: 'compartir', explicacionCompartir: null, division, personas, seleccion: new Map(), armadaEn: ahora, guardadaEn: null,
    });
  }

  /** Reemplaza la selección entera (lo que contestan `items/lock` y la selección informativa locales). */
  elegir(seleccion: ReadonlyMap<string, number>, ahora: number = Date.now()): void {
    if (!mesaArmada(this.estado)) return;
    this.fijar({ ...this.estado, seleccion: new Map(seleccion), guardadaEn: seleccion.size > 0 ? ahora : null });
  }

  /** Salir, terminar o cambiar de cuenta: la mesa de ejemplo se borra (D367). */
  descartar(): void {
    this.fijar(EJEMPLO_APAGADO);
  }
}

export const ejemploLocal = new EjemploLocal();

/** El estado del ejemplo para una pantalla; se vuelve a dibujar cuando cambia. */
export function useEjemplo(): EstadoDelEjemplo {
  return useSyncExternalStore(ejemploLocal.suscribir, ejemploLocal.leer, ejemploLocal.leer);
}
