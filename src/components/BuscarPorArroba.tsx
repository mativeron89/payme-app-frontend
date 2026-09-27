import { useEffect, useRef, useState } from 'react';
import { useIdioma } from '../i18n/idioma';
import { api } from '../api';
import { extractApiError } from '../api/errors';
import { AvatarObjectUrlLease } from '../api/profileIdentity';
import { isCurrentSession, type StoredSession } from '../api/storage';
import {
  consultaValida,
  normalizarUsername,
  useUsernameCapability,
  type ResultadoArroba,
} from '../api/username';
import { RequestEpoch } from '../utils/requestEpoch';
import { Avatar } from './ui';

/**
 * AF-USUARIO-ARROBA · decisión 93 (punto 2: «Con sugerencias al escribir»;
 * punto 3: «Nombre, foto y @») · buscar por @ en «Agregar amigo».
 *
 * Guardas del wire §5, del lado de la app:
 * - no consulta hasta tener 3 caracteres del alfabeto del @;
 * - espera a que se deje de escribir (`ESPERA_MS`) antes de consultar;
 * - muestra hasta 5 resultados, en el orden del dueño;
 * - la foto sólo se pide si el resultado dice `has_avatar`, y la regla de n164
 *   la aplica el dueño: toda denegación es el mismo 404 y quedan las iniciales;
 * - el mail nunca aparece: el decodificador rechaza cualquier clave de más.
 *
 * 🔴 Con `features.username` apagado no renderiza nada ni pide nada: la
 * búsqueda por correo o ID de siempre queda como está.
 */
export const ESPERA_MS = 350;

export function BuscarPorArroba({
  session,
  onEnviada,
}: {
  readonly session: StoredSession;
  /** La solicitud salió: la pantalla recarga sus solicitudes. */
  readonly onEnviada: () => void;
}) {
  const { enabled } = useUsernameCapability();
  if (!enabled) return null;
  return <Buscador session={session} onEnviada={onEnviada} />;
}

type Busqueda =
  | { readonly fase: 'quieta' }
  | { readonly fase: 'buscando' }
  | { readonly fase: 'lista'; readonly resultados: ResultadoArroba[] }
  | { readonly fase: 'limite' }
  | { readonly fase: 'error' };

function Buscador({
  session,
  onEnviada,
}: {
  readonly session: StoredSession;
  readonly onEnviada: () => void;
}) {
  const { t } = useIdioma();
  const [texto, setTexto] = useState('');
  const [busqueda, setBusqueda] = useState<Busqueda>({ fase: 'quieta' });
  const [enviando, setEnviando] = useState<string | null>(null);
  const [enviadas, setEnviadas] = useState<ReadonlySet<string>>(new Set());
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);
  const epoca = useRef(new RequestEpoch());

  const q = normalizarUsername(texto);
  const consultable = consultaValida(q);

  useEffect(() => {
    // Cada tecla invalida lo que estaba en vuelo: una respuesta vieja no pisa
    // a una más nueva.
    const mia = epoca.current.next();
    if (!consultable) {
      setBusqueda({ fase: 'quieta' });
      return undefined;
    }
    setBusqueda({ fase: 'buscando' });
    const espera = window.setTimeout(() => {
      if (!isCurrentSession(session)) return;
      api.searchUsernames(q, session)
        .then((resultados) => {
          if (epoca.current.isCurrent(mia)) setBusqueda({ fase: 'lista', resultados });
        })
        .catch((err: unknown) => {
          if (!epoca.current.isCurrent(mia)) return;
          setBusqueda({ fase: extractApiError(err).status === 429 ? 'limite' : 'error' });
        });
    }, ESPERA_MS);
    return () => window.clearTimeout(espera);
  }, [q, consultable, session]);

  async function agregar(username: string) {
    if (enviando) return;
    setEnviando(username);
    setErrorEnvio(null);
    try {
      // Wire §6: el cuerpo es EXACTAMENTE `{ username }`, y la respuesta es la
      // misma ciega de siempre (202), exista o no el @.
      await api.addFriend({ username });
      setEnviadas((prev) => new Set(prev).add(username));
      onEnviada();
    } catch {
      setErrorEnvio(t('No pudimos enviar la solicitud. Prueba de nuevo.'));
    } finally {
      setEnviando(null);
    }
  }

  const corto = q.length > 0 && !consultable;
  return (
    <div className="arroba-buscar">
      <label className="arroba-etiqueta" htmlFor="buscar-arroba">{t('Buscar por @usuario')}</label>
      <div className="arroba-input">
        <span className="arroba-prefijo" aria-hidden="true">@</span>
        <input
          id="buscar-arroba"
          className="arroba-texto"
          type="search"
          value={texto}
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          maxLength={40}
          placeholder={t('usuario')}
          onChange={(e) => { setErrorEnvio(null); setTexto(e.target.value); }}
        />
      </div>
      <div className="arroba-resultados" aria-live="polite">
        {corto && <div className="arroba-ayuda">{t('Escribe al menos 3 letras de su @.')}</div>}
        {busqueda.fase === 'buscando' && <div className="arroba-ayuda">{t('Buscando…')}</div>}
        {busqueda.fase === 'limite' && (
          <div className="arroba-error">{t('Hiciste muchas búsquedas seguidas. Espera un momento.')}</div>
        )}
        {busqueda.fase === 'error' && <div className="arroba-error">{t('No pudimos buscar. Prueba de nuevo.')}</div>}
        {busqueda.fase === 'lista' && busqueda.resultados.length === 0 && (
          <div className="arroba-ayuda">{t('No encontramos a nadie con ese @.')}</div>
        )}
        {busqueda.fase === 'lista' && busqueda.resultados.length > 0 && (
          <ul className="arroba-lista" aria-label={t('Resultados')}>
            {busqueda.resultados.map((r) => {
              const nombre = `${r.first_name} ${r.last_name}`.trim();
              const enviada = enviadas.has(r.username);
              return (
                <li key={r.username} className="friend-row arroba-resultado" data-username={r.username}>
                  <FotoPorArroba resultado={r} nombre={nombre} session={session} />
                  <div className="fr-name">
                    <div className="n">{nombre}</div>
                    <div className="id">@{r.username}</div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm btn-fit"
                    disabled={enviada || enviando !== null}
                    aria-label={enviada ? t('Solicitud enviada a @{0}', r.username) : t('Agregar a @{0}', r.username)}
                    onClick={() => { void agregar(r.username); }}
                  >
                    {enviada ? t('Enviada') : t('Agregar')}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {errorEnvio && <div className="arroba-error" role="alert">{errorEnvio}</div>}
      </div>
    </div>
  );
}

/**
 * La foto de un resultado. Sólo se pide con `has_avatar: true`; cualquier
 * 404 o error deja las iniciales, sin decir por qué (regla de n164).
 */
function FotoPorArroba({
  resultado,
  nombre,
  session,
}: {
  readonly resultado: ResultadoArroba;
  readonly nombre: string;
  readonly session: StoredSession;
}) {
  const lease = useRef<AvatarObjectUrlLease | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  if (!lease.current) lease.current = new AvatarObjectUrlLease();

  useEffect(() => {
    const actual = lease.current!;
    actual.clear();
    setUrl(null);
    if (!resultado.has_avatar || !isCurrentSession(session)) return undefined;
    let vivo = true;
    void api.getUsernameAvatar(resultado.username, session)
      .then(({ blob }) => { if (vivo && isCurrentSession(session)) setUrl(actual.replace(blob)); })
      .catch(() => { /* iniciales: no se dice por qué no hay foto */ });
    return () => { vivo = false; actual.clear(); };
  }, [resultado.username, resultado.has_avatar, session]);

  useEffect(() => () => lease.current?.dispose(), []);

  return url
    ? <img className="friend-avatar-image" src={url} alt="" aria-hidden="true" />
    : <Avatar name={nombre} />;
}
