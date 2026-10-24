import { useEffect, useId, useRef, useState } from 'react';
import { api } from '../api';
import { extractApiError } from '../api/errors';
import { capacidadFoto, verificarAvisoFoto, type PermisoFoto } from '../api/fotoPerfilNoAmigos';
import { currentSamePrincipalSession } from '../api/profileIdentity';
import { isCurrentSession, loadSession, type StoredSession } from '../api/storage';
import type { LegalTextResponse } from '../api/types';
import { useIdioma } from '../i18n/idioma';
import { TextoLegal } from './TextoLegal';

type Aviso = LegalTextResponse['legal_text'];
export interface EstadoPrivacidadFoto {
  readonly permiso: PermisoFoto | null;
  readonly aviso: Aviso | null;
  readonly permiteGrant: boolean;
  readonly ocupado: boolean;
  readonly error: string | null;
}

export function PrivacidadFotoView({ estado, soloRevocar, onCambiar, onConsultar }: {
  readonly estado: EstadoPrivacidadFoto;
  readonly soloRevocar: boolean;
  readonly onCambiar: () => void;
  readonly onConsultar: () => void;
}) {
  const { t, idioma } = useIdioma();
  const id = useId();
  const { permiso, aviso, permiteGrant, ocupado, error } = estado;
  const habilitado = permiso !== null && !ocupado && (permiso.granted || (!soloRevocar && permiteGrant && aviso !== null));
  return <section className="card privacidad-foto" aria-labelledby={`${id}-titulo`} aria-busy={ocupado}>
    <h2 id={`${id}-titulo`} className="h2">{t('Privacidad')}</h2>
    <p id={`${id}-etiqueta`}>{t('Mostrar mi foto a personas que no son mis amigos')}</p>
    <p id={`${id}-ayuda`} className="body-text">
      {t('Permite que otros usuarios vean tu foto en búsquedas, invitaciones y cuando compartas mesas o viajes. Tus amigos podrán seguir viéndola si lo desactivas.')}
    </p>
    {soloRevocar && <p className="body-text">{t('Puedes consultar o desactivar este permiso antes de aceptar los documentos. Para activarlo, primero debes aceptarlos.')}</p>}
    {permiso && <button type="button" role="switch" aria-checked={permiso.granted}
      aria-labelledby={`${id}-etiqueta`} aria-describedby={`${id}-ayuda`} disabled={!habilitado}
      className="btn btn-ghost" onClick={onCambiar}>
      {permiso.granted ? t('Desactivar') : t('Activar')}
    </button>}
    <p role="status">{ocupado ? t('Consultando o guardando el permiso…')
      : permiso ? (permiso.granted ? t('Permiso activado') : t('Permiso desactivado'))
        : t('No pudimos confirmar el estado del permiso.')}</p>
    {!ocupado && permiso && !permiso.granted && !soloRevocar && !habilitado && <p>{t('Este permiso no está disponible para activarlo en este momento.')}</p>}
    {error && <p role="alert">{error === ERROR_LECTURA
      ? t('No pudimos confirmar el estado del permiso. Puedes consultar de nuevo.')
      : error === ERROR_CAMBIO
        ? t('No se confirmó el cambio. Consulta el estado antes de volver a intentarlo.')
        : t('No recibimos la confirmación del cambio. El estado mostrado corresponde a una nueva consulta.')}</p>}
    {aviso && <details className="legal-notice">
      <summary>{t('Aviso de Privacidad Integral')}</summary>
      {idioma === 'en' && <p lang="en">This document is only available in Spanish for now.</p>}
      <pre lang="es"><TextoLegal texto={aviso.body} /></pre>
      <p className="legal-notice-meta" lang="es">Versión {aviso.version} · {aviso.effective_from.slice(0, 10)}</p>
    </details>}
    <button type="button" className="btn btn-ghost" disabled={ocupado} onClick={onConsultar}>{t('Consultar estado')}</button>
  </section>;
}

const INICIAL: EstadoPrivacidadFoto = { permiso: null, aviso: null, permiteGrant: false, ocupado: true, error: null };
const ERROR_LECTURA = 'No pudimos confirmar el estado del permiso. Puedes consultar de nuevo.';
const ERROR_CAMBIO = 'No se confirmó el cambio. Consulta el estado antes de volver a intentarlo.';
const CAMBIO_RECONSULTADO = 'No recibimos la confirmación del cambio. El estado mostrado corresponde a una nueva consulta.';

/** Key por cuenta/familia: ninguna respuesta ni elección de otra sesión se reutiliza. */
export function PrivacidadFotoPanel({ session, soloRevocar = false }: {
  readonly session: StoredSession;
  readonly soloRevocar?: boolean;
}) {
  return <ControlFoto key={`${session.family_id}:${session.principal_id}:${soloRevocar}`} session={session} soloRevocar={soloRevocar} />;
}

function ControlFoto({ session, soloRevocar }: { readonly session: StoredSession; readonly soloRevocar: boolean }) {
  const [estado, setEstado] = useState<EstadoPrivacidadFoto>(INICIAL);
  const [intento, setIntento] = useState(0);
  const [noSoportado, setNoSoportado] = useState(false);
  const epoca = useRef(0);
  const mutando = useRef(false);
  // La rotación de tokens no cambia la cuenta ni remonta el control.
  const sesionRef = useRef(session);
  sesionRef.current = session;
  const sesionVigente = () => {
    const s = currentSamePrincipalSession(sesionRef.current, loadSession());
    return s && isCurrentSession(s) ? s : null;
  };

  useEffect(() => {
    const marca = ++epoca.current;
    const vigente = () => marca === epoca.current && sesionVigente() !== null;
    setEstado(INICIAL);
    setNoSoportado(false);
    const s = sesionVigente();
    if (!s) {
      setEstado({ ...INICIAL, ocupado: false, error: ERROR_LECTURA });
      return;
    }
    void (async () => {
      // Estado/revoke no esperan config ni Aviso. La puerta sólo consulta la ruta exceptuada.
      const config = soloRevocar ? Promise.resolve(null) : api.getConfig().catch(() => null);
      let permiso: PermisoFoto | null = null;
      let falloEstado: unknown = null;
      try { permiso = await api.getFotoPerfilNoAmigos(s); } catch (err) { falloEstado = err; }
      if (!vigente()) return;
      if (permiso && (permiso.granted || soloRevocar)) {
        setEstado({ permiso, aviso: null, permiteGrant: false, ocupado: false, error: null });
        return;
      }
      const capacidad = capacidadFoto(await config);
      if (!vigente()) return;
      if (!capacidad.supported && extractApiError(falloEstado).status === 404) {
        setNoSoportado(true);
        return;
      }
      const permiteGrant = !soloRevocar && capacidad.enabled;
      let aviso: Aviso | null = null;
      if (permiso && !permiso.granted && permiteGrant) {
        try {
          const recibido = (await api.getPrivacyNotice()).legal_text;
          if (await verificarAvisoFoto(recibido)) aviso = recibido;
        } catch { /* No ofrecer grant sin texto verificable. Revocar sigue disponible. */ }
      }
      if (vigente()) setEstado({ permiso, aviso, permiteGrant, ocupado: false, error: permiso ? null : ERROR_LECTURA });
    })();
    return () => { epoca.current += 1; };
  }, [intento, soloRevocar]);

  async function cambiar() {
    const { permiso, aviso, permiteGrant } = estado;
    const s = sesionVigente();
    if (!s || mutando.current || estado.ocupado || !permiso) return;
    if (!permiso.granted && (soloRevocar || !permiteGrant || !aviso)) return;
    mutando.current = true;
    const marca = ++epoca.current;
    const vigente = () => marca === epoca.current && sesionVigente() !== null;
    setEstado((prev) => ({ ...prev, ocupado: true, error: null }));
    try {
      const nuevo = permiso.granted
        ? await api.revokeFotoPerfilNoAmigos(s)
        : await api.grantFotoPerfilNoAmigos(aviso!, s);
      if (vigente()) setEstado((prev) => ({ ...prev, permiso: nuevo, ocupado: false }));
    } catch {
      // Un POST ambiguo no se repite. Una única consulta concilia lo que el servidor confirmó.
      if (!vigente()) return;
      setEstado({ permiso: null, aviso: null, permiteGrant: false, ocupado: true, error: ERROR_CAMBIO });
      let confirmado: PermisoFoto | null = null;
      const actual = sesionVigente();
      if (actual) {
        try { confirmado = await api.getFotoPerfilNoAmigos(actual); } catch { /* Estado desconocido. */ }
      }
      if (vigente()) setEstado({ permiso: confirmado, aviso: null, permiteGrant: false, ocupado: false,
        error: confirmado ? CAMBIO_RECONSULTADO : ERROR_CAMBIO });
    } finally { mutando.current = false; }
  }

  return noSoportado ? null : <PrivacidadFotoView estado={estado} soloRevocar={soloRevocar}
    onCambiar={() => { void cambiar(); }}
    onConsultar={() => { if (!mutando.current) setIntento((n) => n + 1); }} />;
}
