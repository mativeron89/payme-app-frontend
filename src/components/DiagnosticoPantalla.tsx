import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useIdioma } from '../i18n/idioma';
import { medirPantalla, textoDelDiagnostico, type FilaDiagnostico } from '../utils/medirPantalla';
import { useToast } from './ui';
import { useHojaModal } from './useHojaModal';

/**
 * E173-2 · el diagnóstico de pantalla, oculto: se abre con 5 toques en el logo
 * de PayMe (`AppHeader`). Muestra cómo WebKit dispone la app —viewport, insets,
 * alto de `.app` y de la barra, modo de pantalla— para que Mati pase números
 * reales desde su iPhone.
 *
 * Sólo lectura: no hace pedidos de red, no guarda nada y no muestra la sesión
 * ni datos personales. Vuelve a medir solo cuando el viewport cambia (al
 * hacer scroll, rotar o mostrarse una barra), y con «Volver a medir».
 */
export function DiagnosticoPantalla({ onCerrar }: { onCerrar: () => void }) {
  const { t } = useIdioma();
  const toast = useToast();
  const [filas, setFilas] = useState<FilaDiagnostico[]>(() => medirPantalla());
  const hoja = useRef<HTMLDivElement | null>(null);
  const cerrar = useRef<HTMLButtonElement | null>(null);
  const alCerrar = useRef(onCerrar);
  alCerrar.current = onCerrar;
  // D202 · H-04: el foco entra en «Cerrar», Tab no sale de la hoja y el fondo queda inerte.
  useHojaModal(hoja, cerrar, onCerrar);

  useEffect(() => {
    const medir = () => setFilas(medirPantalla());
    window.addEventListener('resize', medir);
    window.addEventListener('scroll', medir, true);
    window.visualViewport?.addEventListener('resize', medir);
    window.visualViewport?.addEventListener('scroll', medir);
    return () => {
      window.removeEventListener('resize', medir);
      window.removeEventListener('scroll', medir, true);
      window.visualViewport?.removeEventListener('resize', medir);
      window.visualViewport?.removeEventListener('scroll', medir);
    };
  }, []);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(textoDelDiagnostico(filas));
      toast(t('Copiado'));
    } catch {
      toast(t('No se pudo copiar. Haz una captura de pantalla.'));
    }
  }

  return createPortal(
    <div className="sheet-overlay" onClick={() => alCerrar.current()}>
      <div
        ref={hoja}
        className="sheet diag-pantalla"
        role="dialog"
        aria-modal="true"
        aria-label={t('Diagnóstico de pantalla')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-head">
          <span className="sheet-title">{t('Diagnóstico de pantalla')}</span>
          <button ref={cerrar} type="button" className="sheet-close" aria-label={t('Cerrar')} onClick={() => alCerrar.current()}>✕</button>
        </div>
        <p className="diag-nota">{t('Sólo lectura: estos números no salen del teléfono.')}</p>
        <dl className="diag-lista">
          {filas.map(([clave, valor]) => (
            <div key={clave} className="diag-fila">
              <dt>{clave}</dt>
              <dd>{valor}</dd>
            </div>
          ))}
        </dl>
        <div className="cerrar-mesa-acciones">
          <button type="button" className="btn btn-ghost" onClick={() => setFilas(medirPantalla())}>
            {t('Volver a medir')}
          </button>
          <button type="button" className="btn btn-navy" onClick={() => { void copiar(); }}>
            {t('Copiar')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
