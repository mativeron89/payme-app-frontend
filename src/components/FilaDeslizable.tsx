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
 *
 * D360-8 · «a veces se bugea cuando se desplaza una mesa a la izquierda [...] y
 * no permite desplazarla lo suficiente para que termine de aparecer el botón»
 * (Mati). Tres causas, corregidas acá (el componente es compartido: arregla
 * también Amigos y el Balance del viaje):
 * 1. **El iPhone cancela el gesto** (`pointercancel`) cuando empieza a hacer
 *    scroll, y la tarjeta volvía a 0. Ahora, decidido el arrastre horizontal,
 *    un `touchmove` no pasivo le impide al navegador empezar el scroll; y si
 *    igual cancela, la tarjeta se queda donde corresponde según lo que se
 *    corrió (como al soltar), no vuelve sola.
 * 2. **El recorrido sigue al dedo y había que pasar la mitad** (probable, no
 *    medido: va a la prueba de Mati). Un deslizamiento rápido a la izquierda
 *    abre aunque no llegue a la mitad (`decidirAlSoltar`).
 * 3. **La presión larga seleccionaba el texto** de la fila: el frente no se
 *    selecciona (CSS).
 */

/**
 * El ancho del botón rojo: lo que se corre la tarjeta abierta. El CSS de
 * `.deslizable-eliminar` repite el valor; `filaDeslizable.test.ts` comprueba
 * que sean iguales.
 */
export const ANCHO_ELIMINAR = 96;
/** Movimiento mínimo para decidir si es un arrastre horizontal o un scroll. */
const UMBRAL = 8;
/** D360-8 · velocidad (px/ms) de un deslizamiento rápido: 0.4 px/ms = 400 px/s. */
export const VELOCIDAD_RAPIDA = 0.4;
/**
 * D360-8 · lo mínimo que se tiene que haber corrido la tarjeta para que un
 * deslizamiento rápido la abra: un tercio del botón. Por debajo, ni rápido abre
 * (un roce no es un gesto).
 */
export const MINIMO_RAPIDO = 32;
/** D360-8 · la ventana de muestras con que se mide la velocidad al soltar. */
const VENTANA_MS = 100;
/**
 * D360-8 · si el dedo se quedó quieto más que esto antes de soltar, no hubo
 * deslizamiento rápido: la velocidad es 0. El soltar llega a veces un cuadro
 * después del último movimiento y en el mismo lugar (medido en Chromium: 16,7
 * ms), así que no se cuenta como muestra.
 */
export const PAUSA_MS = 60;

/**
 * D360-8 · qué pasa al soltar (o si el navegador cancela el gesto), con lo que
 * se corrió la tarjeta (`final`, ≤ 0) y la velocidad del final del gesto
 * (px/ms; negativa = hacia la izquierda):
 * - rápido a la izquierda y corrida al menos `MINIMO_RAPIDO` → abre;
 * - rápido a la derecha → cierra;
 * - si no, pasada la mitad del botón abre, y si no, cierra (como antes).
 */
export function decidirAlSoltar(final: number, velocidad: number): 'abrir' | 'cerrar' {
  if (velocidad <= -VELOCIDAD_RAPIDA && final <= -MINIMO_RAPIDO) return 'abrir';
  if (velocidad >= VELOCIDAD_RAPIDA) return 'cerrar';
  return final < -ANCHO_ELIMINAR / 2 ? 'abrir' : 'cerrar';
}

interface Muestra { readonly x: number; readonly t: number }

/**
 * La velocidad al soltar (o al cancelar) en el instante `t`: la de los últimos
 * movimientos, o 0 si el dedo ya estaba quieto (`PAUSA_MS`).
 */
export function velocidadAlSoltar(muestras: readonly Muestra[], t: number): number {
  const ultima = muestras[muestras.length - 1];
  if (!ultima || t - ultima.t > PAUSA_MS) return 0;
  return velocidadDe(muestras);
}

/** La velocidad (px/ms) entre la primera y la última muestra de la ventana; 0 si no alcanza. */
export function velocidadDe(muestras: readonly Muestra[]): number {
  if (muestras.length < 2) return 0;
  const primera = muestras[0]!;
  const ultima = muestras[muestras.length - 1]!;
  const dt = ultima.t - primera.t;
  return dt > 0 ? (ultima.x - primera.x) / dt : 0;
}

/** Agrega una muestra y descarta las de más de `VENTANA_MS` antes de ella. */
function conMuestra(muestras: readonly Muestra[], m: Muestra): Muestra[] {
  return [...muestras, m].filter((otra) => m.t - otra.t <= VENTANA_MS);
}

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
  const frente = useRef<HTMLDivElement | null>(null);
  const inicio = useRef<{ x: number; y: number; base: number; id: number } | null>(null);
  const arrastrando = useRef(false);
  /** D360-8 · las últimas posiciones del dedo, para la velocidad al soltar. */
  const muestras = useRef<Muestra[]>([]);
  /** D360-8 · lo último que se corrió la tarjeta, por si el navegador cancela. */
  const ultimoDesplazamiento = useRef(0);
  /** Hubo arrastre: el click que sigue al soltar no es un toque. */
  const huboArrastre = useRef(false);
  const [desplazamiento, setDesplazamiento] = useState<number | null>(null);

  // D360-8 · causa 1: decidido el arrastre horizontal, el navegador no empieza
  // un scroll (en el iPhone eso mandaba `pointercancel` y la tarjeta volvía).
  // No pasivo a propósito: es la única forma de que `preventDefault` cuente.
  // Antes de decidir, o si es un scroll, no se toca nada.
  useEffect(() => {
    const el = frente.current;
    if (!el) return undefined;
    const alMover = (e: TouchEvent) => {
      if (arrastrando.current && e.cancelable) e.preventDefault();
    };
    el.addEventListener('touchmove', alMover, { passive: false });
    return () => el.removeEventListener('touchmove', alMover);
  }, []);

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
        ref={frente}
        className={`deslizable-frente${desplazamiento !== null ? ' deslizable-frente--arrastrando' : ''}`}
        style={{ transform: `translateX(${x}px)` }}
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          const base = abierta ? -ANCHO_ELIMINAR : 0;
          inicio.current = { x: e.clientX, y: e.clientY, base, id: e.pointerId };
          arrastrando.current = false;
          huboArrastre.current = false;
          muestras.current = [{ x: e.clientX, t: e.timeStamp }];
          ultimoDesplazamiento.current = base;
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
          muestras.current = conMuestra(muestras.current, { x: e.clientX, t: e.timeStamp });
          const corrida = Math.max(-ANCHO_ELIMINAR, Math.min(0, i.base + dx));
          ultimoDesplazamiento.current = corrida;
          setDesplazamiento(corrida);
        }}
        onPointerUp={(e) => {
          const i = inicio.current;
          inicio.current = null;
          if (!i || !arrastrando.current) return;
          arrastrando.current = false;
          const final = Math.max(-ANCHO_ELIMINAR, Math.min(0, i.base + (e.clientX - i.x)));
          const velocidad = velocidadAlSoltar(muestras.current, e.timeStamp);
          setDesplazamiento(null);
          if (decidirAlSoltar(final, velocidad) === 'abrir') onAbrir(); else onCerrar();
        }}
        onPointerCancel={(e) => {
          const habiaArrastre = arrastrando.current;
          inicio.current = null;
          arrastrando.current = false;
          setDesplazamiento(null);
          // D360-8 · causa 1: si el navegador cancela en medio del arrastre (el
          // iPhone lo hace al empezar un scroll), la tarjeta queda como si se
          // hubiera soltado ahí, con lo que se corrió. Antes volvía a 0 sola.
          if (!habiaArrastre) return;
          if (decidirAlSoltar(ultimoDesplazamiento.current, velocidadAlSoltar(muestras.current, e.timeStamp)) === 'abrir') onAbrir();
          else onCerrar();
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
