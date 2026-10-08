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
  tieneGuia,
  type Plataforma,
  type PlataformaConGuia,
} from './agregarAInicio';
import { textosDeLaGuia } from './textosDeLaGuia';

/** D176 · dónde se puede ofrecer agregar a inicio en este navegador; se actualiza solo. */
export function usePlataformaDeInstalacion(): Plataforma {
  return useSyncExternalStore(suscribir, () => plataformaDeInstalacion(entornoActual()), () => null);
}

/**
 * D176 · la guía para iPhone/iPad en Safari: una hoja corta con los dos pasos y
 * una flecha hacia Compartir (abajo en el iPhone, arriba a la derecha en el
 * iPad). «Entendido» (el naranja de la acción) y ✕ cierran; Escape y tocar afuera, también. El foco entra
 * en «Entendido».
 *
 * D229 · la misma hoja para Samsung Internet, con sus cuatro pasos y una nota,
 * y SIN flecha: en Samsung la barra se puede mover, así que una flecha fija
 * podría señalar a la nada. Los textos viven en `textosDeLaGuia.ts`.
 */
export function GuiaAgregarAInicio({ plataforma, onCerrar }: { plataforma: PlataformaConGuia; onCerrar: () => void }) {
  const { t } = useIdioma();
  const { pasos, nota } = textosDeLaGuia(plataforma, t);
  const hoja = useRef<HTMLDivElement | null>(null);
  const entendido = useRef<HTMLButtonElement | null>(null);
  const alCerrar = useRef(onCerrar);
  alCerrar.current = onCerrar;
  const ios = plataforma === 'ios_safari';
  const ipad = ios && esIPad(entornoActual());
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
          {pasos.map((paso, i) => (
            <li key={i}>
              <span className="guia-inicio-numero" aria-hidden="true">{i + 1}</span>
              <span>{paso.texto}</span>
              {paso.icono && (
                <span className="guia-inicio-icono" aria-hidden="true"><Icon name={paso.icono} size={20} /></span>
              )}
            </li>
          ))}
        </ol>
        {nota && <p className="guia-inicio-nota">{nota}</p>}
        <button ref={entendido} type="button" className="btn btn-primary guia-inicio-entendido" onClick={() => alCerrar.current()}>
          {t('Entendido')}
        </button>
        {ios && !ipad && <span className="guia-inicio-flecha abajo" aria-hidden="true" />}
      </div>
    </div>,
    document.body,
  );
}

/**
 * D176 · el aviso de primera vez: sólo donde hay guía (iPhone/iPad en Safari y,
 * por D229, Samsung Internet sin el evento) y sin la app agregada. Se monta en
 * Inicio, que sólo existe con la sesión iniciada: es donde se llega después del
 * login (lo fija `e2e/agregar-a-inicio.spec.ts`, «sin sesión no hay guía»). Al
 * cerrarlo no vuelve en este navegador.
 *
 * La guía que se abrió queda fija hasta que la cierren: si Samsung dispara el
 * evento con la hoja abierta, la plataforma pasa a `android_prompt`, pero la
 * hoja no desaparece de golpe debajo del dedo.
 */
export function AvisoAgregarAInicio() {
  const plataforma = usePlataformaDeInstalacion();
  const [abierto, setAbierto] = useState(() => !avisoYaVisto(almacenLocal()));
  const [fijada, setFijada] = useState<PlataformaConGuia | null>(null);
  const actual = tieneGuia(plataforma) ? plataforma : null;
  if (abierto && fijada === null && actual !== null) setFijada(actual);
  const guia = fijada ?? actual;
  if (guia === null || !abierto || plataforma === null) return null;
  return (
    <GuiaAgregarAInicio
      plataforma={guia}
      onCerrar={() => {
        marcarAvisoVisto(almacenLocal());
        setAbierto(false);
      }}
    />
  );
}
