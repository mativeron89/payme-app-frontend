import '../../ayuda/ayuda.css';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../../api';
import { errorAlEliminar, type DetalleViaje, type TicketEnViaje } from '../../api/viajes';
import { useAuth } from '../../auth/AuthContext';
import { AppBottomBar } from '../../components/AppBottomBar';
import { AppHeaderBack, BubbleTabs, MountedCard } from '../../components/AppHeader';
import { FilaDeslizable } from '../../components/FilaDeslizable';
import { Icon } from '../../components/Icon';
import { useToast } from '../../components/ui';
import { useIdioma } from '../../i18n/idioma';
import { goBack, navigate } from '../../router';
import { formatMXN } from '../../utils/format';
import { fullName } from '../../utils/identity';
import { AvatarDeViaje, EstadoSinViaje, HojaModal, useDetalleViaje, useFotosDeMiembros, type CargaDeViaje } from './ViajeScreen';
import { circuloDelViaje } from './circuloDelViaje';
import { agruparConsumos, type LugarConsumido } from './consumosPorLugar';
import { fechaDelTicket } from './viajeView';
import { iconoTipoLugar, nombreDelLugar, nombreDeMiembro, parametroDeTicket } from './viajesView';
import './viajes.css';
import './viaje.css';

/**
 * D245-6 · Balance (`/viaje-balance/<id>`): dos opciones, como las burbujas de
 * Inicio (el mismo `BubbleTabs`).
 * D255-3 · sin la burbuja «Balance»: Consumos y Miembros van en la cabecera,
 * como Cuenta · Estadísticas · Viajes en Inicio, y su contenido en la tarjeta
 * blanca montada debajo:
 * - **Consumos** (primero): los tickets y gastos del viaje, el más nuevo arriba,
 *   con lugar o descripción y el total. D262 · sin la fecha ni quién pagó: eso se
 *   ve al entrar. Al tocarlo abre el ticket como antes. Nunca qué eligió cada uno.
 * - **Miembros** (segundo): cada miembro, con su foto si la tiene, y lo que
 *   pagó (Mati: «Lo que pagó»): `pagado_cents` del dueño. La app no lo calcula.
 * El total de cada consumo y lo que pagó cada uno llegan con `viaje_version=2`
 * (App Backend 2.172.0).
 * Cerrado, la ruta pasa al detalle de Cerrados (D240-17).
 *
 * D256 · en Consumos, deslizar a la izquierda un ticket o un gasto deja ver
 * «Eliminar» en rojo, como en Mesas (`FilaDeslizable`, D239), sólo donde el
 * dueño dice `puede_eliminar` (quien lo cargó o quien lo pagó, con el viaje
 * abierto). D388 · antes de eliminar pide «¿Eliminar?»; sólo al confirmar se
 * actualiza la pantalla con el viaje de la respuesta.
 *
 * D281 · en Consumos, los tickets y gastos del mismo lugar se juntan en una fila con el lugar, cuántas veces y el
 * total, que al tocarla se abre y muestra cada uno con su fecha y su monto (`consumosPorLugar.ts`). Un lugar con una
 * sola visita queda como antes.
 */
export type OpcionDeBalance = 'consumos' | 'miembros';

interface SeleccionParaEliminar {
  readonly viajeId: string;
  readonly ticketId: string;
  readonly contexto: symbol;
  readonly vida: symbol;
  readonly disparador: HTMLButtonElement | null;
}

export function BalanceScreen({ viajeId }: { viajeId: string }) {
  const { t } = useIdioma();
  const { session } = useAuth();
  const { carga, cargar, mostrar, refrescar, noDisponible } = useDetalleViaje(viajeId);
  const [opcion, setOpcion] = useState<OpcionDeBalance>('consumos');
  const fotoDe = useFotosDeMiembros(viajeId, carga.tipo === 'listo' ? carga.viaje.miembros : null);
  const toast = useToast();
  const [abierta, setAbierta] = useState<string | null>(null);
  const eliminando = useRef(false);
  const vivo = useRef(true);
  const vida = useRef<symbol | null>(null);
  const seleccion = useRef<SeleccionParaEliminar | null>(null);
  const [pregunta, setPregunta] = useState<SeleccionParaEliminar | null>(null);
  const inicial = useRef<HTMLButtonElement | null>(null);
  const balance = useRef<HTMLDivElement | null>(null);
  const cuadroDeFoco = useRef<number | null>(null);
  const principal = session?.principal_id ?? null;
  const familia = session?.family_id ?? null;
  const miembro = carga.tipo === 'listo' ? carga.viaje.mi_miembro_id : null;
  // Sólo identidad local, sin credenciales. La generación también distingue A→B→A.
  const contexto = useRef({ principal, familia, miembro, viajeId, id: Symbol('balance') });
  if (contexto.current.principal !== principal || contexto.current.familia !== familia
    || contexto.current.miembro !== miembro || contexto.current.viajeId !== viajeId) {
    contexto.current = { principal, familia, miembro, viajeId, id: Symbol('balance') };
  }
  const generacion = contexto.current.id;
  const actual = useRef({ carga, opcion, contexto: generacion, principal, viajeId });
  actual.current = { carga, opcion, contexto: generacion, principal, viajeId };

  useEffect(() => {
    vivo.current = true;
    vida.current = Symbol('vida de Balance');
    return () => {
      vivo.current = false;
      vida.current = null;
      seleccion.current = null;
      if (cuadroDeFoco.current !== null) cancelAnimationFrame(cuadroDeFoco.current);
    };
  }, []);

  function mismoContexto(s: SeleccionParaEliminar): boolean {
    return vivo.current && vida.current === s.vida && actual.current.contexto === s.contexto
      && actual.current.viajeId === s.viajeId && actual.current.principal !== null;
  }

  function ticketVigente(s: SeleccionParaEliminar): TicketEnViaje | undefined {
    const a = actual.current;
    if (!mismoContexto(s) || a.opcion !== 'consumos' || a.carga.tipo !== 'listo'
      || a.carga.viaje.id !== s.viajeId || a.carga.viaje.estado !== 'abierto') return undefined;
    return a.carga.viaje.tickets.find((tk) => tk.id === s.ticketId && tk.puede_eliminar);
  }

  function devolverFoco(s: SeleccionParaEliminar, destino: 'disparador' | 'balance'): void {
    if (!mismoContexto(s) || actual.current.opcion !== 'consumos' || seleccion.current) return;
    if (cuadroDeFoco.current !== null) cancelAnimationFrame(cuadroDeFoco.current);
    cuadroDeFoco.current = requestAnimationFrame(() => {
      cuadroDeFoco.current = null;
      if (!mismoContexto(s) || actual.current.opcion !== 'consumos' || seleccion.current
        || document.querySelector<HTMLElement>('.app')?.inert) return;
      // No quitarle foco a una interacción posterior mientras respondía el dueño.
      const activo = document.activeElement;
      if (activo !== document.body && activo !== balance.current
        && (destino !== 'disparador' || activo !== s.disparador)) return;
      const boton = s.disparador;
      if (destino === 'disparador' && ticketVigente(s)
        && boton?.isConnected && !boton.disabled && boton.getClientRects().length > 0) {
        boton.focus({ preventScroll: true });
      } else {
        balance.current?.focus({ preventScroll: true });
      }
    });
  }

  function cerrarPregunta(s: SeleccionParaEliminar): boolean {
    if (seleccion.current !== s) return false;
    seleccion.current = null;
    setPregunta(null);
    return true;
  }

  function descartar(s: SeleccionParaEliminar): void {
    if (cerrarPregunta(s)) devolverFoco(s, 'disparador');
  }

  useEffect(() => {
    const s = seleccion.current;
    if (s && !ticketVigente(s)) descartar(s);
  }, [carga, opcion, generacion]);

  function preguntar(tk: TicketEnViaje, disparador: HTMLButtonElement | null): void {
    if (eliminando.current || seleccion.current || !vida.current) return;
    const s: SeleccionParaEliminar = { viajeId, ticketId: tk.id, contexto: actual.current.contexto, vida: vida.current, disparador };
    if (!ticketVigente(s)) return;
    if (cuadroDeFoco.current !== null) cancelAnimationFrame(cuadroDeFoco.current);
    cuadroDeFoco.current = null;
    seleccion.current = s;
    setPregunta(s);
  }

  async function confirmar(s: SeleccionParaEliminar) {
    if (seleccion.current !== s || eliminando.current) return;
    const tk = ticketVigente(s);
    // Consumir antes del primer await: otro Enter/toque/callback encolado no reenvía.
    if (!cerrarPregunta(s)) return;
    // Eliminar abre la fila al recibir foco; confirmar vuelve al Balance, también mientras espera.
    devolverFoco(s, 'balance');
    if (!tk) return;
    eliminando.current = true;
    setAbierta(null);
    try {
      const v = await api.eliminarTicketDeViaje(s.viajeId, tk.id);
      if (!mismoContexto(s)) return;
      mostrar(v);
      toast(tk.origen === 'manual' ? t('Gasto eliminado') : t('Ticket eliminado'), { sobreLaBarra: true });
    } catch (err) {
      if (!mismoContexto(s)) return;
      const e = errorAlEliminar(err);
      if (e.tipo === 'no_disponible') {
        noDisponible();
        return;
      }
      // Lo que vio cambió (otro lo eliminó, se cerró el viaje o ya no puede): se vuelve a pedir.
      if (e.tipo === 'ticket_no_encontrado' || e.tipo === 'no_abierto' || e.tipo === 'eliminar_prohibido') void refrescar();
      toast(
        e.tipo === 'ticket_no_encontrado' ? t('Ya no estaba')
          : e.tipo === 'no_abierto' ? t('El viaje ya no está abierto')
            : e.tipo === 'eliminar_prohibido' ? t('Sólo pueden eliminarlo quien lo cargó o quien lo pagó.')
              : t('No pudimos eliminarlo. Prueba de nuevo.'),
        { sobreLaBarra: true },
      );
    } finally {
      eliminando.current = false;
      devolverFoco(s, 'balance');
    }
  }

  return (
    <div ref={balance} tabIndex={-1} className="screen has-appbar">
      <AppHeaderBack
        userName={fullName(session) ?? undefined}
        onBack={() => goBack('viaje', viajeId)}
        tabs={<PestanasDeBalance opcion={opcion} onOpcion={setOpcion} />}
      />
      <BalanceVista
        carga={carga}
        opcion={opcion}
        onReintentar={cargar}
        onVerViajes={() => navigate('viajes', 'abiertos')}
        onAbrirTicket={(ticketId) => navigate('viaje-ticket', parametroDeTicket(viajeId, ticketId))}
        fotoDe={fotoDe}
        deslizar={{ abierta, onAbrir: setAbierta, onCerrar: () => setAbierta(null), onEliminar: preguntar }}
      />
      {/* D250 · desde Balance de un viaje abierto, el círculo escanea para ese viaje. */}
      <AppBottomBar active={null} center={circuloDelViaje(carga.tipo === 'listo' ? carga.viaje : null, t)} />
      {pregunta && ticketVigente(pregunta) && (
        <HojaModal etiqueta={t('¿Eliminar?')} inicial={inicial} onCerrar={() => descartar(pregunta)}>
          <div className="vjv-hoja">
            <span className="vjv-hoja-asa" aria-hidden="true" />
            <h2 className="vjv-hoja-titulo">{t('¿Eliminar?')}</h2>
            <div className="vjv-hoja-botones">
              <button ref={inicial} type="button" className="btn btn-ghost" onClick={() => descartar(pregunta)}>{t('Cancelar')}</button>
              <button type="button" className="btn btn-navy" onClick={() => void confirmar(pregunta)}>{t('Eliminar')}</button>
            </div>
          </div>
        </HojaModal>
      )}
    </div>
  );
}

export function PestanasDeBalance({ opcion, onOpcion }: { opcion: OpcionDeBalance; onOpcion: (o: OpcionDeBalance) => void }) {
  const { t } = useIdioma();
  return (
    <BubbleTabs
      tabs={[{ id: 'consumos', label: t('Consumos') }, { id: 'miembros', label: t('Miembros') }]}
      active={opcion}
      onSelect={(id) => onOpcion(id as OpcionDeBalance)}
    />
  );
}

/** D256 · el gesto de eliminar en Consumos: qué fila tiene «Eliminar» a la vista (una sola) y qué hacer al tocarlo. */
export interface DeslizarConsumo {
  readonly abierta: string | null;
  readonly onAbrir: (ticketId: string) => void;
  readonly onCerrar: () => void;
  readonly onEliminar: (tk: TicketEnViaje, disparador: HTMLButtonElement | null) => void;
}

export function BalanceVista({
  carga,
  opcion,
  onReintentar,
  onVerViajes,
  onAbrirTicket,
  fotoDe,
  deslizar,
}: {
  carga: CargaDeViaje;
  opcion: OpcionDeBalance;
  onReintentar: () => void;
  onVerViajes: () => void;
  onAbrirTicket: (ticketId: string) => void;
  fotoDe?: (miembroId: string) => string | null;
  deslizar?: DeslizarConsumo;
}) {
  const { t } = useIdioma();
  return (
    <div className="scroll">
      <MountedCard seam={opcion === 'consumos' ? 'left' : 'right'} className="vjb-tarjeta">
        {carga.tipo === 'listo' && <p className="ux-siguiente">{opcion === 'consumos'
          ? t('Abre un consumo para revisar su ticket y el reparto.')
          : t('Aquí ves cuánto pagó cada persona, no cuánto le corresponde consumir.')}</p>}
        {carga.tipo === 'listo' ? (
          opcion === 'consumos'
            ? <Consumos viaje={carga.viaje} onAbrirTicket={onAbrirTicket} deslizar={deslizar} />
            : <Miembros viaje={carga.viaje} fotoDe={fotoDe} />
        ) : (
          <EstadoSinViaje carga={carga} onReintentar={onReintentar} onVerViajes={onVerViajes} />
        )}
      </MountedCard>
    </div>
  );
}

function Consumos({ viaje: v, onAbrirTicket, deslizar }: {
  viaje: DetalleViaje;
  onAbrirTicket: (ticketId: string) => void;
  deslizar?: DeslizarConsumo;
}) {
  const { t } = useIdioma();
  // D281 · qué lugares están abiertos, por su clave.
  const [abiertos, setAbiertos] = useState<ReadonlySet<string>>(() => new Set());
  if (v.tickets.length === 0) return <p className="vjb-vacio">{t('Todavía no hay consumos.')}</p>;
  const alternar = (clave: string) => setAbiertos((a) => {
    const n = new Set(a);
    if (!n.delete(clave)) n.add(clave);
    return n;
  });
  return (
    <ul className="vjb-consumos">
      {agruparConsumos(v.tickets).map((lugar) => (lugar.tickets.length === 1 ? (
        <li key={lugar.tickets[0]!.id}>
          <FilaDeConsumo tk={lugar.tickets[0]!} onAbrirTicket={onAbrirTicket} deslizar={deslizar} />
        </li>
      ) : (
        <li key={lugar.clave}>
          <LugarAgrupado
            lugar={lugar}
            abierto={abiertos.has(lugar.clave)}
            onAlternar={() => alternar(lugar.clave)}
            onAbrirTicket={onAbrirTicket}
            deslizar={deslizar}
          />
        </li>
      )))}
    </ul>
  );
}

/** Un ticket o gasto, como siempre: abre el ticket y, donde se puede, se desliza para eliminar. */
function FilaDeConsumo({ tk, onAbrirTicket, deslizar }: {
  tk: TicketEnViaje;
  onAbrirTicket: (ticketId: string) => void;
  deslizar?: DeslizarConsumo;
}) {
  const { t } = useIdioma();
  return (
    <ConGesto tk={tk} deslizar={deslizar} nombre={nombreDelLugar(tk.lugar, tk.tipo_lugar, t)}>
      <button type="button" className="vjb-consumo" onClick={() => onAbrirTicket(tk.id)}>
        <span className="vjv-ticket-icono">
          <Icon name={iconoTipoLugar(tk.tipo_lugar)} size={22} />
        </span>
        <span className="vjb-consumo-main">
          <span className="vjb-consumo-lugar">{nombreDelLugar(tk.lugar, tk.tipo_lugar, t)}</span>
          {tk.falta_que_elija > 0 && (
            <span className="vjv-chip vjv-chip-aviso">{t('Falta que elija {0}', tk.falta_que_elija)}</span>
          )}
          {/* D276-3 · un gasto personal: sólo lo veo yo y no suma al viaje. */}
          {tk.personal && <span className="vjv-chip vjv-chip-personal">{t('Personal')}</span>}
        </span>
        {/* Respuesta A del plan: el total del ticket o del gasto. D278-2 · el total impreso (`total_cents`). */}
        <span className="vjb-consumo-monto">{formatMXN(tk.total_cents)}</span>
      </button>
    </ConGesto>
  );
}

/**
 * D281 · un lugar con dos o más visitas: la fila dice el lugar, cuántas veces y el total; al tocarla se abre con cada
 * visita (fecha y monto), que abre su ticket y se desliza para eliminar como siempre. El nombre y el ícono, los del
 * más reciente.
 */
export function LugarAgrupado({ lugar, abierto, onAlternar, onAbrirTicket, deslizar }: {
  lugar: LugarConsumido;
  abierto: boolean;
  onAlternar: () => void;
  onAbrirTicket: (ticketId: string) => void;
  deslizar?: DeslizarConsumo;
}) {
  const { t, idioma } = useIdioma();
  const reciente = lugar.tickets[0]!;
  const nombre = nombreDelLugar(reciente.lugar, reciente.tipo_lugar, t);
  const id = `vjb-lugar-${reciente.id}`;
  return (
    <>
      <button type="button" className="vjb-consumo vjb-lugar" aria-expanded={abierto} aria-controls={id} onClick={onAlternar}>
        <span className="vjv-ticket-icono">
          <Icon name={iconoTipoLugar(reciente.tipo_lugar)} size={22} />
        </span>
        <span className="vjb-consumo-main">
          <span className="vjb-consumo-lugar">{nombre}</span>
          <span className="vjb-lugar-veces">{t('{0} veces', lugar.tickets.length)}</span>
          {lugar.tickets.some((tk) => tk.falta_que_elija > 0) && (
            <span className="vjv-chip vjv-chip-aviso">{t('Falta que elijan')}</span>
          )}
          {reciente.personal && <span className="vjv-chip vjv-chip-personal">{t('Personal')}</span>}
        </span>
        <span className="vjb-consumo-monto">{formatMXN(lugar.total_cents)}</span>
        <Icon name="chevron-down" size={18} className={`vjb-lugar-chev${abierto ? ' abierto' : ''}`} />
      </button>
      {abierto && (
        <ul className="vjb-visitas" id={id} aria-label={t('Las veces en {0}', nombre)}>
          {lugar.tickets.map((tk) => (
            <li key={tk.id}>
              <ConGesto tk={tk} deslizar={deslizar} nombre={nombreDelLugar(tk.lugar, tk.tipo_lugar, t)}>
                <button type="button" className="vjb-consumo vjb-visita" onClick={() => onAbrirTicket(tk.id)}>
                  <span className="vjb-consumo-main">
                    <span className="vjb-visita-fecha">{fechaDelTicket(tk, idioma) ?? nombre}</span>
                    {tk.falta_que_elija > 0 && (
                      <span className="vjv-chip vjv-chip-aviso">{t('Falta que elija {0}', tk.falta_que_elija)}</span>
                    )}
                  </span>
                  <span className="vjb-consumo-monto">{formatMXN(tk.total_cents)}</span>
                </button>
              </ConGesto>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** D256 · el gesto sólo donde el dueño dice `puede_eliminar`; si no, la fila de siempre, que no se desliza. */
function ConGesto({ tk, deslizar, nombre, children }: {
  tk: TicketEnViaje;
  deslizar?: DeslizarConsumo;
  nombre: string;
  children: ReactNode;
}) {
  const refEliminar = useRef<HTMLButtonElement | null>(null);
  if (!deslizar || !tk.puede_eliminar) return <>{children}</>;
  return (
    <FilaDeslizable
      abierta={deslizar.abierta === tk.id}
      onAbrir={() => deslizar.onAbrir(tk.id)}
      onCerrar={deslizar.onCerrar}
      nombre={nombre}
      refEliminar={refEliminar}
      onEliminar={() => deslizar.onEliminar(tk, refEliminar.current)}
    >
      {children}
    </FilaDeslizable>
  );
}

function Miembros({ viaje: v, fotoDe }: { viaje: DetalleViaje; fotoDe?: (miembroId: string) => string | null }) {
  const { t } = useIdioma();
  return (
    <ul className="vjb-miembros">
      {v.miembros.map((m) => (
        <li key={m.id} className="vjb-fila">
          <AvatarDeViaje persona={m} foto={fotoDe?.(m.id) ?? null} />
          <span className="vjb-quien">
            <span className="vjb-nombre">{nombreDeMiembro(m, t)}</span>
          </span>
          <span className="vjb-monto">
            <span className="vjb-rotulo">{t('Pagó')}</span>
            {/* `null` sólo para los demás en un viaje cerrado, que no llega acá (Cerrados es otra pantalla). */}
            <span className="vjb-cifra">{m.pagado_cents === null ? '—' : formatMXN(m.pagado_cents)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
