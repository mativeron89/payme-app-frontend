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
import { useAuth } from '../../auth/AuthContext';
import { abrirCamaraNativa } from '../../camara/camaraNativa';
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
  metaDelTicket,
  miembroPorId,
  nombreCompletoDeId,
  nombreDePilaDeId,
  partirPlantilla,
  progresoDePagos,
  textoNoPuedeSalir,
  tramosDeTransferencias,
  vistaDePagos,
  type MotivoSalida,
} from './viajeView';
import {
  iconoTipoLugar,
  iniciales,
  listaDeNombres,
  nombreDelLugar,
  nombreDeMiembro,
  parametroDeTicket,
  rangoDeFechas,
  textoDeMiBalance,
  type T,
} from './viajesView';
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

type Hoja =
  | { readonly tipo: 'cerrar'; readonly preview: VistaPreviaCierre | null; readonly fallo: boolean }
  | { readonly tipo: 'salir' }
  | { readonly tipo: 'no_puede_salir'; readonly motivo: MotivoSalida };

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
      navigate('viajes', 'abiertos');
    } catch (err) {
      const e = errorDeViaje(err);
      if (e.tipo === 'no_puede_salir') setHoja({ tipo: 'no_puede_salir', motivo: e.motivo });
      else if (e.tipo === 'no_abierto') yaSeCerro();
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
        onEscanear={() => {
          abrirCamaraNativa();
          navigate('scan', viajeId);
        }}
        onAbrirTicket={(ticketId) => navigate('viaje-ticket', parametroDeTicket(viajeId, ticketId))}
        onCerrar={pedirCierre}
        onSalir={() => setHoja({ tipo: 'salir' })}
        onMarcar={(id, accion) => void marcar(id, accion)}
      />
      <AppBottomBar active={null} />

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
          <HojaNoPuedeSalirVista viaje={viaje} motivo={hoja.motivo} inicial={inicial} onEntendido={cerrarHoja} />
        </HojaModal>
      )}
    </div>
  );
}

/** La hoja inferior: por portal, con foco atrapado y Escape (`useHojaModal`); tocar afuera la cierra. */
function HojaModal({
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
export function AvatarDeViaje({ persona }: { persona: PersonaViaje | null }) {
  return (
    <span className="vj-avatar" aria-hidden="true">
      {persona ? iniciales(persona) : ''}
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

const MAX_AVATARES = 5;

export interface ViajeVistaProps {
  readonly carga: CargaDeViaje;
  readonly marcando: string | null;
  readonly onReintentar: () => void;
  readonly onVerViajes: () => void;
  readonly onVerBalance: () => void;
  readonly onEscanear: () => void;
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
  const { t, idioma } = useIdioma();
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
  const fechas = rangoDeFechas(v.fecha_desde, v.fecha_hasta, idioma);
  const visibles = v.miembros.slice(0, MAX_AVATARES);
  const resto = v.miembros.length - visibles.length;
  return (
    <div className="title-card">
      <h1 className="title-card-title">{v.nombre}</h1>
      {fechas && <div className="title-card-sub">{fechas}</div>}
      <div className="vjv-titulo-personas">
        <span className="vj-avatares" aria-hidden="true">
          {visibles.map((m) => <AvatarDeViaje key={m.id} persona={m} />)}
          {resto > 0 && <span className="vj-avatar">+{resto}</span>}
        </span>
        <span className="vjv-titulo-nombres">{listaDeNombres(v.miembros, t)}</span>
      </div>
    </div>
  );
}

function ViajeAbierto({ viaje: v, onVerBalance, onEscanear, onAbrirTicket, onCerrar, onSalir }: ViajeVistaProps & { viaje: DetalleViaje }) {
  const { t, idioma } = useIdioma();
  return (
    <>
      <section className="vj-card" aria-label={t('Tu balance')}>
        <div className="vjv-balance-rotulo">{t('Tu balance')}</div>
        <div className="vjv-balance-monto">{textoDeMiBalance(v.mi_balance_cents, t, formatMXN)}</div>
        <div className="vjv-balance-gasto">
          <span>{t('Gasto del grupo')}</span>
          <strong>{formatMXN(v.gasto_del_grupo_cents)}</strong>
        </div>
        <button type="button" className="vjv-enlace" onClick={onVerBalance}>
          {t('Ver balance del viaje')}
          <Icon name="chevron-down" size={18} className="vjv-chev" />
        </button>
      </section>

      <button type="button" className="btn btn-navy" onClick={onEscanear}>
        <Icon name="scan" size={20} />
        {t('Escanear ticket')}
      </button>

      <h2 className="vj-seccion">{t('Tickets · {0}', v.tickets.length)}</h2>
      {v.tickets.length === 0 ? (
        <p className="vjv-vacio">{t('Todavía no hay tickets. Escanea el primero.')}</p>
      ) : (
        <ul className="vjv-tickets">
          {v.tickets.map((tk) => (
            <li key={tk.id}>
              <button type="button" className="vjv-ticket" onClick={() => onAbrirTicket(tk.id)}>
                <span className="vjv-ticket-icono">
                  <Icon name={iconoTipoLugar(tk.tipo_lugar)} size={22} />
                </span>
                <span className="vjv-ticket-main">
                  <span className="vjv-ticket-lugar">{nombreDelLugar(tk.lugar, tk.tipo_lugar, t)}</span>
                  <span className="vjv-ticket-meta">{metaDelTicket(tk, v.miembros, t, idioma)}</span>
                  {tk.falta_que_elija > 0 && (
                    <span className="vjv-chip vjv-chip-aviso">{t('Falta que elija {0}', tk.falta_que_elija)}</span>
                  )}
                </span>
                <span className="vjv-ticket-toca">
                  <span className="vjv-ticket-toca-lbl">{t('Te toca')}</span>
                  <span className="vjv-ticket-toca-monto">{formatMXN(tk.te_toca_cents)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <button type="button" className="btn btn-ghost" onClick={onCerrar}>
        {t('Cerrar viaje')}
      </button>
      <button type="button" className="vjv-salir" onClick={onSalir}>
        {t('Salir del viaje')}
      </button>
    </>
  );
}

function EsperandoPagos({ viaje: v, marcando, onMarcar }: ViajeVistaProps & { viaje: DetalleViaje }) {
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
    </>
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

/** 1q · el dueño no deja salir (409 con su motivo). */
export function HojaNoPuedeSalirVista({
  viaje,
  motivo,
  inicial,
  onEntendido,
}: {
  viaje: DetalleViaje;
  motivo: MotivoSalida;
  inicial?: RefObject<HTMLButtonElement>;
  onEntendido: () => void;
}) {
  const { t } = useIdioma();
  return (
    <div className="vjv-hoja">
      <span className="vjv-hoja-asa" aria-hidden="true" />
      <span className="vjv-hoja-icono" aria-hidden="true">
        <Icon name="arrow-left" size={22} />
      </span>
      <h2 className="vjv-hoja-titulo">{t('Todavía no puedes salir de {0}', viaje.nombre)}</h2>
      <p className="vjv-hoja-texto">{textoNoPuedeSalir(motivo, viaje.tickets, t)}</p>
      <div className="vjv-hoja-botones">
        <button ref={inicial} type="button" className="btn btn-navy" onClick={onEntendido}>
          {t('Entendido')}
        </button>
      </div>
    </div>
  );
}
