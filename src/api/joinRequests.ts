/**
 * D219 · D223 · unirse a una mesa escribiendo su código (contrato del dueño
 * `payme.app.mesa-join-requests/v1`, App Backend 2.166.0, espejado en
 * `contract-mirror/contract/mesa-join-requests-v1.json`).
 *
 * Quien escribe el código PIDE; el titular acepta o rechaza. El contrato fija
 * **claves exactas** en cada respuesta y el front rechaza las desconocidas: es
 * la garantía de privacidad de este lado. Quien pide no recibe nada de la mesa
 * salvo `mesa_code`, y sólo cuando ya está adentro; el titular ve de quien pide
 * sólo nombre, apellido y @ (D219). Una respuesta con una clave de más, un
 * estado desconocido, otro id o un `mesa_code` antes de tiempo NO se usa a
 * medias: tira, y la pantalla muestra el error genérico sin inventar un
 * resultado.
 */

/** El texto de la entrada: «PA-» fijo y cinco números (X01, lo que genera el backend). */
export const PREFIJO_DEL_CODIGO = 'PA-';
export const CIFRAS_DEL_CODIGO = 5;

/** «PA-01234» desde lo que se escribió en las celdas; `null` si no son 5 números. */
export function codigoDeLasCeldas(cifras: string): string | null {
  return /^\d{5}$/.test(cifras) ? `${PREFIJO_DEL_CODIGO}${cifras}` : null;
}

export type EstadoDeSolicitud = 'pending' | 'accepted' | 'rejected' | 'cancelled' | 'expired';

/** Lo que contesta `POST /api/join-requests`. */
export type RespuestaAlPedir =
  | { readonly kind: 'pendiente'; readonly id: string; readonly expiresAt: string }
  | { readonly kind: 'ya_adentro'; readonly mesaCode: string };

/** Lo que contesta `GET /api/join-requests/:id`. */
export type SolicitudPropia =
  | { readonly id: string; readonly status: Exclude<EstadoDeSolicitud, 'accepted'>; readonly expiresAt: string }
  | { readonly id: string; readonly status: 'accepted'; readonly expiresAt: string; readonly mesaCode: string };

/** Una solicitud pendiente, como la ve el titular. */
export interface SolicitudParaElTitular {
  readonly id: string;
  readonly requester: {
    readonly firstName: string | null;
    readonly lastName: string | null;
    readonly username: string | null;
  };
  readonly createdAt: string;
  readonly expiresAt: string;
}

const MALFORMADA = 'join_request_response_malformed';

function objetoPlano(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function clavesExactas(v: Record<string, unknown>, esperadas: readonly string[]): boolean {
  const reales = Object.keys(v).sort();
  const quiero = [...esperadas].sort();
  return reales.length === quiero.length && reales.every((k, i) => k === quiero[i]);
}

function idValido(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= 64 && v.trim() === v;
}

function fechaValida(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && Number.isFinite(Date.parse(v));
}

/** El código de una mesa en una respuesta: texto corto, sin espacios en los bordes. */
function codigoValido(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= 32 && v.trim() === v;
}

function textoONulo(v: unknown): v is string | null {
  return v === null || typeof v === 'string';
}

function falla(): never {
  throw new Error(MALFORMADA);
}

/** `POST /api/join-requests`: 201/200 pendiente, o 200 «ya estás adentro». */
export function decodePedirUnirse(raw: unknown): RespuestaAlPedir {
  if (!objetoPlano(raw)) falla();
  if (raw.status === 'already_participant') {
    if (!clavesExactas(raw, ['status', 'mesa_code']) || !codigoValido(raw.mesa_code)) falla();
    return { kind: 'ya_adentro', mesaCode: raw.mesa_code };
  }
  if (raw.status !== 'pending' || !clavesExactas(raw, ['id', 'status', 'expires_at'])
      || !idValido(raw.id) || !fechaValida(raw.expires_at)) falla();
  return { kind: 'pendiente', id: raw.id, expiresAt: raw.expires_at };
}

const ESTADOS: readonly EstadoDeSolicitud[] = ['pending', 'accepted', 'rejected', 'cancelled', 'expired'];

/**
 * `GET /api/join-requests/:id`. `mesa_code` SÓLO con `accepted`: antes, una
 * clave de más. Y el id tiene que ser el que se consultó (P08): una respuesta
 * de otro pedido no se aplica.
 */
export function decodeSolicitudPropia(raw: unknown, idConsultado: string): SolicitudPropia {
  if (!objetoPlano(raw) || typeof raw.status !== 'string' || !ESTADOS.includes(raw.status as EstadoDeSolicitud)) falla();
  const status = raw.status as EstadoDeSolicitud;
  const claves = status === 'accepted' ? ['id', 'status', 'expires_at', 'mesa_code'] : ['id', 'status', 'expires_at'];
  if (!clavesExactas(raw, claves) || raw.id !== idConsultado || !idValido(raw.id) || !fechaValida(raw.expires_at)) falla();
  if (status === 'accepted') {
    if (!codigoValido(raw.mesa_code)) falla();
    return { id: raw.id, status, expiresAt: raw.expires_at, mesaCode: raw.mesa_code };
  }
  return { id: raw.id, status, expiresAt: raw.expires_at };
}

/** `POST /api/join-requests/:id/cancel`: `{id, status:'cancelled'}`, del mismo id. */
export function decodeCancelarSolicitud(raw: unknown, idConsultado: string): void {
  if (!objetoPlano(raw) || !clavesExactas(raw, ['id', 'status']) || raw.id !== idConsultado
      || raw.status !== 'cancelled') falla();
}

/**
 * `GET /api/mesas/:code/join-requests`, del titular. `requester` trae
 * EXACTAMENTE nombre, apellido y @: ni foto, ni correo, ni teléfono, ni ids
 * (P04). Orden de llegada, como lo manda el dueño.
 */
export function decodeSolicitudesDeLaMesa(raw: unknown): readonly SolicitudParaElTitular[] {
  if (!objetoPlano(raw) || !clavesExactas(raw, ['join_requests']) || !Array.isArray(raw.join_requests)) falla();
  const vistos = new Set<string>();
  return raw.join_requests.map((s) => {
    if (!objetoPlano(s) || !clavesExactas(s, ['id', 'requester', 'created_at', 'expires_at'])
        || !idValido(s.id) || vistos.has(s.id) || !fechaValida(s.created_at) || !fechaValida(s.expires_at)) falla();
    const r = s.requester;
    if (!objetoPlano(r) || !clavesExactas(r, ['first_name', 'last_name', 'username'])
        || !textoONulo(r.first_name) || !textoONulo(r.last_name) || !textoONulo(r.username)) falla();
    vistos.add(s.id);
    return {
      id: s.id,
      requester: { firstName: r.first_name, lastName: r.last_name, username: r.username },
      createdAt: s.created_at,
      expiresAt: s.expires_at,
    };
  });
}

/** Aceptar o rechazar: `{id, status}` del mismo id, con el estado pedido. */
export function decodeDecisionDelTitular(
  raw: unknown,
  idConsultado: string,
  status: 'accepted' | 'rejected',
): void {
  if (!objetoPlano(raw) || !clavesExactas(raw, ['id', 'status']) || raw.id !== idConsultado
      || raw.status !== status) falla();
}

/**
 * El nombre visible de quien pide: «Nombre Apellido» y el @ aparte. Sin nombre
 * ni apellido, `null` (la pantalla dice «Alguien»). Nunca un id ni un correo.
 */
export function quienPide(r: SolicitudParaElTitular['requester']): { nombre: string | null; arroba: string | null } {
  const limpio = (v: string | null) => (v ?? '').trim();
  const nombre = [limpio(r.firstName), limpio(r.lastName)].filter((p) => p.length > 0).join(' ');
  const arroba = limpio(r.username);
  return { nombre: nombre.length > 0 ? nombre : null, arroba: arroba.length > 0 ? arroba : null };
}

/** Lo que falta para `expires_at`, en «mm:ss». Nunca negativo: en cero, `00:00`. */
export function venceEn(expiresAt: string, ahoraMs: number): string {
  const resto = Math.max(0, Math.floor((Date.parse(expiresAt) - ahoraMs) / 1000));
  if (!Number.isFinite(resto)) return '00:00';
  const mm = Math.floor(resto / 60);
  const ss = resto % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

/** `true` si ya pasó `expires_at` (el contador está en cero). */
export function vencio(expiresAt: string, ahoraMs: number): boolean {
  const t = Date.parse(expiresAt);
  return !Number.isFinite(t) || t <= ahoraMs;
}

// ─── Lo que se guarda en el teléfono (X06) ────────────────────────────────

/**
 * Sólo el id de la solicitud pendiente, el código escrito y de qué cuenta es,
 * para retomar la espera si se recarga la app. Nada de la mesa. Con otra
 * cuenta no se usa (P09). Todo en try/catch: sin almacenamiento, se pierde la
 * espera, no la solicitud.
 */
export const CLAVE_SOLICITUD_PENDIENTE = 'payme.app.unirse.pendiente.v1';

export interface SolicitudGuardada {
  readonly cuenta: string;
  readonly id: string;
  readonly codigo: string;
}

export function guardarSolicitud(s: SolicitudGuardada, storage: Pick<Storage, 'setItem'> | null = almacen()): void {
  try {
    storage?.setItem(CLAVE_SOLICITUD_PENDIENTE, JSON.stringify(s));
  } catch {
    // Sin almacenamiento: la espera sigue mientras la pantalla esté abierta.
  }
}

export function olvidarSolicitud(storage: Pick<Storage, 'removeItem'> | null = almacen()): void {
  try {
    storage?.removeItem(CLAVE_SOLICITUD_PENDIENTE);
  } catch {
    // Nada que hacer: lo que haya quedado se descarta al leerlo con otra cuenta.
  }
}

/** La solicitud guardada de ESTA cuenta, o `null`. La de otra cuenta se borra. */
export function leerSolicitud(
  cuenta: string,
  storage: Pick<Storage, 'getItem' | 'removeItem'> | null = almacen(),
): SolicitudGuardada | null {
  let raw: string | null = null;
  try {
    raw = storage?.getItem(CLAVE_SOLICITUD_PENDIENTE) ?? null;
  } catch {
    return null;
  }
  if (raw === null) return null;
  let v: unknown = null;
  try {
    v = JSON.parse(raw);
  } catch {
    v = null;
  }
  if (!objetoPlano(v) || !clavesExactas(v, ['cuenta', 'id', 'codigo']) || v.cuenta !== cuenta
      || !idValido(v.id) || typeof v.codigo !== 'string' || !/^PA-\d{5}$/.test(v.codigo)) {
    olvidarSolicitud(storage);
    return null;
  }
  return { cuenta, id: v.id, codigo: v.codigo };
}

function almacen(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
