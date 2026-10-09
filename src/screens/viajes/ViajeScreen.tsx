import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../api';
import {
  errorDeViaje,
  type AccionTransferencia,
  type DetalleViaje,
  type MiembroViaje,
  type PersonaViaje,
  type TransferenciaViaje,
  type VistaPreviaCierre,
} from '../../api/viajes';
import { FotosDeMiembrosDeViaje } from '../../api/fotosDeMiembrosDeViaje';
import { useAuth } from '../../auth/AuthContext';
import { AppBottomBar } from '../../components/AppBottomBar';
import { AppHeaderBack } from '../../components/AppHeader';
import { Icon } from '../../components/Icon';
import { useToast } from '../../components/ui';
import { useHojaModal } from '../../components/useHojaModal';
import { useIdioma } from '../../i18n/idioma';
import { goBack, navigate, replaceRoute } from '../../router';
import { formatMXN } from '../../utils/format';
import { fullName } from '../../utils/identity';
import {
  avisosDeCierre,
  estadoDeTransferencia,
  miembroPorId,
  nombreCompletoDeId,
  nombreDePilaDeId,
  partirPlantilla,
  progresoDePagos,
  textoNoPuedeSalir,
  textoTransferenciasPendientes,
  tramosDeTransferencias,
  vistaDePagos,
  type PorQueNoPuedeSalir,
} from './viajeView';
import {
  iniciales,
  nombreDeMiembro,
  parametroDeTicket,
  type T,
} from './viajesView';
import { pedirInicioEnViajes } from './inicioEnViajes';
import { circuloDelViaje, recordarNombreDeViaje } from './circuloDelViaje';
import './viajes.css';
import './viaje.css';

/**
 * AF-VIAJES · D242 · el viaje (`/viaje/<id>`): abierto (1g) con su hoja de
 * cierre (1m) y la de salida (1q); esperando pagos con las transferencias
 * sugeridas (1n), lo que me transfieren (1o) o cuántas faltan (1p).
 *
 * PayMe no mueve dinero: muestra lo que calcula el dueño y cada uno marca su
 * transferencia. El front no suma balances ni arma transferencias. Cerrado, el
 * viaje vive en `/viaje-cerrado/<id>`.
 *
 * Dos piezas: `ViajeScreen` (red y estado) y las vistas puras de abajo, que se
 * prueban con `renderToStaticMarkup`.
 */

export type CargaDeViaje =
  | { readonly tipo: 'cargando' }
  | { readonly tipo: 'error' }
  | { readonly tipo: 'no_disponible' }
  | { readonly tipo: 'listo'; readonly viaje: DetalleViaje };

/**
 * El viaje del dueño, con su 404 uniforme. Cerrado no se muestra acá: se
 * reemplaza la ruta por el detalle de Cerrados. `refrescar` vuelve a pedirlo
 * sin borrar lo que se ve (si falla, queda lo de antes).
 */
export function useDetalleViaje(viajeId: string): {
  readonly carga: CargaDeViaje;
  readonly mostrar: (v: DetalleViaje) => void;
  readonly cargar: () => void;
  readonly refrescar: () => Promise<void>;
  readonly noDisponible: () => void;
} {
  const [carga, setCarga] = useState<CargaDeViaje>({ tipo: 'cargando' });
  const vivo = useRef(true);
  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
    };
  }, []);

  const mostrar = useCallback((v: DetalleViaje) => {
    if (!vivo.current) return;
    if (v.estado === 'cerrado') {
      replaceRoute('viaje-cerrado', viajeId);
      return;
    }
    // D250 · el escaneo de este viaje lo titula sin esperar la red.
    recordarNombreDeViaje(v.id, v.nombre);
    setCarga({ tipo: 'listo', viaje: v });
  }, [viajeId]);

  const pedir = useCallback(async (silencioso: boolean) => {
    try {
      mostrar(await api.getViaje(viajeId));
    } catch (err) {
      if (!vivo.current) return;
      if (errorDeViaje(err).tipo === 'no_disponible') setCarga({ tipo: 'no_disponible' });
      else if (!silencioso) setCarga({ tipo: 'error' });
    }
  }, [mostrar, viajeId]);

  const cargar = useCallback(() => {
    setCarga({ tipo: 'cargando' });
    void pedir(false);
  }, [pedir]);

  const refrescar = useCallback(() => pedir(true), [pedir]);
  const noDisponible = useCallback(() => setCarga({ tipo: 'no_disponible' }), []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  return { carga, mostrar, cargar, refrescar, noDisponible };
}

/**
 * D245 · las fotos de los miembros (App Backend 2.172.0): una
 * `FotosDeMiembrosDeViaje` por viaje, que pide sólo con `has_avatar` y una vez
 * por miembro. Devuelve la URL en memoria de cada uno, o `null` (iniciales).
 * La sesión se lee por ref para no recrear —y re-pedir— en cada render.
 */
export function useFotosDeMiembros(
  viajeId: string,
  miembros: readonly MiembroViaje[] | null,
): (miembroId: string) => string | null {
  const { session } = useAuth();
  const sesionRef = useRef(session);
  sesionRef.current = session;
  const fotosRef = useRef<FotosDeMiembrosDeViaje | null>(null);
  const [, setVersion] = useState(0);
  useEffect(() => {
    const fotos = new FotosDeMiembrosDeViaje(
      viajeId,
      () => sesionRef.current,
      async (miembroId, s) => (await api.getAvatarDeMiembroDeViaje(viajeId, miembroId, s)).blob,
      () => setVersion((n) => n + 1),
    );
    fotosRef.current = fotos;
    return () => {
      fotos.dispose();
      if (fotosRef.current === fotos) fotosRef.current = null;
    };
  }, [viajeId]);
  useEffect(() => {
    if (miembros) fotosRef.current?.cargar(miembros);
  }, [miembros]);
  return (miembroId) => fotosRef.current?.url(miembroId) ?? null;
}

type Hoja =
  | { readonly tipo: 'cerrar'; readonly preview: VistaPreviaCierre | null; readonly fallo: boolean }
  | { readonly tipo: 'salir' }
  | { readonly tipo: 'no_puede_salir'; readonly razon: PorQueNoPuedeSalir };

export function ViajeScreen({ viajeId }: { viajeId: string }) {
  const { t } = useIdioma();
  const { session } = useAuth();
  const toast = useToast();
  const { carga, mostrar, cargar, refrescar, noDisponible } = useDetalleViaje(viajeId);
  const [hoja, setHoja] = useState<Hoja | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [marcando, setMarcando] = useState<string | null>(null);
  const inicial = useRef<HTMLButtonElement | null>(null);

  const viaje = carga.tipo === 'listo' ? carga.viaje : null;
  const fotoDe = useFotosDeMiembros(viajeId, viaje?.miembros ?? null);
  const nombre = viaje?.nombre ?? '';

  /** Otro miembro lo cerró mientras mirabas: se avisa y se vuelve a pedir. */
  const yaSeCerro = useCallback(() => {
    setHoja(null);
    toast(t('Este viaje ya se cerró.'));
    void refrescar();
  }, [refrescar, t, toast]);

  const pedirCierre = useCallback(() => {
    setHoja({ tipo: 'cerrar', preview: null, fallo: false });
    api.getCierreDeViaje(viajeId)
      .then((preview) => setHoja((h) => (h?.tipo === 'cerrar' ? { ...h, preview, fallo: false } : h)))
      .catch((err: unknown) => {
        const e = errorDeViaje(err);
        if (e.tipo === 'no_abierto') yaSeCerro();
        else if (e.tipo === 'no_disponible') {
          setHoja(null);
          noDisponible();
        } else setHoja((h) => (h?.tipo === 'cerrar' ? { ...h, fallo: true } : h));
      });
  }, [noDisponible, viajeId, yaSeCerro]);

  async function confirmarCierre() {
    if (enviando) return;
    setEnviando(true);
    try {
      const v = await api.cerrarViaje(viajeId);
      setHoja(null);
      mostrar(v);
    } catch (err) {
      const e = errorDeViaje(err);
      if (e.tipo === 'no_abierto') yaSeCerro();
      else if (e.tipo === 'no_disponible') {
        setHoja(null);
        noDisponible();
      } else toast(t('No pudimos guardarlo. Prueba de nuevo.'));
    } finally {
      setEnviando(false);
    }
  }

  async function confirmarSalida() {
    if (enviando) return;
    setEnviando(true);
    try {
      await api.salirDeViaje(viajeId);
      setHoja(null);
      toast(t('Saliste de {0}.', nombre));
      // H02 · a Inicio › Viajes: el viaje ya no está.
      pedirInicioEnViajes();
      navigate('home');
    } catch (err) {
      const e = errorDeViaje(err);
      if (e.tipo === 'no_puede_salir') setHoja({ tipo: 'no_puede_salir', razon: { tipo: 'motivo', motivo: e.motivo } });
      else if (e.tipo === 'transferencias_pendientes') {
        setHoja({ tipo: 'no_puede_salir', razon: { tipo: 'pendientes', pendientes: e.pendientes } });
      } else if (e.tipo === 'no_abierto') yaSeCerro();
      else if (e.tipo === 'no_disponible') {
        setHoja(null);
        noDisponible();
      } else toast(t('No pudimos guardarlo. Prueba de nuevo.'));
    } finally {
      setEnviando(false);
    }
  }

  async function marcar(transferenciaId: string, accion: AccionTransferencia) {
    if (marcando) return;
    setMarcando(transferenciaId);
    try {
      const r = await api.marcarTransferenciaDeViaje(viajeId, transferenciaId, accion);
      if (r.viaje_estado === 'cerrado') {
        toast(t('{0} quedó cerrado. Todos pagaron y ya está en Cerrados.', nombre));
        replaceRoute('viaje-cerrado', viajeId);
        return;
      }
      await refrescar();
    } catch (err) {
      const e = errorDeViaje(err);
      if (e.tipo === 'no_disponible') noDisponible();
      else {
        // `no_abierto`: ya no espera pagos (quedó cerrado); el refresco lleva a Cerrados.
        if (e.tipo !== 'no_abierto') toast(t('No pudimos guardarlo. Prueba de nuevo.'));
        await refrescar();
      }
    } finally {
      setMarcando(null);
    }
  }

  const cerrarHoja = () => {
    if (!enviando) setHoja(null);
  };

  return (
    <div className="screen has-appbar">
      <AppHeaderBack userName={fullName(session) ?? undefined} onBack={() => goBack('viajes', 'abiertos')} />
      <ViajeVista
        carga={carga}
        marcando={marcando}
        onReintentar={cargar}
        onVerViajes={() => navigate('viajes', 'abiertos')}
        onVerBalance={() => navigate('viaje-balance', viajeId)}
        onAbrirTicket={(ticketId) => navigate('viaje-ticket', parametroDeTicket(viajeId, ticketId))}
        onCargaManual={() => navigate('viaje-gasto', viajeId)}
        fotoDe={fotoDe}
        onCerrar={pedirCierre}
        onSalir={() => setHoja({ tipo: 'salir' })}
        onMarcar={(id, accion) => void marcar(id, accion)}
      />
      {/* D250 · el círculo de la cámara escanea para este viaje mientras está abierto. */}
      <AppBottomBar active={null} center={circuloDelViaje(viaje, t)} />

      {viaje && hoja?.tipo === 'cerrar' && (
        <HojaModal key="cerrar" etiqueta={t('¿Cerrar {0}?', nombre)} inicial={inicial} onCerrar={cerrarHoja}>
          <HojaCerrarVista
            viaje={viaje}
            preview={hoja.preview}
            fallo={hoja.fallo}
            enviando={enviando}
            inicial={inicial}
            onConfirmar={() => void confirmarCierre()}
            onRevisar={cerrarHoja}
            onReintentar={pedirCierre}
          />
        </HojaModal>
      )}
      {viaje && hoja?.tipo === 'salir' && (
        <HojaModal key="salir" etiqueta={t('¿Salir de {0}?', nombre)} inicial={inicial} onCerrar={cerrarHoja}>
          <HojaSalirVista
            nombre={nombre}
            enviando={enviando}
            inicial={inicial}
            onConfirmar={() => void confirmarSalida()}
            onCancelar={cerrarHoja}
          />
        </HojaModal>
      )}
      {viaje && hoja?.tipo === 'no_puede_salir' && (
        <HojaModal key="no_puede_salir" etiqueta={t('Todavía no puedes salir de {0}', nombre)} inicial={inicial} onCerrar={cerrarHoja}>
          <HojaNoPuedeSalirVista viaje={viaje} razon={hoja.razon} inicial={inicial} onEntendido={cerrarHoja} />
        </HojaModal>
      )}
    </div>
  );
}

/** La hoja inferior: por portal, con foco atrapado y Escape (`useHojaModal`); tocar afuera la cierra. */
export function HojaModal({
  etiqueta,
  inicial,
  onCerrar,
  children,
}: {
  etiqueta: string;
  inicial: RefObject<HTMLButtonElement | null>;
  onCerrar: () => void;
  children: ReactNode;
}) {
  const hoja = useRef<HTMLDivElement | null>(null);
  useHojaModal(hoja, inicial, onCerrar);
  return createPortal(
    <div className="sheet-overlay" onClick={onCerrar}>
      <div
        ref={hoja}
        className="sheet vjv-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={etiqueta}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

// ─── Vistas puras ─────────────────────────────────────────────────────────

/** El avatar con iniciales (sin foto). */
/** Las iniciales, o la foto (D245) cuando el dueño dice que hay y ya llegó. */
export function AvatarDeViaje({ persona, foto = null }: { persona: PersonaViaje | null; foto?: string | null }) {
  return (
    <span className="vj-avatar" aria-hidden="true">
      {foto ? <img className="vj-avatar-foto" src={foto} alt="" /> : persona ? iniciales(persona) : ''}
    </span>
  );
}

/** «PayMe no mueve dinero…»: va siempre que se habla de transferencias. */
export function NotaNoMueveDinero() {
  const { t } = useIdioma();
  return (
    <p className="vj-nota vjv-nota-sola">
      <Icon name="info" size={18} />
      <span>{t('PayMe no mueve dinero. Cada uno transfiere desde su banco y lo marca aquí.')}</span>
    </p>
  );
}

/** Los estados sin viaje: cargando, sin red y el 404 uniforme. */
export function EstadoSinViaje({
  carga,
  onReintentar,
  onVerViajes,
}: {
  carga: Exclude<CargaDeViaje, { tipo: 'listo' }>;
  onReintentar: () => void;
  onVerViajes: () => void;
}) {
  const { t } = useIdioma();
  if (carga.tipo === 'cargando') {
    return (
      <div aria-busy="true" aria-label={t('Cargando…')}>
        {[0, 1, 2].map((i) => (
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
        <button type="button" className="btn btn-ghost btn-sm" onClick={onVerViajes}>
          {t('Ver tus viajes')}
        </button>
      </div>
    );
  }
  return (
    <div className="state-error">
      <div className="state-error-row">
        <Icon name="x-circle" size={22} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="state-error-title">{t('No pudimos cargar el viaje')}</div>
          <p className="state-error-body">{t('Revisa la conexión y prueba de nuevo.')}</p>
        </div>
      </div>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onReintentar}>
        {t('Reintentar')}
      </button>
    </div>
  );
}

/** Plantilla traducida con algunas partes en negrita (el monto, quién transfiere). */
function Frase({ plantilla, partes }: { plantilla: string; partes: readonly ReactNode[] }) {
  const nodos = partirPlantilla(plantilla).map((p, i) => {
    const contenido = 'texto' in p ? p.texto : partes[p.indice];
    return <span key={i}>{contenido}</span>;
  });
  return <>{nodos}</>;
}

export interface ViajeVistaProps {
  readonly carga: CargaDeViaje;
  readonly marcando: string | null;
  readonly onReintentar: () => void;
  readonly onVerViajes: () => void;
  readonly onVerBalance: () => void;
  /** D244/D245 · «Carga manual»: la pantalla del gasto a mano. */
  readonly onCargaManual: () => void;
  /** D245 · la foto de un miembro, si la hay (si no, iniciales). */
  readonly fotoDe?: (miembroId: string) => string | null;
  readonly onAbrirTicket: (ticketId: string) => void;
  readonly onCerrar: () => void;
  readonly onSalir: () => void;
  readonly onMarcar: (transferenciaId: string, accion: AccionTransferencia) => void;
}

export function ViajeVista(props: ViajeVistaProps) {
  const { t } = useIdioma();
  const { carga } = props;
  if (carga.tipo !== 'listo') {
    return (
      <>
        <div className="title-card">
          <h1 className="title-card-title">{t('Viajes')}</h1>
        </div>
        <div className="scroll vj-scroll">
          <EstadoSinViaje carga={carga} onReintentar={props.onReintentar} onVerViajes={props.onVerViajes} />
        </div>
      </>
    );
  }
  const v = carga.viaje;
  return (
    <>
      <TarjetaDeTitulo viaje={v} />
      {/* La clave por estado: al cerrarse el viaje la pantalla es otra y
          arranca arriba, no donde estaba el botón «Cerrar viaje». */}
      <div key={v.estado} className="scroll vj-scroll">
        {v.estado === 'abierto' ? <ViajeAbierto viaje={v} {...props} /> : <EsperandoPagos viaje={v} {...props} />}
      </div>
    </>
  );
}

function TarjetaDeTitulo({ viaje: v }: { viaje: DetalleViaje }) {
  const { t } = useIdioma();
  if (v.estado !== 'abierto') {
    const conChip = vistaDePagos(v.transferencias) !== 'resto';
    return (
      <div className="title-card">
        <h1 className="title-card-title">{v.nombre}</h1>
        <div className="title-card-sub">{t('Gasto del grupo {0}', formatMXN(v.gasto_del_grupo_cents))}</div>
        {conChip && (
          <span className="vjv-chip vjv-chip-info vjv-titulo-chip">{t('Esperando pagos · faltan {0}', v.transferencias_pendientes)}</span>
        )}
      </div>
    );
  }
  // D245-2 · la burbuja dice sólo el nombre del viaje: sin fechas ni avatares.
  return (
    <div className="title-card">
      <h1 className="title-card-title">{v.nombre}</h1>
    </div>
  );
}

/**
 * D245 · la pantalla del viaje abierto, más simple (pedido de Mati, 6 puntos):
 * el balance como monto enseguida de la burbuja (verde a favor, rojo con «−» la
 * deuda, «$0» en negro), el desplegable «Miembros», «Escanear ticket» y «Carga
 * manual» lado a lado y «Ver balance del viaje». Los tickets pasan a Balance ›
 * Consumos. «Cerrar viaje» y «Salir del viaje» siguen al pie.
 */
function ViajeAbierto({ viaje: v, onVerBalance, onCargaManual, fotoDe, onCerrar, onSalir }: ViajeVistaProps & { viaje: DetalleViaje }) {
  const { t } = useIdioma();
  return (
    <>
      <MontoDeBalance cents={v.mi_balance_cents} />
      <DesplegableMiembros miembros={v.miembros} fotoDe={fotoDe} />
      {/* D250 · escanear es el círculo de la cámara de la barra; «Carga manual» queda sola, a todo el ancho. */}
      <div className="vjv-acciones vjv-acciones-una">
        <button type="button" className="btn btn-navy" onClick={onCargaManual}>
          <Icon name="pencil" size={20} />
          {t('Carga manual')}
        </button>
      </div>
      <button type="button" className="vj-card vjv-ver-balance" onClick={onVerBalance}>
        <span>{t('Ver balance del viaje')}</span>
        <Icon name="chevron-down" size={18} className="vjv-chev" />
      </button>
      <button type="button" className="btn btn-ghost" onClick={onCerrar}>
        {t('Cerrar viaje')}
      </button>
      <button type="button" className="vjv-salir" onClick={onSalir}>
        {t('Salir del viaje')}
      </button>
    </>
  );
}

/**
 * D245-3 · el balance propio como monto: a favor en verde («$1,200»), deuda en
 * rojo con signo menos («−$542») y cero en negro («$0»). Sin «Debes», «Te deben»
 * ni «Estás a mano» a la vista; el color nunca va solo: el lector de pantalla
 * oye «a favor» o «debes».
 */
export function MontoDeBalance({ cents }: { cents: number }) {
  const { t } = useIdioma();
  const tono = cents > 0 ? 'a-favor' : cents < 0 ? 'deuda' : 'cero';
  const visible = cents < 0 ? `\u2212${formatMXN(-cents)}` : formatMXN(cents);
  const dicho = cents > 0 ? t('A favor: {0}', formatMXN(cents)) : cents < 0 ? t('Debes {0}', formatMXN(-cents)) : formatMXN(0);
  return (
    <p className={`vjv-monto vjv-monto-${tono}`}>
      <span aria-hidden="true">{visible}</span>
      <span className="vj-oculto">{dicho}</span>
    </p>
  );
}

/**
 * D245-4 · «Miembros», cerrado con su título; abierto, las personas del viaje,
 * con su foto si la tiene (`has_avatar`, App Backend 2.172.0; un menor nunca) y
 * si no, sus iniciales.
 */
export function DesplegableMiembros({ miembros, abiertoInicial = false, fotoDe }: {
  miembros: readonly MiembroViaje[];
  abiertoInicial?: boolean;
  fotoDe?: (miembroId: string) => string | null;
}) {
  const { t } = useIdioma();
  const [abierto, setAbierto] = useState(abiertoInicial);
  return (
    <section className="vj-card vjv-miembros">
      <button
        type="button"
        className="vjv-miembros-cabeza"
        aria-expanded={abierto}
        onClick={() => setAbierto((a) => !a)}
      >
        <span className="vjv-miembros-titulo">{t('Miembros')}</span>
        <span className="vjv-miembros-cuantos">{miembros.length}</span>
        <Icon name="chevron-down" size={18} className={`vjv-miembros-chev ${abierto ? 'abierto' : ''}`} />
      </button>
      {abierto && (
        <ul className="vjv-miembros-lista">
          {miembros.map((m) => (
            <li key={m.id} className="vjv-miembro">
              <AvatarDeViaje persona={m} foto={fotoDe?.(m.id) ?? null} />
              <span className="vjv-miembro-quien">
                <span className="vjv-miembro-nombre">{nombreDeMiembro(m, t)}</span>
                {m.username && <span className="vjv-miembro-arroba">@{m.username}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function EsperandoPagos({ viaje: v, marcando, onMarcar, onSalir }: ViajeVistaProps & { viaje: DetalleViaje }) {
  const { t } = useIdioma();
  const vista = vistaDePagos(v.transferencias);
  const mias = v.transferencias.filter((tr) => tr.mia === 'debo');
  const ajenas = v.transferencias.filter((tr) => tr.mia === null);
  const aMi = v.transferencias.filter((tr) => tr.mia === 'me_deben');
  const ocupado = marcando !== null;

  if (vista === 'resto') {
    const { faltan, total, partes } = progresoDePagos(v);
    return (
      <>
        <section className="vj-card">
          <div className="vjv-progreso-fila">
            <strong>{t('Faltan {0} de {1}', faltan, total)}</strong>
            <span>{t('transferencias')}</span>
          </div>
          <div className="vjv-partes" aria-hidden="true">
            {partes.map((llena, i) => <span key={i} className={llena ? 'vjv-parte vjv-parte-llena' : 'vjv-parte'} />)}
          </div>
        </section>
        {v.transferencias.length > 0 && (
          <ul className="vj-card vjv-lista">
            {v.transferencias.map((tr) => {
              const de = miembroPorId(v.miembros, tr.de);
              return (
                <li key={tr.id} className="vjv-lista-fila">
                  <AvatarDeViaje persona={de} />
                  <span className="vjv-lista-quien">
                    <strong>{de?.es_yo ? t('Tú') : nombreDePilaDeId(v.miembros, tr.de, t)}</strong>
                    {' → '}
                    {nombreDeId(v.miembros, tr.a, t)}
                  </span>
                  <span className="vjv-lista-der">
                    <strong>{formatMXN(tr.monto_cents)}</strong>
                    <ChipDeEstado tr={tr} />
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <p className="vjv-pie-texto">{t('Cuando todas estén pagadas, el viaje pasa a Cerrados.')}</p>
        <NotaNoMueveDinero />
        <BotonSalir onSalir={onSalir} />
      </>
    );
  }

  return (
    <>
      {vista === 'debo' && (
        <>
          <h2 className="vj-seccion">{t('Transferencias sugeridas · {0}', v.transferencias.length)}</h2>
          {mias.map((tr) => (
            <TransferenciaMia key={tr.id} tr={tr} miembros={v.miembros} ocupado={ocupado} enviando={marcando === tr.id} onMarcar={onMarcar} />
          ))}
          {ajenas.map((tr) => (
            <article key={tr.id} className="vjv-tr">
              <div className="vjv-tr-fila">
                <AvatarDeViaje persona={miembroPorId(v.miembros, tr.de)} />
                <p className="vjv-tr-frase">
                  <Frase
                    plantilla={t('{0} le transfiere {1} a {2}')}
                    partes={[
                      <strong key="de">{nombreCompletoDeId(v.miembros, tr.de, t)}</strong>,
                      <strong key="monto">{formatMXN(tr.monto_cents)}</strong>,
                      nombreCompletoDeId(v.miembros, tr.a, t),
                    ]}
                  />
                </p>
              </div>
              <ChipDeEstado tr={tr} />
            </article>
          ))}
        </>
      )}
      {aMi.length > 0 && (
        <>
          <h2 className="vj-seccion">{t('Te transfieren')}</h2>
          {tramosDeTransferencias(aMi).map((tramo) => (
            <article
              key={tramo.filas[0]?.id}
              className={tramo.destacada ? 'vjv-tr vjv-tr-destacada' : 'vjv-tr vjv-tr-blanca vjv-tr-grupo'}
            >
              {tramo.filas.map((tr) => (
                <TransferenciaAMi key={tr.id} tr={tr} miembros={v.miembros} ocupado={ocupado} enviando={marcando === tr.id} onMarcar={onMarcar} />
              ))}
            </article>
          ))}
        </>
      )}
      <NotaNoMueveDinero />
      <BotonSalir onSalir={onSalir} />
    </>
  );
}

/**
 * H02 · App Backend 2.172.1 · D242-2: también con el viaje en esperando pagos se
 * puede pedir salir; el dueño deja si las transferencias propias están
 * confirmadas y, si no, dice cuántas faltan (la hoja de 1q).
 */
export function BotonSalir({ onSalir }: { onSalir: () => void }) {
  const { t } = useIdioma();
  return (
    <button type="button" className="vjv-salir" onClick={onSalir}>
      {t('Salir del viaje')}
    </button>
  );
}

/** «Tú» para mí; si no, el nombre completo (o «Cuenta eliminada»). */
function nombreDeId(miembros: readonly MiembroViaje[], id: string | null, t: T): string {
  const m = miembroPorId(miembros, id);
  return m ? nombreDeMiembro(m, t) : t('Cuenta eliminada');
}

function ChipDeEstado({ tr }: { tr: TransferenciaViaje }) {
  const { t } = useIdioma();
  if (tr.estado === 'anulada_por_baja') return <p className="vjv-tr-anulada">{estadoDeTransferencia(tr, t)}</p>;
  if (tr.estado === 'pagada') {
    return (
      <span className="vjv-chip vjv-chip-ok">
        <Icon name="check" size={14} />
        {estadoDeTransferencia(tr, t)}
      </span>
    );
  }
  return <span className="vjv-chip">{estadoDeTransferencia(tr, t)}</span>;
}

interface FilaDeTransferencia {
  readonly tr: TransferenciaViaje;
  readonly miembros: readonly MiembroViaje[];
  readonly ocupado: boolean;
  readonly enviando: boolean;
  readonly onMarcar: (transferenciaId: string, accion: AccionTransferencia) => void;
}

/** 1n · la mía: «Tú le transfieres $542 a Luis Pérez» con «Ya pagué» / «Deshacer». */
function TransferenciaMia({ tr, miembros, ocupado, enviando, onMarcar }: FilaDeTransferencia) {
  const { t } = useIdioma();
  const yo = miembros.find((m) => m.es_yo) ?? null;
  return (
    <article className="vjv-tr vjv-tr-destacada" aria-busy={enviando || undefined}>
      <div className="vjv-tr-fila">
        <AvatarDeViaje persona={yo} />
        <p className="vjv-tr-frase">
          <Frase
            plantilla={t('Tú le transfieres {0} a {1}')}
            partes={[<strong key="monto">{formatMXN(tr.monto_cents)}</strong>, nombreCompletoDeId(miembros, tr.a, t)]}
          />
        </p>
      </div>
      {tr.estado === 'pendiente' && (
        <>
          <p className="vjv-tr-ayuda">{t('Hazla desde tu banco y márcala aquí.')}</p>
          <button type="button" className="btn btn-navy" disabled={ocupado} onClick={() => onMarcar(tr.id, 'pague')}>
            {t('Ya pagué')}
          </button>
        </>
      )}
      {tr.estado === 'marcada' && (
        <>
          <span className="vjv-chip vjv-chip-aviso">{t('Esperando que {0} confirme', nombreDePilaDeId(miembros, tr.a, t))}</span>
          <button type="button" className="btn btn-ghost" disabled={ocupado} onClick={() => onMarcar(tr.id, 'deshacer')}>
            {t('Deshacer')}
          </button>
        </>
      )}
      {(tr.estado === 'pagada' || tr.estado === 'anulada_por_baja') && <ChipDeEstado tr={tr} />}
    </article>
  );
}

/** 1o · una que me pagan: con «Recibí» (también desde pendiente, D242-1) y, si la marcaron, «No me llegó». */
function TransferenciaAMi({ tr, miembros, ocupado, enviando, onMarcar }: FilaDeTransferencia) {
  const { t } = useIdioma();
  const de = miembroPorId(miembros, tr.de);
  return (
    <div className="vjv-tr-item" aria-busy={enviando || undefined}>
      <div className="vjv-tr-persona">
        <AvatarDeViaje persona={de} />
        <div className="vjv-tr-quien">
          <div className="vjv-tr-nombre">{nombreCompletoDeId(miembros, tr.de, t)}</div>
          {de?.username && !de.eliminada && <div className="vjv-tr-arroba">@{de.username}</div>}
        </div>
        <div className="vjv-tr-monto">{formatMXN(tr.monto_cents)}</div>
      </div>
      {tr.estado === 'marcada' && (
        <>
          <p className="vj-nota vjv-nota-sola">
            <Icon name="info" size={18} />
            <span>{t('{0} marcó que te pagó. Revisa tu banco y confírmalo.', nombreDePilaDeId(miembros, tr.de, t))}</span>
          </p>
          <div className="vjv-tr-botones">
            <button type="button" className="btn btn-ghost" disabled={ocupado} onClick={() => onMarcar(tr.id, 'no-llego')}>
              {t('No me llegó')}
            </button>
            <button type="button" className="btn btn-navy" disabled={ocupado} onClick={() => onMarcar(tr.id, 'recibi')}>
              {t('Recibí')}
            </button>
          </div>
        </>
      )}
      {tr.estado === 'pendiente' && (
        <div className="vjv-tr-pie">
          <ChipDeEstado tr={tr} />
          <button type="button" className="btn btn-ghost btn-sm btn-fit" disabled={ocupado} onClick={() => onMarcar(tr.id, 'recibi')}>
            {t('Recibí')}
          </button>
        </div>
      )}
      {(tr.estado === 'pagada' || tr.estado === 'anulada_por_baja') && <ChipDeEstado tr={tr} />}
    </div>
  );
}

// ─── Las hojas ────────────────────────────────────────────────────────────

/** 1m · «¿Cerrar Cancún 2026?» con quién no eligió y cuánto se le asigna. */
export function HojaCerrarVista({
  viaje,
  preview,
  fallo,
  enviando,
  inicial,
  onConfirmar,
  onRevisar,
  onReintentar,
}: {
  viaje: DetalleViaje;
  preview: VistaPreviaCierre | null;
  fallo: boolean;
  enviando: boolean;
  inicial?: RefObject<HTMLButtonElement>;
  onConfirmar: () => void;
  onRevisar: () => void;
  onReintentar: () => void;
}) {
  const { t, idioma } = useIdioma();
  const avisos = preview ? avisosDeCierre(preview, viaje, t, idioma, formatMXN) : [];
  const todos = preview !== null && (preview.todos_eligieron || preview.asignaciones.length === 0);
  return (
    <div className="vjv-hoja">
      <span className="vjv-hoja-asa" aria-hidden="true" />
      <h2 className="vjv-hoja-titulo">{t('¿Cerrar {0}?', viaje.nombre)}</h2>
      <p className="vjv-hoja-texto">
        {t('Ya no se pueden cargar tickets. PayMe calcula lo que debe cada uno y sugiere quién le transfiere a quién.')}
      </p>
      {fallo ? (
        <div className="state-error">
          <div className="state-error-row">
            <Icon name="x-circle" size={22} />
            <p className="state-error-body">{t('Revisa la conexión y prueba de nuevo.')}</p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onReintentar}>
            {t('Reintentar')}
          </button>
        </div>
      ) : preview === null ? (
        <div aria-busy="true" aria-label={t('Cargando…')}>
          <span className="sk-line w100" />
          <span className="sk-line w70" />
        </div>
      ) : (
        avisos.map((a, i) => (
          <p key={i} className={todos ? 'vjv-hoja-aviso ok' : 'vjv-hoja-aviso'}>
            <Icon name={todos ? 'check-circle' : 'warning'} size={18} />
            <span>{a}</span>
          </p>
        ))
      )}
      <p className="vjv-hoja-pie">{t('Les avisamos a todos que cerraste el viaje.')}</p>
      <div className="vjv-hoja-botones">
        <button type="button" className="btn btn-navy" disabled={preview === null || enviando} onClick={onConfirmar}>
          {t('Cerrar viaje')}
        </button>
        <button ref={inicial} type="button" className="btn btn-ghost" disabled={enviando} onClick={onRevisar}>
          {t('Revisar tickets')}
        </button>
      </div>
    </div>
  );
}

/** «¿Salir de Cancún 2026?» antes de pedirlo. */
export function HojaSalirVista({
  nombre,
  enviando,
  inicial,
  onConfirmar,
  onCancelar,
}: {
  nombre: string;
  enviando: boolean;
  inicial?: RefObject<HTMLButtonElement>;
  onConfirmar: () => void;
  onCancelar: () => void;
}) {
  const { t } = useIdioma();
  return (
    <div className="vjv-hoja">
      <span className="vjv-hoja-asa" aria-hidden="true" />
      <h2 className="vjv-hoja-titulo">{t('¿Salir de {0}?', nombre)}</h2>
      <p className="vjv-hoja-texto">{t('Ya no vas a ver los tickets de este viaje.')}</p>
      <div className="vjv-hoja-botones">
        <button type="button" className="btn btn-navy" disabled={enviando} onClick={onConfirmar}>
          {t('Salir del viaje')}
        </button>
        <button ref={inicial} type="button" className="btn btn-ghost" disabled={enviando} onClick={onCancelar}>
          {t('Cancelar')}
        </button>
      </div>
    </div>
  );
}

/** 1q y H02 · el dueño no deja salir (409 con su motivo, o con cuántas transferencias faltan confirmar). */
export function HojaNoPuedeSalirVista({
  viaje,
  razon,
  inicial,
  onEntendido,
}: {
  viaje: { readonly nombre: string; readonly tickets?: DetalleViaje['tickets'] };
  razon: PorQueNoPuedeSalir;
  inicial?: RefObject<HTMLButtonElement>;
  onEntendido: () => void;
}) {
  const { t } = useIdioma();
  const texto = razon.tipo === 'pendientes'
    ? textoTransferenciasPendientes(razon.pendientes, t)
    : textoNoPuedeSalir(razon.motivo, viaje.tickets ?? [], t);
  return (
    <div className="vjv-hoja">
      <span className="vjv-hoja-asa" aria-hidden="true" />
      <span className="vjv-hoja-icono" aria-hidden="true">
        <Icon name="arrow-left" size={22} />
      </span>
      <h2 className="vjv-hoja-titulo">{t('Todavía no puedes salir de {0}', viaje.nombre)}</h2>
      <p className="vjv-hoja-texto">{texto}</p>
      <div className="vjv-hoja-botones">
        <button ref={inicial} type="button" className="btn btn-navy" onClick={onEntendido}>
          {t('Entendido')}
        </button>
      </div>
    </div>
  );
}
