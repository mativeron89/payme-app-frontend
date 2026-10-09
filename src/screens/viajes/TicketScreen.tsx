import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api';
import { denominatorBps } from '../../api/mesaPresentation';
import { errorDeViaje, type DetalleViaje, type ItemDelTicket, type MiembroViaje, type TicketDelViaje } from '../../api/viajes';
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
import { etiquetaPorcion } from '../queConsumisteView';
import { ListaDePresentes } from './TicketNuevoScreen';
import {
  alternarPresente,
  ausentesDelTicket,
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
  subtituloDelTicket,
  teTocaConSeleccion,
  topeDelPlato,
} from './ticketView';
import { iconoTipoLugar, nombreCompleto, nombreDePila, nombreDelLugar } from './viajesView';
import './viajes.css';
import './ticket.css';

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
      if (e.tipo === 'no_abierto') {
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

  const conPie = ticket !== null && ticket.forma === 'consumo' && ticket.puedo_elegir;

  return (
    <div className={conPie ? 'screen vj-con-pie vjt-pie-alto' : 'screen has-appbar'}>
      <AppHeaderBack userName={fullName(session) ?? undefined} onBack={() => goBack('viaje', viajeId)} />
      {ticket && viaje ? (
        <TicketVista
          ticket={ticket}
          miembros={viaje.miembros}
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
        />
      ) : (
        <TicketEstadoVista
          estado={estado.fase === 'no_disponible' ? 'no_disponible' : estado.fase === 'error' ? 'error' : 'cargando'}
          onReintentar={() => cargar()}
        />
      )}
      {!conPie && <AppBottomBar active={null} />}
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
      {/* Sin el ticket no hay lugar que nombrar: la tarjeta de título queda
          (el mismo alto) y, mientras carga, con la silueta del nombre. */}
      <div className="title-card">
        {estado === 'cargando' && <span className="sk-line tall w55 vjt-centrado" aria-hidden="true" />}
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
}

export function TicketVista(props: TicketVistaProps) {
  const { ticket, miembros } = props;
  const { t, idioma } = useIdioma();
  return (
    <>
      <div className="title-card">
        <h1 className="title-card-title">{nombreDelLugar(ticket.lugar, ticket.tipo_lugar, t)}</h1>
        <div className="title-card-sub">{subtituloDelTicket(ticket, miembros, idioma, t)}</div>
      </div>
      {ticket.forma === 'consumo' ? (
        <ConsumoVista {...props} />
      ) : ticket.forma === 'total' ? (
        <TotalVista ticket={ticket} miembros={miembros} />
      ) : (
        <IgualesVista {...props} />
      )}
    </>
  );
}

/** «Total del ticket» y «Te toca», como en 1j. */
function Totales({ ticket }: { ticket: TicketDelViaje }) {
  const { t } = useIdioma();
  return (
    <section className="vj-card vjt-totales">
      <div className="vjt-total-fila">
        <span className="vjt-total-rotulo">{t('Total del ticket')}</span>
        <span className="vjt-total-monto">{formatMXN(ticket.monto_cents)}</span>
      </div>
      <hr className="vjt-div" />
      <div className="vjt-total-fila vjt-total-fila--toca">
        <span className="vjt-total-rotulo">{t('Te toca')}</span>
        <span className="vjt-total-monto">{formatMXN(ticket.te_toca_cents)}</span>
      </div>
    </section>
  );
}

/** 1j · «Pagar el total»: invita quien lo pagó. */
function TotalVista({ ticket, miembros }: { ticket: TicketDelViaje; miembros: readonly MiembroViaje[] }) {
  const { t } = useIdioma();
  const pago = quienPago(ticket, miembros);
  const completo = pago ? nombreCompleto(pago, t) : t('Cuenta eliminada');
  const pila = pago ? nombreDePila(pago, t) : t('Cuenta eliminada');
  return (
    <div className="scroll vj-scroll">
      <section className="vj-card vjt-aviso">
        <span className="vjt-icono vjt-icono--centro" aria-hidden="true"><Icon name={iconoTipoLugar(ticket.tipo_lugar)} size={20} /></span>
        <h2 className="vjt-aviso-titulo">{ticket.pagaste_tu ? t('Invitas tú') : t('Invita {0}', pila)}</h2>
        <p className="vjt-aviso-texto">
          {ticket.pagaste_tu
            ? t('Pagaste el total de este ticket. Nadie te debe nada.')
            : t('{0} pagó el total de este ticket. No te toca nada.', completo)}
        </p>
      </section>
      <Totales ticket={ticket} />
    </div>
  );
}

/** «En partes iguales»: entre quiénes, y (si lo pagué y el viaje sigue abierto) quiénes estuvieron. */
function IgualesVista({ ticket, miembros, ausentes, guardando, onPresente, onGuardarPresentes }: TicketVistaProps) {
  const { t } = useIdioma();
  const candidatos = candidatosDelTicket(ticket.personas, miembros, t);
  const guardados = ausentesDelTicket(ticket.personas);
  const cambio = ausentes.size !== guardados.size || [...ausentes].some((id) => !guardados.has(id));
  return (
    <div className="scroll vj-scroll">
      <section className="vj-card">
        <h2 className="vjt-card-titulo">{t('Se divide entre los que estuvieron')}</h2>
        <p className="vjt-texto">{nombresPresentes(ticket.personas, miembros, t)}</p>
      </section>
      <Totales ticket={ticket} />
      {ticket.puedo_marcar_presentes && (
        <section className="vj-card" aria-labelledby="vjt-quienes">
          <h2 id="vjt-quienes" className="vjt-card-titulo">{t('¿Quiénes estuvieron?')}</h2>
          <p className="vjt-texto vjt-texto--ayuda">{t('Se divide entre los marcados. Desmarca a quien no estuvo.')}</p>
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
      )}
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
        <section className="vj-card vjt-consumos" aria-labelledby="vjt-que-consumiste">
          <h2 id="vjt-que-consumiste" className="vjt-card-titulo">{t('¿Qué consumiste?')}</h2>
          <ListaParaElegir {...props} />
        </section>
        {!ticket.puedo_elegir && <Totales ticket={ticket} />}
      </div>
      {ticket.puedo_elegir && (
        <div className="vj-pie">
          <div className="vjt-pie-fila">
            <span className="vjt-crece">
              <span className="vjt-pie-rotulo">{t('Te toca')}</span>
              <span className="vjt-sub">{t('Total del ticket {0}', formatMXN(ticket.monto_cents))}</span>
            </span>
            <span className="vjt-monto vjt-monto--grande">{formatMXN(teTocaConSeleccion(ticket, seleccion))}</span>
          </div>
          <button
            type="button"
            className="btn btn-navy"
            disabled={guardando}
            aria-busy={guardando || undefined}
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
        const nombreAria = i.quantity > 1 ? t('{0} por {1}', i.name, i.quantity) : i.name;
        const titulo = (clase: string) => (
          <span className="qc-titulo">
            {i.quantity > 1 && <span className="qc-cant">{i.quantity} ×</span>}
            <span className={clase}>{i.name}</span>
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
                  <div className="qc-selector" role="radiogroup" aria-label={t('Porción de {0}', nombreAria)}>
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
                    aria-label={t('Soltar {0}', i.name)}
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
