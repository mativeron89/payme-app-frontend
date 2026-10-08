import type { IconName } from '../components/Icon';
import type { PlataformaConGuia } from './agregarAInicio';

/**
 * D176 · D229 · los pasos de la guía «Agregar a inicio», por navegador. Es el
 * ÚNICO lugar donde viven: si la captura del teléfono de prueba muestra otro
 * rótulo, se cambia acá (y su inglés en `en.ts`).
 *
 * Reciben `t` en vez de devolver claves para que cada texto sea un `t('…')`
 * literal: así la guarda de traducción los ve sin una familia dinámica más.
 *
 * Samsung Internet (D229), con los rótulos sin confirmar en español:
 * - la fuente concreta es la guía con capturas del Cheshire West and Chester
 *   Council: menú ≡ abajo a la derecha → «Add to» (⊕) → «Home screen» → «Add».
 *   Su texto dice «Add page to», pero en su captura el botón dice «Add to»;
 * - la documentación de Samsung sólo dice que existe un menú «Add to Home»;
 * - el ícono de instalar de la barra de direcciones no se dibuja: no se sabe
 *   cómo se ve hoy.
 */
export interface PasoDeLaGuia {
  readonly texto: string;
  readonly icono?: IconName;
}

export interface TextosDeLaGuia {
  readonly pasos: readonly PasoDeLaGuia[];
  /** Una línea debajo de los pasos, sin número. */
  readonly nota?: string;
}

export function textosDeLaGuia(plataforma: PlataformaConGuia, t: (es: string) => string): TextosDeLaGuia {
  if (plataforma === 'samsung_guia') {
    return {
      pasos: [
        { texto: t('Toca el menú'), icono: 'menu' },
        { texto: t('Toca «Agregar a»'), icono: 'plus-circle' },
        { texto: t('Elige «Pantalla de inicio»') },
        { texto: t('Toca «Agregar»') },
      ],
      nota: t('Si en la barra de direcciones ves el ícono de instalar, también sirve.'),
    };
  }
  return {
    pasos: [
      { texto: t('Toca Compartir'), icono: 'share' },
      { texto: t('Elige «Agregar a inicio»') },
    ],
  };
}
