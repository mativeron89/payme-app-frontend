import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useIdioma } from '../i18n/idioma';
import { Icon } from './Icon';

/**
 * AF-BORRAR-MESAS · decisión 239 de Mati: «Para borrar, que se desplace hacia la
 * izquierda la burbuja y aparezca el botón de eliminar en rojo».
 *
 * - Deslizar a la izquierda corre la tarjeta y deja ver «Eliminar» en rojo.
 *   Pasada la mitad del botón queda abierta; si no, vuelve.
 * - Deslizar de vuelta, tocar la tarjeta o tocar afuera la cierra sin borrar.
 * - Una sola abierta a la vez: lo decide la pantalla (`abierta`).
 * - El arrastre no dispara el toque de la tarjeta (abrir el detalle).
 * - **La alternativa sin gesto** (teclado y lector de pantalla): el botón
 *   «Eliminar» está siempre en el orden de tabulación, con el nombre de la
 *   tarjeta («Eliminar La Parolaccia»). Al recibir el foco, la tarjeta se corre
 *   y se ve; al salir el foco, vuelve.
 */

/** El ancho del botón rojo: lo que se corre la tarjeta abierta. */
export const ANCHO_ELIMINAR = 96;
/** Movimiento mínimo para decidir si es un arrastre horizontal o un scroll. */
const UMBRAL = 8;

export function FilaDeslizable({
  abierta,
  onAbrir,
  onCerrar,
  nombre,
  onEliminar,
  className,
  children,
}: {
  abierta: boolean;
  onAbrir: () => void;
  onCerrar: () => void;
  /** Lo que se borra, para el nombre accesible del botón («Eliminar {nombre}»). */
  nombre: string;
  onEliminar: () => void;
  className?: string;
  children: ReactNode;
}) {
  const { t } = useIdioma();
  const raiz = useRef<HTMLDivElement | null>(null);
  const inicio = useRef<{ x: number; y: number; base: number; id: number } | null>(null);
  const arrastrando = useRef(false);
  /** Hubo arrastre: el click que sigue al soltar no es un toque. */
  const huboArrastre = useRef(false);
  const [desplazamiento, setDesplazamiento] = useState<number | null>(null);

  // Tocar afuera la cierra.
  useEffect(() => {
    if (!abierta) return undefined;
    const alTocar = (e: PointerEvent) => {
      if (raiz.current && e.target instanceof Node && !raiz.current.contains(e.target)) onCerrar();
    };
    document.addEventListener('pointerdown', alTocar, true);
    return () => document.removeEventListener('pointerdown', alTocar, true);
  }, [abierta, onCerrar]);

  const x = desplazamiento ?? (abierta ? -ANCHO_ELIMINAR : 0);
  /** El rojo se pinta sólo cuando se ve: cerrada, la esquina redondeada dejaba asomar una línea. */
  const mostrando = abierta || x < 0;

  return (
    <div
      ref={raiz}
      className={`deslizable${abierta ? ' deslizable--abierta' : ''}${mostrando ? ' deslizable--mostrando' : ''}${className ? ` ${className}` : ''}`}
      onBlur={(e) => {
        if (abierta && !(e.relatedTarget instanceof Node && raiz.current?.contains(e.relatedTarget))) onCerrar();
      }}
    >
      <div
        className={`deslizable-frente${desplazamiento !== null ? ' deslizable-frente--arrastrando' : ''}`}
        style={{ transform: `translateX(${x}px)` }}
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          inicio.current = { x: e.clientX, y: e.clientY, base: abierta ? -ANCHO_ELIMINAR : 0, id: e.pointerId };
          arrastrando.current = false;
          huboArrastre.current = false;
        }}
        onPointerMove={(e) => {
          const i = inicio.current;
          if (!i || i.id !== e.pointerId) return;
          const dx = e.clientX - i.x;
          const dy = e.clientY - i.y;
          if (!arrastrando.current) {
            if (Math.abs(dx) > UMBRAL && Math.abs(dx) > Math.abs(dy)) {
              arrastrando.current = true;
              huboArrastre.current = true;
              e.currentTarget.setPointerCapture?.(e.pointerId);
            } else if (Math.abs(dy) > UMBRAL) {
              inicio.current = null; // es un scroll
              return;
            } else {
              return;
            }
          }
          setDesplazamiento(Math.max(-ANCHO_ELIMINAR, Math.min(0, i.base + dx)));
        }}
        onPointerUp={(e) => {
          const i = inicio.current;
          inicio.current = null;
          if (!i || !arrastrando.current) return;
          arrastrando.current = false;
          const final = Math.max(-ANCHO_ELIMINAR, Math.min(0, i.base + (e.clientX - i.x)));
          setDesplazamiento(null);
          if (final < -ANCHO_ELIMINAR / 2) onAbrir(); else onCerrar();
        }}
        onPointerCancel={() => {
          inicio.current = null;
          arrastrando.current = false;
          setDesplazamiento(null);
        }}
        onClickCapture={(e) => {
          // El click que sigue a un arrastre no es un toque: no abre el detalle
          // y tampoco cierra lo que el arrastre acaba de abrir (al soltar,
          // React ya re-renderizó con la tarjeta abierta).
          if (huboArrastre.current) {
            e.preventDefault();
            e.stopPropagation();
            huboArrastre.current = false;
            return;
          }
          // Con el botón rojo a la vista, tocar la tarjeta la cierra.
          if (abierta) {
            e.preventDefault();
            e.stopPropagation();
            onCerrar();
          }
        }}
      >
        {children}
      </div>
      <button
        type="button"
        className="deslizable-eliminar"
        aria-label={t('Eliminar {0}', nombre)}
        onFocus={() => { if (!abierta) onAbrir(); }}
        onClick={onEliminar}
      >
        <Icon name="trash" size={18} />
        <span>{t('Eliminar')}</span>
      </button>
    </div>
  );
}
