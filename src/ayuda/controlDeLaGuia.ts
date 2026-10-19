import type { PageId } from '../router';
import type { EstadoDelEjemplo } from './ejemplo/estadoEjemplo';
import { enElRecorrido, saliendoVuelveAInicio, type IdDePaso } from './recorridoGuia';

/**
 * D363 · revisión de V sobre ff5dec7 (a2b729e4…) · cuándo arranca, sigue y se
 * va la guía, como funciones puras (el provider sólo las cablea).
 *
 * 🔴 **El ejemplo arranca con la primera burbuja visible, no al abrir.** Antes
 * `abrir()` prendía el ejemplo antes de cargar el motor: si el `import()`
 * fallaba, el ejemplo quedaba activo sin guía, y con el ticket de ejemplo en
 * pantalla «Continuar» podía terminar en un `createMesa` real. Ahora la guía
 * se abre «antes de empezar» y el ejemplo se prende cuando la 2a se ve de
 * verdad (motor montado, sin una ventana encima).
 *
 * Dos salidas distintas:
 * - **salir** (la ✕, «otro momento», Escape, «Cerrar guía»): la decide la
 *   persona; si el ejemplo había empezado y está en una pantalla del
 *   recorrido, vuelve a Inicio.
 * - **por la ruta** (otra pestaña, Escanear antes de empezar, un viaje que
 *   empieza hoy): la guía se cierra sin navegar ni mover el foco. Navegar ahí
 *   le sacaría a la persona la pantalla que eligió (y la foto que llega).
 */

export interface Apertura {
  readonly abierta: boolean;
  /** Dónde se abrió: antes de que se vea la primera burbuja, la guía espera sólo ahí. */
  readonly pagina: PageId | null;
  /** El ejemplo ya arrancó (la 2a se vio). */
  readonly empezado: boolean;
}

export const GUIA_CERRADA: Apertura = { abierta: false, pagina: null, empezado: false };

export interface Donde {
  readonly pagina: PageId;
  readonly param: string | null;
}

/** Abrir con la guía abierta no hace nada: un segundo toque no reinicia ni deja el ejemplo a medias. */
export function abrirLaGuia(a: Apertura, pagina: PageId): Apertura {
  return a.abierta ? a : { abierta: true, pagina, empezado: false };
}

/** ¿Esta burbuja prende el ejemplo? Sólo la 2a, la primera vez, en la página donde se abrió y con el ejemplo apagado. */
export function debeEmpezar(a: Apertura, paso: IdDePaso, pagina: PageId, ejemploActivo: boolean): boolean {
  return a.abierta && !a.empezado && paso === 'apertura' && pagina === a.pagina && !ejemploActivo;
}

/**
 * ¿La guía se cierra por la ruta (sin navegar)?
 * - Antes de empezar: si la persona se fue de la página donde la abrió, o si hoy pasa a caer en un viaje (D365).
 * - Empezada: si alguien descartó el ejemplo, si en la fase de la foto hoy pasa a caer en un viaje (la cámara de la
 *   barra lleva al viaje), o si la persona se fue del recorrido (Q7).
 */
export function cierraPorLaRuta(
  a: Apertura,
  ejemplo: Pick<EstadoDelEjemplo, 'activo' | 'fase'>,
  donde: Donde,
  enFechasDeViaje: boolean | null,
): boolean {
  if (!a.abierta) return false;
  if (!a.empezado) return donde.pagina !== a.pagina || enFechasDeViaje === true;
  if (!ejemplo.activo) return true;
  if (ejemplo.fase === 'foto' && enFechasDeViaje === true) return true;
  return !enElRecorrido({ fase: ejemplo.fase, pagina: donde.pagina, param: donde.param });
}

/** Al salir: ¿vuelve a Inicio? Sólo si el ejemplo había empezado y la persona está en una pantalla del recorrido. */
export function salirVuelveAInicio(a: Apertura, donde: Donde): boolean {
  return a.abierta && a.empezado && saliendoVuelveAInicio(donde);
}

/**
 * ¿La guía espera? Con la puerta legal o la del @ (`habilitada` en false). Ya no espera a las invitaciones ni al
 * aviso de fotos (V, 2026-10-19: el toque explícito de D364 les gana); las ventanas que tapan la pantalla las mira el
 * motor (`hayModal`).
 */
export function guiaEspera(habilitada: boolean): boolean {
  return !habilitada;
}

/**
 * Carga el motor. Si el `import()` falla, se avisa y el ejemplo se descarta (nunca llegó a empezar: esto es por las
 * dudas). `vigente` es false si el provider ya se desmontó.
 */
export function cargarElMotor<M>(
  importar: () => Promise<M>,
  h: { readonly vigente: () => boolean; readonly alCargar: (motor: M) => void; readonly alFallar: () => void },
): Promise<void> {
  return importar().then(
    (motor) => { if (h.vigente()) h.alCargar(motor); },
    () => { if (h.vigente()) h.alFallar(); },
  );
}
