import { useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../components/Icon';
import { useHojaModal } from '../components/useHojaModal';
import { useIdioma } from '../i18n/idioma';
import {
  almacenLocal,
  avisoYaVisto,
  entornoActual,
  esIPad,
  marcarAvisoVisto,
  plataformaDeInstalacion,
  suscribir,
  type Plataforma,
} from './agregarAInicio';

/** D176 · dónde se puede ofrecer agregar a inicio en este navegador; se actualiza solo. */
export function usePlataformaDeInstalacion(): Plataforma {
  return useSyncExternalStore(suscribir, () => plataformaDeInstalacion(entornoActual()), () => null);
}

/**
 * D176 · la guía para iPhone/iPad en Safari: una hoja corta con los dos pasos y
 * una flecha hacia Compartir (abajo en el iPhone, arriba a la derecha en el
 * iPad). «Entendido» (el naranja de la acción) y ✕ cierran; Escape y tocar afuera, también. El foco entra
 * en «Entendido».
 */
export function GuiaAgregarAInicio({ onCerrar }: { onCerrar: () => void }) {
  const { t } = useIdioma();
  const hoja = useRef<HTMLDivElement | null>(null);
  const entendido = useRef<HTMLButtonElement | null>(null);
  const alCerrar = useRef(onCerrar);
  alCerrar.current = onCerrar;
  const ipad = esIPad(entornoActual());
  // D202 · H-04: el foco entra en «Entendido», Tab no sale de la hoja y el fondo queda inerte.
  useHojaModal(hoja, entendido, onCerrar);

  return createPortal(
    <div className="sheet-overlay guia-inicio-fondo" onClick={() => alCerrar.current()}>
      {ipad && <span className="guia-inicio-flecha arriba" aria-hidden="true" />}
      <div
        ref={hoja}
        className="sheet guia-inicio"
        role="dialog"
        aria-modal="true"
        aria-labelledby="guia-inicio-titulo"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-head">
          <h2 id="guia-inicio-titulo" className="sheet-title guia-inicio-titulo">{t('Agrega PayMe a tu inicio')}</h2>
          <button type="button" className="sheet-close" aria-label={t('Cerrar')} onClick={() => alCerrar.current()}>✕</button>
        </div>
        <p className="guia-inicio-intro">{t('Abre PayMe desde tu pantalla de inicio, como una app.')}</p>
        <ol className="guia-inicio-pasos">
          <li>
            <span className="guia-inicio-numero" aria-hidden="true">1</span>
            <span>{t('Toca Compartir')}</span>
            <span className="guia-inicio-icono" aria-hidden="true"><Icon name="share" size={20} /></span>
          </li>
          <li>
            <span className="guia-inicio-numero" aria-hidden="true">2</span>
            <span>{t('Elige «Agregar a inicio»')}</span>
          </li>
        </ol>
        <button ref={entendido} type="button" className="btn btn-primary guia-inicio-entendido" onClick={() => alCerrar.current()}>
          {t('Entendido')}
        </button>
        {!ipad && <span className="guia-inicio-flecha abajo" aria-hidden="true" />}
      </div>
    </div>,
    document.body,
  );
}

/**
 * D176 · el aviso de primera vez: sólo iPhone/iPad en Safari y sin la app
 * agregada. Se monta en Inicio, que sólo existe con la sesión iniciada: es donde
 * se llega después del login (lo fija `e2e/agregar-a-inicio.spec.ts`, «sin
 * sesión no hay guía»). Al cerrarlo no vuelve en este navegador.
 */
export function AvisoAgregarAInicio() {
  const plataforma = usePlataformaDeInstalacion();
  const [abierto, setAbierto] = useState(() => !avisoYaVisto(almacenLocal()));
  if (plataforma !== 'ios_safari' || !abierto) return null;
  return (
    <GuiaAgregarAInicio
      onCerrar={() => {
        marcarAvisoVisto(almacenLocal());
        setAbierto(false);
      }}
    />
  );
}
