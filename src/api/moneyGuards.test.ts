import { describe, expect, it } from 'vitest';
import { createMesaResponse, normalizeNonNegativeCents, payableEqualSlotAmounts, payMesaResponse, topupCardResponse, topupOxxoResponse, topupStatusResponse, transferResponse } from './moneyGuards';

const UUID_A = 'a0000000-0000-4000-8000-000000000001';
const UUID_B = 'b0000000-0000-4000-8000-000000000002';
const UUID_C = 'c0000000-0000-4000-8000-000000000003';
const mesaRequest = { restaurant_id: UUID_A, total_cents: 1000, division_mode: 'igual' as const, expected_participants: 2, guarantee_method: 'card' as const, idempotency_key: 'mesa-idem-123', items: [{ name: 'Sopa', price_cents: 1000, quantity: 1 }] };
const payRequest = { payment_type: 'card' as const, items: [{ item_id: UUID_A, fraction_bps: 3333 }], tip_cents: 300, idempotency_key: 'idem-key-123' };
const consumptionBinding = { divisionMode: 'consumo' as const, tipCents: 300 };
const equalBinding = { divisionMode: 'igual' as const, possibleItemsAmountCents: [1000, 1001], tipCents: 300 };
const transferRequest = { amount_cents: 5000, to_payme_id: 'payme_mx_ab12', concept: 'Cena', idempotency_key: 'idem-key-123' };
const transferBinding = { recipientUserId: UUID_A, paymeId: 'payme_mx_ab12' };

describe('frontera contractual monetaria', () => {
  it('normaliza BIGINT decimal canónico de create mesa y verifica request completo', () => {
    const raw = {
      mesa: { id: UUID_A, code: 'PM-123', total_cents: '1000', division_mode: 'igual', expected_participants: 2, status: 'open', expires_at: '2026-08-02T12:00:00.000Z', created_at: '2026-08-02T11:30:00.000Z' },
      guarantee: { method: 'card', status: 'open' },
    };
    expect(createMesaResponse(raw, mesaRequest)).toMatchObject({ mesa: { total_cents: 1000 }, guarantee: { method: 'card', status: 'open' } });
    expect(() => createMesaResponse({ ...raw, mesa: { ...raw.mesa, total_cents: '1001' } }, mesaRequest)).toThrow('money_response_malformed');
    expect(() => createMesaResponse({ ...raw, guarantee: { method: 'wallet', status: 'open' } }, mesaRequest)).toThrow('money_response_malformed');
    const walletRequest = { ...mesaRequest, guarantee_method: 'wallet' as const };
    expect(() => createMesaResponse({
      ...raw,
      guarantee: { method: 'wallet', status: 'requires_action', client_secret: 'pi_secret' },
      mesa: { ...raw.mesa, status: 'pending_auth' },
    }, walletRequest)).toThrow('money_response_malformed');
  });

  it('acepta Stripe fresh sin payment_type y liga 3DS al recibo de consumo', () => {
    const fresh = { attempt: { id: UUID_B, gross_amount_cents: '1300', tip_cents: '300', items: [{ item_id: UUID_A, fraction_bps: 3333, amount_cents: '1000' }], client_secret: 'pi_secret', status: 'requires_action', stripe_status: 'requires_action', requires_action: true } };
    expect(payMesaResponse(fresh, payRequest, consumptionBinding)).toMatchObject({ attempt: { gross_amount_cents: 1300, tip_cents: 300, items: [{ item_id: UUID_A, fraction_bps: 3333, amount_cents: 1000 }], client_secret: 'pi_secret', requires_action: true } });
    expect(() => payMesaResponse({ attempt: { ...fresh.attempt, gross_amount_cents: '1301' } }, payRequest, consumptionBinding)).toThrow('money_response_malformed');
    expect(() => payMesaResponse({ attempt: { ...fresh.attempt, payment_type: 'wallet' } }, payRequest, consumptionBinding)).toThrow('money_response_malformed');
  });

  it('acepta el centavo completador y rechaza identidad/fracción ajenas', () => {
    const request = { ...payRequest, tip_cents: 0 };
    const binding = { ...consumptionBinding, tipCents: 0 };
    const third = { idempotent: true, attempt: { id: UUID_B, gross_amount_cents: '2334', tip_cents: '0', status: 'succeeded', payment_type: 'card', client_secret: null, requires_action: false, items: [{ item_id: UUID_A, fraction_bps: 3334, amount_cents: '2334' }] } };
    expect(payMesaResponse(third, request, binding)).toMatchObject({ attempt: { gross_amount_cents: 2334, items: [{ fraction_bps: 3334, amount_cents: 2334 }] } });
    expect(() => payMesaResponse({ attempt: { ...third.attempt, items: [{ item_id: UUID_C, fraction_bps: 3334, amount_cents: '2334' }] } }, request, binding)).toThrow('money_response_malformed');
    expect(() => payMesaResponse({ attempt: { ...third.attempt, items: [{ item_id: UUID_A, fraction_bps: 3433, amount_cents: '2334' }] } }, request, binding)).toThrow('money_response_malformed');
  });

  it('acepta el replay coordinado de consumo sin depender de aliases internos', () => {
    const replay = {
      idempotent: true,
      attempt: {
        id: UUID_B,
        gross_amount_cents: '1300',
        tip_cents: '300',
        payment_type: 'card',
        status: 'succeeded',
        client_secret: null,
        requires_action: false,
        items: [{ item_id: UUID_A, fraction_bps: 3333, amount_cents: '1000' }],
      },
    };
    expect(payMesaResponse(replay, payRequest, consumptionBinding)).toMatchObject({
      idempotent: true,
      attempt: {
        gross_amount_cents: 1300,
        tip_cents: 300,
        payment_type: 'card',
        items: [{ item_id: UUID_A, fraction_bps: 3333, amount_cents: 1000 }],
      },
    });
  });

  it('liga igualdad a montos de slots reales y no al preview aproximado', () => {
    const request = { ...payRequest, items: undefined, item_ids: [UUID_A] };
    const response = { idempotent: true, attempt: { id: UUID_B, gross_amount_cents: '1301', tip_cents: '300', status: 'succeeded', payment_type: 'card', client_secret: null, requires_action: false } };
    expect(payMesaResponse(response, request, equalBinding)).toMatchObject({ attempt: { gross_amount_cents: 1301, tip_cents: 300 } });
    expect(() => payMesaResponse({ attempt: { ...response.attempt, gross_amount_cents: '1302' } }, request, equalBinding)).toThrow('money_response_malformed');
  });

  it('wallet exige tipo explícito, tolera neutros de replay y rechaza Stripe accionable', () => {
    const walletRequest = { ...payRequest, payment_type: 'wallet' as const, items: undefined, item_ids: [UUID_A] };
    const base = { id: UUID_B, gross_amount_cents: '1300', tip_cents: '300', status: 'processed' };
    expect(payMesaResponse({ attempt: { ...base, payment_type: 'wallet' } }, walletRequest, equalBinding)).toMatchObject({ attempt: { payment_type: 'wallet' } });
    expect(() => payMesaResponse({ attempt: base }, walletRequest, equalBinding)).toThrow('money_response_malformed');
    const neutral = payMesaResponse({ idempotent: true, attempt: { ...base, payment_type: 'wallet', client_secret: null, requires_action: false } }, walletRequest, equalBinding);
    expect(neutral.attempt).not.toHaveProperty('client_secret');
    expect(neutral.attempt).not.toHaveProperty('requires_action');
    expect(() => payMesaResponse({ attempt: { ...base, payment_type: 'wallet', requires_action: true, client_secret: 'pi_secret' } }, walletRequest, equalBinding)).toThrow('money_response_malformed');
    expect(() => payMesaResponse({ attempt: { ...base, payment_type: 'wallet', connected_account_id: UUID_C } }, walletRequest, equalBinding)).toThrow('money_response_malformed');
    expect(() => payMesaResponse({ idempotent: true, attempt: base }, { ...payRequest, items: undefined, item_ids: [UUID_A] }, equalBinding)).toThrow('money_response_malformed');
  });

  it('no acepta omisión de payment_type con un shape que no acredita Stripe fresh', () => {
    const request = { ...payRequest, items: undefined, item_ids: [UUID_A] };
    const walletLike = { attempt: { id: UUID_B, gross_amount_cents: '1300', tip_cents: '300', status: 'processed' } };
    expect(() => payMesaResponse(walletLike, request, equalBinding)).toThrow('money_response_malformed');
    expect(() => payMesaResponse({ attempt: { ...walletLike.attempt, payment_type: 'card' } }, request, equalBinding)).toThrow('money_response_malformed');
  });

  it('rechaza estados locales y Stripe contradictorios', () => {
    const request = { ...payRequest, items: undefined, item_ids: [UUID_A] };
    const contradictory = {
      attempt: {
        id: UUID_B,
        gross_amount_cents: '1300',
        tip_cents: '300',
        status: 'succeeded',
        payment_type: 'card',
        client_secret: 'pi_secret',
        stripe_status: 'processing',
        requires_action: false,
      },
    };
    expect(() => payMesaResponse(contradictory, request, equalBinding)).toThrow('money_response_malformed');
  });

  it('sólo acredita slots disponibles o propios, nunca un slot ajeno', () => {
    expect(payableEqualSlotAmounts([
      { slot_index: 1, amount_cents: 1000, amount_display: '$10.00', status: 'available' },
      { slot_index: 2, amount_cents: 1001, amount_display: '$10.01', status: 'paid', claimed_by_me: true },
      { slot_index: 3, amount_cents: 9999, amount_display: '$99.99', status: 'claimed', claimed_by_me: false },
      { slot_index: 4, amount_cents: 9998, amount_display: '$99.98', status: 'paid' },
    ])).toEqual([1000, 1001]);
  });

  it('normaliza tip_cents/tip_amount_cents y rechaza discrepancias', () => {
    const request = { ...payRequest, items: undefined, item_ids: [UUID_A] };
    const replay = { idempotent: true, attempt: { id: UUID_B, status: 'succeeded', gross_amount_cents: '1300', tip_amount_cents: '300', payment_type: 'card', client_secret: null, requires_action: false } };
    expect(payMesaResponse(replay, request, equalBinding)).toMatchObject({ attempt: { tip_cents: 300 } });
    expect(() => payMesaResponse({ idempotent: true, attempt: { ...replay.attempt, tip_cents: '301' } }, request, equalBinding)).toThrow('money_response_malformed');
  });

  it('falla cerrado el shape legacy del mirror que omite tip/tipo y recibo', () => {
    const replay = { idempotent: true, attempt: { id: UUID_B, status: 'requires_action', stripe_client_secret: 'pi_secret', gross_amount_cents: '1300' } };
    expect(() => payMesaResponse(replay, payRequest, consumptionBinding)).toThrow('money_response_malformed');
  });

  it('normaliza topup fresh/replay/GET sin inventar requires_action ni display', () => {
    const fresh = { topup: { id: UUID_C, status: 'processing', amount_cents: '5000' }, requires_action: true, client_secret: 'pi_secret' };
    expect(topupCardResponse(fresh, 5000)).toMatchObject({ topup: { method: 'card', amount_cents: 5000, amount_display: '$50.00' }, requires_action: true });
    const replay = { idempotent: true, topup: { id: UUID_C, method: 'card', status: 'processing', amount_cents: '5000', voucher_reference: null, voucher_expires_at: null, stripe_voucher_url: null } };
    expect(topupCardResponse(replay, 5000)).toMatchObject({ idempotent: true, topup: { method: 'card', amount_display: '$50.00' } });
    expect(topupCardResponse(replay, 5000).topup).not.toHaveProperty('stripe_voucher_url');
    expect(topupCardResponse(replay, 5000).requires_action).toBeUndefined();
    const polled = { topup: { id: UUID_C, method: 'card', status: 'succeeded', amount_cents: '5000' } };
    expect(topupStatusResponse(polled, { id: UUID_C, amountCents: 5000, method: 'card' })).toMatchObject({ topup: { status: 'succeeded', amount_cents: 5000 } });
    expect(() => topupStatusResponse({ topup: { ...polled.topup, amount_cents: '7000' } }, { id: UUID_C, amountCents: 5000, method: 'card' })).toThrow('money_response_malformed');
    expect(() => topupCardResponse({ topup: { ...polled.topup }, requires_action: true, client_secret: 'pi_secret' }, 5000)).toThrow('money_response_malformed');
    expect(() => topupCardResponse({ idempotent: true, topup: { ...polled.topup }, client_secret: 'pi_secret' }, 5000)).toThrow('money_response_malformed');
  });

  it('acepta OXXO fresco y rechaza dentro del guard el replay activo sin voucher', () => {
    const oxxo = { topup: { id: UUID_C, status: 'processing', amount_cents: '5000', voucher_reference: '1234', voucher_expires_at: '2026-08-03T12:00:00.000Z', stripe_voucher_url: null } };
    expect(topupOxxoResponse(oxxo, 5000).topup.amount_display).toBe('$50.00');
    expect(() => topupOxxoResponse({ idempotent: true, topup: { id: UUID_C, method: 'oxxo', status: 'processing', amount_cents: '5000' } }, 5000)).toThrow('money_response_unbound');
  });

  it('no inventa el riel de topup cuando falta method', () => {
    const cardFresh = { topup: { id: UUID_C, status: 'succeeded', amount_cents: '5000' }, requires_action: false };
    expect(() => topupOxxoResponse(cardFresh, 5000)).toThrow('money_response_malformed');
    const oxxoFresh = { topup: { id: UUID_C, status: 'processing', amount_cents: '5000', voucher_reference: '1234', voucher_expires_at: '2026-08-03T12:00:00.000Z' } };
    expect(() => topupCardResponse(oxxoFresh, 5000)).toThrow('money_response_malformed');
    expect(() => topupCardResponse({ ...cardFresh, topup: { ...cardFresh.topup, voucher_reference: '1234' } }, 5000)).toThrow('money_response_malformed');
    expect(() => topupCardResponse({ topup: { id: UUID_C, status: 'succeeded', amount_cents: '5000' } }, 5000)).toThrow('money_response_malformed');
    expect(() => topupOxxoResponse({ idempotent: true, topup: { id: UUID_C, method: 'card', status: 'succeeded', amount_cents: '5000' } }, 5000)).toThrow('money_response_malformed');
  });

  it('liga transferencia fresh por payme_id y replay por to_user_id contractual', () => {
    const fresh = { transfer: { id: UUID_B, amount_cents: '5000', concept: 'Cena', completed_at: '2026-08-02T12:00:00.000Z', to: { payme_id: 'payme_mx_ab12', full_name: 'Ana Pérez' } } };
    expect(transferResponse(fresh, transferRequest, transferBinding)).toMatchObject({ transfer: { amount_cents: 5000, amount_display: '$50.00' } });
    const replay = { idempotent: true, transfer: { id: UUID_B, amount_cents: '5000', concept: 'Cena', status: 'completed', completed_at: '2026-08-02T12:00:00.000Z', to_user_id: UUID_A } };
    expect(transferResponse(replay, transferRequest, transferBinding)).toMatchObject({ idempotent: true, transfer: { status: 'completed', to_user_id: UUID_A } });
    expect(() => transferResponse({ idempotent: true, transfer: { ...replay.transfer, to_user_id: UUID_C } }, transferRequest, transferBinding)).toThrow('money_response_unbound');
    expect(() => transferResponse({ idempotent: true, transfer: { ...replay.transfer, status: 'pending' } }, transferRequest, transferBinding)).toThrow('money_response_unbound');
  });

  it.each(['00', '01', '+1', ' 1', '1 ', '1.0', '1e3', '-1', '9007199254740992'])('rechaza centavos no canónicos o inseguros: %s', (value) => {
    expect(() => normalizeNonNegativeCents(value)).toThrow('money_response_malformed');
  });

  it('rechaza status, método, monto y destinatario ajenos', () => {
    const topup = { topup: { id: UUID_C, method: 'card', status: 'unknown', amount_cents: '5000' } };
    expect(() => topupCardResponse(topup, 5000)).toThrow('money_response_malformed');
    expect(() => topupCardResponse({ topup: { id: UUID_C, method: 'oxxo', status: 'processing', amount_cents: '5000' } }, 5000)).toThrow('money_response_malformed');
    const transfer = { transfer: { id: UUID_B, amount_cents: '5000', concept: 'Cena', completed_at: '2026-08-02T12:00:00.000Z', to: { payme_id: 'payme_mx_zz99', full_name: 'Otra' } } };
    expect(() => transferResponse(transfer, transferRequest, transferBinding)).toThrow('money_response_malformed');
    expect(() => normalizeNonNegativeCents(Number.MAX_SAFE_INTEGER + 1)).toThrow('money_response_malformed');
  });
});

/**
 * 🔴 **C3 · la mesa SIN garantía en el decoder de dinero, con su combinación
 * cerrada.**
 *
 * El dueño responde `{ method:'none', status:'none' }` con la mesa ya `open`
 * (`contract-mirror/routes/mesas.js:663-671`), antes de tocar Stripe. Hasta acá
 * este decoder lo declaraba malformado, y el efecto era el peor de los tres
 * posibles: **la mesa se creaba de verdad y el front la trataba como apertura
 * fallida**, mostrando «apertura sin confirmar» sobre una mesa que existía.
 *
 * Aceptar `none` **no relaja nada de lo demás**. Cada combinación que no sea la
 * exacta del dueño sigue fallando, y las de `card`/`wallet` no cambian.
 */
describe('C3 · garantía `none`, y sólo en su combinación exacta', () => {
  // Mismo molde que `mesaRequest`, con el método de C3: el decoder compara el
  // request COMPLETO contra la respuesta, así que un objeto parcial no sirve.
  const base = { ...mesaRequest, total_cents: 84000, expected_participants: 4, guarantee_method: 'none' as const };
  function respuesta(guarantee: Record<string, unknown>, mesaStatus = 'open') {
    return {
      mesa: {
        id: UUID_A,
        code: 'PA-1234',
        total_cents: 84000,
        division_mode: 'igual',
        expected_participants: 4,
        status: mesaStatus,
        expires_at: '2026-09-03T00:00:00.000Z',
        created_at: '2026-09-02T19:00:00.000Z',
      },
      guarantee,
    };
  }

  it('acepta `none/none` con la mesa `open`', () => {
    const r = createMesaResponse(respuesta({ method: 'none', status: 'none' }), base);
    expect(r.guarantee.method).toBe('none');
    expect(r.guarantee.status).toBe('none');
    expect(r.mesa.status).toBe('open');
  });

  it('rechaza `none/none` con la mesa en `pending_auth`', () => {
    // Sin esta coherencia, `none` habría aceptado la mesa en cualquier estado —
    // más laxo que `open` y `requires_action`, que sí la exigen.
    expect(() => createMesaResponse(respuesta({ method: 'none', status: 'none' }, 'pending_auth'), base)).toThrow();
  });

  it('rechaza los cruces: `none/open`, `none/requires_action`, `card/none` y `wallet/none`', () => {
    expect(() => createMesaResponse(respuesta({ method: 'none', status: 'open' }), base)).toThrow();
    expect(() => createMesaResponse(respuesta({ method: 'none', status: 'requires_action' }), base)).toThrow();
    expect(() => createMesaResponse(respuesta({ method: 'card', status: 'none' }), { ...base, guarantee_method: 'card' })).toThrow();
    expect(() => createMesaResponse(respuesta({ method: 'wallet', status: 'none' }), { ...base, guarantee_method: 'wallet' })).toThrow();
  });

  it('rechaza `none/none` que traiga `client_secret` o `connected_account_id`', () => {
    // Sin garantía no hay hold: un secreto de 3DS o una cuenta conectada ahí
    // significan que el dueño hizo algo con dinero, y este camino promete que no.
    expect(() => createMesaResponse(
      respuesta({ method: 'none', status: 'none', client_secret: 'pi_x_cs' }), base,
    )).toThrow();
    expect(() => createMesaResponse(
      respuesta({ method: 'none', status: 'none', connected_account_id: 'acct_123' }), base,
    )).toThrow();
  });
});
