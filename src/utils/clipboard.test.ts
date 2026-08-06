import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeClipboardText } from './clipboard';

afterEach(() => vi.unstubAllGlobals());

describe('clipboard opcional', () => {
  it('devuelve false si la API no existe o rechaza', async () => {
    vi.stubGlobal('navigator', {});
    await expect(writeClipboardText('link')).resolves.toBe(false);
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(async () => { throw new Error('denied'); }) } });
    await expect(writeClipboardText('link')).resolves.toBe(false);
  });

  it('confirma solo después de escribir', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    await expect(writeClipboardText('link')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('link');
  });
});
