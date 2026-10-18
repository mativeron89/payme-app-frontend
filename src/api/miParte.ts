import { ContractResponseError } from './contractResponses';
import { extractApiError } from './errors';
import { tipFromBps } from '../utils/money';

/**
 * D344 · «Mi parte» y la propina de la mesa · App Backend 2.186.0
 * (`contract-mirror/contract/mesa-mi-parte-v1.json`, `payme.app.mesa_mi_parte/v1`).
 *
 * Con `share_version=1`, el detalle (`GET /api/mesas/:code`) suma tres claves
 * dentro de `mesa`: `tip_setting`, `share_totals` y `my_share`. El detalle se
 * castea sin decodificador, y el contrato pide leer estas tres «con validación
 * propia, como my_paid_bps» (`lectura.decodificador`). Eso hace este módulo.
 *
 * Cada lectura falla CERRADO y nunca lanza: una forma que no cumple da
 * `undefined` y rige lo de hoy (sin «Mi parte»), nunca un monto inventado.
 *   · `undefined`: la clave no vino, o vino con una forma que no cumple.
 *   · `null`: vino en null (mesa con garantía, cálculo imposible, sin parte).
 *
 * Nada de esto se cobra: sólo existe en mesas sin garantía, que el servidor
 * nunca cobra (`POST /pay` responde 409 `guarantee_required`).
 */

/** `{tip_bps: 0..10000}` (un %), `{tip_cents: ≥ 0}` («Otro»). `null` es «sin fijar». */
export type TipSetting = { readonly tip_bps: number } | { readonly tip_cents: number };

/** Por qué no se aplicaron los ajustes del ticket (contrato, `calculo.neto`). */
export type MotivoDeAjustesOmitidos = 'mesa_corregida' | 'neto_no_positivo';

/** Los totales de la mesa entera, sin datos de nadie. */
export interface ShareTotals {
  readonly items_cents: number;
  readonly discounts_cents: number;
  readonly service_cents: number;
  readonly tax_added_cents: number;
  readonly adjustments_cents: number;
  readonly tip_basis_cents: number;
  readonly tip_cents: number;
  readonly total_cents: number;
  readonly adjustments_omitted: boolean;
  readonly adjustments_omitted_reason: MotivoDeAjustesOmitidos | null;
}

/** La parte de quien mira; nunca la de otro. */
export interface MyShare {
  readonly items_cents: number;
  readonly adjustments_cents: number;
  readonly tip_cents: number;
  readonly total_cents: number;
}

/** undefined = la clave no vino o vino mal formada (rige lo de hoy); null = vino en null. */
export interface ParteDelDetalle {
  readonly tipSetting: TipSetting | null | undefined;
  readonly shareTotals: ShareTotals | null | undefined;
  readonly myShare: MyShare | null | undefined;
}

// ─── Utilidades de lectura ──────────────────────────────────────────────────

function registro(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : null;
}

/**
 * Exactamente esas claves PROPIAS y enumerables, ninguna más. Se parte de
 * `Object.keys`, que no mira el prototipo: una clave heredada no cuenta, y una
 * propia no enumerable tampoco (no viaja en JSON).
 */
function clavesExactas(r: Record<string, unknown>, claves: readonly string[]): boolean {
  const propias = Object.keys(r);
  return propias.length === claves.length && propias.every((k) => claves.includes(k));
}

function propia(r: Record<string, unknown>, clave: string): boolean {
  return Object.prototype.hasOwnProperty.call(r, clave);
}

/** Entero seguro con piso. */
function entero(v: unknown, min: number): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= min;
}

/** Entero seguro de cualquier signo (los ajustes pueden ser negativos). */
function enteroConSigno(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v);
}

/**
 * Suma de dos enteros seguros, o `null` si el resultado deja de serlo. Con
 * operandos seguros, la suma en coma flotante es EXACTA siempre que el
 * resultado exacto también sea seguro; si no lo es, el valor calculado queda
 * fuera del rango seguro y aquí se descarta. Así ninguna identidad de abajo
 * se aprueba por un redondeo.
 */
function sumar(a: number, b: number): number | null {
  const s = a + b;
  return Number.isSafeInteger(s) ? s : null;
}

/** Ninguna lectura lanza: un objeto raro (un getter que falla, un Proxy) cuenta como mal formado. */
function aSalvo<T>(leer: () => T): T | undefined {
  try {
    return leer();
  } catch {
    return undefined;
  }
}

// ─── tip_setting ────────────────────────────────────────────────────────────

function tipSettingCrudo(v: unknown): TipSetting | null | undefined {
  if (v === null) return null;
  const r = registro(v);
  if (!r) return undefined;
  if (clavesExactas(r, ['tip_bps'])) {
    const bps = r.tip_bps;
    return entero(bps, 0) && bps <= 10000 ? { tip_bps: bps } : undefined;
  }
  if (clavesExactas(r, ['tip_cents'])) {
    const cents = r.tip_cents;
    // «Otro» no tiene tope de producto (§1.5 bis): sólo entero seguro ≥ 0.
    return entero(cents, 0) ? { tip_cents: cents } : undefined;
  }
  return undefined;
}

/**
 * `tip_setting`: null, o un objeto con EXACTAMENTE una clave, `tip_bps`
 * (entero 0..10000) o `tip_cents` (entero seguro ≥ 0). Dos claves, claves de
 * más, decimales, textos o negativos: `undefined`. Devuelve una copia.
 */
export function leerTipSetting(v: unknown): TipSetting | null | undefined {
  return aSalvo(() => tipSettingCrudo(v));
}

// ─── share_totals ───────────────────────────────────────────────────────────

const CLAVES_DE_LOS_TOTALES = [
  'items_cents', 'discounts_cents', 'service_cents', 'tax_added_cents', 'adjustments_cents',
  'tip_basis_cents', 'tip_cents', 'total_cents', 'adjustments_omitted', 'adjustments_omitted_reason',
] as const;

function shareTotalsCrudo(v: unknown): ShareTotals | null | undefined {
  if (v === null) return null;
  const r = registro(v);
  if (!r || !clavesExactas(r, CLAVES_DE_LOS_TOTALES)) return undefined;
  const {
    items_cents: P, discounts_cents: D, service_cents: S, tax_added_cents: V, adjustments_cents: A,
    tip_basis_cents: B, tip_cents: T, total_cents: total,
    adjustments_omitted: omitidos, adjustments_omitted_reason: motivo,
  } = r;
  if (!entero(P, 0) || !entero(D, 0) || !entero(S, 0) || !entero(V, 0)
      || !entero(B, 0) || !entero(T, 0) || !enteroConSigno(A) || !entero(total, 0)) return undefined;

  // adjustments_cents = service + tax_added − discounts. Primero S − D, que con
  // dos no negativos seguros siempre es seguro; después + V, exacto si el
  // resultado lo es (ver `sumar`).
  if (sumar(S - D, V) !== A) return undefined;
  // total_cents = items + adjustments + tip. N es el neto de la mesa.
  const N = sumar(P, A);
  if (N === null || sumar(N, T) !== total) return undefined;
  // B es la base de la propina por %: nunca más que los platos.
  if (B > P) return undefined;
  if (typeof omitidos !== 'boolean') return undefined;

  let razon: MotivoDeAjustesOmitidos | null;
  if (omitidos) {
    // Con la marca, D = S = V = 0 (y por eso adjustments = 0 y N = P).
    if (D !== 0 || S !== 0 || V !== 0) return undefined;
    if (motivo === 'mesa_corregida') {
      // R4: «en la mesa corregida el descuento no se lee y B = P».
      if (B !== P) return undefined;
      razon = 'mesa_corregida';
    } else if (motivo === 'neto_no_positivo') {
      // «B usa el descuento leído aunque N ≤ 0 anule los ajustes (entonces la
      // propina por % da 0)»: con N = P + S + V − D ≤ 0 y S, V ≥ 0, el
      // descuento leído es ≥ P, así que B = máx(0, P − D) = 0.
      if (B !== 0) return undefined;
      razon = 'neto_no_positivo';
    } else {
      return undefined;
    }
  } else {
    if (motivo !== null) return undefined;
    // Sin la marca, el neto es positivo: con N ≤ 0 el dueño pone la marca.
    if (N <= 0) return undefined;
    // Sin la marca, el descuento publicado es el leído: B = máx(0, P − D).
    if (B !== Math.max(0, P - D)) return undefined;
    razon = null;
  }

  return {
    items_cents: P, discounts_cents: D, service_cents: S, tax_added_cents: V, adjustments_cents: A,
    tip_basis_cents: B, tip_cents: T, total_cents: total,
    adjustments_omitted: omitidos, adjustments_omitted_reason: razon,
  };
}

/**
 * `share_totals`: null, o las 10 claves del contrato con sus identidades
 * (`lectura.claves.share_totals` y `calculo`):
 *   · todo `*_cents` entero seguro; platos, descuentos, servicio, IVA aparte,
 *     base y propina ≥ 0;
 *   · adjustments = service + tax_added − discounts;
 *   · total = items + adjustments + tip, ≥ 0;
 *   · tip_basis ≤ items, y exacta: máx(0, items − discounts) sin la marca, items
 *     con `mesa_corregida`, 0 con `neto_no_positivo`;
 *   · sin la marca, el neto (items + adjustments) es positivo y el motivo es null;
 *   · con la marca, descuentos, servicio e IVA aparte en 0 y un motivo conocido.
 * Cualquier violación: `undefined`.
 */
export function leerShareTotals(v: unknown): ShareTotals | null | undefined {
  return aSalvo(() => shareTotalsCrudo(v));
}

// ─── my_share ───────────────────────────────────────────────────────────────

const CLAVES_DE_MI_PARTE = ['items_cents', 'adjustments_cents', 'tip_cents', 'total_cents'] as const;

function myShareCrudo(v: unknown): MyShare | null | undefined {
  if (v === null) return null;
  const r = registro(v);
  if (!r || !clavesExactas(r, CLAVES_DE_MI_PARTE)) return undefined;
  const { items_cents: platos, adjustments_cents: ajustes, tip_cents: propina, total_cents: total } = r;
  if (!entero(platos, 0) || !enteroConSigno(ajustes) || !entero(propina, 0) || !enteroConSigno(total)) {
    return undefined;
  }
  // La parte del neto (platos + ajustes) nunca es negativa: un descuento no
  // deja a nadie debiendo menos que cero.
  const neto = sumar(platos, ajustes);
  if (neto === null || neto < 0) return undefined;
  if (sumar(neto, propina) !== total) return undefined;
  return { items_cents: platos, adjustments_cents: ajustes, tip_cents: propina, total_cents: total };
}

/**
 * `my_share`: null, o EXACTAMENTE las 4 claves; enteros seguros; platos y
 * propina ≥ 0; los ajustes pueden ser negativos, pero platos + ajustes ≥ 0; y
 * total = platos + ajustes + propina. Cualquier violación: `undefined`.
 *
 * No se compara con `share_totals.items_cents`: el contrato no garantiza que
 * lo elegido por una persona quede por debajo de los platos de la mesa.
 */
export function leerMyShare(v: unknown): MyShare | null | undefined {
  return aSalvo(() => myShareCrudo(v));
}

// ─── El detalle completo ────────────────────────────────────────────────────

/**
 * ¿La propina de los totales es la que fijó el organizador? (contrato,
 * `calculo.propina`): sin fijar, 0; con «Otro», el monto fijo; con un %,
 * `round_half_away(B × tip_bps / 10000)`, la misma `tipFromBps` del dueño.
 * Sin una `tip_setting` legible no hay con qué comparar: los totales no se
 * usan. Así nunca se muestra una propina que nadie eligió.
 */
function propinaCoherente(totales: ShareTotals, setting: TipSetting | null | undefined): boolean {
  if (setting === undefined) return false;
  if (setting === null) return totales.tip_cents === 0;
  if ('tip_cents' in setting) return totales.tip_cents === setting.tip_cents;
  return totales.tip_cents === tipFromBps(totales.tip_basis_cents, 1, setting.tip_bps);
}

function parteCruda(mesa: unknown): ParteDelDetalle {
  const m = registro(mesa);
  if (!m) return { tipSetting: undefined, shareTotals: undefined, myShare: undefined };
  const tipSetting = propia(m, 'tip_setting') ? leerTipSetting(m.tip_setting) : undefined;
  let shareTotals = propia(m, 'share_totals') ? leerShareTotals(m.share_totals) : undefined;
  if (shareTotals && !propinaCoherente(shareTotals, tipSetting)) shareTotals = undefined;
  let myShare = propia(m, 'my_share') ? leerMyShare(m.my_share) : undefined;
  // La parte propia sólo vale junto a los totales de la mesa: si éstos no son
  // un objeto válido, una parte en objeto no tiene respaldo y cuenta como ausente.
  if (myShare && !shareTotals) myShare = undefined;
  return { tipSetting, shareTotals, myShare };
}

/**
 * Lee las tres claves de `mesa` (el objeto del detalle). NUNCA lanza: la usan
 * MesaScreen, TicketDigitalDialog y JoinMesaScreen. Si `mesa` no es un objeto,
 * las tres en `undefined`; una clave ausente, `undefined`.
 *
 * Coherencia entre claves, las dos que garantiza el contrato:
 *   · `myShare` en objeto exige `shareTotals` en objeto válido; si no, pasa a
 *     `undefined` (una `my_share` en null se conserva).
 *   · `shareTotals.tip_cents` tiene que ser la propina de `tipSetting`; si no
 *     cierra (o `tipSetting` no se pudo leer), `shareTotals` pasa a `undefined`
 *     y arrastra a `myShare`. `tipSetting` se conserva: el dueño la publica
 *     aunque el cálculo falle.
 */
export function leerParteDelDetalle(mesa: unknown): ParteDelDetalle {
  return aSalvo(() => parteCruda(mesa)) ?? { tipSetting: undefined, shareTotals: undefined, myShare: undefined };
}

// ─── PUT /api/mesas/:code/tip ───────────────────────────────────────────────

/**
 * Lo que lanza `cuerpoDelPutDePropina` ante una propina inválida. Es un
 * `TypeError` (un error de programación, no del dueño), pero con clase propia:
 * los fetch caídos también son `TypeError`, y `clasificarErrorDePropina` no
 * debe tomarlo por una falla de red y reintentarlo.
 */
class PropinaInvalidaError extends TypeError {
  constructor() {
    super('tip_setting_invalid');
    this.name = 'PropinaInvalidaError';
  }
}

/**
 * El cuerpo exacto del PUT: `{ tip_setting: X }` (contrato, `escritura.cuerpo`).
 * Lanza un `TypeError` si X no es válido: nunca manda `{tip_bps: 0}` por «sin
 * fijar» ni `{tip_cents: 0}` por un monto inválido. Manda una copia.
 */
export function cuerpoDelPutDePropina(setting: TipSetting | null): { tip_setting: TipSetting | null } {
  const leido = leerTipSetting(setting);
  if (leido === undefined) throw new PropinaInvalidaError();
  return { tip_setting: leido };
}

/**
 * La respuesta 200 del PUT: `{ tip_setting: X }`, con el valor que quedó. Lanza
 * `ContractResponseError` si no es exactamente eso: un 2xx malformado no
 * acredita que se haya guardado.
 */
export function leerRespuestaDelPutDePropina(body: unknown): TipSetting | null {
  const leido = aSalvo(() => {
    const r = registro(body);
    return r && clavesExactas(r, ['tip_setting']) ? tipSettingCrudo(r.tip_setting) : undefined;
  });
  if (leido === undefined) throw new ContractResponseError('mesas/:code/tip');
  return leido;
}

export type ClaseDeErrorDePropina = 'transitorio' | 'fijo';

/**
 * Clasifica un error del PUT según la orden D344: TRANSITORIO = red, timeout,
 * 5xx y 429; FIJO = 400, 403, 404, 409 y cualquier otro 4xx. El 408 es un
 * timeout dicho por el servidor y cuenta como timeout (transitorio). Esta tabla es
 * propia: no distingue unos 409 de otros por su código (el PUT es idempotente y
 * ningún 409 suyo se arregla reintentando).
 *
 * - Un error sin status (fetch caído: `TypeError`; timeout: el `AbortError`
 *   del `AbortController` de `http.ts`) es transitorio.
 * - Un error desconocido sin status también: es lo que se reintenta con tope,
 *   y reintentar un PUT idempotente no cambia el resultado. Incluye el 2xx
 *   malformado (`ContractResponseError`), que no acredita lo guardado.
 * - Un status fuera de 4xx y 5xx (no debería existir) sigue la misma regla.
 * - La única excepción sin status es la propina inválida de
 *   `cuerpoDelPutDePropina`: reintentar manda lo mismo, así que es fija.
 *
 * `status` y `codigo` (el `error` del cuerpo) salen de `extractApiError`
 * cuando se pueden leer; si no, `null`.
 */
export function clasificarErrorDePropina(
  err: unknown,
): { readonly clase: ClaseDeErrorDePropina; readonly status: number | null; readonly codigo: string | null } {
  if (err instanceof PropinaInvalidaError) return { clase: 'fijo', status: null, codigo: err.message };
  const { code, extra, status } = extractApiError(err);
  if (status === null) return { clase: 'transitorio', status: null, codigo: null };
  const clase: ClaseDeErrorDePropina = status >= 400 && status <= 499 && status !== 429 && status !== 408
    ? 'fijo'
    : 'transitorio';
  return { clase, status, codigo: codigoDelCuerpo(code, extra, status) };
}

/**
 * El `error` del cuerpo. En `HttpError`, `extra` ES el cuerpo (que puede no ser
 * un objeto si el servidor mandó otra cosa) y `code` cae a `http_<status>` sin
 * él; en `MockApiError`, `code` es el error y `extra` trae el resto.
 */
function codigoDelCuerpo(code: string, extra: unknown, status: number): string | null {
  const cuerpo = registro(extra);
  if (cuerpo && propia(cuerpo, 'error')) return typeof cuerpo.error === 'string' ? cuerpo.error : null;
  return code === `http_${status}` || code.length === 0 ? null : code;
}
