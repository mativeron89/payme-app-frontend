import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * D464 · D466 · el mock de la foto del ticket, como el dueño 2.193.0: sin el
 * seam, ni la capacidad ni `ticket_image` en ninguna respuesta; con
 * `encendido`, los tres estados (completa, sólo miniatura, sin foto) y la foto
 * negociada en el escaneo.
 */
function storage(extra: Record<string, string> = {}) {
  const values = new Map<string, string>([
    ['payme.app.mock.money_rail.v1', 'disabled'],
    ['payme.app.mock.mis_mesas.v1', 'sin_cobro'],
    ...Object.entries(extra),
  ]);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  });
  return values;
}

type Fila = { code: string; ticket_image?: unknown };
const filas = (r: unknown) => (r as { mesas: Fila[] }).mesas;

describe('mock · la foto del ticket', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('🔴 sin el seam: la config no publica el bloque y ninguna fila trae foto, aunque se negocie', async () => {
    storage();
    const mock = await import('./mockApi');
    expect('ticket_image' in (await mock.mockGetConfig()).features).toBe(false);
    for (const f of filas(await mock.mockMisMesas({ ticketImage: true }))) expect('ticket_image' in f).toBe(false);
  });

  it('con el seam `apagado`: el bloque del dueño con su constante en false; las filas, sin foto', async () => {
    storage({ 'payme.app.mock.ticket_image.v1': 'apagado' });
    const mock = await import('./mockApi');
    expect((await mock.mockGetConfig()).features.ticket_image).toMatchObject({ supported: true, enabled: false, mode: 'off' });
    for (const f of filas(await mock.mockMisMesas({ ticketImage: true }))) expect('ticket_image' in f).toBe(false);
  });

  it('encendido: los tres estados, sólo si se negocia', async () => {
    storage({ 'payme.app.mock.ticket_image.v1': 'encendido' });
    const mock = await import('./mockApi');
    const negociadas = filas(await mock.mockMisMesas({ ticketImage: true }));
    const de = (code: string) => negociadas.find((f) => f.code === code)?.ticket_image;
    expect(de('PA-6604')).toEqual({ thumb: true, full: true });
    expect(de('PA-7310')).toEqual({ thumb: true, full: false });
    expect(negociadas.filter((f) => !['PA-6604', 'PA-7310'].includes(f.code)).every((f) =>
      JSON.stringify(f.ticket_image) === JSON.stringify({ thumb: false, full: false }))).toBe(true);
    for (const f of filas(await mock.mockMisMesas())) expect('ticket_image' in f).toBe(false);
  });

  it('el escaneo negociado suma `ticket_image`; sin negociar, la lectura de siempre', async () => {
    storage({ 'payme.app.mock.ticket_image.v1': 'encendido' });
    const mock = await import('./mockApi');
    const sin = await mock.mockScanTicket({ nombres: true });
    expect('ticket_image' in sin).toBe(false);
    const con = await mock.mockScanTicket({ nombres: true, fotoDelTicket: true });
    expect(con.ticket_image).toEqual(con.receipt !== undefined
      ? { stored: true, thumb: true, full: true }
      : { stored: false, reason: 'no_receipt' });
  });

  it('las rutas de la foto: 404 sin el seam, y 404 `ticket_image_not_found` sin foto o con la completa vencida', async () => {
    storage();
    let fotos = await import('./fotoDelTicketMock');
    // Cada grafo de módulos tiene su `MockApiError`: `extractApiError` se toma del mismo grafo.
    let { extractApiError } = await import('../errors');
    const estado = async (p: Promise<unknown>) => extractApiError(await p.catch((e: unknown) => e));
    expect((await estado(fotos.mockFotoDelTicketDeMesa('PA-6604', 'thumb'))).status).toBe(404);
    vi.resetModules();
    storage({ 'payme.app.mock.ticket_image.v1': 'encendido' });
    fotos = await import('./fotoDelTicketMock');
    ({ extractApiError } = await import('../errors'));
    expect(await estado(fotos.mockFotoDelTicketDeMesa('PA-7310', 'full'))).toMatchObject({ status: 404, code: 'ticket_image_not_found' });
    expect(await estado(fotos.mockFotoDelTicketDeMesa('PA-0000', 'thumb'))).toMatchObject({ status: 404, code: 'ticket_image_not_found' });
  });

  it('el ticket de un viaje: sin el seam no cambia; con el seam, foto si tiene renglones', async () => {
    storage();
    let fotos = await import('./fotoDelTicketMock');
    const raw = { contract: 'x', ticket: { id: 't', items: [{ name: 'A', line_cents: 1 }] } };
    expect(fotos.conFotoDelTicketDeViajeMock(raw)).toBe(raw);
    vi.resetModules();
    storage({ 'payme.app.mock.ticket_image.v1': 'encendido' });
    fotos = await import('./fotoDelTicketMock');
    expect(fotos.conFotoDelTicketDeViajeMock(raw)).toEqual({ ...raw, ticket: { ...raw.ticket, ticket_image: { thumb: true, full: true } } });
    const gasto = { contract: 'x', ticket: { id: 'g', items: [] } };
    expect(fotos.conFotoDelTicketDeViajeMock(gasto)).toEqual({ ...gasto, ticket: { ...gasto.ticket, ticket_image: { thumb: false, full: false } } });
  });
});
