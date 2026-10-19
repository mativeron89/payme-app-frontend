import type { PageId } from '../router';
import type { ModoUI } from '../screens/divisionModo';
import type { FaseEjemplo } from './ejemplo/estadoEjemplo';
import { esCodigoDeEjemplo } from './ejemplo/fixtureEjemplo';

/**
 * D363 · el recorrido del tutorial «Tu turno» (ficha de Claude Design,
 * `PANTALLA-tutorial-tu-turno.md`, zip 0d97650b…), como datos.
 *
 * El paso NO se elige por qué controles hay en pantalla: sale de la fase de la
 * mesa de ejemplo y de la ruta. El DOM sólo sirve para medir. La guía nunca
 * navega ni toca un control: la persona hace cada paso (salvo al salir, que
 * vuelve a Inicio).
 *
 * Los textos salen ya traducidos, cada uno con su `t('…')` literal (así la
 * guarda de traducciones los ve). Los de 2d «2 de 2» y de 2e en «En partes
 * iguales» y «Pagar el total» son concreción de V, no de Claude Design.
 */
type T = (s: string, ...args: unknown[]) => string;

export type IdDePaso = 'apertura' | 'camara' | 'ticket' | 'invitar' | 'continuar' | 'consumos' | 'final';

export interface Paso {
  readonly id: IdDePaso;
  /** El `data-guia` del control real que se señala. */
  readonly ancla: string;
  /** Dónde va la burbuja si entra; si no, del otro lado (nunca encima del control). */
  readonly lado: 'arriba' | 'abajo';
  /** Flecha donde la persona tiene que tocar; punta donde sólo se explica. */
  readonly senal: 'flecha' | 'punta';
  /**
   * 2b · la leyenda va a 12 ARRIBA del botón de la galería (no del disparador) y la flecha, al costado del
   * disparador: así no tapa la galería. `null` = la burbuja se ubica respecto del control señalado.
   */
  readonly referencia: string | null;
  /** El anillo: oscuro sobre fondos claros y el naranja; claro sobre la cámara. */
  readonly anillo: 'oscuro' | 'claro';
  /** Párrafos: el primero en 700 si `negrita`. */
  readonly textos: readonly string[];
  readonly negrita: boolean;
  /** 2a no lleva ✕: el enlace «Realizar el tutorial en otro momento» cumple su función. */
  readonly salida: 'equis' | 'enlace';
  /** El pie: nada, Siguiente (con su contador si lo hay), sólo el contador, o Terminar guía. */
  readonly pie: 'nada' | 'siguiente' | 'contador' | 'terminar';
  readonly contador: readonly [number, number] | null;
  /** 3a · la burbuja vive dentro de la hoja del ticket, que es `aria-modal`. */
  readonly dentroDeLaHoja: boolean;
}

export interface DondeEsta {
  readonly fase: FaseEjemplo;
  readonly pagina: PageId;
  readonly param: string | null;
  /** 2d tiene dos subpasos en la misma pantalla (Q2 de V). */
  readonly subpaso: 0 | 1;
  readonly division: ModoUI | null;
}

/** El paso que corresponde, o `null` (2c no tiene burbuja: los «?» son de la app). */
export function pasoDeLaGuia(d: DondeEsta, t: T): Paso | null {
  const base = { senal: 'punta', referencia: null, anillo: 'oscuro', negrita: false, salida: 'equis', pie: 'nada', contador: null, dentroDeLaHoja: false } as const;
  if (d.fase === 'foto') {
    // D365 · la cámara de un viaje (`scan` con el id del viaje) no es del recorrido: no hay burbuja.
    if (d.pagina === 'scan' && d.param !== null) return null;
    if (d.pagina === 'scan') {
      return { ...base, id: 'camara', ancla: 'foto', referencia: 'galeria', lado: 'arriba', senal: 'flecha', anillo: 'claro',
        textos: [t('Saca o elige una foto: te mostraremos un ticket de ejemplo.')] };
    }
    return { ...base, id: 'apertura', ancla: 'camara', lado: 'arriba', senal: 'flecha', negrita: true, salida: 'enlace',
      textos: [t('¿Cómo divido la cuenta?'), t('Primero escaneamos el ticket en el siguiente botón.')] };
  }
  if (d.fase === 'ticket' && d.pagina === 'scan') {
    return { ...base, id: 'ticket', ancla: 'hoja-ticket', lado: 'arriba', negrita: true, pie: 'siguiente', dentroDeLaHoja: true,
      textos: [t('Este es el ticket de ejemplo.'), t('Con el tuyo, aquí corriges un plato o agregas uno que falte.')] };
  }
  if (d.fase === 'compartir' && d.pagina === 'scan') {
    return d.subpaso === 0
      ? { ...base, id: 'invitar', ancla: 'compartir', lado: 'abajo', pie: 'siguiente', contador: [1, 2],
        textos: [t('Aquí invitarás a tus amigos a sumarse a la mesa.')] }
      : { ...base, id: 'continuar', ancla: 'continuar', lado: 'arriba', senal: 'flecha', pie: 'contador', contador: [2, 2],
        textos: [t('Toca Continuar para elegir lo tuyo.')] };
  }
  if (d.fase === 'mesa' && d.pagina === 'mesa') {
    return { ...base, id: 'consumos', ancla: 'consumos', lado: 'arriba', senal: 'flecha', negrita: true,
      textos: [
        d.division === 'consumo' ? t('Selecciona lo que consumiste únicamente.') : t('Marca lo que consumiste, si quieres.'),
        t('Si compartiste, selecciona cuánto del plato consumiste. Toca Listo para guardar lo que elegiste.'),
      ] };
  }
  if (d.fase === 'listo' && d.pagina === 'home') {
    return { ...base, id: 'final', ancla: 'mesa-ejemplo', lado: 'abajo', negrita: true, pie: 'terminar',
      textos: [
        t('Así queda tu mesa.'),
        t('La tarjeta muestra cuánto ya se eligió de la cuenta. Esta es de ejemplo: se borra al terminar la guía.'),
      ] };
  }
  return null;
}

/**
 * ¿La persona sigue en el recorrido? Irse (otra pestaña, «Volver» después de la
 * foto, una ruta ajena) cierra la guía y descarta la mesa de ejemplo (plan
 * §4.4, Q7). Cada fase admite las pantallas donde vive y la que sigue, porque
 * la ruta cambia un instante antes que la fase.
 */
export function enElRecorrido(d: Pick<DondeEsta, 'fase' | 'pagina' | 'param'>): boolean {
  const mesaDeEjemplo = d.pagina === 'mesa' && esCodigoDeEjemplo(d.param);
  const camara = camaraDeRestaurante(d);
  switch (d.fase) {
    case 'foto': return d.pagina === 'home' || d.pagina === 'mas' || camara;
    case 'ticket':
    case 'dividir': return camara;
    case 'compartir': return camara || mesaDeEjemplo;
    case 'mesa': return mesaDeEjemplo;
    case 'listo': return d.pagina === 'home' || mesaDeEjemplo;
  }
}

/**
 * D365 · la cámara del recorrido es la de abrir una mesa de restaurante: `scan` sin parámetro. Con el id de un viaje
 * es la cámara del viaje (la de la barra pasa a llevar ahí si cambia el día o llegan los viajes).
 */
function camaraDeRestaurante(d: Pick<DondeEsta, 'pagina' | 'param'>): boolean {
  return d.pagina === 'scan' && d.param === null;
}

/**
 * Al salir desde una pantalla del recorrido, la guía vuelve a Inicio: la tarjeta Tutorial queda a la vista. Desde la
 * cámara de un viaje no: la persona fue ahí por su cuenta (D365).
 */
export function saliendoVuelveAInicio(d: Pick<DondeEsta, 'pagina' | 'param'>): boolean {
  return camaraDeRestaurante(d) || (d.pagina === 'mesa' && esCodigoDeEjemplo(d.param));
}
