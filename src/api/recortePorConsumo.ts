// C272 · payme.app.ticket_image/v1, sección recortes. La bandera de AF se
// fija en el build y sólo autoriza solicitar la extensión del contrato.
export interface CajaDelTicket {
  readonly page: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

function habilitado(): boolean {
  return import.meta.env.VITE_TICKET_CROP_ENABLED === '1';
}

export function negociarRecorte(ruta: string): string {
  if (!habilitado()) return ruta;
  return ruta + (ruta.includes('?') ? '&' : '?') + 'ticket_crop_version=1';
}

function fraccion(v: unknown): v is number {
  return typeof v === 'number' && v >= 0 && v <= 1 && Math.round(v * 10000) / 10000 === v;
}

export function cajaDelConsumo(raw: unknown): CajaDelTicket | null {
  if (!habilitado() || !raw || typeof raw !== 'object') return null;
  const { page, x, y, w, h } = raw as Record<string, unknown>;
  if (Object.keys(raw).length !== 5 || typeof page !== 'number' || !Number.isInteger(page) || page < 0 || page > 3
    || !fraccion(x) || !fraccion(y) || !fraccion(w) || !fraccion(h) || !w || !h
    || Math.round((x + w) * 10000) > 10000 || Math.round((y + h) * 10000) > 10000) return null;
  return { page, x, y, w, h };
}

// Separa únicamente la extensión negociada. El decoder de cada superficie
// sigue validando su lista cerrada de claves, montos y cantidades.
export function separarRecorte(raw: unknown) {
  if (habilitado() && raw && typeof raw === 'object'
    && Object.hasOwn(raw, 'ticket_crop') && !Array.isArray(raw)) {
    const { ticket_crop, ...fila } = raw as Record<string, unknown>;
    const caja = cajaDelConsumo(ticket_crop);
    return { fila, campos: caja ? { ticket_crop: caja } : {} };
  }
  return { fila: raw, campos: {} };
}

export const PLAZO_FOTO = 90 * 86400000;

export function recorteVigente(fecha: string, ahora: number): boolean {
  return ahora < Date.parse(fecha) + PLAZO_FOTO;
}

// Los listados pueden venir en el orden del pago. Las coordenadas del dueño
// permiten leer las cajas en el orden del papel. Una caja nula conserva su lugar.
export function renglonesDelRecorte(cajas: readonly unknown[]): (CajaDelTicket | null)[] {
  const vistas = new Set<string>();
  const lineas = cajas.map(cajaDelConsumo).filter(c => {
    if (!c) return true;
    // AB puede desglosar varias unidades de un mismo renglón del papel.
    const clave = JSON.stringify(c);
    if (vistas.has(clave)) return false;
    vistas.add(clave);
    return true;
  });
  const papel = lineas.filter((c): c is CajaDelTicket => c !== null)
    .sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
  let siguiente = 0;
  return lineas.map(c => c && papel[siguiente++]!);
}

export function origenDelRecorteEnMesa(code: string, invitado: boolean, ejemplo: boolean) {
  return invitado || ejemplo ? null : { tipo: 'mesa' as const, code };
}
