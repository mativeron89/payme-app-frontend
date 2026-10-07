import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import {
  BORDES,
  ESQUINAS,
  minimoProporcional,
  moverAsa,
  moverConTecla,
  type Asa,
  type Marco,
} from '../camara/marcoDelRecorte';
import { useIdioma } from '../i18n/idioma';

/**
 * D222 · la foto del ticket con el marco para recortarla a mano, en el hueco de
 * la foto de «Escanea el ticket».
 *
 * - **La foto es el mismo `<img>` ya decodificado** (`decodificarFoto`): se
 *   cuelga acá tal cual, sin otra URL ni otra decodificación. Un 12 MP del
 *   iPhone no se decodifica dos veces.
 * - **El marco arranca en los bordes de la foto** y se ajusta desde las cuatro
 *   esquinas y los cuatro bordes. Lo de afuera se ve oscurecido. Las ocho zonas
 *   son `<button>` de al menos 44 px, con nombre, y se mueven también con las
 *   flechas del teclado.
 * - **El marco vive en proporciones de la foto** (`marcoDelRecorte`): si la
 *   pantalla cambia de tamaño, queda en el mismo lugar de la foto.
 * - **Un dedo por vez.** `touch-action: none` evita que pellizcar adentro haga
 *   zoom de la página; un segundo dedo durante el arrastre se ignora; si el
 *   navegador cancela el gesto, el marco queda donde estaba.
 */
export interface RecorteDelTicketProps {
  /** La foto decodificada (`FotoDecodificada.fuente`). */
  foto: HTMLImageElement;
  /** Sus medidas, ya orientadas. */
  ancho: number;
  alto: number;
  marco: Marco;
  onMarco: (marco: Marco) => void;
  disabled?: boolean;
}

/** El margen para que las zonas de las esquinas entren enteras. */
const MARGEN = 6;

interface Arrastre {
  asa: Asa;
  pointerId: number;
  x: number;
  y: number;
  marco: Marco;
  anchoPx: number;
  altoPx: number;
}

export function RecorteDelTicket({ foto, ancho, alto, marco, onMarco, disabled }: RecorteDelTicketProps) {
  const { t } = useIdioma();
  const caja = useRef<HTMLDivElement | null>(null);
  const lienzo = useRef<HTMLDivElement | null>(null);
  const arrastre = useRef<Arrastre | null>(null);
  const [tamano, setTamano] = useState<{ ancho: number; alto: number } | null>(null);

  // La foto ya decodificada, colgada tal cual. Al irse la pantalla se descuelga;
  // soltarla (URL y memoria) es de quien la decodificó.
  useEffect(() => {
    const host = lienzo.current;
    if (!host) return undefined;
    foto.className = 'recorte-img';
    foto.draggable = false;
    host.append(foto);
    return () => {
      foto.remove();
    };
  }, [foto]);
  const textoAlternativo = t('Foto del ticket');
  useEffect(() => {
    foto.alt = textoAlternativo;
  }, [foto, textoAlternativo]);

  // La foto entera en el hueco (como `object-fit: contain`), medida en px para
  // poder poner el marco y las zonas encima.
  useEffect(() => {
    const el = caja.current;
    if (!el) return undefined;
    const medir = () => {
      const r = el.getBoundingClientRect();
      const cw = Math.max(0, r.width - 2 * MARGEN);
      const ch = Math.max(0, r.height - 2 * MARGEN);
      if (!(cw > 0) || !(ch > 0) || !(ancho > 0) || !(alto > 0)) {
        setTamano(null);
        return;
      }
      const escala = Math.min(cw / ancho, ch / alto);
      setTamano({ ancho: ancho * escala, alto: alto * escala });
    };
    medir();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', medir);
      return () => window.removeEventListener('resize', medir);
    }
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ancho, alto]);

  const minX = minimoProporcional(tamano?.ancho ?? 0);
  const minY = minimoProporcional(tamano?.alto ?? 0);

  const empezar = (asa: Asa) => (e: PointerEvent<HTMLButtonElement>) => {
    if (disabled || !tamano) return;
    // Un dedo por vez: el segundo, durante un arrastre, no hace nada.
    if (arrastre.current) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Sin captura, el arrastre igual sigue mientras el dedo esté encima.
    }
    arrastre.current = {
      asa,
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      marco,
      anchoPx: tamano.ancho,
      altoPx: tamano.alto,
    };
  };

  const mover = (e: PointerEvent<HTMLButtonElement>) => {
    const a = arrastre.current;
    if (!a || e.pointerId !== a.pointerId) return;
    e.preventDefault();
    // Siempre desde el marco del comienzo y el corrimiento total: el marco no
    // se va desviando, y volver con el dedo lo devuelve a donde estaba.
    const dx = (e.clientX - a.x) / a.anchoPx;
    const dy = (e.clientY - a.y) / a.altoPx;
    onMarco(moverAsa(a.marco, a.asa, dx, dy, minimoProporcional(a.anchoPx), minimoProporcional(a.altoPx)));
  };

  const terminar = (e: PointerEvent<HTMLButtonElement>) => {
    const a = arrastre.current;
    if (!a || e.pointerId !== a.pointerId) return;
    // Cancelado o terminado, el marco queda donde estaba.
    arrastre.current = null;
  };

  const tecla = (asa: Asa) => (e: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const nuevo = moverConTecla(marco, asa, e.key, minX, minY);
    if (!nuevo) return;
    e.preventDefault();
    onMarco(nuevo);
  };

  const nombres: Record<Asa, string> = {
    'arriba-izquierda': t('Esquina de arriba a la izquierda'),
    'arriba-derecha': t('Esquina de arriba a la derecha'),
    'abajo-izquierda': t('Esquina de abajo a la izquierda'),
    'abajo-derecha': t('Esquina de abajo a la derecha'),
    arriba: t('Borde de arriba'),
    abajo: t('Borde de abajo'),
    izquierda: t('Borde de la izquierda'),
    derecha: t('Borde de la derecha'),
  };

  const pct = (v: number) => `${v * 100}%`;
  const posicion = (asa: Asa): CSSProperties => {
    switch (asa) {
      case 'arriba-izquierda': return { left: pct(marco.x0), top: pct(marco.y0) };
      case 'arriba-derecha': return { left: pct(marco.x1), top: pct(marco.y0) };
      case 'abajo-izquierda': return { left: pct(marco.x0), top: pct(marco.y1) };
      case 'abajo-derecha': return { left: pct(marco.x1), top: pct(marco.y1) };
      // Los bordes van entre las zonas de las esquinas, a lo largo del lado.
      case 'arriba':
      case 'abajo':
        return {
          left: `calc(${pct(marco.x0)} + 22px)`,
          width: `max(0px, calc(${pct(marco.x1 - marco.x0)} - 44px))`,
          top: pct(asa === 'arriba' ? marco.y0 : marco.y1),
        };
      default:
        return {
          top: `calc(${pct(marco.y0)} + 22px)`,
          height: `max(0px, calc(${pct(marco.y1 - marco.y0)} - 44px))`,
          left: pct(asa === 'izquierda' ? marco.x0 : marco.x1),
        };
    }
  };

  const asa = (a: Asa, tipo: 'esquina' | 'borde') => (
    <button
      key={a}
      type="button"
      className={`recorte-asa recorte-${tipo} recorte-${a}`}
      style={posicion(a)}
      aria-label={nombres[a]}
      data-asa={a}
      disabled={disabled}
      onPointerDown={empezar(a)}
      onPointerMove={mover}
      onPointerUp={terminar}
      onPointerCancel={terminar}
      onLostPointerCapture={terminar}
      onKeyDown={tecla(a)}
    />
  );

  return (
    <div className="recorte" ref={caja}>
      <div
        className="recorte-foto"
        style={tamano ? { width: tamano.ancho, height: tamano.alto } : { visibility: 'hidden' }}
        role="group"
        aria-label={t('Marco del recorte')}
      >
        <div className="recorte-lienzo" ref={lienzo} />
        {/* Lo de afuera, oscurecido: una sombra enorme del marco, recortada a
            la foto. Va en su propia capa para que la foto no recorte las zonas
            de las esquinas, que sobresalen 22 px. */}
        <div className="recorte-sombra" aria-hidden="true">
          <div
            className="recorte-marco"
            style={{
              left: pct(marco.x0),
              top: pct(marco.y0),
              width: pct(marco.x1 - marco.x0),
              height: pct(marco.y1 - marco.y0),
            }}
          />
        </div>
        {ESQUINAS.map((a) => asa(a, 'esquina'))}
        {BORDES.map((a) => asa(a, 'borde'))}
      </div>
    </div>
  );
}
