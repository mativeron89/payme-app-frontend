import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { recoveryScreenState, validateRecoveryPassword } from './RecoveryScreen';

describe('RecoveryScreen · estado saneado', () => {
  it('sólo ready muestra formulario y consumed sobrevive al remount como éxito', () => {
    expect(recoveryScreenState({ status: 'ready' })).toBe('form');
    expect(recoveryScreenState({ status: 'retryable' })).toBe('form');
    expect(recoveryScreenState({ status: 'processing' })).toBe('processing');
    expect(recoveryScreenState({ status: 'consumed' })).toBe('completed');
    for (const status of ['absent', 'invalid', 'blocked'] as const) {
      expect(recoveryScreenState({ status })).toBe('invalid');
    }
  });

  it('reproduce largo, bytes UTF-8 y confirmación antes del owner', () => {
    expect(validateRecoveryPassword('12345678', '12345678')).toBe('valid');
    expect(validateRecoveryPassword('1234567', '1234567')).toBe('length');
    expect(validateRecoveryPassword('a'.repeat(129), 'a'.repeat(129))).toBe('length');
    expect(validateRecoveryPassword('é'.repeat(37), 'é'.repeat(37))).toBe('bytes');
    expect(validateRecoveryPassword('12345678', '87654321')).toBe('mismatch');
  });

  it('el componente no recibe token y completa por la frontera memory-only', () => {
    const source = readFileSync(new URL('./RecoveryScreen.tsx', import.meta.url), 'utf8');
    expect(source).toContain('completeRecoveryOnce(password, api.completeRecovery)');
    expect(source).not.toMatch(/function RecoveryScreen\([^)]*token/);
    expect(source).not.toContain('localStorage');
    expect(source).not.toContain('sessionStorage');
    expect(source).not.toContain('indexedDB');
  });
});
