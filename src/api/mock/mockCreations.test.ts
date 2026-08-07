import { describe, expect, it } from 'vitest';
import { PAYLOAD_KEYS, payloadHash } from '../../utils/payloadIdentity';
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

function requestDeMesa(idempotencyKey: string): CreateMesaRequest {
  return {
    restaurant_id: MOCK_RESTAURANTS[0].id,
    total_cents: 30000,
    division_mode: 'consumo',
    expected_participants: 3,
    guarantee_method: 'card',
    idempotency_key: idempotencyKey,
    items: [{ name: 'Pizza', price_cents: 30000, quantity: 1 }],
  };
}

async function crearMesa(idempotencyKey: string): Promise<CreateMesaResponse> {
  return mockCreateMesa(requestDeMesa(idempotencyKey));
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
      ['dispersed', 'replayable'],
      ['partially_paid', 'partially_paid'],
      ['open', 'open'],
      ['pending_auth', 'requires_action'],
    ] as const) {
      mesa.status = status;
      expect(mesaCreationResponse(await mockGetMesaCreation(k)).outcome, status).toBe(esperado);
    }
  });

  it('🔴 v2.48.0 · un estado que la matriz no clasifica NO cae en `replayable`', async () => {
    // El emisor devuelve `unknown` en vez de inventar una etiqueta, y el mock
    // usa su misma tabla. Si esto se aflojara, una creación en un estado que
    // nadie clasificó liberaría el journal.
    const k = key();
    const creada = await crearMesa(k);
    const mesa = state.mesas.find((m) => m.code === creada.mesa.code)!;
    (mesa as { status: string }).status = 'estado_que_no_existe';
    const r = mesaCreationResponse(await mockGetMesaCreation(k));
    expect(r.outcome).toBe('unknown');
    expect(r.retryWithSameKey).toBe(false);
  });

  it('⭐ el `payload_hash` del FRONT coincide con el del mock: mismo algoritmo', async () => {
    // El front sella con `payloadHash(request, PAYLOAD_KEYS.create_mesa)` y el
    // mock guarda la forma canónica; el hash del dueño es `sha256(canónica)`.
    // Si las dos definiciones de "el mismo request" se separaran, el mock
    // contestaría 409 sobre su propia mesa — y el front lo leería como
    // "conservá el freeze". Este test es el que impide esa separación.
    const k = key();
    const req = requestDeMesa(k);
    await mockCreateMesa(req);
    const hash = await payloadHash(req, PAYLOAD_KEYS.create_mesa);
    const r = mesaCreationResponse(await mockGetMesaCreation(k, hash));
    expect(r.outcome).toBe('requires_action');
  });

  it('🔴 y un hash de OTRA intención económica sí da 409', async () => {
    const k = key();
    const req = requestDeMesa(k);
    await mockCreateMesa(req);
    const otro = await payloadHash({ ...req, total_cents: 999999 }, PAYLOAD_KEYS.create_mesa);
    await expect(mockGetMesaCreation(k, otro)).rejects.toMatchObject({
      status: 409,
      extra: { found: true, outcome: 'payload_hash_conflict', retry_with_same_idempotency_key: false },
    });
  });

  it('🔴 cambiar SÓLO la fuente de pago NO da conflicto: no es intención económica', async () => {
    // El corazón del B-06: Stripe.js materializa otro `pm_` por invocación, y
    // si eso rotara la clave se abriría una segunda mesa con un segundo hold.
    const k = key();
    const req = requestDeMesa(k);
    await mockCreateMesa(req);
    const conOtroPm = await payloadHash(
      { ...req, stripe_payment_method_id: 'pm_otro_distinto', save_payment_method: true },
      PAYLOAD_KEYS.create_mesa,
    );
    const r = mesaCreationResponse(await mockGetMesaCreation(k, conOtroPm));
    expect(r.outcome).toBe('requires_action');
  });
});
