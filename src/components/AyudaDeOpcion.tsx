import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useIdioma } from '../i18n/idioma';
import { Icon } from './Icon';

/**
 * D366 · el «?» de cada forma de dividir en «¿Cómo dividen?», para todos (dentro
 * y fuera del tutorial). Elección de Mati: «Sí, con texto ajustado».
 *
 * - Es un botón HERMANO del radio de la opción, nunca adentro (un botón dentro
 *   de otro no se puede tocar ni anunciar bien). 22 px de círculo y 44 de toque.
 * - Abre una explicación en una burbuja arriba de la opción, con la punta hacia
 *   el «?». Si arriba no entra (la primera opción, contra el borde de lo que se
 *   desplaza), va abajo: arriba quedaba recortada y su ✕ no se podía tocar
 *   (medido en la corrida e2e del 2026-10-18). Una a la vez: la decide la
 *   pantalla (`abierta`).
 * - El mismo «?», la ✕ o Escape la cierran, y el foco vuelve al «?».
 * - No elige la opción ni cambia nada: sólo explica.
 *
 * Medidas y colores del paquete de Claude Design (ficha del tutorial, «Signo de
 * pregunta» y «Burbuja explicativa»), con los tokens de `global.css`.
 */
export function AyudaDeOpcion({
  id,
  opcion,
  texto,
  abierta,
  onAbrir,
  onCerrar,
}: {
  /** El id de la burbuja, para `aria-controls`. */
  id: string;
  /** El nombre de la opción, para el nombre accesible del «?». */
  opcion: string;
  /** La explicación, ya traducida. */
  texto: string;
  abierta: boolean;
  onAbrir: () => void;
  onCerrar: () => void;
}) {
  const { t } = useIdioma();
  const boton = useRef<HTMLButtonElement | null>(null);
  const burbuja = useRef<HTMLDivElement | null>(null);
  const devolverFoco = useRef(false);
  const [abajo, setAbajo] = useState(false);

  // La burbuja es absoluta. Medimos sin la animación y desplazamos sólo el
  // cuerpo de División para que el borde inferior quede sobre la barra.
  useLayoutEffect(() => {
    if (!abierta) {
      setAbajo(false);
      if (!devolverFoco.current) return;
      devolverFoco.current = false;
      const disparador = boton.current;
      const fila = disparador?.closest('.div-opcion');
      const contenedor = fila && cuerpoDesplazable(fila);
      if (fila && contenedor) {
        const { superior, inferior } = limitesVisibles(contenedor);
        const caja = fila.getBoundingClientRect();
        if (caja.top < superior) contenedor.scrollTop += caja.top - superior;
        else if (caja.bottom > inferior) contenedor.scrollTop += caja.bottom - inferior;
      }
      disparador?.focus({ preventScroll: true });
      return;
    }
    const nota = burbuja.current;
    const opcion = nota?.offsetParent;
    if (!nota || !opcion) return;
    const contenedor = cuerpoDesplazable(opcion);
    if (!contenedor) return;

    const { superior, inferior } = limitesVisibles(contenedor);
    const fila = opcion.getBoundingClientRect();
    const arriba = fila.top - SEPARACION - nota.offsetHeight;
    const vaAbajo = arriba + contenedor.scrollTop < superior;
    setAbajo(vaAbajo);

    const scrollAlAbrir = contenedor.scrollTop;
    const inicio = vaAbajo ? fila.bottom + SEPARACION : arriba;
    const fin = inicio + nota.offsetHeight;
    if (inicio < superior) contenedor.scrollTop += inicio - superior;
    else if (fin + SEPARACION > inferior) contenedor.scrollTop += fin + SEPARACION - inferior;
    const scrollParaLaBurbuja = contenedor.scrollTop;

    return () => {
      // Devuelve la opción a su lugar si sólo la burbuja movió el cuerpo.
      // Si la persona siguió desplazando la lista, conserva ese movimiento.
      if (contenedor.scrollTop === scrollParaLaBurbuja) contenedor.scrollTop = scrollAlAbrir;
    };
  }, [abierta]);

  // Al abrirse, el foco pasa a la burbuja: así el lector de pantalla lee la
  // explicación. Sin mover la vista: la burbuja ya está al lado del «?».
  useEffect(() => {
    if (abierta) burbuja.current?.focus({ preventScroll: true });
  }, [abierta]);

  const cerrar = (): void => {
    devolverFoco.current = true;
    onCerrar();
  };

  return (
    <>
      <button
        ref={boton}
        type="button"
        className={`ayuda-opcion-boton${abierta ? ' on' : ''}`}
        aria-label={t('Cómo funciona: {0}', opcion)}
        aria-expanded={abierta}
        // Sólo apunta a la burbuja cuando existe: cerrada no está en el documento.
        aria-controls={abierta ? id : undefined}
        onClick={() => { if (abierta) cerrar(); else onAbrir(); }}
        onKeyDown={(e) => { if (abierta && e.key === 'Escape') { e.preventDefault(); cerrar(); } }}
      >
        <span className="ayuda-opcion-signo" aria-hidden="true">?</span>
      </button>
      {abierta && (
        <div
          ref={burbuja}
          id={id}
          className={`ayuda-opcion-burbuja${abajo ? ' ayuda-opcion-burbuja--abajo' : ''}`}
          role="note"
          tabIndex={-1}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); cerrar(); } }}
        >
          <p>{texto}</p>
          <button type="button" className="ayuda-opcion-cerrar" aria-label={t('Cerrar la explicación')} onClick={cerrar}>
            <Icon name="x" size={20} />
          </button>
        </div>
      )}
    </>
  );
}

/** Los 10 px entre la burbuja y su opción (`.ayuda-opcion-burbuja`, `calc(100% + 10px)`). */
const SEPARACION = 10;

/** La lista o el cuerpo exterior de División, según la altura del viewport. */
function cuerpoDesplazable(desde: Element): HTMLElement | null {
  for (let el = desde.parentElement; el; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el);
    if (overflowY === 'auto' || overflowY === 'scroll') return el;
  }
  return null;
}

function limitesVisibles(contenedor: HTMLElement): { superior: number; inferior: number } {
  const caja = contenedor.getBoundingClientRect();
  const barra = contenedor.closest('.app')?.querySelector('.appbar-block');
  const circulo = barra?.querySelector('.appbar-fab');
  return {
    superior: Math.max(0, caja.top),
    inferior: Math.min(window.innerHeight, caja.bottom,
      barra?.getBoundingClientRect().top ?? Infinity,
      circulo?.getBoundingClientRect().top ?? Infinity),
  };
}
