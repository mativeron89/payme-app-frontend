import type { CSSProperties } from 'react';
import { useIdioma } from '../../i18n/idioma';

/**
 * AF-VIAJES · lo que un aviso de viaje agrega DEBAJO de su fila (1f y 1t), sin
 * estado ni red: la pantalla de Avisos decide cuándo y con qué callbacks.
 *
 * Va como hermano de `.aviso-row-top` y no adentro: la fila principal puede
 * ser un `<button>`, y un botón no va dentro de otro. Se alinea con el texto
 * (el ícono mide 40 px y el hueco es `--sp-3`).
 *
 * Los botones son los de las solicitudes de amistad (`btn btn-sm`): «Rechazar»
 * gris y «Aceptar» navy, mitad y mitad. Cada uno nombra su fila con
 * `aria-describedby`: en una lista, un «Aceptar» solo no dice qué acepta.
 */

const BLOQUE: CSSProperties = {
  marginTop: 'var(--sp-2)',
  padding: '0 var(--sp-3) 0 calc(40px + var(--sp-3))',
};

const FILA_DE_BOTONES: CSSProperties = {
  display: 'flex',
  gap: 'var(--sp-2)',
  marginTop: 'var(--sp-2)',
};

const BOTON: CSSProperties = { minHeight: 'var(--tap-min)' };

export function ResponderInvitacionAViaje({
  tituloId,
  ocupada,
  onAceptar,
  onRechazar,
}: {
  readonly tituloId: string;
  readonly ocupada: boolean;
  readonly onAceptar: () => void;
  readonly onRechazar: () => void;
}) {
  const { t } = useIdioma();
  return (
    <div className="aviso-viaje-responder" style={BLOQUE}>
      <p className="aviso-time" style={{ margin: 0 }}>
        {t('Al aceptar, ves los tickets del viaje y eliges lo que consumiste.')}
      </p>
      <div style={FILA_DE_BOTONES}>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          style={BOTON}
          aria-describedby={tituloId}
          disabled={ocupada}
          onClick={onRechazar}
        >
          {t('Rechazar')}
        </button>
        <button
          type="button"
          className="btn btn-navy btn-sm"
          style={BOTON}
          aria-describedby={tituloId}
          disabled={ocupada}
          onClick={onAceptar}
        >
          {t('Aceptar')}
        </button>
      </div>
    </div>
  );
}

/** 1t · «marcó que te pagó» trae acción directa: «Revisar» lleva al viaje, igual que tocar la fila. */
export function RevisarPagoDeViaje({
  tituloId,
  deshabilitado,
  onRevisar,
}: {
  readonly tituloId: string;
  readonly deshabilitado: boolean;
  readonly onRevisar: () => void;
}) {
  const { t } = useIdioma();
  return (
    <div className="aviso-viaje-revisar" style={BLOQUE}>
      <button
        type="button"
        className="btn btn-teal btn-sm btn-fit"
        style={BOTON}
        aria-describedby={tituloId}
        disabled={deshabilitado}
        onClick={onRevisar}
      >
        {t('Revisar')}
      </button>
    </div>
  );
}
