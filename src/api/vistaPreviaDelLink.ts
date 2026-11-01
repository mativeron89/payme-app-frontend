import { useSyncExternalStore } from 'react';

/**
 * AF-5 · D622 (mejora 5) · D629 · D676 · la vista previa del link de la mesa, sin sesión.
 *
 * Contrato del dueño: `contract/invitacion-preview-v1.json` (App Backend 2.211.0), espejado byte a byte en
 * `contract-mirror/`. `POST /api/invitations/link-preview` con `{"token": "..."}` en el CUERPO (nunca en la URL de la
 * API) contesta, para un link vigente de una mesa viva, exactamente `{inviter_first_name, restaurant_name}`; con
 * `inviter_first_name: null` si quien invita no es mayor de edad conocida (D676). Todo lo demás es un 403 uniforme.
 *
 * Lo que garantiza este módulo, y por qué la pantalla de hoy no cambia en ningún otro caso:
 * - **Sin la capacidad no se pide nada.** `features.link_preview` de `GET /api/config`, con la forma exacta
 *   `{supported: true}`. Pendiente (la config todavía no llegó o falló), ausente (un dueño anterior, que contestaría 401
 *   porque `requireAuth` cubre `/api/invitations`) o de otra forma: apagada.
 * - **Todo lo que no es un 200 bien formado es «sin vista previa»** (`null`): el 403 de los cuatro motivos, el 400, el
 *   503, el 429, la red, la espera de más de `PLAZO_VISTA_PREVIA_MS` y cualquier forma que no sea la del contrato.
 *   Nunca rechaza: quien llama no tiene un camino de error que dibujar.
 * - **En la memoria de la pestaña, una vez por token.** Ni `localStorage` ni `sessionStorage`: el nombre de una
 *   persona no se escribe en el dispositivo. Un fallo también queda recordado: no se reintenta ni cambia tarde.
 */

export interface VistaPreviaDelLink {
  /** El nombre de pila de quien invita, o `null` (D676: no es mayor de edad conocida). Nunca el apellido. */
  readonly invitador: string | null;
  /** El nombre del restaurante que ya se ve en los Avisos. */
  readonly restaurante: string;
}

/** Literal y sin interpolar: el token viaja en el cuerpo. */
export const RUTA_VISTA_PREVIA = '/invitations/link-preview';

/** Más que esto y queda la pantalla de hoy (especificación D622 §6). */
export const PLAZO_VISTA_PREVIA_MS = 1500;

function objetoPlano(v: unknown): v is Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function clavesExactas(v: Record<string, unknown>, claves: readonly string[]): boolean {
  const propias = Object.keys(v);
  return propias.length === claves.length && claves.every((k) => Object.prototype.hasOwnProperty.call(v, k));
}

function textoConContenido(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/** Exactamente las dos claves del contrato y sus tipos; cualquier otra cosa, `null`. */
export function decodeVistaPreviaDelLink(raw: unknown): VistaPreviaDelLink | null {
  if (!objetoPlano(raw) || !clavesExactas(raw, ['inviter_first_name', 'restaurant_name'])) return null;
  const nombre = raw.inviter_first_name;
  const restaurante = raw.restaurant_name;
  if (!textoConContenido(restaurante)) return null;
  if (nombre !== null && !textoConContenido(nombre)) return null;
  return { invitador: nombre, restaurante };
}

// ─── La capacidad ─────────────────────────────────────────────────────────

/** `features.link_preview` → encendida sólo con `{supported: true}`, la clave exacta. */
export function decodeCapacidadVistaPrevia(config: unknown): boolean {
  if (!objetoPlano(config) || !objetoPlano(config.features)) return false;
  const raw = config.features.link_preview;
  return objetoPlano(raw) && clavesExactas(raw, ['supported']) && raw.supported === true;
}

export type EstadoCapacidadVistaPrevia = 'pendiente' | 'encendida' | 'apagada';
let capacidad: EstadoCapacidadVistaPrevia = 'pendiente';
const oyentes = new Set<() => void>();

/** Se alimenta con la config, como el link de invitación: sin request propia. */
export function aplicarConfigVistaPreviaDelLink(config: unknown): boolean {
  const siguiente: EstadoCapacidadVistaPrevia = decodeCapacidadVistaPrevia(config) ? 'encendida' : 'apagada';
  if (siguiente !== capacidad) {
    capacidad = siguiente;
    for (const oyente of [...oyentes]) oyente();
  }
  return capacidad === 'encendida';
}

export function capacidadVistaPrevia(): EstadoCapacidadVistaPrevia {
  return capacidad;
}

function suscribir(oyente: () => void): () => void {
  oyentes.add(oyente);
  return () => { oyentes.delete(oyente); };
}

export function useCapacidadVistaPrevia(): EstadoCapacidadVistaPrevia {
  return useSyncExternalStore(suscribir, capacidadVistaPrevia, capacidadVistaPrevia);
}

// ─── Pedirla ──────────────────────────────────────────────────────────────

/** Un solo token por pestaña: el del link abierto. Otro token no hereda nada. */
let recordada: { readonly token: string; readonly vista: Promise<VistaPreviaDelLink | null>; resuelta?: VistaPreviaDelLink | null } | null = null;

function conPlazo(pedido: Promise<unknown>, plazoMs: number): Promise<VistaPreviaDelLink | null> {
  return new Promise((resolver) => {
    const reloj = setTimeout(() => resolver(null), plazoMs);
    pedido.then(
      (raw) => { clearTimeout(reloj); resolver(decodeVistaPreviaDelLink(raw)); },
      () => { clearTimeout(reloj); resolver(null); },
    );
  });
}

/**
 * La vista previa de ESTE token, o `null`. Sin la capacidad encendida no llama a `pedir`. `pedir` es la fachada
 * (`api.getVistaPreviaDelLink`), inyectada para poder probar el corte sin red.
 *
 * AF-7 · I1 · `vistaDesde` es el momento (`Date.now()`) en que la pantalla se vio: el plazo de 1,5 s se cuenta desde
 * ahí, no desde el pedido. Si `/api/config` tarda, la consulta sólo tiene lo que queda del plazo; si ya no queda nada,
 * no se pide y queda recordado como un fallo. Así el título nunca cambia más de 1,5 s después de verse la pantalla.
 */
export function vistaPreviaDelLink(
  token: string,
  pedir: (token: string) => Promise<unknown>,
  vistaDesde: number = Date.now(),
): Promise<VistaPreviaDelLink | null> {
  if (capacidad !== 'encendida') return Promise.resolve(null);
  if (recordada?.token === token) return recordada.vista;
  const queda = PLAZO_VISTA_PREVIA_MS - (Date.now() - vistaDesde);
  if (queda <= 0) {
    recordada = { token, vista: Promise.resolve(null), resuelta: null };
    return recordada.vista;
  }
  let pedido: Promise<unknown>;
  try {
    pedido = pedir(token);
  } catch {
    pedido = Promise.reject(new Error('link_preview_failed'));
  }
  const entrada: { token: string; vista: Promise<VistaPreviaDelLink | null>; resuelta?: VistaPreviaDelLink | null } = {
    token,
    vista: conPlazo(pedido, queda),
  };
  void entrada.vista.then((v) => { entrada.resuelta = v; });
  recordada = entrada;
  return entrada.vista;
}

/** Lo ya resuelto para este token (para el primer render al volver a montar la pantalla), o `null`. */
export function vistaPreviaRecordada(token: string): VistaPreviaDelLink | null {
  return recordada?.token === token ? recordada.resuelta ?? null : null;
}

export function reiniciarVistaPreviaParaTests(): void {
  capacidad = 'pendiente';
  recordada = null;
}

// ─── El seam del mock ─────────────────────────────────────────────────────

/**
 * `payme.app.mock.link_preview.v1`: sin el seam, el mock no publica la capacidad (el dueño de antes de 2.211.0);
 * con `encendido`, la publica y contesta con el nombre de pila de la cuenta del mock; con `sin_nombre`, el nombre en
 * `null` (D676). Es un ajuste del riel mock, no la respuesta: la respuesta nunca se guarda.
 */
export const CLAVE_VISTA_PREVIA_MOCK = 'payme.app.mock.link_preview.v1';

function seam(): string | null {
  try { return localStorage.getItem(CLAVE_VISTA_PREVIA_MOCK); } catch { return null; }
}

export function capacidadVistaPreviaMock(): { supported: true } | undefined {
  const valor = seam();
  return valor === 'encendido' || valor === 'sin_nombre' ? { supported: true } : undefined;
}

export function vistaPreviaMockSinNombre(): boolean {
  return seam() === 'sin_nombre';
}
