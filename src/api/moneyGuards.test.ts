import { describe, expect, it } from 'vitest';
import { createMesaResponse, normalizeNonNegativeCents, payMesaResponse, topupCardResponse, topupOxxoResponse, topupStatusResponse, transferResponse } from './moneyGuards';

const UUID_A = 'a0000000-0000-4000-8000-000000000001';
const UUID_B = 'b0000000-0000-4000-8000-000000000002';
const UUID_C = 'c0000000-0000-4000-8000-000000000003';
const mesaRequest = { restaurant_id: UUID_A, total_cents: 1000, division_mode: 'igual' as const, expected_participants: 2, guarantee_method: 'card' as const, items: [{ name: 'Sopa', price_cents: 1000, quantity: 1 }] };
const payRequest = { payment_type: 'card' as const, item_ids: [UUID_A], tip_cents: 300, idempotency_key: 'idem-key-123' };
const payBinding = { grossCents: 1300, tipCents: 300 };
const transferRequest = { amount_cents: 5000, to_payme_id: 'payme_mx_ab12', concept: 'Cena', idempotency_key: 'idem-key-123' };

describe('frontera contractual monetaria', () => {
  it('normaliza BIGINT decimal canónico de create mesa y verifica request completo', () => {
    // Forma de routes/mesas.js: mesa es la fila RETURNING; pg puede serializar
    // total_cents BIGINT como string decimal.
    const raw = {
      mesa: { id: UUID_A, code: 'PM-123', total_cents: '1000', division_mode: 'igual', expected_participants: 2, status: 'open', expires_at: '2026-08-02T12:00:00.000Z', created_at: '2026-08-02T11:30:00.000Z' },
      guarantee: { method: 'card', status: 'open' },
    };
    expect(createMesaResponse(raw, mesaRequest)).toMatchObject({ mesa: { total_cents: 1000 }, guarantee: { method: 'card', status: 'open' } });
    expect(() => createMesaResponse({ ...raw, mesa: { ...raw.mesa, total_cents: '1001' } }, mesaRequest)).toThrow('money_response_malformed');
    expect(() => createMesaResponse({ ...raw, guarantee: { method: 'wallet', status: 'open' } }, mesaRequest)).toThrow('money_response_malformed');
  });

  it('acepta tarjeta fresca sin payment_type pero conserva 3DS request-bound', () => {
    // Forma exacta de routes/mesas.js:878-892: no incluye payment_type.
    const fresh = { attempt: { id: UUID_B, gross_amount_cents: '1300', tip_cents: '300', client_secret: 'pi_secret', status: 'requires_action', stripe_status: 'requires_action', requires_action: true } };
    expect(payMesaResponse(fresh, payRequest, payBinding)).toMatchObject({ attempt: { gross_amount_cents: 1300, tip_cents: 300, client_secret: 'pi_secret', requires_action: true } });
    expect(() => payMesaResponse({ attempt: { ...fresh.attempt, gross_amount_cents: '1301' } }, payRequest, payBinding)).toThrow('money_response_malformed');
    expect(() => payMesaResponse({ attempt: { ...fresh.attempt, payment_type: 'wallet' } }, payRequest, payBinding)).toThrow('money_response_malformed');
  });

  it('falla cerrado el replay de pago que el espejo no puede ligar al tip', () => {
    // findExistingAttempt (routes/mesas.js:1055-1059) selecciona gross y
    // secret, pero omite tip_amount_cents y payment_type.
    const replay = { idempotent: true, attempt: { id: UUID_B, status: 'requires_action', stripe_client_secret: 'pi_secret', gross_amount_cents: '1300' } };
    expect(() => payMesaResponse(replay, payRequest, payBinding)).toThrow('money_response_malformed');
  });

  it('normaliza topup fresh/replay/GET sin inventar requires_action ni display', () => {
    // Fresh card (routes/topup.js:282-290): method no aparece, 3DS sí.
    const fresh = { topup: { id: UUID_C, status: 'processing', amount_cents: '5000' }, requires_action: true, client_secret: 'pi_secret' };
    expect(topupCardResponse(fresh, 5000)).toMatchObject({ topup: { method: 'card', amount_cents: 5000, amount_display: '$50.00' }, requires_action: true });
    // Replay (routes/topup.js:23-30, 211-212): fila cruda, con method pero
    // sin amount_display/requires_action/client_secret.
    const replay = { idempotent: true, topup: { id: UUID_C, method: 'card', status: 'processing', amount_cents: '5000' } };
    expect(topupCardResponse(replay, 5000)).toMatchObject({ idempotent: true, topup: { method: 'card', amount_display: '$50.00' } });
    expect(topupCardResponse(replay, 5000).requires_action).toBeUndefined();
    const polled = { topup: { id: UUID_C, method: 'card', status: 'succeeded', amount_cents: '5000' } };
    expect(topupStatusResponse(polled, { id: UUID_C, amountCents: 5000, method: 'card' })).toMatchObject({ topup: { status: 'succeeded', amount_cents: 5000 } });
    expect(() => topupStatusResponse({ topup: { ...polled.topup, amount_cents: '7000' } }, { id: UUID_C, amountCents: 5000, method: 'card' })).toThrow('money_response_malformed');
  });

  it('acepta OXXO fresco y bloquea una transferencia replay sin destinatario', () => {
    const oxxo = { topup: { id: UUID_C, status: 'processing', amount_cents: '5000', voucher_reference: '1234', voucher_expires_at: '2026-08-03T12:00:00.000Z', stripe_voucher_url: null } };
    expect(topupOxxoResponse(oxxo, 5000).topup.amount_display).toBe('$50.00');
    // Fresh transfer (routes/transfers.js:202-210): amount BIGINT + `to`.
    const freshTransfer = { transfer: { id: UUID_B, amount_cents: '5000', concept: 'Cena', completed_at: '2026-08-02T12:00:00.000Z', to: { payme_id: 'payme_mx_ab12', full_name: 'Ana Pérez' } } };
    expect(transferResponse(freshTransfer, transferRequest)).toMatchObject({ transfer: { amount_cents: 5000, amount_display: '$50.00' } });
    // Replay real (routes/transfers.js:22-30, 61-65) no selecciona `to`.
    const replay = { idempotent: true, transfer: { id: UUID_B, amount_cents: '5000', concept: 'Cena', status: 'completed', completed_at: '2026-08-02T12:00:00.000Z' } };
    expect(() => transferResponse(replay, transferRequest)).toThrow('money_response_unbound');
  });

  it.each(['00', '01', '+1', ' 1', '1 ', '1.0', '1e3', '-1', '9007199254740992'])('rechaza centavos no canónicos o inseguros: %s', (value) => {
    expect(() => normalizeNonNegativeCents(value)).toThrow('money_response_malformed');
  });

  it('rechaza status, método, monto y destinatario que no pertenecen al request', () => {
    const topup = { topup: { id: UUID_C, method: 'card', status: 'unknown', amount_cents: '5000' } };
    expect(() => topupCardResponse(topup, 5000)).toThrow('money_response_malformed');
    expect(() => topupCardResponse({ topup: { id: UUID_C, method: 'oxxo', status: 'processing', amount_cents: '5000' } }, 5000)).toThrow('money_response_malformed');
    const transfer = { transfer: { id: UUID_B, amount_cents: '5000', concept: 'Cena', completed_at: '2026-08-02T12:00:00.000Z', to: { payme_id: 'payme_mx_zz99', full_name: 'Otra' } } };
    expect(() => transferResponse(transfer, transferRequest)).toThrow('money_response_malformed');
    expect(() => normalizeNonNegativeCents(Number.MAX_SAFE_INTEGER + 1)).toThrow('money_response_malformed');
  });
});
