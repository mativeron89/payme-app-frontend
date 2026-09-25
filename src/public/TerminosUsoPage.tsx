import { useCallback, useEffect, useState } from 'react';
import { leerTextoLegal } from '../api/publicLegal';
import type { EstadoAviso } from './PrivacyNoticePage';

/**
 * `/terminos` · los Términos de uso vigentes, tal cual los publica su dueño
 * (`GET /api/legal/terminos_uso`, LEGAL-3.0.0 · AF2). Mismas reglas que
 * `/privacy`: sin copia de respaldo, un intento, reintento sólo a pedido, el
 * cuerpo nunca se inyecta como HTML y no se toca sesión ni `localStorage`.
 * Mientras el dueño no sirva el documento (paquete apagado → 404) la página
 * dice «no verificable», que es la verdad.
 */
const soloFecha = (iso: string): string => iso.slice(0, 10);

export function TerminosUsoView(
  { estado, onReintentar }: {
    readonly estado: EstadoAviso;
    readonly onReintentar: () => void;
  },
): JSX.Element {
  return (
    <section className="pub-doc" aria-labelledby="pub-titulo">
      <h1 id="pub-titulo" className="pub-h1">Términos de uso</h1>
      <div className="pub-estado" aria-live="polite">
        {estado.fase === 'cargando' && (
          <p className="pub-nota">Cargando los Términos vigentes…</p>
        )}
        {estado.fase === 'no-verificable' && (
          <div className="pub-aviso pub-aviso-alerta">
            <p className="pub-nota">
              No pudimos leer los Términos vigentes en este momento. No mostramos
              una copia guardada para no publicar un texto que puede estar vencido.
            </p>
            <button type="button" className="pub-boton" onClick={onReintentar}>
              Reintentar
            </button>
          </div>
        )}
      </div>
      {estado.fase === 'ok' && (
        <>
          <p className="pub-meta">
            Versión {estado.aviso.version} · vigente desde{' '}
            {soloFecha(estado.aviso.effective_from)}
          </p>
          <div className="pub-cuerpo">{estado.aviso.body}</div>
        </>
      )}
    </section>
  );
}

export function TerminosUsoPage(): JSX.Element {
  const [estado, setEstado] = useState<EstadoAviso>({ fase: 'cargando' });
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    let vivo = true;
    setEstado({ fase: 'cargando' });
    void leerTextoLegal('terminos_uso').then((r) => {
      if (!vivo) return;
      setEstado(r.estado === 'ok' ? { fase: 'ok', aviso: r.aviso } : { fase: 'no-verificable' });
    });
    return () => { vivo = false; };
  }, [intento]);

  const reintentar = useCallback(() => setIntento((n) => n + 1), []);

  return <TerminosUsoView estado={estado} onReintentar={reintentar} />;
}
