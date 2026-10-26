import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '../../api';
import { denominatorBps } from '../../api/mesaPresentation';
import {
  errorAlCorregir,
  errorDeViaje,
  type CorreccionDeTicket,
  type DetalleViaje,
  type ItemDelTicket,
  type MiembroViaje,
  type OrigenTicket,
  type TicketDelViaje,
} from '../../api/viajes';
import { olvidarLoDeViajes } from '../../api/ultimoVisto';
import { useAuth } from '../../auth/AuthContext';
import { AppBottomBar } from '../../components/AppBottomBar';
import { AppHeaderBack } from '../../components/AppHeader';
import { Icon } from '../../components/Icon';
import { useToast } from '../../components/ui';
import { useIdioma } from '../../i18n/idioma';
import { goBack, navigate, replaceRoute } from '../../router';
import { formatMXN } from '../../utils/format';
import { fullName } from '../../utils/identity';
import { bpsLabel } from '../mesaItemsView';
import { montoDeDescuento } from '../desgloseDelTicket';
import { etiquetaPorcion } from '../queConsumisteView';
import { CorregirTicketVista } from './CorregirTicket';
import { FilasDelTotal } from './FilasDelTotal';
import { ListaDePresentes } from './TicketNuevoScreen';
import {
  alternarPresente,
  ausentesDelTicket,
  ayudaDePresentes,
  candidatosDelTicket,
  chipsDeEleccion,
  idsPresentes,
  montoDelPlato,
  nombresPresentes,
  pedidoDeSeleccion,
  porcionInicial,
  porcionesDelPlato,
  quienPago,
  seleccionGuardada,
  pagadoresDelTicket,
  subtituloDelTicket,
  teTocaConSeleccion,
  filasDelTotal,
  topeDelPlato,
} from './ticketView';
import { iconoTipoLugar, nombreCompleto, nombreDePila, nombreDelLugar, type T } from './viajesView';
import { circuloDelViaje } from './circuloDelViaje';
import './viajes.css';
import './ticket.css';
import { FilaDeTitulo } from '../../components/TarjetaDeTitulo';
import { nombreDePlato } from '../../utils/nombreDePlato';
import { tieneFoto, useCapacidadFotoDelTicket } from '../../api/fotoDelTicket';
import { useFotoDelTicket, type OrigenDeFoto } from '../../api/fotosDeTickets';
import type { StoredSession } from '../../api/storage';
import { FilaDeLaFotoDelTicket, VisorDelTicket } from '../../components/VisorDelTicket';

/**
 * AF-VIAJES · D242 · un ticket del viaje: elegir lo que consumí (1i), «Pagar
 * el total» (1j) y «En partes iguales» (con quiénes estuvieron).
 *
 * «¿Qué consumiste?» se ve como la lista de la mesa (las clases `qc-*` y los
 * helpers puros de la mesa), pero es propia del viaje: no se extrae nada de
 * `MesaDetailView`. Se ve quién ya eligió, nunca QUÉ eligió: por plato, el dueño
 * sólo publica cuánto queda (`remaining_bps`) y lo mío.
 */

type Estado =
  | { readonly fase: 'cargando' }
  | { readonly fase: 'error' }
  | { readonly fase: 'no_disponible' }
  | { readonly fase: 'listo'; readonly ticket: TicketDelViaje; readonly viaje: DetalleViaje };

export function TicketScreen({ viajeId, ticketId }: { viajeId: string; ticketId: string }) {
  const { t } = useIdioma();
  const toast = useToast();
  const { session } = useAuth();
  const [estado, setEstado] = useState<Estado>({ fase: 'cargando' });
  const [seleccion, setSeleccion] = useState<Map<string, number>>(() => new Map());
  const [abierto, setAbierto] = useState<string | null>(null);
  const [ausentes, setAusentes] = useState<Set<string>>(() => new Set());
  const [guardando, setGuardando] = useState(false);
  // D278-3 · la corrección es un modo de esta pantalla (P4 del plan): «Volver» la cierra sin guardar.
  const [corrigiendo, setCorrigiendo] = useState(false);
  const corrigiendoEnCurso = useRef(false);
  const vivo = useRef(true);

  useEffect(() => {
    vivo.current = true;
    return () => { vivo.current = false; };
  }, []);

  const mostrar = useCallback((ticket: TicketDelViaje, viaje: DetalleViaje) => {
    setEstado({ fase: 'listo', ticket, viaje });
    setSeleccion(seleccionGuardada(ticket.items));
    setAusentes(ausentesDelTicket(ticket.personas));
    setAbierto(null);
  }, []);

  const cargar = useCallback((silencioso = false) => {
    if (!silencioso) setEstado({ fase: 'cargando' });
    Promise.all([api.getTicketDeViaje(viajeId, ticketId), api.getViaje(viajeId)]).then(([ticket, viaje]) => {
      if (vivo.current) mostrar(ticket, viaje);
    }, (err: unknown) => {
      if (!vivo.current) return;
      const e = errorDeViaje(err);
      if (e.tipo === 'no_abierto') replaceRoute('viaje-cerrado', viajeId);
      else if (e.tipo === 'no_disponible') setEstado({ fase: 'no_disponible' });
      else if (!silencioso) setEstado({ fase: 'error' });
    });
  }, [viajeId, ticketId, mostrar]);

  useEffect(() => { cargar(); }, [cargar]);

  const ticket = estado.fase === 'listo' ? estado.ticket : null;
  const viaje = estado.fase === 'listo' ? estado.viaje : null;
  // D466 · si la capacidad de la foto se enciende después de cargar (la config llegó tarde), se pide de nuevo.
  const capacidadFoto = useCapacidadFotoDelTicket();
  const sinNegociarFoto = ticket !== null && ticket.ticket_image === undefined;
  const fotoReintentada = useRef(false);
  useEffect(() => {
    // Una sola vez: un dueño que no la publica aun negociada no provoca un bucle.
    if (!capacidadFoto || !sinNegociarFoto || fotoReintentada.current) return;
    fotoReintentada.current = true;
    cargar(true);
  }, [capacidadFoto, sinNegociarFoto, cargar]);
  const candidatos = useMemo(
    () => (ticket && viaje ? candidatosDelTicket(ticket.personas, viaje.miembros, t) : []),
    [ticket, viaje, t],
  );

  const personas = ticket?.personas.length ?? 0;
  const tomar = (item: ItemDelTicket) => {
    const bps = porcionInicial(item, personas);
    if (bps === null) return;
    setSeleccion((s) => new Map(s).set(item.id, bps));
    setAbierto(porcionesDelPlato(item, personas).length > 1 ? item.id : null);
  };
  const elegirPorcion = (id: string, d: number) => {
    setSeleccion((s) => new Map(s).set(id, denominatorBps(d)));
    setAbierto(null);
  };
  const soltar = (id: string) => {
    setSeleccion((s) => {
      const n = new Map(s);
      n.delete(id);
      return n;
    });
    setAbierto(null);
  };

  async function listo() {
    if (!ticket || guardando) return;
    setGuardando(true);
    try {
      await api.elegirEnTicketDeViaje(viajeId, ticketId, { items: pedidoDeSeleccion(ticket.items, seleccion), listo: true });
      toast(t('Guardamos lo que consumiste.'), { sobreLaBarra: true });
      goBack('viaje', viajeId);
    } catch (err) {
      if (!vivo.current) return;
      const e = errorDeViaje(err);
      if (e.tipo === 'fraccion_excede') {
        toast(t('Alguien ya eligió parte de ese plato. Revisa lo que queda.'), { sobreLaBarra: true });
        cargar(true);
      } else if (e.tipo === 'no_presente') {
        // D276-4 · me desmarcaron mientras elegía: se dice, sin pantalla de error, y el ticket de nuevo.
        toast(t('No estuviste en este ticket: no eliges nada.'), { sobreLaBarra: true });
        cargar(true);
      } else if (e.tipo === 'personal') {
        toast(t('Es tu gasto personal: no hay nada que elegir.'), { sobreLaBarra: true });
        cargar(true);
      } else if (e.tipo === 'no_abierto') {
        toast(t('Este viaje ya se cerró.'), { sobreLaBarra: true });
        cargar(true);
      } else if (e.tipo === 'no_disponible') {
        setEstado({ fase: 'no_disponible' });
      } else {
        toast(t('No pudimos guardarlo. Prueba de nuevo.'), { sobreLaBarra: true });
      }
    } finally {
      if (vivo.current) setGuardando(false);
    }
  }

  async function guardarPresentes() {
    if (!ticket || !viaje || guardando) return;
    setGuardando(true);
    try {
      const nuevo = await api.marcarPresentesEnTicket(viajeId, ticketId, idsPresentes(candidatos, ausentes));
      if (!vivo.current) return;
      mostrar(nuevo, viaje);
      toast(t('Guardamos quiénes estuvieron.'), { sobreLaBarra: true });
    } catch (err) {
      if (!vivo.current) return;
      const e = errorDeViaje(err);
      if (e.tipo === 'persona_ya_eligio') {
        // D276-2 · en «por lo que pidió cada uno» no se desmarca a quien ya eligió: se dice quién, y la lista vuelve a
        // lo guardado.
        toast(textoYaEligio(e.miembroId, viaje.miembros, t), { sobreLaBarra: true });
        setAusentes(ausentesDelTicket(ticket.personas));
      } else if (e.tipo === 'persona_desconocida') {
        toast(t('Alguien ya no está en el viaje. Revisa quiénes estuvieron.'), { sobreLaBarra: true });
        cargar(true);
      } else if (e.tipo === 'no_abierto') {
        toast(t('Este viaje ya se cerró.'), { sobreLaBarra: true });
        cargar(true);
      } else if (e.tipo === 'no_disponible') {
        setEstado({ fase: 'no_disponible' });
      } else {
        toast(t('No pudimos guardarlo. Prueba de nuevo.'), { sobreLaBarra: true });
      }
    } finally {
      if (vivo.current) setGuardando(false);
    }
  }

  // D278-3 · si es un escaneado o un gasto a mano lo dice el ticket del viaje (el detalle no trae `origen`).
  const origen: OrigenTicket | null = (ticket && viaje?.tickets.find((x) => x.id === ticket.id)?.origen) ?? null;

  async function guardarCorreccion(pedido: CorreccionDeTicket) {
    if (!ticket || !viaje || corrigiendoEnCurso.current) return;
    corrigiendoEnCurso.current = true;
    setGuardando(true);
    try {
      const nuevo = await api.corregirTicketDeViaje(viajeId, ticketId, pedido);
      if (!vivo.current) return;
      // Inicio vuelve a pedir los viajes abiertos y lo que falta elegir; Balance y Estadísticas se piden al abrirlos.
      olvidarLoDeViajes();
      setCorrigiendo(false);
      mostrar(nuevo, viaje);
      toast(origen === 'manual' ? t('Corregiste el gasto.') : t('Corregiste el ticket.'), { sobreLaBarra: true });
      // El viaje también cambió (los balances, quién falta elegir).
      cargar(true);
    } catch (err) {
      if (!vivo.current) return;
      const e = errorAlCorregir(err);
      if (e.tipo === 'ticket_no_encontrado') {
        // Otro lo eliminó mientras tanto (o la corrección lo dejó como el personal de otro): se dice y se vuelve al viaje,
        // sin pantalla de error.
        olvidarLoDeViajes();
        goBack('viaje', viajeId);
        toast(t('Este ticket ya no está en el viaje.'), { sobreLaBarra: true });
      } else if (e.tipo === 'no_disponible') {
        setEstado({ fase: 'no_disponible' });
      } else if (e.tipo === 'no_abierto') {
        setCorrigiendo(false);
        toast(t('Este viaje ya se cerró.'), { sobreLaBarra: true });
        cargar(true);
      } else if (e.tipo === 'corregir_prohibido') {
        setCorrigiendo(false);
        toast(t('Sólo quien cargó o pagó este ticket puede corregirlo.'), { sobreLaBarra: true });
        cargar(true);
      } else if (e.tipo === 'renglon_desconocido') {
        setCorrigiendo(false);
        toast(t('El ticket cambió mientras lo corregías. Revísalo de nuevo.'), { sobreLaBarra: true });
        cargar(true);
      } else if (e.tipo === 'pagador_desconocido') {
        toast(t('Alguien que pagó ya no está en el viaje: el total no se puede cambiar.'), { sobreLaBarra: true });
        cargar(true);
      } else if (e.tipo === 'pagadores_no_suman') {
        toast(t('El total cambió: escribe cuánto pagó cada uno.'), { sobreLaBarra: true });
        cargar(true);
      } else if (e.tipo === 'monto_invalido') {
        toast(t('El total tiene que ser mayor que $0 y de hasta $1,000,000.'), { sobreLaBarra: true });
      } else if (e.tipo === 'tope_del_viaje') {
        toast(t('Con este cambio el viaje pasaría su tope de gastos. Revisa los montos.'), { sobreLaBarra: true });
      } else {
        toast(t('No pudimos guardarlo. Prueba de nuevo.'), { sobreLaBarra: true });
      }
    } finally {
      corrigiendoEnCurso.current = false;
      if (vivo.current) setGuardando(false);
    }
  }

  const enCorreccion = corrigiendo && ticket !== null && viaje !== null && origen !== null;
  const conPie = enCorreccion || (ticket !== null && ticket.forma === 'consumo'
    && (ticket.puedo_elegir || (viaje !== null && vistaElegidaDelViajeCerrado(ticket, viaje.estado !== 'abierto'))));

  return (
    <div className={conPie ? 'screen vj-con-pie' : 'screen has-appbar'}>
      <AppHeaderBack
        userName={fullName(session) ?? undefined}
        onBack={() => (enCorreccion ? setCorrigiendo(false) : goBack('viaje', viajeId))}
      />
      {enCorreccion ? (
        <CorregirTicketVista
          key={ticket.id}
          ticket={ticket}
          origen={origen}
          miembros={viaje.miembros}
          enviando={guardando}
          onGuardar={(pedido) => void guardarCorreccion(pedido)}
        />
      ) : ticket && viaje ? (
        <TicketVista
          ticket={ticket}
          miembros={viaje.miembros}
          cerrado={viaje.estado !== 'abierto'}
          seleccion={seleccion}
          abierto={abierto}
          ausentes={ausentes}
          guardando={guardando}
          onTomar={tomar}
          onSoltar={soltar}
          onAbrir={setAbierto}
          onPorcion={elegirPorcion}
          onListo={() => void listo()}
          onPresente={(id) => setAusentes((a) => alternarPresente(a, id, candidatos))}
          onGuardarPresentes={() => void guardarPresentes()}
          origen={origen}
          onCorregir={() => setCorrigiendo(true)}
          foto={<FotoDelTicketDelViaje session={session} viajeId={viajeId} ticket={ticket} miembros={viaje.miembros} />}
        />
      ) : (
        <TicketEstadoVista
          estado={estado.fase === 'no_disponible' ? 'no_disponible' : estado.fase === 'error' ? 'error' : 'cargando'}
          onReintentar={() => cargar()}
        />
      )}
      {/* D250 · desde un ticket o gasto del viaje abierto, el círculo escanea para ese viaje. */}
      {!conPie && <AppBottomBar active={null} center={circuloDelViaje(viaje, t)} />}
    </div>
  );
}

// ─── Las vistas (puras: sin red ni efectos) ───────────────────────────────

/** Cargando, el 404 y la falla de red. */
export function TicketEstadoVista({ estado, onReintentar }: {
  estado: 'cargando' | 'no_disponible' | 'error';
  onReintentar: () => void;
}) {
  const { t } = useIdioma();
  return (
    <>
      {/* Sin el ticket no hay lugar que nombrar. D285 · la tarjeta lleva el recibo y dos siluetas en lugar del título,
          mientras carga y también sin el ticket (fila 21 de la especificación). */}
      <div className="title-card">
        <FilaDeTitulo icono="recibo">
          <span className="title-card-siluetas" aria-hidden="true">
            <span className="title-card-silueta" />
            <span className="title-card-silueta title-card-silueta--sub" />
          </span>
        </FilaDeTitulo>
      </div>
      <div className="scroll vj-scroll">
        {estado === 'cargando' ? (
          <div className="vj-card" aria-busy="true" aria-label={t('Cargando…')}>
            <span className="sk-line w70" />
            <span className="sk-line w40" />
            <span className="sk-line w100" />
            <span className="sk-line w100" />
          </div>
        ) : estado === 'no_disponible' ? (
          <div className="vj-card vjt-aviso">
            <p className="vjt-aviso-titulo">{t('Este viaje ya no está disponible.')}</p>
            <button type="button" className="btn btn-navy" onClick={() => navigate('viajes', 'abiertos')}>
              {t('Ver tus viajes')}
            </button>
          </div>
        ) : (
          <div className="state-error">
            <div className="state-error-row">
              <Icon name="x-circle" size={22} />
              <div className="vjt-crece">
                <div className="state-error-title">{t('No pudimos cargar el viaje')}</div>
                <p className="state-error-body">{t('Revisa la conexión y prueba de nuevo.')}</p>
              </div>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onReintentar}>
              {t('Reintentar')}
            </button>
          </div>
        )}
      </div>
    </>
  );
}

export interface TicketVistaProps {
  ticket: TicketDelViaje;
  miembros: readonly MiembroViaje[];
  seleccion: ReadonlyMap<string, number>;
  abierto: string | null;
  ausentes: ReadonlySet<string>;
  guardando: boolean;
  onTomar: (item: ItemDelTicket) => void;
  onSoltar: (id: string) => void;
  onAbrir: (id: string) => void;
  onPorcion: (id: string, denominador: number) => void;
  onListo: () => void;
  onPresente: (id: string) => void;
  onGuardarPresentes: () => void;
  /**
   * V-02 · el viaje ya no está abierto (esperando pagos o en Cerrados, abierto desde una visita de Estadísticas con
   * `viaje_version=7`): el ticket es sólo para ver, y se dice arriba.
   */
  cerrado?: boolean;
  /** D278-3 · escaneado o gasto a mano (del ticket del viaje); sin saberlo, no se ofrece corregir. */
  origen?: OrigenTicket | null;
  onCorregir?: () => void;
  /** D466 · E · la foto del ticket debajo del título (con la capacidad encendida y si hay); la arma la pantalla. */
  foto?: ReactNode;
}

export function TicketVista(props: TicketVistaProps) {
  const { ticket, miembros } = props;
  const { t, idioma } = useIdioma();
  return (
    <>
      <div className="title-card">
        <FilaDeTitulo icono="recibo">
          <h1 className="title-card-title">{nombreDelLugar(ticket.lugar, ticket.tipo_lugar, t)}</h1>
          <div className="title-card-sub">{subtituloDelTicket(ticket, miembros, idioma, t)}</div>
        </FilaDeTitulo>
        {props.foto}
      </div>
      {ticket.forma === 'consumo' ? (
        <ConsumoVista {...props} />
      ) : ticket.forma === 'total' ? (
        <TotalVista {...props} />
      ) : (
        <IgualesVista {...props} />
      )}
    </>
  );
}

/**
 * D276-2 · «{Nombre} ya eligió: no se puede desmarcar.» Si soy yo, «Ya elegiste: no te puedes desmarcar.»; sin el
 * nombre (una cuenta que ya no está, o no vino), «Alguien».
 */
export function textoYaEligio(miembroId: string | null, miembros: readonly MiembroViaje[], t: T): string {
  const m = miembroId ? miembros.find((x) => x.id === miembroId) : undefined;
  if (!m) return t('Alguien ya eligió: no se puede desmarcar.');
  return m.es_yo ? t('Ya elegiste: no te puedes desmarcar.') : t('{0} ya eligió: no se puede desmarcar.', nombreCompleto(m, t));
}

/**
 * D276-3 · D276-4 · lo que se dice arriba del ticket: un gasto personal (todo mío, no suma al viaje) o, en «por lo que
 * pidió cada uno», que no estuve y no elijo. `null` si no hay nada que decir.
 * V-02 · con el viaje ya cerrado manda eso: el ticket es sólo para ver.
 */
export function avisoDelTicket(ticket: TicketDelViaje, miembros: readonly MiembroViaje[], t: T, cerrado = false): string | null {
  if (cerrado) return t('Este viaje ya se cerró: el ticket es sólo para ver.');
  if (ticket.personal) return t('Es tu gasto personal: sólo lo ves tú y no suma al total del viaje.');
  if (ticket.forma !== 'consumo') return null;
  const yo = miembros.find((m) => m.es_yo)?.id;
  const estuve = ticket.personas.some((p) => p.presente && p.miembro_id === yo);
  return estuve ? null : t('No estuviste en este ticket: no eliges nada.');
}

function AvisoDelTicket({ ticket, miembros, cerrado = false }: {
  ticket: TicketDelViaje;
  miembros: readonly MiembroViaje[];
  cerrado?: boolean;
}) {
  const { t } = useIdioma();
  const aviso = avisoDelTicket(ticket, miembros, t, cerrado);
  if (!aviso) return null;
  return (
    <section className={`vj-card vjt-aviso-ticket${ticket.personal && !cerrado ? ' vjt-personal' : ''}`} role="note">
      <p className="vjt-texto">{aviso}</p>
    </section>
  );
}

/**
 * «¿Quiénes estuvieron?» para editar: con `puedo_marcar_presentes` (desde la 6, en las tres formas, D276), quien cargó
 * o quien pagó cambia quiénes estuvieron y guarda.
 */
function EditarPresentes({ ticket, miembros, ausentes, guardando, onPresente, onGuardarPresentes }: TicketVistaProps) {
  const { t } = useIdioma();
  if (!ticket.puedo_marcar_presentes) return null;
  const candidatos = candidatosDelTicket(ticket.personas, miembros, t);
  const guardados = ausentesDelTicket(ticket.personas);
  const cambio = ausentes.size !== guardados.size || [...ausentes].some((id) => !guardados.has(id));
  return (
    <section className="vj-card" aria-labelledby="vjt-quienes">
      <h2 id="vjt-quienes" className="vjt-card-titulo">{t('¿Quiénes estuvieron?')}</h2>
      {ayudaDePresentes(ticket.forma, t) && <p className="vjt-texto vjt-texto--ayuda">{ayudaDePresentes(ticket.forma, t)}</p>}
      <ListaDePresentes candidatos={candidatos} ausentes={ausentes} onAlternar={onPresente} deshabilitada={guardando} />
      <button
        type="button"
        className="btn btn-navy vjt-guardar"
        disabled={!cambio || guardando}
        aria-busy={guardando || undefined}
        onClick={onGuardarPresentes}
      >
        {t('Guardar')}
      </button>
    </section>
  );
}

/**
 * D278-3 · D282-2 · «Corregir ticket» (o «Corregir gasto»), al final del detalle: sólo con `puedo_corregir` (lo cargué o
 * lo pagué, con el viaje abierto). En el scroll y no en el pie: en «por lo que pidió cada uno» el pie es de «Listo».
 */
function BotonCorregir({ ticket, cerrado = false, origen = null, onCorregir }: TicketVistaProps) {
  const { t } = useIdioma();
  if (!ticket.puedo_corregir || cerrado || origen === null || !onCorregir) return null;
  return (
    <button type="button" className="btn btn-ghost vjt-corregir" onClick={onCorregir}>
      {origen === 'manual' ? t('Corregir gasto') : t('Corregir ticket')}
    </button>
  );
}

/**
 * «Total del ticket» y «Te toca», como en 1j. D278-2 · D284 · el total es el impreso; con servicio, descuentos o IVA
 * aparte, primero cómo se llega a él, y debajo de «Te toca» lo de tus platos y tu parte del resto.
 */
function Totales({ ticket }: { ticket: TicketDelViaje }) {
  const { t } = useIdioma();
  const filas = filasDelTotal(ticket);
  return (
    <section className="vj-card vjt-totales">
      <FilasDelTotal filas={filas} />
      <div className="vjt-total-fila">
        <span className="vjt-total-rotulo">{t('Total del ticket')}</span>
        <span className="vjt-total-monto">{formatMXN(ticket.total_cents)}</span>
      </div>
      <hr className="vjt-div" />
      <div className="vjt-total-fila vjt-total-fila--toca">
        <span className="vjt-total-rotulo">{t('Te toca')}</span>
        <span className="vjt-total-monto">{formatMXN(ticket.te_toca_cents)}</span>
      </div>
      {filas.length > 0 && <p className="vjt-toca-detalle">{detalleDeTeToca(ticket, t)}</p>}
    </section>
  );
}

/** D278-2 · «Tus platos $X · Tu parte del resto $Y»: el resto (servicio, IVA y descuentos) puede ser negativo. */
function detalleDeTeToca(ticket: TicketDelViaje, t: T): string {
  const resto = ticket.te_toca_cents - ticket.te_toca_platos_cents;
  return t('Tus platos {0} · Tu parte del resto {1}', formatMXN(ticket.te_toca_platos_cents),
    resto < 0 ? montoDeDescuento(-resto) : formatMXN(resto));
}

/** D263 · con varios, quiénes pagaron y cuánto cada uno. Con uno solo, ya lo dice la línea de arriba. */
function QuienesPagaron({ ticket, miembros }: { ticket: TicketDelViaje; miembros: readonly MiembroViaje[] }) {
  const { t } = useIdioma();
  if (ticket.pagadores.length < 2) return null;
  return (
    <section className="vj-card" aria-labelledby="vjt-quienes-pagaron">
      <h2 id="vjt-quienes-pagaron" className="vjt-card-titulo">{t('Quiénes pagaron')}</h2>
      <ul className="vjt-pagadores">
        {pagadoresDelTicket(ticket, miembros, t).map((p) => (
          <li key={p.clave} className="vjt-total-fila">
            <span className="vjt-pagador">{p.nombre}</span>
            <span className="vjt-total-monto">{formatMXN(p.monto_cents)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 1j · «Pagar el total»: invita quien lo pagó; con varios (D263), cada uno pone lo que pagó. */
function TotalVista(props: TicketVistaProps) {
  const { ticket, miembros } = props;
  const { t } = useIdioma();
  const pago = quienPago(ticket, miembros);
  const completo = pago ? nombreCompleto(pago, t) : t('Cuenta eliminada');
  const pila = pago ? nombreDePila(pago, t) : t('Cuenta eliminada');
  const varios = ticket.pagadores.length > 1;
  return (
    <div className="scroll vj-scroll">
      <AvisoDelTicket ticket={ticket} miembros={miembros} cerrado={props.cerrado} />
      <section className="vj-card vjt-aviso">
        <span className="vjt-icono vjt-icono--centro" aria-hidden="true"><Icon name={iconoTipoLugar(ticket.tipo_lugar)} size={20} /></span>
        <h2 className="vjt-aviso-titulo">
          {varios ? t('Invitan quienes pagaron') : ticket.pagaste_tu ? t('Invitas tú') : t('Invita {0}', pila)}
        </h2>
        <p className="vjt-aviso-texto">
          {varios
            ? ticket.pagaste_tu
              ? t('Cada uno pone lo que pagó. Nadie les debe nada.')
              : t('Cada uno pone lo que pagó. No te toca nada.')
            : ticket.pagaste_tu
              ? t('Pagaste el total de este ticket. Nadie te debe nada.')
              : t('{0} pagó el total de este ticket. No te toca nada.', completo)}
        </p>
      </section>
      <QuienesPagaron ticket={ticket} miembros={miembros} />
      <Totales ticket={ticket} />
      <EditarPresentes {...props} />
      <BotonCorregir {...props} />
    </div>
  );
}

/** «En partes iguales»: entre quiénes, y (si lo cargué o pagué, con el viaje abierto) quiénes estuvieron. */
function IgualesVista(props: TicketVistaProps) {
  const { ticket, miembros } = props;
  const { t } = useIdioma();
  return (
    <div className="scroll vj-scroll">
      <AvisoDelTicket ticket={ticket} miembros={miembros} cerrado={props.cerrado} />
      <section className="vj-card">
        <h2 className="vjt-card-titulo">{t('Se divide entre los que estuvieron')}</h2>
        <p className="vjt-texto">{nombresPresentes(ticket.personas, miembros, t)}</p>
      </section>
      <QuienesPagaron ticket={ticket} miembros={miembros} />
      <Totales ticket={ticket} />
      <EditarPresentes {...props} />
      <BotonCorregir {...props} />
    </div>
  );
}

/** 1i · quién ya eligió, la lista de la mesa y «Listo» con «Te toca». */
function ConsumoVista(props: TicketVistaProps) {
  const { ticket, miembros, seleccion, guardando, onListo } = props;
  const { t } = useIdioma();
  const chips = chipsDeEleccion(ticket.personas, miembros, t);
  return (
    <>
      <div className="scroll vj-scroll">
        <AvisoDelTicket ticket={ticket} miembros={miembros} cerrado={props.cerrado} />
        {/* D276-3 · en un gasto personal nadie elige: no hay «Quién ya eligió». V-02 · con el viaje cerrado tampoco: lo
            que faltaba elegir ya se repartió al cerrar, y «falta elegir» no sería cierto. */}
        {!ticket.personal && !props.cerrado && (
          <section className="vj-card" aria-labelledby="vjt-quien-eligio">
            <h2 id="vjt-quien-eligio" className="vjt-rotulo vjt-rotulo--arriba">{t('Quién ya eligió')}</h2>
            <ul className="vjt-chips vjt-chips--eleccion">
              {chips.map((c) => (
                <li key={c.clave} className={c.ya_eligio ? 'vjt-eligio' : 'vjt-eligio vjt-eligio--falta'}>
                  <Icon name={c.ya_eligio ? 'check' : 'clock'} size={13} />
                  {c.ya_eligio ? c.nombre : t('{0} · falta elegir', c.nombre)}
                </li>
              ))}
            </ul>
          </section>
        )}
        {/* D481 · con el viaje cerrado, el ticket por consumo se ve como la pantalla del ticket de Mesas (3b): «Lo que
            elegiste», de sólo lectura, y en el pie «Elegiste». */}
        {vistaElegidaDelViajeCerrado(ticket, props.cerrado) && <LoQueElegisteDelViaje ticket={ticket} />}
        {/* D276-3 · un gasto personal es todo mío: sin lista para elegir (quedan el total y quiénes estuvieron). */}
        {!ticket.personal && !vistaElegidaDelViajeCerrado(ticket, props.cerrado) && (
          <section className="vj-card vjt-consumos" aria-labelledby="vjt-que-consumiste">
            <h2 id="vjt-que-consumiste" className="vjt-card-titulo">{t('¿Qué consumiste?')}</h2>
            <ListaParaElegir {...props} />
          </section>
        )}
        <QuienesPagaron ticket={ticket} miembros={miembros} />
        {!ticket.puedo_elegir && <Totales ticket={ticket} />}
        <EditarPresentes {...props} />
        <BotonCorregir {...props} />
      </div>
      {vistaElegidaDelViajeCerrado(ticket, props.cerrado) && (
        <div className="vj-pie">
          <div className="vjt-pie-fila">
            <span className="vjt-crece">
              <span className="vjt-pie-rotulo">{t('Elegiste')}</span>
            </span>
            <span className="vjt-monto vjt-monto--grande">{formatMXN(ticket.te_toca_platos_cents)}</span>
          </div>
        </div>
      )}
      {ticket.puedo_elegir && (
        <div className="vj-pie">
          <div data-guia="mi-parte" className="vjt-pie-fila">
            <span className="vjt-crece">
              <span className="vjt-pie-rotulo">{t('Te toca')}</span>
              {/* D278-2 · el total impreso. */}
              <span className="vjt-sub">{t('Total del ticket {0}', formatMXN(ticket.total_cents))}</span>
            </span>
            <span className="vjt-monto vjt-monto--grande">{formatMXN(teTocaConSeleccion(ticket, seleccion))}</span>
          </div>
          <button
            type="button"
            className="btn btn-navy"
            disabled={guardando}
            aria-busy={guardando || undefined}
            data-guia="listo-consumos"
            onClick={onListo}
          >
            {t('Listo')}
          </button>
        </div>
      )}
    </>
  );
}

/**
 * D481 · ¿el ticket se ve como el cerrado de Mesas (3b)? Sólo el ticket por consumo de un viaje ya cerrado, que no es
 * un gasto personal: los avisos de «Invita…», «Se divide entre…» y el del viaje cerrado quedan como están.
 */
export function vistaElegidaDelViajeCerrado(ticket: TicketDelViaje, cerrado = false): boolean {
  return cerrado && ticket.forma === 'consumo' && !ticket.personal;
}

/** D481 · las filas de «Lo que elegiste» de un ticket de viaje: lo mío, con la cantidad y la porción antes del nombre. */
export function filasElegidasDelViaje(ticket: TicketDelViaje): Array<{
  readonly id: string;
  readonly cantidad: string | null;
  readonly porcion: string | null;
  readonly nombre: string;
  readonly montoCents: number;
}> {
  return ticket.items.filter((i) => i.my_bps > 0).map((i) => ({
    id: i.id,
    cantidad: i.quantity > 1 ? `${i.quantity} ×` : null,
    porcion: i.my_bps < 10000 ? bpsLabel(i.my_bps) : null,
    nombre: nombreDePlato(i.name),
    montoCents: i.my_amount_cents,
  }));
}

/** D481 · «Lo que elegiste» de un ticket de viaje cerrado: de sólo lectura, sin píldora de porción. */
function LoQueElegisteDelViaje({ ticket }: { ticket: TicketDelViaje }) {
  const { t } = useIdioma();
  const filas = filasElegidasDelViaje(ticket);
  return (
    <section className="vj-card pantalla-ticket-eleccion" aria-labelledby="vjt-lo-que-elegiste">
      <h2 id="vjt-lo-que-elegiste" className="pantalla-ticket-eleccion-titulo">{t('Lo que elegiste')}</h2>
      {filas.length > 0 ? (
        <ul className={filas.some((f) => f.porcion) ? 'pantalla-ticket-filas pantalla-ticket-filas--con-porcion' : 'pantalla-ticket-filas'}>
          {filas.map((f) => (
            <li key={f.id} className="eleccion-fila">
              <span className="eleccion-fila-casilla" aria-hidden="true"><Icon name="check" size={18} /></span>
              {/* D100 · la porción en su columna, antes del nombre (que se alinea), sólo si alguna línea la tiene. */}
              <span className="eleccion-fila-frac">{f.porcion ?? ''}</span>
              <span className="eleccion-fila-nombre">
                {f.cantidad && <span className="eleccion-fila-cant">{f.cantidad} </span>}
                {f.nombre}
              </span>
              <span className="eleccion-fila-monto">{formatMXN(f.montoCents)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="pantalla-ticket-texto">{t('No elegiste ítems')}</p>
      )}
    </section>
  );
}

/**
 * La lista de «¿Qué consumiste?» con el aspecto de la mesa (decisión 90 y
 * D240-3): renglones del mismo alto, lo propio en teal con la píldora de
 * porción y tu parte, la píldora abre el selector en el mismo renglón, «Queda
 * ½» y «Lo eligió otro» sin nombre. Sin poder elegir, sólo se ve.
 */
function ListaParaElegir({ ticket, seleccion, abierto, guardando, onTomar, onSoltar, onAbrir, onPorcion }: TicketVistaProps) {
  const { t } = useIdioma();
  const personas = ticket.personas.length;
  const editable = ticket.puedo_elegir && !guardando;
  return (
    <div className="qc-lista vjt-lista">
      {ticket.items.map((i) => {
        // D360-5b · D370 · el nombre como se muestra y se anuncia.
        const nombre = nombreDePlato(i.name);
        const nombreAria = i.quantity > 1 ? t('{0} por {1}', nombre, i.quantity) : nombre;
        const titulo = (clase: string) => (
          <span className="qc-titulo">
            {i.quantity > 1 && <span className="qc-cant">{i.quantity} ×</span>}
            <span className={clase}>{nombre}</span>
          </span>
        );
        const bps = seleccion.get(i.id) ?? 0;
        const opciones = porcionesDelPlato(i, personas);

        if (bps > 0) {
          const etiqueta = etiquetaPorcion(bps, t);
          if (editable && abierto === i.id) {
            return (
              <div key={i.id} className="qc-renglon">
                <div className="qc-fila qc-mia qc-mia--abierta" data-estado="mio">
                  <div data-guia="porcion" className="qc-selector" role="radiogroup" aria-label={t('Porción de {0}', nombreAria)}>
                    {opciones.map((d) => {
                      const elegida = bps === denominatorBps(d);
                      return (
                        <button
                          key={d}
                          type="button"
                          role="radio"
                          aria-checked={elegida}
                          className={`qc-opcion${elegida ? ' on' : ''}`}
                          onClick={() => onPorcion(i.id, d)}
                        >
                          {etiquetaPorcion(denominatorBps(d), t)}
                        </button>
                      );
                    })}
                  </div>
                  <button type="button" className="qc-soltar" onClick={() => onSoltar(i.id)}>
                    {t('Soltar')}
                  </button>
                </div>
              </div>
            );
          }
          return (
            <div key={i.id} className="qc-renglon">
              <div className="qc-fila qc-mia" data-estado="mio" role="group" aria-label={nombreAria}>
                {editable ? (
                  <button
                    type="button"
                    className="qc-circulo qc-circulo--marcado"
                    aria-label={t('Soltar {0}', nombre)}
                    onClick={() => onSoltar(i.id)}
                  >
                    <Icon name="check" size={14} />
                  </button>
                ) : (
                  <span className="qc-circulo qc-circulo--marcado" aria-hidden="true">
                    <Icon name="check" size={14} />
                  </span>
                )}
                {titulo('qc-nombre qc-nombre--mio')}
                {editable && opciones.length > 1 ? (
                  <button
                    type="button"
                    className="qc-pildora"
                    aria-label={t('Cambiar la porción de {0}: {1}', nombreAria, etiqueta)}
                    aria-expanded={false}
                    onClick={() => onAbrir(i.id)}
                  >
                    {etiqueta}
                    <Icon name="chevron-down" size={12} />
                  </button>
                ) : (
                  <span className="qc-pildora qc-pildora--fija">{etiqueta}</span>
                )}
                <span className="qc-parte">{formatMXN(montoDelPlato(i, bps))}</span>
              </div>
            </div>
          );
        }

        // Nada que tomar y nada mío: lo eligieron otros (sin decir quién).
        if (topeDelPlato(i) === 0 || opciones.length === 0) {
          const tag = t('Lo eligió otro');
          return (
            <div key={i.id} className="qc-renglon">
              <div className="qc-fila qc-otro" data-estado="tomado" aria-label={`${nombreAria}${t(', {0}', tag)}`}>
                <span className="qc-candado" aria-hidden="true"><Icon name="lock" size={12} /></span>
                <span className="qc-cuerpo">
                  {titulo('qc-nombre qc-nombre--otro')}
                  <span className="qc-etiqueta">{tag}</span>
                </span>
                <span className="qc-precio qc-precio--otro">{formatMXN(i.line_cents)}</span>
              </div>
            </div>
          );
        }

        const queda = i.remaining_bps > 0 && i.remaining_bps < 10000 ? t('Queda {0}', bpsLabel(i.remaining_bps)) : null;
        const contenido = (
          <>
            <span className="qc-circulo" aria-hidden="true" />
            {titulo('qc-nombre')}
            {queda && <span className="qc-pildora qc-pildora--queda">{queda}</span>}
            <span className="qc-precio">{formatMXN(i.line_cents)}</span>
          </>
        );
        return (
          <div key={i.id} className="qc-renglon">
            {editable ? (
              <button
                type="button"
                data-guia="elegir-consumo"
                className="qc-fila qc-libre"
                data-estado={queda ? 'queda' : 'libre'}
                aria-pressed={false}
                aria-label={`${nombreAria}${queda ? t(', {0}', queda) : ''}`}
                onClick={() => onTomar(i)}
              >
                {contenido}
              </button>
            ) : (
              <div className="qc-fila" data-estado={queda ? 'queda' : 'libre'}>{contenido}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * D466 · E · la foto del ticket de un viaje: con la capacidad encendida y si el
 * dueño dice que hay miniatura, un botón con la miniatura debajo del título que
 * abre el visor. Sin la capacidad (hoy) o sin foto, nada: la pantalla de siempre.
 */
function FotoDelTicketDelViaje({ session, viajeId, ticket, miembros }: {
  session: StoredSession | null;
  viajeId: string;
  ticket: TicketDelViaje;
  miembros: readonly MiembroViaje[];
}) {
  const { t, idioma } = useIdioma();
  const capacidad = useCapacidadFotoDelTicket();
  const visible = capacidad !== null && tieneFoto(ticket.ticket_image);
  const origen = useMemo<OrigenDeFoto>(() => ({ tipo: 'viaje', viajeId, ticketId: ticket.id }), [viajeId, ticket.id]);
  const miniatura = useFotoDelTicket(session, visible ? origen : null, 'thumb');
  const [abierto, setAbierto] = useState(false);
  const boton = useRef<HTMLButtonElement | null>(null);
  if (!visible || !ticket.ticket_image || miniatura.estado === 'sin_foto') return null;
  const lugar = nombreDelLugar(ticket.lugar, ticket.tipo_lugar, t);
  // D481 · 3d · la fila de la foto dentro de la tarjeta de título, separada por una línea (ya no un link subrayado).
  return (
    <>
      <div className="pantalla-ticket-foto">
        <FilaDeLaFotoDelTicket url={miniatura.url} estado={miniatura.estado} botonRef={boton} onAbrir={() => setAbierto(true)} />
      </div>
      {abierto && (
        <VisorDelTicket
          session={session}
          tickets={[{
            clave: ticket.id,
            origen,
            foto: ticket.ticket_image,
            titulo: lugar,
            monto: formatMXN(ticket.total_cents),
            detalle: [subtituloDelTicket(ticket, miembros, idioma, t)],
          }]}
          indiceInicial={0}
          titulo={() => t('Foto del ticket')}
          onCerrar={() => setAbierto(false)}
          // Los consumos están en esta misma pantalla: «Ver consumos» cierra el visor.
          onVerConsumos={() => setAbierto(false)}
          returnFocusRef={boton}
        />
      )}
    </>
  );
}
