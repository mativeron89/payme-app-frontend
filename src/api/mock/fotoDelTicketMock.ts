import { fotoDelTicketMockEncendida } from '../fotoDelTicket';
import { fotoDeMesaMock, MockApiError } from './mockApi';
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
export function dibujarTicket(papel: PapelDelTicket, chico: boolean): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const renglones = papel.renglones.slice(0, chico ? 6 : 14);
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
    ctx.fillText(papel.lugar, 240, 60);
    ctx.font = '22px "Courier New", monospace';
    ctx.fillText('TICKET DE EJEMPLO', 240, 96);
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
    ctx.fillText('TOTAL', 28, fin + 16);
    ctx.textAlign = 'right';
    ctx.fillText(pesos(total), 452, fin + 16);
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('sin_blob'))), 'image/webp', 0.85);
  });
}

const espera = () => new Promise((r) => setTimeout(r, 60));

function noEsta(): never {
  throw new MockApiError(404, 'ticket_image_not_found');
}

/** `GET /api/mesas/:code/ticket-image/:tamano`, del mock. */
export async function mockFotoDelTicketDeMesa(code: string, tamano: 'thumb' | 'full'): Promise<Blob> {
  await espera();
  if (!fotoDelTicketMockEncendida()) throw new MockApiError(404, 'not_found');
  const foto = fotoDeMesaMock(code);
  const papel = PAPELES_DE_MESAS[code];
  if (!papel || !foto[tamano]) noEsta();
  return dibujarTicket(papel, tamano === 'thumb');
}

/** `GET /api/viajes/:id/tickets/:tid/ticket-image/:tamano`, del mock: el ticket del viaje, dibujado. */
export async function mockFotoDelTicketDeViaje(viajeId: string, ticketId: string, tamano: 'thumb' | 'full'): Promise<Blob> {
  if (!fotoDelTicketMockEncendida()) {
    await espera();
    throw new MockApiError(404, 'not_found');
  }
  // El mismo acceso que el detalle del ticket: si no lo ve, el 404 del ticket.
  const raw = await mockVerTicket(viajeId, ticketId, { version: 11 }) as { ticket?: TicketCrudo };
  const ticket = raw.ticket;
  if (!ticket || !conFoto(ticket)) noEsta();
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
export function conFotoDelTicketDeViajeMock(raw: unknown): unknown {
  if (!fotoDelTicketMockEncendida()) return raw;
  if (typeof raw !== 'object' || raw === null) return raw;
  const cuerpo = raw as { ticket?: unknown };
  if (typeof cuerpo.ticket !== 'object' || cuerpo.ticket === null) return raw;
  const ticket = cuerpo.ticket as TicketCrudo;
  const tiene = conFoto(ticket);
  return { ...cuerpo, ticket: { ...ticket, ticket_image: { thumb: tiene, full: tiene } } };
}
