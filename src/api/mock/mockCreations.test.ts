import { describe, expect, it } from 'vitest';
import { mesaCreationResponse } from '../contractResponses';
import type { CreateMesaRequest, CreateMesaResponse } from '../types';
import { mockConfirmGuarantee3ds, mockCreateMesa, mockGetMesaCreation } from './mockApi';
import { MOCK_RESTAURANTS } from './seedData';
import { state } from './store';

/**
 * ORDEN 2A · el mock de `GET /mesas/creations/:idempotency_key`.
 *
 * El mock es el riel donde Mati mira la app y donde corren los e2e: si acá el
 * endpoint contesta algo más lindo que el real, la demo pasa y la producción
 * falla. Por eso se prueba **atravesando el decoder de verdad**
 * (`mesaCreationResponse`), no comparando el objeto crudo contra sí mismo: un
 * mock que sólo se valida contra su propio shape no acredita nada.
 */

let n = 0;
function key(): string {
  n += 1;
  return `mock-creations-${n}-${'0'.repeat(4)}`;
}

async function crearMesa(idempotencyKey: string): Promise<CreateMesaResponse> {
  const req: CreateMesaRequest = {
    restaurant_id: MOCK_RESTAURANTS[0].id,
    total_cents: 30000,
    division_mode: 'consumo',
    expected_participants: 3,
    guarantee_method: 'card',
    idempotency_key: idempotencyKey,
    items: [{ name: 'Pizza', price_cents: 30000, quantity: 1 }],
  };
  return mockCreateMesa(req);
}

describe('mock · la creación se consulta POR SU CLAVE', () => {
  it('recién creada con tarjeta → requires_action, y el contrato habilita reintentar', async () => {
    const k = key();
    const creada = await crearMesa(k);
    const r = mesaCreationResponse(await mockGetMesaCreation(k));

    expect(r.outcome).toBe('requires_action');
    expect(r.mesa?.code).toBe(creada.mesa.code);
    expect(r.mesa?.status).toBe('pending_auth');
    expect(r.retryWithSameKey).toBe(true);
    expect(r.guarantee).toEqual({ method: 'card', authorized: false });
  });

  it('⭐ después del 3DS la MISMA clave contesta `open`: el estado sale de la mesa viva', async () => {
    // Si el mock devolviera la respuesta congelada del idempotency store,
    // seguiría diciendo `pending_auth` para siempre y el endpoint no serviría
    // para lo único que existe: decir en qué quedó la apertura.
    const k = key();
    const creada = await crearMesa(k);
    await mockConfirmGuarantee3ds(creada.mesa.code);

    const r = mesaCreationResponse(await mockGetMesaCreation(k));
    expect(r.outcome).toBe('open');
    expect(r.retryWithSameKey).toBe(false);
    expect(r.guarantee?.authorized).toBe(true);
  });

  it('una clave que nunca creó nada → 404 con CUERPO, no una falla pelada', async () => {
    await expect(mockGetMesaCreation('mock-creations-jamas-usada')).rejects.toMatchObject({
      status: 404,
      extra: { found: false, outcome: 'not_found', retry_with_same_idempotency_key: true },
    });
  });

  it('una clave fuera de 1..200 caracteres es un error del cliente, no un estado', async () => {
    await expect(mockGetMesaCreation('')).rejects.toMatchObject({ status: 400, message: 'idempotency_key_invalid' });
    await expect(mockGetMesaCreation('x'.repeat(201))).rejects.toMatchObject({ status: 400 });
  });

  it('⚠️ `total_cents` sale como STRING, igual que el real', async () => {
    // Mismo helper y mismo bigint del driver del lado del dueño. Un mock que
    // mandara el entero taparía el día que el decoder deje de aceptar la forma
    // real — y por eso acá se mira el crudo, no el decodificado.
    const k = key();
    await crearMesa(k);
    const crudo = await mockGetMesaCreation(k) as { mesa: { total_cents: unknown } };
    expect(typeof crudo.mesa.total_cents).toBe('string');
    expect(crudo.mesa.total_cents).toBe('30000');
  });

  it('estados terminales → `terminal`; los posteriores a la apertura → `replayable`', async () => {
    // Una sola mesa a la que se le mueve el estado: la clasificación es del
    // estado, no de la mesa, y crear seis costaría seis latencias del mock.
    const k = key();
    const creada = await crearMesa(k);
    const mesa = state.mesas.find((m) => m.code === creada.mesa.code)!;
    for (const [status, esperado] of [
      ['cancelled', 'terminal'],
      ['auth_failed', 'terminal'],
      ['expired', 'terminal'],
      ['fully_paid', 'replayable'],
      ['settling', 'replayable'],
      ['completed', 'replayable'],
      ['partially_paid', 'partially_paid'],
      ['open', 'open'],
      ['pending_auth', 'requires_action'],
    ] as const) {
      mesa.status = status;
      expect(mesaCreationResponse(await mockGetMesaCreation(k)).outcome, status).toBe(esperado);
    }
  });

  it('el hash del payload, cuando se manda, distingue otra intención económica', async () => {
    // Este front todavía NO lo manda (ver `getMesaCreation` en la fachada),
    // pero el mock no puede ser una versión recortada del contrato.
    const k = key();
    await crearMesa(k);
    await expect(mockGetMesaCreation(k, 'sha256-de-otra-cosa')).rejects.toMatchObject({
      status: 409,
      extra: { found: true, outcome: 'payload_hash_conflict', retry_with_same_idempotency_key: false },
    });
  });
});
