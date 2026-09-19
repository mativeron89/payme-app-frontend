import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useIdioma } from '../i18n/idioma';
import { Icon } from '../components/Icon';
import { PERIODOS, elegirPeriodo, type ClavePeriodo } from '../api/periodoEstadisticas';
import { etiquetaDePeriodo } from '../utils/textosDeEstadisticas';

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
 * v2.106.0), no hay flecha ni hoja: sólo «Este mes», que es lo que llegó.
 */
export function SelectorDePeriodo({ clave, disponible }: { clave: ClavePeriodo; disponible: boolean }) {
  const { t } = useIdioma();
  const [abierto, setAbierto] = useState(false);
  if (!disponible) {
    return <div className="stat-burbuja-periodo">{t('Este mes')}</div>;
  }
  return (
    <>
      <button
        type="button"
        className="stat-burbuja-periodo stat-periodo-boton"
        aria-haspopup="dialog"
        aria-expanded={abierto}
        aria-label={t('Período: {0}. Cambiar', etiquetaDePeriodo(clave, t))}
        onClick={() => setAbierto(true)}
      >
        {etiquetaDePeriodo(clave, t)}
        <Icon name="chevron-down" size={18} className="rest-chev" />
      </button>
      {abierto && createPortal(
        <div className="sheet-overlay" onClick={() => setAbierto(false)}>
          <div
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-label={t('Elige el período')}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sheet-head">
              <span className="sheet-title">{t('Elige el período')}</span>
              <button type="button" className="sheet-close" aria-label={t('Cerrar')} onClick={() => setAbierto(false)}>
                ✕
              </button>
            </div>
            <div className="stat-periodos" role="radiogroup" aria-label={t('Elige el período')}>
              {PERIODOS.map((p) => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={p === clave}
                  className={`stat-periodo-opcion ${p === clave ? 'on' : ''}`}
                  onClick={() => { elegirPeriodo(p); setAbierto(false); }}
                >
                  {etiquetaDePeriodo(p, t)}
                  {p === clave && <Icon name="check" size={18} />}
                </button>
              ))}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
