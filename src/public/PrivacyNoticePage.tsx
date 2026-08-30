import { useCallback, useEffect, useState } from 'react';
import { leerAvisoPrivacidad, type LecturaAviso } from '../api/publicLegal';

/**
 * `/privacy` · el aviso de privacidad vigente, tal cual lo publica su dueño.
 *
 * ## El texto no se escribe acá, y por eso el estado de falla es honesto
 *
 * El aviso sale de `GET /api/legal/aviso_privacidad`. No hay copia de respaldo
 * en este repo ni fallback «por si el backend no contesta»: una copia se
 * desincroniza y publicaría como vigente un texto que ya no lo es. Cuando no se
 * puede leer, la página **lo dice** y ofrece reintentar. Un aviso legal
 * equivocado es peor que un aviso ausente.
 *
 * ## Se pinta como TEXTO, nunca como HTML
 *
 * El cuerpo va en un nodo de texto con `white-space: pre-wrap`. No hay
 * `dangerouslySetInnerHTML` en ningún camino: el cuerpo es una respuesta de red
 * y esta página se sirve sin sesión a cualquiera que abra el link.
 *
 * ## La vista es pura, y no es un detalle de estilo
 *
 * `PrivacyNoticeView` recibe el estado y no sabe de red. Esta suite no tiene
 * jsdom —ratificación de Mati—, así que la única forma de afirmar sobre los
 * tres estados sin navegador es que exista algo renderizable con el estado
 * puesto a mano. Con la vista adentro del componente que hace fetch, «cargando»
 * sería lo único observable desde vitest.
 */

export type EstadoAviso =
  | { readonly fase: 'cargando' }
  | { readonly fase: 'ok'; readonly aviso: Extract<LecturaAviso, { estado: 'ok' }>['aviso'] }
  | { readonly fase: 'no-verificable' };

/** `2026-08-01T00:00:00Z` → `2026-08-01`. Sin `Intl`: el valor tiene que ser el
 *  mismo en la máquina de quien lo mire y en la corrida que lo verifica. */
const soloFecha = (iso: string): string => iso.slice(0, 10);

export function PrivacyNoticeView(
  { estado, onReintentar }: {
    readonly estado: EstadoAviso;
    readonly onReintentar: () => void;
  },
): JSX.Element {
  return (
    <section className="pub-doc" aria-labelledby="pub-titulo">
      <h1 id="pub-titulo" className="pub-h1">Aviso de privacidad</h1>

      {/*
        🔴 EL `aria-live` CUBRE EL CAMBIO DE ESTADO Y NADA MÁS.

        Acá adentro vivía también el aviso legal completo, y era un defecto de
        accesibilidad real: al llegar la respuesta, un lector de pantalla
        anunciaba de corrido el documento entero. `aria-live` sirve para avisar
        que ALGO PASÓ —«cargando», «no pudimos leerlo»—, no para leer un texto
        largo que la persona va a navegar con sus propios comandos.

        Por eso el cuerpo se renderiza AFUERA de la región viva: sigue estando
        en el mismo orden visual y de lectura, pero su aparición no se anuncia.
      */}
      <div className="pub-estado" aria-live="polite">
        {estado.fase === 'cargando' && (
          <p className="pub-nota">Cargando el aviso vigente…</p>
        )}

        {estado.fase === 'no-verificable' && (
          <div className="pub-aviso pub-aviso-alerta">
            <p className="pub-nota">
              No pudimos leer el aviso vigente en este momento. No mostramos una
              copia guardada para no publicar un texto que puede estar vencido.
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

export function PrivacyNoticePage(): JSX.Element {
  const [estado, setEstado] = useState<EstadoAviso>({ fase: 'cargando' });
  // Sube en cada reintento manual. No hay reintento automático en ningún lado:
  // esta es la única forma de que se vuelva a pedir, y la dispara la persona.
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    let vivo = true;
    setEstado({ fase: 'cargando' });
    void leerAvisoPrivacidad().then((r) => {
      if (!vivo) return;
      setEstado(r.estado === 'ok' ? { fase: 'ok', aviso: r.aviso } : { fase: 'no-verificable' });
    });
    return () => { vivo = false; };
  }, [intento]);

  const reintentar = useCallback(() => setIntento((n) => n + 1), []);

  return <PrivacyNoticeView estado={estado} onReintentar={reintentar} />;
}
