import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import { useCapacidadOcrPaginas } from '../api/ocrPaginas';
import { extractApiError } from '../api/errors';
import { useCapacidadFotoDelTicket } from '../api/fotoDelTicket';
import { claveDeFotoDelTicket, pedirFotoDelTicket, type OrigenDeFoto } from '../api/fotosDeTickets';
import { cajaDelConsumo, PLAZO_FOTO, renglonesDelRecorte, recorteVigente, type CajaDelTicket } from '../api/recortePorConsumo';
import { isCurrentSession, type StoredSession } from '../api/storage';
import { useAuth } from '../auth/AuthContext';
import { useIdioma } from '../i18n/idioma';
import { esCodigoDeEjemplo } from '../ayuda/ejemplo/fixtureEjemplo';
import { Icon } from './Icon';
import { useHojaModal } from './useHojaModal';
import './informacionDelConsumo.css';

interface Props {
  caja?: unknown;
  cajas?: readonly unknown[];
  nombre: string;
  origen: OrigenDeFoto | null;
  fecha?: string | null;
}

type Lineas = readonly (CajaDelTicket | null)[];
type Datos = { session: StoredSession; cajas: Lineas; origen: OrigenDeFoto; nombre: string };

export function InformacionDelConsumo({ caja, cajas, nombre, origen, fecha }: Props) {
  if (!origen || (origen.tipo === 'mesa' && esCodigoDeEjemplo(origen.code))) return null;
  const lineas = renglonesDelRecorte(cajas ?? [caja]);
  if (!lineas.some(Boolean)) return null;
  return <ControlConSesion cajas={lineas} nombre={nombre} origen={origen} fecha={fecha} />;
}

function ControlConSesion({ cajas, nombre, origen, fecha }: Omit<Datos, 'session'> & Pick<Props, 'fecha'>) {
  const { session } = useAuth();
  const capacidad = useCapacidadFotoDelTicket();
  const paginas = useCapacidadOcrPaginas();
  if (!session || !capacidad?.guardaCompleta) return null;
  const disponibles = cajas.map(c => c && (c.page === 0 || paginas) ? c : null);
  if (!disponibles.some(Boolean)) return null;
  const clave = JSON.stringify([session.family_id, session.principal_id, claveDeFotoDelTicket(origen, 'full'), disponibles, fecha]);
  return <Control key={clave} session={session} cajas={disponibles} nombre={nombre} origen={origen} fecha={fecha} />;
}

function Control({ session, cajas, origen, nombre, fecha }: Datos & Pick<Props, 'fecha'>) {
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
    {abierto && <Recorte session={session} cajas={cajas} origen={origen} nombre={nombre} cerrar={cerrar}
      retirar={() => retirar(true)} />}
  </>;
}

// Una vista puede seguir abierta después del vencimiento o de una corrección.
// C272 conoce la fecha de la foto. Sólo sus cajas actuales habilitan los bytes.
async function cajasVigentes(origen: OrigenDeFoto, session: StoredSession) {
  if (!isCurrentSession(session)) return new Set<string>();
  const ticket = origen.tipo === 'mesa'
    ? (await api.getMesa(origen.code)).mesa
    : await api.getTicketDeViaje(origen.viajeId, origen.ticketId);
  const mismoTicket = origen.tipo === 'mesa' ? 'code' in ticket && ticket.code === origen.code : ticket.id === origen.ticketId;
  if (!mismoTicket || !isCurrentSession(session) || !Array.isArray(ticket.items)) return new Set<string>();
  return new Set(ticket.items.map(item => cajaDelConsumo(item.ticket_crop)).filter(Boolean).map(c => JSON.stringify(c)));
}

function dibujar(canvas: HTMLCanvasElement, imagen: ImageBitmap, caja: CajaDelTicket) {
  const ancho = imagen.width * caja.w;
  const alto = imagen.height * caja.h;
  canvas.width = Math.max(1, Math.round(ancho));
  canvas.height = Math.max(1, Math.round(alto));
  const contexto = canvas.getContext('2d');
  if (!contexto) throw new Error('canvas');
  contexto.drawImage(imagen, caja.x * imagen.width, caja.y * imagen.height, ancho, alto, 0, 0, canvas.width, canvas.height);
}

function Recorte(props: Datos & { cerrar: () => void; retirar: () => void }) {
  // Control se remonta al cambiar sesión, origen o cajas. Un render de la pantalla
  // durante la misma apertura conserva la lectura y los lienzos.
  const { session, origen, cajas } = useRef(props).current;
  const { t } = useIdioma();
  const hoja = useRef<HTMLElement>(null);
  const cierre = useRef<HTMLButtonElement>(null);
  const lienzos = useRef<(HTMLCanvasElement | null)[]>([]);
  const [listos, mostrar] = useState<Set<number> | null>(null);
  const [error, mostrarError] = useState(false);
  const retirar = useRef(props.retirar);
  retirar.current = props.retirar;
  useHojaModal(hoja, cierre, props.cerrar);
  const consulta = useRef<ReturnType<typeof cajasVigentes> | null>(null);
  useEffect(() => {
    let abierta = true;
    const actual = () => {
      if (!abierta) return false;
      if (isCurrentSession(session)) return true;
      retirar.current();
      return false;
    };
    async function cargar() {
      consulta.current ??= cajasVigentes(origen, session);
      const vigentes = await consulta.current;
      if (!actual()) return;
      const porPagina = new Map<number, number[]>();
      cajas.forEach((caja, i) => {
        if (!caja || !vigentes.has(JSON.stringify(caja))) return;
        const indices = porPagina.get(caja.page) ?? [];
        indices.push(i);
        porPagina.set(caja.page, indices);
      });
      if (!porPagina.size) { retirar.current(); return; }
      const dibujados = new Set<number>();
      for (const [pagina, indices] of porPagina) {
        if (!actual()) return;
        const blob = await pedirFotoDelTicket(origen, 'full', session, pagina);
        if (!actual()) return;
        const imagen = await createImageBitmap(blob);
        try {
          if (!actual()) return;
          for (const i of indices) {
            const canvas = lienzos.current[i];
            const caja = cajas[i];
            if (!canvas || !caja) continue;
            dibujar(canvas, imagen, caja);
            dibujados.add(i);
          }
        } finally {
          imagen.close();
        }
      }
      if (actual()) mostrar(dibujados);
    }
    void cargar().catch((e: unknown) => {
      if (!actual()) return;
      const { status } = extractApiError(e);
      if (status === 403 || status === 404) retirar.current();
      else mostrarError(true);
    });
    return () => { abierta = false; };
  }, [session, origen, cajas]);
  const titulo = cajas.length === 1 ? t('Renglón del ticket') : t('Renglones del ticket');
  return createPortal(<div className="ticket-digital-backdrop info-consumo-fondo">
    <section ref={hoja} role="dialog" aria-modal="true" aria-label={titulo} className="ticket-digital-dialog">
      <div className="ticket-digital-head"><div><h2>{titulo}</h2><p>{props.nombre}</p></div>
        <button type="button" className="ticket-digital-close" ref={cierre} aria-label={t('Cerrar')} onClick={props.cerrar}><Icon name="x-circle" size={24} /></button>
      </div>
      <div className="info-consumo-recortes">
        {!listos && <p role="status">{error ? t('No pudimos cargar el detalle') : t('Cargando detalle…')}</p>}
        {cajas.map((_, i) => <figure key={i} hidden={!listos}>
          <figcaption>{t('Renglón {0}', i + 1)}</figcaption>
          <canvas ref={el => { lienzos.current[i] = el; }} hidden={!listos?.has(i)} role="img" aria-label={t('Renglón {0}', i + 1)} />
          {listos && !listos.has(i) && <span>{t('Recorte no disponible')}</span>}
        </figure>)}
      </div>
    </section>
  </div>, document.body);
}
