import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, newIdempotencyKey } from '../../api';
import { extractApiError } from '../../api/errors';
import { isCurrentSession } from '../../api/storage';
import type { Friend } from '../../api/types';
import {
  publicarArrobaPropia,
  useArrobaPropia,
  useUsernameCapability,
  type ResultadoArroba,
} from '../../api/username';
import { errorDeViaje } from '../../api/viajes';
import { useAuth } from '../../auth/AuthContext';
import { AppHeaderBack } from '../../components/AppHeader';
import { ESPERA_MS } from '../../components/BuscarPorArroba';
import { Icon } from '../../components/Icon';
import { useIdioma } from '../../i18n/idioma';
import { goBack, navigate } from '../../router';
import { RequestEpoch } from '../../utils/requestEpoch';
import { fullName } from '../../utils/identity';
import {
  arrobaCorta,
  consultaDe,
  contenidoDelPedido,
  fechasInvertidas,
  filaDe,
  llaveParaElPedido,
  MAX_AGREGADOS,
  mensajeAlCrear,
  puedeCrear,
  seccionesDeBusqueda,
  sinResultados,
  type Candidato,
  type FilaDePersona,
  type LlaveDelPedido,
  type VistaDeBusqueda,
} from './crearViajeView';
import { iniciales } from './viajesView';
import './viajes.css';
import './crear.css';

/**
 * AF-VIAJES · D242 · 1d «Crear viaje» y 1e «buscar por @usuario»
 * (`POST /api/viajes`).
 *
 * Nombre (obligatorio), fechas Del/Al (opcionales, D242-5) y miembros: amigos
 * aceptados (por su id) o lo que muestra la búsqueda por @ (por su @), hasta 19
 * más yo. A cada uno le llega una invitación; entran al aceptarla. Al crear, se
 * va directo al viaje.
 *
 * La búsqueda por @ es la misma de «Agregar amigo» (`BuscarPorArroba`): espera
 * `ESPERA_MS` sin teclear, sólo con 3+ caracteres del alfabeto del @ y sólo con
 * `features.username` encendida. De nadie se ve el correo.
 */

type BusquedaPorArroba =
  | { readonly fase: 'quieta' }
  | { readonly fase: 'buscando' }
  /** Con la consulta que la trajo: una lista de otra consulta no se muestra. */
  | { readonly fase: 'lista'; readonly q: string; readonly resultados: readonly ResultadoArroba[] }
  | { readonly fase: 'limite' }
  | { readonly fase: 'error' };

export function CrearViajeScreen() {
  const { t } = useIdioma();
  const { session } = useAuth();
  const { enabled: arrobaHabilitada } = useUsernameCapability();
  const principal = session?.principal_id ?? '';
  const miArroba = useArrobaPropia(principal);

  const [nombre, setNombre] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [texto, setTexto] = useState('');
  const [amigos, setAmigos] = useState<readonly Friend[]>([]);
  const [busqueda, setBusqueda] = useState<BusquedaPorArroba>({ fase: 'quieta' });
  const [agregados, setAgregados] = useState<readonly Candidato[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const llave = useRef<LlaveDelPedido | null>(null);
  const epoca = useRef(new RequestEpoch());

  // Los amigos aceptados, una vez. Si no llegan, se puede sumar gente por @.
  useEffect(() => {
    let vivo = true;
    api.getFriends()
      .then((r) => { if (vivo) setAmigos(r.friends); })
      .catch(() => undefined);
    return () => { vivo = false; };
  }, []);

  // Mi @ para la fila «Tú». Si nadie lo leyó todavía en esta sesión, una
  // lectura (`GET /api/account/username`, la de Configuración) y se publica en
  // el store de siempre. Un fallo deja la fila sin @.
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

  function cambio() {
    setError(null);
  }

  function agregar(clave: string) {
    const c = [...secciones.amigos, ...secciones.otros].find((x) => x.clave === clave);
    if (!c) return;
    cambio();
    setAgregados((prev) => (prev.length >= MAX_AGREGADOS || prev.some((x) => x.clave === c.clave
      || (c.username !== null && x.username === c.username)) ? prev : [...prev, c]));
  }

  function quitar(clave: string) {
    cambio();
    setAgregados((prev) => prev.filter((x) => x.clave !== clave));
  }

  async function crear() {
    if (!puedeCrear({ nombre, agregados, desde, hasta, enviando })) return;
    const contenido = contenidoDelPedido(nombre, desde, hasta, agregados);
    const actual = llaveParaElPedido(llave.current, contenido, newIdempotencyKey);
    llave.current = actual;
    setEnviando(true);
    setError(null);
    try {
      const viaje = await api.crearViaje({ ...contenido, idempotency_key: actual.clave });
      navigate('viaje', viaje.id);
    } catch (err) {
      // Defensivo: si el dueño dice que esta llave ya es de otro pedido, la próxima es nueva.
      if (extractApiError(err).code === 'idempotency_key_conflict') llave.current = null;
      setError(mensajeAlCrear(errorDeViaje(err), t));
      setEnviando(false);
    }
  }

  const u = session?.user;
  const busquedaVista: VistaDeBusqueda | null = consulta.texto
    ? {
      texto: consulta.texto,
      amigos: secciones.amigos.map((c) => filaDe(c, arrobaHabilitada)),
      otros: secciones.otros.map((c) => filaDe(c, arrobaHabilitada)),
      yaAgregados: secciones.yaAgregados.map((c) => filaDe(c, arrobaHabilitada)),
      // Lo que se ve sigue a lo escrito AHORA, no al último efecto: sin consulta
      // por @ no se busca, y una lista de otra consulta todavía no llegó.
      fase: !buscarPorArroba ? 'quieta' : busqueda.fase === 'lista' && busqueda.q !== consulta.arroba ? 'buscando' : busqueda.fase,
      arrobaCorta: arrobaHabilitada && arrobaCorta(consulta),
    }
    : null;

  return (
    <CrearViajeView
      userName={fullName(session) ?? undefined}
      nombre={nombre}
      desde={desde}
      hasta={hasta}
      texto={texto}
      yo={{
        iniciales: iniciales({ first_name: u?.first_name ?? null, last_name: u?.last_name ?? null, username: null, eliminada: false }),
        arroba: miArroba,
      }}
      agregados={agregados.map((c) => filaDe(c, arrobaHabilitada))}
      busqueda={busquedaVista}
      lleno={agregados.length >= MAX_AGREGADOS}
      error={error}
      enviando={enviando}
      puedeCrear={puedeCrear({ nombre, agregados, desde, hasta, enviando })}
      onVolver={() => goBack('home')}
      onNombre={(v) => { cambio(); setNombre(v); }}
      onDesde={(v) => { cambio(); setDesde(v); }}
      onHasta={(v) => { cambio(); setHasta(v); }}
      onTexto={setTexto}
      onAgregar={agregar}
      onQuitar={quitar}
      onCrear={() => { void crear(); }}
    />
  );
}

// ─── La vista (pura: sin red ni estado) ────────────────────────────────────

export interface CrearViajeVistaProps {
  readonly userName?: string;
  readonly nombre: string;
  readonly desde: string;
  readonly hasta: string;
  readonly texto: string;
  readonly yo: { readonly iniciales: string; readonly arroba: string | null };
  readonly agregados: readonly FilaDePersona[];
  /** `null` mientras no se escribe en el buscador (1d); con texto, los resultados (1e). */
  readonly busqueda: VistaDeBusqueda | null;
  /** 19 agregados: ya no entra nadie más. */
  readonly lleno: boolean;
  readonly error: string | null;
  readonly enviando: boolean;
  readonly puedeCrear: boolean;
  readonly onVolver: () => void;
  readonly onNombre: (v: string) => void;
  readonly onDesde: (v: string) => void;
  readonly onHasta: (v: string) => void;
  readonly onTexto: (v: string) => void;
  readonly onAgregar: (clave: string) => void;
  readonly onQuitar: (clave: string) => void;
  readonly onCrear: () => void;
}

export function CrearViajeView(p: CrearViajeVistaProps) {
  const { t } = useIdioma();
  const invertidas = fechasInvertidas(p.desde, p.hasta);
  const b = p.busqueda;

  return (
    <div className="screen vj-con-pie vjc">
      <AppHeaderBack userName={p.userName} onBack={p.onVolver} />
      <div className="title-card">
        <h1 className="title-card-title">{t('Crear viaje')}</h1>
      </div>

      <div className="scroll vj-scroll">
        <section className="vj-card">
          <label className="vjc-etiqueta" htmlFor="vjc-nombre">{t('Nombre del viaje')}</label>
          <input
            id="vjc-nombre"
            className="input vjc-input"
            type="text"
            value={p.nombre}
            maxLength={80}
            autoComplete="off"
            enterKeyHint="next"
            onChange={(e) => p.onNombre(e.target.value)}
          />
        </section>

        <section className="vj-card">
          <div className="vjc-etiqueta-fila">
            <h2 className="vjc-etiqueta" id="vjc-fechas">{t('Fechas')}</h2>
            <span className="vjc-opcional">{t('Opcional')}</span>
          </div>
          <div className="vjc-fechas" role="group" aria-labelledby="vjc-fechas">
            <div className="vjc-fecha">
              <label className="vjc-sub" htmlFor="vjc-del">{t('Del')}</label>
              <input
                id="vjc-del"
                className="input vjc-input"
                type="date"
                value={p.desde}
                max={p.hasta || undefined}
                onChange={(e) => p.onDesde(e.target.value)}
              />
            </div>
            <div className="vjc-fecha">
              <label className="vjc-sub" htmlFor="vjc-al">{t('Al')}</label>
              <input
                id="vjc-al"
                className="input vjc-input"
                type="date"
                value={p.hasta}
                min={p.desde || undefined}
                aria-invalid={invertidas || undefined}
                aria-describedby={invertidas ? 'vjc-fechas-error' : undefined}
                onChange={(e) => p.onHasta(e.target.value)}
              />
            </div>
          </div>
          {invertidas && (
            <p id="vjc-fechas-error" className="vjc-error" role="alert">
              {t('La fecha «Al» no puede ser antes de «Del».')}
            </p>
          )}
        </section>

        <section className="vj-card" aria-labelledby="vjc-miembros">
          <h2 className="vjc-etiqueta" id="vjc-miembros">{t('Miembros')}</h2>
          <div className="vjc-buscar">
            <span className="vjc-buscar-icono"><Icon name="search" size={18} /></span>
            <input
              className="input vjc-input vjc-buscar-input"
              type="search"
              value={p.texto}
              placeholder={t('Busca en Amigos o escribe @usuario')}
              aria-label={t('Busca en Amigos o escribe @usuario')}
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              maxLength={60}
              onChange={(e) => p.onTexto(e.target.value)}
            />
          </div>
          {p.lleno && <p className="vjc-nota">{t('Un viaje admite hasta 20 personas.')}</p>}

          {b ? (
            <div className="vjc-resultados" aria-live="polite">
              {b.amigos.length > 0 && (
                <>
                  <h3 className="vj-seccion">{t('En tus amigos')}</h3>
                  <ul className="vjc-lista">
                    {b.amigos.map((x) => (
                      <FilaPersona key={x.clave} persona={x}>
                        <BotonAgregar disabled={p.lleno} onClick={() => p.onAgregar(x.clave)} />
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
                          <BotonAgregar disabled={p.lleno} onClick={() => p.onAgregar(x.clave)} />
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
              {b.arrobaCorta && <p className="vjc-ayuda">{t('Escribe al menos 3 letras de su @.')}</p>}
              {sinResultados(b) && <p className="vjc-ayuda">{t('No encontramos a {0}. Revísalo.', b.texto)}</p>}
            </div>
          ) : (
            <ul className="vjc-lista">
              <li className="vjc-fila">
                <span className="vj-avatar vjc-avatar" aria-hidden="true">{p.yo.iniciales}</span>
                <div className="vjc-quien">
                  <div className="vjc-nombre">{t('Tú')}</div>
                  {p.yo.arroba && <div className="vjc-arroba">{p.yo.arroba}</div>}
                </div>
                <span className="vjc-creas">{t('Creas el viaje')}</span>
              </li>
              {p.agregados.map((x) => (
                <FilaPersona key={x.clave} persona={x}>
                  <button type="button" className="vjc-quitar" aria-label={t('Quitar')} onClick={() => p.onQuitar(x.clave)}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
                    </svg>
                  </button>
                </FilaPersona>
              ))}
            </ul>
          )}
        </section>

        <p className="vjc-nota">{t('Les llega una invitación. Entran al viaje cuando la aceptan.')}</p>
      </div>

      <div className="vj-pie">
        {p.error && <p className="vjc-error-pie" role="alert">{p.error}</p>}
        <button
          type="button"
          className="btn btn-navy"
          disabled={!p.puedeCrear}
          aria-busy={p.enviando || undefined}
          onClick={p.onCrear}
        >
          {t('Crear viaje')}
        </button>
      </div>
    </div>
  );
}

function FilaPersona({ persona, children }: { readonly persona: FilaDePersona; readonly children?: ReactNode }) {
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

function BotonAgregar({ disabled, onClick }: { readonly disabled: boolean; readonly onClick: () => void }) {
  const { t } = useIdioma();
  return (
    <button type="button" className="btn btn-teal btn-sm btn-fit vjc-agregar" disabled={disabled} onClick={onClick}>
      {t('Agregar')}
    </button>
  );
}
