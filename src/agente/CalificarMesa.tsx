import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { CalificacionDeMesa } from '../api/agente';
import type { MesaStatus } from '../api/types';
import { Icon } from '../components/Icon';
import { useIdioma } from '../i18n/idioma';
import { useAgente } from './useAgente';
import './agente.css';

const ESTRELLAS = [1, 2, 3, 4, 5] as const;

/**
 * Una mesa que ya pasó y se puede calificar: cerrada, pagada o en su liquidación. No una que todavía se elige
 * (`open`, `partially_paid`), ni una que nunca existió de verdad (`pending_auth`, `auth_failed`, `cancelled`).
 */
const CALIFICABLES: ReadonlySet<MesaStatus> = new Set<MesaStatus>(['fully_paid', 'expired', 'settling', 'settled', 'dispersing', 'completed']);
export function mesaCalificable(status: MesaStatus): boolean {
  return CALIFICABLES.has(status);
}

type Lectura =
  | { readonly fase: 'leyendo' }
  | { readonly fase: 'oculta' }
  | { readonly fase: 'lista'; readonly calificacion: CalificacionDeMesa | null };

/**
 * D553 (funcionalidad 8) · D554 (R-8 a) · la calificación con un toque al cerrar la mesa: de 1 a 5 estrellas,
 * opcional y editable (una por persona y mesa en el dueño).
 *
 * - Aparece con `CALIFICACIONES_ENABLED` encendida en el dueño y la lectura propia leída; apagada (404), sin ser de
 *   la mesa, o con un error al leer, no se muestra nada: la mesa se ve como siempre.
 * - Tocar una estrella guarda; el dibujo cambia recién con la confirmación del dueño (no es optimista). Un error dice
 *   que no se guardó y deja la de antes.
 * - Es un grupo de opciones (`radiogroup`): cada estrella es un botón con su nombre («3 estrellas»).
 */
export function CalificarMesa({ code }: { readonly code: string }) {
  const { t } = useIdioma();
  const { estado, session } = useAgente();
  const [lectura, setLectura] = useState<Lectura>({ fase: 'leyendo' });
  const [guardando, setGuardando] = useState<number | null>(null);
  const [nota, setNota] = useState<'guardada' | 'no_se_guardo' | null>(null);
  const encendida = estado?.calificaciones === true && session !== null;
  const cuenta = session ? `${session.family_id}:${session.principal_id}` : null;
  const sesionRef = useRef(session);
  sesionRef.current = session;
  const epoca = useRef(0);

  useEffect(() => {
    const marca = ++epoca.current;
    setLectura({ fase: 'leyendo' });
    setGuardando(null);
    setNota(null);
    const s = sesionRef.current;
    if (!encendida || !s) return;
    api.getCalificacionDeMesa(code, s).then(
      (calificacion) => { if (marca === epoca.current) setLectura({ fase: 'lista', calificacion }); },
      () => { if (marca === epoca.current) setLectura({ fase: 'oculta' }); },
    );
  }, [encendida, cuenta, code]);

  if (!encendida || lectura.fase !== 'lista') return null;
  const elegida = lectura.calificacion?.estrellas ?? null;

  async function calificar(estrellas: number) {
    const s = sesionRef.current;
    if (!s || guardando !== null || estrellas === elegida) return;
    const marca = epoca.current;
    setGuardando(estrellas);
    setNota(null);
    try {
      const calificacion = await api.putCalificacionDeMesa(code, estrellas, s);
      if (marca !== epoca.current) return;
      setLectura({ fase: 'lista', calificacion });
      setNota('guardada');
    } catch {
      if (marca === epoca.current) setNota('no_se_guardo');
    } finally {
      if (marca === epoca.current) setGuardando(null);
    }
  }

  return (
    <section className="agente-calificar" aria-labelledby={`agente-calificar-${code}`} aria-busy={guardando !== null}>
      <h2 id={`agente-calificar-${code}`} className="agente-calificar-titulo">{t('¿Cómo estuvo?')}</h2>
      <div className="agente-calificar-estrellas" role="radiogroup" aria-labelledby={`agente-calificar-${code}`}>
        {ESTRELLAS.map((n) => {
          const llena = elegida !== null && n <= elegida;
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={elegida === n}
              aria-label={n === 1 ? t('1 estrella') : t('{0} estrellas', n)}
              className={`agente-estrella${llena ? ' agente-estrella--llena' : ''}`}
              disabled={guardando !== null}
              onClick={() => void calificar(n)}
            >
              <Icon name={llena ? 'star-fill' : 'star'} size={28} />
            </button>
          );
        })}
      </div>
      <p className="agente-calificar-nota" role="status">
        {nota === 'no_se_guardo' ? t('No se pudo guardar. Prueba de nuevo.')
          : nota === 'guardada' ? t('Gracias. Puedes cambiarla cuando quieras.')
            : elegida === null ? t('Opcional. Sólo cuenta para las estrellas de PayMe.') : t('Puedes cambiarla cuando quieras.')}
      </p>
    </section>
  );
}
