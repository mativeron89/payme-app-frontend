import { useSyncExternalStore } from 'react';

/**
 * AF-USUARIO-ARROBA · decisión 93 de Mati · el @usuario, lado de la app.
 *
 * Contrato del dueño: App Backend v2.137.0 (`a8987b06`),
 * `docs/USERNAME_D93_WIRE.md` (sha256 792e7f8b…), espejado en
 * `contract-mirror/routes/{config,account,friends}.js` y
 * `contract-mirror/middleware/auth.js`.
 *
 * 🔴 **Todo cuelga de `features.username.enabled`.** Ausente, mal formado o
 * `false` (que es lo que sirve hoy el dueño): la app no pide nada del @ ni
 * muestra nada del @. Es lo que la orden pide medir: «apagado, cero cambios».
 *
 * Este módulo es lo puro (formato, decodificadores) más el store de la
 * capability. Las pantallas viven en `components/PuertaArroba.tsx`,
 * `components/ArrobaEnConfiguracion.tsx` y `components/BuscarPorArroba.tsx`.
 */

// ─── Formato (wire §2) ───────────────────────────────────────────────────

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
/** Cuántos resultados trae la búsqueda, como máximo (wire §5). */
export const BUSQUEDA_MAX_RESULTADOS = 5;
/** Días entre un cambio de @ y el siguiente (decisión 93, punto 4). */
export const CAMBIO_DIAS = 30;

const ALFABETO = /^[a-z0-9._]*$/;
const FORMATO = /^[a-z0-9._]{3,20}$/;

/**
 * Lo mismo que hace el dueño con lo que se escribe (wire §2): sin espacios al
 * borde, sin UNA `@` adelante y en minúsculas. `@MatiVeron` → `mativeron`.
 */
export function normalizarUsername(raw: string): string {
  return raw.normalize('NFC').trim().replace(/^@/, '').toLowerCase();
}

/**
 * Qué le falta a lo escrito para ser un @ válido, en el orden en que conviene
 * decirlo. `ok` = cumple el formato; que esté libre lo sabe sólo el dueño.
 */
export type ProblemaDeFormato = 'ok' | 'vacio' | 'caracteres' | 'corto' | 'largo' | 'punto_en_borde';

export function problemaDeFormato(normalizado: string): ProblemaDeFormato {
  if (normalizado.length === 0) return 'vacio';
  if (!ALFABETO.test(normalizado)) return 'caracteres';
  if (normalizado.length < USERNAME_MIN) return 'corto';
  if (normalizado.length > USERNAME_MAX) return 'largo';
  if (normalizado.startsWith('.') || normalizado.endsWith('.')) return 'punto_en_borde';
  return 'ok';
}

export function formatoValido(normalizado: string): boolean {
  return problemaDeFormato(normalizado) === 'ok' && FORMATO.test(normalizado);
}

/**
 * ¿Se puede consultar la búsqueda con esto? Desde 3 caracteres del alfabeto del
 * @ (wire §5: menos, o fuera del alfabeto, es 400 `username_query_invalid`).
 * El punto en el borde sí vale para buscar: es un prefijo, no un @.
 */
export function consultaValida(normalizado: string): boolean {
  return FORMATO.test(normalizado);
}

/**
 * La fecha desde la que se puede volver a cambiar el @ (`next_change_at` del
 * dueño), como «26 de octubre», en hora de México.
 */
export function fechaDeCambio(iso: string, idioma: 'es' | 'en'): string {
  return new Intl.DateTimeFormat(idioma === 'es' ? 'es-MX' : 'en-US', {
    day: 'numeric', month: 'long', timeZone: 'America/Mexico_City',
  }).format(new Date(iso));
}

// ─── Decodificadores (fail-closed, claves exactas) ───────────────────────

function plainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const esperadas = [...expected].sort();
  return keys.length === esperadas.length && keys.every((key, i) => key === esperadas[i]);
}

function fechaIso(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 40 && !Number.isNaN(Date.parse(value));
}

/** Nombre o apellido tal como vienen del dueño: texto acotado. */
function textoAcotado(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 100;
}

export interface UsernameCapability {
  readonly enabled: boolean;
}

export const USERNAME_OFF: UsernameCapability = Object.freeze({ enabled: false });

/**
 * `features.username` = `{ supported: true, enabled: boolean }` (wire §1), dos
 * claves exactas. Cualquier otra cosa —ausente, claves de más o de menos,
 * `supported` distinto de `true`, `enabled` no booleano— es APAGADO.
 */
export function decodeUsernameCapability(config: unknown): UsernameCapability {
  if (!plainObject(config)) return USERNAME_OFF;
  const features = config.features;
  if (!plainObject(features)) return USERNAME_OFF;
  const raw = features.username;
  if (!plainObject(raw) || !exactKeys(raw, ['enabled', 'supported'])
      || raw.supported !== true || typeof raw.enabled !== 'boolean') {
    return USERNAME_OFF;
  }
  return { enabled: raw.enabled === true };
}

/** `GET|PUT /api/account/username` (wire §4). */
export interface EstadoUsername {
  readonly username: string | null;
  readonly required: boolean;
  readonly next_change_at: string | null;
}

export function decodeEstadoUsername(value: unknown): EstadoUsername {
  if (!plainObject(value) || !exactKeys(value, ['next_change_at', 'required', 'username'])) {
    throw new Error('username_response_malformed');
  }
  const { username, required, next_change_at: next } = value;
  if (username !== null && (typeof username !== 'string' || !formatoValido(username))) {
    throw new Error('username_response_malformed');
  }
  if (typeof required !== 'boolean' || required !== (username === null)) {
    throw new Error('username_response_malformed');
  }
  if (next !== null && !fechaIso(next)) throw new Error('username_response_malformed');
  return { username, required, next_change_at: next };
}

/** `GET /api/account/username/suggestion`: un @ válido o `null` (wire §4). */
export function decodeSugerencia(value: unknown): string | null {
  if (!plainObject(value) || !exactKeys(value, ['suggestion'])) {
    throw new Error('username_suggestion_malformed');
  }
  const { suggestion } = value;
  if (suggestion === null) return null;
  if (typeof suggestion !== 'string' || !formatoValido(suggestion)) {
    throw new Error('username_suggestion_malformed');
  }
  return suggestion;
}

/**
 * Un resultado de la búsqueda: EXACTAMENTE las cuatro claves del wire §5. Una
 * clave de más —un `email`, un `id`, un `payme_id`— rechaza la respuesta
 * entera: el mail nunca entra a la app por acá, ni siquiera sin mostrarse.
 */
export interface ResultadoArroba {
  readonly username: string;
  readonly first_name: string;
  readonly last_name: string;
  readonly has_avatar: boolean;
}

export function decodeResultadosArroba(value: unknown): ResultadoArroba[] {
  if (!plainObject(value) || !exactKeys(value, ['results']) || !Array.isArray(value.results)
      || value.results.length > BUSQUEDA_MAX_RESULTADOS) {
    throw new Error('username_search_malformed');
  }
  return value.results.map((r: unknown) => {
    if (!plainObject(r) || !exactKeys(r, ['first_name', 'has_avatar', 'last_name', 'username'])
        || typeof r.username !== 'string' || !formatoValido(r.username)
        || !textoAcotado(r.first_name) || !textoAcotado(r.last_name)
        || typeof r.has_avatar !== 'boolean') {
      throw new Error('username_search_malformed');
    }
    return {
      username: r.username,
      first_name: r.first_name,
      last_name: r.last_name,
      has_avatar: r.has_avatar,
    };
  });
}

// ─── Store de la capability ──────────────────────────────────────────────

/**
 * 🔴 **Sin request propia.** Cada capability de la app pide su `/config`; este
 * store NO: lo alimenta la fachada (`api.getConfig`, en `./index`) con CADA
 * config que llega, y el shell ya pide una al arrancar (`useMoneyRail`). Así,
 * con el @ apagado, la red de la app queda exactamente como estaba. Sólo tras
 * un 428 `username_required` —que el dueño emite únicamente encendido— se pide
 * otra (`recargarUsernameCapability`).
 */
let state: UsernameCapability = USERNAME_OFF;
const listeners = new Set<() => void>();

export function usernameSnapshot(): UsernameCapability {
  return state;
}

export function subscribeUsername(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function applyUsernameConfig(config: unknown): UsernameCapability {
  const next = decodeUsernameCapability(config);
  if (next.enabled !== state.enabled) {
    state = next;
    for (const listener of [...listeners]) listener();
  }
  return state;
}

export function resetUsernameForTests(): void {
  state = USERNAME_OFF;
  for (const listener of [...listeners]) listener();
}

/**
 * Tras un 428 `username_required`: la config que se leyó al arrancar puede ser
 * de antes de encender la bandera. Un fallo deja la capability como estaba.
 */
export function recargarUsernameCapability(): Promise<void> {
  return import('./index')
    .then(({ api }) => api.getConfig())
    .then(() => undefined, () => undefined);
}

export function useUsernameCapability(): UsernameCapability {
  return useSyncExternalStore(subscribeUsername, usernameSnapshot, usernameSnapshot);
}

// ─── Decisión 104 · el @ en lugar del código `payme_…` ─────────────────────

/**
 * AF-USERNAME-D104 · decisión 104 de Mati: «que el usuario esté abajo del
 * nombre, oculta el ID que se le asigna, no hace falta mostrarlo» («Sí, en toda
 * la app»). Wire del dueño: App Backend v2.139.0 (`7f080cd5`),
 * `docs/USERNAME_EN_LISTAS_D104_WIRE.md` (sha256 a9f09c45…).
 *
 * Lo ÚNICO que se muestra de una persona debajo de su nombre: `@usuario` si el
 * dueño mandó un @ con formato válido y la capability está encendida; si no,
 * `null` y no se muestra nada. **Nunca el `payme_id`**: sigue viajando como
 * clave interna (invitar, sumar a un grupo), pero ninguna pantalla lo recibe
 * de esta función. Ausente, `null`, mal formado o apagado dan lo mismo.
 */
export function arrobaVisible(username: unknown, habilitado: boolean): string | null {
  if (!habilitado || typeof username !== 'string' || !formatoValido(username)) return null;
  // El dueño reserva todo @ que EMPIECE por «payme» (`services/username.js`,
  // `reservado()`, en `7f080cd`; no está espejado): uno así nunca es un @ elegido. Si llegara —un código puesto
  // por error en `username`—, se trata como ausente: el código no se pinta.
  if (username.startsWith('payme')) return null;
  return `@${username}`;
}

/**
 * ¿Coincide el filtro con el @ de la persona? Con o sin la `@` adelante. Filtrar
 * por el `payme_id` —que ya no se ve— devolvía amigos sin explicar por qué.
 */
export function arrobaCoincide(username: unknown, habilitado: boolean, filtroPlegado: string): boolean {
  const visible = arrobaVisible(username, habilitado);
  // `@mativeron` contiene tanto «mati» como «@mati».
  return visible !== null && filtroPlegado.length > 0 && visible.includes(filtroPlegado);
}

/**
 * El @ PROPIO, debajo del nombre en Configuración. Lo lee UNA vez la tarjeta
 * «Tu @usuario» (`GET /api/account/username`, la misma request de siempre) y lo
 * publica acá; la cabecera lo toma de este store en vez de pedirlo otra vez. Va
 * atado a la cuenta (`principal_id`): con otra sesión no se ve el @ anterior.
 */
interface ArrobaPropia { readonly principal: string; readonly username: string | null }
let propia: ArrobaPropia | null = null;
const propiaListeners = new Set<() => void>();

export function publicarArrobaPropia(principal: string, username: string | null): void {
  if (propia?.principal === principal && propia.username === username) return;
  propia = { principal, username };
  for (const listener of [...propiaListeners]) listener();
}

function subscribePropia(listener: () => void): () => void {
  propiaListeners.add(listener);
  return () => { propiaListeners.delete(listener); };
}

function propiaSnapshot(): ArrobaPropia | null {
  return propia;
}

export function resetArrobaPropiaForTests(): void {
  propia = null;
  for (const listener of [...propiaListeners]) listener();
}

/** `@usuario` propio de ESTA cuenta, o `null` (apagado, sin elegir, sin leer todavía). */
export function useArrobaPropia(principal: string): string | null {
  const { enabled } = useUsernameCapability();
  const actual = useSyncExternalStore(subscribePropia, propiaSnapshot, propiaSnapshot);
  return actual?.principal === principal ? arrobaVisible(actual.username, enabled) : null;
}
