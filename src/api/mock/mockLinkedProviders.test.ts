import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * AF-09 · el mock de `linked-providers` y `google/link` replica el contrato
 * v2.91.0, y NO más que eso. Los casos de abajo son las reglas del dueño que el
 * mock sí puede reproducir; la que no puede —contraseña incorrecta, porque el
 * mock no guarda contraseñas— está declarada en `mockGoogleLink` y la vista
 * previa la fuerza parcheando la fachada.
 */

const TOKEN_A = `google-credential-a-${'a'.repeat(24)}`;
const TOKEN_B = `google-credential-b-${'b'.repeat(24)}`;
const PASSWORD = 'contrasena-de-prueba';
const STORAGE_KEY = 'payme_mock_state_v1';

let values: Map<string, string>;

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
  let tail = Promise.resolve();
  const locks = {
    async request<T>(_name: string, _options: LockOptions, action: () => Promise<T> | T): Promise<T> {
      const previous = tail;
      let release: (() => void) | undefined;
      tail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      try { return await action(); } finally { release?.(); }
    },
  };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks } });
}

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.stubEnv('VITE_MOCK', '1');
  installStorage();
  installLocks();
  // La latencia del mock no aporta nada a estas reglas: se resuelve en el acto.
  vi.stubGlobal('setTimeout', ((callback: () => void) => { queueMicrotask(callback); return 0; }) as unknown as typeof setTimeout);
});

async function cargar() {
  const [mock, store] = await Promise.all([import('./mockApi'), import('./store')]);
  return { ...mock, state: store.state };
}

describe('mock · google/link idempotente SÓLO para la misma cuenta', () => {
  it('vincula la primera vez y confirma la segunda, sin duplicar', async () => {
    const { mockGoogleLink, mockGetLinkedProviders } = await cargar();
    expect(await mockGetLinkedProviders()).toEqual({ linked_providers: [] });

    expect(await mockGoogleLink({ id_token: TOKEN_A, current_password: PASSWORD }))
      .toEqual({ linked: true, provider: 'google', already_linked: false });
    expect(await mockGetLinkedProviders()).toEqual({ linked_providers: ['google'] });

    // Otro id_token de la MISMA cuenta de Google: el dueño responde 200 y no escribe.
    expect(await mockGoogleLink({ id_token: TOKEN_B, current_password: PASSWORD }))
      .toEqual({ linked: true, provider: 'google', already_linked: true });
    expect(await mockGetLinkedProviders()).toEqual({ linked_providers: ['google'] });
  });

  it('🔴 el MISMO id_token no sirve dos veces: el dueño lo consume también en el camino idempotente', async () => {
    const { mockGoogleLink, MockApiError } = await cargar();
    await mockGoogleLink({ id_token: TOKEN_A, current_password: PASSWORD });
    const reintento = mockGoogleLink({ id_token: TOKEN_A, current_password: PASSWORD });
    await expect(reintento).rejects.toBeInstanceOf(MockApiError);
    await expect(mockGoogleLink({ id_token: TOKEN_A, current_password: PASSWORD }))
      .rejects.toMatchObject({ status: 401, message: 'social_auth_failed' });
  });

  it('🔴 valida el DTO con los límites del dueño (id_token 20–8192, contraseña 8–128, strict)', async () => {
    const { mockGoogleLink } = await cargar();
    const invalidos = [
      { id_token: TOKEN_A, current_password: '1234567' },               // 7
      { id_token: TOKEN_A, current_password: 'x'.repeat(129) },         // 129
      { id_token: 'corto', current_password: PASSWORD },
      { id_token: TOKEN_A, current_password: PASSWORD, email: 'x@y.z' }, // clave de más
    ];
    for (const dto of invalidos) {
      await expect(mockGoogleLink(dto as never), JSON.stringify(dto))
        .rejects.toMatchObject({ status: 400, message: 'validation_error' });
    }
    // Y ninguno de los rechazados vinculó nada.
    const { mockGetLinkedProviders } = await cargar();
    expect(await mockGetLinkedProviders()).toEqual({ linked_providers: [] });
  });

  it('los límites son inclusivos: 8 y 128 caracteres pasan', async () => {
    const { mockGoogleLink } = await cargar();
    await expect(mockGoogleLink({ id_token: TOKEN_A, current_password: '12345678' }))
      .resolves.toMatchObject({ linked: true });
    await expect(mockGoogleLink({ id_token: TOKEN_B, current_password: 'x'.repeat(128) }))
      .resolves.toMatchObject({ linked: true });
  });
});

describe('mock · el estado es DE CADA cuenta', () => {
  it('🔴 vincular la cuenta de una persona no la muestra vinculada en la de otra', async () => {
    const { mockGoogleLink, mockGetLinkedProviders, state } = await cargar();
    const original = state.user;
    await mockGoogleLink({ id_token: TOKEN_A, current_password: PASSWORD });
    expect(await mockGetLinkedProviders()).toEqual({ linked_providers: ['google'] });

    // El mock cambia `state.user` en cada login: se simula la otra cuenta.
    state.user = { ...original, id: 'otra-cuenta-00000000', email: 'otra@payme.mx' };
    expect(await mockGetLinkedProviders()).toEqual({ linked_providers: [] });

    state.user = original;
    expect(await mockGetLinkedProviders()).toEqual({ linked_providers: ['google'] });
  });

  it('entrar con Google en el mock deja a Google vinculado, como en el dueño', async () => {
    // En el dueño `google/login` resuelve SÓLO por binding activo: quien entra con
    // Google lo tiene vinculado. El mock no puede mostrar lo contrario.
    const { mockGoogleLogin, mockGetLinkedProviders } = await cargar();
    await mockGoogleLogin(TOKEN_A);
    expect(await mockGetLinkedProviders()).toEqual({ linked_providers: ['google'] });
  });
});

describe('mock · migración de demos guardadas antes de AF-09', () => {
  async function guardadoSin(transformar: (estado: Record<string, unknown>) => void) {
    const { state } = await import('./store');
    const guardado = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
    transformar(guardado);
    values.set(STORAGE_KEY, JSON.stringify(guardado));
    vi.resetModules();
    return (await import('./store')).state;
  }

  it('un estado sin el campo se hidrata con NINGUNA cuenta vinculada', async () => {
    const estado = await guardadoSin((g) => { delete g.linkedProvidersByUser; });
    expect(estado.linkedProvidersByUser).toEqual({});
  });

  it('🔴 un valor podrido no descarta la demo entera: se repone vacío y el resto sobrevive', async () => {
    const estado = await guardadoSin((g) => {
      g.linkedProvidersByUser = ['google'];
      g.balance_cents = 12345;
    });
    expect(estado.linkedProvidersByUser).toEqual({});
    // Control positivo: el estado guardado SÍ se usó, no se re-sembró desde cero.
    expect(estado.balance_cents).toBe(12345);
  });
});
