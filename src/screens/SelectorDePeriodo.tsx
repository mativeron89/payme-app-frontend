import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useIdioma } from '../i18n/idioma';
import { Icon } from '../components/Icon';
import { useHojaModal } from '../components/useHojaModal';
import { PERIODOS, elegirPeriodo, type ClavePeriodo } from '../api/periodoEstadisticas';
import { etiquetaDePeriodo } from '../utils/textosDeEstadisticas';
import { mesesDeMexico, nombreDelPeriodo } from '../utils/meses';

/**
 * AF-31 · el período de la burbuja de 2a, 2b y 2c (diseño: «el período va solo
 * a la izquierda, con una flecha chica que abre el selector»). El diseño no
 * dibuja el selector abierto: se usa la hoja inferior que la app ya tiene
 * (`.sheet-overlay` + `.sheet`, el patrón de Inicio), con las cuatro opciones
 * del dueño como radios.
 *
 * Va por PORTAL a `document.body`: la burbuja (`.title-card`, `z-index: 1`) es
 * su propio contexto de apilamiento, y adentro la hoja quedaba encerrada en la
 * burbuja y debajo de la barra inferior (medido en la primera captura).
 *
 * `disponible` = el dueño CONFIRMÓ el período pedido. Si no (backend anterior a
 * v2.106.0), no hay flecha ni hoja: sólo el mes en curso, que es lo que llegó.
 *
 * AF-36 · la burbuja dice el NOMBRE del período, como el diseño («Septiembre»,
 * «Agosto», «2026»), leído de `inicio` (`period.start` confirmado) en hora de
 * México. «Este mes», «Mes pasado»… quedan como opciones de la hoja, con el mes
 * al lado en apagado.
 */
export function SelectorDePeriodo({
  clave,
  disponible,
  inicio,
}: {
  clave: ClavePeriodo;
  disponible: boolean;
  /** `period.start` del dueño, sólo si confirmó `clave`; si no, `null`. */
  inicio: string | null;
}) {
  const { t, idioma } = useIdioma();
  const [abierto, setAbierto] = useState(false);
  const boton = useRef<HTMLButtonElement | null>(null);
  const ahora = new Date();
  if (!disponible) {
    return <div className="stat-burbuja-periodo">{nombreDelPeriodo('this_month', null, idioma, ahora)}</div>;
  }
  const rotulo = nombreDelPeriodo(clave, inicio, idioma, ahora) ?? etiquetaDePeriodo(clave, t);
  const meses = mesesDeMexico(ahora, idioma);
  const cerrar = () => {
    setAbierto(false);
    // El foco vuelve al botón del período (un clic en Safari no lo enfoca).
    requestAnimationFrame(() => boton.current?.focus());
  };
  return (
    <>
      <button
        ref={boton}
        type="button"
        className="stat-burbuja-periodo stat-periodo-boton"
        aria-haspopup="dialog"
        aria-expanded={abierto}
        aria-label={t('Período: {0}. Cambiar', rotulo)}
        onClick={() => setAbierto(true)}
      >
        {rotulo}
        <Icon name="chevron-down" size={18} className="rest-chev" />
      </button>
      {abierto && (
        <HojaPeriodo
          clave={clave}
          meses={meses}
          alElegir={(p) => { elegirPeriodo(p); cerrar(); }}
          alCerrar={cerrar}
        />
      )}
    </>
  );
}

/**
 * La hoja del período, aparte para que `useHojaModal` (D202) viva lo que vive la
 * hoja: el foco entra en el período elegido, Tab no sale y el fondo queda inerte.
 */
function HojaPeriodo({
  clave,
  meses,
  alElegir,
  alCerrar,
}: {
  clave: ClavePeriodo;
  meses: { actual: string; anterior: string };
  alElegir: (p: ClavePeriodo) => void;
  alCerrar: () => void;
}) {
  const { t } = useIdioma();
  const hoja = useRef<HTMLDivElement | null>(null);
  const elegido = useRef<HTMLButtonElement | null>(null);
  useHojaModal(hoja, elegido, alCerrar);
  return createPortal(
    <div className="sheet-overlay" onClick={alCerrar}>
      <div
        ref={hoja}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t('Elige el período')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-head">
          <span className="sheet-title">{t('Elige el período')}</span>
          <button type="button" className="sheet-close" aria-label={t('Cerrar')} onClick={alCerrar}>
            ✕
          </button>
        </div>
        <div className="stat-periodos" role="radiogroup" aria-label={t('Elige el período')}>
          {PERIODOS.map((p) => (
            <button
              key={p}
              ref={p === clave ? elegido : undefined}
              type="button"
              role="radio"
              aria-checked={p === clave}
              className={`stat-periodo-opcion ${p === clave ? 'on' : ''}`}
              onClick={() => alElegir(p)}
            >
              <span className="stat-periodo-nombre">
                {etiquetaDePeriodo(p, t)}
                {(p === 'this_month' || p === 'last_month') && (
                  <span className="stat-periodo-mes">{p === 'this_month' ? meses.actual : meses.anterior}</span>
                )}
              </span>
              {p === clave && <Icon name="check" size={18} />}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
