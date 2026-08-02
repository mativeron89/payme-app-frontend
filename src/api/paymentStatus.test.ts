import { describe, expect, it } from 'vitest';
import { guaranteeOutcome, mesaClosureView, mesaPaymentOutcome, pollTopup, topupOutcome } from './paymentStatus';

describe('estados monetarios acreditables', () => {
  it('solo succeeded/processed cierran el pago de mesa', () => {
    expect(mesaPaymentOutcome('succeeded')).toBe('success');
    expect(mesaPaymentOutcome('processed')).toBe('success');
    for (const status of ['pending', 'requires_action', 'processing', undefined, 'unknown']) {
      expect(mesaPaymentOutcome(status)).toBe('ambiguous');
    }
    expect(mesaPaymentOutcome('failed')).toBe('definitive');
  });

  it('topup processing o replay requires_action sin secreto no habilita otra carga', () => {
    expect(topupOutcome('processing', false)).toBe('ambiguous');
    expect(topupOutcome('pending', false)).toBe('ambiguous');
    expect(topupOutcome('processing', true)).toBe('ambiguous');
    expect(topupOutcome('processing', true, 'secret')).toBe('ambiguous');
    expect(topupOutcome('succeeded', false)).toBe('success');
  });

  it('garantía autorizada con polling 401/timeout/pending sigue ambigua y no abre otro hold', () => {
    expect(guaranteeOutcome('open')).toBe('success');
    for (const status of ['pending_auth', undefined, 'timeout', 'http_401']) {
      expect(guaranteeOutcome(status)).toBe('ambiguous');
    }
    expect(guaranteeOutcome('auth_failed')).toBe('definitive');
  });

  it('poll de topup conserva processing y corta al cambiar el actor origin', async () => {
    let calls = 0;
    const resolved = await pollTopup(async () => ({ topup: { status: ++calls === 2 ? 'succeeded' : 'processing' } }), () => true, async () => undefined);
    expect(resolved.outcome).toBe('success');
    expect(calls).toBe(2);
    await expect(pollTopup(async () => ({ topup: { status: 'succeeded' } }), () => false, async () => undefined)).resolves.toEqual({ outcome: 'ambiguous', response: null });
  });

  it.each([
    'pending_auth', 'auth_failed', 'cancelled', 'expired', 'settling', 'fully_paid', 'settled', 'dispersing',
  ])('ningún estado prematuro afirma entrega o garantía cobrada: %s', (status) => {
    const view = mesaClosureView(status);
    expect(view.completed).toBe(false);
    expect(`${view.title} ${view.detail}`.toLowerCase()).not.toContain('recibió');
    expect(`${view.title} ${view.detail}`.toLowerCase()).not.toContain('garantía cobrada');
  });

  it('solo completed habilita el cierre concluyente', () => {
    expect(mesaClosureView('completed')).toMatchObject({ title: 'Cierre completado', completed: true });
  });
});
