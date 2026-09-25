import { useCallback, useEffect, useRef, useState } from 'react';
import { useIdioma } from '../i18n/idioma';
import { api } from '../api';
import { extractApiError } from '../api/errors';
import type { StoredSession } from '../api/storage';
import type { LegalAcceptanceResponse } from '../api/types';
import { PATH_PRIVACIDAD, PATH_TERMINOS } from '../public/publicRoute';

/**
 * AF2 · LEGAL-3.0.0 · la puerta para quien ya tiene cuenta (decisiones 40, 44 y
 * 45). Se muestra al entrar mientras falte la aceptación vigente; no se puede
 * cerrar ni saltear: sólo «Continuar» (con las dos casillas) o «Cerrar sesión».
 *
 * Tolerante con el dueño sin vigencia: `required:false` (o un backend que
 * todavía no tiene la ruta) no bloquea nada. El `428` del dueño (AB2) vuelve a
 * consultar por el gancho de la fachada. Los textos son los aprobados en
 * `registro_y_puerta.txt` (decisión 46).
 */
/**
 * AF-PUERTA-JOIN · `consultando` existe para el link de invitación: mientras la
 * consulta está en vuelo, `JoinMesaScreen` no canjea (si canjeara, la persona
 * quedaría unida a la mesa sin haber aceptado). Las demás rutas miran sólo
 * `cerrada` y se comportan como antes.
 */
export type EstadoPuerta =
  | { readonly fase: 'consultando' }
  | { readonly fase: 'abierta' }
  | { readonly fase: 'cerrada'; readonly aceptacion: LegalAcceptanceResponse };

/** La respuesta vale para UNA sesión: la de otra no dice nada de ésta. */
interface EstadoDeSesion {
  readonly estado: EstadoPuerta;
  readonly sesion: StoredSession | null;
}

/**
 * ¿Ya se sabe si esta sesión puede seguir? Se DERIVA en el render y no en un
 * efecto: cuando la sesión aparece (entrar desde el link), el efecto hijo de
 * `JoinMesaScreen` corre ANTES que el de este hook, y con un `abierta` viejo de
 * la sesión nula canjearía sin mirar la puerta.
 */
export function puertaLista(actual: EstadoDeSesion, session: StoredSession | null): boolean {
  return actual.sesion === session && actual.estado.fase !== 'consultando';
}

export function usePuertaLegal(session: StoredSession | null): {
  readonly estado: EstadoPuerta;
  readonly lista: boolean;
  readonly abrir: () => void;
  readonly reconsultar: () => void;
} {
  const [actual, setActual] = useState<EstadoDeSesion>({ estado: { fase: 'abierta' }, sesion: null });
  const [intento, setIntento] = useState(0);
  const vivo = useRef(0);
  const sesionActual = useRef(session);
  sesionActual.current = session;

  useEffect(() => {
    const marca = ++vivo.current;
    if (!session) {
      setActual({ estado: { fase: 'abierta' }, sesion: null });
      return;
    }
    // Con la puerta ya cerrada se queda cerrada mientras se reconsulta: que no
    // se asome la pantalla de atrás por un instante.
    setActual((prev) => (prev.sesion === session && prev.estado.fase === 'cerrada'
      ? prev
      : { estado: { fase: 'consultando' }, sesion: session }));
    api.getLegalAcceptance(session)
      .then((aceptacion) => {
        if (vivo.current !== marca) return;
        setActual({
          estado: aceptacion.required ? { fase: 'cerrada', aceptacion } : { fase: 'abierta' },
          sesion: session,
        });
      })
      // Sin ruta (backend anterior), red caída o contrato roto: no se bloquea a
      // nadie por lo que no se pudo leer; el dueño defiende con el 428 (AB2).
      .catch(() => { if (vivo.current === marca) setActual({ estado: { fase: 'abierta' }, sesion: session }); });
    return () => { vivo.current += 1; };
  }, [session, intento]);

  const reconsultar = useCallback(() => setIntento((n) => n + 1), []);
  useEffect(() => {
    api.onLegalAcceptanceRequired(reconsultar);
    return () => api.onLegalAcceptanceRequired(null);
  }, [reconsultar]);

  const abrir = useCallback(
    () => setActual({ estado: { fase: 'abierta' }, sesion: sesionActual.current }),
    [],
  );
  return { estado: actual.estado, lista: puertaLista(actual, session), abrir, reconsultar };
}

export function PuertaLegalView({
  aceptaMayor,
  aceptaTerminos,
  busy,
  error,
  onAceptaMayor,
  onAceptaTerminos,
  onContinuar,
  onCerrarSesion,
}: {
  readonly aceptaMayor: boolean;
  readonly aceptaTerminos: boolean;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onAceptaMayor: (v: boolean) => void;
  readonly onAceptaTerminos: (v: boolean) => void;
  readonly onContinuar: () => void;
  readonly onCerrarSesion: () => void;
}) {
  const { t } = useIdioma();
  const listo = aceptaMayor && aceptaTerminos;
  return (
    <div className="login-screen">
      <section className="login-card puerta-legal" role="dialog" aria-modal="true" aria-labelledby="puerta-legal-titulo">
        <h1 id="puerta-legal-titulo" className="h2">{t('Actualizamos nuestros documentos')}</h1>
        <p className="body-text">{t('Para seguir usando PayMe, confirma lo siguiente:')}</p>
        <label className="casilla-legal">
          <input type="checkbox" checked={aceptaMayor} disabled={busy} onChange={(e) => onAceptaMayor(e.target.checked)} />
          <span>{t('Declaro que tengo 18 años o más.')}</span>
        </label>
        <label className="casilla-legal">
          <input type="checkbox" checked={aceptaTerminos} disabled={busy} onChange={(e) => onAceptaTerminos(e.target.checked)} />
          <span>
            {t('He leído y acepto los')}{' '}
            <a href={PATH_TERMINOS} target="_blank" rel="noreferrer">{t('Términos de Uso')}</a>.
          </span>
        </label>
        <p className="body-text ingreso-legal">
          {t('Aviso de Privacidad: Consulta cómo PayMe trata tus datos personales en nuestro')}{' '}
          <a href={PATH_PRIVACIDAD} target="_blank" rel="noreferrer">{t('Aviso de Privacidad')}</a>.
        </p>
        <p className="body-text puerta-legal-nota">
          {t('Al continuar, si tienes una foto de perfil, se mostrará a tus amigos y a quien organice una mesa en la que participes, como explica el Aviso de Privacidad.')}
        </p>
        <p className="body-text puerta-legal-nota">
          {t('PayMe es sólo para personas de 18 años o más. Si no cumples con este requisito, no puedes seguir usando la app.')}
        </p>
        {error && <div className="ingreso-error" role="alert">{error}</div>}
        <button type="button" className="ingreso-entrar" onClick={onContinuar} disabled={busy || !listo}>
          {busy ? t('Un segundo…') : t('Continuar')}
        </button>
        <button type="button" className="login-toggle" onClick={onCerrarSesion} disabled={busy}>
          {t('Cerrar sesión')}
        </button>
      </section>
    </div>
  );
}

export function PuertaLegal({
  session,
  aceptacion,
  onAceptada,
  onReconsultar,
  onCerrarSesion,
}: {
  readonly session: StoredSession;
  readonly aceptacion: LegalAcceptanceResponse;
  readonly onAceptada: () => void;
  readonly onReconsultar: () => void;
  readonly onCerrarSesion: () => void;
}) {
  const { t } = useIdioma();
  const [aceptaMayor, setAceptaMayor] = useState(false);
  const [aceptaTerminos, setAceptaTerminos] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const continuar = useCallback(async () => {
    const { aviso, terminos } = aceptacion;
    // El decodificador ya rechaza `required:true` sin pares; esto es el tipo.
    if (!aviso || !terminos || busy) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await api.acceptLegal({
        aviso_version: aviso.version,
        aviso_hash: aviso.hash,
        terminos_version: terminos.version,
        terminos_hash: terminos.hash,
        adult_declaration: true,
      }, session);
      if (!saved.required) onAceptada();
      else onReconsultar();
    } catch (err) {
      const { status, code } = extractApiError(err);
      if (status === 409 && code === 'legal_version_mismatch') {
        // El texto cambió mientras la puerta estaba abierta: se vuelve a leer
        // el par vigente, nunca se acepta a ciegas lo que la persona no vio.
        onReconsultar();
        return;
      }
      setError(t('No pudimos guardar tu confirmación. Prueba de nuevo.'));
    } finally {
      setBusy(false);
    }
  }, [aceptacion, busy, onAceptada, onReconsultar, session, t]);

  return (
    <PuertaLegalView
      aceptaMayor={aceptaMayor}
      aceptaTerminos={aceptaTerminos}
      busy={busy}
      error={error}
      onAceptaMayor={setAceptaMayor}
      onAceptaTerminos={setAceptaTerminos}
      onContinuar={() => { void continuar(); }}
      onCerrarSesion={onCerrarSesion}
    />
  );
}
