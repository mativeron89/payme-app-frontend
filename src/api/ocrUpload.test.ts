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
const { OCR_TIMEOUT_MS, httpOcrUploadRequest } = await import('./http');
const { loadSession, saveSession } = await import('./storage');

const user = {
  id: 'ocr-user',
  payme_id: 'payme_mx_ocr',
  email: 'ocr@example.com',
  first_name: 'Ocr',
  last_name: 'User',
};

function loggedIn(accessToken = 'access-ocr', refreshToken = 'refresh-ocr') {
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
    items: [{ name: 'Taco', category: 'mexican', price_cents: 1000, quantity: 1 }],
    total_cents: 1000,
    warnings: [],
    mock: false,
  };
}

beforeEach(() => {
  storage.clear();
  FakeXmlHttpRequest.instances = [];
  vi.stubGlobal('XMLHttpRequest', FakeXmlHttpRequest);
  loggedIn();
});

afterEach(() => {
  vi.unstubAllGlobals();
  storage.clear();
});

describe('G-29 · transporte dedicado del upload OCR', () => {
  it('usa XHR sólo para /ocr, conserva bearer/timeout y publica progreso real', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const form = new FormData();
    form.append('image', new Blob(['foto'], { type: 'image/jpeg' }), 'ticket.jpg');
    const progress = vi.fn();

    const pending = httpOcrUploadRequest<unknown>(form, progress);
    const xhr = FakeXmlHttpRequest.instances[0];
    expect(xhr).toBeDefined();
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toMatch(/\/api\/ocr$/);
    expect(xhr.body).toBe(form);
    expect(xhr.timeout).toBe(OCR_TIMEOUT_MS);
    expect(xhr.responseType).toBe('json');
    expect(xhr.headers.get('Authorization')).toBe('Bearer access-ocr');
    expect(xhr.headers.has('Content-Type')).toBe(false);

    xhr.progress(512, 2048, true);
    expect(progress).toHaveBeenLastCalledWith({ loadedBytes: 512, totalBytes: 2048 });
    xhr.finish(200, ticket());

    await expect(pending).resolves.toEqual(ticket());
    expect(fetchMock, 'el upload OCR cayó por el fetch compartido del riel monetario').not.toHaveBeenCalled();
  });

  it('si el navegador no conoce el total conserva bytes pero no fabrica porcentaje', async () => {
    const progress = vi.fn();
    const pending = httpOcrUploadRequest<unknown>(new FormData(), progress);
    const xhr = FakeXmlHttpRequest.instances[0];

    xhr.progress(512, 0, false);
    expect(progress).toHaveBeenLastCalledWith({ loadedBytes: 512, totalBytes: null });
    xhr.finish(200, ticket());
    await pending;
  });

  it('mantiene HttpError y el body del backend en un rechazo HTTP', async () => {
    const pending = httpOcrUploadRequest<unknown>(new FormData());
    FakeXmlHttpRequest.instances[0].finish(415, { error: 'invalid_image_type' });

    await expect(pending).rejects.toEqual(
      expect.objectContaining({
        status: 415,
        body: { error: 'invalid_image_type' },
      }),
    );
  });

  it('un 401 rota tokens una sola vez y reintenta el mismo FormData con el bearer nuevo', async () => {
    const form = new FormData();
    form.append('image', new Blob(['foto']), 'ticket.jpg');
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toMatch(/\/api\/auth\/refresh$/);
      return new Response(JSON.stringify({
        access_token: 'access-rotated',
        refresh_token: 'refresh-rotated',
        expires_in: 900,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const pending = api.scanTicket(new Blob(['foto']));
    FakeXmlHttpRequest.instances[0].finish(401, { error: 'expired' });
    await vi.waitFor(() => expect(FakeXmlHttpRequest.instances).toHaveLength(2));

    const retry = FakeXmlHttpRequest.instances[1];
    expect(retry.body).toBeInstanceOf(FormData);
    expect(retry.headers.get('Authorization')).toBe('Bearer access-rotated');
    retry.finish(200, ticket());

    await expect(pending).resolves.toEqual(ticket());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(loadSession()).toMatchObject({
      family_id: 'family-ocr',
      access_token: 'access-rotated',
      refresh_token: 'refresh-rotated',
    });
  });

  it('mantiene el timeout OCR y el decoder fail-closed después del transporte', async () => {
    const timed = api.scanTicket(new Blob(['foto']));
    const first = FakeXmlHttpRequest.instances[0];
    expect(first.timeout).toBe(60_000);
    first.timeOut();
    await expect(timed).rejects.toMatchObject({ name: 'AbortError' });

    const malformed = api.scanTicket(new Blob(['foto']));
    FakeXmlHttpRequest.instances[1].finish(200, { items: 'no-es-array' });
    await expect(malformed).rejects.toThrow('contract_response_invalid:ocr');
  });
});
