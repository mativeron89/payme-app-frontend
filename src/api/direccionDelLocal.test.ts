import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * D504 · D507 · D511 · la dirección del local (App Backend 2.201.0, `ocr-merchant-v2.json` → `local_address_v1` y
 * `restaurant-resolution-v1.json` → `local_address`).
 * - La lectura de una mesa negocia `local_address_version=1`, exacto y una vez; la de un viaje, no.
 * - `merchant.address` con la forma exacta del dueño (`direccionPublicable`): si no cumple, la lectura se rechaza.
 * - Se reenvía tal cual como `address` al resolver.
 * - 🔴 Nunca se muestra (Aviso 3.1.0 §6): ninguna vista la nombra, y la e2e la busca en pantalla.
 */

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
const { direccionDelLocal } = await import('./direccionDelLocal');
const { resolutionRequest } = await import('./restaurantResolution');
const viajes = await import('./viajes');

const user = { id: 'dir-user', payme_id: 'payme_mx_dir', email: 'dir@example.com', first_name: 'Dir', last_name: 'User' };

function loggedIn() {
  saveSession({ access_token: 'a-dir', refresh_token: 'r-dir', family_id: 'family-dir', principal_id: user.id, user });
}

/** Una dirección como la publica el dueño: las seis claves, con `null` donde no se leyó. */
const DIRECCION = {
  street: 'Av. Insurgentes Sur', number: '1458-A', neighborhood: 'Actipan', postal_code: '03230', city: null, state: 'CDMX',
};

function ticket(merchant: Record<string, unknown> = { name: 'Tacos El Güero', rfc: 'TEG010101AB1' }) {
  return {
    contract_version: 2,
    merchant,
    items: [{ name: 'Taco', category: 'mexican', price_cents: 1000, quantity: 1, original_name: 'Taco' }],
    total_cents: 1000,
    warnings: [],
    mock: false,
  };
}

const foto = () => new Blob(['foto'], { type: 'image/jpeg' });

beforeEach(() => {
  storage.clear();
  FakeXmlHttpRequest.instances = [];
  vi.stubGlobal('XMLHttpRequest', FakeXmlHttpRequest);
  loggedIn();
});

afterEach(() => {
  vi.unstubAllGlobals();
  viajes.reiniciarViajesParaTests();
  storage.clear();
});

describe('D504 · la lectura de una mesa negocia la dirección del local', () => {
  it('🔴 pide `local_address_version=1`, exacto y una sola vez, y devuelve la dirección', async () => {
    const pending = api.scanTicket(foto());
    const xhr = FakeXmlHttpRequest.instances[0]!;
    expect(new URL(xhr.url, 'http://localhost').searchParams.getAll('local_address_version')).toEqual(['1']);
    xhr.finish(200, ticket({ name: 'Tacos El Güero', rfc: 'TEG010101AB1', address: DIRECCION }));
    await expect(pending).resolves.toMatchObject({ merchant: { name: 'Tacos El Güero', address: DIRECCION } });
  });

  it('el dueño no la publicó (persona física, sin dato): la lectura de siempre, sin `address`', async () => {
    const pending = api.scanTicket(foto());
    FakeXmlHttpRequest.instances[0]!.finish(200, ticket());
    const r = await pending;
    expect(r.merchant).toEqual({ name: 'Tacos El Güero', rfc: 'TEG010101AB1' });
  });

  it('un ticket sin nombre ni RFC legibles puede traer sólo la dirección', async () => {
    const pending = api.scanTicket(foto());
    FakeXmlHttpRequest.instances[0]!.finish(200, ticket({ address: DIRECCION }));
    await expect(pending).resolves.toMatchObject({ merchant: { address: DIRECCION } });
  });

  it('🔴 en un viaje no se pide, y una dirección que llegara igual rompe la lectura (clave desconocida)', async () => {
    viajes.aplicarConfigViajes({ features: { viajes: { supported: true, enabled: true } } });
    const pending = api.scanTicket(foto(), undefined, { viaje: true });
    const xhr = FakeXmlHttpRequest.instances[0]!;
    expect(new URL(xhr.url, 'http://localhost').searchParams.has('local_address_version')).toBe(false);
    xhr.finish(200, ticket({ name: 'Tacos El Güero', address: DIRECCION }));
    await expect(pending).rejects.toThrow('contract_response_invalid:ocr');
  });

  it.each([
    ['falta una clave', (({ city: _c, ...d }) => d)(DIRECCION)],
    ['una clave de más', { ...DIRECCION, interior: '3' }],
    ['un texto en vez del objeto', 'Av. Insurgentes Sur 1458'],
    ['el número no empieza con un dígito', { ...DIRECCION, number: 'S/N' }],
    ['el CP no tiene cinco dígitos', { ...DIRECCION, postal_code: '3230' }],
    ['la calle vacía', { ...DIRECCION, street: '' }],
    ['la calle sin recortar', { ...DIRECCION, street: ' Av. Insurgentes Sur' }],
    ['la calle de más de 200', { ...DIRECCION, street: 'x'.repeat(201) }],
    ['la colonia vacía (tiene que ser null)', { ...DIRECCION, neighborhood: '' }],
    ['la ciudad no es texto', { ...DIRECCION, city: 12 }],
  ])('🔴 una dirección que no cumple rompe la lectura: %s', async (_caso, address) => {
    const pending = api.scanTicket(foto());
    FakeXmlHttpRequest.instances[0]!.finish(200, ticket({ name: 'Tacos El Güero', address }));
    await expect(pending).rejects.toThrow('contract_response_invalid:ocr');
  });
});

describe('D504 · la forma exacta del dueño', () => {
  it('los topes son los del dueño, en unidades UTF-16', () => {
    expect(direccionDelLocal({ ...DIRECCION, street: 'x'.repeat(200), number: '1'.repeat(40) })).not.toBeNull();
    expect(direccionDelLocal({ ...DIRECCION, number: '1'.repeat(41) })).toBeNull();
    expect(direccionDelLocal({ ...DIRECCION, neighborhood: 'x'.repeat(120), city: 'x'.repeat(100), state: 'x'.repeat(100) }))
      .not.toBeNull();
    expect(direccionDelLocal({ ...DIRECCION, neighborhood: 'x'.repeat(121) })).toBeNull();
    expect(direccionDelLocal({ ...DIRECCION, state: 'x'.repeat(101) })).toBeNull();
  });

  it('las cuatro últimas pueden ser null; la calle y el número, no', () => {
    expect(direccionDelLocal({ ...DIRECCION, neighborhood: null, postal_code: null, city: null, state: null }))
      .toEqual({ street: DIRECCION.street, number: DIRECCION.number, neighborhood: null, postal_code: null, city: null, state: null });
    expect(direccionDelLocal({ ...DIRECCION, street: null })).toBeNull();
    expect(direccionDelLocal({ ...DIRECCION, number: null })).toBeNull();
  });
});

describe('D504 · D511 · se reenvía tal cual al resolver', () => {
  const UUID = '7f9c8f4e-3b2a-4c1d-9e8f-0a1b2c3d4e5f';

  it('🔴 con dirección, va como `address`, una copia igual', () => {
    const merchant = { name: 'Tacos El Güero', rfc: 'TEG010101AB1', address: DIRECCION };
    const req = resolutionRequest(merchant, UUID);
    expect(req).toEqual({ name: 'Tacos El Güero', rfc: 'TEG010101AB1', fallback_key: UUID, address: DIRECCION });
    expect(req.address).not.toBe(DIRECCION);
  });

  it('sin dirección, el pedido de siempre, sin la clave', () => {
    expect('address' in resolutionRequest({ name: 'Tacos El Güero' }, UUID)).toBe(false);
  });
});

/**
 * 🔴 Aviso 3.1.0 §6 · la dirección es identificación interna: ninguna vista la nombra. Se barren las pantallas, los
 * componentes, la ayuda y las traducciones (sin comentarios) buscando las claves de la dirección y su tipo. La única
 * excepción es la huella del pedido en `CreateMesaFlow.tsx` (`request.address`), que no se pinta.
 */
describe('🔴 D504 · ninguna vista nombra la dirección del local', () => {
  const RAIZ = new URL('..', import.meta.url).pathname;
  function archivos(dir: string): string[] {
    return readdirSync(dir).flatMap((nombre) => {
      const ruta = join(dir, nombre);
      return statSync(ruta).isDirectory() ? archivos(ruta) : /\.(tsx?|json)$/.test(nombre) && !/\.test\./.test(nombre) ? [ruta] : [];
    });
  }
  const sinComentarios = (texto: string) => texto.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('ni las claves de la dirección ni su tipo fuera de `src/api`', () => {
    const vistas = ['screens', 'components', 'ayuda', 'i18n'].flatMap((d) => archivos(join(RAIZ, d)));
    expect(vistas.length).toBeGreaterThan(50);
    const hallazgos = vistas.flatMap((ruta) => {
      const codigo = sinComentarios(readFileSync(ruta, 'utf8'));
      return [/postal_code/, /neighborhood/, /OcrLocalAddress/, /direccionDelLocal/, /merchant\??\.address/, /Merchant\??\.address/]
        .filter((patron) => patron.test(codigo))
        .map((patron) => `${ruta.slice(RAIZ.length)}: ${patron}`);
    });
    expect(hallazgos).toEqual([]);
  });

  it('la única mención en una pantalla es la huella del pedido al resolver', () => {
    const flujo = sinComentarios(readFileSync(join(RAIZ, 'screens/CreateMesaFlow.tsx'), 'utf8'));
    // `restaurant.address` es la dirección PÚBLICA del restaurante (la de siempre; en un privado el dueño la devuelve
    // `null` con o sin `address`): no es la del local. Fuera de ella, sólo la huella.
    expect(flujo.match(/(?<!restaurant\??)\.address\b/g) ?? []).toEqual(['.address']);
    expect(flujo).toContain('address: request.address ?? null,');
  });
});
