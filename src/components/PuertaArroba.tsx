import { useCallback, useEffect, useRef, useState } from 'react';
import { useIdioma } from '../i18n/idioma';
import { api } from '../api';
import { extractApiError } from '../api/errors';
import type { StoredSession } from '../api/storage';
import {
  normalizarUsername,
  problemaDeFormato,
  recargarUsernameCapability,
  useUsernameCapability,
  type ProblemaDeFormato,
} from '../api/username';

/**
 * AF-USUARIO-ARROBA · decisión 93 («Obligatorio para todos») · la pantalla
 * «Elige tu @usuario». Misma mecánica que la puerta legal (`PuertaLegal.tsx`) y
 * DESPUÉS de ella (wire §3): puerta legal → pantalla del @ → app. No se puede
 * cerrar ni saltear: sólo «Continuar» con un @ válido, o «Cerrar sesión».
 *
 * 🔴 Con `features.username.enabled` apagado —hoy— el hook no pide nada y la
 * puerta está siempre abierta: la app queda exactamente igual.
 */
export type EstadoPuertaArroba =
  | { readonly fase: 'consultando' }
  | { readonly fase: 'abierta' }
  | { readonly fase: 'cerrada' };

const ABIERTA: EstadoPuertaArroba = { fase: 'abierta' };
const CONSULTANDO: EstadoPuertaArroba = { fase: 'consultando' };

interface EstadoDeSesion {
  readonly estado: EstadoPuertaArroba;
  readonly sesion: StoredSession | null;
}

/**
 * @param legalAbierta la puerta legal de ESTA sesión ya volvió abierta. Sin
 *   eso no se consulta: `GET /api/account/username` no está exceptuado de la
 *   puerta legal, y el orden del wire es legal primero.
 */
export function usePuertaArroba(session: StoredSession | null, legalAbierta: boolean): {
  readonly estado: EstadoPuertaArroba;
  readonly lista: boolean;
  readonly abrir: () => void;
  readonly reconsultar: () => void;
} {
  const { enabled } = useUsernameCapability();
  const [actual, setActual] = useState<EstadoDeSesion>({ estado: { fase: 'abierta' }, sesion: null });
  const [intento, setIntento] = useState(0);
  const vivo = useRef(0);
  const sesionActual = useRef(session);
  sesionActual.current = session;

  useEffect(() => {
    const marca = ++vivo.current;
    // Apagado (o sin sesión) no hay nada que consultar ni que guardar: el
    // estado se deriva abajo, sin un solo `setState`.
    if (!session || !enabled) return;
    if (!legalAbierta) {
      setActual({ estado: { fase: 'consultando' }, sesion: session });
      return;
    }
    setActual((prev) => (prev.sesion === session && prev.estado.fase === 'cerrada'
      ? prev
      : { estado: { fase: 'consultando' }, sesion: session }));
    api.getUsername(session)
      .then((estado) => {
        if (vivo.current !== marca) return;
        setActual({ estado: { fase: estado.required ? 'cerrada' : 'abierta' }, sesion: session });
      })
      // Red caída o contrato roto: no se bloquea a nadie por lo que no se pudo
      // leer; el dueño defiende con el 428, que vuelve a consultar.
      .catch(() => { if (vivo.current === marca) setActual({ estado: { fase: 'abierta' }, sesion: session }); });
    return () => { vivo.current += 1; };
  }, [session, enabled, legalAbierta, intento]);

  /**
   * Tras un 428 `username_required` (por el gancho de la fachada o desde el
   * canje del link): la config pudo leerse antes de encender la bandera, así
   * que se relee y recién después se vuelve a consultar.
   */
  const reconsultar = useCallback(() => {
    void recargarUsernameCapability().then(() => setIntento((n) => n + 1));
  }, []);
  useEffect(() => {
    api.onUsernameRequired(reconsultar);
    return () => api.onUsernameRequired(null);
  }, [reconsultar]);

  const abrir = useCallback(
    () => setActual({ estado: { fase: 'abierta' }, sesion: sesionActual.current }),
    [],
  );
  const activa = enabled && session !== null;
  const deEstaSesion = actual.sesion === session;
  const estado: EstadoPuertaArroba = !activa
    ? ABIERTA
    : deEstaSesion ? actual.estado : CONSULTANDO;
  const lista = !activa || (deEstaSesion && actual.estado.fase !== 'consultando');
  return { estado, lista, abrir, reconsultar };
}

/** Qué decir mientras se escribe. `null` = nada que corregir. */
export function mensajeDeFormato(
  problema: ProblemaDeFormato,
  t: (s: string, ...a: unknown[]) => string,
): string | null {
  switch (problema) {
    case 'caracteres': return t('Sólo minúsculas, números, punto y guion bajo.');
    case 'corto': return t('Mínimo 3 caracteres.');
    case 'largo': return t('Máximo 20 caracteres.');
    case 'punto_en_borde': return t('No puede empezar ni terminar con punto.');
    case 'vacio':
    case 'ok':
      return null;
  }
}

/**
 * El campo del @, compartido por la puerta y por Configuración: la `@` fija
 * adelante, y el formato se valida mientras se escribe (wire §2). Lo que manda
 * es lo normalizado, que es lo que va a guardar el dueño.
 */
export function CampoArroba({
  id,
  valor,
  disabled,
  onCambio,
  etiqueta,
}: {
  readonly id: string;
  readonly valor: string;
  readonly disabled: boolean;
  readonly onCambio: (v: string) => void;
  readonly etiqueta: string;
}) {
  const { t } = useIdioma();
  const problema = problemaDeFormato(normalizarUsername(valor));
  const mensaje = mensajeDeFormato(problema, t);
  return (
    <div className="arroba-campo">
      <label className="arroba-etiqueta" htmlFor={id}>{etiqueta}</label>
      <div className={`arroba-input${mensaje ? ' arroba-input--error' : ''}`}>
        <span className="arroba-prefijo" aria-hidden="true">@</span>
        <input
          id={id}
          className="arroba-texto"
          value={valor}
          disabled={disabled}
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          inputMode="text"
          maxLength={40}
          aria-invalid={mensaje ? true : undefined}
          aria-describedby={`${id}-ayuda`}
          onChange={(e) => onCambio(e.target.value)}
        />
      </div>
      <div id={`${id}-ayuda`} className={mensaje ? 'arroba-error' : 'arroba-ayuda'} aria-live="polite">
        {mensaje ?? t('De 3 a 20 caracteres: minúsculas, números, punto y guion bajo.')}
      </div>
    </div>
  );
}

/** El error del dueño al guardar, dicho para la persona. */
export function mensajeAlGuardar(err: unknown, t: (s: string, ...a: unknown[]) => string): string {
  const { status, code } = extractApiError(err);
  if (status === 409 && code === 'username_not_available') return t('Ese @ no está disponible.');
  if (status === 400 && code === 'username_invalid') {
    return t('Ese @ no es válido. Usa de 3 a 20 caracteres: minúsculas, números, punto y guion bajo.');
  }
  return t('No pudimos guardar tu @. Prueba de nuevo.');
}

export function PuertaArrobaView({
  valor,
  busy,
  error,
  onCambio,
  onContinuar,
  onCerrarSesion,
}: {
  readonly valor: string;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onCambio: (v: string) => void;
  readonly onContinuar: () => void;
  readonly onCerrarSesion: () => void;
}) {
  const { t } = useIdioma();
  const valido = problemaDeFormato(normalizarUsername(valor)) === 'ok';
  return (
    <div className="login-screen">
      <section className="login-card puerta-arroba" role="dialog" aria-modal="true" aria-labelledby="puerta-arroba-titulo">
        <h1 id="puerta-arroba-titulo" className="h2">{t('Elige tu @usuario')}</h1>
        <p className="body-text">
          {t('Es cómo te van a encontrar tus amigos en PayMe, sin usar tu correo.')}
        </p>
        <form
          onSubmit={(e) => { e.preventDefault(); if (valido && !busy) onContinuar(); }}
        >
          <CampoArroba
            id="puerta-arroba-campo"
            etiqueta={t('Tu @usuario')}
            valor={valor}
            disabled={busy}
            onCambio={onCambio}
          />
          <p className="body-text puerta-legal-nota">{t('Puedes cambiarlo una vez cada 30 días.')}</p>
          {error && <div className="ingreso-error" role="alert">{error}</div>}
          <button type="submit" className="ingreso-entrar" disabled={busy || !valido}>
            {busy ? t('Un segundo…') : t('Continuar')}
          </button>
        </form>
        <button type="button" className="login-toggle" onClick={onCerrarSesion} disabled={busy}>
          {t('Cerrar sesión')}
        </button>
      </section>
    </div>
  );
}

export function PuertaArroba({
  session,
  onElegido,
  onCerrarSesion,
}: {
  readonly session: StoredSession;
  readonly onElegido: () => void;
  readonly onCerrarSesion: () => void;
}) {
  const { t } = useIdioma();
  const [valor, setValor] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tocado = useRef(false);

  // El @ sugerido del dueño (wire §4). Si no llega, el campo queda vacío para
  // que la persona escriba; si ya escribió, la sugerencia no la pisa.
  useEffect(() => {
    let vivo = true;
    api.getUsernameSuggestion(session)
      .then((sugerido) => { if (vivo && sugerido && !tocado.current) setValor(sugerido); })
      .catch(() => undefined);
    return () => { vivo = false; };
  }, [session]);

  const continuar = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const estado = await api.putUsername(normalizarUsername(valor), session);
      if (!estado.required) onElegido();
    } catch (err) {
      setError(mensajeAlGuardar(err, t));
    } finally {
      setBusy(false);
    }
  }, [busy, onElegido, session, t, valor]);

  return (
    <PuertaArrobaView
      valor={valor}
      busy={busy}
      error={error}
      onCambio={(v) => { tocado.current = true; setError(null); setValor(v); }}
      onContinuar={() => { void continuar(); }}
      onCerrarSesion={onCerrarSesion}
    />
  );
}
