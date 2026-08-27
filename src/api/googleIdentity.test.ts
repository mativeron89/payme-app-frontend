import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GOOGLE_IDENTITY_SCRIPT_URL,
  renderGoogleIdentityButton,
  resetGoogleIdentityForTests,
} from './googleIdentity';

type Listener = { callback: (event: unknown) => void; once: boolean };

class FakeElement {
  id = '';
  className = '';
  textContent = '';
  type = '';
  private listeners = new Map<string, Listener[]>();
  onRemove: (() => void) | null = null;

  addEventListener(event: string, callback: (event: unknown) => void, options?: { once?: boolean }) {
    const entries = this.listeners.get(event) ?? [];
    entries.push({ callback, once: options?.once === true });
    this.listeners.set(event, entries);
  }

  dispatch(event: string) {
    const entries = [...(this.listeners.get(event) ?? [])];
    for (const entry of entries) {
      entry.callback({ type: event });
      if (entry.once) {
        const remaining = (this.listeners.get(event) ?? []).filter((value) => value !== entry);
        this.listeners.set(event, remaining);
      }
    }
  }

  remove() {
    this.onRemove?.();
    this.onRemove = null;
  }
}

class FakeScriptElement extends FakeElement {
  src = '';
  async = false;
  defer = false;
  referrerPolicy = '';
}

class FakeButtonElement extends FakeElement {}

class FakeContainer {
  readonly clientWidth: number;
  children: unknown[] = [];
  replaceChildren = vi.fn((...children: unknown[]) => { this.children = children; });
  append = vi.fn((child: unknown) => { this.children.push(child); });

  constructor(width = 320) {
    this.clientWidth = width;
  }
}

class FakeDocument {
  readonly children: FakeElement[] = [];
  readonly head = {
    append: (element: FakeElement) => {
      this.children.push(element);
      element.onRemove = () => {
        const index = this.children.indexOf(element);
        if (index >= 0) this.children.splice(index, 1);
      };
    },
  };

  createElement(tag: string) {
    if (tag === 'script') return new FakeScriptElement();
    if (tag === 'button') return new FakeButtonElement();
    return new FakeElement();
  }

  getElementById(id: string) {
    return this.children.find((element) => element.id === id) ?? null;
  }

  scripts() {
    return this.children.filter((element): element is FakeScriptElement => (
      element instanceof FakeScriptElement
    ));
  }
}

type InstalledApi = {
  initialize: ReturnType<typeof vi.fn>;
  renderButton: ReturnType<typeof vi.fn>;
  prompt: ReturnType<typeof vi.fn>;
};

let browser: FakeDocument;

function installGoogleApi(initialize = vi.fn()): InstalledApi {
  const api = {
    initialize,
    renderButton: vi.fn((container: FakeContainer) => container.append({ gis: true })),
    prompt: vi.fn(),
  };
  vi.stubGlobal('google', { accounts: { id: api } });
  return api;
}

function options(
  container = new FakeContainer(),
  onCredential = vi.fn(),
  overrides: { clientId?: string; locale?: 'es' | 'en' } = {},
) {
  return {
    container: container as unknown as HTMLElement,
    clientId: overrides.clientId ?? 'payme-google-web-client-id',
    locale: overrides.locale ?? 'es' as const,
    mockLabel: 'Continuar con Google',
    onCredential,
  };
}

function onlyScript(): FakeScriptElement {
  expect(browser.scripts()).toHaveLength(1);
  return browser.scripts()[0];
}

function callbackOf(api: InstalledApi) {
  return api.initialize.mock.calls[0][0].callback as (
    value: { credential?: unknown; state?: unknown },
  ) => void;
}

function stateOf(api: InstalledApi, index = 0): string {
  return api.renderButton.mock.calls[index][1].state as string;
}

beforeEach(() => {
  browser = new FakeDocument();
  vi.stubGlobal('document', browser as unknown as Document);
  vi.stubGlobal('HTMLScriptElement', FakeScriptElement);
  vi.stubGlobal('google', undefined);
  vi.stubEnv('VITE_MOCK', '0');
  resetGoogleIdentityForTests();
});

afterEach(() => {
  resetGoogleIdentityForTests();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Google GIS · ownership, reserva e inicialización global', () => {
  it('dispose pre-load libera la reserva y permite otro client id', async () => {
    const first = renderGoogleIdentityButton(options(
      new FakeContainer(),
      vi.fn(),
      { clientId: 'google-client-a' },
    ));
    const script = onlyScript();
    first.dispose();
    await expect(first.ready).resolves.toBeUndefined();

    const second = renderGoogleIdentityButton(options(
      new FakeContainer(),
      vi.fn(),
      { clientId: 'google-client-b' },
    ));
    const api = installGoogleApi();
    script.dispatch('load');
    await second.ready;
    expect(api.initialize).toHaveBeenCalledTimes(1);
    expect(api.initialize.mock.calls[0][0].client_id).toBe('google-client-b');
  });

  it('dos montajes del mismo client comparten script e initialize y rutean por state', async () => {
    const firstCredential = vi.fn();
    const secondCredential = vi.fn();
    const first = renderGoogleIdentityButton(options(new FakeContainer(), firstCredential));
    const second = renderGoogleIdentityButton(options(new FakeContainer(), secondCredential));
    expect(browser.scripts()).toHaveLength(1);

    const api = installGoogleApi();
    onlyScript().dispatch('load');
    await Promise.all([first.ready, second.ready]);
    expect(api.initialize).toHaveBeenCalledTimes(1);
    expect(api.renderButton).toHaveBeenCalledTimes(2);
    expect(stateOf(api, 0)).not.toBe(stateOf(api, 1));

    const callback = callbackOf(api);
    callback({ state: stateOf(api, 1), credential: 'credential-second-owner-12345' });
    callback({ state: stateOf(api, 0), credential: 'credential-first-owner-123456' });
    expect(firstCredential).toHaveBeenCalledWith('credential-first-owner-123456');
    expect(secondCredential).toHaveBeenCalledWith('credential-second-owner-12345');
  });

  it('client ids distintos fallan cerrado antes y después de inicializar', async () => {
    const first = renderGoogleIdentityButton(options(
      new FakeContainer(),
      vi.fn(),
      { clientId: 'google-client-first' },
    ));
    expect(() => renderGoogleIdentityButton(options(
      new FakeContainer(),
      vi.fn(),
      { clientId: 'google-client-second' },
    ))).toThrow('google_client_id_conflict');

    installGoogleApi();
    onlyScript().dispatch('load');
    await first.ready;
    expect(() => renderGoogleIdentityButton(options(
      new FakeContainer(),
      vi.fn(),
      { clientId: 'google-client-second' },
    ))).toThrow('google_client_id_conflict');
  });

  it('si initialize arroja, libera la reserva y un montaje sano reintenta', async () => {
    const initialize = vi.fn()
      .mockImplementationOnce(() => { throw new Error('gis_init_failed'); })
      .mockImplementationOnce(() => undefined);
    const first = renderGoogleIdentityButton(options());
    const api = installGoogleApi(initialize);
    onlyScript().dispatch('load');
    await expect(first.ready).rejects.toThrow('gis_init_failed');

    const second = renderGoogleIdentityButton(options());
    await expect(second.ready).resolves.toBeUndefined();
    expect(api.initialize).toHaveBeenCalledTimes(2);
    expect(api.renderButton).toHaveBeenCalledTimes(1);
  });

  it('reemplazar el mismo container invalida ya la ruta vieja y dispose viejo no borra el nuevo', async () => {
    const container = new FakeContainer(280);
    const oldCredential = vi.fn();
    const oldHandle = renderGoogleIdentityButton(options(container, oldCredential));
    const newCredential = vi.fn();
    const currentHandle = renderGoogleIdentityButton(options(container, newCredential));
    const api = installGoogleApi();
    onlyScript().dispatch('load');
    await Promise.all([oldHandle.ready, currentHandle.ready]);

    expect(api.renderButton).toHaveBeenCalledTimes(1);
    const currentState = stateOf(api);
    oldHandle.dispose();
    expect(container.children).toEqual([{ gis: true }]);
    callbackOf(api)({ state: currentState, credential: 'credential-current-generation-123' });
    expect(oldCredential).not.toHaveBeenCalled();
    expect(newCredential).toHaveBeenCalledWith('credential-current-generation-123');
  });

  it('dispose libera el state inmediatamente para que una UUID futura pueda reutilizarlo', () => {
    const state = '22222222-2222-4222-8222-222222222222';
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(state);
    const first = renderGoogleIdentityButton(options());
    first.dispose();
    const second = renderGoogleIdentityButton(options());
    second.dispose();
  });
});

describe('Google GIS · loader y retry fail-closed', () => {
  it.each(['error', 'load'] as const)('%s sin API retira nodo propio y retry crea uno nuevo', async (event) => {
    const first = renderGoogleIdentityButton(options());
    const failedScript = onlyScript();
    failedScript.dispatch(event);
    await expect(first.ready).rejects.toThrow('google_identity_unavailable');
    expect(browser.scripts()).toHaveLength(0);

    const retry = renderGoogleIdentityButton(options());
    const retryScript = onlyScript();
    expect(retryScript).not.toBe(failedScript);
    const api = installGoogleApi();
    retryScript.dispatch('load');
    await expect(retry.ready).resolves.toBeUndefined();
    expect(api.renderButton).toHaveBeenCalledTimes(1);
  });

  it('un nodo ajeno con el id reservado falla cerrado y no se elimina', async () => {
    const external = new FakeScriptElement();
    external.id = 'payme-google-identity-services';
    external.src = GOOGLE_IDENTITY_SCRIPT_URL;
    browser.head.append(external);

    const handle = renderGoogleIdentityButton(options());
    await expect(handle.ready).rejects.toThrow('google_identity_script_conflict');
    expect(browser.scripts()).toEqual([external]);
  });
});

describe('Google GIS · state, replay y configuración manual', () => {
  it('fija popup/locale/copy, nunca prompt y consume state antes del callback', async () => {
    const onCredential = vi.fn(() => { throw new Error('consumer_failed'); });
    const handle = renderGoogleIdentityButton(options(
      new FakeContainer(),
      onCredential,
      { locale: 'en' },
    ));
    const api = installGoogleApi();
    onlyScript().dispatch('load');
    await handle.ready;

    const initialization = api.initialize.mock.calls[0][0];
    expect(initialization).toMatchObject({
      auto_select: false,
      button_auto_select: false,
      ux_mode: 'popup',
    });
    expect(api.renderButton.mock.calls[0][1]).toMatchObject({
      text: 'continue_with',
      locale: 'en',
    });
    expect(api.prompt).not.toHaveBeenCalled();
    expect(readFileSync(new URL('./googleIdentity.ts', import.meta.url), 'utf8')).not.toContain('.prompt(');

    const state = stateOf(api);
    const callback = callbackOf(api);
    callback({ state });
    callback({ state, credential: 'short' });
    expect(() => callback({ state, credential: 'credential-valid-first-123456' }))
      .toThrow('consumer_failed');
    expect(() => callback({ state, credential: 'credential-valid-replay-12345' })).not.toThrow();
    expect(onCredential).toHaveBeenCalledTimes(1);
  });

  it('missing/unknown/disposed state nunca entrega', async () => {
    const onCredential = vi.fn();
    const handle = renderGoogleIdentityButton(options(new FakeContainer(), onCredential));
    const api = installGoogleApi();
    onlyScript().dispatch('load');
    await handle.ready;
    const callback = callbackOf(api);
    callback({ credential: 'credential-without-state-12345' });
    callback({ state: 1, credential: 'credential-nonstring-state-123' });
    callback({ state: 'unknown', credential: 'credential-unknown-state-12345' });
    handle.dispose();
    callback({ state: stateOf(api), credential: 'credential-after-dispose-12345' });
    expect(onCredential).not.toHaveBeenCalled();
  });

  it('una colisión UUID no pisa otra ruta y falla tras cuatro intentos', async () => {
    const collision = '11111111-1111-4111-8111-111111111111';
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(collision);
    const firstCredential = vi.fn();
    const first = renderGoogleIdentityButton(options(new FakeContainer(), firstCredential));
    expect(() => renderGoogleIdentityButton(options(new FakeContainer(), vi.fn())))
      .toThrow('google_state_collision');

    const api = installGoogleApi();
    onlyScript().dispatch('load');
    await first.ready;
    callbackOf(api)({ state: collision, credential: 'credential-first-route-survives-123' });
    expect(firstCredential).toHaveBeenCalledTimes(1);
  });

  it('mock crea botón local, cero script y callback one-use', async () => {
    vi.stubEnv('VITE_MOCK', '1');
    const onCredential = vi.fn();
    const container = new FakeContainer();
    const handle = renderGoogleIdentityButton(options(container, onCredential));
    await handle.ready;

    expect(browser.scripts()).toHaveLength(0);
    const button = container.children[0] as FakeButtonElement;
    expect(button.textContent).toBe('Continuar con Google');
    button.dispatch('click');
    button.dispatch('click');
    expect(onCredential).toHaveBeenCalledTimes(1);
  });
});
