import { useId, type CSSProperties, type Ref } from 'react';
import { Icon } from '../components/Icon';
import { MARGEN_DEL_ANILLO, type Caja, type Posicion } from './posicionGuia';
import type { Paso } from './recorridoGuia';

type T = (s: string, ...args: unknown[]) => string;

/**
 * D363 · la burbuja del tutorial, sólo presentación: el motor (`GuiaContenido`)
 * decide el paso y la posición; esto dibuja el anillo, la flecha o la punta, el
 * texto y el pie (ficha de Claude Design, «Burbuja de la guía» y «Flecha, punta
 * y anillo»). Sin título: la primera frase va en 700. Sin Atrás: cada parte vive
 * en otra pantalla y la guía no navega.
 *
 * Diálogo NO modal: la app sigue respondiendo; el nombre es la primera frase.
 */
export function BurbujaGuia({
  paso, posicion, objetivo, radio, zoom, ancho, t, burbujaRef, onSalir, onSiguiente, onTerminar,
}: {
  paso: Paso;
  posicion: Posicion;
  objetivo: Caja;
  /** El radio del anillo: el del control + 4. */
  radio: string;
  zoom: number;
  ancho: number;
  t: T;
  burbujaRef: Ref<HTMLElement>;
  /** ✕, Escape y «Realizar el tutorial en otro momento». */
  onSalir: () => void;
  onSiguiente: () => void;
  onTerminar: () => void;
}) {
  const idPrimera = useId();
  // La flecha, entre la burbuja y el anillo, sobre el centro del control; en 2b, al costado del disparador.
  const alCostado = paso.referencia !== null;
  const flechaLeft = alCostado
    ? (objetivo.left - MARGEN_DEL_ANILLO - 4 - 28) / zoom
    : (posicion.left + posicion.centro) / zoom - 14;
  const flechaTop = alCostado
    ? ((objetivo.top + objetivo.bottom) / 2 - 14) / zoom
    : posicion.lado === 'arriba'
      ? (objetivo.top - MARGEN_DEL_ANILLO - 4 - 28) / zoom
      : (objetivo.bottom + MARGEN_DEL_ANILLO + 4) / zoom;
  const estilo: CSSProperties & Record<'--guia-centro', string> = {
    left: posicion.left / zoom,
    top: posicion.top / zoom,
    width: ancho / zoom,
    maxHeight: posicion.maxAlto / zoom,
    '--guia-centro': `${posicion.centro / zoom}px`,
  };
  const conEquis = paso.salida === 'equis';
  return <>
    <div
      className={`guia-anillo guia-anillo--${paso.anillo}`}
      aria-hidden="true"
      style={{
        left: (objetivo.left - 4) / zoom,
        top: (objetivo.top - 4) / zoom,
        width: (objetivo.right - objetivo.left + 8) / zoom,
        height: (objetivo.bottom - objetivo.top + 8) / zoom,
        borderRadius: radio,
      }}
    />
    {paso.senal === 'flecha' && (
      <div className="guia-flecha" data-lado={alCostado ? 'costado' : posicion.lado} aria-hidden="true" style={{ left: flechaLeft, top: flechaTop }}>
        <Icon name="arrow-right" size={16} />
      </div>
    )}
    <section
      ref={burbujaRef}
      className="guia-burbuja"
      role="dialog"
      aria-modal="false"
      aria-labelledby={idPrimera}
      tabIndex={-1}
      data-paso={paso.id}
      data-lado={posicion.lado}
      style={estilo}
    >
      {paso.senal === 'punta' && <span className="guia-punta" aria-hidden="true" />}
      {conEquis && (
        <button type="button" className="guia-cerrar" aria-label={t('Cerrar guía')} onClick={paso.pie === 'terminar' ? onTerminar : onSalir}>
          <Icon name="x" size={20} />
        </button>
      )}
      <div className={`guia-texto${conEquis ? ' guia-texto--con-equis' : ''}`}>
        {paso.textos.map((texto, i) => (
          <p key={i} id={i === 0 ? idPrimera : undefined} className={i === 0 && paso.negrita ? 'guia-primera' : undefined}>{texto}</p>
        ))}
      </div>
      {(paso.pie === 'siguiente' || paso.pie === 'contador') && (
        <div className="guia-pie">
          {paso.contador && <span className="guia-contador">{t('{0} de {1}', paso.contador[0], paso.contador[1])}</span>}
          {paso.pie === 'siguiente' && <button type="button" className="guia-siguiente" onClick={onSiguiente}>{t('Siguiente')}</button>}
        </div>
      )}
      {paso.pie === 'terminar' && (
        <div className="guia-pie guia-pie--final">
          <button type="button" className="guia-siguiente" onClick={onTerminar}>{t('Terminar guía')}</button>
        </div>
      )}
      {paso.salida === 'enlace' && (
        <button type="button" className="guia-otro-momento" onClick={onSalir}>{t('Realizar el tutorial en otro momento')}</button>
      )}
    </section>
  </>;
}
