import { afterEach, describe, expect, it } from 'vitest';

class MemoryStorage {
  values = new Map<string, string>();
  failSet = false;
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) {
    if (this.failSet) throw new Error('blocked');
    this.values.set(key, value);
  }
  removeItem(key: string) { this.values.delete(key); }
}

const local = new MemoryStorage();
const session = new MemoryStorage();
Object.assign(globalThis, { localStorage: local, sessionStorage: session });

const auth = await import('./storage');
const attempts = await import('./cardSetupAttempt');

function signIn(principal: string, family = `${principal}-family`) {
  auth.saveSession({
    access_token: `${principal}-access`,
    refresh_token: `${principal}-refresh`,
    family_id: family,
    principal_id: principal,
    user: {
      id: principal,
      payme_id: principal,
      email: `${principal}@test.local`,
      first_name: principal,
      last_name: 'Test',
    },
  });
}

afterEach(() => {
  local.values.clear();
  session.values.clear();
  session.failSet = false;
});

describe('reanudación de alta de tarjeta', () => {
  it('sobrevive reload/navegación con key y pm, sin persistir client_secret', () => {
    signIn('user-a');
    const actor = { principal_id: 'user-a', family_id: 'user-a-family' };
    attempts.writeCardSetupAttempt({
      setupKey: 'setup-key-stable-1',
      setAsDefault: true,
      stage: 'setup',
    }, actor);
    expect(attempts.readCardSetupAttempt()).toEqual({
      setupKey: 'setup-key-stable-1',
      setAsDefault: true,
      stage: 'setup',
    });

    attempts.writeCardSetupAttempt({
      setupKey: 'setup-key-stable-1',
      setAsDefault: true,
      stage: 'attach',
      paymentMethodId: 'pm_stable_1',
    }, actor);
    expect([...session.values.values()].join('')).not.toContain('client_secret');
    expect(attempts.readCardSetupAttempt()).toMatchObject({
      stage: 'attach',
      paymentMethodId: 'pm_stable_1',
    });
  });

  it('no atribuye la referencia de una cuenta a otra y permite misma cuenta con otra familia', () => {
    signIn('user-a', 'family-a');
    const actor = { principal_id: 'user-a', family_id: 'family-a' };
    attempts.writeCardSetupAttempt({
      setupKey: 'setup-key-stable-2',
      setAsDefault: false,
      stage: 'setup',
    }, actor);
    attempts.writeCardSetupAttempt({
      setupKey: 'setup-key-stable-2',
      setAsDefault: false,
      stage: 'attach',
      paymentMethodId: 'pm_stable_2',
    }, actor);
    signIn('user-a', 'family-a-new');
    expect(attempts.readCardSetupAttempt()?.paymentMethodId).toBe('pm_stable_2');
    signIn('user-b');
    expect(attempts.readCardSetupAttempt()).toBeNull();
  });

  it('falla cerrado ante registro corrupto, secreto inesperado o storage no durable', () => {
    signIn('user-a');
    const actor = { principal_id: 'user-a', family_id: 'user-a-family' };
    session.values.set('payme_card_setup_attempt_v1', '{corrupt');
    expect(() => attempts.readCardSetupAttempt()).toThrow('card_setup_attempt_ambiguous');
    session.values.set('payme_card_setup_attempt_v1', JSON.stringify({
      v: 1,
      principal_id: 'user-a',
      setup_key: 'setup-key-stable-3',
      set_as_default: false,
      stage: 'setup',
      at: Date.now(),
      client_secret: 'must-not-be-here',
    }));
    expect(() => attempts.readCardSetupAttempt()).toThrow('card_setup_attempt_ambiguous');
    session.values.clear();
    session.failSet = true;
    expect(() => attempts.writeCardSetupAttempt({
      setupKey: 'setup-key-stable-3',
      setAsDefault: false,
      stage: 'setup',
    }, actor)).toThrow('card_setup_storage_unavailable');
  });

  it('limpia por CAS y no borra una key distinta', () => {
    signIn('user-a');
    const actor = { principal_id: 'user-a', family_id: 'user-a-family' };
    attempts.writeCardSetupAttempt({
      setupKey: 'setup-key-stable-4',
      setAsDefault: false,
      stage: 'setup',
    }, actor);
    attempts.clearCardSetupAttempt('otra-key', actor);
    expect(attempts.readCardSetupAttempt()).not.toBeNull();
    attempts.clearCardSetupAttempt('setup-key-stable-4', actor);
    expect(attempts.readCardSetupAttempt()).toBeNull();
  });

  it('una promesa de A no puede escribir ni limpiar después de cambiar de sesión', () => {
    signIn('user-a', 'family-a');
    const origin = { principal_id: 'user-a', family_id: 'family-a' };
    signIn('user-b', 'family-b');
    expect(() => attempts.writeCardSetupAttempt({
      setupKey: 'setup-key-stale-a',
      setAsDefault: false,
      stage: 'attach',
      paymentMethodId: 'pm_owned_by_a',
    }, origin)).toThrow('card_setup_actor_changed');
    expect(attempts.readCardSetupAttempt()).toBeNull();

    signIn('user-a', 'family-a-new');
    expect(() => attempts.clearCardSetupAttempt('setup-key-stale-a', origin))
      .toThrow('card_setup_actor_changed');
  });

  it('una transición K1 tardía no resucita sobre K2 ni después de clear', () => {
    signIn('user-a', 'family-a');
    const actor = { principal_id: 'user-a', family_id: 'family-a' };
    attempts.writeCardSetupAttempt({
      setupKey: 'setup-key-generation-k1',
      setAsDefault: false,
      stage: 'setup',
    }, actor);
    attempts.clearCardSetupAttempt('setup-key-generation-k1', actor);
    attempts.writeCardSetupAttempt({
      setupKey: 'setup-key-generation-k2',
      setAsDefault: false,
      stage: 'setup',
    }, actor);

    expect(() => attempts.writeCardSetupAttempt({
      setupKey: 'setup-key-generation-k1',
      setAsDefault: false,
      stage: 'attach',
      paymentMethodId: 'pm_generation_k1',
    }, actor)).toThrow('card_setup_generation_stale');
    expect(attempts.readCardSetupAttempt()?.setupKey).toBe('setup-key-generation-k2');

    attempts.clearCardSetupAttempt('setup-key-generation-k2', actor);
    expect(() => attempts.writeCardSetupAttempt({
      setupKey: 'setup-key-generation-k1',
      setAsDefault: false,
      stage: 'attach',
      paymentMethodId: 'pm_generation_k1',
    }, actor)).toThrow('card_setup_generation_stale');
    expect(attempts.readCardSetupAttempt()).toBeNull();
  });
});
