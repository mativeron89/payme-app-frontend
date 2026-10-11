import { useId, useRef, useState } from 'react';
import {
  MAX_DESCRIPCION_GASTO, TIPOS_LUGAR, type CorreccionDeTicket, type MiembroViaje, type OrigenTicket, type TicketDelViaje,
} from '../../api/viajes';
import { Icon } from '../../components/Icon';
import { useIdioma } from '../../i18n/idioma';
import { formatMXN } from '../../utils/format';
import {
  agregarRenglon,
  avisoPrevio,
  borradorDe,
  cambiarRenglon,
  evaluarCorreccion,
  evaluarPagadores,
  leerMontoOCero,
  MAX_CANTIDAD,
  MAX_LUGAR,
  MAX_NOMBRE_RENGLON,
  MAX_RENGLONES,
  montosEnPartesIguales,
  montosIniciales,
  nombreDePagador,
  nombreNormal,
  pedidoFinal,
  sacarRenglon,
  textoDelProblema,
  type Borrador,
  type BorradorEscaneado,
  type BorradorGasto,
  type EvaluacionDePagadores,
  type RenglonEnEdicion,
} from './corregirTicketView';
import { FilasDelTotal } from './FilasDelTotal';
import { fechaDelEscaneo, filasDelTotal } from './ticketView';
import { etiquetaTipoLugar, nombreDelLugar, type T } from './viajesView';
import './viajes.css';
import './viaje.css';
import './crear.css';
import './ticket.css';

/**
 * D278-3 · D282-2 · corregir un ticket ya cargado (un modo de la pantalla del ticket, P4 del plan): en un escaneado, el
 * nombre del lugar, el tipo, la fecha y la hora, cada renglón (nombre, cantidad y precio unitario, agregar y sacar), y el
 * servicio, los descuentos y el IVA aparte; en un gasto a mano, la descripción y el monto. El total recalculado a la
 * vista, el aviso previo si se van a borrar elecciones y, con dos o más pagadores y otro total, los montos nuevos.
 * «Guardar» manda sólo lo que cambió. La cuenta la hace `corregirTicketView.ts`.
 */
export interface CorregirTicketVistaProps {
  ticket: TicketDelViaje;
  origen: OrigenTicket;
  miembros: readonly MiembroViaje[];
  enviando: boolean;
  onGuardar: (pedido: CorreccionDeTicket) => void;
  /** Para las pruebas: con qué arranca. Sin él, el ticket tal como está. */
  borradorInicial?: Borrador;
  montosInicialesDePagadores?: readonly string[];
}

export function CorregirTicketVista({
  ticket, origen, miembros, enviando, onGuardar, borradorInicial, montosInicialesDePagadores,
}: CorregirTicketVistaProps) {
  const { t, idioma } = useIdioma();
  const [borrador, setBorrador] = useState<Borrador>(() => borradorInicial ?? borradorDe(ticket, origen));
  const [montos, setMontos] = useState<readonly string[]>(() => montosInicialesDePagadores ?? montosIniciales(ticket));
  const nuevos = useRef(0);
  const evaluacion = evaluarCorreccion(ticket, borrador);
  const pagadores = evaluarPagadores(ticket, montos, evaluacion.total, miembros, t);
  const pedido = pedidoFinal(evaluacion, pagadores);
  // El pie: primero lo que impide guardar, después el aviso previo.
  const mensaje = evaluacion.problema !== null ? textoDelProblema(evaluacion.problema, t)
    : pagadores.aviso ?? avisoPrevio(ticket, borrador, t);
  const gasto = borrador.tipo === 'gasto';
  const fecha = fechaDelEscaneo(ticket.fecha_ticket ? { date: ticket.fecha_ticket, time: ticket.hora_ticket } : undefined, idioma);
  const sub = gasto ? ticket.lugar ?? '' : [nombreDelLugar(ticket.lugar, ticket.tipo_lugar, t), fecha].filter(Boolean).join(' · ');
  const bloqueDePagadores = pagadores.pide && evaluacion.total !== null && !pagadores.ausente && (
    <MontosDePagadores
      ticket={ticket} miembros={miembros} montos={montos} total={evaluacion.total} evaluacion={pagadores} deshabilitado={enviando}
      onMontos={setMontos}
    />
  );
  return (
    <>
      <div className="title-card">
        <h1 className="title-card-title">{gasto ? t('Corregir gasto') : t('Corregir ticket')}</h1>
        {sub && <div className="title-card-sub">{sub}</div>}
      </div>
      <div className="scroll vj-scroll">
        {borrador.tipo === 'gasto' ? (
          <>
            <CamposDelGasto
              borrador={borrador} antes={evaluacion.cambiaTotal ? ticket.total_cents : null} deshabilitado={enviando}
              onCambio={setBorrador}
            />
            {bloqueDePagadores}
          </>
        ) : (
          <>
            <CamposDelLugar borrador={borrador} deshabilitado={enviando} onCambio={setBorrador} />
            <Renglones
              borrador={borrador} deshabilitado={enviando} onCambio={setBorrador}
              onAgregar={() => setBorrador((b) => agregarRenglon(b as BorradorEscaneado, `nuevo-${++nuevos.current}`))}
            />
            <Ajustes borrador={borrador} deshabilitado={enviando} onCambio={setBorrador} />
            <section className="vj-card vjt-totales">
              {evaluacion.cuenta && <FilasDelTotal filas={filasDelTotal(evaluacion.cuenta)} />}
              <div className="vjt-total-fila">
                <span className="vjt-total-rotulo">{t('Total del ticket')}</span>
                <span className="vjt-total-monto">{evaluacion.total !== null ? formatMXN(evaluacion.total) : '—'}</span>
              </div>
              {evaluacion.cambiaTotal && <p className="vjr-antes">{t('Antes {0}', formatMXN(ticket.total_cents))}</p>}
            </section>
            {bloqueDePagadores}
          </>
        )}
      </div>
      <div className="vj-pie">
        {mensaje && <p className="vjq-aviso vjq-aviso--pie" role="status">{mensaje}</p>}
        <button
          type="button"
          className="btn btn-navy"
          disabled={pedido === null || enviando}
          aria-busy={enviando || undefined}
          onClick={() => { if (pedido !== null && !enviando) onGuardar(pedido); }}
        >
          {t('Guardar')}
        </button>
      </div>
    </>
  );
}

type Cambio<B> = (b: B | ((x: B) => B)) => void;

function CamposDelGasto({ borrador, antes, deshabilitado, onCambio }: {
  borrador: BorradorGasto;
  antes: number | null;
  deshabilitado: boolean;
  onCambio: Cambio<Borrador>;
}) {
  const { t } = useIdioma();
  return (
    <section className="vj-card vjm-campos">
      <label className="vjm-campo">
        <span className="vjm-rotulo">{t('Descripción')}</span>
        <input
          className="vjm-input"
          value={borrador.descripcion}
          maxLength={MAX_DESCRIPCION_GASTO}
          disabled={deshabilitado}
          onChange={(e) => onCambio({ ...borrador, descripcion: e.target.value })}
        />
      </label>
      <label className="vjm-campo">
        <span className="vjm-rotulo">{t('Monto')}</span>
        <input
          className="vjm-input vjm-monto"
          inputMode="decimal"
          value={borrador.monto}
          placeholder="$0"
          disabled={deshabilitado}
          onChange={(e) => onCambio({ ...borrador, monto: e.target.value.replace(/[^0-9.,$]/g, '') })}
        />
      </label>
      {antes !== null && <p className="vjr-antes">{t('Antes {0}', formatMXN(antes))}</p>}
    </section>
  );
}

function CamposDelLugar({ borrador, deshabilitado, onCambio }: {
  borrador: BorradorEscaneado;
  deshabilitado: boolean;
  onCambio: Cambio<Borrador>;
}) {
  const { t } = useIdioma();
  const id = useId();
  return (
    <section className="vj-card vjm-campos">
      <label className="vjm-campo">
        <span className="vjm-rotulo">{t('Nombre del lugar')}</span>
        <input
          className="vjm-input"
          value={borrador.lugar}
          maxLength={MAX_LUGAR}
          placeholder={etiquetaTipoLugar(borrador.tipo_lugar, t)}
          disabled={deshabilitado}
          onChange={(e) => onCambio({ ...borrador, lugar: e.target.value })}
        />
      </label>
      <div>
        <h2 id={`${id}-tipo`} className="vjt-rotulo">{t('Tipo de lugar')}</h2>
        <div className="vjt-chips" role="radiogroup" aria-labelledby={`${id}-tipo`}>
          {TIPOS_LUGAR.map((x) => (
            <button
              key={x}
              type="button"
              role="radio"
              aria-checked={x === borrador.tipo_lugar}
              className="vjt-chip"
              disabled={deshabilitado}
              onClick={() => onCambio({ ...borrador, tipo_lugar: x })}
            >
              {etiquetaTipoLugar(x, t)}
            </button>
          ))}
        </div>
      </div>
      <div className="vjc-fechas">
        <div className="vjc-fecha">
          <label className="vjc-sub" htmlFor={`${id}-fecha`}>{t('Fecha')}</label>
          <input
            id={`${id}-fecha`}
            className="input vjc-input"
            type="date"
            value={borrador.fecha}
            disabled={deshabilitado}
            // Sin fecha, la hora se va con ella: el dueño pide una fecha para la hora.
            onChange={(e) => onCambio({ ...borrador, fecha: e.target.value, ...(e.target.value === '' && { hora: '' }) })}
          />
        </div>
        <div className="vjc-fecha">
          <label className="vjc-sub" htmlFor={`${id}-hora`}>{t('Hora')}</label>
          <input
            id={`${id}-hora`}
            className="input vjc-input"
            type="time"
            value={borrador.fecha === '' ? '' : borrador.hora}
            disabled={deshabilitado || borrador.fecha === ''}
            onChange={(e) => onCambio({ ...borrador, hora: e.target.value })}
          />
        </div>
      </div>
    </section>
  );
}

/** Los rótulos de un renglón para el lector de pantalla: por su nombre, o «el renglón nuevo» mientras no tiene. */
function rotulosDelRenglon(r: RenglonEnEdicion, t: T) {
  const n = nombreNormal(r.name);
  return n === ''
    ? { nombre: t('Nombre del renglón nuevo'), menos: t('Uno menos del renglón nuevo'), mas: t('Uno más del renglón nuevo'),
      precio: t('Precio del renglón nuevo'), sacar: t('Sacar el renglón nuevo') }
    : { nombre: t('Nombre de {0}', n), menos: t('Uno menos de {0}', n), mas: t('Uno más de {0}', n),
      precio: t('Precio de {0}', n), sacar: t('Sacar {0}', n) };
}

function Renglones({ borrador, deshabilitado, onCambio, onAgregar }: {
  borrador: BorradorEscaneado;
  deshabilitado: boolean;
  onCambio: Cambio<Borrador>;
  onAgregar: () => void;
}) {
  const { t } = useIdioma();
  const id = useId();
  const cambiar = (clave: string, cambio: Parameters<typeof cambiarRenglon>[2]) =>
    onCambio((b) => cambiarRenglon(b as BorradorEscaneado, clave, cambio));
  const unico = borrador.renglones.length <= 1;
  return (
    <section className="vj-card" aria-labelledby={id}>
      <h2 id={id} className="vjt-card-titulo">{t('Renglones')}</h2>
      <ul className="vjr-lista">
        {borrador.renglones.map((r) => {
          const rotulos = rotulosDelRenglon(r, t);
          const precio = leerMontoOCero(r.precio);
          return (
            <li key={r.clave} className="vjr-renglon">
              {/* «Sacar» junto al nombre: así, en la fila de abajo, entra lo del renglón hasta $1,000,000 a 375. */}
              <div className="vjr-cabeza">
                <input
                  className="vjm-input vjr-nombre"
                  value={r.name}
                  maxLength={MAX_NOMBRE_RENGLON}
                  aria-label={rotulos.nombre}
                  disabled={deshabilitado}
                  onChange={(e) => cambiar(r.clave, { name: e.target.value })}
                />
                <button
                  type="button"
                  className="vjr-sacar"
                  disabled={deshabilitado || unico}
                  aria-label={rotulos.sacar}
                  onClick={() => onCambio((b) => sacarRenglon(b as BorradorEscaneado, r.clave))}
                >
                  <Icon name="trash" size={20} />
                </button>
              </div>
              <div className="vjr-fila">
                <button
                  type="button"
                  className="vjr-paso"
                  disabled={deshabilitado || r.quantity <= 1}
                  aria-label={rotulos.menos}
                  onClick={() => cambiar(r.clave, { quantity: r.quantity - 1 })}
                >
                  <Icon name="minus" size={18} />
                </button>
                <span className="vjr-cant">{r.quantity}</span>
                <button
                  type="button"
                  className="vjr-paso"
                  disabled={deshabilitado || r.quantity >= MAX_CANTIDAD}
                  aria-label={rotulos.mas}
                  onClick={() => cambiar(r.clave, { quantity: r.quantity + 1 })}
                >
                  <Icon name="plus" size={18} />
                </button>
                <input
                  className="vjm-input vjm-monto vjr-precio"
                  inputMode="decimal"
                  value={r.precio}
                  placeholder="$0"
                  aria-label={rotulos.precio}
                  disabled={deshabilitado}
                  onChange={(e) => cambiar(r.clave, { precio: e.target.value.replace(/[^0-9.,$]/g, '') })}
                />
                <span className="vjr-linea">{precio.tipo === 'ok' ? formatMXN(precio.cents * r.quantity) : ''}</span>
              </div>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        className="btn btn-ghost vjr-agregar"
        disabled={deshabilitado || borrador.renglones.length >= MAX_RENGLONES}
        onClick={onAgregar}
      >
        {t('Agregar renglón')}
      </button>
    </section>
  );
}

function Ajustes({ borrador, deshabilitado, onCambio }: {
  borrador: BorradorEscaneado;
  deshabilitado: boolean;
  onCambio: Cambio<Borrador>;
}) {
  const { t } = useIdioma();
  const id = useId();
  const campo = (rotulo: string, clave: 'servicio' | 'descuentos' | 'iva') => (
    <label className="vjm-campo">
      <span className="vjm-rotulo">{rotulo}</span>
      <input
        className="vjm-input vjm-monto"
        inputMode="decimal"
        value={borrador[clave]}
        placeholder="$0"
        disabled={deshabilitado}
        onChange={(e) => onCambio({ ...borrador, [clave]: e.target.value.replace(/[^0-9.,$]/g, '') })}
      />
    </label>
  );
  return (
    <section className="vj-card" aria-labelledby={id}>
      <h2 id={id} className="vjt-card-titulo">{t('Servicio, descuentos e IVA')}</h2>
      <p className="vjm-ayuda">{t('Lo que el ticket suma o resta aparte de los platos.')}</p>
      <div className="vjr-ajustes">
        {campo(t('Servicio'), 'servicio')}
        {campo(t('Descuento'), 'descuentos')}
        {campo(t('IVA aparte'), 'iva')}
      </div>
    </section>
  );
}

/** P2 · con dos o más pagadores y otro total: los montos nuevos, arrancando con los de antes, como «Ajustar montos». */
function MontosDePagadores({ ticket, miembros, montos, total, evaluacion, deshabilitado, onMontos }: {
  ticket: TicketDelViaje;
  miembros: readonly MiembroViaje[];
  montos: readonly string[];
  total: number;
  evaluacion: EvaluacionDePagadores;
  deshabilitado: boolean;
  onMontos: (montos: readonly string[]) => void;
}) {
  const { t } = useIdioma();
  const id = useId();
  return (
    <section className="vj-card">
      <div className="vjq" role="group" aria-labelledby={id}>
        <h2 id={id} className="vjm-rotulo">{t('¿Cuánto pagó cada uno?')}</h2>
        <p className="vjm-ayuda">{t('Cambió el total: escribe lo que pagó cada uno. Tienen que sumar {0}.', formatMXN(total))}</p>
        <div className="vjq-montos">
          {ticket.pagadores.map((p, i) => {
            const nombre = nombreDePagador(p.miembro_id, miembros, t);
            const yo = miembros.find((m) => m.id === p.miembro_id)?.es_yo ?? false;
            return (
              <label key={p.miembro_id ?? i} className="vjq-monto">
                <span className="vjt-crece vjq-monto-nombre">{nombre}</span>
                <input
                  className="vjm-input vjm-monto vjq-monto-input"
                  inputMode="decimal"
                  aria-label={yo ? t('Cuánto pagaste tú') : t('Cuánto pagó {0}', nombre)}
                  value={montos[i] ?? ''}
                  disabled={deshabilitado}
                  onChange={(e) => onMontos(ticket.pagadores.map((_, k) => (k === i ? e.target.value.replace(/[^0-9.,$]/g, '') : montos[k] ?? '')))}
                />
              </label>
            );
          })}
          <div className="vjq-pie">
            {evaluacion.suma !== null && <p className="vjq-texto">{t('Suman {0} de {1}', formatMXN(evaluacion.suma), formatMXN(total))}</p>}
            <button
              type="button"
              className="vjq-ajustar"
              disabled={deshabilitado}
              onClick={() => onMontos(montosEnPartesIguales(total, ticket.pagadores.length))}
            >
              {t('Partes iguales')}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
