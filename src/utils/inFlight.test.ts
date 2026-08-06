import { describe, expect, it, vi } from 'vitest';
import { createInFlightMutex } from './inFlight';

describe('mutex de doble tap', () => {
  it('admite una sola llamada síncrona y libera en finally para reintento del mismo journal', async () => {
    const mutex = createInFlightMutex();
    const api = vi.fn(async () => ({ ok: true }));
    const call = async () => {
      if (!mutex.tryEnter()) return;
      try {
        await api();
      } finally {
        mutex.leave();
      }
    };
    await Promise.all([call(), call()]);
    expect(api).toHaveBeenCalledTimes(1);
    await call();
    expect(api).toHaveBeenCalledTimes(2);
  });
});
