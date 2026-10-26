import { fotoDelTicketMockEncendida } from '../fotoDelTicket';
import { fotoDeMesaMock, MockApiError, partesDeMesaMock } from './mockApi';
import { mockVerTicket } from './viajes';

/**
 * D464 · D466 · las fotos de los tickets del mock, dibujadas: un ticket de
 * papel en un canvas con el nombre del lugar, sus renglones y el total. No hay fotos
 * reales en el repo ni en el mock: son de ejemplo, como los restaurantes.
 *
 * Responde como las rutas del dueño 2.193.0: con el modo apagado (sin el seam
 * `encendido`), o sin la foto pedida, el 404 `ticket_image_not_found`.
 */

interface PapelDelTicket {
  readonly lugar: string;
  readonly renglones: ReadonlyArray<{ readonly nombre: string; readonly cents: number }>;
}

/** Los tickets de las mesas de ejemplo con foto (`FOTOS_DE_MESAS_MOCK`). */
const PAPELES_DE_MESAS: Readonly<Record<string, PapelDelTicket>> = {
  'PA-6604': {
    lugar: 'CAFÉ TACUBA',
    renglones: [
      { nombre: 'CHILAQUILES', cents: 16500 },
      { nombre: 'CAFE DE OLLA', cents: 4500 },
      { nombre: 'PAN DULCE', cents: 3800 },
      { nombre: 'JUGO NARANJA', cents: 5200 },
    ],
  },
  'PA-7310': {
    lugar: 'TACOS EL GÜERO',
    renglones: [
      { nombre: 'TACOS AL PASTOR', cents: 20000 },
      { nombre: 'AGUA DE JAMAICA', cents: 15000 },
      { nombre: 'QUESADILLA', cents: 10000 },
    ],
  },
};

function pesos(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * El ticket dibujado en un canvas, como `jpegDeIniciales`: WebP (como el
 * dueño); si el navegador no lo sabe codificar, PNG. `chico`: la miniatura.
 */
export function dibujarTicket(papel: PapelDelTicket, chico: boolean, parte = 0, partes = 1): Promise<Blob> {
  return new Promise((resolve, reject) => {
    // D484 · un ticket en varias fotos: cada parte dibuja su tramo de renglones; la cabecera va en la primera y el
    // TOTAL en la última, como en el papel.
    const tramo = partes > 1 ? tramoDeLaParte(papel.renglones, parte, partes) : papel.renglones;
    const conCabecera = parte === 0;
    const conTotal = parte === partes - 1;
    const renglones = tramo.slice(0, chico ? 6 : 14);
    const total = papel.renglones.reduce((s, r) => s + r.cents, 0);
    const escala = chico ? 1 / 3 : 1;
    const ancho = Math.round(480 * escala);
    const alto = Math.round((220 + renglones.length * 34) * escala);
    const canvas = document.createElement('canvas');
    canvas.width = ancho;
    canvas.height = alto;
    const ctx = canvas.getContext('2d');
    if (!ctx) { reject(new Error('sin_canvas')); return; }
    ctx.scale(escala, escala);
    ctx.fillStyle = '#fbf8f1';
    ctx.fillRect(0, 0, 480, 220 + renglones.length * 34);
    ctx.fillStyle = '#1f2328';
    ctx.strokeStyle = '#8a8f98';
    ctx.setLineDash([6, 6]);
    ctx.font = 'bold 22px "Courier New", monospace';
    ctx.textAlign = 'center';
    if (conCabecera) ctx.fillText(papel.lugar, 240, 60);
    ctx.font = '22px "Courier New", monospace';
    ctx.fillText(conCabecera ? 'TICKET DE EJEMPLO' : `PARTE ${parte + 1} DE ${partes}`, 240, 96);
    const raya = (y: number) => { ctx.beginPath(); ctx.moveTo(24, y); ctx.lineTo(456, y); ctx.stroke(); };
    raya(120);
    renglones.forEach((r, i) => {
      const y = 160 + i * 34;
      ctx.textAlign = 'left';
      ctx.fillText(r.nombre, 28, y);
      ctx.textAlign = 'right';
      ctx.fillText(pesos(r.cents), 452, y);
    });
    const fin = 160 + renglones.length * 34;
    raya(fin - 18);
    ctx.font = 'bold 22px "Courier New", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(conTotal ? 'TOTAL' : 'SIGUE…', 28, fin + 16);
    ctx.textAlign = 'right';
    if (conTotal) ctx.fillText(pesos(total), 452, fin + 16);
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('sin_blob'))), 'image/webp', 0.85);
  });
}

/** D484 · los renglones de la parte `parte` de `partes`, repartidos en orden y sin dejar ninguno afuera. */
function tramoDeLaParte<T>(renglones: readonly T[], parte: number, partes: number): readonly T[] {
  const desde = Math.floor((renglones.length * parte) / partes);
  const hasta = Math.floor((renglones.length * (parte + 1)) / partes);
  return renglones.slice(desde, Math.max(hasta, desde + 1));
}

const espera = () => new Promise((r) => setTimeout(r, 60));

function noEsta(): never {
  throw new MockApiError(404, 'ticket_image_not_found');
}

/**
 * D481 · 2d, 1e y 1f · el seam `payme.app.mock.ticket_image.fallas.v1` (sin UI;
 * el build real no lo consulta): un JSON con, por código de mesa y tamaño, si la
 * foto se queda cargando o falla. Por ejemplo
 * `{"PA-7310":{"thumb":"cargando"},"PA-6604":{"thumb":"error"}}`. Sirve para ver
 * los estados de la fila y del visor; sin el seam, nada cambia.
 */
export const CLAVE_FALLAS_FOTO_DEL_TICKET_MOCK = 'payme.app.mock.ticket_image.fallas.v1';

type FallaDeFoto = 'cargando' | 'error';

function fallaDe(code: string, tamano: 'thumb' | 'full'): FallaDeFoto | null {
  let crudo: string | null = null;
  try { crudo = localStorage.getItem(CLAVE_FALLAS_FOTO_DEL_TICKET_MOCK); } catch { return null; }
  if (!crudo) return null;
  try {
    const fallas = JSON.parse(crudo) as Record<string, Partial<Record<'thumb' | 'full', unknown>>>;
    const f = fallas?.[code]?.[tamano];
    return f === 'cargando' || f === 'error' ? f : null;
  } catch {
    return null;
  }
}

/**
 * `GET /api/mesas/:code/ticket-image/:tamano`, del mock. D484 · `parte` es el
 * `?page=` del dueño 2.196.0: una parte que el ticket no tiene es el 404 uniforme.
 */
export async function mockFotoDelTicketDeMesa(code: string, tamano: 'thumb' | 'full', parte = 0): Promise<Blob> {
  await espera();
  if (!fotoDelTicketMockEncendida()) throw new MockApiError(404, 'not_found');
  const falla = fallaDe(code, tamano);
  // Cargando: el pedido no termina nunca (el recuadro vacío, el esqueleto del visor).
  if (falla === 'cargando') await new Promise<never>(() => undefined);
  if (falla === 'error') throw new MockApiError(500, 'internal_error');
  const foto = fotoDeMesaMock(code);
  const papel = PAPELES_DE_MESAS[code];
  const partes = partesDeMesaMock(code);
  if (!papel || !foto[tamano] || parte >= partes) noEsta();
  return dibujarTicket(papel, tamano === 'thumb', parte, partes);
}

/** `GET /api/viajes/:id/tickets/:tid/ticket-image/:tamano`, del mock: el ticket del viaje, dibujado. */
export async function mockFotoDelTicketDeViaje(viajeId: string, ticketId: string, tamano: 'thumb' | 'full', parte = 0): Promise<Blob> {
  if (!fotoDelTicketMockEncendida()) {
    await espera();
    throw new MockApiError(404, 'not_found');
  }
  // El mismo acceso que el detalle del ticket: si no lo ve, el 404 del ticket.
  const raw = await mockVerTicket(viajeId, ticketId, { version: 11 }) as { ticket?: TicketCrudo };
  const ticket = raw.ticket;
  // D484 · los tickets de los viajes del mock tienen una sola foto: otra parte es el 404.
  if (!ticket || !conFoto(ticket) || parte > 0) noEsta();
  const papel: PapelDelTicket = {
    lugar: (ticket.lugar ?? 'TICKET').toUpperCase(),
    renglones: (ticket.items ?? []).map((i) => ({ nombre: i.name.toUpperCase(), cents: i.line_cents })),
  };
  return dibujarTicket(papel, tamano === 'thumb');
}

interface TicketCrudo {
  readonly lugar?: string | null;
  readonly items?: ReadonlyArray<{ readonly name: string; readonly line_cents: number }>;
  readonly personal?: boolean;
}

/** En el mock, tienen foto los tickets escaneados (con renglones); un gasto a mano o un total, no. */
function conFoto(ticket: TicketCrudo): boolean {
  return (ticket.items?.length ?? 0) > 0;
}

/**
 * `GET /api/viajes/:id/tickets/:tid` con `ticket_image_version=1`, del mock: le
 * suma `ticket_image` al ticket, como el dueño con el modo encendido. Con el
 * modo apagado no cambia nada.
 */
export function conFotoDelTicketDeViajeMock(raw: unknown, v2 = false): unknown {
  if (!fotoDelTicketMockEncendida()) return raw;
  if (typeof raw !== 'object' || raw === null) return raw;
  const cuerpo = raw as { ticket?: unknown };
  if (typeof cuerpo.ticket !== 'object' || cuerpo.ticket === null) return raw;
  const ticket = cuerpo.ticket as TicketCrudo;
  const tiene = conFoto(ticket);
  return { ...cuerpo, ticket: { ...ticket, ticket_image: fotoDelMock(tiene, v2) } };
}

/**
 * D481 · `GET /api/viajes/:id` con `ticket_image_version=1`, del mock: cada
 * ticket de `viaje.tickets[]` suma `ticket_image`, como el dueño con el modo
 * encendido (`listados` del contrato). Tienen foto los escaneados; un gasto a
 * mano, no. Con el modo apagado no cambia nada.
 */
export function conFotoEnLosTicketsDelViajeMock(raw: unknown, v2 = false): unknown {
  if (!fotoDelTicketMockEncendida()) return raw;
  if (typeof raw !== 'object' || raw === null) return raw;
  const cuerpo = raw as { viaje?: unknown };
  if (typeof cuerpo.viaje !== 'object' || cuerpo.viaje === null) return raw;
  const viaje = cuerpo.viaje as { tickets?: unknown };
  if (!Array.isArray(viaje.tickets)) return raw;
  const tickets = (viaje.tickets as Array<Record<string, unknown>>).map((tk) => {
    const tiene = tk.origen !== 'manual';
    return { ...tk, ticket_image: fotoDelMock(tiene, v2) };
  });
  return { ...cuerpo, viaje: { ...viaje, tickets } };
}

/**
 * D481 · `GET /api/viajes/visitas` con `ticket_image_version=1`, del mock: cada
 * visita suma `ticket_image` con la regla del detalle del ticket (`conFoto`).
 */
export async function conFotoEnLasVisitasMock(raw: unknown, v2 = false): Promise<unknown> {
  if (!fotoDelTicketMockEncendida()) return raw;
  if (typeof raw !== 'object' || raw === null) return raw;
  const cuerpo = raw as { visitas?: unknown };
  if (!Array.isArray(cuerpo.visitas)) return raw;
  const visitas = await Promise.all((cuerpo.visitas as Array<{ ticket_id: string; viaje: { id: string } }>).map(async (v) => {
    let tiene = false;
    try {
      const detalle = await mockVerTicket(v.viaje.id, v.ticket_id, { version: 11 }) as { ticket?: TicketCrudo };
      tiene = !!detalle.ticket && conFoto(detalle.ticket);
    } catch {
      // Sin acceso al ticket: sin foto, como el dueño.
    }
    return { ...v, ticket_image: fotoDelMock(tiene, v2) };
  }));
  return { ...cuerpo, visitas };
}

/** `ticket_image` de un ticket del viaje, con la v1 o con la v2 de D484 (una sola parte: `pages` 1, o 0 sin foto). */
function fotoDelMock(tiene: boolean, v2: boolean): Record<string, unknown> {
  return v2 ? { thumb: tiene, full: tiene, pages: tiene ? 1 : 0 } : { thumb: tiene, full: tiene };
}
