import { describe, expect, it } from 'vitest';
import { CLOSURE_CHANGED, CLOSURE_REQUIRED, closureDeadlineValid, decodeSelectionClosureRejection, freezeSelectionRequest, selectionClosureConfirmation } from './selectionClosure';
import { SELECTION_CLOSURE_CONTRACT } from './types';

const now = Date.parse('2026-10-22T12:00:00Z');
const context = { mesaCode: 'PA-450', mode: 'consumo' as const };
const challenge = { contract: SELECTION_CLOSURE_CONTRACT, revision: 'a'.repeat(64),
  mesa_code: context.mesaCode, division_mode: context.mode, would_close: true as const,
  valid_until: '2026-10-22T12:01:00.123456Z' };
const decode = (c: unknown, extra: Record<string, unknown> = {}) => decodeSelectionClosureRejection(
  CLOSURE_REQUIRED, 409, { closure_confirmation: c, ...extra }, context, now);

describe('n422 · protocolo de confirmación de selección', () => {
  it.each(['consumo', 'igual'] as const)('sólo %s/mesa exactos y request explícito de tres claves', (mode) => {
    const c = { ...challenge, division_mode: mode };
    const r = decodeSelectionClosureRejection(CLOSURE_REQUIRED, 409, { error: CLOSURE_REQUIRED, closure_confirmation: c }, { ...context, mode }, now);
    expect(r?.challenge).toEqual(c);
    expect(selectionClosureConfirmation(r!.challenge!)).toEqual({ contract: SELECTION_CLOSURE_CONTRACT, revision: c.revision, confirmed: true });
  });
  it.each([null, [], {}, 'no', { ...challenge, extra: true }, { ...challenge, contract: 'v2' },
    { ...challenge, revision: 'A'.repeat(64) }, { ...challenge, revision: 'a'.repeat(63) },
    { ...challenge, revision: 42 }, { ...challenge, mesa_code: 'PA-otra' },
    { ...challenge, division_mode: 'igual' }, { ...challenge, would_close: false },
    { ...challenge, would_close: 'true' }, { ...challenge, valid_until: '2026-10-22T12:00:00Z' },
    { ...challenge, valid_until: '2026-02-30T12:00:00Z' }, { ...challenge, valid_until: '2099-01-01' },
  ])('rechaza challenge malformado o ajeno %#', (value) => { expect(decode(value)).toBeNull(); });
  it('rechaza clave ausente, envelope abierto y estados HTTP no definitivos', () => {
    for (const key of Object.keys(challenge)) {
      const c: Record<string, unknown> = { ...challenge }; delete c[key]; expect(decode(c)).toBeNull();
    }
    expect(decode(challenge, { unknown: true })).toBeNull();
    expect(decode(challenge, { error: CLOSURE_CHANGED })).toBeNull();
    for (const status of [200, 400, 500, 503, null]) expect(decodeSelectionClosureRejection(
      CLOSURE_REQUIRED, status, { closure_confirmation: challenge }, context, now)).toBeNull();
  });
  it('changed sin desafío es válido; required vacío nunca habilita confirmar', () => {
    expect(decodeSelectionClosureRejection(CLOSURE_CHANGED, 409, {}, context, now)).toEqual({ code: CLOSURE_CHANGED, challenge: null });
    expect(decodeSelectionClosureRejection(CLOSURE_REQUIRED, 409, {}, context, now)).toBeNull();
    expect(decodeSelectionClosureRejection(CLOSURE_CHANGED, 409, { closure_confirmation: null }, context, now)).toBeNull();
  });
  it('plazo preciso falla cerrado al vencimiento; formato calendario y offset válidos', () => {
    expect(closureDeadlineValid(challenge.valid_until, now)).toBe(true);
    expect(closureDeadlineValid(challenge.valid_until, Date.parse(challenge.valid_until))).toBe(false);
    expect(closureDeadlineValid('2026-10-22T06:01:00-06:00', now)).toBe(true);
    expect(closureDeadlineValid('2026-10-22T24:01:00Z', now)).toBe(false);
  });
  it('el pedido congelado no adopta ediciones posteriores ni admite mutación anidada', () => {
    const original = { items: [{ item_id: 'a', fraction_denominator: 3 }] };
    const frozen = freezeSelectionRequest(original);
    original.items[0]!.fraction_denominator = 2; original.items.push({ item_id: 'b', fraction_denominator: 1 });
    expect(frozen).toEqual({ items: [{ item_id: 'a', fraction_denominator: 3 }] });
    expect(Object.isFrozen(frozen)).toBe(true); expect(Object.isFrozen(frozen.items)).toBe(true);
    expect(Object.isFrozen(frozen.items[0])).toBe(true);
    expect(() => { frozen.items[0]!.fraction_denominator = 1; }).toThrow();
  });
});
