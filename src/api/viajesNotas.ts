import { extractApiError } from './errors';
import { CONTRATO_VIAJES, ESTADOS_VIAJE, errorDeViaje, persona, ViajesResponseError, type ErrorDeViaje, type EstadoViaje, type PersonaViaje } from './viajes';

/**
 * D290 · el pizarrón de notas del viaje, contra App Backend 2.183.0 (`contract-mirror/contract/viajes-v1.json`, sección
 * `notas`, `limites.notas` y `negociaciones.viaje_version_11`).
 *
 * Mati: «Todos ven, cada uno escribe el suyo» y «Texto y listas con tildes». Cada miembro tiene su apartado; todos leen
 * todo y cada uno crea, edita, borra y tilda sólo lo suyo. Con el viaje esperando pagos o cerrado, todo queda para leer.
 *
 * 🔴 El texto de una nota es de la persona: no va a un log, a analítica ni a una memoria que sobreviva a la cuenta. La
 * pantalla lo guarda en su estado y nada más (ver `NotasScreen`).
 */

/** Los límites del contrato (`limites.notas`). El servidor valida igual; el front no deja escribir más que esto. */
export interface LimitesDeNotas {
  readonly entradas_por_miembro: number;
  readonly caracteres_nota: number;
  readonly items_por_lista: number;
  readonly caracteres_item: number;
  readonly caracteres_titulo: number;
}

/** Los de 2.183.0. El pizarrón trae los suyos; éstos son los que valen si la pantalla todavía no los leyó. */
export const LIMITES_DE_NOTAS: LimitesDeNotas = Object.freeze({
  entradas_por_miembro: 20, caracteres_nota: 500, items_por_lista: 30, caracteres_item: 80, caracteres_titulo: 80,
});

export interface ItemDeLista {
  readonly id: string;
  readonly texto: string;
  readonly tildado: boolean;
}

interface EntradaComun {
  readonly id: string;
  /** La que vi: editar y borrar la llevan, y si otra pestaña la cambió, 409 con mi apartado. */
  readonly version: number;
  readonly creado_en: string;
  readonly actualizado_en: string;
}

export interface NotaDeTexto extends EntradaComun {
  readonly tipo: 'nota';
  readonly texto: string;
}

export interface ListaConTildes extends EntradaComun {
  readonly tipo: 'lista';
  readonly titulo: string;
  readonly items: readonly ItemDeLista[];
}

export type EntradaDeNotas = NotaDeTexto | ListaConTildes;

/** Un apartado: la persona como en el detalle del viaje y sus entradas, en el orden que eligió. */
export interface Apartado extends PersonaViaje {
  readonly miembro_id: string;
  readonly has_avatar: boolean;
  readonly es_yo: boolean;
  /** La última vez que creó o editó algo; `null` si no tiene nada. */
  readonly actualizado_en: string | null;
  readonly entradas: readonly EntradaDeNotas[];
}

/** `GET /api/viajes/:id/notas`. */
export interface Pizarron {
  readonly viaje_id: string;
  readonly nombre: string;
  readonly estado: EstadoViaje;
  readonly cerrado_en: string | null;
  /** El viaje está abierto y mi cuenta está activa: puedo escribir en mi apartado. */
  readonly editable: boolean;
  readonly total: number;
  readonly escribieron: number;
  readonly limites: LimitesDeNotas;
  /** El mío primero; después los que escribieron, del último al primero; al final los que no tienen nada. */
  readonly apartados: readonly Apartado[];
}

/** Lo que devuelve una escritura: mi apartado actual, y en un alta, el id de la entrada nueva. */
export interface EscrituraDeNotas {
  readonly entrada_id: string | null;
  readonly apartado: Apartado;
}

// ─── Los pedidos ────────────────────────────────────────────────────────────────────────────────────────────────

export type PedidoDeNotaNueva =
  | { readonly idempotency_key: string; readonly tipo: 'nota'; readonly texto: string }
  | { readonly idempotency_key: string; readonly tipo: 'lista'; readonly titulo: string; readonly items: ReadonlyArray<{ readonly texto: string }> };

export type PedidoDeEdicion =
  | { readonly version: number; readonly texto: string }
  | {
    readonly version: number;
    readonly titulo?: string;
    /** La lista COMPLETA: con `id`, un ítem que existe (conserva su tilde); sin `id`, uno nuevo; el que no viene, se saca. */
    readonly items?: ReadonlyArray<{ readonly id?: string; readonly texto: string }>;
  };

/**
 * «Caracteres» es el `.length` de JavaScript, como cuenta el dueño (`notas.caracteres`): un emoji suele contar 2. Lo que
 * este contador deja escribir, el servidor lo acepta.
 */
export const largoDeNota = (s: string): number => s.length;

// ─── Los decodificadores ────────────────────────────────────────────────────────────────────────────────────────

function plainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function clavesExactas(value: Record<string, unknown>, esperadas: readonly string[]): boolean {
  const claves = Object.keys(value);
  return claves.length === esperadas.length && esperadas.every((k) => Object.prototype.hasOwnProperty.call(value, k));
}

function objeto(raw: unknown, claves: readonly string[], e: string): Record<string, unknown> {
  if (!plainObject(raw) || !clavesExactas(raw, claves)) throw new ViajesResponseError(e);
  return raw;
}

function exigir(ok: boolean, e: string): void {
  if (!ok) throw new ViajesResponseError(e);
}

const texto = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const entero = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);
const instante = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v));
const instanteONull = (v: unknown): v is string | null => v === null || instante(v);
const esEstado = (v: unknown): v is EstadoViaje => typeof v === 'string' && (ESTADOS_VIAJE as readonly string[]).includes(v);

function limites(raw: unknown, e: string): LimitesDeNotas {
  const l = objeto(raw, ['entradas_por_miembro', 'caracteres_nota', 'items_por_lista', 'caracteres_item', 'caracteres_titulo'], e);
  exigir(Object.values(l).every((x) => entero(x) && x > 0), e);
  return l as unknown as LimitesDeNotas;
}

function entrada(raw: unknown, lim: LimitesDeNotas, e: string): EntradaDeNotas {
  const tipo = plainObject(raw) ? raw.tipo : null;
  const cola = (o: Record<string, unknown>) => {
    exigir(texto(o.id) && entero(o.version) && o.version >= 1 && instante(o.creado_en) && instante(o.actualizado_en), e);
    return { id: o.id as string, version: o.version as number, creado_en: o.creado_en as string, actualizado_en: o.actualizado_en as string };
  };
  if (tipo === 'nota') {
    const o = objeto(raw, ['id', 'tipo', 'texto', 'version', 'creado_en', 'actualizado_en'], e);
    exigir(texto(o.texto) && (o.texto as string).length <= lim.caracteres_nota, e);
    return { ...cola(o), tipo: 'nota', texto: o.texto as string };
  }
  const o = objeto(raw, ['id', 'tipo', 'titulo', 'items', 'version', 'creado_en', 'actualizado_en'], e);
  exigir(o.tipo === 'lista' && texto(o.titulo) && (o.titulo as string).length <= lim.caracteres_titulo
    && Array.isArray(o.items) && o.items.length >= 1 && o.items.length <= lim.items_por_lista, e);
  const items = (o.items as unknown[]).map((x): ItemDeLista => {
    const i = objeto(x, ['id', 'texto', 'tildado'], e);
    exigir(texto(i.id) && texto(i.texto) && (i.texto as string).length <= lim.caracteres_item && typeof i.tildado === 'boolean', e);
    return { id: i.id as string, texto: i.texto as string, tildado: i.tildado as boolean };
  });
  exigir(new Set(items.map((i) => i.id)).size === items.length, e);
  return { ...cola(o), tipo: 'lista', titulo: o.titulo as string, items };
}

function apartado(raw: unknown, lim: LimitesDeNotas, e: string): Apartado {
  const o = objeto(raw, ['miembro_id', 'first_name', 'last_name', 'username', 'eliminada', 'has_avatar', 'es_yo',
    'actualizado_en', 'entradas'], e);
  exigir(texto(o.miembro_id) && typeof o.has_avatar === 'boolean' && typeof o.es_yo === 'boolean'
    && instanteONull(o.actualizado_en) && Array.isArray(o.entradas) && o.entradas.length <= lim.entradas_por_miembro, e);
  const entradas = (o.entradas as unknown[]).map((x) => entrada(x, lim, e));
  exigir(new Set(entradas.map((x) => x.id)).size === entradas.length
    // Sin entradas no hay «última vez que escribió», y con entradas sí.
    && (entradas.length === 0) === (o.actualizado_en === null), e);
  return { miembro_id: o.miembro_id as string, ...persona(o, e), has_avatar: o.has_avatar as boolean,
    es_yo: o.es_yo as boolean, actualizado_en: o.actualizado_en as string | null, entradas };
}

/** `GET /api/viajes/:id/notas` → `{ contract, pizarron }`. */
export function decodePizarron(raw: unknown, viajeId: string): Pizarron {
  const e = 'viajes.notas';
  if (!plainObject(raw) || !clavesExactas(raw, ['contract', 'pizarron']) || raw.contract !== CONTRATO_VIAJES) {
    throw new ViajesResponseError(e);
  }
  const p = objeto(raw.pizarron, ['viaje_id', 'nombre', 'estado', 'cerrado_en', 'editable', 'total', 'escribieron',
    'limites', 'apartados'], e);
  exigir(p.viaje_id === viajeId && texto(p.nombre) && esEstado(p.estado) && instanteONull(p.cerrado_en)
    && typeof p.editable === 'boolean' && entero(p.total) && entero(p.escribieron) && Array.isArray(p.apartados)
    && p.apartados.length <= 40, e);
  const lim = limites(p.limites, e);
  const apartados = (p.apartados as unknown[]).map((x) => apartado(x, lim, e));
  const mios = apartados.filter((a) => a.es_yo);
  exigir(
    // Un apartado por persona, y el mío (si estoy) primero.
    new Set(apartados.map((a) => a.miembro_id)).size === apartados.length
      && mios.length <= 1 && (mios.length === 0 || apartados[0]!.es_yo)
      // `total` son los autores; `escribieron`, los que tienen algo.
      && p.total === apartados.length && p.escribieron === apartados.filter((a) => a.entradas.length > 0).length
      // Sólo se escribe con el viaje abierto.
      && (!p.editable || p.estado === 'abierto'),
    e,
  );
  return { viaje_id: p.viaje_id as string, nombre: p.nombre as string, estado: p.estado as EstadoViaje,
    cerrado_en: p.cerrado_en as string | null, editable: p.editable as boolean, total: p.total as number,
    escribieron: p.escribieron as number, limites: lim, apartados };
}

/** Mi apartado en una respuesta: siempre el mío. */
function miApartado(raw: unknown, e: string): Apartado {
  const a = apartado(raw, LIMITES_DE_NOTAS, e);
  exigir(a.es_yo, e);
  return a;
}

/** `POST …/notas` → `{ contract, entrada_id, apartado }`; las demás escrituras → `{ contract, apartado }`. */
export function decodeEscrituraDeNotas(raw: unknown, conEntrada: boolean, e: string): EscrituraDeNotas {
  const claves = conEntrada ? ['contract', 'entrada_id', 'apartado'] : ['contract', 'apartado'];
  if (!plainObject(raw) || !clavesExactas(raw, claves) || raw.contract !== CONTRATO_VIAJES) throw new ViajesResponseError(e);
  const ap = miApartado(raw.apartado, e);
  if (!conEntrada) return { entrada_id: null, apartado: ap };
  exigir(texto(raw.entrada_id) && ap.entradas.some((x) => x.id === raw.entrada_id), e);
  return { entrada_id: raw.entrada_id as string, apartado: ap };
}

// ─── Los errores ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Lo que dice la pantalla ante cada respuesta del dueño (contrato, `rutas` de notas):
 * - 404 `viaje_nota_not_found` o `viaje_nota_item_not_found`: ya no está (otra pestaña la borró). Se vuelve a leer el
 *   pizarrón; el 404 del viaje (n325) es «no disponible», como en todas las pantallas.
 * - 403 `viaje_nota_not_yours`: no es mía (la pantalla quedó vieja). 403 `user_suspended`: mi cuenta no escribe.
 * - 409 `viaje_nota_version_conflict` y `viaje_notas_order_mismatch`: otra pestaña la cambió; traen mi apartado actual.
 * - 409 `idempotency_key_conflict`: la misma clave con otro pedido.
 * - 409 `viaje_notas_limit`: llegué al tope de entradas (`limit`).
 * - 400 `validation_error`: los `message` de cada `issue` (`texto_max_500`, `items_max_30`…).
 * - 422 `viaje_nota_item_unknown`: un ítem que ya no es de la lista.
 * El 409 `viaje_not_open` (esperando pagos o cerrado) y el resto siguen a `errorDeViaje`.
 */
export type ErrorDeNotas =
  | { readonly tipo: 'nota_no_encontrada' }
  | { readonly tipo: 'no_es_tuya' }
  | { readonly tipo: 'cuenta_suspendida' }
  | { readonly tipo: 'otra_version'; readonly apartado: Apartado | null }
  | { readonly tipo: 'otro_orden'; readonly apartado: Apartado | null }
  | { readonly tipo: 'clave_repetida' }
  | { readonly tipo: 'tope_de_entradas'; readonly limite: number }
  | { readonly tipo: 'invalido'; readonly mensajes: readonly string[] }
  | { readonly tipo: 'item_desconocido' }
  | ErrorDeViaje;

function apartadoDe(extra: Record<string, unknown>): Apartado | null {
  try {
    return miApartado(extra.apartado, 'viajes.notas.conflicto');
  } catch {
    return null;
  }
}

export function errorDeNotas(err: unknown): ErrorDeNotas {
  const { status, code, extra } = extractApiError(err);
  if (status === 404 && (code === 'viaje_nota_not_found' || code === 'viaje_nota_item_not_found')) return { tipo: 'nota_no_encontrada' };
  if (status === 403 && code === 'viaje_nota_not_yours') return { tipo: 'no_es_tuya' };
  if (status === 403 && code === 'user_suspended') return { tipo: 'cuenta_suspendida' };
  if (status === 409 && code === 'viaje_nota_version_conflict') return { tipo: 'otra_version', apartado: apartadoDe(extra) };
  if (status === 409 && code === 'viaje_notas_order_mismatch') return { tipo: 'otro_orden', apartado: apartadoDe(extra) };
  if (status === 409 && code === 'idempotency_key_conflict') return { tipo: 'clave_repetida' };
  if (status === 409 && code === 'viaje_notas_limit') {
    return { tipo: 'tope_de_entradas', limite: entero(extra.limit) && extra.limit > 0 ? extra.limit : LIMITES_DE_NOTAS.entradas_por_miembro };
  }
  if (status === 400 && code === 'validation_error') {
    const issues = Array.isArray(extra.issues) ? extra.issues : [];
    return { tipo: 'invalido', mensajes: issues.filter(plainObject).map((i) => i.message).filter((m): m is string => typeof m === 'string') };
  }
  if (status === 422 && code === 'viaje_nota_item_unknown') return { tipo: 'item_desconocido' };
  return errorDeViaje(err);
}
