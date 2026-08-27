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

function installGoogleApi(): InstalledApi {
  const api = {
    initialize: vi.fn(),
    renderButton: vi.fn((container: FakeContainer) => container.append({ gis: true })),
    prompt: vi.fn(),
  };
  vi.stubGlobal('google', { accounts: { id: api } });
  return api;
}

function options(container = new FakeContainer(), onCredential = vi.fn()) {
  return {
    container: container as unknown as HTMLElement,
    clientId: 'payme-google-web-client-id',
    mockLabel: 'Continuar con Google',
    onCredential,
  };
}

function onlyScript(): FakeScriptElement {
  expect(browser.scripts()).toHaveLength(1);
  return browser.scripts()[0];
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

describe('Google GIS · cancelación y ownership', () => {
  it('dispose antes de load resuelve inmediatamente y bloquea initialize/render/callback', async () => {
    const onCredential = vi.fn();
    const handle = renderGoogleIdentityButton(options(new FakeContainer(), onCredential));
    const script = onlyScript();

    handle.dispose();
    await expect(handle.ready).resolves.toBeUndefined();
    const api = installGoogleApi();
    script.dispatch('load');
    await Promise.resolve();

    expect(api.initialize).not.toHaveBeenCalled();
    expect(api.renderButton).not.toHaveBeenCalled();
    expect(onCredential).not.toHaveBeenCalled();
  });

  it('una generación vieja no renderiza ni puede borrar el montaje nuevo del container', async () => {
    const container = new FakeContainer(280);
    const oldHandle = renderGoogleIdentityButton(options(container, vi.fn()));
    const newCredential = vi.fn();
    const currentHandle = renderGoogleIdentityButton(options(container, newCredential));
    const api = installGoogleApi();
    onlyScript().dispatch('load');
    await Promise.all([oldHandle.ready, currentHandle.ready]);

    expect(api.initialize).toHaveBeenCalledTimes(1);
    expect(api.renderButton).toHaveBeenCalledTimes(1);
    expect(container.children).toEqual([{ gis: true }]);
    oldHandle.dispose();
    expect(container.children).toEqual([{ gis: true }]);

    const callback = api.initialize.mock.calls[0][0].callback as (value: { credential?: unknown }) => void;
    callback({ credential: 'credential-current-generation-123' });
    expect(newCredential).toHaveBeenCalledWith('credential-current-generation-123');
  });
});

describe('Google GIS · loader único y retry sano', () => {
  it('montajes concurrentes comparten exactamente un script/loader', async () => {
    const first = renderGoogleIdentityButton(options(new FakeContainer()));
    const second = renderGoogleIdentityButton(options(new FakeContainer()));
    expect(browser.scripts()).toHaveLength(1);

    const api = installGoogleApi();
    onlyScript().dispatch('load');
    await Promise.all([first.ready, second.ready]);
    expect(api.initialize).toHaveBeenCalledTimes(2);
    expect(api.renderButton).toHaveBeenCalledTimes(2);
  });

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

describe('Google GIS · inicialización manual y callback one-use', () => {
  it('fija popup sin auto-select, nunca prompt y entrega sólo la primera credential válida', async () => {
    const onCredential = vi.fn();
    const handle = renderGoogleIdentityButton(options(new FakeContainer(), onCredential));
    const api = installGoogleApi();
    onlyScript().dispatch('load');
    await handle.ready;

    expect(api.initialize).toHaveBeenCalledTimes(1);
    const initialization = api.initialize.mock.calls[0][0] as {
      auto_select: boolean;
      button_auto_select: boolean;
      ux_mode: string;
      callback: (value: { credential?: unknown }) => void;
    };
    expect(initialization.auto_select).toBe(false);
    expect(initialization.button_auto_select).toBe(false);
    expect(initialization.ux_mode).toBe('popup');
    initialization.callback({});
    initialization.callback({ credential: 'short' });
    initialization.callback({ credential: 'credential-valid-first-123456' });
    initialization.callback({ credential: 'credential-valid-second-12345' });
    expect(onCredential).toHaveBeenCalledTimes(1);
    expect(onCredential).toHaveBeenCalledWith('credential-valid-first-123456');
    expect(api.prompt).not.toHaveBeenCalled();
    expect(readFileSync(new URL('./googleIdentity.ts', import.meta.url), 'utf8')).not.toContain('.prompt(');
  });

  it('dispose invalida también un callback ya instalado', async () => {
    const onCredential = vi.fn();
    const handle = renderGoogleIdentityButton(options(new FakeContainer(), onCredential));
    const api = installGoogleApi();
    onlyScript().dispatch('load');
    await handle.ready;
    const callback = api.initialize.mock.calls[0][0].callback as (value: { credential: string }) => void;
    handle.dispose();
    callback({ credential: 'credential-after-dispose-123456' });
    expect(onCredential).not.toHaveBeenCalled();
  });

  it('mock crea botón local, cero script y callback one-use', async () => {
    vi.stubEnv('VITE_MOCK', '1');
    const onCredential = vi.fn();
    const container = new FakeContainer();
    const handle = renderGoogleIdentityButton(options(container, onCredential));
    await handle.ready;

    expect(browser.scripts()).toHaveLength(0);
    expect(container.children).toHaveLength(1);
    const button = container.children[0] as FakeButtonElement;
    expect(button.textContent).toBe('Continuar con Google');
    button.dispatch('click');
    button.dispatch('click');
    expect(onCredential).toHaveBeenCalledTimes(1);
  });
});
