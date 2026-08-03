import { describe, expect, it } from 'vitest';
import type { UnconfirmedAttempt } from '../api/idempotency';
import type { MesaDetail } from '../api/types';
import {
  canReplayFrozen,
  frozenView,
  needsExtraPartConfirmation,
  payGate,
  paymentLanded,
  requiresReconciliation,
} from './freezeMachine';

const handle = { key: 'k-1', generation: 1, lease: 'fam-1' };
const base: UnconfirmedAttempt = { actor: 'auth:p1', scope: 'auth:p1::pay:PA-1', handle };

function mesa(p: Partial<MesaDetail>): Pick<MesaDetail, 'division_mode' | 'division_slots' | 'items'> {
  return { division_mode: 'igual', division_slots: [], items: [], ...p } as never;
}

describe('máquina de congelar/descongelar · vista del intento', () => {
  it('sin intento no hay congelamiento', () => {
    expect(frozenView(null)).toBe('none');
    expect(frozenView(undefined)).toBe('none');
    expect(canReplayFrozen(null)).toBe(false);
    expect(requiresReconciliation(null)).toBe(false);
  });

  it('con cuerpo exacto, el intento se puede reenviar (replay, no cobro nuevo)', () => {
    const f = { ...base, payload: { idempotency_key: 'k-1' } };
    expect(frozenView(f)).toBe('replayable');
    expect(canReplayFrozen(f)).toBe(true);
  });

  /** El caso del reload / back del navegador: se pierde `memoryPending`. */
  it('sin cuerpo exige reconciliación: reconstruirlo sería reenviar a ciegas', () => {
    expect(frozenView(base)).toBe('needs_reconciliation');
    expect(requiresReconciliation(base)).toBe(true);
  });

  it('otra familia exige reconciliación aunque haya cuerpo', () => {
    const f = { ...base, payload: { idempotency_key: 'k-1' }, reconciliationRequired: true };
    expect(frozenView(f)).toBe('needs_reconciliation');
    expect(canReplayFrozen(f)).toBe(false);
  });

  it('un cuerpo `null` cuenta como cuerpo: null no es "sin payload"', () => {
    expect(frozenView({ ...base, payload: null })).toBe('replayable');
  });
});

describe('evidencia autoritativa de que el pago llegó', () => {
  it('división igual: sólo un casillero MÍO cuenta', () => {
    expect(paymentLanded(mesa({ division_slots: [] }))).toBe(false);
    expect(paymentLanded(mesa({
      division_slots: [{ slot_index: 0, amount_cents: 100, amount_display: '$1', status: 'paid' }],
    }))).toBe(false);
    expect(paymentLanded(mesa({
      division_slots: [{ slot_index: 0, amount_cents: 100, amount_display: '$1', status: 'paid', claimed_by_me: true }],
    }))).toBe(true);
  });

  it('consumo: hace falta fracción propia Y el ítem pagado', () => {
    const item = (p: Record<string, unknown>) => ({
      id: 'i1', name: 'x', category: 'other', price_cents: 100, quantity: 1,
      status: 'available', remaining_bps: 10000, my_bps: 0, locked_by_me: false,
      lock_expires_at: null, ...p,
    });
    expect(paymentLanded(mesa({ division_mode: 'consumo', items: [item({})] as never }))).toBe(false);
    // Reservado pero no pagado: el lock sube my_bps ANTES de pagar, así que
    // por sí solo no prueba nada.
    expect(paymentLanded(mesa({ division_mode: 'consumo', items: [item({ my_bps: 5000, status: 'locked' })] as never }))).toBe(false);
    expect(paymentLanded(mesa({ division_mode: 'consumo', items: [item({ my_bps: 5000, status: 'paid' })] as never }))).toBe(true);
    // Un ítem pagado por OTRO no es evidencia mía.
    expect(paymentLanded(mesa({ division_mode: 'consumo', items: [item({ my_bps: 0, status: 'paid' })] as never }))).toBe(false);
  });

  it('sin mesa no se infiere nada', () => {
    expect(paymentLanded(null)).toBe(false);
    expect(paymentLanded(undefined)).toBe(false);
  });
});

describe('N-08 · confirmación de parte adicional', () => {
  const input = (p: Partial<Parameters<typeof needsExtraPartConfirmation>[0]>) => ({
    acknowledged: false, crossActorIntent: false, mySlotsTaken: 0, ...p,
  });

  it('mesa limpia: no molesta', () => {
    expect(needsExtraPartConfirmation(input({}))).toBe(false);
  });

  it('pide confirmación si el backend dice que ya tomé un casillero', () => {
    expect(needsExtraPartConfirmation(input({ mySlotsTaken: 1 }))).toBe(true);
  });

  it('pide confirmación por el cruce invitado↔autenticado del dispositivo', () => {
    expect(needsExtraPartConfirmation(input({ crossActorIntent: true }))).toBe(true);
  });

  it('una vez confirmado NO vuelve a preguntar: pagar varias partes es legítimo', () => {
    expect(needsExtraPartConfirmation(input({ mySlotsTaken: 2, crossActorIntent: true, acknowledged: true }))).toBe(false);
  });
});

describe('puerta del pago · prioridades', () => {
  const input = (p: Partial<Parameters<typeof payGate>[0]>) => ({
    hasActor: true, frozen: null as UnconfirmedAttempt | null, acknowledged: false,
    crossActorIntent: false, mySlotsTaken: 0, ...p,
  });

  it('sin identidad segura no se paga', () => {
    expect(payGate(input({ hasActor: false }))).toEqual({ allowed: false, reason: 'no_actor' });
  });

  it('camino limpio: se paga', () => {
    expect(payGate(input({}))).toEqual({ allowed: true });
  });

  it('la reconciliación gana sobre la confirmación de parte adicional', () => {
    expect(payGate(input({ frozen: base, mySlotsTaken: 3, crossActorIntent: true }))).toEqual({
      allowed: false, reason: 'frozen_reconcile',
    });
  });

  /**
   * Clave: un intento REPLAYABLE no pide confirmación de parte adicional.
   * Reenvía el mismo cuerpo — no abre una parte nueva. Si preguntáramos acá,
   * empujaríamos al usuario a creer que va a pagar de más cuando no es así.
   */
  it('un intento replayable pasa sin pedir confirmación de parte adicional', () => {
    const f = { ...base, payload: { idempotency_key: 'k-1' } };
    expect(payGate(input({ frozen: f, mySlotsTaken: 1, crossActorIntent: true }))).toEqual({ allowed: true });
  });

  it('sin intento congelado pero con evidencia previa, confirma', () => {
    expect(payGate(input({ mySlotsTaken: 1 }))).toEqual({ allowed: false, reason: 'confirm_extra_part' });
    expect(payGate(input({ crossActorIntent: true }))).toEqual({ allowed: false, reason: 'confirm_extra_part' });
  });

  it('tras confirmar, deja pagar la parte adicional', () => {
    expect(payGate(input({ mySlotsTaken: 1, crossActorIntent: true, acknowledged: true }))).toEqual({ allowed: true });
  });
});
