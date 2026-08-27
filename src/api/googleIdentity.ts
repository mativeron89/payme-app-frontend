const GOOGLE_IDENTITY_SCRIPT = 'https://accounts.google.com/gsi/client';
const GOOGLE_SCRIPT_ID = 'payme-google-identity-services';

interface GoogleCredentialResponse {
  credential?: unknown;
}

interface GoogleIdentityApi {
  initialize(options: {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
    auto_select: false;
    button_auto_select: false;
    ux_mode: 'popup';
  }): void;
  renderButton(
    parent: HTMLElement,
    options: { type: 'standard'; theme: 'outline'; size: 'large'; width: number },
  ): void;
}

interface GoogleNamespace {
  accounts?: { id?: GoogleIdentityApi };
}

let loaderInFlight: Promise<GoogleIdentityApi> | null = null;
let ownedScript: HTMLScriptElement | null = null;
const containerOwners = new WeakMap<HTMLElement, symbol>();

function googleApi(): GoogleIdentityApi | null {
  const candidate = (globalThis as unknown as { google?: GoogleNamespace }).google?.accounts?.id;
  return candidate
    && typeof candidate.initialize === 'function'
    && typeof candidate.renderButton === 'function'
    ? candidate
    : null;
}

function validClientId(value: string): boolean {
  return /^[A-Za-z0-9._:-]{3,200}$/.test(value);
}

function validCredential(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 20 && value.length <= 8192;
}

function loadGoogleIdentityScript(): Promise<GoogleIdentityApi> {
  if (import.meta.env.VITE_MOCK === '1') {
    return Promise.reject(new Error('google_identity_script_forbidden_in_mock'));
  }
  if (loaderInFlight) return loaderInFlight;
  loaderInFlight = new Promise<GoogleIdentityApi>((resolve, reject) => {
    const existing = document.getElementById(GOOGLE_SCRIPT_ID);
    if (existing) {
      if (!(existing instanceof HTMLScriptElement) || existing.src !== GOOGLE_IDENTITY_SCRIPT) {
        reject(new Error('google_identity_script_conflict'));
        return;
      }
      const ready = googleApi();
      if (ready) {
        resolve(ready);
        return;
      }
      // Con `loaderInFlight === null`, un nodo existente sin API no tiene un
      // evento futuro acreditable: `load` pudo haber ocurrido antes. Nunca se
      // cuelga un retry escuchando un evento pasado. Sólo retiramos el nodo si
      // fue creado por este módulo; uno ajeno falla cerrado como conflicto.
      if (existing === ownedScript) {
        existing.remove();
        ownedScript = null;
        reject(new Error('google_identity_unavailable'));
      } else {
        reject(new Error('google_identity_script_conflict'));
      }
      return;
    }
    const script = document.createElement('script');
    ownedScript = script;
    script.id = GOOGLE_SCRIPT_ID;
    script.src = GOOGLE_IDENTITY_SCRIPT;
    script.async = true;
    script.defer = true;
    script.referrerPolicy = 'no-referrer';
    const retireOwnScript = () => {
      if (ownedScript !== script) return;
      script.remove();
      ownedScript = null;
    };
    const onLoad = () => {
      const api = googleApi();
      if (api) resolve(api);
      else {
        retireOwnScript();
        reject(new Error('google_identity_unavailable'));
      }
    };
    const onError = () => {
      retireOwnScript();
      reject(new Error('google_identity_unavailable'));
    };
    script.addEventListener('load', onLoad, { once: true });
    script.addEventListener('error', onError, { once: true });
    document.head.append(script);
  }).catch((error) => {
    loaderInFlight = null;
    throw error;
  });
  return loaderInFlight;
}

export interface GoogleButtonOptions {
  readonly container: HTMLElement;
  readonly clientId: string;
  readonly mockLabel: string;
  readonly onCredential: (credential: string) => void;
}

export interface GoogleButtonHandle {
  /** Resuelve al renderizar o al cancelar; sólo rechaza ante un fallo activo. */
  readonly ready: Promise<void>;
  /** Invalida sincrónicamente callbacks/render aun si el loader sigue pendiente. */
  dispose(): void;
}

/** Monta sólo por acción explícita; el callback queda one-use y memory-only. */
export function renderGoogleIdentityButton(options: GoogleButtonOptions): GoogleButtonHandle {
  if (!validClientId(options.clientId)) throw new Error('google_client_id_invalid');
  let active = true;
  let delivered = false;
  let resolveDisposed: (() => void) | null = null;
  const owner = Symbol('google-identity-mount');
  containerOwners.set(options.container, owner);
  const deliver = (credential: unknown) => {
    if (!active
        || containerOwners.get(options.container) !== owner
        || delivered
        || !validCredential(credential)) return;
    delivered = true;
    options.onCredential(credential);
  };

  options.container.replaceChildren();
  let mount: Promise<void>;
  if (import.meta.env.VITE_MOCK === '1') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'social-provider-button social-provider-google';
    button.textContent = options.mockLabel;
    button.addEventListener('click', () => {
      deliver(`mock-google-credential-${crypto.randomUUID()}`);
    });
    options.container.append(button);
    mount = Promise.resolve();
  } else {
    mount = loadGoogleIdentityScript().then((api) => {
      if (!active || containerOwners.get(options.container) !== owner) return;
      api.initialize({
        client_id: options.clientId,
        callback: (response) => deliver(response.credential),
        auto_select: false,
        button_auto_select: false,
        ux_mode: 'popup',
      });
      if (!active || containerOwners.get(options.container) !== owner) return;
      api.renderButton(options.container, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        width: Math.max(200, Math.min(360, Math.floor(options.container.clientWidth || 320))),
      });
    });
  }

  const disposed = new Promise<void>((resolve) => { resolveDisposed = resolve; });
  const ready = Promise.race([mount, disposed]);
  const dispose = () => {
    if (!active) return;
    active = false;
    resolveDisposed?.();
    resolveDisposed = null;
    if (containerOwners.get(options.container) === owner) {
      containerOwners.delete(options.container);
      options.container.replaceChildren();
    }
  };
  return { ready, dispose };
}

export function resetGoogleIdentityForTests(): void {
  loaderInFlight = null;
  ownedScript?.remove();
  ownedScript = null;
}

export const GOOGLE_IDENTITY_SCRIPT_URL = GOOGLE_IDENTITY_SCRIPT;
