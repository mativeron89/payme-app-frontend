import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../../api';
import { extractApiError } from '../../api/errors';
import { isCurrentSession } from '../../api/storage';
import type { Friend } from '../../api/types';
import {
  publicarArrobaPropia,
  useArrobaPropia,
  useUsernameCapability,
  type ResultadoArroba,
} from '../../api/username';
import { useAuth } from '../../auth/AuthContext';
import { ESPERA_MS } from '../../components/BuscarPorArroba';
import { Icon } from '../../components/Icon';
import { useIdioma } from '../../i18n/idioma';
import { RequestEpoch } from '../../utils/requestEpoch';
import {
  arrobaCorta,
  consultaDe,
  filaDe,
  seccionesDeBusqueda,
  sinResultados,
  type Candidato,
  type FilaDePersona,
  type Secciones,
  type VistaDeBusqueda,
} from './crearViajeView';

/**
 * El buscador de personas de Viajes: amigos aceptados y, con `features.username`,
 * la búsqueda por @ (la misma de «Agregar amigo»: espera `ESPERA_MS` sin teclear
 * y sólo con 3+ caracteres del alfabeto del @). De nadie se ve el correo.
 *
 * Nació en «Crear viaje» (1d, 1e). D255-8 · «Agregar miembros» de Configuración
 * usa el mismo: por eso vive acá y no adentro de una pantalla.
 */

type BusquedaPorArroba =
  | { readonly fase: 'quieta' }
  | { readonly fase: 'buscando' }
  /** Con la consulta que la trajo: una lista de otra consulta no se muestra. */
  | { readonly fase: 'lista'; readonly q: string; readonly resultados: readonly ResultadoArroba[] }
  | { readonly fase: 'limite' }
  | { readonly fase: 'error' };

/**
 * D255-8 · separa a quienes ya están en el viaje (o invitados), reconocidos por
 * su @, de los que se pueden ofrecer. Sin conjunto (Crear viaje), todos se
 * ofrecen. Quien no tiene @ se ofrece siempre: el dueño ignora a quien ya está.
 */
export function partirPorViaje(
  candidatos: readonly Candidato[],
  enElViaje: ReadonlySet<string> | undefined,
): { readonly ofrecer: readonly Candidato[]; readonly yaEstan: readonly Candidato[] } {
  if (enElViaje === undefined) return { ofrecer: candidatos, yaEstan: [] };
  const esta = (c: Candidato) => c.username !== null && enElViaje.has(c.username);
  return { ofrecer: candidatos.filter((c) => !esta(c)), yaEstan: candidatos.filter(esta) };
}

export interface Buscador {
  readonly texto: string;
  readonly setTexto: (v: string) => void;
  readonly secciones: Secciones;
  /** `null` sin texto en el buscador; con texto, lo que se ve. */
  readonly vista: VistaDeBusqueda | null;
  readonly arrobaHabilitada: boolean;
  /** Mi @ con «@», si lo sé. */
  readonly miArroba: string | null;
}

/**
 * `agregados`: los que ya se sumaron (pasan a «Ya agregaste» y no se ofrecen de nuevo).
 * `enElViaje`: los @ de quienes ya están en el viaje o invitados (Configuración):
 * pasan a «Ya están en el viaje», sin «Agregar». Quien no tiene @ no se puede
 * reconocer desde acá (el viaje no publica su id de cuenta); el dueño lo ignora.
 */
export function useBuscadorDeMiembros(agregados: readonly Candidato[], enElViaje?: ReadonlySet<string>): Buscador {
  const { session } = useAuth();
  const { enabled: arrobaHabilitada } = useUsernameCapability();
  const principal = session?.principal_id ?? '';
  const miArroba = useArrobaPropia(principal);
  const [texto, setTexto] = useState('');
  const [amigos, setAmigos] = useState<readonly Friend[]>([]);
  const [busqueda, setBusqueda] = useState<BusquedaPorArroba>({ fase: 'quieta' });
  const epoca = useRef(new RequestEpoch());

  // Los amigos aceptados, una vez. Si no llegan, se puede sumar gente por @.
  useEffect(() => {
    let vivo = true;
    api.getFriends()
      .then((r) => { if (vivo) setAmigos(r.friends); })
      .catch(() => undefined);
    return () => { vivo = false; };
  }, []);

  // Mi @ para la fila «Tú» y para no ofrecerme. Si nadie lo leyó todavía en esta
  // sesión, una lectura (`GET /api/account/username`, la de Configuración) y se
  // publica en el store de siempre. Un fallo deja la fila sin @.
  useEffect(() => {
    if (!arrobaHabilitada || !session || miArroba !== null) return undefined;
    let vivo = true;
    api.getUsername(session)
      .then((e) => { if (vivo && isCurrentSession(session)) publicarArrobaPropia(session.principal_id, e.username); })
      .catch(() => undefined);
    return () => { vivo = false; };
  }, [arrobaHabilitada, session, miArroba]);

  const consulta = consultaDe(texto);
  const buscarPorArroba = arrobaHabilitada && consulta.consultable && session !== null;

  useEffect(() => {
    // Cada tecla invalida lo que estaba en vuelo: una respuesta vieja no pisa a una más nueva.
    const mia = epoca.current.next();
    if (!buscarPorArroba || !session) {
      setBusqueda({ fase: 'quieta' });
      return undefined;
    }
    setBusqueda({ fase: 'buscando' });
    const q = consulta.arroba;
    const espera = window.setTimeout(() => {
      if (!isCurrentSession(session)) return;
      api.searchUsernames(q, session)
        .then((resultados) => {
          if (epoca.current.isCurrent(mia)) setBusqueda({ fase: 'lista', q, resultados });
        })
        .catch((err: unknown) => {
          if (!epoca.current.isCurrent(mia)) return;
          setBusqueda({ fase: extractApiError(err).status === 429 ? 'limite' : 'error' });
        });
    }, ESPERA_MS);
    return () => window.clearTimeout(espera);
  }, [consulta.arroba, buscarPorArroba, session]);

  const resultados = busqueda.fase === 'lista' && busqueda.q === consulta.arroba ? busqueda.resultados : [];
  const secciones = seccionesDeBusqueda({
    consulta,
    amigos,
    resultados,
    agregados,
    arrobaHabilitada,
    miUsername: miArroba ? miArroba.replace(/^@/, '') : null,
  });

  const amigosPartidos = partirPorViaje(secciones.amigos, enElViaje);
  const otrosPartidos = partirPorViaje(secciones.otros, enElViaje);
  // Recién agregado y ya en el viaje (con su @, en la respuesta): «Ya están en el viaje».
  const agregadosPartidos = partirPorViaje(secciones.yaAgregados, enElViaje);
  const vista: VistaDeBusqueda | null = consulta.texto
    ? {
      texto: consulta.texto,
      amigos: amigosPartidos.ofrecer.map((c) => filaDe(c, arrobaHabilitada)),
      otros: otrosPartidos.ofrecer.map((c) => filaDe(c, arrobaHabilitada)),
      yaAgregados: agregadosPartidos.ofrecer.map((c) => filaDe(c, arrobaHabilitada)),
      ...(enElViaje !== undefined
        ? {
          enElViaje: [...amigosPartidos.yaEstan, ...otrosPartidos.yaEstan, ...agregadosPartidos.yaEstan]
            .map((c) => filaDe(c, arrobaHabilitada)),
        }
        : {}),
      // Lo que se ve sigue a lo escrito AHORA, no al último efecto: sin consulta
      // por @ no se busca, y una lista de otra consulta todavía no llegó.
      fase: !buscarPorArroba ? 'quieta' : busqueda.fase === 'lista' && busqueda.q !== consulta.arroba ? 'buscando' : busqueda.fase,
      arrobaCorta: arrobaHabilitada && arrobaCorta(consulta),
    }
    : null;

  return { texto, setTexto, secciones, vista, arrobaHabilitada, miArroba };
}

/** El campo del buscador, con su lupa. */
export function CampoDeBusqueda({ texto, onTexto }: { readonly texto: string; readonly onTexto: (v: string) => void }) {
  const { t } = useIdioma();
  return (
    <div className="vjc-buscar">
      <span className="vjc-buscar-icono"><Icon name="search" size={18} /></span>
      <input
        className="input vjc-input vjc-buscar-input"
        type="search"
        value={texto}
        placeholder={t('Busca en Amigos o escribe @usuario')}
        aria-label={t('Busca en Amigos o escribe @usuario')}
        autoCapitalize="none"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        maxLength={60}
        onChange={(e) => onTexto(e.target.value)}
      />
    </div>
  );
}

/** Lo que encontró el buscador (1e): en tus amigos, otros usuarios y ya agregados. */
export function ResultadosDeBusqueda({ b, lleno, ocupado = null, onAgregar }: {
  readonly b: VistaDeBusqueda;
  /** Ya no entra nadie más: «Agregar» apagado. */
  readonly lleno: boolean;
  /** La clave que se está mandando (Configuración): su «Agregar» espera. */
  readonly ocupado?: string | null;
  readonly onAgregar: (clave: string) => void;
}) {
  const { t } = useIdioma();
  return (
    <div className="vjc-resultados" aria-live="polite">
      {b.amigos.length > 0 && (
        <>
          <h3 className="vj-seccion">{t('En tus amigos')}</h3>
          <ul className="vjc-lista">
            {b.amigos.map((x) => (
              <FilaPersona key={x.clave} persona={x}>
                <BotonAgregar disabled={lleno || ocupado !== null} enviando={ocupado === x.clave} onClick={() => onAgregar(x.clave)} />
              </FilaPersona>
            ))}
          </ul>
        </>
      )}
      {(b.otros.length > 0 || b.fase === 'buscando' || b.fase === 'limite' || b.fase === 'error') && (
        <>
          <h3 className="vj-seccion">{t('Otros usuarios de PayMe')}</h3>
          {b.fase === 'buscando' && <p className="vjc-ayuda">{t('Buscando…')}</p>}
          {b.fase === 'limite' && (
            <p className="vjc-error">{t('Hiciste muchas búsquedas seguidas. Espera un momento.')}</p>
          )}
          {b.fase === 'error' && <p className="vjc-error">{t('No pudimos buscar. Prueba de nuevo.')}</p>}
          {b.otros.length > 0 && (
            <ul className="vjc-lista">
              {b.otros.map((x) => (
                <FilaPersona key={x.clave} persona={x}>
                  <BotonAgregar disabled={lleno || ocupado !== null} enviando={ocupado === x.clave} onClick={() => onAgregar(x.clave)} />
                </FilaPersona>
              ))}
            </ul>
          )}
        </>
      )}
      {b.yaAgregados.length > 0 && (
        <>
          <h3 className="vj-seccion">{t('Ya agregaste')}</h3>
          <ul className="vjc-lista">
            {b.yaAgregados.map((x) => <FilaPersona key={x.clave} persona={x} />)}
          </ul>
        </>
      )}
      {b.enElViaje && b.enElViaje.length > 0 && (
        <>
          <h3 className="vj-seccion">{t('Ya están en el viaje')}</h3>
          <ul className="vjc-lista">
            {b.enElViaje.map((x) => <FilaPersona key={x.clave} persona={x} />)}
          </ul>
        </>
      )}
      {b.arrobaCorta && <p className="vjc-ayuda">{t('Escribe al menos 3 letras de su @.')}</p>}
      {sinResultados(b) && <p className="vjc-ayuda">{t('No encontramos a {0}. Revísalo.', b.texto)}</p>}
    </div>
  );
}

export function FilaPersona({ persona, children }: { readonly persona: FilaDePersona; readonly children?: ReactNode }) {
  return (
    <li className="vjc-fila">
      <span className="vj-avatar vjc-avatar" aria-hidden="true">{persona.iniciales}</span>
      <div className="vjc-quien">
        <div className="vjc-nombre">{persona.nombre}</div>
        {persona.arroba && <div className="vjc-arroba">{persona.arroba}</div>}
      </div>
      {children}
    </li>
  );
}

function BotonAgregar({ disabled, enviando = false, onClick }: {
  readonly disabled: boolean;
  readonly enviando?: boolean;
  readonly onClick: () => void;
}) {
  const { t } = useIdioma();
  return (
    <button
      type="button"
      className="btn btn-teal btn-sm btn-fit vjc-agregar"
      disabled={disabled}
      aria-busy={enviando || undefined}
      onClick={onClick}
    >
      {t('Agregar')}
    </button>
  );
}
