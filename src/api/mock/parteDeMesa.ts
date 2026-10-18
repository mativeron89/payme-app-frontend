import { splitEqual, tipFromBps } from '../../utils/money';

/**
 * D344 · «Mi parte» de una mesa, **sólo para el mock**. Port de `services/parteDeMesa.js` de App Backend 2.186.0.
 *
 * 🔴 La app NO calcula «Mi parte»: la muestra tal como la publica el dueño en `GET /api/mesas/:code?share_version=1`
 * (contrato `contract-mirror/contract/mesa-mi-parte-v1.json`, cc0f617e…). Esto vive en `mock/` para que el modo de
 * ejemplo responda lo mismo que el dueño; lo que vale es el servidor. No es un cálculo de dinero de producto: sólo existe
 * en mesas sin garantía, que el servidor nunca cobra. Nada fuera de `src/api/mock/` lo importa directo; la cadena que lo
 * usa (`store.ts` → `mockApi.ts`) sale del mock sólo por la rama `IS_MOCK ? mockApi : realApi` de `src/api/index.ts`,
 * nada de ella lo corre al cargarse y el módulo no tiene efectos al cargarse (`parteDeMesa.test.ts`, ⑥, lo vigila sobre
 * el árbol, no sobre el bundle). Que el build real no lo traiga se midió el 2026-10-17 con `vite build` (ver ⑥).
 *
 * ## Procedencia
 *
 * `services/parteDeMesa.js` en `6fa84b3570d701b0cb30c91fc56ed6a01127b326`, sha256 `8ccd1788…4796` (medido con
 * `git show … | shasum -a 256`, y es el que declara `scripts/mirror-inventory.json`). El espejo no copia ese archivo
 * (D268: sólo `contract/*.json`), así que la prueba de equivalencia son los vectores del dueño
 * (`tests/parte-de-mesa.test.js`, a18a286b…), portados en `parteDeMesa.test.ts`.
 *
 * Usa `tipFromBps` y `splitEqual` de `src/utils/money.ts`, que son aritméticamente idénticos a los de `utils/money.js`
 * del dueño en ese commit (sha256 `86542329…2891`, el del inventario): comparados línea por línea, las mismas guardas en
 * el mismo orden y con los mismos mensajes, la misma cuenta `(B × bps + den/2) / den` con BigInt y el mismo tope
 * `tip overflow`; en `splitEqual`, el mismo piso y el centavo de más a las primeras partes.
 *
 * ## Qué es idéntico
 *
 * Función por función (`mayorResto`, `baseDePropina`, `propinaTotal`, `neto`, `parteConsumo`, `parteIgual`, `totales`,
 * `calcular`): las mismas validaciones en el mismo orden, los mismos códigos de error (`parte_mesa_entrada_invalida`,
 * `parte_mesa_desborde`) y el mayor resto con BigInt. Un `tip_bps` fuera de 0..10000 lanza el error de `tipFromBps`
 * (`bps out of range (0-10000)`), igual que en el dueño.
 *
 * ## Simplificaciones del mock
 *
 * Este módulo no lee la mesa: todas sus entradas las arma quien llama (el integrador, en `mockApi.ts`), como el dueño
 * las arma en `parteDelDetalle` de `routes/mesas.js`. Lo que NO se replica acá:
 *   · `origenItems.ajustesAplicables`: las reglas de publicación de `ticket_adjustments` v1/v2 y `ticket_totals` v2, el
 *     IVA aparte con la regla de Viajes, la marca de mesa corregida (R4) sólo si había algo que omitir y «forma
 *     desconocida ⇒ omitidos». `ajustes` ({D, S, V, omitidos}) llega decidido.
 *   · El orden de `personas`: el dueño ordena a los activos por `joined_at, id` y agrega al final a quien eligió y ya no
 *     está activo, en el orden de su primer plato elegido. Acá el orden es el del arreglo: el centavo del empate lo sigue.
 *   · Los platos de cada persona (`consumoPropio.porPersonaDeMesa`, con el precio de fracción de siempre) y `U`, lo que
 *     nadie eligió (Σ máx(0, línea − lo elegido del plato), plato por plato).
 *   · En partes iguales, `n` (`expected_participants`, o 1) y `k` (la posición de quien mira entre los activos, o −1).
 *   · La puerta de la mesa: con garantía no se llama (las tres claves en null), y si esto lanza, `tip_setting` sale
 *     igual y `share_totals`/`my_share` en null.
 *   · Que Σ p + U = P: no se comprueba (el dueño tampoco). La coherencia de la entrada es de quien llama.
 */

export const PROCEDENCIA = {
  commit: '6fa84b3570d701b0cb30c91fc56ed6a01127b326',
  ruta: 'services/parteDeMesa.js',
  sha256: '8ccd178853ac6890e884e4672e0580b6fff41285386d63529b11d41cb09a4796',
  dinero: { ruta: 'utils/money.js', sha256: '86542329793934a1866a7d101d0c21002f99cf838ca7aef2cf2dcf5a2a432891' },
} as const;

export type CodigoDeParte = 'parte_mesa_entrada_invalida' | 'parte_mesa_desborde';
export type MotivoDeOmision = 'mesa_corregida' | 'neto_no_positivo';

/** `tip_setting` del contrato: un % en bps, un monto fijo («Otro») o sin fijar. */
export type PropinaDeLaMesa =
  | { readonly tip_bps: number; readonly tip_cents?: undefined }
  | { readonly tip_cents: number; readonly tip_bps?: undefined };

/** D descuentos, S servicio impreso, V IVA que el ticket suma aparte; `omitidos` = la mesa se corrigió (R4). */
export interface AjustesDelTicket {
  readonly D?: number;
  readonly S?: number;
  readonly V?: number;
  readonly omitidos?: boolean;
}

/** Una persona por consumo: `p` son sus platos (lo elegido y guardado), el peso del reparto. */
export interface PersonaConPlatos {
  readonly id: string;
  readonly p: number;
}

export interface Neto {
  readonly P: number;
  readonly D: number;
  readonly S: number;
  readonly V: number;
  readonly N: number;
  readonly omitidos: boolean;
  readonly motivo: MotivoDeOmision | null;
}

/** `my_share` del contrato. */
export interface MiParte {
  readonly items_cents: number;
  readonly adjustments_cents: number;
  readonly tip_cents: number;
  readonly total_cents: number;
}

/** `share_totals` del contrato. */
export interface TotalesDeLaMesa {
  readonly items_cents: number;
  readonly discounts_cents: number;
  readonly service_cents: number;
  readonly tax_added_cents: number;
  readonly adjustments_cents: number;
  readonly tip_basis_cents: number;
  readonly tip_cents: number;
  readonly total_cents: number;
  readonly adjustments_omitted: boolean;
  readonly adjustments_omitted_reason: MotivoDeOmision | null;
}

function error(code: CodigoDeParte): Error {
  return new Error(code);
}

const enteroNoNegativo = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;

/** `Array.isArray` sin estrechar a `any[]`: el dueño valida la forma aunque el tipo ya la diga. */
const esLista = (x: unknown): x is readonly unknown[] => Array.isArray(x);

function exigir(condicion: boolean): asserts condicion {
  if (!condicion) throw error('parte_mesa_entrada_invalida');
}

/**
 * `total` en proporción a `pesos` por MAYOR RESTO: a cada uno el piso de su parte y los centavos que faltan a los
 * restos más grandes; en empate, al de menor índice. Es la regla de `viajesCalculo.repartirPorMayorResto` (una prueba
 * compara las dos), con la entrada validada.
 */
export function mayorResto(total: number, pesos: readonly number[]): number[] {
  exigir(enteroNoNegativo(total) && esLista(pesos) && pesos.length > 0 && pesos.every(enteroNoNegativo));
  const W = pesos.reduce((s, p) => s + BigInt(p), 0n);
  exigir(W > 0n);
  const T = BigInt(total);
  const partes = pesos.map((p) => (T * BigInt(p)) / W);
  const restos = pesos.map((p, i) => ({ i, r: (T * BigInt(p)) % W }))
    .sort((x, y) => (y.r > x.r ? 1 : y.r < x.r ? -1 : x.i - y.i));
  let faltan = T - partes.reduce((s, x) => s + x, 0n);
  for (let k = 0; faltan > 0n; k += 1, faltan -= 1n) partes[restos[k]!.i]! += 1n;
  return partes.map(Number);
}

/** P2 b: la base de la propina son los platos después del descuento, nunca negativa. */
export function baseDePropina(P: number, D: number): number {
  exigir(enteroNoNegativo(P) && enteroNoNegativo(D));
  return Math.max(0, P - D);
}

/** La propina de toda la mesa: sin fijar vale 0; `{tip_bps}` es un % de la base; `{tip_cents}`, el monto fijo. */
export function propinaTotal(base: number, setting: PropinaDeLaMesa | null | undefined): number {
  exigir(enteroNoNegativo(base));
  if (setting === null || setting === undefined) return 0;
  // Con la clave presente y sin número, el dueño le pasa `undefined` a `tipFromBps`; `NaN` cae en la misma guarda.
  if (Object.prototype.hasOwnProperty.call(setting, 'tip_bps')) return tipFromBps(base, 1, setting.tip_bps ?? Number.NaN);
  const cents = setting.tip_cents;
  exigir(enteroNoNegativo(cents));
  return cents;
}

/**
 * El neto del ticket. Con `omitidos` (la mesa se corrigió) o con un neto que no es positivo, no se aplican ajustes:
 * D = S = V = 0, N = P, y `motivo` dice cuál de los dos fue. La mesa corregida manda.
 */
export function neto({ P, D = 0, S = 0, V = 0, omitidos = false }: AjustesDelTicket & { readonly P: number }): Neto {
  exigir([P, D, S, V].every(enteroNoNegativo) && P > 0);
  if (omitidos) return { P, D: 0, S: 0, V: 0, N: P, omitidos: true, motivo: 'mesa_corregida' };
  if (P + S + V - D <= 0) return { P, D: 0, S: 0, V: 0, N: P, omitidos: true, motivo: 'neto_no_positivo' };
  return { P, D, S, V, N: P + S + V - D, omitidos: false, motivo: null };
}

function parte(platos: number, netoDeLaPersona: number, propina: number): MiParte {
  const total = netoDeLaPersona + propina;
  if (!Number.isSafeInteger(total)) throw error('parte_mesa_desborde');
  return { items_cents: platos, adjustments_cents: netoDeLaPersona - platos, tip_cents: propina, total_cents: total };
}

/**
 * Por consumo. `personas` en el orden de la mesa (cómo se sumaron); `U` = lo que nadie eligió, último peso. Devuelve la
 * parte de `yo`, o ceros si no está en la lista.
 */
export function parteConsumo({ N, T, personas, U, yo }: {
  readonly N: number;
  readonly T: number;
  readonly personas: readonly PersonaConPlatos[];
  readonly U: number;
  readonly yo: string | null;
}): MiParte {
  exigir(esLista(personas) && enteroNoNegativo(U) && enteroNoNegativo(T));
  const pesos = [...personas.map((x) => x.p), U];
  const r = mayorResto(N, pesos);
  const t = T > 0 ? mayorResto(T, pesos) : pesos.map(() => 0);
  const k = personas.findIndex((x) => x.id === yo);
  if (k < 0) return parte(0, 0, 0);
  return parte(personas[k]!.p, r[k]!, t[k]!);
}

/** En partes iguales: la parte `k` de las `n` declaradas, o `null` si `k` no tiene parte. */
export function parteIgual({ P, N, T, n, k }: {
  readonly P: number;
  readonly N: number;
  readonly T: number;
  readonly n: number;
  readonly k: number;
}): MiParte | null {
  exigir(Number.isSafeInteger(n) && n >= 1 && enteroNoNegativo(P) && enteroNoNegativo(N) && enteroNoNegativo(T));
  if (!Number.isSafeInteger(k) || k < 0 || k >= n) return null;
  return parte(splitEqual(P, n)[k]!, splitEqual(N, n)[k]!, splitEqual(T, n)[k]!);
}

/** Los totales de la mesa (`share_totals`), sobre el resultado de `neto`. `tip_basis_cents` es B. */
export function totales({ P, D, S, V, N, omitidos, motivo }: Neto, T: number, B: number): TotalesDeLaMesa {
  const total = N + T;
  if (!Number.isSafeInteger(total)) throw error('parte_mesa_desborde');
  return {
    items_cents: P, discounts_cents: D, service_cents: S, tax_added_cents: V,
    adjustments_cents: S + V - D, tip_basis_cents: B, tip_cents: T, total_cents: total, adjustments_omitted: omitidos,
    adjustments_omitted_reason: motivo ?? null,
  };
}

export interface EntradaDeCalculo {
  readonly modo: 'consumo' | 'igual';
  /** Los platos de la mesa. */
  readonly P: number;
  readonly ajustes?: AjustesDelTicket;
  readonly setting?: PropinaDeLaMesa | null;
  /** Por consumo. */
  readonly personas?: readonly PersonaConPlatos[];
  readonly U?: number;
  readonly yo?: string | null;
  /** En partes iguales: las partes declaradas y la de quien mira (o −1). */
  readonly n?: number;
  readonly k?: number;
}

/** Todo junto, como lo pide el detalle: `{ share_totals, my_share }`. */
export function calcular({
  modo, P, ajustes = {}, setting = null, personas = [], U = 0, yo = null, n = 1, k = -1,
}: EntradaDeCalculo): { share_totals: TotalesDeLaMesa; my_share: MiParte | null } {
  const nt = neto({ P, ...ajustes });
  // La base usa el descuento LEÍDO, aunque el neto no permita aplicar los ajustes; la mesa corregida no lo lee (B = P).
  const B = baseDePropina(P, ajustes.omitidos ? 0 : (ajustes.D || 0));
  const T = propinaTotal(B, setting);
  const share_totals = totales(nt, T, B);
  const my_share = modo === 'igual'
    ? parteIgual({ P, N: nt.N, T, n, k })
    : parteConsumo({ N: nt.N, T, personas, U, yo });
  return { share_totals, my_share };
}
