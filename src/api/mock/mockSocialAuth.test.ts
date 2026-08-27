import { beforeEach, describe, expect, it, vi } from 'vitest';

const SOCIAL_CREDENTIAL_A = `credential-a-${'a'.repeat(24)}`;
const SOCIAL_CREDENTIAL_B = `credential-b-${'b'.repeat(24)}`;
const INVITATION = `signup-authority-${'i'.repeat(24)}`;

type TimerCallback = () => void;

let values: Map<string, string>;
let timers: TimerCallback[];
let lockTail: Promise<void>;

function installStorage() {
  values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  });
}

function installLocks() {
  lockTail = Promise.resolve();
  const locks = {
    async request<T>(_name: string, _options: LockOptions, action: () => Promise<T> | T): Promise<T> {
      const previous = lockTail;
      let release: (() => void) | undefined;
      lockTail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      try {
        return await action();
      } finally {
        release?.();
      }
    },
  };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks } });
}

function installControlledLatency() {
  timers = [];
  vi.stubGlobal('setTimeout', ((callback: TimerHandler) => {
    if (typeof callback !== 'function') throw new Error('test_timer_callback_invalid');
    timers.push(callback as TimerCallback);
    return timers.length;
  }) as typeof setTimeout);
}

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.stubEnv('VITE_MOCK', '1');
  installStorage();
  installLocks();
  installControlledLatency();
});

describe('social mock · origin authority y persistencia post-mutation', () => {
  it('B persiste primero; A tardía no reemplaza sesión ni muta el store de B', async () => {
    const [{ mockGoogleRegister }, { state }] = await Promise.all([
      import('./mockApi'),
      import('./store'),
    ]);
    const seededMethods = state.paymentMethods.length;
    expect(seededMethods).toBeGreaterThan(0);

    const pendingA = mockGoogleRegister({
      id_token: SOCIAL_CREDENTIAL_A,
      invitation_token: INVITATION,
      first_name: 'Primera',
      last_name: 'Tardía',
    });
    const pendingB = mockGoogleRegister({
      id_token: SOCIAL_CREDENTIAL_B,
      invitation_token: INVITATION,
      first_name: 'Segunda',
      last_name: 'Vigente',
    });
    expect(timers).toHaveLength(2);
    expect(values.has('payme_mock_state_v1')).toBe(false);

    timers[1]();
    const sessionB = await pendingB;
    await Promise.resolve();
    expect(state.user.first_name).toBe('Segunda');
    expect(state.paymentMethods).toEqual([]);
    expect(JSON.parse(values.get('payme_mock_state_v1')!)).toMatchObject({
      user: { first_name: 'Segunda', last_name: 'Vigente' },
      paymentMethods: [],
    });

    timers[0]();
    await expect(pendingA).rejects.toThrow('session_state_changed');
    expect(state.user).toMatchObject({ first_name: 'Segunda', last_name: 'Vigente' });
    expect(state.paymentMethods).toEqual([]);
    expect(JSON.parse(values.get('payme_mock_state_v1')!)).toMatchObject({
      user: { first_name: 'Segunda', last_name: 'Vigente' },
      paymentMethods: [],
    });
    expect(JSON.parse(values.get('payme_app_session__mock')!)).toMatchObject({
      family_id: sessionB.family_id,
      principal_id: sessionB.principal_id,
      user: { first_name: 'Segunda' },
    });
    expect([...values.values()].join('')).not.toContain('Primera');
  });

  it('success normal muta y persiste el store sólo después de adjudicar sesión', async () => {
    const [{ mockGoogleLogin }, { state }] = await Promise.all([
      import('./mockApi'),
      import('./store'),
    ]);
    const pending = mockGoogleLogin(SOCIAL_CREDENTIAL_A);
    expect(values.has('payme_mock_state_v1')).toBe(false);
    timers[0]();
    const session = await pending;
    await Promise.resolve();

    expect(session.user?.id).toBe(state.user.id);
    expect(JSON.parse(values.get('payme_mock_state_v1')!)).toMatchObject({
      user: { id: state.user.id, first_name: state.user.first_name },
    });
  });
});
