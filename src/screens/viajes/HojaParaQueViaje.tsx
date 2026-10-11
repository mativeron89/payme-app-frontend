import { useEffect, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import type { ViajeConFechas } from '../../api/viajesDeHoy';
import { abrirCamaraNativa } from '../../camara/camaraNativa';
import { useHojaModal } from '../../components/useHojaModal';
import { useIdioma } from '../../i18n/idioma';
import { EVENTO_RUTA, navigate } from '../../router';
import { cerrarHojaParaQueViaje, hojaParaQueViajeAbierta, suscribirHojaParaQueViaje } from './hojaParaQueViajeEstado';
import { useViajesDeHoy } from './useViajesDeHoy';
import './viajes.css';

/**
 * D276-1 · si dos viajes abiertos cubren hoy, la cámara de Nueva pregunta a cuál: una hoja simple con sus nombres.
 * Mati no lo decidió (caso raro): queda declarado en el plan. Elegir uno abre la cámara EN ESE TOQUE (iOS sólo la abre
 * dentro del gesto) y el escaneo de ese viaje, como el círculo de adentro del viaje (D250).
 *
 * La barra sólo la ABRE (`abrirHojaParaQueViaje`); la hoja vive una vez en `App` (`HojaParaQueViajeEnLaApp`). Así no
 * entra en el árbol de ninguna pantalla: en la de pago la barra trae su propio centro y esta hoja no se puede abrir, y
 * el censo P36 sigue diciendo la verdad sin enumerar una superficie que ahí no existe.
 */

/**
 * La hoja, montada una vez en `App`. Se muestra mientras está abierta y hay dos viajes o más que cubren hoy; si eso
 * deja de ser cierto (otra cuenta, se cerró un viaje), se cierra sola, para no reaparecer después sin que nadie la
 * pida. Cambiar de pantalla (Atrás incluido) también la cierra.
 */
export function HojaParaQueViajeEnLaApp() {
  const estaAbierta = useSyncExternalStore(suscribirHojaParaQueViaje, hojaParaQueViajeAbierta, hojaParaQueViajeAbierta);
  const deHoy = useViajesDeHoy({ precargar: false });
  const visible = estaAbierta && deHoy.length > 1;
  useEffect(() => {
    if (estaAbierta && deHoy.length < 2) cerrarHojaParaQueViaje();
  }, [estaAbierta, deHoy.length]);
  useEffect(() => {
    window.addEventListener('popstate', cerrarHojaParaQueViaje);
    window.addEventListener('hashchange', cerrarHojaParaQueViaje);
    window.addEventListener(EVENTO_RUTA, cerrarHojaParaQueViaje);
    return () => {
      window.removeEventListener('popstate', cerrarHojaParaQueViaje);
      window.removeEventListener('hashchange', cerrarHojaParaQueViaje);
      window.removeEventListener(EVENTO_RUTA, cerrarHojaParaQueViaje);
    };
  }, []);
  if (!visible) return null;
  return (
    <HojaParaQueViaje
      viajes={deHoy}
      alCerrar={() => {
        cerrarHojaParaQueViaje();
        // El foco vuelve a quien la abrió, en el cuadro siguiente (como «Borrar todas», D202).
        requestAnimationFrame(() => document.querySelector<HTMLElement>('.appbar-center')?.focus());
      }}
      alElegir={cerrarHojaParaQueViaje}
    />
  );
}

export function HojaParaQueViaje({ viajes, alCerrar, alElegir }: {
  viajes: readonly ViajeConFechas[];
  alCerrar: () => void;
  alElegir: () => void;
}) {
  const { t } = useIdioma();
  const hoja = useRef<HTMLDivElement | null>(null);
  const primero = useRef<HTMLButtonElement | null>(null);
  useHojaModal(hoja, primero, alCerrar);
  return createPortal(
    <div className="sheet-overlay" onClick={alCerrar}>
      <div
        ref={hoja}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t('¿Para qué viaje?')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-head">
          <span className="sheet-title">{t('¿Para qué viaje?')}</span>
          <button type="button" className="sheet-close" aria-label={t('Cerrar')} onClick={alCerrar}>
            ✕
          </button>
        </div>
        <div className="vj-hoja-viajes">
          {viajes.map((v, i) => (
            <button
              key={v.id}
              ref={i === 0 ? primero : undefined}
              type="button"
              className="vj-hoja-viaje"
              onClick={() => {
                abrirCamaraNativa();
                alElegir();
                navigate('scan', v.id);
              }}
            >
              {v.nombre}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
