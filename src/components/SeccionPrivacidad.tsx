import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../api';
import { extractApiError } from '../api/errors';
import type { StoredSession } from '../api/storage';
import {
  recordarPermisoDeSugerencias, useCapacidadesOpcionales, type EstadoDeConsentimiento, type FinalidadOpcional,
} from '../api/sugerencias';
import { useIdioma } from '../i18n/idioma';
import { PATH_PRIVACIDAD } from '../public/publicRoute';

/**
 * Configuración › Privacidad.
 *
 * n420 · las dos filas de los permisos opcionales, con los textos que aprobó Mati, literales:
 * - D415 · «Sugerencias para dividir»;
 * - D426 · «Análisis interno de PayMe», debajo de la anterior.
 * Cada una aparece SÓLO si el `/config` anuncia su capacidad encendida (D403/D417). Hoy están apagadas: sin fila y sin
 * ningún pedido. El estado del permiso se lee del servidor al montar la fila; activar no es optimista (el interruptor
 * se enciende recién con el 201) y revocar nunca se bloquea.
 */
export function SeccionPrivacidad({ session, filaFoto = null, fotoVisible = false }: {
  readonly session: StoredSession;
  /** D499 b5 · la fila del permiso de foto, que arma Configuración. */
  readonly filaFoto?: ReactNode;
  readonly fotoVisible?: boolean;
}) {
  const { t } = useIdioma();
  const capacidades = useCapacidadesOpcionales();
  const sugerencias = capacidades.sugerencias?.enabled === true;
  const analisis = capacidades.analisis_interno?.enabled === true;
  if (!fotoVisible && !sugerencias && !analisis) return null;
  return (
    <section className="card config-card privacidad-seccion" aria-labelledby="privacidad-titulo">
      <h2 id="privacidad-titulo" className="privacidad-titulo">{t('Privacidad')}</h2>
      {fotoVisible && filaFoto}
      {sugerencias && <FilaPermisoOpcional finalidad="sugerencias" session={session} />}
      {analisis && <FilaPermisoOpcional finalidad="analisis_interno" session={session} />}
    </section>
  );
}

/** Los estados de la fila de D415 (propuesta 9ffd3bdb…), que D426 reusa. */
export type MensajeDeFila = 'no_elegible' | 'por_ahora' | 'no_se_guardo';

/** El mensaje de un rechazo del dueño (`account-consents-v1`): nunca dice «menor» ni «edad». */
export function mensajeDeRechazo(err: unknown): MensajeDeFila {
  // La capacidad se apagó entre la lectura y el gesto (revalidación local de la fachada).
  if (err instanceof Error && err.message === 'consent_grant_unavailable') return 'por_ahora';
  const { status } = extractApiError(err);
  if (status === 403) return 'no_elegible';
  if (status === 409) return 'por_ahora';
  return 'no_se_guardo';
}

export function FilaPermisoOpcionalView({ finalidad, estado, ocupado, mensaje, onCambiar }: {
  readonly finalidad: FinalidadOpcional;
  readonly estado: EstadoDeConsentimiento | null;
  readonly ocupado: boolean;
  readonly mensaje: MensajeDeFila | null;
  readonly onCambiar: (activar: boolean) => void;
}) {
  const { t } = useIdioma();
  // Los textos aprobados, literales: D415 y D426.
  const titulo = finalidad === 'sugerencias' ? t('Sugerencias para dividir') : t('Análisis interno de PayMe');
  const texto = finalidad === 'sugerencias'
    ? t('PayMe te sugiere cómo dividir según las mesas que abriste. Sólo lo ves tú.')
    : t('Opcional. PayMe analiza, sin tu nombre, cómo se consume en las mesas. No llega a restaurantes ni a otros usuarios. Puedes apagarlo.');
  const aviso = mensaje === 'no_elegible' ? t('Esta opción no está disponible para tu cuenta.')
    : mensaje === 'por_ahora' ? t('Por ahora no está disponible. Prueba de nuevo más tarde.')
      : mensaje === 'no_se_guardo' ? t('No se pudo guardar') : null;
  const id = `privacidad-${finalidad}`;
  return (
    <div className="list-row privacidad-fila" style={{ cursor: 'default' }} aria-busy={ocupado}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div id={`${id}-titulo`} style={{ fontSize: 'var(--fs-legacy-sm)', fontWeight: 600 }}>{titulo}</div>
        <div id={`${id}-texto`} className="caption">{texto}</div>
        <a className="caption privacidad-enlace" href={PATH_PRIVACIDAD} target="_blank" rel="noreferrer">
          {t('Más en el Aviso de Privacidad.')}
        </a>
        {aviso && <div className="caption privacidad-mensaje" role="status">{aviso}</div>}
      </div>
      <input
        type="checkbox"
        role="switch"
        className="notif-switch"
        aria-labelledby={`${id}-titulo`}
        aria-describedby={`${id}-texto`}
        checked={estado?.granted === true}
        disabled={ocupado || estado === null}
        onChange={(e) => onCambiar(e.target.checked)}
      />
    </div>
  );
}

function FilaPermisoOpcional({ finalidad, session }: { readonly finalidad: FinalidadOpcional; readonly session: StoredSession }) {
  const [estado, setEstado] = useState<EstadoDeConsentimiento | null>(null);
  const [ocupado, setOcupado] = useState(true);
  const [mensaje, setMensaje] = useState<MensajeDeFila | null>(null);
  const epoca = useRef(0);
  const sesionRef = useRef(session);
  sesionRef.current = session;
  const cuenta = `${session.family_id}:${session.principal_id}`;

  useEffect(() => {
    const marca = ++epoca.current;
    setEstado(null);
    setOcupado(true);
    setMensaje(null);
    void (async () => {
      try {
        const leido = await api.getConsentimiento(finalidad, sesionRef.current);
        if (marca !== epoca.current) return;
        setEstado(leido);
        if (finalidad === 'sugerencias') recordarPermisoDeSugerencias(leido.granted);
      } catch {
        // Ante la duda, apagado y deshabilitado: nunca «activado».
        if (marca === epoca.current) setMensaje('por_ahora');
      } finally {
        if (marca === epoca.current) setOcupado(false);
      }
    })();
    return () => { epoca.current += 1; };
  }, [finalidad, cuenta]);

  async function cambiar(activar: boolean) {
    if (ocupado || estado === null) return;
    const marca = ++epoca.current;
    setOcupado(true);
    setMensaje(null);
    try {
      const s = sesionRef.current;
      const nuevo = activar
        ? await api.grantConsentimiento(finalidad, (await api.getPrivacyNotice()).legal_text, s)
        : await api.revokeConsentimiento(finalidad, s);
      if (marca !== epoca.current) return;
      setEstado(nuevo);
      if (finalidad === 'sugerencias') recordarPermisoDeSugerencias(nuevo.granted);
    } catch (err) {
      if (marca === epoca.current) setMensaje(mensajeDeRechazo(err));
    } finally {
      if (marca === epoca.current) setOcupado(false);
    }
  }

  return <FilaPermisoOpcionalView finalidad={finalidad} estado={estado} ocupado={ocupado} mensaje={mensaje}
    onCambiar={(activar) => { void cambiar(activar); }} />;
}
