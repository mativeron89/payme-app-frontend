const GOOGLE_IDENTITY_SCRIPT = 'https://accounts.google.com/gsi/client';
const GOOGLE_SCRIPT_ID = 'payme-google-identity-services';

interface GoogleCredentialResponse {
  credential?: unknown;
  state?: unknown;
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
    options: {
      type: 'standard';
      theme: 'outline';
      size: 'large';
      text: 'continue_with';
      locale: 'es' | 'en';
      state: string;
      width: number;
    },
  ): void;
}

interface GoogleNamespace {
  accounts?: { id?: GoogleIdentityApi };
}

let loaderInFlight: Promise<GoogleIdentityApi> | null = null;
let ownedScript: HTMLScriptElement | null = null;
let initializedClientId: string | null = null;
let pendingClientId: string | null = null;
let pendingClientOwners = new Set<symbol>();

interface GoogleMount {
  readonly owner: symbol;
  readonly container: HTMLElement;
  readonly clientId: string;
  readonly onCredential: (credential: string) => void;
  active: boolean;
  reserved: boolean;
  routeState: string | null;
  resolveDisposed: (() => void) | null;
}

let containerMounts = new WeakMap<HTMLElement, GoogleMount>();

interface CredentialRoute {
  readonly mount: GoogleMount;
}

const credentialRoutes = new Map<string, CredentialRoute>();

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

/**
 * GIS comparte un único callback por página. `state` pertenece al botón que
 * originó la respuesta, así que rutea sin guardar tokens ni datos de perfil.
 * La ruta se consume antes de entregar: replay y reentrancia quedan cerrados.
 */
function routeCredential(response: GoogleCredentialResponse): void {
  if (typeof response.state !== 'string') return;
  const route = credentialRoutes.get(response.state);
  if (!route) return;
  const { mount } = route;
  if (!mount.active || containerMounts.get(mount.container) !== mount) {
    credentialRoutes.delete(response.state);
    return;
  }
  if (!validCredential(response.credential)) return;
  credentialRoutes.delete(response.state);
  mount.routeState = null;
  mount.onCredential(response.credential);
}

function assertClientIdCompatible(clientId: string): void {
  if (initializedClientId !== null) {
    if (initializedClientId !== clientId) throw new Error('google_client_id_conflict');
    return;
  }
  if (pendingClientId !== null && pendingClientId !== clientId) {
    throw new Error('google_client_id_conflict');
  }
}

function reserveClientId(mount: GoogleMount): void {
  assertClientIdCompatible(mount.clientId);
  if (initializedClientId !== null) return;
  pendingClientId = mount.clientId;
  pendingClientOwners.add(mount.owner);
  mount.reserved = true;
}

function releaseClientId(mount: GoogleMount): void {
  if (!mount.reserved) return;
  mount.reserved = false;
  pendingClientOwners.delete(mount.owner);
  if (initializedClientId === null && pendingClientOwners.size === 0) {
    pendingClientId = null;
  }
}

function clearRoute(mount: GoogleMount): void {
  if (mount.routeState === null) return;
  const route = credentialRoutes.get(mount.routeState);
  if (route?.mount === mount) credentialRoutes.delete(mount.routeState);
  mount.routeState = null;
}

function deactivateMount(
  mount: GoogleMount,
  clearContainer: boolean,
  resolveAsDisposed = true,
): void {
  if (!mount.active) return;
  mount.active = false;
  clearRoute(mount);
  releaseClientId(mount);
  if (resolveAsDisposed) mount.resolveDisposed?.();
  mount.resolveDisposed = null;
  if (containerMounts.get(mount.container) !== mount) return;
  containerMounts.delete(mount.container);
  if (clearContainer) mount.container.replaceChildren();
}

function allocateRouteState(): string {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const candidate = crypto.randomUUID();
    if (!credentialRoutes.has(candidate)) return candidate;
  }
  throw new Error('google_state_collision');
}

/** GIS documenta una sola inicialización por página; una segunda pisa config. */
function initializeGoogleIdentity(api: GoogleIdentityApi, mount: GoogleMount): void {
  if (initializedClientId !== null) {
    if (initializedClientId !== mount.clientId) throw new Error('google_client_id_conflict');
    releaseClientId(mount);
    return;
  }
  if (!mount.reserved
      || pendingClientId !== mount.clientId
      || !pendingClientOwners.has(mount.owner)) {
    throw new Error('google_client_id_reservation_lost');
  }
  api.initialize({
    client_id: mount.clientId,
    callback: routeCredential,
    auto_select: false,
    button_auto_select: false,
    ux_mode: 'popup',
  });
  initializedClientId = mount.clientId;
  pendingClientId = null;
  pendingClientOwners.clear();
  mount.reserved = false;
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
  readonly locale: 'es' | 'en';
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
  if (options.locale !== 'es' && options.locale !== 'en') {
    throw new Error('google_locale_invalid');
  }
  const mock = import.meta.env.VITE_MOCK === '1';
  if (!mock) assertClientIdCompatible(options.clientId);
  const routeState = mock ? null : allocateRouteState();
  const previous = containerMounts.get(options.container);
  if (previous) deactivateMount(previous, false);

  let mockDelivered = false;
  const mountRecord: GoogleMount = {
    owner: Symbol('google-identity-mount'),
    container: options.container,
    clientId: options.clientId,
    onCredential: options.onCredential,
    active: true,
    reserved: false,
    routeState,
    resolveDisposed: null,
  };
  containerMounts.set(options.container, mountRecord);
  const deliverMock = (credential: unknown) => {
    if (!mountRecord.active
        || containerMounts.get(options.container) !== mountRecord
        || mockDelivered
        || !validCredential(credential)) return;
    mockDelivered = true;
    options.onCredential(credential);
  };

  options.container.replaceChildren();
  let mountPromise: Promise<void>;
  if (mock) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'social-provider-button social-provider-google';
    button.textContent = options.mockLabel;
    button.addEventListener('click', () => {
      deliverMock(`mock-google-credential-${crypto.randomUUID()}`);
    });
    options.container.append(button);
    mountPromise = Promise.resolve();
  } else {
    reserveClientId(mountRecord);
    credentialRoutes.set(routeState as string, { mount: mountRecord });
    mountPromise = loadGoogleIdentityScript().then((api) => {
      if (!mountRecord.active || containerMounts.get(options.container) !== mountRecord) return;
      initializeGoogleIdentity(api, mountRecord);
      if (!mountRecord.active || containerMounts.get(options.container) !== mountRecord) return;
      api.renderButton(options.container, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        text: 'continue_with',
        locale: options.locale,
        state: routeState as string,
        width: Math.max(200, Math.min(360, Math.floor(options.container.clientWidth || 320))),
      });
    }).catch((error) => {
      deactivateMount(mountRecord, true, false);
      throw error;
    });
  }

  const disposed = new Promise<void>((resolve) => { mountRecord.resolveDisposed = resolve; });
  const ready = Promise.race([mountPromise, disposed]);
  const dispose = () => deactivateMount(mountRecord, true);
  return { ready, dispose };
}

export function resetGoogleIdentityForTests(): void {
  loaderInFlight = null;
  ownedScript?.remove();
  ownedScript = null;
  initializedClientId = null;
  pendingClientId = null;
  pendingClientOwners = new Set<symbol>();
  credentialRoutes.clear();
  containerMounts = new WeakMap<HTMLElement, GoogleMount>();
}

export const GOOGLE_IDENTITY_SCRIPT_URL = GOOGLE_IDENTITY_SCRIPT;
