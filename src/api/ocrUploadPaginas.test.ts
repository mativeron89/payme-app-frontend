import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
  clear() { this.values.clear(); }
}

type XhrHandler = ((event: Event) => void) | null;

class FakeXmlHttpRequest {
  static instances: FakeXmlHttpRequest[] = [];

  readonly upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
  readonly headers = new Map<string, string>();
  method = '';
  url = '';
  body: Document | XMLHttpRequestBodyInit | null = null;
  timeout = 0;
  responseType: XMLHttpRequestResponseType = '';
  response: unknown = null;
  status = 0;
  onload: XhrHandler = null;
  onerror: XhrHandler = null;
  onabort: XhrHandler = null;
  ontimeout: XhrHandler = null;

  constructor() {
    FakeXmlHttpRequest.instances.push(this);
  }

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string) {
    this.headers.set(name, value);
  }

  send(body: Document | XMLHttpRequestBodyInit | null) {
    this.body = body;
  }

  progress(loaded: number, total: number, lengthComputable: boolean) {
    this.upload.onprogress?.({ loaded, total, lengthComputable } as ProgressEvent);
  }

  finish(status: number, body: unknown) {
    this.status = status;
    this.response = body;
    this.onload?.(new Event('load'));
  }

  timeOut() {
    this.ontimeout?.(new Event('timeout'));
  }

  failNetwork() {
    this.onerror?.(new Event('error'));
  }

  abortUpload() {
    this.onabort?.(new Event('abort'));
  }
}

const storage = new MemoryStorage();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: {
    locks: {
      request: async <T>(_name: string, _options: LockOptions, action: () => Promise<T> | T) => action(),
    },
  },
});

const { api } = await import('./index');
const { saveSession } = await import('./storage');

const user = {
  id: 'ocr-user',
  payme_id: 'payme_mx_ocr',
  email: 'ocr@example.com',
  first_name: 'Ocr',
  last_name: 'User',
};

function loggedIn(accessToken = 'a-ocr', refreshToken = 'r-ocr') {
  saveSession({
    access_token: accessToken,
    refresh_token: refreshToken,
    family_id: 'family-ocr',
    principal_id: user.id,
    user,
  });
}

function ticket() {
  return {
    contract_version: 2,
    merchant: { name: 'Tacos El Güero', rfc: 'TEG010101AB1' },
    // AF-NOMBRES-CORREGIDOS · el pedido negocia `names_version=1`: el dueño
    // publica el original en todos los platos (acá, sin corrección).
    items: [{ name: 'Taco', category: 'mexican', price_cents: 1000, quantity: 1, original_name: 'Taco' }],
    total_cents: 1000,
    warnings: [],
    mock: false,
  };
}

const { aplicarConfigOcrPaginas, reiniciarOcrPaginasParaTests } = await import('./ocrPaginas');
const { aplicarConfigFotoDelTicket, reiniciarFotoDelTicketParaTests } = await import('./fotoDelTicket');

/**
 * D484 · D486 · el pedido de varias fotos: `pages_version=1` y el campo `images`
 * repetido SÓLO con dos o más fotos y la capacidad encendida; con una foto (o
 * sin la capacidad), el pedido de siempre, byte por byte.
 */
const CAPACIDAD = {
  supported: true, enabled: true, max_pages: 4, max_total_bytes: 25165824,
  negotiation_param: 'pages_version', negotiation_value: '1',
};
const FOTO_ENCENDIDA = {
  supported: true, enabled: true, mode: 'full_retained', stores_thumb: true, stores_full: true, full_retention_days: 90,
  negotiation_param: 'ticket_image_version', negotiation_value: '1',
  accepted_mime_types: ['image/jpeg', 'image/png', 'image/webp'], thumb_max_side_px: 320, full_max_side_px: 1600,
};
const foto = (n = 4) => new Blob(['x'.repeat(n)], { type: 'image/jpeg' });

beforeEach(() => {
  storage.clear();
  FakeXmlHttpRequest.instances = [];
  vi.stubGlobal('XMLHttpRequest', FakeXmlHttpRequest);
  loggedIn();
});

afterEach(() => {
  vi.unstubAllGlobals();
  storage.clear();
  reiniciarOcrPaginasParaTests();
  reiniciarFotoDelTicketParaTests();
});

describe('D484 · D486 · el escaneo de un ticket en varias fotos', () => {
  it('sin la capacidad, una foto: el pedido de siempre (`image`, sin `pages_version`)', async () => {
    const pending = api.scanTicket(foto());
    const xhr = FakeXmlHttpRequest.instances[0]!;
    const url = new URL(xhr.url, 'http://localhost');
    expect(url.searchParams.has('pages_version')).toBe(false);
    expect(url.searchParams.has('ticket_image_version')).toBe(false);
    const form = xhr.body as FormData;
    expect(form.getAll('image')).toHaveLength(1);
    expect(form.has('images')).toBe(false);
    xhr.finish(200, ticket());
    await expect(pending).resolves.toEqual(ticket());
  });

  it('con la capacidad y una sola foto (la lista de una), tampoco cambia nada', async () => {
    aplicarConfigOcrPaginas({ features: { ocr_pages: CAPACIDAD } });
    const pending = api.scanTicket([foto()]);
    const xhr = FakeXmlHttpRequest.instances[0]!;
    expect(new URL(xhr.url, 'http://localhost').searchParams.has('pages_version')).toBe(false);
    expect((xhr.body as FormData).getAll('image')).toHaveLength(1);
    xhr.finish(200, ticket());
    await expect(pending).resolves.toEqual(ticket());
  });

  it('con la capacidad y tres fotos: `pages_version=1` y `images` tres veces, en el orden del papel', async () => {
    aplicarConfigOcrPaginas({ features: { ocr_pages: CAPACIDAD } });
    const partes = [foto(11), foto(22), foto(33)];
    const pending = api.scanTicket(partes);
    const xhr = FakeXmlHttpRequest.instances[0]!;
    const url = new URL(xhr.url, 'http://localhost');
    expect(url.searchParams.getAll('pages_version')).toEqual(['1']);
    expect(url.searchParams.getAll('contract_version')).toEqual(['2']);
    const form = xhr.body as FormData;
    expect(form.has('image')).toBe(false);
    const enviadas = form.getAll('images') as File[];
    expect(enviadas.map((f) => f.size)).toEqual([11, 22, 33]);
    const respuesta = { ...ticket(), pages: { count: 3, overlap_removed: 1, reordered: false } };
    xhr.finish(200, respuesta);
    await expect(pending).resolves.toEqual(respuesta);
  });

  it('con la foto del ticket encendida además: `ticket_image_version=2` (con una o con varias)', async () => {
    aplicarConfigOcrPaginas({ features: { ocr_pages: CAPACIDAD } });
    aplicarConfigFotoDelTicket({ features: { ticket_image: FOTO_ENCENDIDA } });
    void api.scanTicket(foto()).catch(() => undefined);
    void api.scanTicket([foto(), foto()]).catch(() => undefined);
    const [una, dos] = FakeXmlHttpRequest.instances;
    expect(new URL(una!.url, 'http://localhost').searchParams.getAll('ticket_image_version')).toEqual(['2']);
    expect(new URL(una!.url, 'http://localhost').searchParams.has('pages_version')).toBe(false);
    expect(new URL(dos!.url, 'http://localhost').searchParams.getAll('ticket_image_version')).toEqual(['2']);
    expect(new URL(dos!.url, 'http://localhost').searchParams.getAll('pages_version')).toEqual(['1']);
  });

  it('la foto del ticket encendida sin las varias fotos: la v1 de siempre', async () => {
    aplicarConfigFotoDelTicket({ features: { ticket_image: FOTO_ENCENDIDA } });
    void api.scanTicket(foto()).catch(() => undefined);
    const xhr = FakeXmlHttpRequest.instances[0]!;
    expect(new URL(xhr.url, 'http://localhost').searchParams.getAll('ticket_image_version')).toEqual(['1']);
  });

  it('antes de la red: varias fotos sin la capacidad, más que `max_pages` o por encima de `max_total_bytes`', async () => {
    await expect(api.scanTicket([foto(), foto()])).rejects.toThrow('ocr_pages_not_available');
    aplicarConfigOcrPaginas({ features: { ocr_pages: { ...CAPACIDAD, max_pages: 2, max_total_bytes: 50 } } });
    await expect(api.scanTicket([foto(), foto(), foto()])).rejects.toThrow('too_many_pages');
    await expect(api.scanTicket([foto(30), foto(30)])).rejects.toThrow('pages_too_large');
    await expect(api.scanTicket([foto(), { size: 8 * 1024 * 1024 + 1 } as Blob])).rejects.toThrow('hasta 8 MiB');
    expect(FakeXmlHttpRequest.instances).toHaveLength(0);
  });

  it('la respuesta sin `pages` con la negociación no pasa como lectura buena', async () => {
    aplicarConfigOcrPaginas({ features: { ocr_pages: CAPACIDAD } });
    const pending = api.scanTicket([foto(), foto()]);
    FakeXmlHttpRequest.instances[0]!.finish(200, ticket());
    await expect(pending).rejects.toThrow();
  });
});
