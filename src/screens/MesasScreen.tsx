import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useIdioma } from '../i18n/idioma';
import { api } from '../api';
import type { HistoryEntry, MovementDetailResponse } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { goBack, navigate } from '../router';
import { formatMXN } from '../utils/format';
import { fullName } from '../utils/identity';
import { AppBottomBar } from '../components/AppBottomBar';
import { AppHeaderBack } from '../components/AppHeader';
import { Icon, type IconName } from '../components/Icon';
import { UnirmeConCodigo } from '../components/UnirmeConCodigo';
import { FilaDeslizable } from '../components/FilaDeslizable';
import { useHojaModal } from '../components/useHojaModal';
import { useToast } from '../components/ui';
import { extractApiError } from '../api/errors';
import { resultadoDeOcultar, sePuedeOcultar, useCapacidadOcultar } from '../api/ocultar';
import { bpsLabel } from './mesaItemsView';
import { agruparDelPago, nombreConCantidad } from './agruparIguales';
import type { TuMesa } from '../api/misMesas';
import { olvidarLoDeMesas, ultimoVisto, useEsperaVisible } from '../api/ultimoVisto';
import { useSinLeer } from '../components/useSinLeer';
import { tuMesaEnCurso } from '../utils/labels';
import { useRegion } from '../preferences/RegionProvider';
import { personalDateLabel, personalZoneCaption } from '../utils/personalDates';
import {
  FRANJA_LABEL,
  franjaDe,
  mesasCerradas,
  traerDetallesMovimientos,
  traerHistorialCompleto,
  type Franja,
  type HistorialMesa,
} from './historialView';
import { FilaDeTitulo } from '../components/TarjetaDeTitulo';
import { useCapacidadViajes, viajesHabilitado } from '../api/viajes';
import type { VisitaDeViaje } from '../api/viajesVisitas';
import { FilaDeVisitaDeViaje } from './FilaDeVisitaDeViaje';
import { useFotosDeViajes } from './viajes/InsigniaDelViaje';
import { nombreDelLugar, parametroDeTicket } from './viajes/viajesView';
import {
  agregarSinRepetir,
  agruparLineaPorMes,
  claveDeRenglon,
  estadoDeLasVisitas,
  instanteDeRenglon,
  mezclarPorFecha,
  type FuenteDeMesas,
  type MesDeLinea,
  type RenglonDeMesas,
} from './mesasEnLinea';
import { nombreDePlato } from '../utils/nombreDePlato';
import { TicketDigitalDialog } from '../components/TicketDigitalDialog';
import { fotoDelTicketHabilitada, partesDeLaFoto, tieneFoto, useCapacidadFotoDelTicket } from '../api/fotoDelTicket';
import { useMiniaturasDeTickets, type OrigenDeFoto } from '../api/fotosDeTickets';
import { BotonDeMiniatura, FilaDeTicket, VisorDelTicket, type TicketDelVisor } from '../components/VisorDelTicket';
import { montoDeTuMesa, PantallaDelTicketDeMesa, subtituloDeTuMesa, textoEleccion } from './PantallaDelTicketDeMesa';

const CATEGORY_EMOJI: Record<string, IconName> = {
  italian: 'pasta',
  japanese: 'sushi',
  mexican: 'taco',
  cafe: 'coffee',
  other: 'dining',
};

/** El ícono ACOMPAÑA a la palabra, nunca la reemplaza (§1.10). */
const FRANJA_ICON: Record<Franja, IconName> = {
  manana: 'sun-rise',
  mediodia: 'sun-high',
  tarde: 'sun-low',
  noche: 'moon',
};

/** D466 · el origen de la foto del ticket de una mesa. */
function origenDeMesa(code: string): OrigenDeFoto {
  return { tipo: 'mesa', code };
}

/** D481 · 8 · el origen de la foto del ticket de un restaurante de un viaje. */
function origenDeVisita(v: VisitaDeViaje): OrigenDeFoto {
  return { tipo: 'viaje', viajeId: v.viaje.id, ticketId: v.ticket_id };
}

function fechaDeFila(iso: string, locale: string, t: (s: string, ...a: unknown[]) => string, zone: string | null): string {
  return personalDateLabel(iso, locale, zone, t);
}

/**
 * **Mesas ES el historial** — `SPEC_APP.md` §1.10, definido por Mati: *"una
 * forma más rápida de ir al histórico de mesas"*. Como nunca hay más de una
 * mesa abierta y ya se ve en Inicio, esta entrada de la barra lista las
 * CERRADAS; el título de la pantalla dice **Historial** aunque la etiqueta de
 * la barra diga "Mesas" por espacio.
 *
 * La mesa abierta NO se repite acá. Antes de `mesa_status` (v2.42.0) esta
 * pantalla no podía cumplirlo: el organizador que pagaba su parte veía su mesa
 * viva bajo un encabezado de mes, como si hubiera terminado. Y la sección
 * "Abiertas ahora" que vivía arriba se retiró con G-28 cerrado: el invitado ya
 * ve su mesa en Inicio, donde corresponde, no acá.
 *
 * El acordeón carga cada uno de MIS pagos con el endpoint owner-only
 * `GET /account/movements/:id`. Una mesa puede contener varios intentos
 * propios —pagar varias partes está ratificado—, por eso se consultan TODOS
 * los IDs agrupados y nunca se inventa un detalle a partir del total visible.
 *
 * D293 (Mati: «Un restaurante de un viaje» y «Sí, con el nombre del viaje (Recomendada)») · los restaurantes, bares y
 * cafés de mis viajes también están acá. Mesas es UNA lista por fecha, de la más reciente a la más vieja, en sus grupos
 * por mes: mis mesas, mis restaurantes de viaje y mis pagos, mezclados sin saltear ni repetir (`mesasEnLinea.ts`). Cada
 * renglón es el de siempre —la mesa con su gesto y su detalle, el pago con su acordeón— y el del viaje, nuevo
 * (`FilaDeVisitaDeViaje`). Antes las mesas iban arriba sin mes y los pagos abajo por mes: con una sola lista los viajes
 * quedan junto a las mesas y en sus meses a la vez.
 */
/** D237 · lo que se guarda de «Tus mesas»: la primera página y su cursor. */
interface PrimeraPaginaDeTusMesas {
  readonly mesas: TuMesa[];
  readonly nextCursor: string | null;
}

/** D293 · lo que se guarda de mis restaurantes de viaje: la primera página y su cursor. */
interface PrimeraPaginaDeVisitas {
  readonly visitas: VisitaDeViaje[];
  readonly nextCursor: string | null;
}

export function MesasScreen() {
  const { presentationZone } = useRegion();
  const { t, locale } = useIdioma();
  // E173-1 · sin «Fechas mostradas en …»: sólo el aviso de navegador degradado.
  const zoneCaption = personalZoneCaption(presentationZone, t);
  const { session } = useAuth();
  // D237 · lo último visto de esta cuenta: al volver a Mesas, las listas están
  // desde el primer cuadro y se actualizan por detrás.
  const [pagos, setPagos] = useState<HistoryEntry[] | null>(() => ultimoVisto.leer<HistoryEntry[]>('mesas.historial') ?? null);
  const [fallo, setFallo] = useState(false);
  const unread = useSinLeer();
  const [abierta, setAbierta] = useState<string | null>(null);
  /**
   * D481 · 3b · la pantalla del ticket de una mesa (sin ruta nueva: una
   * subvista de Mesas). Reemplaza al desplegable de D360-P09. Al volver, la
   * lista regresa a la misma posición de scroll.
   */
  const [pantallaDe, setPantallaDe] = useState<TuMesa | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scrollAlAbrir = useRef<number | null>(null);
  const filaQueAbrio = useRef<string | null>(null);
  /**
   * El detalle digital de una mesa (`GET /mesas/:code`, lectura, sin back
   * nuevo), en el mismo visor de Tus restaurantes. El foco vuelve al botón que
   * lo abrió. D481 · 1h · desde el visor de la foto se abre ENCIMA del visor
   * (`encima`) y su ✕ vuelve a la foto.
   */
  const [ticketCode, setTicketCode] = useState<string | null>(null);
  const [ticketEncima, setTicketEncima] = useState(false);
  const ticketTriggerRef = useRef<HTMLButtonElement | null>(null);
  const cerrarTicket = useCallback(() => { setTicketCode(null); setTicketEncima(false); }, []);
  const [detalles, setDetalles] = useState<Record<string, MovementDetailResponse[] | 'loading' | 'error'>>({});
  /**
   * AF-24 · «Tus mesas», de `GET /api/mesas/mine`. Con los pagos apagados, el
   * historial de PAGOS queda vacío aunque la persona haya estado en varias
   * mesas; esta lista es la única que las muestra. Se carga aparte y falla
   * aparte: un error acá no tapa los pagos, ni al revés.
   */
  const [misMesas, setMisMesas] = useState<TuMesa[] | null>(
    () => ultimoVisto.leer<PrimeraPaginaDeTusMesas>('mesas.tusMesas')?.mesas ?? null,
  );
  const [cursorMesas, setCursorMesas] = useState<string | null>(
    () => ultimoVisto.leer<PrimeraPaginaDeTusMesas>('mesas.tusMesas')?.nextCursor ?? null,
  );
  const [falloMesas, setFalloMesas] = useState(false);
  const [cargandoMasMesas, setCargandoMasMesas] = useState(false);
  /**
   * D466 · A · la foto del ticket en la fila, sólo con la capacidad encendida
   * (hoy, apagada: la fila de siempre y ningún pedido nuevo). `conFotoAlPedir`
   * recuerda si el último pedido de la lista ya negoció la foto: si la
   * capacidad se enciende después (la config llegó tarde), se vuelve a pedir.
   */
  const capacidadFoto = useCapacidadFotoDelTicket();
  const conFotoAlPedir = useRef(false);
  /** D481 · 8 · lo mismo para mis restaurantes de viaje (`GET /api/viajes/visitas`). */
  const visitasConFotoAlPedir = useRef(false);
  /**
   * D293 · mis restaurantes de viaje (`GET /api/viajes/visitas`), sólo con Viajes encendido. Se cargan y fallan aparte,
   * como las otras dos listas.
   */
  const capacidadViajes = useCapacidadViajes();
  const [configFallo, setConfigFallo] = useState(false);
  const [visitas, setVisitas] = useState<VisitaDeViaje[] | null>(
    () => ultimoVisto.leer<PrimeraPaginaDeVisitas>('mesas.visitas')?.visitas ?? null,
  );
  const [cursorVisitas, setCursorVisitas] = useState<string | null>(
    () => ultimoVisto.leer<PrimeraPaginaDeVisitas>('mesas.visitas')?.nextCursor ?? null,
  );
  const [falloVisitas, setFalloVisitas] = useState(false);
  const [cargandoMasVisitas, setCargandoMasVisitas] = useState(false);
  /** D293 · falló una página de «Ver más»: lo que ya se veía queda, y el botón reintenta. */
  const [falloMas, setFalloMas] = useState(false);
  /**
   * D293 · cada carga de cero de una lista sube su generación: una página de «Ver más» pedida antes llega tarde y no se
   * pega a la lista nueva.
   */
  const generacionMesas = useRef(0);
  const generacionVisitas = useRef(0);

  const cargarMisMesas = useCallback((desdeCero: boolean) => {
    setFalloMesas(false);
    generacionMesas.current += 1;
    // D237 · con lo último visto en pantalla se pide por detrás; «Reintentar»
    // empieza de cero.
    if (desdeCero) setMisMesas(null);
    // D466 · si este pedido negocia la foto del ticket (se decide en la fachada, con la capacidad de ahora).
    conFotoAlPedir.current = fotoDelTicketHabilitada();
    // T-01 · la cuenta se toma AL PEDIR.
    const turno = ultimoVisto.turno();
    api.getMyMesas({ detail: 'items' })
      .then((r) => {
        // Sólo la primera página: «Ver más mesas» no se guarda.
        const g = ultimoVisto.guardar<PrimeraPaginaDeTusMesas>(turno, 'mesas.tusMesas', {
          mesas: [...r.mesas],
          nextCursor: r.nextCursor,
        });
        if (!g) return;
        setMisMesas(g.valor.mesas);
        setCursorMesas(g.valor.nextCursor);
      })
      .catch(() => {
        if (!ultimoVisto.esDeAhora(turno)) return;
        ultimoVisto.olvidar('mesas.tusMesas');
        setMisMesas(null);
        setFalloMesas(true);
      });
  }, []);

  const cargarMasMesas = useCallback(() => {
    if (!cursorMesas || cargandoMasMesas) return;
    setCargandoMasMesas(true);
    setFalloMas(false);
    // T-01 · otra cuenta (o ninguna) vacía lo último visto, y `alVaciarse` vuelve a cargar de cero: sube la generación y
    // esta página, de la cuenta anterior, se descarta al llegar.
    const generacion = generacionMesas.current;
    const vigente = () => generacion === generacionMesas.current;
    api.getMyMesas({ cursor: cursorMesas, detail: 'items' })
      .then((r) => {
        if (!vigente()) return;
        setMisMesas((actual) => [...(actual ?? []), ...r.mesas]);
        setCursorMesas(r.nextCursor);
      })
      // D293 · lo que ya se veía queda: el botón reintenta la misma página.
      .catch(() => { if (vigente()) setFalloMas(true); })
      .finally(() => setCargandoMasMesas(false));
  }, [cursorMesas, cargandoMasMesas]);

  useEffect(() => {
    cargarMisMesas(false);
  }, [cargarMisMesas]);

  // D466 · la capacidad de la foto se encendió después del primer pedido: la lista se pide de nuevo, negociándola.
  useEffect(() => {
    if (capacidadFoto && !conFotoAlPedir.current) cargarMisMesas(false);
  }, [capacidadFoto, cargarMisMesas]);

  const cargarVisitas = useCallback((desdeCero: boolean) => {
    if (!viajesHabilitado()) return;
    setFalloVisitas(false);
    generacionVisitas.current += 1;
    if (desdeCero) setVisitas(null);
    visitasConFotoAlPedir.current = fotoDelTicketHabilitada();
    // T-01 · la cuenta se toma AL PEDIR.
    const turno = ultimoVisto.turno();
    api.getVisitasDeViajes()
      .then((r) => {
        const g = ultimoVisto.guardar<PrimeraPaginaDeVisitas>(turno, 'mesas.visitas', {
          visitas: [...r.visitas],
          nextCursor: r.nextCursor,
        });
        if (!g) return;
        setVisitas(g.valor.visitas);
        setCursorVisitas(g.valor.nextCursor);
      })
      .catch(() => {
        if (!ultimoVisto.esDeAhora(turno)) return;
        ultimoVisto.olvidar('mesas.visitas');
        setVisitas(null);
        setFalloVisitas(true);
      });
  }, []);

  const cargarMasVisitas = useCallback(() => {
    if (!cursorVisitas || cargandoMasVisitas) return;
    setCargandoMasVisitas(true);
    setFalloMas(false);
    // T-01 · otra cuenta (o ninguna) vacía lo último visto, y `alVaciarse` vuelve a cargar de cero: sube la generación y
    // esta página, de la cuenta anterior, se descarta al llegar.
    const generacion = generacionVisitas.current;
    const vigente = () => generacion === generacionVisitas.current;
    api.getVisitasDeViajes({ cursor: cursorVisitas })
      .then((r) => {
        if (!vigente()) return;
        setVisitas((actual) => agregarSinRepetir(actual, r.visitas));
        setCursorVisitas(r.nextCursor);
      })
      .catch(() => { if (vigente()) setFalloMas(true); })
      .finally(() => setCargandoMasVisitas(false));
  }, [cursorVisitas, cargandoMasVisitas]);

  useEffect(() => {
    if (capacidadViajes === 'encendida') cargarVisitas(false);
  }, [capacidadViajes, cargarVisitas]);

  // D481 · 8 · la capacidad de la foto se encendió después: las visitas se piden de nuevo, negociándola.
  useEffect(() => {
    if (capacidadFoto && capacidadViajes === 'encendida' && !visitasConFotoAlPedir.current) cargarVisitas(false);
  }, [capacidadFoto, capacidadViajes, cargarVisitas]);

  // D293 · sin saber todavía si Viajes está encendido, la lista espera la config; si no llega, sigue sin los viajes.
  useEffect(() => {
    if (capacidadViajes !== 'pendiente') return undefined;
    let vivo = true;
    api.getConfig().catch(() => { if (vivo) setConfigFallo(true); });
    return () => { vivo = false; };
  }, [capacidadViajes]);

  const cargarDetalle = useCallback((mesaCode: string, paymentIds: readonly string[]) => {
    setDetalles((actual) => ({ ...actual, [mesaCode]: 'loading' }));
    traerDetallesMovimientos(paymentIds, (id) => api.getMovement(id))
      .then((movements) => setDetalles((actual) => ({ ...actual, [mesaCode]: movements })))
      .catch(() => setDetalles((actual) => ({ ...actual, [mesaCode]: 'error' })));
  }, []);

  const abrirDetalle = useCallback((mesaCode: string, paymentIds: readonly string[]) => {
    if (abierta === mesaCode) {
      setAbierta(null);
      return;
    }
    setAbierta(mesaCode);
    if (detalles[mesaCode]) return;
    cargarDetalle(mesaCode, paymentIds);
  }, [abierta, cargarDetalle, detalles]);

  /**
   * TODO el historial antes de agrupar, sin "Cargar más": una página parcial
   * dejaría a una mesa partida en el borde con su total SUBCONTADO en
   * pantalla. O está todo, o es el estado de error — la falla a mitad de
   * carga propaga a propósito (ver `traerHistorialCompleto`).
   */
  const cargarHistorial = useCallback((desdeCero: boolean) => {
    setFallo(false);
    if (desdeCero) setPagos(null);
    // T-01 · la cuenta se toma AL PEDIR.
    const turno = ultimoVisto.turno();
    traerHistorialCompleto((limit, offset) =>
      api.getHistory({ limit, offset }).then((r) => r.history),
    )
      .then((h) => {
        const g = ultimoVisto.guardar(turno, 'mesas.historial', h);
        if (g) setPagos(g.valor);
      })
      .catch(() => {
        if (!ultimoVisto.esDeAhora(turno)) return;
        // O está todo o es el error (ver arriba): lo guardado tampoco se muestra.
        ultimoVisto.olvidar('mesas.historial');
        setPagos(null);
        setFallo(true);
      });
  }, []);

  useEffect(() => {
    cargarHistorial(false);
  }, [cargarHistorial]);

  // ─── AF-BORRAR-MESAS · D238/D239 · borrar de la app ──────────────────────
  // Es ocultar por persona: el servidor conserva todo. Sin la capacidad del
  // dueño no hay gesto.
  const capacidad = useCapacidadOcultar();
  const toast = useToast();
  /** La única tarjeta con «Eliminar» a la vista: de qué lista y qué mesa. */
  const [deslizada, setDeslizada] = useState<TarjetaDeslizada | null>(null);
  /** La mesa que espera la respuesta a «¿Borrar también su historial?». */
  const [preguntaMesa, setPreguntaMesa] = useState<TuMesa | null>(null);
  /** El aviso con «Deshacer»: el gesto se puede disparar sin querer. */
  const [aviso, setAviso] = useState<{ texto: string; deshacer: () => void } | null>(null);
  useEffect(() => {
    if (!aviso) return undefined;
    const reloj = window.setTimeout(() => setAviso(null), AVISO_DESHACER_MS);
    return () => window.clearTimeout(reloj);
  }, [aviso]);

  /**
   * 🔴 D293 · T-01 · otra cuenta (o ninguna): lo de la anterior se borra de la pantalla en el acto —sus mesas, sus pagos
   * y sus restaurantes de viaje— y se vuelve a pedir con la de ahora. Con otra persona de la misma familia la app no se
   * remonta: sin esto, B vería la lista de A hasta que llegara la suya.
   */
  useEffect(() => ultimoVisto.alVaciarse(() => {
    setVisitas(null);
    setCursorVisitas(null);
    setFalloVisitas(false);
    setMisMesas(null);
    setCursorMesas(null);
    setFalloMesas(false);
    setPagos(null);
    setFallo(false);
    setFalloMas(false);
    setAbierta(null);
    setPantallaDe(null);
    setDetalles({});
    setDeslizada(null);
    setPreguntaMesa(null);
    setAviso(null);
    // D466 · el visor de la cuenta anterior también se cierra (y el detalle digital).
    setVisor(null);
    setTicketCode(null);
    setTicketEncima(false);
    cargarMisMesas(false);
    cargarHistorial(false);
    cargarVisitas(false);
  }), [cargarMisMesas, cargarHistorial, cargarVisitas]);

  /**
   * Después de borrar o deshacer: lo guardado de las mesas (Tus mesas, el
   * historial, Inicio) y la campana se olvidan —el aviso de una mesa borrada
   * también sale—, y las listas se vuelven a pedir: el dueño ya las filtra.
   * D293 · también las visitas: ocultar la mesa que abrió el recibo de un ticket de viaje vuelve visita a ese ticket.
   */
  const olvidarYRecargar = useCallback(() => {
    olvidarLoDeMesas();
    ultimoVisto.olvidar('sinLeer');
    cargarMisMesas(false);
    cargarHistorial(false);
    cargarVisitas(false);
  }, [cargarMisMesas, cargarHistorial, cargarVisitas]);

  const cerrarDeslizada = useCallback((tarjeta: TarjetaDeslizada) => {
    setDeslizada((actual) => (mismaTarjeta(actual, tarjeta) ? null : actual));
  }, []);

  const fallaAlBorrar = useCallback((err: unknown, que: 'mesa' | 'pago') => {
    const { status, code } = extractApiError(err);
    const r = resultadoDeOcultar(status, code);
    toast(r === 'en_curso'
      ? t('Esta mesa volvió a estar en curso: todavía no se puede borrar.')
      : r === 'no_esta'
        ? (que === 'mesa' ? t('Esa mesa ya no está disponible.') : t('Ese pago ya no está disponible.'))
        : t('No pudimos borrarlo. Prueba de nuevo.'));
    olvidarYRecargar();
  }, [olvidarYRecargar, t, toast]);

  const deshacer = useCallback((texto: string, accion: () => Promise<unknown>) => {
    setAviso(null);
    accion()
      .then(() => { olvidarYRecargar(); toast(t('Volvió a tu app.')); })
      // Si falla, el aviso vuelve con su «Deshacer» para reintentar.
      .catch(() => setAviso({ texto: t('No pudimos deshacerlo.'), deshacer: () => deshacer(texto, accion) }));
  }, [olvidarYRecargar, t, toast]);

  const borrarMesa = useCallback((m: TuMesa, incluirHistorial: boolean) => {
    setPreguntaMesa(null);
    setDeslizada(null);
    // Se saca de la vista enseguida; la lista que vuelve del dueño manda.
    setMisMesas((actual) => actual?.filter((x) => x.code !== m.code) ?? actual);
    if (incluirHistorial) setPagos((actual) => actual?.filter((p) => p.mesa_code !== m.code) ?? actual);
    api.ocultarMesa(m.code, incluirHistorial)
      .then(() => {
        olvidarYRecargar();
        const texto = t('Borraste la mesa de tu app.');
        setAviso({ texto, deshacer: () => deshacer(texto, () => api.mostrarMesa(m.code)) });
      })
      .catch((err: unknown) => fallaAlBorrar(err, 'mesa'));
  }, [deshacer, fallaAlBorrar, olvidarYRecargar, t]);

  /** Un pago del historial: la tarjeta junta los pagos propios de esa mesa; se borran todos. */
  const borrarPagos = useCallback((h: HistorialMesa) => {
    setDeslizada(null);
    const ids = [...h.payment_ids];
    setPagos((actual) => actual?.filter((p) => !ids.includes(p.id)) ?? actual);
    Promise.all(ids.map((id) => api.ocultarPago(id)))
      .then(() => {
        olvidarYRecargar();
        const texto = ids.length > 1 ? t('Borraste los pagos de tu app.') : t('Borraste el pago de tu app.');
        setAviso({ texto, deshacer: () => deshacer(texto, () => Promise.all(ids.map((id) => api.mostrarPago(id)))) });
      })
      .catch((err: unknown) => fallaAlBorrar(err, 'pago'));
  }, [deshacer, fallaAlBorrar, olvidarYRecargar, t]);

  // ─── D293 · UNA lista por fecha: mesas, viajes y pagos ───────────────────
  const cerradas = useMemo(() => (pagos ? mesasCerradas(pagos) : null), [pagos]);
  const tusMesas = useMemo(() => (misMesas ? misMesas.filter((m) => !tuMesaEnCurso(m.status)) : null), [misMesas]);
  const estadoVisitas = estadoDeLasVisitas({
    capacidad: capacidadViajes, configFallo, fallo: falloVisitas, cargadas: visitas !== null,
  });
  const mezcla = useMemo(() => mezclarPorFecha<FuenteDeMesas, RenglonDeMesas>([
    {
      clave: 'mesas',
      estado: falloMesas ? 'fallo' : tusMesas === null ? 'cargando' : 'lista',
      renglones: (tusMesas ?? []).map((mesa) => ({ tipo: 'mesa', mesa })),
      hayMas: cursorMesas !== null,
    },
    {
      clave: 'viajes',
      estado: estadoVisitas,
      renglones: (visitas ?? []).map((visita) => ({ tipo: 'viaje', visita })),
      hayMas: cursorVisitas !== null,
    },
    {
      clave: 'pagos',
      estado: fallo ? 'fallo' : cerradas === null ? 'cargando' : 'lista',
      renglones: (cerradas ?? []).map((mesa) => ({ tipo: 'pago', mesa })),
      hayMas: false,
    },
  ], instanteDeRenglon), [tusMesas, falloMesas, cursorMesas, estadoVisitas, visitas, cursorVisitas, cerradas, fallo]);
  const meses = useMemo(
    () => agruparLineaPorMes(mezcla.renglones, locale, presentationZone),
    [mezcla, locale, presentationZone],
  );
  /** Las fotos de los viajes que aparecen (D255), una vez por viaje. */
  const viajesDeLasVisitas = useMemo(() => {
    if (!visitas) return null;
    const porId = new Map(visitas.map((v) => [v.viaje.id, { id: v.viaje.id, has_photo: v.viaje.has_photo }]));
    return [...porId.values()];
  }, [visitas]);
  const { fotoDe } = useFotosDeViajes(viajesDeLasVisitas);

  // ─── D466 · A + E · la miniatura del ticket y el visor ───────────────────
  /** Las mesas con foto: sólo con la capacidad encendida y si el dueño dice que hay miniatura. */
  const origenesConFoto = useMemo<OrigenDeFoto[] | null>(() => {
    if (!capacidadFoto || (!tusMesas && !visitas)) return null;
    // D481 · 8 · también los restaurantes de mis viajes con foto (`visitas[].ticket_image`).
    return [
      ...(tusMesas ?? []).filter((m) => tieneFoto(m.fotoDelTicket)).map((m) => (origenDeMesa(m.code))),
      ...(visitas ?? []).filter((v) => tieneFoto(v.ticket_image)).map((v) => origenDeVisita(v)),
    ];
  }, [capacidadFoto, tusMesas, visitas]);
  const miniaturas = useMiniaturasDeTickets(session, origenesConFoto);
  const conFotoEnLaFila = (m: TuMesa): boolean =>
    capacidadFoto !== null && tieneFoto(m.fotoDelTicket) && !miniaturas.sinFoto(origenDeMesa(m.code));
  const [visor, setVisor] = useState<{
    readonly tickets: readonly TicketDelVisor[];
    readonly indice: number;
    readonly mes: string | null;
    /** D481 · 8 · el visor de una visita de viaje: «Ver consumos» abre su ticket en el viaje. */
    readonly deVisita?: VisitaDeViaje;
  } | null>(null);
  const fotoTriggerRef = useRef<HTMLButtonElement | null>(null);
  const cerrarVisor = useCallback(() => setVisor(null), []);
  const ticketDelVisor = (m: TuMesa): TicketDelVisor => {
    const eleccion = textoEleccion(m, t);
    const cuando = subtituloDeTuMesa(m, locale, t, presentationZone);
    return {
      clave: m.code,
      origen: origenDeMesa(m.code),
      foto: m.fotoDelTicket ?? { thumb: false, full: false },
      titulo: m.restaurante ?? t('Mesa {0}', m.code),
      monto: null,
      detalle: eleccion ? [cuando, eleccion] : [cuando],
    };
  };
  /** E · desliza entre los tickets con foto del mismo mes que la fila tocada. */
  const abrirVisor = (m: TuMesa, mes: MesDeLinea, boton: HTMLButtonElement) => {
    const delMes = mes.renglones
      .flatMap((r) => (r.tipo === 'mesa' && conFotoEnLaFila(r.mesa) ? [r.mesa] : []));
    const indice = Math.max(0, delMes.findIndex((x) => x.code === m.code));
    fotoTriggerRef.current = boton;
    setVisor({ tickets: delMes.map(ticketDelVisor), indice, mes: mes.label === 'Sin fecha' ? t('Sin fecha') : mes.label });
  };
  /** D481 · 8 · la miniatura de una visita de viaje: el visor con ese solo ticket. */
  const abrirVisorDeVisita = (v: VisitaDeViaje, boton: HTMLButtonElement) => {
    if (!v.ticket_image) return;
    fotoTriggerRef.current = boton;
    setVisor({
      tickets: [{
        clave: v.ticket_id,
        origen: origenDeVisita(v),
        foto: v.ticket_image,
        titulo: nombreDelLugar(v.lugar, v.tipo_lugar, t),
        monto: null,
        detalle: [personalDateLabel(v.instante, locale, presentationZone, t), v.viaje.nombre],
      }],
      indice: 0,
      mes: null,
      deVisita: v,
    });
  };
  const fotoDeVisita = (v: VisitaDeViaje) => (
    capacidadFoto && tieneFoto(v.ticket_image) && !miniaturas.sinFoto(origenDeVisita(v))
      ? { url: miniaturas.urlDe(origenDeVisita(v)), estado: miniaturas.estadoDe(origenDeVisita(v)) }
      : null
  );
  /** D481 · 3b · desde la pantalla del ticket: el visor con ese solo ticket, «Foto del ticket». */
  const abrirVisorDeUna = (m: TuMesa, boton: HTMLButtonElement) => {
    fotoTriggerRef.current = boton;
    setVisor({ tickets: [ticketDelVisor(m)], indice: 0, mes: null });
  };

  // ─── D481 · 3b · la pantalla del ticket ──────────────────────────────────
  const abrirPantalla = (m: TuMesa) => {
    scrollAlAbrir.current = scrollRef.current?.scrollTop ?? 0;
    filaQueAbrio.current = m.code;
    setPantallaDe(m);
  };
  const volverDePantalla = useCallback(() => setPantallaDe(null), []);
  // Al volver: la lista en la misma posición, y el foco en la fila que se tocó.
  useLayoutEffect(() => {
    if (pantallaDe !== null || scrollAlAbrir.current === null) return;
    if (scrollRef.current) scrollRef.current.scrollTop = scrollAlAbrir.current;
    scrollAlAbrir.current = null;
    const code = filaQueAbrio.current;
    filaQueAbrio.current = null;
    if (code) scrollRef.current?.querySelector<HTMLButtonElement>(`[data-mesa="${CSS.escape(code)}"] button.fila-ticket`)?.focus({ preventScroll: true });
  }, [pantallaDe]);
  /** La mesa de la pantalla, con lo último de la lista (si se recargó por detrás). */
  const mesaDePantalla = pantallaDe ? (tusMesas?.find((x) => x.code === pantallaDe.code) ?? pantallaDe) : null;

  const cargandoMas = cargandoMasMesas || cargandoMasVisitas;
  const verMas = () => {
    if (mezcla.conMas.includes('mesas')) cargarMasMesas();
    if (mezcla.conMas.includes('viajes')) cargarMasVisitas();
  };

  // D237 · la primera carga muestra su esqueleto sólo si tarda más de 300 ms.
  const esperaVisible = useEsperaVisible(mezcla.renglones.length === 0 && mezcla.cargando);
  /** El vacío «Todavía no cerraste…» sólo si ninguna lista tiene nada y ninguna falló. */
  const vacio = !falloMesas && !fallo && !falloVisitas && mezcla.renglones.length === 0 && !mezcla.cargando
    && mezcla.conMas.length === 0;
  const hayLista = mezcla.renglones.length > 0 || (!mezcla.cargando && mezcla.conMas.length > 0);

  const avisoDeFuente = (titulo: string, reintentar: () => void, alerta: boolean) => (
    <div className="state-error" role={alerta ? 'alert' : undefined}>
      <div className="state-error-row">
        <Icon name="x-circle" size={22} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="state-error-title">{titulo}</div>
          <p className="state-error-body">{t('Revisa la conexión y prueba de nuevo.')}</p>
        </div>
      </div>
      <button type="button" className="btn btn-ghost btn-sm" onClick={reintentar}>
        {t('Reintentar')}
      </button>
    </div>
  );

  const filaDeMesa = (m: TuMesa, mes: MesDeLinea) => {
    const conFoto = conFotoEnLaFila(m);
    const nombre = m.restaurante ?? t('Mesa {0}', m.code);
    const icono = CATEGORY_EMOJI[m.categoria ?? ''] ?? 'dining';
    const claveGesto = tarjetaDeTusMesas(m.code);
    // D481 · 2a · 2d · la fila es miniatura (o ícono), nombre y monto; sin fecha, estado ni «Elegiste…», que pasan a la
    // pantalla del ticket (3b). Toda la fila la abre; la miniatura es otro botón, que abre el visor (D466 · E).
    const miniatura = conFoto ? (
      <BotonDeMiniatura
        nombre={nombre}
        url={miniaturas.urlDe(origenDeMesa(m.code))}
        estado={miniaturas.estadoDe(origenDeMesa(m.code))}
        icono={icono}
        onAbrir={(boton) => abrirVisor(m, mes, boton)}
        partes={partesDeLaFoto(m.fotoDelTicket)}
      />
    ) : undefined;
    return (
      <div key={`mesa:${m.id}`} className="hist-item tu-mesa fila-ticket-item" data-mesa={m.code}>
        <ConGesto
          activo={sePuedeOcultar(capacidad, m.status)}
          abierta={mismaTarjeta(deslizada, claveGesto)}
          onAbrir={() => setDeslizada(claveGesto)}
          onCerrar={() => cerrarDeslizada(claveGesto)}
          nombre={nombre}
          onEliminar={() => setPreguntaMesa(m)}
        >
          <FilaDeTicket
            icono={icono}
            nombre={nombre}
            monto={montoDeTuMesa(m)}
            miniatura={miniatura}
            onAbrir={() => abrirPantalla(m)}
          />
        </ConGesto>
      </div>
    );
  };

  const filaDePago = (m: HistorialMesa) => {
    const franja = franjaDe(m.date, presentationZone);
    const on = abierta === m.mesa_code;
    const detalle = detalles[m.mesa_code];
    const claveGesto = tarjetaDelHistorial(m.mesa_code);
    return (
      <div key={`pago:${m.mesa_code}`} className={`hist-item ${on ? 'on' : ''}`}>
        <ConGesto
          activo={sePuedeOcultar(capacidad, m.mesa_status)}
          abierta={mismaTarjeta(deslizada, claveGesto)}
          onAbrir={() => setDeslizada(claveGesto)}
          onCerrar={() => cerrarDeslizada(claveGesto)}
          nombre={m.restaurant}
          onEliminar={() => borrarPagos(m)}
        >
        <button
          type="button"
          className="hist-row"
          aria-expanded={on}
          onClick={() => abrirDetalle(m.mesa_code, m.payment_ids)}
        >
          <span aria-hidden="true">
            <Icon name={CATEGORY_EMOJI[m.category] ?? 'dining'} size={22} />
          </span>
          <div className="hist-main">
            <div className="hist-rest">{m.restaurant}</div>
            <div className="hist-meta">
              {fechaDeFila(m.date, locale, t, presentationZone)}
              {franja && (
                <>
                  {' · '}
                  {t(FRANJA_LABEL[franja])}{' '}
                  <Icon
                    name={FRANJA_ICON[franja]}
                    size={14}
                    className="ico-inline"
                  />
                </>
              )}
            </div>
          </div>
          <div className="hist-amt">{formatMXN(m.amount_cents)}</div>
          <span className={`hist-chevron ${on ? 'on' : ''}`} aria-hidden="true">
            <Icon name="chevron-down" size={20} />
          </span>
        </button>
        {on && (
          <div className="hist-detail" aria-live="polite">
            {detalle === 'loading' && (
              <div className="loading">{t('Cargando detalle…')}</div>
            )}
            {detalle === 'error' && (
              <div className="state-error hist-detail-error" role="alert">
                <div className="state-error-title">{t('No pudimos cargar el detalle')}</div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => cargarDetalle(m.mesa_code, m.payment_ids)}
                >
                  {t('Reintentar')}
                </button>
              </div>
            )}
            {Array.isArray(detalle) && detalle.map((movement, paymentIndex) => (
              <section key={movement.id} className="hist-payment" aria-label={t('Pago {0}', paymentIndex + 1)}>
                {/* D240 punto 16 · los iguales de este pago, juntos. */}
                {movement.items.length > 0 ? agruparDelPago(movement.id, movement.items).map((g) => (
                  <div key={g.key} className="hist-detail-row">
                    <span className="hist-detail-name">
                      <span>{nombreConCantidad(g.cantidad, nombreDePlato(g.primero.name))}</span>
                      {g.primero.declared_fraction_bps != null && (
                        <span className="hist-detail-declared">
                          {t('Declaraste {0}', bpsLabel(g.primero.declared_fraction_bps))}
                        </span>
                      )}
                    </span>
                    {g.montoCents != null && (
                      <span className="hist-detail-amount">{formatMXN(g.montoCents)}</span>
                    )}
                  </div>
                )) : (
                  <p className="hist-detail-empty">{t('Este pago no declaró consumos.')}</p>
                )}
                {movement.tip_amount_cents > 0 && (
                  <div className="hist-detail-row hist-detail-tip">
                    <span>{t('Propina')}</span>
                    <span className="hist-detail-amount">{formatMXN(movement.tip_amount_cents)}</span>
                  </div>
                )}
              </section>
            ))}
          </div>
        )}
        </ConGesto>
      </div>
    );
  };

  const renglon = (r: RenglonDeMesas, mes: MesDeLinea) => {
    switch (r.tipo) {
      case 'mesa': return filaDeMesa(r.mesa, mes);
      case 'pago': return filaDePago(r.mesa);
      case 'viaje': return (
        <FilaDeVisitaDeViaje
          key={claveDeRenglon(r)}
          visita={r.visita}
          foto={r.visita.viaje.has_photo ? fotoDe(r.visita.viaje.id) : null}
          miniatura={fotoDeVisita(r.visita)}
          onVerFoto={(boton) => abrirVisorDeVisita(r.visita, boton)}
        />
      );
    }
  };

  const modales = (
    <>
      {ticketCode && (
        <TicketDigitalDialog
          code={ticketCode}
          onClose={cerrarTicket}
          returnFocusRef={ticketTriggerRef}
          encima={ticketEncima}
        />
      )}
      {visor && (
        <VisorDelTicket
          session={session}
          tickets={visor.tickets}
          indiceInicial={visor.indice}
          titulo={(i, n) => (visor.mes === null ? t('Foto del ticket') : t('Ticket {0} de {1} · {2}', i + 1, n, visor.mes))}
          onCerrar={cerrarVisor}
          onVerConsumos={(ticket, boton) => {
            // D481 · 8 · de una visita de viaje: su ticket, en el viaje (como tocar la fila).
            if (visor.deVisita) {
              const v = visor.deVisita;
              setVisor(null);
              navigate('viaje-ticket', parametroDeTicket(v.viaje.id, v.ticket_id));
              return;
            }
            // D481 · 1h · el detalle digital de esa mesa se abre ENCIMA del visor; su ✕ vuelve a la foto y el foco, a
            // «Ver consumos».
            ticketTriggerRef.current = boton;
            setTicketEncima(true);
            setTicketCode(ticket.clave);
          }}
          returnFocusRef={fotoTriggerRef}
        />
      )}
    </>
  );

  if (mesaDePantalla) {
    const conFoto = conFotoEnLaFila(mesaDePantalla);
    const origen = origenDeMesa(mesaDePantalla.code);
    return (
      <>
        <PantallaDelTicketDeMesa
          mesa={mesaDePantalla}
          zona={presentationZone}
          userName={fullName(session) ?? undefined}
          unread={unread}
          onBell={() => navigate('avisos')}
          onVolver={volverDePantalla}
          foto={conFoto ? { url: miniaturas.urlDe(origen), estado: miniaturas.estadoDe(origen) } : null}
          onVerFoto={(boton) => abrirVisorDeUna(mesaDePantalla, boton)}
          onVerDetalle={(boton) => {
            ticketTriggerRef.current = boton;
            setTicketEncima(false);
            setTicketCode(mesaDePantalla.code);
          }}
        />
        {modales}
      </>
    );
  }

  return (
    <div className="screen has-appbar">
      <AppHeaderBack
        userName={fullName(session) ?? undefined}
        onBack={() => goBack('home')}
        unread={unread}
        onBell={() => navigate('avisos')}
      />
      {/* D223 · turno 2 · 2.1: la burbuja dice «Mesas» (antes «Historial»,
          §1.10), porque arriba del historial vive ahora «Unirme con código». */}
      <div className="title-card">
        <FilaDeTitulo icono="mesa">
          <h1 className="title-card-title">{t('Mesas')}</h1>
        </FilaDeTitulo>
      </div>

      <div className="scroll history-scroll" ref={scrollRef}>
        {/* D219 · D223-3 · «Unirme con código», sólo acá: una fila que se abre
            en el lugar, arriba del historial. */}
        <UnirmeConCodigo />
        {zoneCaption && <p className="caption">{zoneCaption}</p>}

        {/* D293 · una lista que falla tiene su aviso, arriba; las otras se siguen viendo. */}
        {falloMesas && avisoDeFuente(t('No pudimos cargar tus mesas'), () => cargarMisMesas(true), true)}
        {falloVisitas && avisoDeFuente(t('No pudimos cargar los restaurantes de tus viajes'), () => cargarVisitas(true), true)}
        {fallo && avisoDeFuente(t('No pudimos cargar tu historial'), () => cargarHistorial(true), false)}

        {hayLista ? (
          <section className="tus-mesas" aria-label={t('Tus mesas')}>
            {meses.map((g) => (
              <section key={g.key} aria-label={g.label === 'Sin fecha' ? t('Sin fecha') : g.label}>
                <h2 className="mes-sticky">{g.label === 'Sin fecha' ? t('Sin fecha') : g.label}</h2>
                {g.renglones.map((r) => renglon(r, g))}
              </section>
            ))}
            {!mezcla.cargando && mezcla.conMas.length > 0 && (
              <>
                {falloMas && (
                  <p className="state-error-body" role="alert">{t('No pudimos cargar más. Prueba de nuevo.')}</p>
                )}
                <button type="button" className="btn btn-ghost btn-sm" onClick={verMas} disabled={cargandoMas}>
                  {cargandoMas ? t('Cargando…') : t('Ver más mesas')}
                </button>
              </>
            )}
          </section>
        ) : mezcla.cargando ? (
          /* D237 · Mati, en su video: 4 filas esqueleto y después eran 2 mesas, y
             saltaba el alto. Una fila neutra, y sólo si la primera carga tarda
             más de 300 ms. */
          esperaVisible ? (
            <div aria-busy="true" aria-label={t('Cargando tus mesas')}>
              <div className="pago-row sk">
                <span className="sk-line w55" />
                <span className="sk-line w40" />
              </div>
            </div>
          ) : null
        ) : vacio ? (
          /* Vacío REAL: sin borde, único estado del sistema que no lo lleva.
             AF-24 · y sólo si ninguna lista tiene nada: con los pagos apagados,
             no tener pagos no es no haber estado en ninguna mesa. */
          <div className="mesa-empty">
            <div className="mesa-empty-title">{t('Todavía no cerraste ninguna mesa.')}</div>
          </div>
        ) : null}

      </div>

      {preguntaMesa && (
        <HojaBorrarMesa
          onSi={() => borrarMesa(preguntaMesa, true)}
          onNo={() => borrarMesa(preguntaMesa, false)}
          onCancelar={() => { setPreguntaMesa(null); setDeslizada(null); }}
        />
      )}
      {aviso && (
        <div className="aviso-deshacer" role="status">
          <span>{aviso.texto}</span>
          <button type="button" className="aviso-deshacer-boton" onClick={aviso.deshacer}>{t('Deshacer')}</button>
        </div>
      )}
      {modales}
      <AppBottomBar active="mesas" />
    </div>
  );
}

/** AF-BORRAR-MESAS · qué tarjeta tiene «Eliminar» a la vista (una sola a la vez). */
interface TarjetaDeslizada {
  readonly lista: 'tusMesas' | 'historial';
  readonly code: string;
}

const tarjetaDeTusMesas = (code: string): TarjetaDeslizada => ({ lista: 'tusMesas', code });
const tarjetaDelHistorial = (code: string): TarjetaDeslizada => ({ lista: 'historial', code });

function mismaTarjeta(a: TarjetaDeslizada | null, b: TarjetaDeslizada): boolean {
  return a !== null && a.lista === b.lista && a.code === b.code;
}

/** AF-BORRAR-MESAS · lo que dura a la vista el aviso con «Deshacer». */
const AVISO_DESHACER_MS = 8000;

/** El gesto sólo donde se puede borrar; si no, la tarjeta de siempre. */
function ConGesto({
  activo,
  children,
  ...props
}: {
  activo: boolean;
  abierta: boolean;
  onAbrir: () => void;
  onCerrar: () => void;
  nombre: string;
  onEliminar: () => void;
  children: ReactNode;
}) {
  return activo ? <FilaDeslizable {...props}>{children}</FilaDeslizable> : <>{children}</>;
}

/**
 * AF-BORRAR-MESAS · D238 · al borrar una mesa, la pregunta por su historial. El
 * texto dice «de tu app» y que PayMe conserva el registro: nunca que PayMe
 * borró el dato. El foco entra en «No, sólo la mesa», la que borra menos; el ✕,
 * Escape y el velo no borran nada.
 */
function HojaBorrarMesa({ onSi, onNo, onCancelar }: { onSi: () => void; onNo: () => void; onCancelar: () => void }) {
  const { t } = useIdioma();
  const hoja = useRef<HTMLDivElement | null>(null);
  const no = useRef<HTMLButtonElement | null>(null);
  useHojaModal(hoja, no, onCancelar);
  return createPortal(
    <div className="sheet-overlay" onClick={onCancelar}>
      <div
        ref={hoja}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t('¿Borrar también su historial?')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-head">
          <span className="sheet-title">{t('¿Borrar también su historial?')}</span>
          <button type="button" className="sheet-close" aria-label={t('Cerrar')} onClick={onCancelar}>✕</button>
        </div>
        <p className="ocultar-mesa-texto">
          {t('La mesa se borra de tu app; PayMe conserva el registro. Su historial son tus pagos de esa mesa.')}
        </p>
        <div className="ocultar-mesa-acciones">
          <button type="button" className="btn btn-navy" onClick={onSi}>{t('Sí, también el historial')}</button>
          <button ref={no} type="button" className="btn btn-ghost" onClick={onNo}>{t('No, sólo la mesa')}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
