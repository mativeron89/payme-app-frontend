import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const storage = new MemoryStorage();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });

const { saveSession } = await import('./storage');
const { api, IS_MOCK } = await import('./index');
const { getWalletRailState, resetWalletRailForTests } = await import('./walletRail');
const { nativeWalletsSnapshot, resetNativeWalletsForTests } = await import('./nativeWallets');

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  expect(IS_MOCK).toBe(false);
  saveSession({
    access_token: 'access-contract',
    refresh_token: 'refresh-contract',
    family_id: 'family-contract',
    principal_id: 'user-contract',
    user: {
      id: 'user-contract',
      payme_id: 'payme_mx_contract',
      email: 'contract@example.com',
      first_name: 'Con',
      last_name: 'Trato',
    },
  });
});

afterEach(() => {
  storage.values.clear();
  vi.unstubAllGlobals();
});

describe('fachada real: contrato idempotente aditivo', () => {
  /**
   * OLA 5D · esto ya NO afirma una constante de este repo.
   *
   * Antes acá se leía `expect(WALLET_RAIL_ENABLED).toBe(false)`, que probaba
   * que el front había decidido bien — no que el riel estuviera apagado. El
   * estado inicial de la fachada real es el fail-closed: **antes de que el
   * backend conteste, el riel está apagado**, así que no existe ventana en la
   * que la UI de saldo aparezca por no haber llegado la capability todavía.
   *
   * Que el backend pueda apagarlo se prueba en `walletRail.test.ts`.
   */
  it('la fachada real arranca con el riel saldo APAGADO antes de cualquier respuesta', () => {
    resetWalletRailForTests();
    const inicial = getWalletRailState();
    expect(inicial.walletRailEnabled).toBe(false);
    expect(inicial.status).toBe('pending');
    // Y la superficie card-only ratificada NO se esconde por no tener respuesta.
    expect(inicial.accountActivity).toBe(true);
    resetNativeWalletsForTests();
    expect(nativeWalletsSnapshot().apple.available).toBe(false);
    expect(nativeWalletsSnapshot().google.available).toBe(false);
  });

  it('rechaza OCR por encima de los 8 MiB que acepta el backend antes de red', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.scanTicket({ size: 8 * 1024 * 1024 + 1 } as Blob))
      .rejects.toThrow('hasta 8 MiB');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([200, 201])('acepta invitación %i y envía la key obligatoria del facade', async (status) => {
    const body = {
      invitation: {
        id: 'invitation-id',
        invitation_type: 'link',
        status: 'pending',
        expires_at: '2026-08-04T00:00:00.000Z',
        created_at: '2026-08-03T00:00:00.000Z',
      },
      link: 'https://payme.test/#/mesa/PM-123?t=token',
      ...(status === 200 && { idempotent: true }),
    };
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(body, status));
    vi.stubGlobal('fetch', fetchMock);
    // ORDEN 1A.2 · el link se valida contra el ORIGEN donde corre la app. En
    // node no hay `window`, así que el decoder rechaza TODO —fail-closed
    // correcto— y el test tiene que declarar desde dónde se sirve la app.
    vi.stubGlobal('window', { location: { origin: 'https://payme.test' } });

    await expect(api.createInvitation('PM-123', 'invitation-idem-key-1')).resolves.toEqual(body);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({
      type: 'link',
      idempotency_key: 'invitation-idem-key-1',
    });
  });

  it('envía la misma key también al invitar por payme_id', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({
      invitation: {
        id: 'invitation-id',
        invitation_type: 'in_app',
        status: 'pending',
        expires_at: '2026-08-04T00:00:00.000Z',
        created_at: '2026-08-03T00:00:00.000Z',
      },
    }, 201));
    vi.stubGlobal('fetch', fetchMock);

    await api.inviteFriend('PM-123', 'payme_mx_sofi', 'friend-idem-key-1');
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({
      type: 'in_app',
      invited_payme_id: 'payme_mx_sofi',
      idempotency_key: 'friend-idem-key-1',
    });
  });

  it.each([200, 201])('tipa attach %i y setup transporta su key', async (attachStatus) => {
    const setup = { setup_intent_id: 'seti_contract', client_secret: 'seti_contract_secret' };
    const attached = {
      payment_method: {
        id: 'payment-method-id',
        stripe_payment_method_id: 'pm_contract',
        brand: 'visa',
        bank_name: null,
        type: 'credit',
        last_four: '4242',
        exp_month: 8,
        exp_year: 2030,
        is_default: true,
        display: 'Visa · Crédito · •••• 4242',
      },
      ...(attachStatus === 200 && { idempotent: true }),
    };
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) =>
      url.endsWith('/setup-intent')
        ? jsonResponse(setup, 200)
        : jsonResponse(attached, attachStatus));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.createSetupIntent('setup-idem-key-1')).resolves.toEqual(setup);
    await expect(api.attachPaymentMethod('pm_contract', true)).resolves.toEqual(attached);
    const setupInit = fetchMock.mock.calls[0][1] as RequestInit;
    const attachInit = fetchMock.mock.calls[1][1] as RequestInit;
    expect(JSON.parse(setupInit.body as string)).toEqual({ idempotency_key: 'setup-idem-key-1' });
    expect(JSON.parse(attachInit.body as string)).toEqual({
      stripe_payment_method_id: 'pm_contract',
      set_as_default: true,
    });
  });

  it('rechaza 2xx malformados y conserva una señal de contrato, no un falso éxito', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/setup-intent')) return jsonResponse({}, 200);
      if (url.endsWith('/payment-methods')) return jsonResponse({}, 201);
      return jsonResponse({ invitation: {} }, 201);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.createSetupIntent('setup-malformed-key')).rejects.toThrow('contract_response_invalid');
    await expect(api.attachPaymentMethod('pm_malformed')).rejects.toThrow('contract_response_invalid');
    await expect(api.createInvitation('PM-123', 'invite-malformed-key')).rejects.toThrow('contract_response_invalid');
  });
});

/**
 * ORDEN 2A · la fachada real de `GET /mesas/creations/:idempotency_key`.
 *
 * El punto fino: **el 404 y el 409 de este endpoint son RESPUESTAS del
 * contrato, no fallas.** Si la fachada los dejara pasar como error, "no existe
 * ninguna creación con tu clave" llegaría a la pantalla como "no pudimos
 * consultar" — justo la confusión que este endpoint viene a terminar. Y al
 * revés: cualquier OTRO error tiene que seguir siendo error, porque un 500 o
 * una red caída no dicen nada sobre la creación.
 */
describe('fachada real: reconciliación de una creación', () => {
  const CLAVE = '11111111-2222-4333-8444-555555555555';

  it('el 200 decodifica y la clave viaja escapada en el path', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(String(url)).toContain(`/mesas/creations/${encodeURIComponent(CLAVE)}`);
      return jsonResponse({
        found: true,
        outcome: 'requires_action',
        retry_with_same_idempotency_key: true,
        mesa: { code: 'PA-2847', status: 'pending_auth', total_cents: '84000' },
        guarantee: {
          method: 'card', authorized: false,
          saved_payment_method_id: '11111111-1111-4111-8111-111111111111',
        },
      }, 200);
    });
    vi.stubGlobal('fetch', fetchMock);

    const r = await api.getMesaCreation(CLAVE);
    expect(r.outcome).toBe('requires_action');
    expect(r.mesa).toEqual({ code: 'PA-2847', status: 'pending_auth', totalCents: 84000 });
    expect(r.guarantee?.savedPaymentMethodId).toBe('11111111-1111-4111-8111-111111111111');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('⭐ el 404 `not_found` NO llega como falla: es la respuesta del contrato', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      found: false, outcome: 'not_found', retry_with_same_idempotency_key: true,
    }, 404)));

    const r = await api.getMesaCreation(CLAVE);
    expect(r.outcome).toBe('not_found');
    expect(r.retryWithSameKey).toBe(true);
    expect(r.mesa).toBeNull();
  });

  it('el 409 `payload_hash_conflict` tampoco: llega decodificado y sin mesa', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      found: true, outcome: 'payload_hash_conflict', retry_with_same_idempotency_key: false,
    }, 409)));

    const r = await api.getMesaCreation(CLAVE);
    expect(r.outcome).toBe('payload_hash_conflict');
    expect(r.retryWithSameKey).toBe(false);
  });

  it('🔴 MUTANTE · un 500 SIGUE siendo un error: no sabemos nada de la creación', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'internal_error' }, 500)));
    await expect(api.getMesaCreation(CLAVE)).rejects.toThrow();
  });

  it('🔴 MUTANTE · un 404 con cuerpo que NO decodifica se relanza, no se inventa', async () => {
    // Fabricar un `not_found` acá sería afirmar que no existe una creación
    // sobre la que el backend no dijo nada legible.
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'not_found' }, 404)));
    await expect(api.getMesaCreation(CLAVE)).rejects.toThrow();
  });

  it('🔴 MUTANTE · un 200 malformado no es un resultado', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      found: true, outcome: 'open', retry_with_same_idempotency_key: false, mesa: { code: '' },
    }, 200)));
    await expect(api.getMesaCreation(CLAVE)).rejects.toThrow('contract_response_invalid');
  });

  it('🔴 la consulta es un GET: diagnosticar no puede mover un centavo', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.method).toBe('GET');
      expect(init?.body).toBeUndefined();
      return jsonResponse({ found: false, outcome: 'not_found', retry_with_same_idempotency_key: true }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    await api.getMesaCreation(CLAVE);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
