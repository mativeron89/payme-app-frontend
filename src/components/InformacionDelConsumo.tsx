import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import { useCapacidadOcrPaginas } from '../api/ocrPaginas';
import { extractApiError } from '../api/errors';
import { useCapacidadFotoDelTicket } from '../api/fotoDelTicket';
import { claveDeFotoDelTicket, pedirFotoDelTicket, type OrigenDeFoto } from '../api/fotosDeTickets';
import { cajaDelConsumo, PLAZO_FOTO, recorteVigente, type CajaDelTicket } from '../api/recortePorConsumo';
import { isCurrentSession, type StoredSession } from '../api/storage';
import { useAuth } from '../auth/AuthContext';
import { useIdioma } from '../i18n/idioma';
import { Icon } from './Icon';
import { useHojaModal } from './useHojaModal';
import './informacionDelConsumo.css';

interface Props {
  caja: unknown;
  nombre: string;
  origen: OrigenDeFoto | null;
  fecha?: string | null;
}

export function InformacionDelConsumo({ caja, nombre, origen, fecha }: Props) {
  const valida = cajaDelConsumo(caja);
  if (!valida || !origen) return null;
  return <ControlConSesion caja={valida} nombre={nombre} origen={origen} fecha={fecha} />;
}

function ControlConSesion({ caja, nombre, origen, fecha }: Pick<Props, 'nombre' | 'fecha'> & { caja: CajaDelTicket; origen: OrigenDeFoto }) {
  const { session } = useAuth();
  const capacidad = useCapacidadFotoDelTicket();
  const paginas = useCapacidadOcrPaginas();
  if (!session || !capacidad?.guardaCompleta || (caja.page > 0 && !paginas)) return null;
  const clave = JSON.stringify([session.family_id, session.principal_id, claveDeFotoDelTicket(origen, 'full', caja.page), caja, fecha]);
  return <Control key={clave} session={session} caja={caja} nombre={nombre} origen={origen} fecha={fecha} />;
}

type Datos = { session: StoredSession; caja: CajaDelTicket; origen: OrigenDeFoto; nombre: string };

function Control({ session, caja, origen, nombre, fecha }: Datos & { fecha?: string | null }) {
  const { t } = useIdioma();
  const boton = useRef<HTMLButtonElement>(null);
  const [abierto, setAbierto] = useState(false);
  const [retirado, retirar] = useState(false);
  useEffect(() => {
    if (!fecha) return;
    const vence = Date.parse(fecha) + PLAZO_FOTO;
    let timer: ReturnType<typeof setTimeout>;
    function comprobar() {
      const restante = vence - Date.now();
      if (!(restante > 0)) retirar(true);
      else timer = setTimeout(comprobar, Math.min(restante, 2147483647));
    }
    comprobar();
    return () => clearTimeout(timer);
  }, [fecha]);
  if (retirado || (fecha && !recorteVigente(fecha, Date.now()))) return null;
  const cerrar = () => {
    setAbierto(false);
    requestAnimationFrame(() => boton.current?.focus());
  };
  return <>
    <button ref={boton} type="button" className="info-consumo" aria-haspopup="dialog"
      aria-label={t('Ver renglón de {0} en el ticket', nombre)} onClick={() => setAbierto(true)}>
      <Icon name="info" size={18} />
    </button>
    {abierto && <Recorte session={session} caja={caja} origen={origen} nombre={nombre} cerrar={cerrar}
      retirar={() => retirar(true)} />}
  </>;
}

// Una vista puede seguir abierta después del vencimiento o de una corrección.
// C272 conoce la fecha de la foto. Sólo sus cajas actuales habilitan los bytes.
async function fotoConCajaVigente(origen: OrigenDeFoto, caja: CajaDelTicket, session: StoredSession) {
  if (!isCurrentSession(session)) return null;
  const ticket = origen.tipo === 'mesa'
    ? (await api.getMesa(origen.code)).mesa
    : await api.getTicketDeViaje(origen.viajeId, origen.ticketId);
  const mismoTicket = origen.tipo === 'mesa' ? 'code' in ticket && ticket.code === origen.code : ticket.id === origen.ticketId;
  if (!mismoTicket || !isCurrentSession(session) || !Array.isArray(ticket.items)) return null;
  const vigente = ticket.items.some(item => {
    const actual = cajaDelConsumo(item.ticket_crop);
    return actual && actual.page === caja.page && actual.x === caja.x && actual.y === caja.y && actual.w === caja.w && actual.h === caja.h;
  });
  return vigente ? pedirFotoDelTicket(origen, 'full', session, caja.page) : null;
}

function Recorte({ session, caja, origen, nombre, cerrar, retirar }: Datos & { cerrar: () => void; retirar: () => void }) {
  const { t } = useIdioma();
  const hoja = useRef<HTMLElement>(null);
  const cierre = useRef<HTMLButtonElement>(null);
  const lienzo = useRef<HTMLCanvasElement>(null);
  const [estado, mostrar] = useState<'cargando' | 'listo' | 'error'>('cargando');
  const retirarRef = useRef(retirar);
  retirarRef.current = retirar;
  useHojaModal(hoja, cierre, cerrar);
  const { page, x, y, w, h } = caja;
  const solicitud = useRef<Promise<Blob | null> | null>(null);
  const mesa = origen.tipo === 'mesa' ? origen.code : null;
  const viaje = origen.tipo === 'viaje' ? origen.viajeId : null;
  const ticket = origen.tipo === 'viaje' ? origen.ticketId : null;
  useEffect(() => {
    let vigente = true;
    const fuente: OrigenDeFoto = mesa !== null ? { tipo: 'mesa', code: mesa } : { tipo: 'viaje', viajeId: viaje!, ticketId: ticket! };
    async function dibujar() {
      // El diálogo se remonta por sesión, origen o caja. StrictMode puede
      // repetir su efecto durante la misma apertura.
      solicitud.current ??= fotoConCajaVigente(fuente, { page, x, y, w, h }, session);
      const blob = await solicitud.current;
      if (!vigente || !isCurrentSession(session)) return;
      if (!blob) { retirarRef.current(); return; }
      const imagen = await createImageBitmap(blob);
      try {
        const canvas = lienzo.current;
        if (!canvas || !vigente || !isCurrentSession(session)) return;
        const ancho = imagen.width * w;
        const alto = imagen.height * h;
        canvas.width = Math.max(1, Math.round(ancho));
        canvas.height = Math.max(1, Math.round(alto));
        const contexto = canvas.getContext('2d');
        if (!contexto) throw new Error('canvas');
        contexto.drawImage(imagen, x * imagen.width, y * imagen.height, ancho, alto, 0, 0, canvas.width, canvas.height);
        mostrar('listo');
      } finally {
        imagen.close();
      }
    }
    void dibujar().catch((error: unknown) => {
      if (!vigente) return;
      const { status } = extractApiError(error);
      if (status === 403 || status === 404) retirarRef.current();
      else mostrar('error');
    });
    return () => { vigente = false; };
  }, [session, mesa, viaje, ticket, page, x, y, w, h]);
  const titulo = t('Renglón de {0} en el ticket', nombre);
  return createPortal(<div className="ticket-digital-backdrop info-consumo-fondo">
    <section ref={hoja} role="dialog" aria-modal="true" aria-label={titulo} className="ticket-digital-dialog">
      <div className="ticket-digital-head"><h2>{titulo}</h2>
        <button type="button" className="ticket-digital-close" ref={cierre} aria-label={t('Cerrar')} onClick={cerrar}><Icon name="x-circle" size={24} /></button>
      </div>
      <canvas ref={lienzo} hidden={estado !== 'listo'} role="img" aria-label={titulo} />
      {estado !== 'listo' && <p role="status">{estado === 'cargando' ? t('Cargando detalle…') : t('No pudimos cargar el detalle')}</p>}
    </section>
  </div>, document.body);
}
