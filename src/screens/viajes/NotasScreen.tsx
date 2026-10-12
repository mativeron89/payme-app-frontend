import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../api';
import { ultimoVisto } from '../../api/ultimoVisto';
import {
  errorDeNotas,
  largoDeNota,
  type Apartado,
  type EntradaDeNotas,
  type ListaConTildes,
  type NotaDeTexto,
  type Pizarron,
} from '../../api/viajesNotas';
import { useAuth } from '../../auth/AuthContext';
import { AppBottomBar } from '../../components/AppBottomBar';
import { AppHeaderBack } from '../../components/AppHeader';
import { Icon } from '../../components/Icon';
import { FilaDeTitulo } from '../../components/TarjetaDeTitulo';
import { useToast } from '../../components/ui';
import { useHojaModal } from '../../components/useHojaModal';
import { useIdioma } from '../../i18n/idioma';
import { goBack, navigate, replaceRoute } from '../../router';
import { fullName } from '../../utils/identity';
import { useFotosDeMiembros } from './ViajeScreen';
import { circuloDelViaje } from './circuloDelViaje';
import {
  conMiApartado,
  contadorDeItems,
  contadorDeTexto,
  fechaDeCierre,
  MUCHAS_PERSONAS,
  nombresEnUnaLinea,
  nuevaClaveDeNota,
  parametroDeApartado,
  reaccionAlError,
  resumenDeEntradas,
  tildadosDeLista,
  vistaDeMuchos,
  type AccionDeNotas,
  type Contador,
} from './notasView';
import { iniciales, nombreCompleto, nombreDePila } from './viajesView';
import './viajes.css';
import './notas.css';

/**
 * D290 · el pizarrón de notas del viaje (`/viaje-notas/<viaje>`) y el apartado de otro (`/viaje-notas/<viaje>.<miembro>`),
 * según `PANTALLA-notas-del-viaje.md` (manda) y el turno 2 del prototipo (2b–2h).
 *
 * Mati: «Todos ven, cada uno escribe el suyo» y «Texto y listas con tildes». Mi apartado va primero, con su cabecera
 * celeste, + Nota, + Lista y el menú ⋯; los de los demás, sólo para leer. Con el viaje esperando pagos o cerrado, nadie
 * escribe y las tildes quedan como estaban.
 *
 * 🔴 Privacidad (la orden): las notas son texto de las personas. El pizarrón vive SÓLO en el estado de esta pantalla:
 * ni `localStorage`, ni lo último visto, ni un log. Cada respuesta se aplica sólo si la cuenta que pidió sigue siendo la
 * de ahora (el turno de T-01), y al cambiar de cuenta la pantalla se vacía en el acto y vuelve a pedir: nada de las
 * notas de A queda a la vista de B.
 */

type Carga =
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'error' }
  | { readonly tipo: 'no_disponible' }
  | { readonly tipo: 'listo'; readonly pizarron: Pizarron };

type Hoja =
  | { readonly tipo: 'nota'; readonly entrada: NotaDeTexto | null }
  | { readonly tipo: 'lista'; readonly entrada: ListaConTildes | null }
  | { readonly tipo: 'menu'; readonly entrada: EntradaDeNotas };

/** Lo que una hoja de escribir le pide a la pantalla, y lo que la pantalla le contesta. */
export type ResultadoDeGuardar = { readonly cerrar: true } | { readonly cerrar: false; readonly mensaje: string | null; readonly nuevaClave?: boolean };

export function NotasScreen({ viajeId, miembroId }: { viajeId: string; miembroId: string | null }) {
  const { t } = useIdioma();
  const { session } = useAuth();
  const toast = useToast();
  const [carga, setCarga] = useState<Carga>({ tipo: 'cargando' });
  const [hoja, setHoja] = useState<Hoja | null>(null);
  /** Las tildes en camino: lo que se ve mientras el dueño contesta (un toque más sobre el mismo ítem no hace nada). */
  const [tildando, setTildando] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const enVuelo = useRef(new Set<string>());
  const vivo = useRef(true);
  useEffect(() => {
    vivo.current = true;
    return () => { vivo.current = false; };
  }, []);

  const pedir = useCallback(async (silencioso: boolean) => {
    const turno = ultimoVisto.turno();
    try {
      const pizarron = await api.getNotasDeViaje(viajeId);
      if (!vivo.current || !ultimoVisto.esDeAhora(turno)) return;
      setCarga({ tipo: 'listo', pizarron });
    } catch (err) {
      if (!vivo.current || !ultimoVisto.esDeAhora(turno)) return;
      if (errorDeNotas(err).tipo === 'no_disponible') setCarga({ tipo: 'no_disponible' });
      else if (!silencioso) setCarga({ tipo: 'error' });
    }
  }, [viajeId]);

  const cargar = useCallback(() => {
    setCarga({ tipo: 'cargando' });
    void pedir(false);
  }, [pedir]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // 🔴 Otra cuenta (o ninguna): lo de la anterior se borra de la pantalla en el acto y se vuelve a pedir con la de ahora.
  useEffect(() => ultimoVisto.alVaciarse(() => {
    setHoja(null);
    setTildando(new Map());
    enVuelo.current.clear();
    cargar();
  }), [cargar]);

  const pizarron = carga.tipo === 'listo' ? carga.pizarron : null;
  const personas = useMemo(
    () => pizarron?.apartados.map((a) => ({ id: a.miembro_id, has_avatar: a.has_avatar })) ?? null,
    [pizarron],
  );
  const fotoDe = useFotosDeMiembros(viajeId, personas);

  function aplicarMio(mio: Apartado) {
    setCarga((c) => (c.tipo === 'listo' ? { tipo: 'listo', pizarron: conMiApartado(c.pizarron, mio) } : c));
  }

  /** Aplica la reacción a un error y devuelve qué hace la hoja (si había). */
  function reaccionar(err: unknown, accion: AccionDeNotas, tipo: 'nota' | 'lista'): ResultadoDeGuardar {
    const r = reaccionAlError(errorDeNotas(err), accion, tipo, t);
    if (r.noDisponible) {
      setHoja(null);
      setCarga({ tipo: 'no_disponible' });
      return { cerrar: true };
    }
    if (r.apartado) aplicarMio(r.apartado);
    if (r.refrescar) void pedir(true);
    if (r.cerrarHoja) {
      setHoja(null);
      if (r.mensaje) toast(r.mensaje, { sobreLaBarra: true });
      return { cerrar: true };
    }
    if (accion === 'borrar' || accion === 'tildar') {
      if (r.mensaje) toast(r.mensaje, { sobreLaBarra: true });
      return { cerrar: true };
    }
    // Editando, el 409 trae la versión de ahora: la hoja sigue con lo escrito y guarda sobre esa versión.
    if (r.apartado && hoja && (hoja.tipo === 'nota' || hoja.tipo === 'lista') && hoja.entrada) {
      const nueva = r.apartado.entradas.find((x) => x.id === hoja.entrada!.id);
      if (!nueva) {
        setHoja(null);
        toast(t('Ya no estaba'), { sobreLaBarra: true });
        return { cerrar: true };
      }
      setHoja(nueva.tipo === 'nota' ? { tipo: 'nota', entrada: nueva } : { tipo: 'lista', entrada: nueva });
    }
    return { cerrar: false, mensaje: r.mensaje, nuevaClave: r.nuevaClave };
  }

  async function guardarNota(texto: string, clave: string): Promise<ResultadoDeGuardar> {
    if (hoja?.tipo !== 'nota') return { cerrar: true };
    const entrada = hoja.entrada;
    const turno = ultimoVisto.turno();
    try {
      const mio = entrada
        ? await api.editarNotaDeViaje(viajeId, entrada.id, { version: entrada.version, texto })
        : (await api.crearNotaDeViaje(viajeId, { idempotency_key: clave, tipo: 'nota', texto })).apartado;
      if (!vivo.current || !ultimoVisto.esDeAhora(turno)) return { cerrar: true };
      aplicarMio(mio);
      setHoja(null);
      toast(entrada ? t('Nota guardada') : t('Nota agregada'), { sobreLaBarra: true });
      return { cerrar: true };
    } catch (err) {
      if (!vivo.current || !ultimoVisto.esDeAhora(turno)) return { cerrar: true };
      return reaccionar(err, entrada ? 'editar' : 'crear', 'nota');
    }
  }

  async function guardarLista(titulo: string, items: ReadonlyArray<{ id?: string; texto: string }>, clave: string): Promise<ResultadoDeGuardar> {
    if (hoja?.tipo !== 'lista') return { cerrar: true };
    const entrada = hoja.entrada;
    const turno = ultimoVisto.turno();
    try {
      const mio = entrada
        ? await api.editarNotaDeViaje(viajeId, entrada.id, { version: entrada.version, titulo, items })
        : (await api.crearNotaDeViaje(viajeId, { idempotency_key: clave, tipo: 'lista', titulo, items: items.map((i) => ({ texto: i.texto })) })).apartado;
      if (!vivo.current || !ultimoVisto.esDeAhora(turno)) return { cerrar: true };
      aplicarMio(mio);
      setHoja(null);
      toast(entrada ? t('Lista guardada') : t('Lista agregada'), { sobreLaBarra: true });
      return { cerrar: true };
    } catch (err) {
      if (!vivo.current || !ultimoVisto.esDeAhora(turno)) return { cerrar: true };
      return reaccionar(err, entrada ? 'editar' : 'crear', 'lista');
    }
  }

  const borrando = useRef(false);
  async function borrar(entrada: EntradaDeNotas) {
    if (borrando.current) return;
    borrando.current = true;
    setHoja(null);
    const turno = ultimoVisto.turno();
    try {
      const mio = await api.borrarNotaDeViaje(viajeId, entrada.id, entrada.version);
      if (!vivo.current || !ultimoVisto.esDeAhora(turno)) return;
      aplicarMio(mio);
      toast(entrada.tipo === 'nota' ? t('Nota borrada') : t('Lista borrada'), { sobreLaBarra: true });
    } catch (err) {
      if (!vivo.current || !ultimoVisto.esDeAhora(turno)) return;
      reaccionar(err, 'borrar', entrada.tipo);
    } finally {
      borrando.current = false;
    }
  }

  async function tildar(lista: ListaConTildes, itemId: string, tildado: boolean) {
    // Doble toque: mientras el dueño contesta, el mismo ítem no se vuelve a mandar.
    if (enVuelo.current.has(itemId)) return;
    enVuelo.current.add(itemId);
    setTildando((m) => new Map(m).set(itemId, tildado));
    const turno = ultimoVisto.turno();
    try {
      const mio = await api.tildarItemDeNota(viajeId, lista.id, itemId, tildado);
      if (!vivo.current || !ultimoVisto.esDeAhora(turno)) return;
      aplicarMio(mio);
    } catch (err) {
      if (!vivo.current || !ultimoVisto.esDeAhora(turno)) return;
      reaccionar(err, 'tildar', 'lista');
    } finally {
      enVuelo.current.delete(itemId);
      if (vivo.current) {
        setTildando((m) => {
          const n = new Map(m);
          n.delete(itemId);
          return n;
        });
      }
    }
  }

  const otro = pizarron && miembroId ? pizarron.apartados.find((a) => a.miembro_id === miembroId) ?? null : null;
  // El mío, o alguien que ya no está: el pizarrón.
  useEffect(() => {
    if (pizarron && miembroId && (!otro || otro.es_yo)) replaceRoute('viaje-notas', viajeId);
  }, [pizarron, miembroId, otro, viajeId]);

  const centro = circuloDelViaje(pizarron ? { id: pizarron.viaje_id, nombre: pizarron.nombre, estado: pizarron.estado } : null, t);
  return (
    <div className="screen has-appbar">
      <AppHeaderBack
        userName={fullName(session) ?? undefined}
        onBack={() => (miembroId ? goBack('viaje-notas', viajeId) : goBack('viaje', viajeId))}
      />
      {otro && !otro.es_yo && pizarron ? (
        <ApartadoDeOtroVista
          pizarron={pizarron}
          apartado={otro}
          foto={fotoDe(otro.miembro_id)}
          onIr={(a) => (a.es_yo ? goBack('viaje-notas', viajeId) : replaceRoute('viaje-notas', parametroDeApartado(viajeId, a.miembro_id)))}
        />
      ) : (
        <PizarronVista
          carga={carga}
          tildando={tildando}
          fotoDe={fotoDe}
          onReintentar={cargar}
          onVerViajes={() => navigate('viajes', 'abiertos')}
          onNueva={(tipo) => setHoja(tipo === 'nota' ? { tipo: 'nota', entrada: null } : { tipo: 'lista', entrada: null })}
          onMenu={(entrada) => setHoja({ tipo: 'menu', entrada })}
          onTildar={(lista, itemId, tildado) => void tildar(lista, itemId, tildado)}
          onAbrirApartado={(a) => navigate('viaje-notas', parametroDeApartado(viajeId, a.miembro_id))}
        />
      )}
      <AppBottomBar active={null} center={centro} />
      {pizarron && hoja?.tipo === 'nota' && (
        <HojaDeNota
          key={`nota:${hoja.entrada?.id ?? 'nueva'}`}
          entrada={hoja.entrada}
          tope={pizarron.limites.caracteres_nota}
          onCancelar={() => setHoja(null)}
          onGuardar={guardarNota}
        />
      )}
      {pizarron && hoja?.tipo === 'lista' && (
        <HojaDeLista
          key={`lista:${hoja.entrada?.id ?? 'nueva'}`}
          entrada={hoja.entrada}
          limites={pizarron.limites}
          onCancelar={() => setHoja(null)}
          onGuardar={guardarLista}
        />
      )}
      {pizarron && hoja?.tipo === 'menu' && (
        <HojaDeMenu
          entrada={hoja.entrada}
          onEditar={() => setHoja(hoja.entrada.tipo === 'nota' ? { tipo: 'nota', entrada: hoja.entrada } : { tipo: 'lista', entrada: hoja.entrada })}
          onBorrar={() => void borrar(hoja.entrada)}
          onCancelar={() => setHoja(null)}
        />
      )}
    </div>
  );
}

// ─── El cuadro y el avatar ────────────────────────────────────────────────

/** El cuadro navy de 48 con el ícono de notas en blanco (PANTALLA §2). Trazo del prototipo. */
function CuadroDeNotas() {
  return (
    <span className="title-card-cuadro" data-icono="notas" aria-hidden="true">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}
        strokeLinecap="round" strokeLinejoin="round" focusable="false">
        <path d="M5 3h14v18H5zM9 8h6M9 12h6M9 16h3" />
      </svg>
    </span>
  );
}

/** Círculo de 40 con las iniciales (el mío navy con letras blancas; los demás celeste con cian oscuro), o la foto. */
export function AvatarDeNotas({ apartado, foto, tamano = 'normal' }: {
  apartado: Apartado;
  foto: string | null;
  tamano?: 'normal' | 'tira' | 'chico';
}) {
  return (
    <span className={`nts-avatar nts-avatar-${tamano}${apartado.es_yo ? ' nts-avatar-mio' : ''}`} aria-hidden="true">
      {foto ? <img className="nts-avatar-foto" src={foto} alt="" /> : iniciales(apartado)}
    </span>
  );
}

// ─── El pizarrón ──────────────────────────────────────────────────────────

export interface PizarronVistaProps {
  readonly carga: Carga;
  readonly tildando: ReadonlyMap<string, boolean>;
  readonly fotoDe: (miembroId: string) => string | null;
  readonly onReintentar: () => void;
  readonly onVerViajes: () => void;
  readonly onNueva: (tipo: 'nota' | 'lista') => void;
  readonly onMenu: (entrada: EntradaDeNotas) => void;
  readonly onTildar: (lista: ListaConTildes, itemId: string, tildado: boolean) => void;
  readonly onAbrirApartado: (apartado: Apartado) => void;
}

export function PizarronVista(props: PizarronVistaProps) {
  const { t } = useIdioma();
  const { carga } = props;
  if (carga.tipo !== 'listo') {
    return (
      <>
        <div className="title-card">
          <FilaDeTitulo cuadro={<CuadroDeNotas />}>
            <h1 className="title-card-title">{t('Notas')}</h1>
          </FilaDeTitulo>
        </div>
        <div className="scroll vj-scroll nts-scroll">
          <SinPizarron carga={carga} onReintentar={props.onReintentar} onVerViajes={props.onVerViajes} />
        </div>
      </>
    );
  }
  const p = carga.pizarron;
  const muchos = p.apartados.length >= MUCHAS_PERSONAS;
  return (
    <>
      <div className="title-card">
        <FilaDeTitulo cuadro={<CuadroDeNotas />}>
          <h1 className="title-card-title">{t('Notas')}</h1>
          <div className="title-card-sub">
            {p.nombre} · {p.total === 1 ? t('1 persona') : t('{0} personas', p.total)}
          </div>
        </FilaDeTitulo>
      </div>
      <div className="scroll vj-scroll nts-scroll">
        {muchos && <TiraDeFotos apartados={p.apartados} fotoDe={props.fotoDe} onAbrir={props.onAbrirApartado} />}
        <AvisoSinEscribir pizarron={p} />
        {muchos ? <PizarronDeMuchos pizarron={p} {...props} /> : <PizarronDePocos pizarron={p} {...props} />}
      </div>
    </>
  );
}

/** Cerrado o esperando pagos: la tarjeta con candado (PANTALLA §5). Abierto sin poder escribir: la cuenta suspendida. */
function AvisoSinEscribir({ pizarron: p }: { pizarron: Pizarron }) {
  const { t, idioma } = useIdioma();
  if (p.editable) return null;
  const fecha = fechaDeCierre(p.cerrado_en, idioma);
  const texto = p.estado === 'abierto'
    ? t('Tu cuenta está suspendida. Puedes leer las notas, pero no escribir.')
    : fecha
      ? t('El viaje se cerró el {0}. Las notas quedan para leer; ya nadie puede editarlas.', fecha)
      : t('El viaje se cerró. Las notas quedan para leer; ya nadie puede editarlas.');
  return (
    <p className="nts-candado" role="note">
      <Icon name="lock" size={20} className="nts-candado-icono" />
      <span>{texto}</span>
    </p>
  );
}

function PizarronDePocos({ pizarron: p, ...props }: PizarronVistaProps & { pizarron: Pizarron }) {
  const { t } = useIdioma();
  const mio = p.apartados.find((a) => a.es_yo) ?? null;
  const otros = p.apartados.filter((a) => !a.es_yo);
  // 2h · cerrado, los que no escribieron van juntos en una línea; abierto, cada uno con su tarjeta.
  const juntarVacios = p.estado !== 'abierto';
  const vacios = juntarVacios ? otros.filter((a) => a.entradas.length === 0) : [];
  return (
    <>
      {mio && <ApartadoMio apartado={mio} pizarron={p} {...props} />}
      {otros.filter((a) => !juntarVacios || a.entradas.length > 0).map((a) => (
        <section key={a.miembro_id} className="nts-apartado" aria-label={t('Apartado de {0}', nombreCompleto(a, t))}>
          <CabeceraDeOtro apartado={a} foto={props.fotoDe(a.miembro_id)} />
          {a.entradas.length > 0 && (
            <div className="nts-entradas">
              {a.entradas.map((e) => (
                <EntradaVista key={e.id} entrada={e} mia={false} editable={false} recortar tildando={props.tildando}
                  onVerTodo={() => props.onAbrirApartado(a)} />
              ))}
            </div>
          )}
        </section>
      ))}
      {vacios.length > 0 && (
        <div className="nts-apartado nts-sin-notas">
          <AvataresSuperpuestos apartados={vacios} fotoDe={props.fotoDe} />
          <span className="nts-sin-notas-texto">
            {vacios.length === 1
              ? t('{0} no dejó notas', nombresEnUnaLinea(vacios, t))
              : t('{0} no dejaron notas', nombresEnUnaLinea(vacios, t))}
          </span>
        </div>
      )}
    </>
  );
}

/** PANTALLA §4 · 6 o más: mi apartado, «Con notas» (el último que escribió primero) y «Sin notas todavía», juntos. */
function PizarronDeMuchos({ pizarron: p, ...props }: PizarronVistaProps & { pizarron: Pizarron }) {
  const { t } = useIdioma();
  const { mio, conNotas, sinNotas } = vistaDeMuchos(p.apartados);
  return (
    <>
      {mio && <ApartadoMio apartado={mio} pizarron={p} {...props} />}
      {conNotas.length > 0 && (
        <>
          <h2 className="vj-seccion">{t('Con notas · {0}', conNotas.length)}</h2>
          <ul className="nts-apartado nts-filas">
            {conNotas.map((a) => (
              <li key={a.miembro_id}>
                <button type="button" className="nts-fila-persona" onClick={() => props.onAbrirApartado(a)}>
                  <AvatarDeNotas apartado={a} foto={props.fotoDe(a.miembro_id)} />
                  <span className="nts-quien">
                    <span className="nts-nombre">{nombreCompleto(a, t)}</span>
                    <span className="nts-resumen">{resumenDeEntradas(a.entradas, t)}</span>
                  </span>
                  <Icon name="chevron-right" size={18} className="nts-fila-chev" />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {sinNotas.length > 0 && (
        <>
          <h2 className="vj-seccion">{t('Sin notas todavía · {0}', sinNotas.length)}</h2>
          <div className="nts-apartado nts-sin-notas">
            <AvataresSuperpuestos apartados={sinNotas} fotoDe={props.fotoDe} />
            <span className="nts-sin-notas-texto">{nombresEnUnaLinea(sinNotas, t)}</span>
          </div>
        </>
      )}
    </>
  );
}

/** La tira de fotos fija arriba (PANTALLA §4): el mío primero, con aro; tocar a otro abre su apartado. */
function TiraDeFotos({ apartados, fotoDe, onAbrir }: {
  apartados: readonly Apartado[];
  fotoDe: (miembroId: string) => string | null;
  onAbrir: (a: Apartado) => void;
}) {
  const { t } = useIdioma();
  return (
    <nav className="nts-tira" aria-label={t('Personas del viaje')}>
      <ul className="nts-tira-lista">
        {apartados.map((a) => (
          <li key={a.miembro_id}>
            {a.es_yo ? (
              <a className="nts-tira-persona" href="#nts-mio" aria-label={t('Tu apartado')}>
                <AvatarDeNotas apartado={a} foto={fotoDe(a.miembro_id)} tamano="tira" />
                <span className="nts-tira-nombre">{t('Tú')}</span>
              </a>
            ) : (
              <button type="button" className="nts-tira-persona" onClick={() => onAbrir(a)}>
                <AvatarDeNotas apartado={a} foto={fotoDe(a.miembro_id)} tamano="tira" />
                <span className="nts-tira-nombre">{nombreDePila(a, t)}</span>
              </button>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}

function AvataresSuperpuestos({ apartados, fotoDe }: { apartados: readonly Apartado[]; fotoDe: (miembroId: string) => string | null }) {
  return (
    <span className="nts-superpuestos" aria-hidden="true">
      {apartados.slice(0, 5).map((a) => <AvatarDeNotas key={a.miembro_id} apartado={a} foto={fotoDe(a.miembro_id)} tamano="chico" />)}
    </span>
  );
}

function CabeceraDeOtro({ apartado: a, foto }: { apartado: Apartado; foto: string | null }) {
  const { t } = useIdioma();
  return (
    <div className="nts-cabecera">
      <AvatarDeNotas apartado={a} foto={foto} />
      <span className="nts-quien">
        <span className="nts-nombre">{nombreCompleto(a, t)}</span>
        <span className="nts-resumen">{resumenDeEntradas(a.entradas, t) ?? t('Todavía no anotó nada')}</span>
      </span>
    </div>
  );
}

// ─── Mi apartado ──────────────────────────────────────────────────────────

function ApartadoMio({ apartado: a, pizarron: p, fotoDe, tildando, onNueva, onMenu, onTildar }: PizarronVistaProps & {
  apartado: Apartado;
  pizarron: Pizarron;
}) {
  const { t } = useIdioma();
  const resumen = resumenDeEntradas(a.entradas, t);
  const enElTope = a.entradas.length >= p.limites.entradas_por_miembro;
  return (
    <section id="nts-mio" className="nts-apartado nts-apartado-mio" aria-label={t('Tu apartado')}>
      <div className="nts-mio-cabecera">
        <AvatarDeNotas apartado={a} foto={fotoDe(a.miembro_id)} />
        <span className="nts-quien">
          <span className="nts-nombre">{t('Tú')}</span>
          <span className="nts-resumen">{resumen ? t('Tu apartado · {0}', resumen) : t('Tu apartado')}</span>
        </span>
      </div>
      <div className="nts-mio-cuerpo">
        {a.entradas.length === 0 ? (
          p.editable ? (
            <div className="nts-vacio">
              <span className="nts-vacio-icono" aria-hidden="true"><Icon name="pencil" size={22} /></span>
              <p className="nts-vacio-titulo">{t('Todavía no anotaste nada')}</p>
              <p className="nts-vacio-ayuda">{t('Anota un plan o arma una lista. Todos los del viaje lo ven; sólo tú lo editas.')}</p>
              <div className="nts-vacio-botones">
                <button type="button" className="btn btn-navy nts-boton-48" onClick={() => onNueva('nota')}>{t('Escribir nota')}</button>
                <button type="button" className="btn nts-boton-borde nts-boton-48" onClick={() => onNueva('lista')}>{t('Armar lista')}</button>
              </div>
            </div>
          ) : (
            <p className="nts-mio-nada">{t('Todavía no anotaste nada')}</p>
          )
        ) : (
          <>
            <div className="nts-entradas">
              {a.entradas.map((e) => (
                <EntradaVista key={e.id} entrada={e} mia editable={p.editable} recortar={false} tildando={tildando}
                  onMenu={() => onMenu(e)} onTildar={onTildar} />
              ))}
            </div>
            {p.editable && (
              <>
                <div className="nts-mis-botones">
                  <button type="button" className="nts-mas" disabled={enElTope} aria-label={t('Nota nueva')} onClick={() => onNueva('nota')}>
                    <Icon name="plus" size={18} className="nts-mas-signo" />{t('Nota')}
                  </button>
                  <button type="button" className="nts-mas" disabled={enElTope} aria-label={t('Lista nueva')} onClick={() => onNueva('lista')}>
                    <Icon name="plus" size={18} className="nts-mas-signo" />{t('Lista')}
                  </button>
                </div>
                {enElTope && (
                  <p className="nts-tope">{t('Llegaste al tope de {0} notas y listas. Borra una para sumar otra.', p.limites.entradas_por_miembro)}</p>
                )}
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}

// ─── Una nota o una lista ─────────────────────────────────────────────────

function EntradaVista({ entrada: e, mia, editable, recortar, tildando, onMenu, onTildar, onVerTodo }: {
  entrada: EntradaDeNotas;
  mia: boolean;
  /** Mía y con el viaje abierto: menú ⋯ y tildes. */
  editable: boolean;
  /** En el pizarrón, la nota de otro: 4 líneas y «Ver todo». */
  recortar: boolean;
  tildando: ReadonlyMap<string, boolean>;
  onMenu?: () => void;
  onTildar?: (lista: ListaConTildes, itemId: string, tildado: boolean) => void;
  onVerTodo?: () => void;
}) {
  const { t } = useIdioma();
  const conControles = mia && editable;
  if (e.tipo === 'nota') {
    if (conControles) {
      return (
        <div className="nts-nota nts-nota-mia">
          <p className="nts-nota-texto">{e.texto}</p>
          <button type="button" className="nts-menu" aria-label={t('Editar o borrar la nota')} onClick={onMenu}>
            <Icon name="tres-puntos" size={20} />
          </button>
        </div>
      );
    }
    return (
      <div className={recortar ? 'nts-nota nts-nota-con-ver-todo' : 'nts-nota'}>
        {recortar ? <NotaRecortada texto={e.texto} onVerTodo={onVerTodo} /> : <p className="nts-nota-texto">{e.texto}</p>}
      </div>
    );
  }
  const items = e.items.map((i) => ({ ...i, tildado: tildando.get(i.id) ?? i.tildado }));
  return (
    <div className={conControles ? 'nts-lista nts-lista-mia' : 'nts-lista'}>
      <div className="nts-lista-cabecera">
        <span className="nts-lista-titulo">{e.titulo}</span>
        <span className="nts-lista-cuenta">{tildadosDeLista({ items }, t)}</span>
        {conControles && (
          <button type="button" className="nts-menu" aria-label={t('Editar o borrar la lista')} onClick={onMenu}>
            <Icon name="tres-puntos" size={20} />
          </button>
        )}
      </div>
      <ul className={conControles ? 'nts-items nts-items-mios' : 'nts-items'}>
        {items.map((i) => (
          <li key={i.id}>
            {conControles ? (
              <button type="button" role="checkbox" aria-checked={i.tildado} className="nts-item"
                onClick={() => onTildar?.(e, i.id, !i.tildado)}>
                <Casilla tildada={i.tildado} />
                <span className={i.tildado ? 'nts-item-texto nts-item-tildado' : 'nts-item-texto'}>{i.texto}</span>
              </button>
            ) : (
              <span className="nts-item">
                <Casilla tildada={i.tildado} />
                <span className={i.tildado ? 'nts-item-texto nts-item-tildado' : 'nts-item-texto'}>{i.texto}</span>
                <span className="vj-oculto">{i.tildado ? t('tildado') : t('sin tildar')}</span>
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** La casilla de 22 × 22: vacía con borde, o cian oscuro con el check blanco. */
function Casilla({ tildada }: { tildada: boolean }) {
  return (
    <span className={tildada ? 'nts-casilla nts-casilla-tildada' : 'nts-casilla'} aria-hidden="true">
      {tildada && <Icon name="check" size={14} />}
    </span>
  );
}

/** En el navegador mide antes de pintar; en el servidor (las pruebas), el efecto común. */
const useEfectoDeMedida = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** La nota de otro en el pizarrón: hasta 4 líneas y, si no entra, «Ver todo» (abre su apartado). */
function NotaRecortada({ texto, onVerTodo }: { texto: string; onVerTodo?: () => void }) {
  const { t } = useIdioma();
  const ref = useRef<HTMLParagraphElement | null>(null);
  const [corta, setCorta] = useState(false);
  useEfectoDeMedida(() => {
    const el = ref.current;
    if (!el) return;
    const medir = () => setCorta(el.scrollHeight > el.clientHeight + 1);
    medir();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, [texto]);
  return (
    <>
      <p ref={ref} className="nts-nota-texto nts-nota-recortada">{texto}</p>
      {corta && onVerTodo && (
        <button type="button" className="nts-ver-todo" onClick={onVerTodo}>
          {t('Ver todo')}
          <Icon name="chevron-right" size={16} />
        </button>
      )}
    </>
  );
}

// ─── El apartado de otro ──────────────────────────────────────────────────

export function ApartadoDeOtroVista({ pizarron: p, apartado: a, foto, onIr }: {
  pizarron: Pizarron;
  apartado: Apartado;
  foto: string | null;
  onIr: (a: Apartado) => void;
}) {
  const { t } = useIdioma();
  const k = p.apartados.findIndex((x) => x.miembro_id === a.miembro_id);
  const anterior = k > 0 ? p.apartados[k - 1]! : null;
  const siguiente = k >= 0 && k < p.apartados.length - 1 ? p.apartados[k + 1]! : null;
  const nombre = (x: Apartado) => (x.es_yo ? t('Tú') : nombreDePila(x, t));
  return (
    <>
      <div className="title-card">
        <FilaDeTitulo cuadro={<span className="nts-cuadro-persona" aria-hidden="true">{foto ? <img src={foto} alt="" /> : iniciales(a)}</span>}>
          <h1 className="title-card-title">{nombreCompleto(a, t)}</h1>
          <div className="title-card-sub">{t('Notas · {0}', p.nombre)}</div>
        </FilaDeTitulo>
      </div>
      <div className="scroll vj-scroll nts-scroll">
        <section className="nts-apartado" aria-label={t('Apartado de {0}', nombreCompleto(a, t))}>
          {a.entradas.length === 0 ? (
            <p className="nts-mio-nada">{t('Todavía no anotó nada')}</p>
          ) : (
            <div className="nts-entradas">
              {a.entradas.map((e) => (
                <EntradaVista key={e.id} entrada={e} mia={false} editable={false} recortar={false} tildando={new Map()} />
              ))}
            </div>
          )}
        </section>
        <p className="nts-solo">
          <Icon name="lock" size={16} />
          <span>{t('Sólo {0} puede escribir en su apartado.', nombreDePila(a, t))}</span>
        </p>
        <div className="nts-anterior-siguiente">
          {anterior ? (
            <button type="button" className="btn nts-boton-borde nts-boton-48" onClick={() => onIr(anterior)}>
              <Icon name="chevron-left" size={18} />
              {nombre(anterior)}
            </button>
          ) : <span />}
          {siguiente ? (
            <button type="button" className="btn nts-boton-borde nts-boton-48" onClick={() => onIr(siguiente)}>
              {nombre(siguiente)}
              <Icon name="chevron-right" size={18} />
            </button>
          ) : <span />}
        </div>
      </div>
    </>
  );
}

// ─── Sin pizarrón ─────────────────────────────────────────────────────────

function SinPizarron({ carga, onReintentar, onVerViajes }: {
  carga: Exclude<Carga, { tipo: 'listo' }>;
  onReintentar: () => void;
  onVerViajes: () => void;
}) {
  const { t } = useIdioma();
  if (carga.tipo === 'cargando') {
    return (
      <div aria-busy="true" aria-label={t('Cargando…')}>
        {[0, 1].map((i) => (
          <div key={i} className="vj-card sk">
            <span className="sk-line w55" />
            <span className="sk-line w40" />
          </div>
        ))}
      </div>
    );
  }
  if (carga.tipo === 'no_disponible') {
    return (
      <div className="state-error">
        <div className="state-error-row">
          <Icon name="info" size={22} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="state-error-title">{t('Este viaje ya no está disponible.')}</div>
          </div>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onVerViajes}>{t('Ver tus viajes')}</button>
      </div>
    );
  }
  return (
    <div className="state-error">
      <div className="state-error-row">
        <Icon name="x-circle" size={22} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="state-error-title">{t('No pudimos cargar las notas')}</div>
          <p className="state-error-body">{t('Revisa la conexión y prueba de nuevo.')}</p>
        </div>
      </div>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onReintentar}>{t('Reintentar')}</button>
    </div>
  );
}

// ─── Las hojas ────────────────────────────────────────────────────────────

/** La hoja desde abajo (PANTALLA §3): por portal, foco atrapado y Escape (`useHojaModal`); tocar el velo la cierra. */
function HojaDeNotas({ etiqueta, inicial, onCerrar, children }: {
  etiqueta: string;
  inicial: RefObject<HTMLElement | null>;
  onCerrar: () => void;
  children: ReactNode;
}) {
  const hoja = useRef<HTMLDivElement | null>(null);
  useHojaModal(hoja, inicial, onCerrar);
  return createPortal(
    <div className="sheet-overlay nts-velo" onClick={onCerrar}>
      <div ref={hoja} className="sheet nts-hoja" role="dialog" aria-modal="true" aria-label={etiqueta}
        onClick={(e) => e.stopPropagation()}>
        <span className="nts-hoja-agarradera" aria-hidden="true" />
        {children}
      </div>
    </div>,
    document.body,
  );
}

function BarraDeHoja({ titulo, puedeGuardar, enviando, onCancelar, onGuardar }: {
  titulo: string;
  puedeGuardar: boolean;
  enviando: boolean;
  onCancelar: () => void;
  onGuardar: () => void;
}) {
  const { t } = useIdioma();
  return (
    <div className="nts-hoja-barra">
      <button type="button" className="nts-hoja-cancelar" onClick={onCancelar}>{t('Cancelar')}</button>
      <h2 className="nts-hoja-titulo">{titulo}</h2>
      <button type="button" className="nts-hoja-guardar" disabled={!puedeGuardar || enviando} aria-busy={enviando}
        onClick={onGuardar}>
        {t('Guardar')}
      </button>
    </div>
  );
}

function ContadorVista({ contador }: { contador: Contador | null }) {
  if (!contador) return null;
  return (
    <span className={contador.cerca ? 'nts-contador nts-contador-cerca' : 'nts-contador'} aria-live="polite">
      {contador.texto}
    </span>
  );
}

/**
 * La clave de idempotencia de un alta: la MISMA mientras se reintente lo mismo (un doble toque o una respuesta que no
 * llegó: el dueño devuelve la misma entrada), una nueva si cambió lo escrito.
 */
function useClaveDeAlta() {
  const ref = useRef<{ clave: string; contenido: string } | null>(null);
  return {
    para(contenido: string): string {
      if (ref.current?.contenido !== contenido) ref.current = { clave: nuevaClaveDeNota(), contenido };
      return ref.current.clave;
    },
    olvidar() {
      ref.current = null;
    },
  };
}

export function HojaDeNota({ entrada, tope, onCancelar, onGuardar }: {
  entrada: NotaDeTexto | null;
  tope: number;
  onCancelar: () => void;
  onGuardar: (texto: string, clave: string) => Promise<ResultadoDeGuardar>;
}) {
  const { t } = useIdioma();
  const [texto, setTexto] = useState(entrada?.texto ?? '');
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const enviandoRef = useRef(false);
  const campo = useRef<HTMLTextAreaElement | null>(null);
  const clave = useClaveDeAlta();
  const titulo = entrada ? t('Editar nota') : t('Nota nueva');

  async function guardar() {
    if (enviandoRef.current || texto.trim().length === 0) return;
    enviandoRef.current = true;
    setEnviando(true);
    setMensaje(null);
    try {
      const r = await onGuardar(texto, clave.para(texto));
      if (!r.cerrar) {
        setMensaje(r.mensaje);
        if (r.nuevaClave) clave.olvidar();
      }
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
    }
  }

  return (
    <HojaDeNotas etiqueta={titulo} inicial={campo} onCerrar={onCancelar}>
      <BarraDeHoja titulo={titulo} puedeGuardar={texto.trim().length > 0} enviando={enviando} onCancelar={onCancelar}
        onGuardar={() => void guardar()} />
      <textarea
        ref={campo}
        className="nts-campo-nota"
        value={texto}
        maxLength={tope}
        placeholder={t('Escribe un plan, un horario, un dato…')}
        aria-label={t('Nota')}
        onChange={(e) => setTexto(e.target.value.slice(0, tope))}
      />
      <div className="nts-hoja-pie">
        <span className="nts-hoja-ayuda">{t('La ven todos los del viaje.')}</span>
        <ContadorVista contador={contadorDeTexto(largoDeNota(texto), tope, t, { siempre: true })} />
      </div>
      {mensaje && <p className="nts-hoja-mensaje" role="alert">{mensaje}</p>}
    </HojaDeNotas>
  );
}

interface ItemDelBorrador {
  /** Sólo para React. */
  readonly local: string;
  /** El id del dueño si el ítem ya existía (conserva su tilde). */
  readonly id?: string;
  readonly texto: string;
}

let siguienteLocal = 0;
const local = () => `i${++siguienteLocal}`;

export function HojaDeLista({ entrada, limites, onCancelar, onGuardar }: {
  entrada: ListaConTildes | null;
  limites: Pizarron['limites'];
  onCancelar: () => void;
  onGuardar: (titulo: string, items: ReadonlyArray<{ id?: string; texto: string }>, clave: string) => Promise<ResultadoDeGuardar>;
}) {
  const { t } = useIdioma();
  const [titulo, setTitulo] = useState(entrada?.titulo ?? '');
  const [items, setItems] = useState<readonly ItemDelBorrador[]>(
    () => entrada?.items.map((i) => ({ local: local(), id: i.id, texto: i.texto })) ?? [],
  );
  const [nuevo, setNuevo] = useState('');
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const enviandoRef = useRef(false);
  const campoTitulo = useRef<HTMLInputElement | null>(null);
  const campoNuevo = useRef<HTMLInputElement | null>(null);
  const clave = useClaveDeAlta();
  const tituloDeLaHoja = entrada ? t('Editar lista') : t('Lista nueva');
  const tope = limites.items_por_lista;
  const llena = items.length >= tope;

  /** Lo que se guarda: sin los ítems vacíos y, si quedó algo escrito en «Agregar ítem», también eso. */
  const paraGuardar = () => {
    const lleno = items.filter((i) => i.texto.trim().length > 0).map((i) => (i.id ? { id: i.id, texto: i.texto } : { texto: i.texto }));
    if (nuevo.trim().length > 0 && lleno.length < tope) lleno.push({ texto: nuevo });
    return lleno;
  };
  const puedeGuardar = titulo.trim().length > 0 && paraGuardar().length > 0;

  function agregar() {
    if (nuevo.trim().length === 0 || llena) return;
    setItems((xs) => [...xs, { local: local(), texto: nuevo }]);
    setNuevo('');
    campoNuevo.current?.focus();
  }

  async function guardar() {
    const lista = paraGuardar();
    if (enviandoRef.current || titulo.trim().length === 0 || lista.length === 0) return;
    enviandoRef.current = true;
    setEnviando(true);
    setMensaje(null);
    try {
      const r = await onGuardar(titulo, lista, clave.para(JSON.stringify([titulo, lista])));
      if (!r.cerrar) {
        setMensaje(r.mensaje);
        if (r.nuevaClave) clave.olvidar();
      }
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
    }
  }

  return (
    <HojaDeNotas etiqueta={tituloDeLaHoja} inicial={campoTitulo} onCerrar={onCancelar}>
      <BarraDeHoja titulo={tituloDeLaHoja} puedeGuardar={puedeGuardar} enviando={enviando} onCancelar={onCancelar}
        onGuardar={() => void guardar()} />
      <input
        ref={campoTitulo}
        className="nts-campo nts-campo-titulo"
        value={titulo}
        maxLength={limites.caracteres_titulo}
        placeholder={t('Título de la lista')}
        aria-label={t('Título de la lista')}
        onChange={(e) => setTitulo(e.target.value.slice(0, limites.caracteres_titulo))}
      />
      <ContadorVista contador={contadorDeTexto(largoDeNota(titulo), limites.caracteres_titulo, t, { siempre: false })} />
      <div className="nts-hoja-caja">
      <ul className="nts-hoja-items" hidden={items.length === 0}>
        {items.map((i, k) => (
          <li key={i.local} className="nts-hoja-item">
            <span className="nts-casilla" aria-hidden="true" />
            <input
              className="nts-campo"
              value={i.texto}
              maxLength={limites.caracteres_item}
              aria-label={t('Ítem {0}', k + 1)}
              onChange={(e) => {
                const texto = e.target.value.slice(0, limites.caracteres_item);
                setItems((xs) => xs.map((x) => (x.local === i.local ? { ...x, texto } : x)));
              }}
            />
            <button type="button" className="nts-quitar" aria-label={t('Quitar {0}', i.texto || t('ítem {0}', k + 1))}
              onClick={() => setItems((xs) => xs.filter((x) => x.local !== i.local))}>
              <Icon name="x" size={18} />
            </button>
          </li>
        ))}
      </ul>
      <div className="nts-hoja-agregar">
        <Icon name="plus" size={22} className="nts-hoja-agregar-signo" />
        <input
          ref={campoNuevo}
          className="nts-campo"
          value={nuevo}
          maxLength={limites.caracteres_item}
          disabled={llena}
          placeholder={t('Agregar ítem')}
          aria-label={t('Agregar ítem')}
          enterKeyHint="done"
          onChange={(e) => setNuevo(e.target.value.slice(0, limites.caracteres_item))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              agregar();
            }
          }}
        />
        <button type="button" className="nts-agregar" disabled={llena || nuevo.trim().length === 0} onClick={agregar}>
          {t('Agregar')}
        </button>
      </div>
      </div>
      <ContadorVista contador={contadorDeTexto(largoDeNota(nuevo), limites.caracteres_item, t, { siempre: false })} />
      <div className="nts-hoja-pie">
        <span className="nts-hoja-ayuda">{t('Las tildas después, en tu apartado.')}</span>
        <ContadorVista contador={contadorDeItems(items.length, tope, t)} />
      </div>
      {mensaje && <p className="nts-hoja-mensaje" role="alert">{mensaje}</p>}
    </HojaDeNotas>
  );
}

function HojaDeMenu({ entrada, onEditar, onBorrar, onCancelar }: {
  entrada: EntradaDeNotas;
  onEditar: () => void;
  onBorrar: () => void;
  onCancelar: () => void;
}) {
  const { t } = useIdioma();
  const primero = useRef<HTMLButtonElement | null>(null);
  const etiqueta = entrada.tipo === 'nota' ? t('Tu nota') : entrada.titulo;
  return (
    <HojaDeNotas etiqueta={etiqueta} inicial={primero} onCerrar={onCancelar}>
      <h2 className="nts-menu-titulo">{etiqueta}</h2>
      <div className="nts-menu-acciones">
        <button ref={primero} type="button" className="btn nts-boton-borde nts-boton-48" onClick={onEditar}>
          <Icon name="pencil" size={20} />
          {entrada.tipo === 'nota' ? t('Editar nota') : t('Editar lista')}
        </button>
        <button type="button" className="btn nts-boton-borrar nts-boton-48" onClick={onBorrar}>
          <Icon name="trash" size={20} />
          {entrada.tipo === 'nota' ? t('Borrar nota') : t('Borrar lista')}
        </button>
        <button type="button" className="nts-hoja-cancelar nts-menu-cancelar" onClick={onCancelar}>{t('Cancelar')}</button>
      </div>
    </HojaDeNotas>
  );
}
