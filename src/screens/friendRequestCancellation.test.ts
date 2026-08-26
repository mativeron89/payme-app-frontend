import { describe, expect, it, vi } from 'vitest';
import { cancelOutgoingReceipt } from './friendRequestsView';

const RECEIPT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_RECEIPT_ID = '22222222-2222-4222-8222-222222222222';
const ROWS = [
  { requestId: RECEIPT_ID, requestedAt: '2026-08-26T12:00:00.000Z' },
  { requestId: OTHER_RECEIPT_ID, requestedAt: '2026-08-26T12:01:00.000Z' },
];

describe('G-25 · cancelar por receipt id sólo después del 200', () => {
  it('no produce una lista retirada mientras DELETE sigue pendiente', async () => {
    let resolve!: () => void;
    const cancel = vi.fn(() => new Promise<void>((done) => { resolve = done; }));
    const pending = cancelOutgoingReceipt(ROWS, RECEIPT_ID, cancel);
    let settled = false;
    void pending.finally(() => { settled = true; });

    await Promise.resolve();
    expect(settled).toBe(false);
    expect(ROWS).toHaveLength(2);
    expect(cancel).toHaveBeenCalledWith(RECEIPT_ID);

    resolve();
    await expect(pending).resolves.toEqual([ROWS[1]]);
  });

  it('ante error conserva la lista y no confunde receipt id con otro id', async () => {
    const cancel = vi.fn().mockRejectedValue(new Error('network'));

    await expect(cancelOutgoingReceipt(ROWS, RECEIPT_ID, cancel)).rejects.toThrow('network');
    expect(ROWS.map((row) => row.requestId)).toEqual([RECEIPT_ID, OTHER_RECEIPT_ID]);
    expect(cancel).toHaveBeenCalledWith(RECEIPT_ID);
  });
});
