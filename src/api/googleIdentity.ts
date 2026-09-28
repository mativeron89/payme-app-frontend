const GOOGLE_IDENTITY_SCRIPT = 'https://accounts.google.com/gsi/client';
const GOOGLE_SCRIPT_ID = 'payme-google-identity-services';

interface GoogleCredentialResponse {
  credential?: unknown;
  state?: unknown;
}

/** El popup de siempre: la credencial vuelve al callback de la página. */
interface GoogleInitPopup {
  client_id: string;
  callback: (response: GoogleCredentialResponse) => void;
  auto_select: false;
  button_auto_select: false;
  ux_mode: 'popup';
}

/**
 * AF-GOOGLE-REDIRECT · decisiones 92 y 94: «Entrar» en la MISMA pestaña. Es la
 * forma exacta del wire del dueño (`docs/GOOGLE_REDIRECT_D92_WIRE.md` §2):
 * **sin `callback`**, porque en modo redirect Google hace el POST al
 * `login_uri`, no al JS.
 */
interface GoogleInitRedirect {
  client_id: string;
  ux_mode: 'redirect';
  login_uri: string;
  auto_select: false;
}

interface GoogleIdentityApi {
  initialize(options: GoogleInitPopup | GoogleInitRedirect): void;
  renderButton(
    parent: HTMLElement,
    options: {
      type: 'standard';
      theme: 'outline';
      size: 'large';
      /**
       * 🔴 GIS acepta `rectangular | pill | circle | square` y NADA MÁS: su
       * radio no es un número. El diseño del login pide 12px y esto entrega el
       * rectangular de Google —unos 4px—, que es el desvío declarado en la
       * entrega. Se pasa EXPLÍCITO aunque coincida con el default del SDK: un
       * default que Google cambie mañana movería el botón sin que nadie toque
       * este repo.
       */
      shape: 'rectangular';
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
/** Con qué modo quedó inicializado GIS: `popup` o `redirect <login_uri>`. */
let initializedMode: string | null = null;
let pendingClientId: string | null = null;
let pendingClientOwners = new Set<symbol>();

interface GoogleMount {
  readonly owner: symbol;
  readonly container: HTMLElement;
  readonly clientId: string;
  /** `null` = popup; si no, el `login_uri` del modo redirect. */
  readonly loginUri: string | null;
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

/**
 * AF-16 · la credencial del riel mock tiene FORMA de `id_token` (tres segmentos
 * base64url), para que la pantalla pueda precargar nombre, apellido y correo
 * igual que con Google real. **No está firmada ni lo pretende**: el tercer
 * segmento es el marcador `mock-google-credential-<uuid>`, que también le sirve
 * al e2e para buscar el token en el almacenamiento. Sólo existe en el riel
 * mock; el camino real entrega lo que GIS entrega.
 */
export const CLAIMS_GOOGLE_MOCK = {
  sub: 'mock-google-subject',
  given_name: 'Ana',
  family_name: 'Demo',
  email: 'ana.demo@payme.local',
} as const;

function base64UrlJson(valor: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(valor));
  let binario = '';
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function credencialMock(): string {
  return `${base64UrlJson({ alg: 'none', typ: 'JWT' })}.${base64UrlJson(CLAIMS_GOOGLE_MOCK)}`
    + `.mock-google-credential-${crypto.randomUUID()}`;
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

function modoDe(mount: GoogleMount): string {
  return mount.loginUri === null ? 'popup' : `redirect ${mount.loginUri}`;
}

function configuracionDe(mount: GoogleMount): GoogleInitPopup | GoogleInitRedirect {
  return mount.loginUri === null
    ? {
        client_id: mount.clientId,
        callback: routeCredential,
        auto_select: false,
        button_auto_select: false,
        ux_mode: 'popup',
      }
    : {
        client_id: mount.clientId,
        ux_mode: 'redirect',
        login_uri: mount.loginUri,
        auto_select: false,
      };
}

/**
 * GIS documenta una sola inicialización por página; una segunda pisa config.
 *
 * AF-GOOGLE-REDIRECT · la única excepción es el MODO: «Entrar» usa redirect y
 * «Crea tu cuenta» sigue en popup (fase 1), y las dos pantallas conviven en la
 * misma página. El wire del dueño lo fija: «el modo lo decide la pantalla
 * montada». Si la pantalla que monta pide otro modo, se vuelve a inicializar
 * con su configuración completa; con el mismo modo, nunca.
 */
function initializeGoogleIdentity(api: GoogleIdentityApi, mount: GoogleMount): void {
  if (initializedClientId !== null) {
    if (initializedClientId !== mount.clientId) throw new Error('google_client_id_conflict');
    releaseClientId(mount);
    if (initializedMode !== modoDe(mount)) {
      api.initialize(configuracionDe(mount));
      initializedMode = modoDe(mount);
    }
    return;
  }
  if (!mount.reserved
      || pendingClientId !== mount.clientId
      || !pendingClientOwners.has(mount.owner)) {
    throw new Error('google_client_id_reservation_lost');
  }
  api.initialize(configuracionDe(mount));
  initializedMode = modoDe(mount);
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
  /**
   * AF-GOOGLE-REDIRECT · modo redirect: Google vuelve a la app por el
   * `login_uri`, así que `onCredential` no se llama nunca.
   *
   * `simularEnMock` es la ida y vuelta del dueño en el riel mock (donde no hay
   * GIS ni AB): recibe la credencial del botón mock y hace lo que harían Google
   * y el 303. Nunca se llama en real.
   */
  readonly redirect?: {
    readonly loginUri: string;
    readonly simularEnMock: (credential: string) => void;
    /**
     * AF-GOOGLE-ALTA-REDIRECT · el `state` del botón. Sin él, el de siempre
     * (fase 1, «Entrar»). Con `alta:<id>`, el dueño lo toma como «Crea tu
     * cuenta» (wire D102 §2): el mismo `login_uri`, otro camino.
     */
    readonly state?: string;
  };
}

/**
 * Un `state` que GIS devuelve tal cual: de un alfabeto seguro y acotado. AF-VINCULAR-GOOGLE ·
 * hasta 209: el más largo es `vincular:` + 200 del dueño (`STATE_VINCULAR`); el
 * de alta llega a 105.
 */
function validState(value: string): boolean {
  return /^[A-Za-z0-9:_-]{1,209}$/.test(value);
}

/** Un `login_uri` válido: https, sin credenciales, query ni fragmento. */
function validLoginUri(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && !u.search && !u.hash
      && u.href === value;
  } catch {
    return false;
  }
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
  if (options.redirect && !validLoginUri(options.redirect.loginUri)) {
    throw new Error('google_login_uri_invalid');
  }
  if (options.redirect?.state !== undefined && !validState(options.redirect.state)) {
    throw new Error('google_state_invalid');
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
    loginUri: options.redirect?.loginUri ?? null,
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
    const redirect = options.redirect;
    if (redirect) {
      // Observable para el e2e: el riel mock no tiene GIS que inspeccionar.
      button.dataset.uxMode = 'redirect';
      button.dataset.loginUri = redirect.loginUri;
      if (redirect.state !== undefined) button.dataset.state = redirect.state;
    }
    button.addEventListener('click', () => {
      if (!redirect) {
        deliverMock(credencialMock());
        return;
      }
      if (!mountRecord.active || containerMounts.get(options.container) !== mountRecord || mockDelivered) return;
      mockDelivered = true;
      redirect.simularEnMock(credencialMock());
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
        shape: 'rectangular',
        text: 'continue_with',
        locale: options.locale,
        state: options.redirect?.state ?? (routeState as string),
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
  initializedMode = null;
  pendingClientId = null;
  pendingClientOwners = new Set<symbol>();
  credentialRoutes.clear();
  containerMounts = new WeakMap<HTMLElement, GoogleMount>();
}

export const GOOGLE_IDENTITY_SCRIPT_URL = GOOGLE_IDENTITY_SCRIPT;
