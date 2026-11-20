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
  const [abajo, setAbajo] = useState(false);

  // La burbuja es absoluta. Medimos sin la animación y desplazamos sólo el
  // cuerpo de División para que el borde inferior quede sobre la barra.
  useLayoutEffect(() => {
    if (!abierta) { setAbajo(false); return; }
    const nota = burbuja.current;
    const opcion = nota?.offsetParent;
    if (!nota || !opcion) return;
    const contenedor = cuerpoDesplazable(opcion);
    if (!contenedor) return;

    const caja = contenedor.getBoundingClientRect();
    const superior = Math.max(0, caja.top);
    const fila = opcion.getBoundingClientRect();
    const arriba = fila.top - SEPARACION - nota.offsetHeight;
    const vaAbajo = arriba + contenedor.scrollTop < superior;
    setAbajo(vaAbajo);

    const barra = nota.closest('.app')?.querySelector('.appbar-block');
    const circulo = barra?.querySelector('.appbar-fab');
    const inferior = Math.min(window.innerHeight, caja.bottom,
      barra?.getBoundingClientRect().top ?? Infinity,
      circulo?.getBoundingClientRect().top ?? Infinity);
    const inicio = vaAbajo ? fila.bottom + SEPARACION : arriba;
    const fin = inicio + nota.offsetHeight;
    if (inicio < superior) contenedor.scrollTop += inicio - superior;
    else if (fin + SEPARACION > inferior) contenedor.scrollTop += fin + SEPARACION - inferior;
  }, [abierta]);

  // Al abrirse, el foco pasa a la burbuja: así el lector de pantalla lee la
  // explicación. Sin mover la vista: la burbuja ya está al lado del «?».
  useEffect(() => {
    if (abierta) burbuja.current?.focus({ preventScroll: true });
  }, [abierta]);

  const cerrar = (): void => {
    onCerrar();
    boton.current?.focus({ preventScroll: true });
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
