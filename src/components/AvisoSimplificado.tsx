import { useEffect, useState } from 'react';
import { leerTextoLegal, type LecturaAviso } from '../api/publicLegal';
import type { LegalTextResponse } from '../api/types';
import { useIdioma } from '../i18n/idioma';
import { PATH_PRIVACIDAD } from '../public/publicRoute';
import { TextoLegal } from './TextoLegal';

/** Acceso al mismo cuerpo público desde toda alta y desde la puerta cerrada. */
export function AvisoSimplificado({ texto }: { readonly texto?: LegalTextResponse['legal_text'] }) {
  const { t, idioma } = useIdioma();
  const [abierto, setAbierto] = useState(false);
  const [intento, setIntento] = useState(0);
  const [lectura, setLectura] = useState<LecturaAviso | null>(null);
  useEffect(() => {
    if (!abierto || texto) return;
    let vivo = true;
    setLectura(null);
    void leerTextoLegal('aviso_privacidad_simplificado').then((r) => { if (vivo) setLectura(r); });
    return () => { vivo = false; };
  }, [abierto, texto, intento]);
  const aviso = texto ?? (lectura?.estado === 'ok' ? lectura.aviso : null);
  return (
    <details className="legal-notice" onToggle={(e) => setAbierto(e.currentTarget.open)}>
      <summary>{t('Aviso de Privacidad Simplificado')}</summary>
      {idioma === 'en' && <p lang="en">This document is only available in Spanish for now.</p>}
      {aviso ? <>
        <pre lang="es"><TextoLegal texto={aviso.body} /></pre>
        <p className="legal-notice-meta" lang="es">Versión {aviso.version} · {aviso.effective_from.slice(0, 10)}</p>
      </> : <div role="status">
        {lectura?.estado === 'no-verificable' ? <>
          <p>{t('No pudimos leer el documento. Prueba de nuevo.')}</p>
          <button type="button" className="btn btn-ghost" onClick={() => setIntento((n) => n + 1)}>{t('Reintentar')}</button>
        </> : t('Cargando…')}
      </div>}
      <a href={PATH_PRIVACIDAD} target="_blank" rel="noreferrer">{t('Aviso de Privacidad Integral')}</a>
    </details>
  );
}
